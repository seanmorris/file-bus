# file-bus

`file-bus` is a VS Code extension that bridges browser-hosted VS Code file system operations to an outer page over `postMessage`.

It is intended for setups such as `vscode-web-static`, where VS Code runs in the browser and an embedding page provides file system behavior through an RPC bridge.

## What It Does

The extension registers a `busfs:` file system provider and forwards file operations through the `fileBus.call` command. The browser-side hack script exposes two directions of communication:

- VS Code -> host page for file system operations like `readFile`, `writeFile`, `mkdir`, and `readdir`
- host page -> VS Code for commands like `openFile` and `executeCommand`

## Architecture

There are two runtime pieces:

- [index.js](./index.js)
  The VS Code extension entrypoint. This registers the `busfs:` provider and issues `fileBus.call` commands for file operations.
- [hack.js](./hack.js)
  The browser-side injected hack that wires the page and the embedded VS Code instance together using `quickbus`.

The hack is generated from:

- [hack-source.js](./hack-source.js)
  Source-of-truth module that imports `Client` and `Server` from `quickbus`
- [build-hack.mjs](./build-hack.mjs)
  Bundles `hack-source.js` into the single shipped `hack.js` artifact

## Why `hack.js` Is Bundled

`vscode-web-static` copies extension directories directly into `public/extensions/`. That means `file-bus` needs browser-ready extension artifacts, but it does not need to be merged into one application-wide bundle.

The important packaging constraint is:

- keep `dist/index.js` as the extension browser entrypoint
- keep `hack.js` as a single self-contained injected script

The generated `hack.js` is intentionally checked in as a build artifact because the extension loader expects a concrete top-level hack file.

## Build

Install dependencies and build both artifacts:

```bash
npm install
npm run compile
```

That produces:

- `dist/index.js` via Babel from `index.js`
- `hack.js` via esbuild from `hack-source.js`

## Dependencies

The browser messaging layer is powered by:

- [`quickbus`](https://www.npmjs.com/package/quickbus) `^1.0.0`

The current build uses `quickbus` as a real dependency and bundles the browser hack from source rather than maintaining a hand-copied embedded transport implementation.

## Packaging Notes

Relevant fields in [package.json](./package.json):

- `"browser": "dist/index"`
- `"main": "dist/index"`
- `"hacks": ["hack.js"]`

Those are the pieces that `vscode-web-static` relies on when it copies the extension directory into its browser extension set.

## Relationship To Host Apps

This extension does not provide storage itself. It expects a host page to implement the outer side of the RPC bridge. A consumer such as `vscode-react` can provide the file system callbacks and command bridge on the embedding page side.

## Consumer Example

At a high level, the embedding page needs to do two things:

- host a `quickbus` server that implements the file system callbacks consumed by `file-bus`
- host a `quickbus` client pointed at the embedded VS Code window so it can send commands like `openFile`

Example:

```js
import { Client, Server } from 'quickbus';

const iframe = document.querySelector('iframe');
const innerOrigin = new URL(iframe.src, window.location.href).origin;

const fileSystemServer = new Server({
  readdir(path) {
    return ['example.txt'];
  },
  async readFile(path) {
    return Array.from(new TextEncoder().encode('hello from host'));
  },
  analyzePath(path) {
    return {
      exists: true,
      object: {
        isFolder: false
      }
    };
  },
  writeFile(path, bytes) {
    console.log('writeFile', path, bytes);
  },
  rename(fromPath, toPath) {
    console.log('rename', fromPath, toPath);
  },
  mkdir(path) {
    console.log('mkdir', path);
  },
  unlink(path) {
    console.log('unlink', path);
  },
  rmdir(path) {
    console.log('rmdir', path);
  },
  activate() {
    console.log('file-bus ready');
  }
}, innerOrigin);

window.addEventListener('message', event => {
  fileSystemServer.handleMessageEvent(event);
});

const editorClient = Client.forIframe(iframe, innerOrigin);

await editorClient.openFile('/example.txt');
await editorClient.executeCommand('workbench.action.quickOpen');
```

The important part is the shape of the file system methods. `file-bus` expects to call:

- `readdir(path) -> string[]`
- `readFile(path) -> Promise<number[]> | number[]`
- `analyzePath(path) -> { exists: boolean, object?: { isFolder?: boolean } }`
- `writeFile(path, bytes) -> void`
- `rename(fromPath, toPath) -> void`
- `mkdir(path) -> void`
- `unlink(path) -> void`
- `rmdir(path) -> void`
- `activate() -> void`

## License

Apache-2.0
