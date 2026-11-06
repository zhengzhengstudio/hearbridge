const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('the maintained cross-platform matrix distinguishes reachable, partial and missing features', () => {
  const matrix = read('docs/survival-diary/CROSS_PLATFORM_ALIGNMENT.md');
  assert.match(matrix, /Web \| Android \| HarmonyOS 单机 \| HarmonyOS 联机 \| iOS \| macOS/);
  assert.match(matrix, /探索迷雾与渐进揭示/);
  assert.match(matrix, /海岛图鉴入口/);
  assert.match(matrix, /道路、桥、船、铁路、矿车/);
  assert.match(matrix, /✅/);
  assert.match(matrix, /⚠️/);
  assert.match(matrix, /❌/);
});

test('Web exposes the compendium from crafting and map without adding a sixth dock button', () => {
  const html = read('website/survival-diary.zhengzhengstudio.cn/index.html');
  const game = read('website/survival-diary.zhengzhengstudio.cn/js/game.js');
  assert.match(html, /data-crafting-view="compendium"/);
  assert.match(html, /data-open-compendium>打开海岛图鉴/);
  assert.match(html, /id="compendium-button"[^>]*data-open-compendium/);
  assert.match(game, /function openCompendiumPanel\(\)/);
  assert.match(game, /setCraftingView\('compendium'\)/);
  const dock = html.match(/<nav class="mobile-action-dock game-dock"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((dock.match(/<button/g) || []).length, 5);
});

test('native clients provide reachable compendium routes while preserving five-item HUDs', () => {
  const androidCrafting = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/CraftingScreen.kt');
  const androidMap = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/MapScreen.kt');
  const androidApp = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt');
  assert.match(androidCrafting, /openCompendium: \(\) -> Unit/);
  assert.match(androidCrafting, /海岛图鉴 · 查看材料、配方与设施解锁关系/);
  assert.match(androidMap, /label = "打开海岛图鉴"/);
  assert.match(androidApp, /GamePanel\.MAP -> MapScreen\(state\.save, \{ model\.openPanel\(GamePanel\.COMPENDIUM\) \}/);

  for (const flavor of ['Offline', 'Online']) {
    const harmony = read(`apps/SurvivalDiary-HarmonyOS-${flavor}/entry/src/main/ets/pages/Index.ets`);
    assert.match(harmony, /Button\('打开海岛图鉴'\).*this\.showCompendium = true/);
  }

  const apple = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/CampPanels.swift');
  assert.ok((apple.match(/activeCampSection = \.compendium/g) || []).length >= 2);
  assert.match(apple, /Label\("打开海岛图鉴"/);
});

test('Android fog uses repeated aspect-preserving cloud segments instead of an edge-sized stretch', () => {
  const renderer = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/ChunkRenderer.kt');
  assert.match(renderer, /object FogCloudLayout/);
  assert.match(renderer, /val aspect = rasterWidth\.toFloat\(\) \/ rasterHeight\.toFloat\(\)/);
  assert.match(renderer, /FogCloudLayout\.segments\(edge, left, top, size, fog\.width, fog\.height\)/);
  assert.match(renderer, /canvas\.rotate\(segment\.rotationDegrees\)/);
  assert.doesNotMatch(renderer, /canvas\.drawBitmap\(fog, source, destination, paint\)/);
});

test('all download manifests advertise the aligned Web release as 0.6.2 build 22', () => {
  for (const file of [
    'website/api/apps/manifest.json',
    'website/api/apps/client-downloads.json',
    'website/zhengzhengstudio.cn/api/apps/manifest.json',
    'website/zhengzhengstudio.cn/api/apps/client-downloads.json',
  ]) {
    const document = JSON.parse(read(file));
    const web = document.apps.find(app => app.id === 'survival-diary-web');
    assert.equal(web.version, '0.6.2', file);
    assert.equal(web.build, 22, file);
    assert.match(`${web.notes.join(' ')} ${web.remarks}`, /启动页|新手引导/);
  }
});

test('download manifests publish release builds when signed and honest debug fallbacks otherwise', () => {
  const documents = [
    'website/api/apps/manifest.json',
    'website/api/apps/client-downloads.json',
    'website/zhengzhengstudio.cn/api/apps/manifest.json',
    'website/zhengzhengstudio.cn/api/apps/client-downloads.json',
  ];
  const expected = {
    'survival-diary-android': ['release', true, true],
    'survival-diary-harmony-offline': ['release', true, true],
    'survival-diary-ios': ['debug', false, false],
    'survival-diary-macos': ['debug', false, false],
    'survival-diary-harmony-online': ['debug', false, false],
  };

  for (const file of documents) {
    const document = JSON.parse(read(file));
    for (const [id, [channel, signed, storeReady]] of Object.entries(expected)) {
      const app = document.apps.find(item => item.id === id);
      assert.ok(app, `${file}: ${id}`);
      assert.equal(app.distributionChannel, channel, `${file}: ${id} channel`);
      assert.equal(app.signed, signed, `${file}: ${id} signed`);
      assert.equal(app.storeReady, storeReady, `${file}: ${id} storeReady`);
      assert.equal(app.available, true, `${file}: ${id} available`);
      assert.ok(app.fileName, `${file}: ${id} fileName`);
      assert.ok(app.downloadURL, `${file}: ${id} downloadURL`);
      assert.match(app.sha256, /^[a-f0-9]{64}$/, `${file}: ${id} sha256`);
      if (channel === 'debug') {
        assert.equal(app.debug, true, `${file}: ${id} debug flag`);
        assert.equal(app.updateEligible, false, `${file}: ${id} update eligibility`);
        assert.equal(app.directInstallSupported, false, `${file}: ${id} direct install`);
        assert.match(`${app.variantLabel} ${app.remarks} ${app.blockedReason}`, /Debug|测试|未签名|重签名/);
      }
    }
  }
});

test('native update clients refuse manifest artifacts that are download-only', () => {
  const apple = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/UpdateService.swift');
  assert.match(apple, /let updateEligible: Bool\?/);
  assert.match(apple, /entry\.available != false, entry\.updateEligible != false/);

  const harmony = read('apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/SurvivalOnlineClient.ets');
  assert.match(harmony, /updateEligible\?: boolean/);
  assert.match(harmony, /found\.updateEligible === false/);
});
