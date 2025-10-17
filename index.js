'use strict';
import * as vscode from 'vscode';

class Entry
{
	constructor(name)
	{
		this.type  = vscode.FileType.Unknown;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.name  = name;
	}
}

class File extends Entry
{
	constructor(name, data = new Uint8Array([]))
	{
		super(name);
		this.size = data.length;
		this.type = vscode.FileType.File;
		this.data = data;
	}
}

class Directory extends Entry
{
	constructor(name)
	{
		super(name);
		this.size = 0;
		this.type = vscode.FileType.Directory;
		this.entries = new Map();
	}
}

const getFiles = async (path) => {
	if(path === '/proc')
	{
		return [];
	}

	const names = await vscode.commands.executeCommand('fileBus.call', 'readdir', path);

	return (await Promise.all(
		names
		.filter(name => !(['.','..'].includes(name)))
		.map(async name => {
			const p = path + (path[path.length - 1] === '/' ? '' : '/');
			const filepath = p + name;
			const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', filepath);
			if(about.object.isFolder)
			{
				return getFiles(filepath);
			}
			else
			{
				return filepath;
			}
		})
	)).flat();
};

const convertSimple2RegExpPattern = pattern => pattern
	.replace(/[\-\\\{\}\+\?\|\^\$\.\,\[\]\(\)\#\s]/g, '\\$&')
	.replace(/[\*]/g, '.*');

class FileBus
{
	emitter = new vscode.EventEmitter;

	onDidChangeFile = this.emitter.event;

	files = new Map;

	async stat({mid, path})
	{
		if(path === '/')
		{
			return new Directory(path);
		}

		const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', path);

		if(!about.exists)
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		if(about.object.isFolder)
		{
			return new Directory(path);
		}

		return new File(path);
	}

	async readFile({path})
	{
		const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', path);

		if(!about.exists)
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		const content = new Uint8Array(await vscode.commands.executeCommand('fileBus.call', 'readFile', path));

		return content;
	}

	async writeFile({path, scheme}, content, {create, overwrite, unlock, atomic})
	{
		const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', path);

		if(about.exists && about.object.isFolder)
		{
			throw vscode.FileSystemError.FileIsADirectory(path);
		}

		await vscode.commands.executeCommand('fileBus.call', 'writeFile', path, Array.from(content));
	}

	async readDirectory({path})
	{
		const names = await vscode.commands.executeCommand('fileBus.call', 'readdir', path);

		return await Promise.all(
			names.filter(name => !(['.','..'].includes(name)))
			.map(async name => {
				const p = path + (path[path.length - 1] === '/' ? '' : '/');
				const filepath = p + name;
				const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', filepath);
				return [name, about.object.isFolder ? vscode.FileType.Directory : vscode.FileType.File];
			})
		);
	}

	async rename({path: fromPath, scheme: fromScheme}, {path: toPath, scheme: toScheme}, {overwrite})
	{
		const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', fromPath);

		if(!about.exists)
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		await vscode.commands.executeCommand('fileBus.call', 'rename', fromPath, toPath);
	}

	async delete({path}, {recursive, useTrash, atomic})
	{
		const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', path);

		if(!about.exists)
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		if(about.object.isFolder)
		{
			await vscode.commands.executeCommand('fileBus.call', 'rmdir', path);
		}
		else
		{
			await vscode.commands.executeCommand('fileBus.call', 'unlink', path);
		}
	}

	async createDirectory({path})
	{
		const about = await vscode.commands.executeCommand('fileBus.call', 'analyzePath', path);

		if(about.exists)
		{
			throw vscode.FileSystemError.FileExists(path);
		}

		await vscode.commands.executeCommand('fileBus.call', 'mkdir', path);
	}

	watch({mid, external, path ,scheme}, {recursive, exclude})
	{
		return new vscode.Disposable(() => {});
	}

	async provideFileSearchResults(query, options, token)
	{
		const filepaths = await getFiles('/');

		const results = [];

		const pattern = query.pattern
			? new RegExp(convertSimple2RegExpPattern(query.pattern), "i")
			: null;

		for (const path of filepaths)
		{
			if(!pattern || pattern.exec(path))
			{
				results.push({path});
			}
		}

		return results;
	}
}

export function activate(context)
{
	const fileBus = new FileBus;

	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider('busfs', fileBus, {isCaseSensitive: true}),
		vscode.workspace.registerFileSearchProvider('busfs', fileBus),
	);

	vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse('busfs:/'), name: "BusFS" });

	let terminal;

	const writeEmitter = new vscode.EventEmitter();
	const lineBuffer   = [];

	const printBuffer = () => {
		lineBuffer.forEach(line => writeEmitter.fire(line + '\r\n'));
		lineBuffer.length = 0;
	}

	const pty = {
		onDidWrite:  writeEmitter.event,
		handleInput: () => void 0, // NOOP
		open:        printBuffer,
		close:       () => terminal = null, // NOOP
	};

	vscode.commands.registerCommand('fileBus.console', line => {
		lineBuffer.push(line);

		if(!terminal)
		{
			terminal = vscode.window.createTerminal({name: "FileBus Console", pty, isTransient: true});
		}
		else
		{
			printBuffer()
		}

		terminal.show();
	});

	// vscode.commands.executeCommand('fileBus.console', 'Initialize!');
	vscode.commands.executeCommand('fileBus.call', 'activate');
}
