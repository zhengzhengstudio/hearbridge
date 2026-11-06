'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const catalog = fs.readFileSync(path.join(root, 'SpaceFight-Cocos/assets/scripts/core/WeaponCatalog.ts'), 'utf8');
const simulation = fs.readFileSync(path.join(root, 'SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts'), 'utf8');
const world = fs.readFileSync(path.join(root, 'SpaceFight-Cocos/assets/scripts/game/WorldStreamer.ts'), 'utf8');

test('starter primary weapons reach mission engagement distances', () => {
  for (const id of ['pulse', 'scatter', 'missile', 'rail', 'plasma']) {
    const match = catalog.match(new RegExp(`${id}: \\{[^}]*speed: ([\\d.]+), life: ([\\d.]+)`));
    assert.ok(match, `missing ${id}`);
    assert.ok(Number(match[1]) * Number(match[2]) >= 120, `${id} range remains too short`);
  }
});

test('player projectiles use swept collision and broader distance-scaled aim assistance', () => {
  assert.match(simulation, /segmentDistanceToPoint/);
  assert.match(simulation, /const previousPosition = cloneVector\(projectile\.position\)/);
  assert.match(simulation, /segmentDistanceToPoint\(previousPosition, projectile\.position, enemy\.position\)/);
  assert.match(simulation, /depth \* 0\.055/);
  assert.match(simulation, /guidePlayerProjectile/);
  assert.match(simulation, /lockAssist/);
});

test('the initial world contains a recognizable outpost landmark', () => {
  assert.match(world, /OutpostApproach/);
  assert.match(world, /PRIMARY_OUTPOST_POSITION/);
  assert.match(simulation, /OUTPOST_DOCKING_RADIUS/);
  assert.match(simulation, /canDock:/);
});
