const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../dist/index.js'), 'utf8');

/** Activates the built extension against a host RPC stub and captures its providers. */
const activate = host => {
	const calls = [];
	const changes = [];
	const providers = {};
	const disposable = {dispose() {}};
	const vscode = {
		EventEmitter: class {
			event = () => disposable;
			fire(events) { changes.push(...events); }
		}
		, FileType: {File: 1, Directory: 2}
		, FileChangeType: {Changed: 1, Created: 2, Deleted: 3}
		, FileSystemError: {
			FileNotFound: path => Object.assign(new Error(`File not found: ${path}`), {code: 'FileNotFound'})
		}
		, Uri: {parse: path => ({path}), from: uri => uri}
		, workspace: {
			textDocuments: []
			, registerFileSystemProvider: (scheme, provider) => { providers.files = provider; return disposable; }
			, registerFileSearchProvider: (scheme, provider) => { providers.search = provider; return disposable; }
			, onDidOpenTextDocument: () => disposable
			, updateWorkspaceFolders() {}
		}
		, window: {onDidChangeVisibleTextEditors: () => disposable}
		, commands: {
			registerCommand: () => disposable
			, executeCommand: async (command, action, ...args) => {
				assert.equal(command, 'fileBus.call');
				if(action === 'activate') return true;
				calls.push(structuredClone([action, ...args]));
				return host(action, ...args);
			}
		}
	};
	const exports = {};
	vm.runInNewContext(source, {
		exports
		, require: name => {
			assert.equal(name, 'vscode');
			return vscode;
		}
	});
	exports.activate({subscriptions: []});
	return {...providers, calls, changes};
};

for(const count of [100, 1000])
{
	test(`typed directory listing uses one RPC for ${count} entries`, async () => {
		const entries = Array.from({length: count}, (_, index) => ({name: `file-${index}`, isFolder: index % 2 === 0}));
		const {files, calls} = activate(() => [{name: '.', isFolder: true}, ...entries, {name: '..', isFolder: true}]);
		assert.deepEqual(structuredClone(await files.readDirectory({path: '/persist'})), entries.map(entry => [entry.name, entry.isFolder ? 2 : 1]));
		assert.deepEqual(calls, [['readdir', '/persist', {withFileTypes: true}]]);
	});
}

test('legacy hosts are classified per entry with dot entries filtered and order preserved', async () => {
	const {files, calls} = activate((action, path) => {
		if(action === 'readdir') return ['.', 'café.php', '..', '目录', 'folder-link'];
		return {exists: true, object: {isFolder: !path.endsWith('.php')}};
	});
	assert.deepEqual(structuredClone(await files.readDirectory({path: '/persist/'})), [['café.php', 1], ['目录', 2], ['folder-link', 2]]);
	assert.deepEqual(calls, [
		['readdir', '/persist/', {withFileTypes: true}]
		, ['analyzePath', '/persist/café.php']
		, ['analyzePath', '/persist/目录']
		, ['analyzePath', '/persist/folder-link']
	]);
});

test('empty and Unicode typed listings keep their names and reject malformed entries', async () => {
	for(const entries of [[], ['.', '..'], [{name: '.', isFolder: true}, {name: '..', isFolder: true}]])
	{
		const {files, calls} = activate(() => entries);
		assert.deepEqual(structuredClone(await files.readDirectory({path: '/'})), []);
		assert.equal(calls.length, 1);
	}
	const {files} = activate(() => [{name: '目录', isFolder: true}, {name: 'café.php', isFolder: false}]);
	assert.deepEqual(structuredClone(await files.readDirectory({path: '/'})), [['目录', 2], ['café.php', 1]]);
	for(const entries of [undefined, null, {}, [null], [{name: 'missing-type'}], [{name: 42, isFolder: false}]])
	{
		const {files, calls} = activate(() => entries);
		await assert.rejects(files.readDirectory({path: '/'}), /Invalid directory/);
		assert.equal(calls.length, 1);
	}
});

test('filesystem failures propagate without retrying as a capability fallback', async () => {
	const failure = new Error('permission denied');
	const {files, calls} = activate(() => { throw failure; });
	await assert.rejects(files.readDirectory({path: '/private'}), error => error === failure);
	assert.equal(calls.length, 1);
	const missing = activate(action => action === 'readdir' ? ['removed.php'] : {exists: false});
	await assert.rejects(missing.files.readDirectory({path: '/persist'}), {code: 'FileNotFound'});
	const metadata = activate(action => {
		if(action === 'readdir') return ['blocked'];
		throw failure;
	});
	await assert.rejects(metadata.files.readDirectory({path: '/persist'}), error => error === failure);
});

for(const typed of [true, false])
{
	test(`recursive search uses ${typed ? 'typed' : 'legacy'} entries and still excludes proc`, async () => {
		const tree = {
			'/': [{name: 'proc', isFolder: true}, {name: 'persist', isFolder: true}, {name: 'root.php', isFolder: false}]
			, '/persist': [{name: 'folder', isFolder: true}, {name: 'café.php', isFolder: false}]
			, '/persist/folder': [{name: 'nested.php', isFolder: false}]
		};
		const {search, calls} = activate((action, path) => {
			if(action === 'analyzePath') return {exists: true, object: {isFolder: !path.endsWith('.php')}};
			assert.ok(tree[path], `Unexpected search directory ${path}`);
			const entries = [{name: '.', isFolder: true}, {name: '..', isFolder: true}, ...tree[path]];
			return typed ? entries : entries.map(entry => entry.name);
		});
		assert.deepEqual(structuredClone(await search.provideFileSearchResults({pattern: '*.php'})), [
			{path: '/persist/folder/nested.php'}
			, {path: '/persist/café.php'}
			, {path: '/root.php'}
		]);
		assert.deepEqual(calls.filter(([action]) => action === 'readdir'), [
			['readdir', '/', {withFileTypes: true}]
			, ['readdir', '/persist', {withFileTypes: true}]
			, ['readdir', '/persist/folder', {withFileTypes: true}]
		]);
		assert.equal(calls.filter(([action]) => action === 'analyzePath').length, typed ? 0 : 6);
	});
}

test('directory reads are fresh and change events wait for host persistence', async () => {
	let finishWrite;
	const persisted = new Promise(accept => finishWrite = accept);
	let entries = [];
	const {files, changes} = activate(async action => {
		if(action === 'analyzePath') return {exists: false};
		if(action === 'readdir') return entries;
		if(action === 'writeFile')
		{
			await persisted;
			entries = [{name: 'new.php', isFolder: false}];
		}
	});
	assert.deepEqual(structuredClone(await files.readDirectory({path: '/persist'})), []);
	const write = files.writeFile({path: '/persist/new.php'}, new Uint8Array([65]), {create: true});
	await new Promise(accept => setImmediate(accept));
	assert.deepEqual(changes, []);
	finishWrite();
	await write;
	assert.equal(changes.length, 1);
	assert.deepEqual(structuredClone(await files.readDirectory({path: '/persist'})), [['new.php', 1]]);
});
