const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cocos = path.join(root, 'SpaceFight-Cocos');
const html = fs.readFileSync(path.join(cocos, 'build-templates/web-desktop/index.ejs'), 'utf8');
const css = fs.readFileSync(path.join(cocos, 'build-templates/web-desktop/spacefight-shell.css'), 'utf8');
const shell = fs.readFileSync(path.join(cocos, 'build-templates/web-desktop/spacefight-shell.js'), 'utf8');
const catalog = fs.readFileSync(path.join(cocos, 'assets/scripts/core/WeaponCatalog.ts'), 'utf8');
const simulation = fs.readFileSync(path.join(cocos, 'assets/scripts/core/CombatSimulation.ts'), 'utf8');

test('web flight deck exposes a complete, responsive equipment bench', () => {
  assert.match(html, /id="LoadoutPanel"[^>]*aria-labelledby="LoadoutTitle"/);
  assert.equal((html.match(/data-loadout-slot="weapon"/g) || []).length, 5);
  assert.equal((html.match(/data-loadout-slot="device"/g) || []).length, 5);
  assert.equal((html.match(/data-loadout-slot="core"/g) || []).length, 6);
  assert.match(html, /id="LoadoutApply"/);
  assert.match(css, /\.loadout-grid\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /@media \(max-height: 540px\) and \(orientation: landscape\)[\s\S]*#LoadoutPanel/);
  assert.match(shell, /localStorage\.setItem\(LOADOUT_KEY/);
  assert.match(shell, /spacefight:loadout-change/);
});

test('saved equipment is passed into Cocos combat and changes real player stats', () => {
  assert.match(catalog, /PRIMARY_WEAPONS[\s\S]*scatter[\s\S]*rail[\s\S]*plasma/);
  assert.match(catalog, /TACTICAL_DEVICES[\s\S]*targeter[\s\S]*repair[\s\S]*fabricator[\s\S]*collector[\s\S]*aegis/);
  assert.match(catalog, /FRAME_CORES[\s\S]*balanced[\s\S]*vector[\s\S]*bastion[\s\S]*reactor[\s\S]*phantom[\s\S]*dreadnought/);
  assert.match(simulation, /loadout\?: CombatLoadout/);
  assert.match(simulation, /resolveLoadout/);
  assert.match(simulation, /damageMultiplier/);
  assert.match(simulation, /pickupRadius/);
});

test('all native clients expose a persistent three-slot armory without web embedding', () => {
  const android = fs.readFileSync(path.join(root, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt'), 'utf8');
  const ios = fs.readFileSync(path.join(root, 'apps/SpaceFight-iOS/Sources/main.swift'), 'utf8');
  const mac = fs.readFileSync(path.join(root, 'apps/SpaceFightMac/Sources/main.swift'), 'utf8');
  const shared = fs.readFileSync(path.join(root, 'apps/SpaceFightShared/NativeGameScene.swift'), 'utf8');
  const harmony = fs.readFileSync(path.join(root, 'HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets'), 'utf8');
  const harmonyOffline = fs.readFileSync(path.join(root, 'HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets'), 'utf8');

  assert.match(android, /showLoadout\(\)/);
  assert.match(android, /battle\.setLoadout\(LoadoutProfile\(preferredWeapon, preferredDevice, preferredCore\)\)/);
  assert.match(android, /private fun buildLoadoutUi\(\)/);
  assert.match(android, /tactical_device/);
  assert.match(android, /frame_core/);
  assert.match(android, /configureLoadout\(loadout/);
  assert.match(android, /damageFactor/);
  assert.match(android, /pickupRadius/);
  assert.doesNotMatch(android, /setSingleChoiceItems/);
  assert.match(ios, /showArmory\(\)/);
  assert.match(ios, /private func buildArmoryOverlay\(\)/);
  assert.match(ios, /loadoutDevices/);
  assert.match(ios, /loadoutCores/);
  assert.doesNotMatch(ios, /preferredStyle: \.actionSheet/);
  assert.match(mac, /showArmory\(\)/);
  assert.match(mac, /private func buildArmoryOverlay\(\)/);
  assert.match(mac, /deviceSelector/);
  assert.match(mac, /coreSelector/);
  assert.match(shared, /struct SFLoadoutProfile/);
  assert.match(shared, /localBattle\.reset\(mode: missionMode, loadout: loadout\)/);
  assert.match(shared, /private func configure\(_ loadout: SFLoadoutProfile\)/);
  for (const source of [harmony, harmonyOffline]) {
    assert.match(source, /private armoryPanel\(\)/);
    assert.match(source, /this\.weapon = this\.loadoutWeapon/);
    assert.match(source, /starting_weapon/);
    assert.match(source, /tactical_device/);
    assert.match(source, /frame_core/);
    assert.match(source, /configureLoadout\(\)/);
    assert.match(source, /damageFactor/);
    assert.match(source, /pickupRadius/);
  }
});

test('all native clients persist adjustable controls and keep aim separate from fire', () => {
  const android = fs.readFileSync(path.join(root, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt'), 'utf8');
  const ios = fs.readFileSync(path.join(root, 'apps/SpaceFight-iOS/Sources/main.swift'), 'utf8');
  const mac = fs.readFileSync(path.join(root, 'apps/SpaceFightMac/Sources/main.swift'), 'utf8');
  const shared = fs.readFileSync(path.join(root, 'apps/SpaceFightShared/NativeGameScene.swift'), 'utf8');
  const harmony = fs.readFileSync(path.join(root, 'HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets'), 'utf8');
  const harmonyOffline = fs.readFileSync(path.join(root, 'HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets'), 'utf8');

  assert.match(android, /private var aimPointer/);
  assert.match(android, /private var firePointer/);
  assert.match(android, /override fun onKeyDown/);
  assert.match(android, /putInt\("key_\$action"/);
  assert.match(ios, /buildSettingsOverlay/);
  assert.match(ios, /controlDraft\.aimSensitivity/);
  assert.match(mac, /keySelectors/);
  assert.match(mac, /profile\.forwardKey/);
  assert.match(shared, /private var aimTouch/);
  assert.match(shared, /private var fireTouch/);
  assert.match(shared, /controlProfile\.forwardKey/);
  assert.match(shared, /spacefight\.key\.forward/);

  for (const source of [harmony, harmonyOffline]) {
    assert.match(source, /private updateAim\(event: TouchEvent\)/);
    assert.match(source, /private updateFire\(event: TouchEvent\)/);
    assert.match(source, /private fireTouchId/);
    assert.match(source, /private handleKey\(event: KeyEvent\)/);
    assert.match(source, /keyboard_preset/);
    assert.match(source, /\.onKeyEvent/);
  }
});

test('Android phone deck and armory use available landscape space instead of fixed-width panels', () => {
  const android = fs.readFileSync(path.join(root, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt'), 'utf8');
  assert.doesNotMatch(android, /rightMargin\s*=\s*dp\(330\)/);
  assert.match(android, /orientation\s*=\s*if \(compact\) LinearLayout\.VERTICAL else LinearLayout\.HORIZONTAL/);
  assert.match(android, /if \(compact\) -1 else dp\(328\)/);
});
