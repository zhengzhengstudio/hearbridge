'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hud = read('SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts');
const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
const nativeBuilder = read('SpaceFight-Cocos/tools/build-native-target.js');

test('native outpost uses its own full-HD hangar art and four real ship-system entries', () => {
  const art = path.join(root, 'SpaceFight-Cocos/assets/resources/ui/hangar/spacefight-hangar-bay.png');
  assert.ok(fs.existsSync(art));
  assert.ok(fs.statSync(art).size > 1_000_000);
  assert.match(hud, /ui\/hangar\/spacefight-hangar-bay/);
  assert.match(hud, /resources\.load\(`\$\{path\}\/texture`, Texture2D/);
  assert.match(hud, /new SpriteFrame\(\)/);
  assert.match(hud, /frame\.texture = texture/);
  for (const node of ['NativeHomeOperations', 'NativeHomeHangar', 'NativeHomeCargo', 'NativeHomeSettings']) {
    assert.match(hud, new RegExp(node));
  }
  assert.match(hud, /type NativeHomeView = 'operations' \| 'hangar' \| 'cargo' \| 'settings'/);
  for (const asset of [
    'orbital-outpost-exterior.png',
    'orbital-hangar-loadout.png',
    'orbital-combat-zone.png',
  ]) {
    const file = path.join(root, 'SpaceFight-Cocos/assets/resources/ui/station', asset);
    assert.ok(fs.existsSync(file), `${asset} is missing`);
    assert.ok(fs.statSync(file).size > 1_000_000, `${asset} is not production artwork`);
    assert.match(hud, new RegExp(asset.replace('.png', '').replaceAll('-', '\\-')));
  }
  assert.match(hud, /UIOpacity/);
  assert.match(hud, /updateHomeKeyArt/);
  assert.match(nativeBuilder, /validateRequiredVisualAssets\(\)/);
  assert.match(nativeBuilder, /cloud-only/);
});

test('streamed stations have readable modules and low-cost ambient animation', () => {
  const world = read('SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts');
  const lowOutpost = path.join(root, 'SpaceFight-Cocos/assets/resources/models-low/stations/outpost.glb');
  const highOutpost = path.join(root, 'SpaceFight-Cocos/assets/resources/models/stations/outpost.glb');
  for (const outpost of [lowOutpost, highOutpost]) {
    assert.ok(fs.existsSync(outpost));
    assert.ok(fs.statSync(outpost).size > 300_000);
    const outpostBinary = fs.readFileSync(outpost).toString('latin1');
    for (const marker of ['Outpost_InteriorGeometry', 'supports_visible_interior']) {
      assert.match(outpostBinary, new RegExp(marker));
    }
  }
  assert.ok(fs.statSync(highOutpost).size > fs.statSync(lowOutpost).size * 1.05);
  assert.match(fs.readFileSync(lowOutpost).toString('latin1'), /SF_Outpost_LowV2/);
  const highBinary = fs.readFileSync(highOutpost).toString('latin1');
  assert.match(highBinary, /SF_Outpost_HighV2/);
  assert.match(highBinary, /exterior_shell_only/);
  assert.match(world, /models\/stations\/outpost\/outpost/);
  assert.match(world, /DetailedOutpostGLB/);
  assert.match(world, /fallbackExterior/);
  for (const moduleName of ['DockingArm', 'StationHub', 'StationAntenna', 'Radiator', 'Beacon']) {
    assert.match(world, new RegExp(moduleName));
  }
  assert.match(world, /animateStations/);
  assert.match(world, /StationRing\.UpperAssembly/);
  assert.match(world, /StationRing\.LowerAssembly/);
  assert.match(world, /Math\.sin\(this\.stationAnimationTime/);
  for (const structuralPart of [
    'StationArmorShell',
    'HangarMouth',
    'HangarGuidance',
    'InteriorDeck',
    'InteriorCorridor',
    'InteriorBulkheadDoor',
    'InteriorCover',
    'CommandDeck',
  ]) {
    assert.match(world, new RegExp(structuralPart));
  }
});

test('streamed sectors include varied low-cost space facilities', () => {
  const world = read('SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts');
  for (const facility of ['CargoDepot', 'JumpGate', 'RelayBeacon', 'DerelictHull', 'RefineryArray', 'DefensePlatform']) {
    assert.match(world, new RegExp(facility));
  }
  assert.match(world, /const facilityChunk = !stationChunk && facilityIndex < 6/);
  assert.match(world, /child\.active = facilityChunk && index === facilityIndex/);
  assert.match(world, /JumpGate\.Ring/);
  assert.match(world, /RelayBeacon\.Light/);
});

test('native combat HUD renders graphical resource and target bars with actual hit confirmation', () => {
  for (const node of ['HullStatusBar', 'ShieldStatusBar', 'EnergyStatusBar', 'TargetHealthBar', 'HitMarker']) {
    assert.match(hud, new RegExp(node));
  }
  assert.match(hud, /drawResourceBar/);
  assert.match(hud, /drawTargetHealth/);
  assert.match(hud, /snapshot\.combatEvents/);
  assert.match(hud, /event\.type === 'hit'/);
  assert.match(hud, /event\.type === 'destroyed'/);
  assert.match(hud, /event\.type === 'wave-start'/);
  assert.match(hud, /hitFeedbackFrames/);
  assert.match(hud, /CombatFeedLabel/);
  assert.match(bootstrap, /CombatFeedbackPresenter/);
  assert.match(bootstrap, /pendingBrowserCombatEvents/);
  assert.match(bootstrap, /combatEvents: this\.pendingBrowserCombatEvents/);
});

test('cockpit and outpost interaction are complete gameplay surfaces', () => {
  for (const cockpitPart of [
    'Cockpit.Console.Left',
    'Cockpit.Console.Right',
    'Cockpit.Display.Left',
    'Cockpit.Display.Right',
    'Cockpit.Throttle.Handle',
    'Cockpit.SwitchBank',
    'Cockpit.Button.Left',
    'Cockpit.CanopyRail.Left',
    'Cockpit.CanopyHeader',
    'Cockpit.ControlStick.Grip',
    'Cockpit.StatusStrip',
  ]) assert.match(bootstrap, new RegExp(cockpitPart.replaceAll('.', '\\.')));
  assert.match(hud, /OutpostNavigationLabel/);
  assert.match(hud, /navigation\.canDock/);
  assert.match(hud, /public enterOutpost\(\)/);
  assert.match(hud, /NativeOutpostPanel/);
  assert.match(hud, /NativeOutpostUndock/);
  assert.match(hud, /NativeOutpostOpenLoadout/);
  assert.match(hud, /setOutpostOpen\(true\)/);
  assert.doesNotMatch(hud.match(/public enterOutpost\(\): void \{[\s\S]*?\n  \}/)?.[0] || '', /setHomeOpen\(true\)/);
  assert.match(bootstrap, /command\.returnRequested && this\.snapshot\.navigation\.canDock/);
  assert.match(bootstrap, /spacefight:outpost-entered/);
});

test('native loadout is a hangar bench rather than a five-column cycle grid', () => {
  assert.match(hud, /NativeLoadoutHangarArt/);
  assert.match(hud, /NativeLoadoutSlotRail/);
  assert.match(hud, /NativeLoadoutDetail/);
  assert.match(hud, /NativeLoadoutShipSchematic/);
  assert.match(hud, /slot === this\.selectedLoadoutSlot \? HUD_ACTIVE : HUD_CYAN/);
  assert.match(hud, /const ultraCompact = usableHeight < 400/);
  assert.match(hud, /const columns = compact && usableWidth < 650 \? 3 : 4/);
  assert.match(hud, /availableGridHeight/);
  assert.doesNotMatch(hud, /const columns = usableWidth >= 360 \? 5 : 3/);
});

test('native home and loadout layouts constrain short landscape phones', () => {
  assert.match(hud, /const ultraCompact = this\.height < 410 \|\| this\.width < 720/);
  assert.match(hud, /const missionBottom = actionY \+ \(actionHeight \/ 2\) \+ 6/);
  assert.match(hud, /\(available - \(\(this\.settingsButtons\.length - 1\) \* gap\)\) \/ this\.settingsButtons\.length/);
  assert.match(hud, /const ultraCompact = usableHeight < 400/);
});

test('station interior has readable service, cargo, and structural zones', () => {
  const world = read('SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts');
  for (const part of [
    'InteriorWallRib',
    'InteriorCeilingRail',
    'InteriorServiceKiosk',
    'InteriorServiceKiosk.Screen',
    'InteriorWorkbench',
    'InteriorCargoRack',
    'InteriorLandingMark',
  ]) assert.match(world, new RegExp(part.replaceAll('.', '\\.')));
});

test('native settings persist and rebuild the Cocos input bridge', () => {
  assert.match(hud, /NativeSettingsSensitivity/);
  assert.match(hud, /NativeSettingsInvertY/);
  assert.match(hud, /NativeSettingsHanded/);
  assert.match(hud, /NativeSettingsControlScale/);
  assert.match(hud, /NativeSettingsCheckUpdate/);
  assert.match(hud, /requestNativeUpdateCheck/);
  assert.match(bootstrap, /saveInputSettings\(sys\.localStorage/);
  assert.match(bootstrap, /initializeCocosInput\(\)/);
  assert.match(bootstrap, /loadInputSettings\(sys\.localStorage\)/);
});

test('imported GLBs use baked geometry detail and runtime skin materials', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');
  const refinement = read('SpaceFight-Cocos/tools/refine-ship-glbs.py');
  assert.doesNotMatch(ships, /installProceduralDetail/);
  assert.match(ships, /SKIN_ACCENTS/);
  assert.match(ships, /ENEMY_LIVERIES/);
  assert.match(ships, /applyLivery/);
  assert.match(ships, /kind === 'suppressor'\) return 'gunship'/);
  assert.match(ships, /kind === 'elite'\) return 'fighter'/);
  assert.match(refinement, /SF_GeometryV2/);
  assert.match(refinement, /SF_WeaponPod/);
  assert.match(refinement, /SF_EngineNozzle/);
});

test('cockpit camera stays on the ship socket and follows hull attitude', () => {
  const ships = read('SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts');
  assert.match(ships, /socket_camera_cockpit/);
  assert.match(ships, /get cockpitWorldPosition/);
  assert.match(bootstrap, /createCockpitInterior/);
  assert.match(bootstrap, /aimYaw: player\.yaw/);
  assert.match(bootstrap, /desired\.x \+ hullForward\.x \* 80/);
  assert.doesNotMatch(bootstrap, /cockpit[\s\S]{0,500}lookAt\(new Vec3\(\s*snapshot\.aimPoint/);
});
