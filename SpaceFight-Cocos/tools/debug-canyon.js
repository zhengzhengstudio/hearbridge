'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const projectRoot = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-dbg-'));
const args = [
  '--yes', '--package', 'typescript@4.9.5', 'tsc',
  '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--skipLibCheck', '--lib', 'ES2020,DOM',
  '--rootDir', path.join(projectRoot, 'assets', 'scripts'),
  '--outDir', out,
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightCommand.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightAttitude.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightTuning.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'ExpeditionDirector.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'EnemyBehaviorSystem.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'LootAndCargoSystem.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'WeaponCatalog.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'CombatSimulation.ts'),
];
const c = spawnSync('npx', args, { cwd: projectRoot, encoding: 'utf8' });
if (c.status !== 0) { console.error(c.stdout, c.stderr); process.exit(1); }

const core = require(path.join(out, 'core', 'CombatSimulation.js'));
const sim = new core.CombatSimulation({
  mission: {
    id: 'outpost-docking',
    enemies: [{ id: 'distant-contact', position: { x: 120, y: 40, z: 60 }, health: 100 }],
    objective: { type: 'eliminate', requiredKills: 1 },
  },
  seed: 121,
});
sim.step({ yaw: 0.7 }, 1/60);
for (let i = 0; i < 600; i++) sim.step({ throttle: 1 }, 1/60);
const s = sim.snapshot ? sim.snapshot() : sim.step({ throttle: 0 }, 0);
console.log('player pos', s.player.position);
console.log('health', s.player.health, 'shield', s.player.shield);
console.log('navigation', JSON.stringify(s.navigation));
console.log('mission status', s.mission.status);
console.log('speedScale', s.player.speedScale, 'speedMultiplier', s.player.speedMultiplier);
console.log('elapsed', s.elapsed, 'tick', s.tick);
console.log('region', JSON.stringify(s.mission.region));
