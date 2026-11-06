const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

for (const target of ['web-desktop', 'web-mobile']) {
  test(`${target} separates branded boot, operations lobby, and combat`, () => {
    const base = `SpaceFight-Cocos/build-templates/${target}`;
    const html = read(`${base}/index.ejs`);
    const shell = read(`${base}/spacefight-shell.js`);
    const css = read(`${base}/spacefight-shell.css`);

    assert.match(html, /id="BootSequence"/);
    assert.match(html, /id="LaunchGate"/);
    assert.match(html, /id="MissionBoard"/);
    assert.equal((html.match(/data-mission-preset=/g) || []).length, 3);
    assert.match(html, /id="HubLoadoutOpen"/);
    assert.match(shell, /spacefight:mission-change/);
    assert.match(shell, /dataset\.missionPreset/);
    assert.match(css, /#BootSequence\[aria-hidden="true"\]/);
    assert.match(css, /@media \(max-width: 700px\) and \(orientation: landscape\)/);
  });
}

test('Cocos native runtime opens a local home panel before flight', () => {
  const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  assert.match(hud, /NativeHomePanel/);
  assert.match(hud, /\['salvage',\s*'home\.salvage'/);
  assert.match(hud, /\['assault',\s*'home\.assault'/);
  assert.match(hud, /\['hunt',\s*'home\.hunt'/);
  assert.match(hud, /blocksFlightInput\(\)[\s\S]*homeOpen/);
  assert.match(bootstrap, /MISSION_PRESETS/);
  assert.match(bootstrap, /nativeHud\?\.showPreflight\(\)/);
});
