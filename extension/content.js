'use strict';

/* Bridge between the DISCIPLINE website and the extension.

   The page cannot talk to the extension directly, so it posts a message, this
   script forwards it to the background worker, and the answer comes back the
   same way. The page never gets access to extension APIs — only these actions. */

const api = typeof browser !== 'undefined' ? browser : chrome;

const ALLOWED_ACTIONS = new Set([
  'summary', 'checkin', 'relapse', 'urge',
  'blocklist', 'addBlock', 'removeBlock', 'settings', 'reset', 'import', 'sync',
]);

function send(action, payload) {
  return api.runtime.sendMessage({ type: 'bridge', action, payload });
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'discipline-page') return;

  if (msg.type === 'hello') {
    window.postMessage({ source: 'discipline-ext', type: 'hello-ack' }, '*');
    return;
  }

  if (msg.type === 'request') {
    if (!ALLOWED_ACTIONS.has(msg.action)) {
      window.postMessage({ source: 'discipline-ext', type: 'response', id: msg.id, result: { ok: false, error: 'blocked action' } }, '*');
      return;
    }
    send(msg.action, msg.payload)
      .then((result) => {
        window.postMessage({ source: 'discipline-ext', type: 'response', id: msg.id, result }, '*');
      })
      .catch((err) => {
        window.postMessage({ source: 'discipline-ext', type: 'response', id: msg.id, result: { ok: false, error: err.message } }, '*');
      });
  }
});

// Push live updates into an open dashboard when the state changes anywhere.
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'state-changed') {
    window.postMessage({ source: 'discipline-ext', type: 'state-changed', summary: msg.summary }, '*');
  }
  return undefined;
});
