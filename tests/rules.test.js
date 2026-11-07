'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// rulebuilder.js attaches itself to a global, so give it a sandbox.
function loadRules() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'rulebuilder.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.DisciplineRules;
}

const R = loadRules();
const BLOCKED = 'chrome-extension://abc/blocked.html';

test('buildRules produces a redirect and a block rule per entry', () => {
  const rules = R.buildRules(['example.com'], BLOCKED);
  assert.strictEqual(rules.length, 2);

  const [redirect, block] = rules;
  assert.strictEqual(redirect.action.type, 'redirect');
  assert.ok(redirect.action.redirect.url.startsWith(BLOCKED));
  assert.ok(redirect.condition.resourceTypes.includes('main_frame'));

  assert.strictEqual(block.action.type, 'block');
  assert.ok(!block.condition.resourceTypes.includes('main_frame'));
});

test('rule ids are unique and start at one', () => {
  const rules = R.buildRules(['a.com', 'b.com', '*.c.com'], BLOCKED);
  const ids = rules.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(Math.min(...ids), 1);
  assert.strictEqual(rules.length, 6);
});

test('the redirect carries the offending domain', () => {
  const [redirect] = R.buildRules(['pornhub.com'], BLOCKED);
  assert.ok(redirect.action.redirect.url.endsWith('domain=pornhub.com'));
});

test('domain regex matches the domain and its subdomains only', () => {
  const { regexFilter } = R.patternFor('example.com');
  const re = new RegExp(regexFilter);
  assert.ok(re.test('https://example.com/'));
  assert.ok(re.test('https://www.example.com/x'));
  assert.ok(re.test('http://deep.sub.example.com:8080/p?q=1'));
  assert.ok(!re.test('https://example.com.evil.net/'));
  assert.ok(!re.test('https://notexample.com/'));
});

test('wildcard regex matches subdomains but not the bare domain', () => {
  const { regexFilter } = R.patternFor('*.example.com');
  const re = new RegExp(regexFilter);
  assert.ok(re.test('https://a.example.com/'));
  assert.ok(!re.test('https://example.com/'));
});

test('path rules stay scoped to the path', () => {
  const { regexFilter } = R.patternFor('reddit.com/r/gonewild');
  const re = new RegExp(regexFilter);
  assert.ok(re.test('https://reddit.com/r/gonewild'));
  assert.ok(re.test('https://www.reddit.com/r/gonewild/comments/x'));
  assert.ok(!re.test('https://reddit.com/r/aww'));
  assert.ok(!re.test('https://reddit.com/'));
});

test('regex special characters in domains are escaped', () => {
  const { regexFilter } = R.patternFor('a+b.com');
  const re = new RegExp(regexFilter);
  assert.ok(re.test('https://a+b.com/'));
  assert.ok(!re.test('https://aab.com/'));
});
