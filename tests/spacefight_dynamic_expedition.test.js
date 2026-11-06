const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Cocos expedition presents a return decision before continuing deeper', () => {
  const simulation = read('SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts');
  const director = read('SpaceFight-Cocos/assets/scripts/core/ExpeditionDirector.ts');
  assert.match(simulation, /EXPEDITION_SECTORS[\s\S]*碎光航道[\s\S]*寂静船坞[\s\S]*离子风暴眼[\s\S]*赤晶裂谷/);
  assert.match(simulation, /ExpeditionDirector/);
  assert.match(simulation, /returnRequested/);
  assert.match(simulation, /expedition\.phase === 'decision'/);
  assert.match(simulation, /this\.expedition\.continueExpedition\(\)/);
  assert.match(simulation, /this\.wave \+= 1/);
  assert.match(director, /phase = 'decision'/);
  assert.match(director, /RETURN_SECONDS = 6/);
});

test('enemy projectiles originate from enemies and can damage shield and hull', () => {
  const simulation = read('SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts');
  const presenter = read('SpaceFight-Cocos/assets/scripts/game/ProjectilePresenter.ts');
  assert.match(simulation, /owner: 'enemy'/);
  assert.match(simulation, /this\.player\.spawnProtection > 0/);
  assert.match(simulation, /this\.player\.shield -= shieldDamage/);
  assert.match(simulation, /this\.player\.health = Math\.max/);
  assert.match(presenter, /owner === 'enemy'/);
  assert.match(presenter, /enemyMaterial/);
});

test('streamed world recycles around the pilot without an arena boundary', () => {
  const world = read('SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts');
  const bootstrap = read('SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts');
  assert.match(world, /export const CHUNK_SIZE/);
  assert.match(world, /export const RECYCLE_RADIUS/);
  assert.match(world, /this\.activeChunks\.delete/);
  assert.match(world, /this\.chunkPool\.push/);
  assert.match(world, /gridX === 0 && gridZ === 0/);
  assert.match(world, /const stationChunk = isSpawnChunk \|\|/);
  assert.match(world, /chunk\.station\.active = stationChunk/);
  assert.match(world, /chunk\.debris\.active = isSpawnChunk \|\| \(!stationChunk && !facilityChunk\)/);
  assert.match(world, /this\.createStationArchitecture\(station\)/);
  assert.match(world, /'HangarMouth'/);
  assert.match(world, /'StationInterior'/);
  assert.match(world, /'InteriorCorridor'/);
  assert.match(world, /`InteriorCover\.\$\{index \+ 1\}`/);
  assert.match(world, /ApproachCover\.\$\{index \+ 1\}/);
  assert.match(world, /APPROACH_COVER_LAYOUT/);
  assert.match(world, /debrisCollidersPerChunk\[index\]/);
  assert.match(world, /if \(this\.profile\.detailedOutpost\) this\.loadDetailedOutpost\(\)/);
  assert.match(world, /'OutpostApproach'/);
  for (const facility of ['RefineryArray', 'DefensePlatform']) {
    assert.match(world, new RegExp(facility));
  }
  assert.doesNotMatch(world, /arenaBoundary|worldBoundary|clampPlayer/);
  assert.match(bootstrap, /this\.worldStreamer\?\.update\(this\.shipPresenter\.player\.worldPosition, deltaTime\)/);
});

test('native local battles keep ranged enemy fire enabled', () => {
  const android = read('ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt');
  const apple = read('apps/SpaceFightShared/NativeGameScene.swift');
  const harmony = read('HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets');
  const harmonyOffline = read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets');
  for (const source of [android, apple, harmony, harmonyOffline]) {
    assert.match(source, /enemyProjectile|enemyBullets|hostileProjectile|enemyFire/i);
  }
});
