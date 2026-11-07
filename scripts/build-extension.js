'use strict';

/* Builds the two browser packages into dist/.
   Shared code is copied in rather than duplicated in the repo, so the website
   and the extension can never drift apart. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const LIB = path.join(ROOT, 'public', 'lib');
const DIST = path.join(ROOT, 'dist');

const SHARED_FILES = [
  'background.js', 'rulebuilder.js', 'content.js',
  'popup.html', 'popup.css', 'popup.js',
  'options.html', 'options.css', 'options.js',
  'blocked.html', 'blocked.css', 'blocked.js',
];
const LIB_FILES = ['engine.js', 'blocklist.js', 'state.js'];
const ICON_DIR = 'icons';

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function buildTarget(name, manifestFile) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const file of SHARED_FILES) copyFile(path.join(SRC, file), path.join(out, file));
  for (const file of LIB_FILES) copyFile(path.join(LIB, file), path.join(out, 'lib', file));

  for (const icon of fs.readdirSync(path.join(SRC, ICON_DIR))) {
    copyFile(path.join(SRC, ICON_DIR, icon), path.join(out, ICON_DIR, icon));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, manifestFile), 'utf8'));
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return out;
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const chrome = buildTarget('chrome', 'manifest.chrome.json');
  const firefox = buildTarget('firefox', 'manifest.firefox.json');
  console.log(`Chrome build  -> ${path.relative(ROOT, chrome)}`);
  console.log(`Firefox build -> ${path.relative(ROOT, firefox)}`);
  console.log('Load chrome/ in chrome://extensions (Developer mode -> Load unpacked).');
  console.log('Load firefox/ in about:debugging -> This Firefox -> Load Temporary Add-on.');
}

main();
