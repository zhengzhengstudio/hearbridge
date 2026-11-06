const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'website', 'zhengzhengstudio.cn', 'boardgames');

test('game More panel exposes a boardgame-only scan handoff', () => {
  const source = fs.readFileSync(path.join(root, 'boardgame-enhance.js'), 'utf8');
  assert.match(source, /data-zz-scan-invite/);
  assert.match(source, /BarcodeDetector/);
  assert.match(source, /validateInvite/);
  assert.match(source, /purpose/);
  assert.match(source, /continue|challenge/);
});

test('scanner has camera cleanup, paste fallback and responsive styling', () => {
  const script = fs.readFileSync(path.join(root, 'boardgame-enhance.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'boardgame-common.css'), 'utf8');
  assert.match(script, /getTracks\(\).*stop/);
  assert.match(script, /data-zz-invite-value/);
  assert.match(css, /zz-invite-scanner/);
  assert.match(css, /prefers-color-scheme:\s*light/);
});
