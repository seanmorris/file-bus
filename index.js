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
		this.size = 0;
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

class FileBus
{
	emitter = new vscode.EventEmitter;

	onDidChangeFile = this.emitter.event;

	files = new Map;

	stat({mid, path})
	{
		if(path === '/')
		{
			return new Directory(path);
		}

		if(!this.files.has(path))
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		return this.files.get(path);
	}

	readFile({path})
	{
		if(!this.files.has(path))
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		return this.files.get(path).data;
	}

	writeFile({path, scheme}, content, {create, overwrite, unlock, atomic})
	{
		if(this.files.has(path))
		{
			const file = this.files.get(path);

			if(file.type === vscode.FileType.Directory)
			{
				throw vscode.FileSystemError.FileIsADirectory(path);
			}

			file.data = content;
		}

		this.files.set(path, new File(path, content));
	}

	readDirectory({path})
	{
		const entries = [];

		if(path === '/')
		{
			for(let i = 0; i < 10; i++)
			{
				this.files.set(`/File_${i}.txt`, new File(`/File_${i}.txt`));

				entries.push([`busfs:/File_${i}.txt`, vscode.FileType.File]);
			}
		}
		else
		{
			throw vscode.FileSystemError.FileNotADirectory(path);
		}

		return entries;
	}

	rename({path: fromPath, scheme: fromScheme}, {path: toPath, scheme: toScheme}, {overwrite})
	{
		if(!this.files.has(fromPath))
		{
			throw vscode.FileSystemError.FileNotFound(fromPath);
		}

		if(this.files.has(toPath) && !overwrite)
		{
			throw vscode.FileSystemError.FileExists(toPath);
		}

		this.files.set(toPath, this.files.get(fromPath));
		this.files.delete(fromPath);
	}

	delete({path}, {recursive, useTrash, atomic})
	{
		if(!this.files.has(path))
		{
			throw vscode.FileSystemError.FileNotFound(path);
		}

		this.files.delete(path);
	}

	createDirectory({path})
	{
		if(this.files.has(path))
		{
			throw vscode.FileSystemError.FileExists(path);
		}

		this.files.set(path, new Directory(path));
	}

	watch({mid, external, path ,scheme}, {recursive, exclude})
	{
		// ignore, fires for all changes...
		return new vscode.Disposable(() => {});
	}
}

export function activate(context) {
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(
		'busfs', new FileBus, { isCaseSensitive: true }
	));

	vscode.workspace.updateWorkspaceFolders(
		0, 0, { uri: vscode.Uri.parse('busfs:/'), name: "BusFS - Sample" }
	);
}
