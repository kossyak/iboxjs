/**
 * ibox - Безопасная обертка над MessageChannel для связи Host <-> Iframe
 * Поддерживает: Promise (call/response), Events (emit/on), Timeouts, Security Origin
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) { define([], factory); }
    else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.ibox = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MSG_READY = 'IBOX_READY';
    const MSG_PORT = 'IBOX_PORT';
    const DEFAULT_TIMEOUT = 10000;
    const MAX_PENDING_CALLS = 1000;

    function validateEvent(event) {
        if (typeof event !== 'string' || !event.trim()) {
            throw new Error('ibox: Event name must be a non-empty string');
        }
        return event.trim();
    }

    function createInterface(port, initialHandlers = new Map()) {
        const handlers = initialHandlers;
        const pendingCalls = new Map();
        let callId = 0;
        let isDestroyed = false;

        port.onmessage = async (e) => {
            if (isDestroyed || !e.data) return;
            const { event, data, _ibox_id, _ibox_res_id, _ibox_error } = e.data;

            // 1. Обработка ответа на наш вызов (call)
            if (_ibox_res_id && pendingCalls.has(_ibox_res_id)) {
                const { resolve, reject } = pendingCalls.get(_ibox_res_id);
                pendingCalls.delete(_ibox_res_id);
                if (_ibox_error) reject(new Error(_ibox_error));
                else resolve(data);
                return;
            }

            // 2. Обработка входящего события
            if (event && handlers.has(event)) {
                const callbacks = handlers.get(event);

                if (_ibox_id) {
                    // Режим CALL: берем первый обработчик и отправляем ответ
                    const [firstHandler] = callbacks;
                    if (!firstHandler) return;
                    try {
                        const result = await firstHandler(data);
                        port.postMessage({ _ibox_res_id: _ibox_id, data: result });
                    } catch (err) {
                        port.postMessage({ _ibox_res_id: _ibox_id, _ibox_error: err.message });
                    }
                } else {
                    // Режим EMIT: уведомляем всех подписчиков
                    for (const cb of callbacks) {
                        try { cb(data); } catch (err) { console.error(`ibox: Handler error [${event}]:`, err); }
                    }
                }
            }
        };

        const api = {
            emit: (event, data) => {
                if (isDestroyed) throw new Error('ibox: Instance destroyed');
                validateEvent(event);
                port.postMessage({ event, data });
            },

            call: (event, data, timeout = DEFAULT_TIMEOUT) => {
                if (isDestroyed) return Promise.reject(new Error('ibox: Instance destroyed'));
                if (pendingCalls.size >= MAX_PENDING_CALLS) return Promise.reject(new Error('ibox: Busy'));

                validateEvent(event);
                const id = ++callId;

                return new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        if (pendingCalls.delete(id)) {
                            reject(new Error(`ibox: Timeout [${event}] after ${timeout}ms`));
                        }
                    }, timeout);

                    pendingCalls.set(id, {
                        resolve: (res) => { clearTimeout(timer); resolve(res); },
                        reject: (err) => { clearTimeout(timer); reject(err); }
                    });

                    try {
                        port.postMessage({ event, data, _ibox_id: id });
                    } catch (err) {
                        pendingCalls.delete(id);
                        clearTimeout(timer);
                        reject(new Error('ibox: Send failed'));
                    }
                });
            },

            on: (event, cb) => {
                validateEvent(event);
                if (typeof cb !== 'function') throw new Error('ibox: Handler must be a function');
                if (!handlers.has(event)) handlers.set(event, new Set());
                handlers.get(event).add(cb);

                // Возвращаем функцию отписки (unsub)
                return () => api.off(event, cb);
            },

            off: (event, cb) => {
                if (handlers.has(event)) {
                    handlers.get(event).delete(cb);
                    if (handlers.get(event).size === 0) handlers.delete(event);
                }
            },

            destroy: () => {
                if (isDestroyed) return;
                isDestroyed = true;
                port.close();
                pendingCalls.forEach(p => p.reject(new Error('ibox: Connection destroyed')));
                pendingCalls.clear();
                handlers.clear();
            }
        };

        return api;
    }

    return {
        host: function (iframe, targetOrigin) {
            if (!targetOrigin || targetOrigin === '*') console.warn('ibox: Insecure "*" origin');

            return new Promise((resolve, reject) => {
                if (!iframe?.contentWindow) return reject(new Error('ibox: No iframe'));

                const channel = new MessageChannel();
                const port1 = channel.port1;

                const cleanup = () => {
                    clearTimeout(timer);
                    window.removeEventListener('message', init);
                };

                const timer = setTimeout(() => {
                    cleanup();
                    reject(new Error('ibox: Host connection timeout'));
                }, 15000);

                function init(e) {
                    if (targetOrigin !== '*' && e.origin !== targetOrigin) return;
                    if (e.data !== MSG_READY) return;
                    cleanup();
                    try {
                        iframe.contentWindow.postMessage(MSG_PORT, targetOrigin, [channel.port2]);
                        port1.start();
                        resolve(createInterface(port1));
                    } catch (err) { reject(err); }
                }

                window.addEventListener('message', init);
            });
        },

        client: function (hostOrigin) {
            if (!hostOrigin || hostOrigin === '*') console.warn('ibox: Insecure "*" origin');

            return new Promise((resolve, reject) => {
                let attempts = 0;

                const cleanup = () => {
                    clearInterval(handshakeInterval);
                    clearTimeout(timer);
                    window.removeEventListener('message', getPort);
                };

                const timer = setTimeout(() => {
                    cleanup();
                    reject(new Error('ibox: Client connection timeout'));
                }, 15000);

                const handshakeInterval = setInterval(() => {
                    if (++attempts > 60) { // ~12 секунд
                        cleanup();
                        reject(new Error('ibox: Handshake failed'));
                        return;
                    }
                    try { window.parent.postMessage(MSG_READY, hostOrigin); } catch (e) {}
                }, 200);

                function getPort(e) {
                    if (hostOrigin !== '*' && e.origin !== hostOrigin) return;
                    if (e.data !== MSG_PORT || !e.ports || !e.ports[0]) return;

                    cleanup();
                    const port = e.ports[0];
                    port.start();
                    resolve(createInterface(port));
                }

                window.addEventListener('message', getPort);
            });
        }
    };
}));
