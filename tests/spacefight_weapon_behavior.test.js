'use strict';

/**
 * 武器行为差异化回归测试（0.13.13 之后）。
 *
 * 这里验证的是「打法真的不同」，不是只检查类型定义：
 * 编译后的 CombatSimulation 会被真实跑起来，实测多弹扇形、贯穿、
 * 范围溅射、干扰减速与默认装配的逐值不变。
 * 必须通过 `npm run test:simulation` 提供 SPACEFIGHT_COCOS_COMPILED_CORE。
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const cocosProjectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const compiledCoreRoot = process.env.SPACEFIGHT_COCOS_COMPILED_CORE;

assert.ok(compiledCoreRoot, 'Run this suite through npm run test:simulation');

const core = {
  ...require(path.join(compiledCoreRoot, 'FlightCommand.js')),
  ...require(path.join(compiledCoreRoot, 'WeaponCatalog.js')),
  ...require(path.join(compiledCoreRoot, 'CombatSimulation.js')),
};

const source = (relative) => readFileSync(path.join(cocosProjectRoot, relative), 'utf8');

function missionWith(enemies) {
  return {
    id: 'weapon-behavior',
    seed: 1337,
    enemies,
    pickups: [],
    objective: { type: 'eliminate', requiredKills: Math.max(1, enemies.length) },
  };
}

function makeSimulation(loadout, enemies) {
  return new core.CombatSimulation({
    mission: missionWith(enemies),
    seed: 1337,
    ...(loadout ? { loadout } : {}),
  });
}

/** 第一帧开火一次，之后只推进时间；把每帧事件流累积起来便于断言命中顺序。 */
function simulate(loadout, enemies, frames = 90) {
  const sim = makeSimulation(loadout, enemies);
  const events = [];
  let snapshot = sim.step({ primaryFire: true }, 1 / 60);
  events.push(...snapshot.combatEvents);
  for (let frame = 1; frame < frames; frame += 1) {
    snapshot = sim.step({}, 1 / 60);
    events.push(...snapshot.combatEvents);
  }
  return { sim, snapshot, events };
}

const targetAt = (id, x, z) => ({ id, kind: 'scout', position: { x, y: 0, z }, health: 300 });

test('行为表按真实弹丸 id 分配，未知武器安全回退到常规', () => {
  assert.equal(core.behaviorForWeaponId('pulse').kind, 'standard');
  assert.equal(core.behaviorForWeaponId('scatter').kind, 'spread');
  assert.equal(core.behaviorForWeaponId('rail').kind, 'pierce');
  assert.equal(core.behaviorForWeaponId('plasma').kind, 'splash');
  assert.equal(core.behaviorForWeaponId('ion').kind, 'jam');
  assert.equal(core.behaviorForWeaponId('missile').kind, 'homing');
  assert.equal(core.behaviorForWeaponId('missile-primary').homingTurnRate, 7.5);
  assert.equal(core.behaviorForWeaponId('swarm').pelletCount, 3);
  assert.equal(core.behaviorForWeaponId('unknown-weapon').kind, 'standard');
  assert.equal(core.PRIMARY_WEAPON_BEHAVIORS.pulse.kind, 'standard');
  assert.equal(core.SECONDARY_WEAPON_BEHAVIORS.missile.homingTurnRate, 7.5);
});

test('散射炮一次开火发 3 发扇形弹；常规脉冲炮与默认副武器仍是单发', () => {
  const scatter = makeSimulation(
    { weapon: 'scatter' },
    [targetAt('a', 0, -8)],
  ).step({ primaryFire: true }, 1 / 60);
  const pellets = scatter.projectiles.filter((projectile) => projectile.owner === 'player');
  assert.equal(pellets.length, 3, '散射炮必须一次发射三发');
  assert.ok(pellets.every((projectile) => projectile.weapon === 'scatter'));
  const headings = pellets.map((projectile) => Math.atan2(projectile.velocity.x, projectile.velocity.z));
  assert.equal(new Set(headings.map((heading) => heading.toFixed(4))).size, 3, '三发方向必须不同');
  const speeds = pellets.map((projectile) => Math.hypot(
    projectile.velocity.x, projectile.velocity.y, projectile.velocity.z,
  ));
  // 快照里的向量会被 rounded() 逐分量取整，三发方向不同会有 ±0.001 级差异；
  // 这里校验「都等于该武器标称速度」而不是要求逐位浮点相等。
  const nominalSpeed = core.PRIMARY_WEAPONS.scatter.speed;
  assert.ok(speeds.every((speed) => Math.abs(speed - nominalSpeed) < 0.05),
    `三发速度都应约为 ${nominalSpeed}，实际 ${speeds.join(', ')}`);
  assert.ok(pellets.every((projectile) => projectile.pierceLeft === undefined
    && projectile.splashRadius === undefined && projectile.jamSeconds === undefined));

  const baseline = makeSimulation(undefined, [targetAt('a', 0, -8)])
    .step({ primaryFire: true, secondaryFire: true }, 1 / 60);
  assert.equal(baseline.projectiles.length, 2, '默认装配仍是一主一副共两发');
  assert.equal(baseline.projectiles[0].weapon, 'pulse');
  assert.equal(baseline.projectiles[1].weapon, 'missile');
  assert.ok(baseline.projectiles.every((projectile) => projectile.pierceLeft === undefined
    && projectile.splashRadius === undefined && projectile.jamSeconds === undefined),
  '常规弹的快照结构必须与改造前逐键一致');
});

test('磁轨炮命中后不消失，能贯穿后排目标且伤害逐次衰减', () => {
  const { events } = simulate({ weapon: 'rail' }, [
    targetAt('front', 0, -8),
    targetAt('back', 0, -14),
  ]);
  const hits = events.filter((event) => event.type === 'hit' && event.source === 'player');
  const front = hits.find((event) => event.targetId === 'front');
  const back = hits.find((event) => event.targetId === 'back');
  assert.ok(front, '第一个目标必须被命中');
  assert.ok(back, '穿透弹必须继续命中第二个目标');
  assert.ok(back.damage < front.damage, '贯穿后伤害应衰减');
  assert.ok(hits.filter((event) => event.targetId === 'front').length <= 1,
    '同一发穿透弹不能在同一目标上反复结算');
});

test('等离子炮命中时对附近敌人造成范围伤害', () => {
  const { events } = simulate({ weapon: 'plasma' }, [
    targetAt('primary', 0, -8),
    targetAt('nearby', 1.6, -8),
  ]);
  const hits = events.filter((event) => event.type === 'hit' && event.source === 'player');
  assert.ok(hits.some((event) => event.targetId === 'primary'), '主目标必须被命中');
  assert.ok(hits.some((event) => event.targetId === 'nearby'), '溅射必须波及旁边的敌人');
  const splash = hits.find((event) => event.targetId === 'nearby');
  const direct = hits.find((event) => event.targetId === 'primary');
  assert.ok(splash.damage < direct.damage, '溅射伤害应低于直击');
});

test('离子连炮命中后给目标施加有时限的干扰，到期自动失效', () => {
  const { sim, events } = simulate({ weapon: 'ion' }, [targetAt('jammed', 0, -8)], 40);
  const enemy = sim.enemies.find((candidate) => candidate.id === 'jammed');
  assert.ok(events.some((event) => event.type === 'hit' && event.targetId === 'jammed'),
    '离子炮必须先命中目标');
  assert.ok(enemy.jammedUntil > sim.elapsed, '命中后应进入干扰状态');
  assert.equal(enemy.jamSpeedScale, 0.55);
  assert.equal(enemy.jamFireRateScale, 0.6);
  for (let frame = 0; frame < 200; frame += 1) sim.step({}, 1 / 60);
  assert.ok((enemy.jammedUntil ?? 0) <= sim.elapsed, '干扰必须自动到期，不能永久减速');
});

test('蜂群导弹 = 多弹 + 制导；重型鱼雷只带溅射不带多弹', () => {
  assert.equal(core.SECONDARY_WEAPON_BEHAVIORS.swarm.pelletCount, 3);
  assert.ok(core.SECONDARY_WEAPON_BEHAVIORS.swarm.homingTurnRate > 0);
  assert.equal(core.SECONDARY_WEAPON_BEHAVIORS.torpedo.kind, 'splash');
  assert.equal(core.SECONDARY_WEAPON_BEHAVIORS.torpedo.pelletCount, undefined);
  const swarm = makeSimulation(
    { secondary: 'swarm' },
    [targetAt('a', 0, -8)],
  ).step({ secondaryFire: true }, 1 / 60);
  assert.equal(swarm.projectiles.filter((projectile) => projectile.weapon === 'swarm').length, 3);
});

test('装配台、Web 装配台与 8 语言本地化都接入了武器行为标签', () => {
  const localization = source('assets/scripts/ui/Localization.ts');
  const keys = [
    'behavior.standard', 'behavior.spread', 'behavior.pierce',
    'behavior.splash', 'behavior.homing', 'behavior.jam',
  ];
  for (const key of keys) {
    const pattern = new RegExp(`'${key.replace('.', '\\.')}'`, 'g');
    const count = (localization.match(pattern) || []).length;
    assert.equal(count, 8, `${key} 必须覆盖全部 8 种语言`);
  }
  const hud = source('assets/scripts/game/NativeCombatHud.ts');
  assert.match(hud, /PRIMARY_WEAPON_BEHAVIORS/);
  assert.match(hud, /SECONDARY_WEAPON_BEHAVIORS/);
  assert.match(hud, /behavior\.labelKey as CombatMessageKey/);
  for (const directory of ['web-desktop', 'web-mobile']) {
    const shell = source(`build-templates/${directory}/spacefight-shell.js`);
    assert.match(shell, /const weaponBehaviors =/);
    assert.match(shell, /主炮打法/);
  }
  const simulationSource = source('assets/scripts/core/CombatSimulation.ts');
  assert.match(simulationSource, /applyPlayerProjectileHit/);
  assert.match(simulationSource, /projectile\.targetId = undefined/,
    '穿透后必须清除锁定，否则制导会把弹丸绕回已命中目标');
});
