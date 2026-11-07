'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bl = require('../public/lib/blocklist');

const list = bl.DEFAULT_BLOCKLIST;
const paths = bl.DEFAULT_PATH_RULES;

function blocked(url) {
  return bl.isBlocked(url, list, paths);
}

test('blocks known adult domains and their subdomains', () => {
  assert.strictEqual(blocked('https://www.pornhub.com/view'), true);
  assert.strictEqual(blocked('https://xhamster.com'), true);
  assert.strictEqual(blocked('https://sub.xhamster.com/videos'), true);
  assert.strictEqual(blocked('https://onlyfans.com/user123'), true);
});

test('leaves normal sites alone', () => {
  assert.strictEqual(blocked('https://youtube.com/watch'), false);
  assert.strictEqual(blocked('https://github.com'), false);
  assert.strictEqual(blocked('https://example.com'), false);
  assert.strictEqual(blocked('https://reddit.com/'), false);
});

test('path rules only block the risky corner', () => {
  assert.strictEqual(blocked('https://reddit.com/r/nsfw'), true);
  assert.strictEqual(blocked('https://reddit.com/r/nsfw/comments/x'), true);
  assert.strictEqual(blocked('https://reddit.com/r/aww'), false);
  assert.strictEqual(blocked('https://x.com/search?q=a'), true);
  assert.strictEqual(blocked('https://x.com/home'), false);
});

test('wildcard rules block subdomains but not the bare domain', () => {
  assert.strictEqual(bl.matchesBlock('a.example.com', '*.example.com'), true);
  assert.strictEqual(bl.matchesBlock('example.com', '*.example.com'), false);
});

test('rejects junk input safely', () => {
  assert.strictEqual(blocked('not a url'), false);
  assert.strictEqual(blocked(''), false);
  assert.strictEqual(bl.normalizeDomain('HTTPS://WWW.Foo.com/path'), 'foo.com');
});
