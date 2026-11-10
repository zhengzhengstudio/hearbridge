'use strict';

/**
 * 战术设备主动技能差异化回归测试（玩法差异化第二阶段）。
 *
 * 与武器行为测试一样，这里跑的是编译后的真实 CombatSimulation：
 * 实测 8 个设备技能的效果彼此不同、边沿触发、冷却与能量门槛、
 * 以及「不按技能键时逐值不变」这条基线约束。
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
const DT = 1 / 60;

function missionWith(enemies, pickups = []) {
  return {
    id: 'device-ability',
    seed: 1337,
    enemies,
    pickups,
    objective: { type: 'eliminate', requiredKills: Math.max(1, enemies.length) },
  };
}

function makeSimulation(loadout, enemies = [], pickups = []) {
  return new core.CombatSimulation({
    mission: missionWith(enemies, pickups),
    seed: 1337,
    ...(loadout ? { loadout } : {}),
  });
}

const targetAt = (id, x, z) => ({ id, kind: 'scout', position: { x, y: 0, z }, health: 300 });

function advance(sim, frames, input = {}) {
  let snapshot = sim.step(input, DT);
  const events = [...snapshot.combatEvents];
  for (let frame = 1; frame < frames; frame += 1) {
    snapshot = sim.step({}, DT);
    events.push(...snapshot.combatEvents);
  }
  return { snapshot, events };
}

function trigger(sim, extraInput = {}) {
  return sim.step({ deviceAbility: true, ...extraInput }, DT);
}

/**
 * 快照刻意不暴露 damage（常规弹的快照结构必须逐键保持不变），
 * 所以从模拟内部读本帧刚发出的玩家弹丸。编译后 JS 没有 private 限制。
 */
function playerProjectileDamage(sim) {
  const projectile = sim.projectiles.find((candidate) => candidate.owner === 'player');
  assert.ok(projectile, '本帧必须发出一发玩家弹丸');
  return projectile.damage;
}

const DEVICE_IDS = [
  'targeter', 'repair', 'fabricator', 'collector',
  'aegis', 'jammer', 'overclock', 'decoy',
];

test('技能表覆盖全部 8 个战术设备，效果类型互不相同，未知 id 回退默认设备', () => {
  assert.deepEqual(Object.keys(core.DEVICE_ABILITIES).sort(), [...DEVICE_IDS].sort());
  const kinds = DEVICE_IDS.map((id) => core.DEVICE_ABILITIES[id].kind);
  assert.equal(new Set(kinds).size, 8, '8 个设备不能共用同一个效果类型');
  for (const id of DEVICE_IDS) {
    const definition = core.DEVICE_ABILITIES[id];
    assert.equal(definition.id, id);
    assert.ok(definition.cooldown > 0, `${id} 必须有冷却`);
    assert.ok(definition.labelKey.startsWith('ability.'));
  }
  assert.equal(core.deviceAbilityFor('not-a-device').id, core.DEFAULT_LOADOUT.device);
});

test('不按技能键时技能保持就绪、不发事件、弹丸伤害与改造前一致', () => {
  const idle = makeSimulation(undefined, [targetAt('a', 0, -8)]);
  const snap = idle.step({ primaryFire: true }, DT);
  assert.equal(snap.deviceAbility.active, false);
  assert.equal(snap.deviceAbility.ready, true);
  assert.equal(snap.deviceAbility.cooldownRemaining, 0);
  assert.equal(snap.deviceAbility.remaining, 0);
  assert.ok(!snap.combatEvents.some((event) => event.type === 'device-activated'));
  const effects = idle.abilityEffects();
  assert.deepEqual(effects, {
    damage: 1, fireRate: 1, energyCost: 1, speed: 1,
    incomingDamage: 1, shieldRecharge: 1, regen: 0,
  }, '未激活时所有接入点必须是恒等元');

  // 同种子、同输入、不按键 = 改造前的基线伤害，技能系统不能偷偷改数值。
  const baselineSim = makeSimulation(undefined, [targetAt('a', 0, -8)]);
  baselineSim.step({ primaryFire: true }, DT);
  assert.equal(playerProjectileDamage(idle), playerProjectileDamage(baselineSim));
});

test('技能是上升沿触发：长按不连发，冷却中按键静默失败，冷却结束后可再次释放', () => {
  const sim = makeSimulation({ device: 'targeter' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 100;
  const first = sim.step({ deviceAbility: true }, DT);
  assert.equal(first.combatEvents.filter((e) => e.type === 'device-activated').length, 1);
  assert.equal(first.deviceAbility.active, true);
  const energyAfterFirst = sim.player.energy;

  // 一直按住：不再扣能量、不再发事件、也不会把持续时间重新拉满。
  let heldEvents = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    heldEvents += sim.step({ deviceAbility: true }, DT)
      .combatEvents.filter((e) => e.type === 'device-activated').length;
  }
  assert.equal(heldEvents, 0, '长按不能连发');
  assert.ok(sim.player.energy >= energyAfterFirst - 0.001,
    '长按不能重复扣能量（能量自然回充只会让它增加）');
  assert.ok(sim.deviceRemaining < core.DEVICE_ABILITIES.targeter.duration,
    '长按不能把持续时间重新拉满');

  // 冷却期间即便松开再按也不触发（此时技能已结束但 CD 未走完）。
  sim.step({}, DT);
  const denied = sim.step({ deviceAbility: true }, DT);
  assert.equal(denied.combatEvents.filter((e) => e.type === 'device-activated').length, 0);
  assert.ok(denied.deviceAbility.cooldownRemaining > 0);

  // 冷却走完 + 松开后重新按下，可以再次释放。
  sim.step({}, DT);
  const waited = advance(sim, 900);
  assert.ok(waited.snapshot.deviceAbility.ready, '冷却结束后应恢复就绪');
  const second = trigger(sim);
  assert.equal(second.combatEvents.filter((e) => e.type === 'device-activated').length, 1);
});

test('能量不足时技能静默失败：不扣能量、不进冷却、不发事件', () => {
  const sim = makeSimulation({ device: 'aegis' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 1;
  const before = sim.player.energy;
  const snap = trigger(sim);
  assert.equal(snap.combatEvents.filter((e) => e.type === 'device-activated').length, 0);
  assert.equal(snap.deviceAbility.active, false);
  assert.equal(snap.deviceAbility.cooldownRemaining, 0);
  assert.ok(sim.player.energy >= before - 0.001,
    '静默失败不能扣能量（能量自然回充只会让它增加）');
});

test('火控锁定把弹丸伤害放大到 1.55 倍；其它设备不改变伤害', () => {
  const baselineSim = makeSimulation(undefined, [targetAt('a', 0, -8)]);
  baselineSim.step({ primaryFire: true }, DT);
  const baseline = playerProjectileDamage(baselineSim);

  const locked = makeSimulation({ device: 'targeter' }, [targetAt('a', 0, -8)]);
  locked.player.energy = 100;
  trigger(locked, { primaryFire: true });
  assert.ok(Math.abs(playerProjectileDamage(locked) / baseline - 1.55) < 0.001);

  const repaired = makeSimulation({ device: 'repair' }, [targetAt('a', 0, -8)]);
  repaired.player.energy = 100;
  trigger(repaired, { primaryFire: true });
  // 抢修技能不应该顺带加伤害：与「同样装抢修设备但不按键」逐值对比，
  // 不能拿默认设备比 —— 8 个设备本来就各有不同的被动倍率。
  const idleRepair = makeSimulation({ device: 'repair' }, [targetAt('a', 0, -8)]);
  idleRepair.player.energy = 100;
  idleRepair.step({ primaryFire: true }, DT);
  assert.equal(playerProjectileDamage(repaired), playerProjectileDamage(idleRepair),
    '抢修技能不应该顺带加伤害');
});

test('应急抢修立即回血并在持续时间内持续再生，到期后回到基准再生', () => {
  const sim = makeSimulation({ device: 'repair' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 100;
  sim.player.health = 40;
  const definition = core.DEVICE_ABILITIES.repair;
  const snap = trigger(sim);
  assert.ok(sim.player.health >= 40 + definition.immediate - 0.01,
    `立即回血 ${definition.immediate}，实际 ${sim.player.health}`);
  assert.equal(snap.deviceAbility.active, true);
  assert.equal(sim.abilityEffects().regen, definition.magnitude);

  const during = sim.player.health;
  advance(sim, 60);
  assert.ok(sim.player.health > during, '持续期间应继续再生');

  advance(sim, 400);
  assert.equal(sim.abilityEffects().regen, 0, '技能到期后不能再有额外再生');
  assert.equal(sim.deviceRemaining, 0);
});

test('能量灌注立即回满并让持续期能耗减半', () => {
  const sim = makeSimulation({ device: 'fabricator' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 9;
  const snap = trigger(sim);
  assert.equal(sim.player.energy, sim.player.maxEnergy, '应立刻回满能量');
  assert.equal(sim.abilityEffects().energyCost, core.DEVICE_ABILITIES.fabricator.magnitude);
  assert.equal(snap.deviceAbility.active, true);
});

test('护盾过载立即补盾并降低受到的伤害', () => {
  const sim = makeSimulation({ device: 'aegis' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 100;
  sim.player.shield = 0;
  const definition = core.DEVICE_ABILITIES.aegis;
  trigger(sim);
  assert.ok(sim.player.shield >= definition.immediate - 0.01,
    `立即补盾 ${definition.immediate}，实际 ${sim.player.shield}`);
  assert.equal(sim.abilityEffects().incomingDamage, definition.magnitude);
});

test('牵引脉冲把半径内货物拉进舱并走正常拾取结算', () => {
  const sim = makeSimulation({ device: 'collector' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 100;
  const origin = { ...sim.player.position };
  sim.pickups = [{
    id: 'far-cargo',
    kind: 'energy',
    position: { x: origin.x + 18, y: origin.y, z: origin.z },
    value: 12,
  }];
  trigger(sim);
  assert.equal(sim.pickups.length, 0, '半径内货物必须被拉到脚下并结算掉');

  const control = makeSimulation({ device: 'targeter' }, [targetAt('a', 0, -8)]);
  control.player.energy = 100;
  control.pickups = [{
    id: 'outside',
    kind: 'energy',
    position: { x: origin.x + 60, y: origin.y, z: origin.z },
    value: 12,
  }];
  trigger(control);
  assert.equal(control.pickups.length, 1, '半径外货物不能被拉');
});

test('全域干扰减速并拖慢敌人开火；幻影诱饵让敌人停追停火', () => {
  const jam = makeSimulation({ device: 'jammer' }, [targetAt('jammed', 0, -8)]);
  jam.player.energy = 100;
  trigger(jam);
  const enemy = jam.enemies.find((candidate) => candidate.id === 'jammed');
  assert.ok(enemy.jammedUntil > jam.elapsed, '干扰窗口必须已生效');
  assert.equal(enemy.jamSpeedScale, core.DEVICE_ABILITIES.jammer.magnitude);
  assert.ok(enemy.jamFireRateScale < 1);

  const decoy = makeSimulation({ device: 'decoy' }, [targetAt('fooled', 0, -8)]);
  decoy.player.energy = 100;
  trigger(decoy);
  const fooled = decoy.enemies.find((candidate) => candidate.id === 'fooled');
  assert.ok(fooled.decoyUntil > decoy.elapsed, '诱饵窗口必须已生效');
  const before = { ...fooled.position };
  advance(decoy, 30);
  const moved = Math.hypot(
    fooled.position.x - before.x,
    fooled.position.y - before.y,
    fooled.position.z - before.z,
  );
  assert.ok(moved < 1.5, `诱饵期间敌人应基本停止追击，实际位移 ${moved.toFixed(2)}`);
});

test('极限超频换取射速与航速，但护盾停止回充（有代价的增益）', () => {
  const sim = makeSimulation({ device: 'overclock' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 100;
  trigger(sim);
  const effects = sim.abilityEffects();
  assert.equal(effects.fireRate, core.DEVICE_ABILITIES.overclock.magnitude);
  assert.ok(effects.speed > 1);
  assert.equal(effects.shieldRecharge, 0, '超频必须停掉护盾回充');
  assert.equal(effects.damage, 1, '超频不应该顺带加伤害');
});

test('离港重置清空技能冷却与增益，避免把上一趟状态带进新一局', () => {
  const sim = makeSimulation({ device: 'targeter' }, [targetAt('a', 0, -8)]);
  sim.player.energy = 100;
  trigger(sim);
  assert.ok(sim.deviceCooldown > 0);
  sim.resetDeviceAbility();
  assert.equal(sim.deviceCooldown, 0);
  assert.equal(sim.deviceRemaining, 0);
  assert.equal(sim.deviceActiveId, null);
  assert.equal(sim.deviceHeld, false);
  assert.deepEqual(sim.abilityEffects().damage, 1);
});

test('四端输入、HUD 与 8 语言标签都接上了主动技能', () => {
  const localization = source('assets/scripts/ui/Localization.ts');
  const keys = [
    'ability.ready', 'ability.cooldown', 'ability.active',
    ...DEVICE_IDS.map((id) => `ability.${id}`),
  ];
  for (const key of keys) {
    const pattern = new RegExp(`'${key.replace('.', '\\.')}'`, 'g');
    assert.equal((localization.match(pattern) || []).length, 8, `${key} 必须覆盖 8 种语言`);
  }

  const command = source('assets/scripts/core/FlightCommand.ts');
  assert.match(command, /deviceAbility/);
  for (const file of [
    'assets/scripts/input/DesktopFlightInput.ts',
    'assets/scripts/input/GamepadFlightInput.ts',
    'assets/scripts/input/TouchFlightInput.ts',
    'assets/scripts/input/BrowserInputBridge.ts',
  ]) {
    assert.match(source(file), /deviceAbility/, `${file} 未接线技能输入`);
  }
  const hud = source('assets/scripts/game/NativeCombatHud.ts');
  assert.match(hud, /updateAbilityReadout/);
  assert.match(hud, /role === 'deviceAbility'/);
  assert.match(hud, /AbilityReadout/);
  for (const directory of ['web-desktop', 'web-mobile']) {
    const shell = source(`build-templates/${directory}/spacefight-shell.js`);
    assert.match(shell, /deviceAbilities/);
    assert.match(shell, /state\.deviceAbility/);
    assert.match(source(`build-templates/${directory}/index.ejs`), /AbilityState/);
  }
  const bootstrap = source('assets/scripts/game/CombatBootstrap.ts');
  assert.match(bootstrap, /deviceAbility: \{ \.\.\.this\.snapshot\.deviceAbility \}/);
});
