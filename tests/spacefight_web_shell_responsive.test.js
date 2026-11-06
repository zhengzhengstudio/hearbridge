const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('web shell stays independent from native package update checks', () => {
  const shell = read('SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.js');
  const html = read('SpaceFight-Cocos/build-templates/web-desktop/index.ejs');
  assert.doesNotMatch(shell, /manifest\.json|checkUpdates|spacefight-android|spacefight-ios/);
  assert.match(html, /本机战斗核心/);
  assert.match(html, /BUILD __SPACEFIGHT_BUILD__/);
});

test('mobile combat controls and loadout stay inside short landscape viewports', () => {
  const css = read('SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css');
  const html = read('SpaceFight-Cocos/build-templates/web-desktop/index.ejs');
  assert.match(css, /--safe-right: env\(safe-area-inset-right/);
  assert.match(css, /@media \(max-height: 420px\) and \(orientation: landscape\)/);
  assert.match(css, /@media \(max-width: 760px\) and \(orientation: landscape\)/);
  assert.match(css, /\.loadout-grid \{ display: grid; grid-auto-flow: column; grid-auto-columns: minmax\(250px, 23vw\)/);
  assert.match(css, /@media \(max-height: 540px\) and \(orientation: landscape\)[\s\S]*\.loadout-grid \{ grid-template-columns: none; grid-auto-columns: minmax\(210px, 31vw\)/);
  assert.match(css, /#PrimaryControl/);
  assert.match(css, /#MoveStick/);
  assert.match(css, /#AimSurface/);
  assert.match(html, /id="AimSurface"/);
  assert.match(css, /body\[data-input-mode="touch"\] #LaunchGate \{[\s\S]*grid-template-columns: 52px minmax\(0, 1fr\) minmax\(248px, 38vw\)/);
  assert.match(css, /body\[data-input-mode="touch"\] \.launch-bar,[\s\S]*body\[data-input-mode="touch"\] \.launch-dock \{ grid-column: 1 \/ -1; \}/);
});

test('preflight graphics choice is shared by desktop and mobile before engine startup', () => {
  for (const platform of ['web-desktop', 'web-mobile']) {
    const html = read(`SpaceFight-Cocos/build-templates/${platform}/index.ejs`);
    const shell = read(`SpaceFight-Cocos/build-templates/${platform}/spacefight-shell.js`);

    assert.match(html, /data-graphics-choice="low"[^>]*>低配模式</);
    assert.match(html, /data-graphics-choice="high"[^>]*>高画质</);
    assert.match(shell, /spacefight\.graphics\.v1/);
    assert.match(shell, /spacefight:graphics-tier/);
    assert.match(shell, /URLSearchParams\(window\.location\.search\)/);
    assert.match(shell, /dataset\.graphicsTier/);
  }
});

test('loadout weapon cards render the generated weapon art instead of text-only rows', () => {
  for (const platform of ['web-desktop', 'web-mobile']) {
    const html = read(`SpaceFight-Cocos/build-templates/${platform}/index.ejs`);
    const css = read(`SpaceFight-Cocos/build-templates/${platform}/spacefight-shell.css`);

    for (const weapon of ['pulse', 'scatter', 'missile', 'rail', 'plasma']) {
      assert.match(html, new RegExp(`data-loadout-value="${weapon}"[\\s\\S]*?<img[^>]+data-weapon-art="${weapon}"`));
    }
    assert.match(css, /\.weapon-option img/);
    assert.match(css, /body\[data-input-mode="desktop"\]\s+#TouchHud\s*\{\s*display:\s*none\s*!important/);
  }
});

test('narrow landscape preflight keeps graphics controls and actions within the viewport', () => {
  const css = read('SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css');
  assert.match(css, /\.graphics-choice\s*\{[\s\S]*height:\s*44px/);
  assert.match(css, /\.graphics-choice\s*\{[\s\S]*max-inline-size:\s*100%/);
  assert.match(css, /@media \(max-height: 420px\) and \(orientation: landscape\)[\s\S]*\.launch-actions/);
  assert.match(css, /@media \(max-width: 760px\) and \(orientation: landscape\)[\s\S]*overflow:\s*hidden/);
});

test('spacefight static server sends deterministic asset headers', () => {
  const server = read('website/spacefight.zhengzhengstudio.cn/server/server.js');
  assert.match(server, /'Content-Length':\s*stat\.size/);
  assert.match(server, /immutable/);
  assert.match(server, /req\.method\s*===\s*'HEAD'/);
});

test('main API host gives fingerprinted SpaceFight assets immutable caching', () => {
  const server = read('website/api/server.js');
  assert.match(server, /SPACEFIGHT_STATIC_OPTIONS/);
  assert.match(server, /fingerprintedAssetPattern/);
  assert.match(server, /spacefight\.zhengzhengstudio\.cn'[\s\S]*SPACEFIGHT_STATIC_OPTIONS/);
});
