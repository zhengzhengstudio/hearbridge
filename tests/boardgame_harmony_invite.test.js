const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'HarmonyOS-App');
const projects = ['ZhengZhengBoardGamesHarmony', 'ZhengZhengBoardGamesHarmonyOffline'];

test('Harmony invite models share versioned continue/challenge tokens with web', () => {
  for (const project of projects) {
    const source = fs.readFileSync(path.join(root, project, 'entry/src/main/ets/model/RoomInvite.ets'), 'utf8');
    assert.match(source, /version:\s*number/);
    assert.match(source, /purpose:\s*string/);
    assert.match(source, /[?&]v=\$\{invite\.version\}/);
    assert.match(source, /purpose=\$\{encodeURIComponent\(invite\.purpose\)\}/);
    assert.match(source, /safeToken\.length === 0\) return null/);
  }
});
