'use strict';
/**
 * 玩法扩展验证脚本
 *
 * 目的：证明「玩法真的变多样了」，而不是只改了类型定义。
 * 逐项实测：
 *  1. 6 个任务 preset 都能跑，且各自的目标类型/进度行为不同
 *  2. 4 个区域规则（峡谷/风暴/残骸带/开阔）真的产生不同机制
 *  3. 拾取物种类真的生效（repair 回血 / shield 补盾 / loot 进货舱）
 *  4. defense 敌人会扑核心、escort 敌人会打运输船
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const projectRoot = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-play-'));
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

function makeSim(mission, seed = 4242) {
  return new core.CombatSimulation({ mission, seed });
}
function run(sim, command, frames) {
  let s;
  for (let i = 0; i < frames; i += 1) s = sim.step(command, 1 / 60);
  return s || sim.step(command, 1 / 60);
}

console.log('=========== 1) 六种任务目标类型 ===========');
const objectiveCases = [
  { type: 'eliminate', requiredKills: 3 },
  { type: 'collect', requiredKills: 3, cargoRatio: 0.5 },
  { type: 'survive', surviveSeconds: 30 },
  { type: 'hunt', requiredKills: 4, eliteKind: 'gunship' },
  { type: 'defense', surviveSeconds: 40, defensePoint: { x: 22, y: -6, z: -72 }, defenseRadius: 40 },
  { type: 'escort', surviveSeconds: 40, escortStart: { x: 0, y: 0, z: 20 }, escortFollowDistance: 46 },
];
for (const objective of objectiveCases) {
  const sim = makeSim({
    id: `t-${objective.type}`,
    enemies: [
      { id: 'e1', kind: 'scout', position: { x: 10, y: 0, z: -40 }, health: 40 },
      { id: 'e2', kind: 'fighter', position: { x: -12, y: 3, z: -50 }, health: 46 },
    ],
    pickups: [{ id: 'p1', kind: 'loot', position: { x: 0, y: 0, z: 0 }, value: 30 }],
    objective,
  });
  const s = run(sim, { throttle: 0.3 }, 600);
  const extra = objective.type === 'defense'
    ? `core=${JSON.stringify(s.mission.defensePoint)} r=${s.mission.defenseRadius}`
    : objective.type === 'escort'
      ? `convoy=${JSON.stringify(s.mission.escortPosition)} hp=${s.mission.escortHealth}`
      : '';
  console.log(`  ${objective.type.padEnd(9)} type=${s.mission.objectiveType.padEnd(9)} progress=${s.mission.progress}/${s.mission.progressTarget}  ${extra}`);
}

console.log('\n=========== 2) 四种区域规则 ===========');
for (const sector of [1, 2, 3, 4]) {
  const sim = makeSim({
    id: `r-${sector}`,
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 60, y: 0, z: -60 }, health: 40 }],
    objective: { type: 'eliminate', requiredKills: 1 },
  });
  // 强制切到指定扇区
  sim.sector = sector - 1;
  sim.regionId = ['canyon', 'storm', 'debris', 'open'][sector - 1];
  const s = run(sim, { throttle: 0.5 }, 240);
  console.log(`  sector ${sector} → region=${s.mission.region.id.padEnd(7)} "${s.mission.region.name}"  debris=${s.mission.debrisCount}  | ${s.mission.region.brief}`);
}

console.log('\n=========== 3) 拾取物效果 ===========');
{
  const sim = makeSim({
    id: 'pickups',
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
    pickups: [
      { id: 'r-repair', kind: 'repair', position: { x: 0, y: 0, z: 8 }, value: 28 },
    ],
    objective: { type: 'eliminate', requiredKills: 1 },
  });
  // 先把玩家打残（直接改状态），否则满血时看不出回复
  sim.player.health = 40;
  sim.player.shield = 0;
  const before = { player: { health: sim.player.health, shield: sim.player.shield } };
  const after = run(sim, {}, 60);
  console.log(`  repair : health ${before.player.health} → ${after.player.health} (max ${after.player.maxHealth})  collected=${after.player.pickupsCollected}  ← 应 +28`);
}
{
  const sim = makeSim({
    id: 'pickups2',
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
    pickups: [
      { id: 's-shield', kind: 'shield', position: { x: 0, y: 0, z: 8 }, value: 34 },
    ],
    objective: { type: 'eliminate', requiredKills: 1 },
  });
  sim.player.shield = 20;
  sim.player.health = 40;
  const before = { player: { health: sim.player.health, shield: sim.player.shield } };
  const after = run(sim, {}, 60);
  console.log(`  shield : shield ${before.player.shield} → ${after.player.shield} (max ${after.player.maxShield})  health ${before.player.health} → ${after.player.health}  ← 护盾应 +34`);
}
{
  const sim = makeSim({
    id: 'pickups3',
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
    pickups: [
      { id: 'l-loot', kind: 'loot', position: { x: 0, y: 0, z: 8 }, value: 30 },
      { id: 'd-data', kind: 'data', position: { x: 0, y: 0, z: 8 }, value: 64 },
    ],
    objective: { type: 'collect', requiredKills: 1, cargoRatio: 0.5 },
  });
  const after = run(sim, {}, 60);
  console.log(`  loot   : cargo slots=${after.cargo.usedSlots}/${after.cargo.capacity}  value=${after.cargo.items.map(i => i.category + ':' + i.rarity).join(',')}  progress=${after.mission.progress}/${after.mission.progressTarget}`);
}

console.log('\n=========== 4) 守点/护送的敌人职责分配 ===========');
{
  const sim = makeSim({
    id: 'def',
    enemies: [
      { id: 'raider-a', kind: 'scout', position: { x: 40, y: 0, z: -60 }, health: 40 },
      { id: 'raider-b', kind: 'scout', position: { x: -40, y: 0, z: -60 }, health: 40 },
      { id: 'raider-c', kind: 'scout', position: { x: 0, y: 0, z: -60 }, health: 40 },
      { id: 'raider-d', kind: 'scout', position: { x: 20, y: 0, z: -60 }, health: 40 },
    ],
    objective: { type: 'defense', surviveSeconds: 40, defensePoint: { x: 22, y: -6, z: -72 }, defenseRadius: 40 },
  });
  const s = run(sim, { throttle: 0 }, 120);
  const core = s.mission.defensePoint;
  const near = s.enemies ? s.enemies.filter(e => Math.hypot(e.position.x - core.x, e.position.z - core.z) < 60).length : 'n/a';
  console.log(`  defense: 4 架敌机中靠近核心(<60) 的 = ${near}  进度=${s.mission.progress}/${s.mission.progressTarget}`);
}
{
  const sim = makeSim({
    id: 'esc',
    enemies: [
      { id: 'raider-a', kind: 'scout', position: { x: 0, y: 0, z: -40 }, health: 40 },
      { id: 'raider-b', kind: 'scout', position: { x: 20, y: 0, z: -40 }, health: 40 },
      { id: 'raider-c', kind: 'scout', position: { x: -20, y: 0, z: -40 }, health: 40 },
    ],
    objective: { type: 'escort', surviveSeconds: 40, escortStart: { x: 0, y: 0, z: 20 }, escortFollowDistance: 46 },
  });
  const s = run(sim, { throttle: 1 }, 300);
  console.log(`  escort : 运输船 hp=${s.mission.escortHealth}  pos=${JSON.stringify(s.mission.escortPosition)}  进度=${s.mission.progress}/${s.mission.progressTarget}`);
}

console.log('\n=========== 5) 区域规则实际影响 ===========');
{
  // 峡谷：把玩家放到航道外 → 应该被推回并持续掉血
  // 伤害先扣护盾再扣血，所以要看「护盾+血量」的总损失
  const sim = makeSim({
    id: 'canyon-dmg',
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
    objective: { type: 'eliminate', requiredKills: 1 },
  });
  sim.regionId = 'canyon';
  sim.player.position.x = 200;   // 远在航道外
  const before = run(sim, {}, 1);
  const after = run(sim, {}, 120);
  const lost = (before.player.health + before.player.shield) - (after.player.health + after.player.shield);
  console.log(`  canyon : hp ${before.player.health}→${after.player.health}  shield ${before.player.shield.toFixed(1)}→${after.player.shield.toFixed(1)}  合计损失=${lost.toFixed(1)}  pos.x=${after.player.position.x.toFixed(1)} (边界 22±46)`);
}
{
  // 残骸带：应有残骸生成，且撞上掉血
  const sim = makeSim({
    id: 'debris',
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
    objective: { type: 'eliminate', requiredKills: 1 },
  });
  sim.regionId = 'debris';
  const s = run(sim, { throttle: 0.2 }, 300);
  console.log(`  debris : 生成残骸 ${s.mission.debrisCount} 块`);
}
{
  // 风暴：能量恢复变慢
  const make = (region) => {
    const sim = makeSim({
      id: 'storm',
      enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
      objective: { type: 'eliminate', requiredKills: 1 },
    });
    sim.regionId = region;
    sim.player.energy = 10;
    return sim;
  };
  const open = make('open');
  const storm = make('storm');
  const openS = run(open, {}, 300);
  const stormS = run(storm, {}, 300);
  console.log(`  storm  : 能量恢复 open=${openS.player.energy}  storm=${stormS.player.energy}（风暴应更慢 → 恢复更少）`);
}
{
  // 残骸撞击掉血：把玩家直接放到残骸上
  const sim = makeSim({
    id: 'debris-hit',
    enemies: [{ id: 'e1', kind: 'scout', position: { x: 500, y: 0, z: 500 }, health: 40 }],
    objective: { type: 'eliminate', requiredKills: 1 },
  });
  sim.regionId = 'debris';
  const before = run(sim, {}, 1);
  // 强制把一块残骸放到玩家身上
  const s0 = sim.step({}, 1 / 60);
  if (sim.debris && sim.debris.length) {
    sim.debris[0].position = { x: sim.player.position.x, y: sim.player.position.y, z: sim.player.position.z };
  }
  const after = run(sim, {}, 30);
  const lost = (before.player.health + before.player.shield) - (after.player.health + after.player.shield);
  console.log(`  debris : 撞击伤害 合计损失=${lost.toFixed(1)}（残骸 ${s0.mission.debrisCount} 块）`);
}
