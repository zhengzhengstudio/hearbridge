const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readTree(relativePath) {
  const root = path.join(ROOT, relativePath);
  const chunks = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(ets|ts|json5|json)$/.test(entry.name)) chunks.push(fs.readFileSync(absolute, 'utf8'));
    }
  };
  visit(root);
  return chunks.join('\n');
}

test('online and offline editions are separate native ArkUI Canvas apps', () => {
  const editions = [
    ['Online', 'cn.zhengzhengstudio.survivaldiary.hmos', 60204],
    ['Offline', 'cn.zhengzhengstudio.survivaldiary.offline.hmos', 60203],
  ];

  for (const [edition, bundleName, versionCode] of editions) {
    const base = `apps/SurvivalDiary-HarmonyOS-${edition}`;
    const app = read(`${base}/AppScope/app.json5`);
    const tree = readTree(base);
    assert.match(app, new RegExp(`"bundleName"\\s*:\\s*"${bundleName.replaceAll('.', '\\.') }"`));
    assert.match(app, /"versionName"\s*:\s*"0\.6\.2"/);
    assert.match(app, new RegExp(`"versionCode"\\s*:\\s*${versionCode}`));
    assert.match(tree, /Canvas\s*\(/);
    assert.match(tree, /GameCanvas/);
    assert.match(tree, /GameHud/);
    assert.doesNotMatch(tree, /@kit\.ArkWeb|\bwebview\b|\bWeb\s*\(/);
  }
});

test('both editions expose a native entry page and independent resource identity', () => {
  for (const edition of ['Online', 'Offline']) {
    const base = `apps/SurvivalDiary-HarmonyOS-${edition}`;
    assert.match(read(`${base}/entry/src/main/resources/base/profile/main_pages.json`), /pages\/Index/);
    assert.match(read(`${base}/entry/src/main/ets/pages/Index.ets`), /@Entry[\s\S]*GameCanvas/);
    assert.match(read(`${base}/AppScope/resources/base/element/string.json`), /生存日记/);
  }
});

test('Harmony editions resume existing saves and require a second restart confirmation', () => {
  for (const edition of ['Online', 'Offline']) {
    const base = `apps/SurvivalDiary-HarmonyOS-${edition}`;
    const page = read(`${base}/entry/src/main/ets/pages/Index.ets`);
    const repository = read(`${base}/entry/src/main/ets/shared/data/SaveRepository.ets`);
    assert.match(repository, /async hasSave\(/);
    assert.match(repository, /async reset\(/);
    assert.match(page, /this\.hasExistingSave = await this\.repository\.hasSave\(\)/);
    assert.match(page, /this\.entered = false/);
    assert.match(page, /确认删除并重新开始/);
  }
});

test('Harmony editions expose the same essential starter resources and sea-eroded stone name', () => {
  for (const edition of ['Online', 'Offline']) {
    const base = `apps/SurvivalDiary-HarmonyOS-${edition}`;
    const simulation = read(`${base}/entry/src/main/ets/shared/domain/Simulation.ets`);
    const page = read(`${base}/entry/src/main/ets/pages/Index.ets`);
    assert.match(simulation, /starterResources/);
    for (const item of ['stone', 'branch', 'palm-fiber', 'fresh-water', 'coconut']) assert.match(simulation, new RegExp(`'${item}'`));
    assert.match(page, /海蚀石/);
  }
});

test('both Harmony editions advance the survival clock while the world is actively entered', () => {
  for (const edition of ['Online', 'Offline']) {
    const base = `apps/SurvivalDiary-HarmonyOS-${edition}`;
    const page = read(`${base}/entry/src/main/ets/pages/Index.ets`);
    const simulation = read(`${base}/entry/src/main/ets/shared/domain/Simulation.ets`);
    assert.match(page, /setInterval\(\(\) => this\.advanceClock\(\), 1250\)/);
    assert.match(page, /if \(!this\.entered\) return/);
    assert.match(page, /Simulation\.advanceSurvival\(this\.state, 1250, 'idle'\)/);
    assert.match(simulation, /static advanceSurvival\(/);
  }
});

test('Harmony HUD action and camera controls keep 50vp touch targets', () => {
  for (const edition of ['Online', 'Offline']) {
    const hud = read(`apps/SurvivalDiary-HarmonyOS-${edition}/entry/src/main/ets/ui/GameHud.ets`);
    assert.match(hud, /Button\(this\.contextActionLabel\)\.constraintSize\(\{ minWidth: 122, maxWidth: 154, minHeight: 56 \}\)/);
    assert.match(hud, /\.onClick\(this\.onContextAction\)/);
    assert.match(hud, /Image\(icon\)\.width\(42\)\.height\(42\)/);
    assert.match(hud, /\.layoutWeight\(1\)\.height\(56\)\.justifyContent/);
    for (const label of ['背包', '制作', '地图', '日记', '系统']) assert.match(hud, new RegExp(`'${label}'`));
  }
});

test('both Harmony editions expose real inventory and crafting panels from the five-item dock', () => {
  for (const edition of ['Online', 'Offline']) {
    const page = read(`apps/SurvivalDiary-HarmonyOS-${edition}/entry/src/main/ets/pages/Index.ets`);
    assert.match(page, /onInventory: \(\) => this\.showInventory = true/);
    assert.match(page, /onCrafting: \(\) => this\.showCrafting = true/);
    assert.match(page, /private InventoryPanel\(\)/);
    assert.match(page, /private CraftingPanel\(\)/);
    assert.match(page, /Button\('丢弃'\)/);
    assert.match(page, /this\.CraftRow\('石镐'/);
    assert.match(page, /this\.CraftRow\('储物箱'/);
  }
});

test('Harmony world interaction is coordinate-driven and prioritizes nearby facilities', () => {
  for (const edition of ['Online', 'Offline']) {
    const base = `apps/SurvivalDiary-HarmonyOS-${edition}`;
    const page = read(`${base}/entry/src/main/ets/pages/Index.ets`);
    const canvas = read(`${base}/entry/src/main/ets/game/GameCanvas.ets`);
    assert.match(canvas, /export interface WorldEntityVisual/);
    assert.match(canvas, /export interface GroundItemVisual/);
    assert.match(canvas, /ForEach\(this\.entities/);
    assert.match(canvas, /ForEach\(this\.groundItems/);
    assert.match(page, /private playerGrid\(\): Coordinates/);
    assert.match(page, /private placementPoint\(\): Coordinates/);
    assert.match(page, /private nearbyEntityId\(\): string/);
    assert.match(page, /if \(entityId\.length > 0\) \{ this\.useEntity\(entityId\); return; \}/);
    assert.match(page, /if \(this\.villageNearby\(\)\)/);
    assert.match(page, /private restAtShelter\(\): void/);
    assert.match(page, /entities: this\.worldEntities\(\), groundItems: this\.worldGroundItems\(\)/);
    assert.doesNotMatch(page, /itemId: type, coordinates: \{ x: 1, y: 1 \}/);
  }
});

test('Harmony offline release remembers validated signing secrets in macOS Keychain', () => {
  const script = read('apps/SurvivalDiary-HarmonyOS-Offline/build-release.sh');
  assert.match(script, /security find-generic-password/);
  assert.match(script, /security add-generic-password/);
  assert.match(script, /security delete-generic-password/);
  assert.match(script, /cn\.zhengzhengstudio\.survivaldiary\.harmony\.release\.store/);
  assert.match(script, /cn\.zhengzhengstudio\.survivaldiary\.harmony\.release\.key/);
  assert.match(script, /--forget-keychain/);
  assert.match(script, /HARMONY_SIGN_REMEMBER/);
  assert.match(script, /PUBLIC_PUBLISH_DIR/);
  assert.match(script, /ARTIFACT_DIR/);
  assert.match(script, /cmp -s \"\$source\" \"\$publish_root\/\$name\"/);
  assert.doesNotMatch(script, /echo\s+["']?\$\{?(?:STORE|KEY)_PASSWORD/);
});
