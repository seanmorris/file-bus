import { Client, Server } from 'quickbus';

const fileBusHack = config => {
    const searchParams = new URLSearchParams(location.search);
    const callbackOrigin = searchParams.get('origin');

    const client = Client.forWindow(window.parent ?? window.opener, callbackOrigin);
    const server = new Server({
        openFile: (path, options = {}) => {
            if(!window.vscodeEditor)
            {
                return;
            }

            return window.vscodeEditor.commands.executeCommand(
                'fileBus.openFile'
                , 'busfs://' + path
                , options
            );
        },
        configure: options => {
            if(!window.vscodeEditor)
            {
                return;
            }

            return window.vscodeEditor.commands.executeCommand('fileBus.configure', options);
        },
        executeCommand: (command, ...args) => {
            if(!window.vscodeEditor)
            {
                return;
            }

            window.vscodeEditor.commands.executeCommand(command, ...args);
        },
    }, callbackOrigin);

    window.addEventListener('message', event => server.handleMessageEvent(event));

    config.commands.push({
        id: "fileBus.call",
        handler: (method, ...args) => client[method](...args)
    });
};

export default fileBusHack;
