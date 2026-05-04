import { Client, Server } from 'quickbus';

let executeVSCodeCommandPromise;

const getExecuteVSCodeCommand = () => {
	if(executeVSCodeCommandPromise)
	{
		return executeVSCodeCommandPromise;
	}

	const getWindowCommandExecutor = async () => {
		if(window.vscodeEditor?.commands?.executeCommand)
		{
			return window.vscodeEditor.commands.executeCommand.bind(window.vscodeEditor.commands);
		}

		const vscodeEditor = await window.vscodeEditorReady;

		if(vscodeEditor?.commands?.executeCommand)
		{
			return vscodeEditor.commands.executeCommand.bind(vscodeEditor.commands);
		}

		throw new Error('The VS Code command bridge became ready without a commands API.');
	};

	executeVSCodeCommandPromise = new Promise((resolve, reject) => {
		const finishWithFallback = error => {
			getWindowCommandExecutor().then(resolve, fallbackError => reject(error || fallbackError));
		};

		if(typeof window.require !== 'function')
		{
			finishWithFallback();
			return;
		}

		try
		{
			window.require(
				['vs/workbench/browser/web.factory']
				, module => {
					const executeCommand = module?.commands?.executeCommand;

					if(typeof executeCommand === 'function')
					{
						resolve(executeCommand);
						return;
					}

					finishWithFallback();
				}
				, finishWithFallback
			);
		}
		catch(error)
		{
			finishWithFallback(error);
		}
	});

	return executeVSCodeCommandPromise;
};

const fileBusHack = config => {
    const searchParams = new URLSearchParams(location.search);
    const callbackOrigin = searchParams.get('origin');

    const client = Client.forWindow(window.parent ?? window.opener, callbackOrigin);
    const server = new Server({
        openFile: async (path, options = {}) => {
            const executeCommand = await getExecuteVSCodeCommand();

            return executeCommand(
                'fileBus.openFile'
                , 'busfs://' + path
                , options
            );
        },
        configure: async options => {
            const executeCommand = await getExecuteVSCodeCommand();

            return executeCommand('fileBus.configure', options);
        },
        executeCommand: async (command, ...args) => {
            const executeCommand = await getExecuteVSCodeCommand();

            return executeCommand(command, ...args);
        },
    }, callbackOrigin);

    window.addEventListener('message', event => server.handleMessageEvent(event));

    config.commands.push({
        id: "fileBus.call",
        handler: (method, ...args) => client[method](...args)
    });
};

export default fileBusHack;
