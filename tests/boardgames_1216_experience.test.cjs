const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const webStudio = read('website/zhengzhengstudio.cn/boardgames/analysis-studio.js');
const android = read('MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java');
const apple = read('MultipleBoardGames/MultipleBoardGames Shared/MainMenuScene.swift');
const harmony = read('HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets');

for (const action of ['undo-editor', 'clear-editor', 'standard-editor', 'save-editor', 'apply-editor']) {
  assert.match(webStudio, new RegExp(action), `web editor action ${action}`);
}
assert.match(webStudio, /dataset\.editorOpen/, 'web editor must switch to a focused board layout');

for (const label of ['撤销', '清空', '标准局面', '保存局面', '开始对局']) {
  assert.match(android, new RegExp(label), `Android editor control ${label}`);
  assert.match(apple, new RegExp(label), `Apple editor control ${label}`);
  assert.match(harmony, new RegExp(label), `Harmony editor control ${label}`);
}

assert.match(read('MultipleBoardGamesAndroid/app/build.gradle.kts'), /versionName = "1\.2\.16"/);
assert.match(read('HarmonyOS-App/ZhengZhengBoardGamesHarmony/AppScope/app.json5'), /"versionName": "1\.2\.16"/);
assert.match(read('MultipleBoardGames/MultipleBoardGames.xcodeproj/project.pbxproj'), /MARKETING_VERSION = 1\.2\.16/);

console.log('Board games 1.2.16 cross-platform experience contract passed.');
