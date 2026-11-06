const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const test = require('node:test');

const apiServer = fs.readFileSync('website/api/server.js', 'utf8');
const webServer = fs.readFileSync('website/zhengzhengstudio.cn/server/server.js', 'utf8');
const chatClient = fs.readFileSync('website/zhengzhengstudio.cn/boardgames/realtime-chat.js', 'utf8');
const android = fs.readFileSync(
  'MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java',
  'utf8'
);
const apple = fs.readFileSync('MultipleBoardGames/MultipleBoardGames Shared/MainMenuScene.swift', 'utf8');
const harmony = fs.readFileSync(
  'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets',
  'utf8'
);
const minecraftRealtime = fs.readFileSync('website/api/minecraft/multiplayer.js', 'utf8');
const harmonyApp = fs.readFileSync('HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/app.json5', 'utf8');
const harmonyModule = fs.readFileSync('HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/module.json5', 'utf8');
const harmonyScopeMedia = 'HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/resources/base/media';
const harmonyEntryMedia = 'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media';

function sha256(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

test('deployed API exposes the native board-game websocket', () => {
  assert.match(apiServer, /new WebSocket\.Server\(\{ noServer: true, perMessageDeflate: false \}\)/);
  assert.match(apiServer, /pathname === '\/api\/boardgames\/ws'/);
  assert.match(apiServer, /boardgameNativeWss\.handleUpgrade/);
  assert.match(apiServer, /case 'voice-frame':\s+return nativeVoiceFrame/);
});

test('web and native board-game clients share one room broadcast', () => {
  assert.match(apiServer, /function emitRoom\(roomId, eventName, payload, excludeId = null\)/);
  assert.match(apiServer, /for \(const client of boardgameNativeClients\.values\(\)\)/);
  assert.match(apiServer, /socket\.on\('join-room',[\s\S]*?emitRoom\(roomId, 'room-update', room\)/);
  assert.match(apiServer, /socket\.on\('sync-action',[\s\S]*?emitRoom\(roomId, 'game-event'/);
  assert.match(apiServer, /socket\.on\('chat-message', broadcastRoomChat\)/);
  assert.match(apiServer, /emitRoom\(roomId, 'chat-message', chatMessage\)/);
});

test('realtime services only accept their own websocket paths', () => {
  assert.match(minecraftRealtime, /new WebSocket\.Server\(\{ noServer: true, perMessageDeflate: false \}\)/);
  assert.match(minecraftRealtime, /if \(pathname !== this\.path\) return/);
  assert.doesNotMatch(minecraftRealtime, /new WebSocket\.Server\(\{ server,/);
});

test('voice member identity is compatible across both server variants', () => {
  assert.match(apiServer, /socketId: client\.id/);
  assert.match(webServer, /socketId: id/);
  assert.match(chatClient, /member\.socketId \|\| member\.id/);
});

test('web voice keeps WebRTC and enables PCM only for native members', () => {
  assert.match(chatClient, /new RTCPeerConnection/);
  assert.match(chatClient, /member\.transport === 'pcm16'/);
  assert.match(chatClient, /socket\.emit\('voice-frame'/);
});

test('public realtime channel uses an uncompressed persistent websocket', () => {
  assert.match(apiServer, /transports:\s*\['websocket'\]/);
  assert.match(apiServer, /perMessageDeflate:\s*false/);
  assert.match(apiServer, /httpCompression:\s*false/);
  assert.match(chatClient, /transports:\s*\['websocket'\]/);
  assert.match(chatClient, /tryAllTransports:\s*false/);
});

test('Android and macOS capture and play real room audio', () => {
  assert.match(android, /new AudioRecord\(/);
  assert.match(android, /new AudioTrack\(/);
  assert.match(android, /"voice-frame"/);
  assert.match(apple, /private final class NativeRoomVoice/);
  assert.match(apple, /AVAudioEngine\(\)/);
  assert.match(apple, /"voice-frame"/);
});

test('iOS and HarmonyOS use the native realtime room and PCM room voice', () => {
  assert.match(apple, /#if os\(macOS\) \|\| os\(iOS\)/);
  assert.match(apple, /override func touchesEnded/);
  assert.match(harmony, /transport=websocket/);
  assert.match(harmony, /createAudioCapturer/);
  assert.match(harmony, /createAudioRenderer/);
  assert.match(harmony, /'voice-frame'/);
});

test('authoritative grid snapshots remain visible in native clients', () => {
  assert.match(apiServer, /boardFlat:\s*state\.board/);
  assert.match(android, /rows != null && rows\.length\(\) > 0/);
  assert.match(android, /rows\.optJSONArray\(0\) != null[\s\S]*else \{[\s\S]*stoneValue\(rows\.opt\(index\)\)/);
});

test('HarmonyOS renders and restores the correct board size for every grid game', () => {
  assert.match(harmony, /private boardCellCount\(\): number/);
  assert.match(harmony, /ForEach\(Array\(this\.boardCellCount\(\)\)\.fill\(0\)/);
  assert.match(harmony, /values\.length === this\.boardCellCount\(\)/);
  assert.match(harmony, /private gridTemplate\(size: number\): string/);
});

test('HarmonyOS launcher uses the compatible packaged app icon', () => {
  assert.match(harmonyApp, /"icon":\s*"\$media:layered_image"/);
  assert.match(harmonyModule, /"icon":\s*"\$media:layered_image"/);
  assert.match(harmonyModule, /"ohos\.want\.action\.home"/);
  assert.match(harmonyModule, /"action\.system\.home"/);
});

test('HarmonyOS launcher layers keep the original board-games icon in both resource scopes', () => {
  assert.equal(sha256(`${harmonyScopeMedia}/background.png`), sha256(`${harmonyEntryMedia}/background.png`));
  assert.equal(sha256(`${harmonyScopeMedia}/foreground.png`), sha256(`${harmonyEntryMedia}/foreground.png`));
});

test('HarmonyOS Go-family boards render stones on intersections rather than cell centers', () => {
  assert.match(harmony, /BoardIntersection\(index,\s*15,\s*'#805B2D'\)/);
  assert.match(harmony, /BoardIntersection\(index,\s*19,\s*'#70532D'\)/);
  assert.doesNotMatch(
    harmony.match(/GomokuBoard\(\)[\s\S]*?ReversiBoard\(\)/)?.[0] || '',
    /\.border\(\{\s*width:\s*0\.75,\s*color:\s*'#805B2D'/
  );
  assert.match(harmony, /\.columnsTemplate\(this\.gridTemplate\(15\)\)[\s\S]*?\.columnsGap\(0\)[\s\S]*?\.rowsTemplate\(this\.gridTemplate\(15\)\)[\s\S]*?\.rowsGap\(0\)/);
});
