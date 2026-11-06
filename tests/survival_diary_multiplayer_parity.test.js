const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('protocol v2 documents the realtime messages every client consumes', () => {
  const schema = JSON.parse(read('apps/SurvivalDiaryShared/schemas/protocol.schema.json'));
  for (const name of ['join', 'resume', 'command', 'chat', 'snapshot', 'ack', 'worldUpdate', 'chatHistory', 'error']) {
    assert.ok(schema.$defs[name], `missing protocol definition ${name}`);
  }
  assert.deepEqual(schema.$defs.gatherCommand.required, ['type', 'resourceNodeId']);
  assert.ok(schema.$defs.gatherCommand.properties.toolId);
  assert.ok(schema.$defs.wildlifeAttackCommand);
  assert.ok(schema.$defs.wildlifeTameCommand);
  assert.match(read('website/survival-diary.zhengzhengstudio.cn/server/protocol-v2.js'), /message\.type === 'resume'/);
});

test('server exposes an idempotent public-island entry and schema-4 cloud saves', () => {
  const server = read('website/survival-diary.zhengzhengstudio.cn/server/server.js');
  const worlds = read('website/survival-diary.zhengzhengstudio.cn/server/world-store.js');
  assert.match(server, /put\('\/islands\/mine\/public'/);
  assert.match(server, /get\('\/islands\/:id\/snapshot'/);
  assert.match(worlds, /\[2, 4, 5\]\.includes\(save\.save\.schemaVersion\)/);
});

test('public island lobby returns summaries instead of every authoritative world', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'survival-island-lobby-'));
  try {
    const { createWorldStore } = require(path.join(root, 'website/survival-diary.zhengzhengstudio.cn/server/world-store.js'));
    const store = createWorldStore({ filePath: path.join(directory, 'worlds.json') });
    store.createIsland({ id: 'public-test', ownerUid: 'owner', seed: 'summary-test', visibility: 'public' });
    const [summary] = store.listPublic();
    assert.equal(summary.id, 'public-test');
    assert.deepEqual(summary.members, ['owner']);
    assert.equal(typeof summary.revision, 'number');
    assert.equal(Object.hasOwn(summary, 'world'), false, 'lobby must not download the whole world');
    assert.equal(Object.hasOwn(summary, 'eventLedger'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Android uses the live server contract and a real WebSocket chat client', () => {
  const api = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/SurvivalApi.kt');
  const socket = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/network/IslandSocketClient.kt');
  const chat = read('apps/SurvivalDiary-Android/app/src/main/java/cn/zhengzhengstudio/survivaldiary/ui/ChatPanel.kt');
  assert.match(api, /receiverUid/);
  assert.match(api, /\/saves\/main/);
  assert.match(api, /\/islands\/mine\/public/);
  assert.match(api, /\/islands\/public/);
  assert.match(socket, /newWebSocket/);
  assert.match(socket, /"protocolVersion", 2/);
  assert.match(socket, /fun sendCommand/);
  assert.match(socket, /"error" -> listener\.onStatus\(IslandConnectionStatus\.ONLINE/);
  assert.match(socket, /scheduleReconnect/);
  assert.doesNotMatch(chat, /enabled\s*=\s*false/);
  for (const label of ['创建公共岛', '加入', '发送', '退出联机']) assert.match(chat, new RegExp(label));
});

test('Harmony online edition targets the root API and implements realtime join/chat/resume', () => {
  const api = read('apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/SurvivalOnlineClient.ets');
  const realtime = read('apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/services/SurvivalRealtimeClient.ets');
  const page = read('apps/SurvivalDiary-HarmonyOS-Online/entry/src/main/ets/pages/Index.ets');
  assert.match(api, /https:\/\/survival-diary\.zhengzhengstudio\.cn['"]/);
  assert.match(api, /mode:\s*'local'.*deviceId/s);
  assert.match(api, /mine\/public/);
  assert.doesNotMatch(api, /'interact'/);
  assert.match(realtime, /@ohos\.net\.webSocket/);
  assert.match(realtime, /'resume'/);
  assert.match(realtime, /type:\s*'chat'/);
  assert.match(realtime, /async sendCommand/);
  assert.match(realtime, /this\.onState\('online', message\.message/);
  for (const label of ['创建或进入我的公共岛', '岛屿聊天', '退出公共岛']) assert.match(page, new RegExp(label));
});

test('Apple products expose the same multiplayer lifecycle without uploading private diary', () => {
  const api = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/SurvivalAPI.swift');
  const socket = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryOnline/IslandSocketClient.swift');
  const panel = read('apps/SurvivalDiary-Apple/Sources/SurvivalDiaryUI/MultiplayerPanel.swift');
  assert.match(api, /createGuestSession/);
  assert.match(api, /ensurePublicIsland/);
  assert.match(api, /listPublicIslands/);
  assert.match(socket, /webSocketTask/);
  assert.match(socket, /\breconnecting\b/);
  assert.match(socket, /func sendCommand/);
  assert.doesNotMatch(socket, /diary/);
  for (const label of ['创建公共岛', '加入', '发送', '退出联机']) assert.match(panel, new RegExp(label));
});

test('offline editions still have no multiplayer transport or chat panel', () => {
  const offline = read('apps/SurvivalDiary-HarmonyOS-Offline/entry/src/main/ets/pages/Index.ets');
  assert.doesNotMatch(offline, /SurvivalRealtimeClient|岛屿聊天|发送消息/);
});
