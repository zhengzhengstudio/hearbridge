'use strict';

/**
 * SpaceFight 全端手感一致性契约测试。
 *
 * 背景：SpaceFight 的战斗逻辑在四个地方各有一份实现，彼此独立演进：
 *  - Cocos：`SpaceFight-Cocos/assets/scripts/core/FlightTuning.ts`
 *  - 鸿蒙离线/在线：各自 `pages/Index.ets`（两端逐行相同但是两份文件）
 *  - Swift iOS+Mac：共用 `apps/SpaceFightShared/NativeGameScene.swift`
 *
 * 上一轮只在 Cocos 端做了「速度一阶收敛 + 受击无敌帧」，其余三端仍是
 * 瞬时速度、松手即停、没有无敌帧 → 同一款游戏在不同端手感完全不同。
 * 这个测试保证四端的关键参数不会再漂移。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const HARMONY_OFFLINE =
  'HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets';
const HARMONY_ONLINE =
  'HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets';
const SWIFT_SHARED = 'apps/SpaceFightShared/NativeGameScene.swift';
const COCOS_TUNING = 'SpaceFight-Cocos/assets/scripts/core/FlightTuning.ts';
const COCOS_SIMULATION = 'SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts';

const ENDS = [
  ['鸿蒙离线版', HARMONY_OFFLINE],
  ['鸿蒙在线版', HARMONY_ONLINE],
  ['Swift 共用端', SWIFT_SHARED],
];

test('四端手感参数完全一致', () => {
  const cocos = read(COCOS_TUNING);
  const expected = {
    throttleResponse: 0.28,
    coastDrag: 0.5,
    hitGraceSeconds: 0.42,
  };

  const cocosValues = {
    throttleResponse: Number(/throttleResponse:\s*([\d.]+)/.exec(cocos)?.[1]),
    coastDrag: Number(/coastDrag:\s*([\d.]+)/.exec(cocos)?.[1]),
    hitGraceSeconds: Number(/hitGraceSeconds:\s*([\d.]+)/.exec(cocos)?.[1]),
  };
  assert.deepEqual(cocosValues, expected, 'Cocos 端参数应与基准一致');

  for (const [name, file] of ENDS) {
    const source = read(file);
    const actual = {
      throttleResponse: Number(
        /FLIGHT_THROTTLE_RESPONSE[^=\n]*=\s*([\d.]+)/.exec(source)?.[1],
      ),
      coastDrag: Number(/FLIGHT_COAST_DRAG[^=\n]*=\s*([\d.]+)/.exec(source)?.[1]),
      hitGraceSeconds: Number(
        /PLAYER_HIT_GRACE_SECONDS[^=\n]*=\s*([\d.]+)/.exec(source)?.[1],
      ),
    };
    assert.deepEqual(actual, expected, `${name} 手感参数应与 Cocos 端一致`);
  }
});

test('松手后目标速度归零（不能有保底速度）', () => {
  // ⚠️ 曾用 idleSpeedFloor(0.22) 做保底，结果玩家不操作时永远匀速飘走：
  //    实测无输入 20 秒从 z=8 飘到 z=-32，按住后退飘到 z=721，
  //    既无法悬停也会慢慢飞出战场。惯性的价值是「滑一段」，不是「永远在动」。
  const cocos = read(COCOS_TUNING);
  // 只看真实声明（注释里为了说明历史问题会提到这个名字）。
  assert.doesNotMatch(
    cocos,
    /^\s*idleSpeedFloor\s*:/m,
    'Cocos 端不应再有保底速度参数',
  );
  // targetSpeed 定义在 CombatSimulation 里，不在 FlightTuning。
  assert.match(
    read(COCOS_SIMULATION),
    /const targetSpeed = hasThrust \? maxSpeed : 0;/,
    'Cocos 端松手目标速度必须是 0',
  );

  const patterns = {
    [HARMONY_OFFLINE]: /const targetSpeed = hasThrust \? \(boost \? 1\.5 : 1\) : 0/,
    [HARMONY_ONLINE]: /const targetSpeed = hasThrust \? \(boost \? 1\.5 : 1\) : 0/,
    [SWIFT_SHARED]: /let targetSpeed: CGFloat = hasThrust \? \(boost \? 1\.5 : 1\) : 0/,
  };
  for (const [name, file] of ENDS) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /^\s*(?:private\s+)?FLIGHT_IDLE_SPEED_FLOOR\s*[:=]/m,
      `${name} 不应再有保底速度常量`,
    );
    assert.match(source, patterns[file], `${name} 松手目标速度必须是 0`);
  }
});

test('每端都实现了速度一阶收敛，而非瞬时赋值', () => {
  for (const [name, file] of ENDS) {
    const source = read(file);
    assert.match(
      source,
      /currentSpeed\s*\+=\s*\(targetSpeed\s*-\s*this\.currentSpeed\)|currentSpeed\s*\+=\s*\(targetSpeed\s*-\s*currentSpeed\)/,
      `${name} 必须把当前速度向目标速度收敛`,
    );
    assert.match(
      source,
      /hasThrust/,
      `${name} 必须区分「有推力」与「滑行」两种目标速度`,
    );
  }
});

test('松手滑行的位移独立于输入（否则惯性参数形同虚设）', () => {
  // 这条守护一个真实发生过的 bug：位移写成 `forward * throttle`，
  // 松手后 throttle=0 → 位移恒为 0，coastDrag/idleSpeedFloor 完全不起作用。
  // 正确写法必须用 hasThrust 分支取 driveX/driveZ。
  const patterns = {
    [HARMONY_OFFLINE]: /const driveX = hasThrust \? forwardX \* this\.throttle : forwardX/,
    [HARMONY_ONLINE]: /const driveX = hasThrust \? forwardX \* this\.throttle : forwardX/,
    [SWIFT_SHARED]: /let driveX = hasThrust \? forwardX \* throttle : forwardX/,
  };
  for (const [name, file] of ENDS) {
    const source = read(file);
    assert.match(
      source,
      patterns[file],
      `${name} 松手时位移必须脱离输入（hasThrust ? 输入 : 朝向）`,
    );
    // 位移公式里不能再出现裸的 forwardX * this.throttle。
    assert.doesNotMatch(
      source,
      /localX \+= \(forwardX \* this\.throttle \+ rightX/,
      `${name} 位移仍在乘输入，滑行不生效`,
    );
  }

  // Cocos 端同理。
  const cocos = read('SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts');
  assert.match(
    cocos,
    /const driveX = hasThrust \? forward\.x \* throttle : forward\.x/,
    'Cocos 端松手位移必须脱离输入',
  );
});

test('每端都有受击无敌帧，且采用「步末一次性结算」', () => {
  // ⚠️ 这里锁定的是**结算时机**，不只是"有没有无敌"。
  // 直接在 damagePlayer 里扣血+开无敌，会把**持续接触伤害**也一并挡掉，
  // 玩家可能永远不死（Cocos 实测：护盾在 4~21 间反复回充，60 秒挂机都不失败）。
  // 正确模型：damageXxx 只累积，flushPlayerDamage 在步末结算一次。
  const patterns = {
    [HARMONY_OFFLINE]: /private damageLocal\(value: number\): void \{\s*\n\s*this\.pendingPlayerDamage \+= Math\.max\(0, value\)/,
    [HARMONY_ONLINE]: /private damageLocal\(value: number\): void \{\s*\n\s*this\.pendingPlayerDamage \+= Math\.max\(0, value\)/,
    [SWIFT_SHARED]: /private func applyDamage\(_ amount: CGFloat\) \{\s*\n\s*pendingPlayerDamage \+= max\(0, amount\)/,
  };
  for (const [name, file] of ENDS) {
    const source = read(file);
    assert.match(
      source,
      patterns[file],
      `${name} 的伤害入口应只累积，不直接扣血`,
    );
    assert.match(
      source,
      /private flushPlayerDamage|func flushPlayerDamage/,
      `${name} 必须有步末统一结算`,
    );
    // 结算必须在扣血后才开无敌帧。
    assert.match(
      source,
      /hitGraceRemaining = PLAYER_HIT_GRACE_SECONDS/,
      `${name} 步末结算后应开启无敌时间`,
    );
  }

  // Cocos 端同理，且结算点必须在本步所有伤害来源之后。
  const cocos = read('SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts');
  assert.match(
    cocos,
    /private damagePlayer\(damage: number\): void \{\s*\n\s*if \(this\.player\.spawnProtection > 0 \|\| this\.failed\) return;\s*\n\s*this\.pendingPlayerDamage \+= Math\.max\(0, damage\)/,
    'Cocos 端伤害入口应只累积',
  );
  assert.match(cocos, /private flushPlayerDamage\(\): void/);
  const updateProjectiles = cocos.indexOf('this.updateProjectiles(dt);');
  const flush = cocos.indexOf('this.flushPlayerDamage();');
  assert.ok(
    updateProjectiles > -1 && flush > updateProjectiles,
    'Cocos 端结算点必须在 updateProjectiles 之后（所有伤害来源之后）',
  );
});

test('复位会清零累积伤害', () => {
  const patterns = {
    [HARMONY_OFFLINE]: /pendingPlayerDamage = 0/,
    [HARMONY_ONLINE]: /pendingPlayerDamage = 0/,
    [SWIFT_SHARED]: /pendingPlayerDamage = 0/,
  };
  for (const [name, file] of ENDS) {
    assert.match(
      read(file),
      patterns[file],
      `${name} 复位时必须清零 pendingPlayerDamage，否则重开局会立刻结算上一局的伤害`,
    );
  }
});

test('重开局会清零惯性速度与无敌时间', () => {
  const patterns = {
    [HARMONY_OFFLINE]: /private resetLocalBattle\(\): void \{[\s\S]*?currentSpeed = 0[\s\S]*?hitGraceRemaining = 0/,
    [HARMONY_ONLINE]: /private resetLocalBattle\(\): void \{[\s\S]*?currentSpeed = 0[\s\S]*?hitGraceRemaining = 0/,
    [SWIFT_SHARED]: /func reset\(mode: String, loadout: SFLoadoutProfile\)[\s\S]*?currentSpeed = 0[\s\S]*?hitGraceRemaining = 0/,
  };
  for (const [name, file] of ENDS) {
    assert.match(
      read(file),
      patterns[file],
      `${name} 复位时必须清零 currentSpeed 与 hitGraceRemaining，否则带着上一局的惯性/无敌进场`,
    );
  }
});

test('Swift iOS/Mac 两端不含独立战斗逻辑副本', () => {
  // 战斗逻辑一旦复制成两份，就会出现「改了一端忘了另一端」。
  for (const shell of [
    'apps/SpaceFight-iOS/Sources/main.swift',
    'apps/SpaceFightMac/Sources/main.swift',
  ]) {
    const source = read(shell);
    assert.doesNotMatch(
      source,
      /playerX|playerZ|applyDamage/,
      `${shell} 不应自己实现战斗逻辑，应共用 SpaceFightShared`,
    );
    assert.match(
      source,
      /NativeGameScene\(\)/,
      `${shell} 应持有 SpaceFightShared 的 NativeGameScene 实例`,
    );
  }
});

test('鸿蒙两端的飞行手感段保持一致', () => {
  // 注意：两端 stepLocalBattle **本就不完全相同**——在线版多一行 localElapsed 计时，
  // 且区域规则方法名不同（updateRegionRules vs applyRegionRules）。
  // 所以只锁定「手感关键段」必须一致，不要求整个方法逐字相同。
  const offline = read(HARMONY_OFFLINE);
  const online = read(HARMONY_ONLINE);

  const extractFeel = (source) => {
    const start = source.indexOf('const hasThrust = Math.hypot');
    assert.ok(start > -1, '必须能定位速度收敛段');
    const end = source.indexOf('this.applyRegionRules', start);
    const fallback = source.indexOf('this.updateRegionRules', start);
    const stop = end > -1 ? end : fallback;
    return source
      .slice(start, stop > -1 ? stop : start + 900)
      .replace(/\s+/g, ' ')
      .trim();
  };

  assert.equal(
    extractFeel(offline),
    extractFeel(online),
    '鸿蒙两端的速度收敛与位移段必须一致，否则同款游戏手感会分叉',
  );
});
test('四端版本号保持一致', () => {
  // 背景：2026-10-11 全端手感改动后，四端版本号严重漂移——
  //   Cocos 0.12.0/63、鸿蒙离线 0.12.0/63，但鸿蒙在线停在 0.10.23/42、
  //   Swift 两端停在 0.10.2/build 20，且鸿蒙 Index.ets 里还有 UI 硬编码的
  //   '版本 0.10.2 · build 20'。玩家会看到"同一个游戏不同端版本号天差地别"。
  //
  // Cocos package.json 是版本号主源（鸿蒙 build 号与它对齐），
  // 这里锁住其余三端，防止再次漂移。
  const pkg = JSON.parse(read('SpaceFight-Cocos/package.json'));
  const version = pkg.version;
  const build = pkg.build;
  assert.match(version, /^\d+\.\d+\.\d+$/, '主版本号应为 x.y.z 形式');

  const harmonyManifests = [
    ['鸿蒙离线版', 'HarmonyOS-App/SpaceFightHarmonyOffline/AppScope/app.json5'],
    ['鸿蒙在线版', 'HarmonyOS-App/SpaceFightHarmony/AppScope/app.json5'],
  ];
  for (const [label, manifestPath] of harmonyManifests) {
    const manifest = read(manifestPath);
    assert.match(
      manifest,
      new RegExp(`"versionCode":\\s*${build}\\b`),
      `${label} versionCode 应与 Cocos build(${build}) 一致`,
    );
    assert.match(
      manifest,
      new RegExp(`"versionName":\\s*"${version.replace(/\./g, '\\.')}"`),
      `${label} versionName 应与 Cocos version(${version}) 一致`,
    );
  }

  const swiftShells = [
    ['iOS', 'apps/SpaceFight-iOS/Sources/main.swift'],
    ['macOS', 'apps/SpaceFightMac/Sources/main.swift'],
  ];
  for (const [label, shellPath] of swiftShells) {
    const shell = read(shellPath);
    assert.match(
      shell,
      new RegExp(`appVersion = "${version.replace(/\./g, '\\.')}"`),
      `SpaceFight ${label} appVersion 应为 ${version}`,
    );
    assert.match(
      shell,
      new RegExp(`appBuild = ${build}\\b`),
      `SpaceFight ${label} appBuild 应为 ${build}`,
    );
  }

  // 鸿蒙 UI 里显示给玩家的版本文案也不能漏——它曾经硬编码 0.10.2/build 20，
  // 即使 app.json5 改对了，界面上仍会显示旧版本。
  for (const [label, sourcePath] of ENDS) {
    if (label === 'Swift 共用端') continue;
    const source = read(sourcePath);
    assert.match(
      source,
      new RegExp(`appVersion[^\\n]*'${version.replace(/\./g, '\\.')}'`),
      `${label} Index.ets 的 appVersion 常量应为 ${version}`,
    );
  }
  assert.doesNotMatch(
    read(HARMONY_ONLINE),
    /版本 0\.10\.2 · build 20/,
    '鸿蒙在线版的版本展示文案仍硬编码旧版本号',
  );
});
