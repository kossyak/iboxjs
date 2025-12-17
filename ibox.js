(function (root, factory) {
    if (typeof define === 'function' && define.amd) { define([], factory); }
    else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.ibox = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    return {
        host: function (iframeElement, targetOrigin) {
            targetOrigin = targetOrigin || '*';
            const channel = new MessageChannel();
            const port = channel.port1;
            const handlers = new Map();
            const pendingCalls = new Map();
            let callId = 0;

            const init = (e) => {
                if (targetOrigin !== '*' && e.origin !== targetOrigin) return;
                if (e.data !== 'IBOX_READY') return;
                if (iframeElement && iframeElement.contentWindow) {
                    iframeElement.contentWindow.postMessage('IBOX_PORT', targetOrigin, [channel.port2]);
                    window.removeEventListener('message', init);
                    port.start();
                }
            };

            window.addEventListener('message', init);

            const messageListener = async (e) => {
                if (!e.data) return;


                if (e.data._ibox_res_id && pendingCalls.has(e.data._ibox_res_id)) {
                    const resolve = pendingCalls.get(e.data._ibox_res_id);
                    resolve(e.data.data);
                    pendingCalls.delete(e.data._ibox_res_id);
                    return;
                }


                if (e.data.event && handlers.has(e.data.event)) {
                    for (const cb of handlers.get(e.data.event)) {
                        const result = await cb(e.data.data);
                        if (e.data._ibox_id) {
                            port.postMessage({ _ibox_res_id: e.data._ibox_id, data: result });
                        }
                    }
                }
            };

            port.onmessage = messageListener;

            return {
                emit: function (event, data) {
                    port.postMessage({ event, data });
                },
                call: function (event, data, timeout = 5000) {
                    const id = ++callId;
                    return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {
                            pendingCalls.delete(id);
                            reject(new Error(`ibox: Timeout for event "${event}"`));
                        }, timeout);
                        pendingCalls.set(id, (res) => {
                            clearTimeout(timer);
                            resolve(res);
                        });
                        port.postMessage({ event, data, _ibox_id: id });
                    });
                },
                on: function (event, callback) {
                    if (!handlers.has(event)) handlers.set(event, []);
                    handlers.get(event).push(callback);
                },
                destroy: function () {
                    port.close();
                    window.removeEventListener('message', init);
                    handlers.clear();
                    pendingCalls.clear();
                }
            };
        },

        client: function (hostOrigin) {
            hostOrigin = hostOrigin || '*';
            return new Promise((resolve, reject) => {
                let handshakeInterval;
                let attempts = 0;
                const MAX_ATTEMPTS = 50;
                const handlers = new Map();
                const pendingCalls = new Map();
                let callId = 0;

                const getPort = (e) => {
                    if (hostOrigin !== '*' && e.origin !== hostOrigin) return;
                    if (e.data !== 'IBOX_PORT' || !e.ports || !e.ports[0]) return;

                    clearInterval(handshakeInterval);
                    window.removeEventListener('message', getPort);

                    const port = e.ports[0];

                    const messageListener = async (eventEvt) => {
                        const data = eventEvt.data;
                        if (!data) return;

                        if (data._ibox_res_id && pendingCalls.has(data._ibox_res_id)) {
                            const resCb = pendingCalls.get(data._ibox_res_id);
                            resCb(data.data);
                            pendingCalls.delete(data._ibox_res_id);
                            return;
                        }

                        if (data.event && handlers.has(data.event)) {
                            for (const cb of handlers.get(data.event)) {
                                const result = await cb(data.data);
                                if (data._ibox_id) {
                                    port.postMessage({ _ibox_res_id: data._ibox_id, data: result });
                                }
                            }
                        }
                    };

                    port.onmessage = messageListener;

                    resolve({
                        emit: function (event, data) {
                            port.postMessage({ event, data });
                        },
                        call: function (event, data, timeout = 5000) {
                            const id = ++callId;
                            return new Promise((res, rej) => {
                                const t = setTimeout(() => {
                                    pendingCalls.delete(id);
                                    rej(new Error(`ibox: Timeout for event "${event}"`));
                                }, timeout);
                                pendingCalls.set(id, (result) => {
                                    clearTimeout(t);
                                    res(result);
                                });
                                port.postMessage({ event, data, _ibox_id: id });
                            });
                        },
                        on: function (event, callback) {
                            if (!handlers.has(event)) handlers.set(event, []);
                            handlers.get(event).push(callback);
                        },
                        destroy: function () {
                            port.close();
                            handlers.clear();
                            pendingCalls.clear();
                        }
                    });
                };

                window.addEventListener('message', getPort);
                handshakeInterval = setInterval(() => {
                    attempts++;
                    if (attempts > MAX_ATTEMPTS) {
                        clearInterval(handshakeInterval);
                        window.removeEventListener('message', getPort);
                        reject(new Error('ibox: Connection timeout'));
                        return;
                    }
                    window.parent.postMessage('IBOX_READY', hostOrigin);
                }, 100);
            });
        }
    };
}));


