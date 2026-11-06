const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const project = path.join(root, 'apps/SurvivalDiary-Android');

function read(relative) {
  return fs.readFileSync(path.join(project, relative), 'utf8');
}

function treeText() {
  if (!fs.existsSync(project)) return '';
  return fs.readdirSync(project, { recursive: true, withFileTypes: true })
    .filter((entry) => {
      const parent = entry.parentPath || entry.path;
      return entry.isFile()
        && !/(^|\/)(\.gradle|build)(\/|$)/.test(path.relative(project, parent))
        && !/\.(png|webp|jpe?g|jar)$/i.test(entry.name);
    })
    .map((entry) => fs.readFileSync(path.join(entry.parentPath || entry.path, entry.name), 'utf8'))
    .join('\n');
}

test('Android game is a product-isolated native Compose and Canvas app', () => {
  const tree = treeText();
  assert.match(tree, /class NativeGameView/);
  assert.match(tree, /override fun onDraw\(/);
  assert.match(tree, /fun SurvivalDiaryApp\(/);
  assert.doesNotMatch(tree, /android\.webkit|\bWebView\b|file:\/\/\/android_asset|<html|\.js["']/i);

  const gradle = read('app/build.gradle.kts');
  assert.match(gradle, /applicationId = "cn\.zhengzhengstudio\.survivaldiary"/);
  assert.match(gradle, /compileSdk = 34/);
  assert.match(gradle, /minSdk = 26/);
  assert.match(gradle, /targetSdk = 34/);
  assert.match(gradle, /versionCode = 46/);
  assert.match(gradle, /versionName = "0\.6\.2"/);
  assert.match(gradle, /create\("website"\)/);
  assert.match(gradle, /create\("play"\)/);
});

test('native domain provides deterministic saves, v3 open-world simulation, migration and atomic repository', () => {
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt'), /data class GameSave/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt'), /schemaVersion: Int = 4/);
  const simulation = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/Simulation.kt');
  assert.match(simulation, /fun create\(/);
  assert.match(simulation, /fun step\(/);
  assert.match(simulation, /fun GameSave\.stableDigest\(/);
  assert.match(simulation, /GameCommand\.Repair/);
  assert.match(simulation, /GameCommand\.Dismantle/);
  const repository = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt');
  assert.match(repository, /\.pending/);
  assert.match(repository, /\.previous/);
  assert.match(repository, /importLegacyExport/);
  assert.doesNotMatch(repository, /\/data\/data|createPackageContext/);
  assert.match(read('app/build.gradle.kts'), /syncSurvivalDiaryContent/);
  assert.match(read('app/build.gradle.kts'), /syncSurvivalDiaryAssets/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/WorldGenerator.kt'), /biomeBlendFor/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/SurvivalSimulation.kt'), /REAL_MILLISECONDS_PER_GAME_DAY\s*=\s*1_800_000L/);
});

test('camera and native renderer share transforms and support 2.5D gestures', () => {
  const camera = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/Camera2D.kt');
  assert.match(camera, /fun worldToScreen/);
  assert.match(camera, /fun screenToWorld/);
  assert.match(camera, /coerceIn\(0\.35f, 3\.0f\)/);
  assert.match(camera, /rotateQuarterTurn/);
  const view = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/NativeGameView.kt');
  assert.match(view, /ScaleGestureDetector/);
  assert.match(view, /drawTerrain/);
  assert.match(view, /drawScene/);
  assert.match(view, /drawEntity/);
  assert.match(view, /drawActors/);
  assert.match(view, /drawWeather/);
  assert.match(view, /camera\.applyTo\(canvas\)/);
  assert.match(view, /chunkRenderer\.draw\(canvas, worldSeed, bounds, discoveredChunks\)/);
  assert.doesNotMatch(view, /atlas\.terrain/);
  const chunkRenderer = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/ChunkRenderer.kt');
  assert.match(chunkRenderer, /interpolatedWeights/);
  assert.match(chunkRenderer, /rasterize\(chunk/);
  assert.match(view, /drawAtmosphere/);
});

test('Compose UI exposes guided/free modes, placement and offline diary', () => {
  const app = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt');
  assert.match(app, /GameViewModel/);
  assert.match(app, /StateFlow<GameUiState>/);
  assert.match(app, /setPlayMode/);
  assert.match(app, /beginPlacement/);
  assert.match(app, /confirmPlacement/);
  assert.match(app, /writeDiary/);
  assert.match(app, /if \(moving && mutableState\.value\.save\.milestones\["tutorial:moved"\] != true\)/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt'), /size\(if \(compact\) 50\.dp else 52\.dp\)/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt'), /生命/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/InventoryScreen.kt'), /LazyVerticalGrid/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/CraftingScreen.kt'), /尚有.*未知配方/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/RecipeUnlockPolicy.kt'), /knownItems.*stations/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/MapScreen.kt'), /discoveredChunks/);
  assert.match(read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/ChatPanel.kt'), /岛屿聊天/);
  const diary = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/DiaryScreen.kt');
  assert.match(diary, /事实|发现|地图笔记|建造相册|好友来访/);
});

test('Android HUD keeps six readable mobile slots and 48dp-plus touch targets', () => {
  const hud = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameHud.kt');
  assert.match(hud, /repeat\(6\)/);
  assert.match(hud, /HudDockButton\("背包"/);
  assert.match(hud, /width\(if \(compact\) 48\.dp else 52\.dp\)/);
  assert.match(hud, /heightIn\(min = if \(compact\) 54\.dp else 52\.dp\)/);
  assert.match(hud, /Modifier\.weight\(1f\)\.heightIn\(min = 54\.dp\)/);
  assert.match(hud, /CompassButton\(/);
  assert.doesNotMatch(hud, /NavButton\("背包"/);
});

test('Android 0.6.2 uses responsive full-width panels and an aspect-safe cloud-bank fog frontier', () => {
  const panel = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GamePanelSurface.kt');
  assert.match(panel, /heightFraction: Float = 0\.82f/);
  assert.match(panel, /widthIn\(min = 96\.dp\)\.heightIn\(min = 48\.dp\)/);
  assert.match(panel, /Column\(Modifier\.fillMaxWidth\(\)\.weight\(1f\)\)/);
  const button = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameButton.kt');
  assert.match(button, /heightIn\(min = 48\.dp\)/);
  const diary = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/DiaryScreen.kt');
  assert.match(diary, /以前的日记/);
  assert.match(diary, /heightIn\(min = 132\.dp, max = 220\.dp\)/);
  const renderer = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/ChunkRenderer.kt');
  assert.match(renderer, /atlas\.fogBankEdge\(\)/);
  assert.match(renderer, /FogCloudLayout\.segments/);
  assert.doesNotMatch(renderer, /fun drawFogTexture/);
});

test('online services include friends, cloud saves, reconnect queue and safe release updates', () => {
  const api = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/SurvivalApi.kt');
  assert.match(api, /passport|friends|cloud\/saves/i);
  assert.match(api, /AndroidKeyStore|AES\/GCM/);
  assert.match(api, /call\.timeout\(\)\.timeout\(2600, TimeUnit\.MILLISECONDS\)/);
  const app = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt');
  assert.match(app, /statusCode == 401/);
  const npc = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/NpcScreen.kt');
  assert.match(npc, /岛民先答 · Kimi 快速回话中（最多 2\.6 秒）/);
  const queue = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/ReconnectQueue.kt');
  assert.match(queue, /eventId/);
  assert.match(queue, /baseRevision/);
  const update = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/UpdateRepository.kt');
  assert.match(update, /check\(/);
  assert.match(update, /downloadAndVerify/);
  assert.match(update, /SHA-256|MessageDigest/);
  assert.match(update, /PackageInstaller|ACTION_VIEW/);
  assert.match(update, /GET_SIGNATURES/);
  assert.match(update, /archiveInfo\.packageName/);
  assert.match(update, /URI\(manifestUrl\)\.resolve/);
  const push = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/update/ReleasePushService.kt');
  assert.match(push, /BuildConfig\.MANIFEST_URL/);
  assert.match(push, /\/push\/subscriptions/);
  assert.doesNotMatch(push, /data\[["']downloadUrl/);
});

test('website and Play channels have isolated installer permissions and signing indirection', () => {
  const websiteManifest = read('app/src/website/AndroidManifest.xml');
  const playManifest = read('app/src/play/AndroidManifest.xml');
  assert.match(websiteManifest, /REQUEST_INSTALL_PACKAGES/);
  assert.doesNotMatch(playManifest, /REQUEST_INSTALL_PACKAGES/);
  const gradle = read('app/build.gradle.kts');
  assert.match(gradle, /SURVIVAL_DIARY_KEYSTORE/);
  assert.match(gradle, /SURVIVAL_DIARY_STORE_PASSWORD/);
  assert.match(gradle, /SURVIVAL_DIARY_KEY_PASSWORD/);
  assert.doesNotMatch(gradle, /storePassword\s*=\s*"[^"$]+"/);
  assert.match(gradle, /release\s*\{[\s\S]*?isDebuggable\s*=\s*false/);
  assert.doesNotMatch(read('app/src/main/AndroidManifest.xml'), /android:debuggable/);
});

test('Android restores the complete world and protects explicit restart with confirmation', () => {
  const app = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt');
  const repository = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt');
  const system = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SystemScreen.kt');
  assert.match(app, /repository\.load\(SAVE_SLOT\)/);
  assert.match(app, /viewModelScope/);
  assert.match(app, /fun restartWorld/);
  for (const field of ['inventory', 'entities', 'milestones', 'discoveredChunks', 'resourceNodes', 'vitals']) assert.match(repository, new RegExp(`\\b${field}\\b`));
  assert.match(system, /重新开始/);
  assert.match(system, /确认删除/);
});

test('Android storage crates have persistent finite storage and a native transfer panel', () => {
  const model = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/GameSave.kt');
  const storage = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/domain/StorageRules.kt');
  const app = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/SurvivalDiaryApp.kt');
  const repository = read('app/src/main/java/cn/zhengzhengstudio/survivaldiary/data/SaveRepository.kt');
  assert.match(model, /containerInventories:\s*Map<String, Map<String, Int>>/);
  assert.match(storage, /object StorageRules/);
  assert.match(storage, /MAX_SLOTS\s*=\s*24/);
  assert.match(app, /GamePanel\.STORAGE/);
  assert.match(app, /StorageScreen\(/);
  assert.match(repository, /containerInventories/);
});
