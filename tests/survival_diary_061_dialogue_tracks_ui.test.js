const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('villager dialogue keeps the immediate local answer and bounds Kimi to 2.6 seconds', () => {
  const webNetwork = read('website/survival-diary.zhengzhengstudio.cn/js/network.js');
  const webGame = read('website/survival-diary.zhengzhengstudio.cn/js/game.js');
  const server = read('website/survival-diary.zhengzhengstudio.cn/server/kimi-director.js');
  const androidApi = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/SurvivalApi.kt');
  const androidNpc = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/NpcScreen.kt');
  const appleApi = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/SurvivalAPI.swift');
  const harmonyApi = read('apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/SurvivalOnlineClient.ets');

  assert.match(webNetwork, /: 2_600;/);
  assert.match(server, /DEFAULT_DIALOGUE_TIMEOUT_MS = 2_600/);
  assert.match(webGame, /const safeReply = onlineReply \|\| localReply/);
  assert.match(webGame, /villagerDialogueMemory\.set/);
  assert.match(androidApi, /timeout\(2600, TimeUnit\.MILLISECONDS\)/);
  assert.match(androidNpc, /answer = result\.reply\.trim\(\)\.takeIf\(String::isNotEmpty\) \?: answer/);
  assert.match(androidNpc, /rememberConversation\(NpcConversation/);
  assert.match(appleApi, /timeout: 2\.6/);
  assert.match(harmonyApi, /payload, 2600\)/);
});

test('every native renderer selects joined rail shapes from all four cardinal neighbours', () => {
  const android = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/game/NativeGameView.kt');
  const apple = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryGame/IslandScene.swift');
  for (const flavor of ['Offline', 'Online']) {
    const index = read(`apps/SurvivalDiary-HarmonyOS-${flavor}/entry/src/main/ets/pages/Index.ets`);
    const canvas = read(`apps/SurvivalDiary-HarmonyOS-${flavor}/entry/src/main/ets/game/GameCanvas.ets`);
    assert.match(index, /railKind/);
    assert.match(index, /neighbors\.push\('n'\)/);
    assert.match(index, /neighbors\.push\('e'\)/);
    assert.match(index, /neighbors\.push\('s'\)/);
    assert.match(index, /neighbors\.push\('w'\)/);
    assert.match(canvas, /rail_crossing/);
    assert.match(canvas, /rail_junction_t/);
    assert.match(canvas, /rail_curve_es/);
    assert.match(canvas, /rail_straight_ew/);
  }
  assert.match(android, /rail-crossing/);
  assert.match(android, /rail-junction/);
  assert.match(android, /rail-curve/);
  assert.match(apple, /rail-crossing-v1/);
  assert.match(apple, /rail-junction-t-v1/);
  assert.match(apple, /rail-curve-es-v1/);
  assert.match(apple, /rail-straight-ew-v1/);
});

test('the mobile game UI stays world-first instead of stretching decorative frames into tool screens', () => {
  const androidPanel = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GamePanelSurface.kt');
  const androidButton = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/GameButton.kt');
  const androidNpc = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/NpcScreen.kt');
  const webHud = read('website/survival-diary.zhengzhengstudio.cn/game-hud-v2.css');

  assert.match(androidPanel, /heightFraction: Float = 0\.82f/);
  assert.doesNotMatch(androidPanel, /GameUiRaster\([\s\S]{0,120}Modifier\.matchParentSize/);
  assert.match(androidNpc, /verticalScroll\(rememberScrollState\(\)\)/);
  assert.match(androidButton, /heightIn\(min = 48\.dp\)/);
  assert.match(webHud, /Field-kit surfaces stay quiet/);
  assert.match(webHud, /clip-path: none/);
});
