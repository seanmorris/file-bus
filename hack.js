config => {
    const incomplete = new Map;
    const originSymbol = Symbol('origin');
    const recipientSymbol = Symbol('recipient');

    const onMessage = event => {
        if(event.data.re && incomplete.has(event.data.re))
        {
            const callbacks = incomplete.get(event.data.re);

            if(!event.data.error)
            {
                callbacks[0](event.data.result);
            }
            else
            {
                callbacks[1](event.data.error);
            }
        }
    };

    const sendMessage = (client, action, params, accept, reject) => {
        const token  = crypto.randomUUID();
        const result = new Promise((_accept, _reject) => [accept, reject] = [_accept, _reject]);

        // console.log(action, params);

        incomplete.set(token, [accept, reject]);

        let recipient = client[recipientSymbol];

        if(!(recipient instanceof Promise))
        {
            recipient = Promise.resolve(recipient);
        }

        recipient.then(recipient => recipient.postMessage({action, params, token}, client[originSymbol]));

        return result;
    };

    class Client
    {
        constructor(recipient, origin)
        {
            this[originSymbol] = origin;
            this[recipientSymbol] = recipient;

            return new Proxy(this, {
                    get: (target, key, receiver) => {

                    if(typeof key === 'symbol')
                    {
                        return target[key];
                    }

                    return (...params)  => sendMessage(receiver, key, params);
                }
            });
        }
    }

    class Server
    {	
        constructor(handler, origin)
        {
            this.handler = handler;
            this.origin = origin;
        }

        async handleMessageEvent(event)
        {
            const { data, source } = event;
            const { action, token, params = [] } = data;
        
            if(action in this.handler)
            {
                let result, error;
                
                try
                {
                    result = await this.handler[action](...params);
                }
                catch(_error)
                {
                    error = JSON.parse(JSON.stringify(_error));
                    console.error(_error);
                }
                finally
                {
                    if(this.origin)
                    {
                        source.postMessage({re: token, result, error}, this.origin);
                    }
                    else
                    {
                        source.postMessage({re: token, result, error});
                    }
                }
            }
        }
    }

    const searchParams = new URLSearchParams(location.search);
    const callbackOrigin = searchParams.get('origin');

    const client = new Client(window.parent ?? window.opener, callbackOrigin);
    const server = new Server({
        openFile: (path) => {
            window.vscodeEditor.env.openUri('busfs://' + path);
        },
        executeCommand: (command, ...args) => {
            if(!window.vscodeEditor)
            {
                return;
            }
            window.vscodeEditor.commands.executeCommand(command, ...args);
        },
    }, callbackOrigin);

    window.addEventListener('message', onMessage);
    window.addEventListener('message', event => server.handleMessageEvent(event));

    config.commands.push(
        {
            id: "fileBus.call",
            handler: (method, ...args) => client[method](...args)
        }
    );
}
