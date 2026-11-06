const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'apps/SurvivalDiary-Apple');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

function readTree() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.build', '.swiftpm', 'Artifacts', 'DerivedData'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (!/\.(png|webp|jpe?g)$/i.test(entry.name)) files.push(fs.readFileSync(absolute, 'utf8'));
    }
  }
  walk(appRoot);
  return files.join('\n');
}

test('Apple clients are separate native SwiftUI and SpriteKit products', () => {
  const packageFile = read('Package.swift');
  const sources = readTree();

  assert.match(packageFile, /SurvivalDiaryCore/);
  assert.match(packageFile, /SurvivalDiaryIOS/);
  assert.match(packageFile, /SurvivalDiaryMac/);
  assert.match(sources, /import SwiftUI/);
  assert.match(sources, /import SpriteKit/);
  assert.doesNotMatch(sources, /WKWebView|import WebKit|\.html|<script|javascript:/i);
});

test('Apple products freeze identities, version, deployment and fail-closed signing inputs', () => {
  const ios = read('Support/iOS-Info.plist');
  const mac = read('Support/macOS-Info.plist');
  const scripts = `${read('scripts/build_ios.sh')}\n${read('scripts/build_macos.sh')}`;
  assert.match(ios, /cn\.zhengzhengstudio\.survivaldiary\.ios/);
  assert.match(mac, /cn\.zhengzhengstudio\.survivaldiary\.macos/);
  for (const value of ['0.6.2', '>38<', '16.0', '13.0']) assert.match(`${ios}\n${mac}`, new RegExp(value.replace('.', '\\.')));
  assert.match(scripts, /SURVIVAL_DIARY_APPLE_TEAM_ID/);
  assert.match(scripts, /embedded\.mobileprovision/);
  assert.match(scripts, /Payload\/SurvivalDiary\.app/);
  assert.match(scripts, /codesign --verify --strict/);
  assert.match(scripts, /SURVIVAL_DIARY_DEVELOPER_ID/);
  assert.doesNotMatch(scripts, /WebKit|WKWebView/);
});

test('Apple source includes shared saves, camera, adaptive HUD, diary, online queue and update channels', () => {
  const sources = readTree();
  for (const contract of ['SaveRepository', 'CameraController', 'GameContainerView', 'DiaryBookView', 'ReconnectQueue', 'UpdateService', 'ReleasePushService']) {
    assert.match(sources, new RegExp(`\\b${contract}\\b`), contract);
  }
  assert.match(sources, /Authorization|authorization/);
  assert.match(sources, /Bearer/);
  assert.match(sources, /\?session|queryItems/);
});

test('Apple apps restore and autosave their world and require destructive confirmation', () => {
  const store = read('Sources/SurvivalDiaryUI/GameStore.swift');
  const container = read('Sources/SurvivalDiaryUI/GameContainerView.swift');
  assert.match(store, /SaveRepository/);
  assert.match(store, /restoreSavedWorld/);
  assert.match(store, /persistWorld/);
  assert.match(store, /restartWorld/);
  assert.match(container, /confirmationDialog/);
  assert.match(container, /确认删除并重新开始/);
});

test('Apple native world exposes starter water food fibre branches and sea-eroded stone', () => {
  const simulation = read('Sources/SurvivalDiaryCore/Simulation.swift');
  const store = read('Sources/SurvivalDiaryUI/GameStore.swift');
  for (const item of ['stone', 'branch', 'palm-fiber', 'fresh-water', 'coconut']) assert.match(simulation, new RegExp(`"${item}"`));
  assert.match(simulation, /starterResources/);
  assert.match(store, /海蚀石/);
});

test('Apple HUD uses real hotbar inventory and prioritises world interactions before gathering', () => {
  const store = read('Sources/SurvivalDiaryUI/GameStore.swift');
  const hud = read('Sources/SurvivalDiaryUI/GameHUD.swift');
  const container = read('Sources/SurvivalDiaryUI/GameContainerView.swift');
  assert.match(store, /var hotbarItems: \[String\?\]/);
  assert.match(store, /public func selectHotbarItem/);
  assert.match(store, /if placementType != nil/);
  assert.match(store, /if let entity = nearestInteractiveEntity\(\)/);
  assert.match(store, /if nearestVillagerIsClose/);
  assert.match(store, /if let ground = nearestGroundItem\(\)/);
  assert.match(hud, /ForEach\(Array\(store\.hotbarItems\.enumerated\(\)\)/);
  assert.match(hud, /store\.performContextAction\(\)/);
  assert.match(container, /Button\("放置"\) \{ store\.performContextAction\(\) \}/);
  assert.doesNotMatch(container, /confirmPlacement\(at: \.init\(x: 360, y: 220\)\)/);
});
