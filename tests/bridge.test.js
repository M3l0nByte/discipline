'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const CONTENT_JS = path.join(__dirname, '..', 'extension', 'content.js');

// Runs content.js against a fake window + runtime and returns the harness so we
// can drive the same message flow the real website uses.
function harness() {
  const posted = [];
  const listeners = [];
  const sent = [];

  const window = {
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    postMessage(msg) { posted.push(msg); },
  };

  const runtime = {
    sendMessage(msg) {
      sent.push(msg);
      return Promise.resolve({ ok: true, echo: msg.action });
    },
    onMessage: { addListener() {} },
  };

  const sandbox = { window, chrome: { runtime }, setTimeout, Promise, Set };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CONTENT_JS, 'utf8'), sandbox);

  const deliver = (data, source = window) => listeners.forEach((fn) => fn({ source, data }));

  return { posted, sent, deliver, window };
}

test('the page is answered when it says hello', async () => {
  const h = harness();
  h.deliver({ source: 'discipline-page', type: 'hello' });
  await Promise.resolve();
  assert.strictEqual(h.posted[0].source, 'discipline-ext');
  assert.strictEqual(h.posted[0].type, 'hello-ack');
});

test('a page request is forwarded to the background worker', async () => {
  const h = harness();
  h.deliver({ source: 'discipline-page', type: 'request', id: 'r1', action: 'checkin' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.sent[0].type, 'bridge');
  assert.strictEqual(h.sent[0].action, 'checkin');
});

test('the worker answer is posted back with the request id', async () => {
  const h = harness();
  h.deliver({ source: 'discipline-page', type: 'request', id: 'r7', action: 'summary' });
  await new Promise((r) => setImmediate(r));
  const reply = h.posted.find((m) => m.type === 'response');
  assert.strictEqual(reply.id, 'r7');
  assert.strictEqual(reply.result.ok, true);
});

test('actions outside the allowlist are refused, never forwarded', async () => {
  const h = harness();
  h.deliver({ source: 'discipline-page', type: 'request', id: 'r2', action: 'deleteEverything' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.sent.length, 0, 'a blocked action must not reach the worker');
  const reply = h.posted.find((m) => m.type === 'response');
  assert.strictEqual(reply.result.ok, false);
});

test('messages from other frames are ignored', async () => {
  const h = harness();
  // A different window on the page: not the one we listen to.
  h.deliver({ source: 'discipline-page', type: 'request', id: 'r3', action: 'checkin' }, {});
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.sent.length, 0);
});

test('messages not tagged for us are ignored', async () => {
  const h = harness();
  h.deliver({ source: 'some-other-app', type: 'request', id: 'r4', action: 'checkin' });
  assert.strictEqual(h.sent.length, 0);
});
