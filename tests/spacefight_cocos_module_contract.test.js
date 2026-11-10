'use strict';

/**
 * SpaceFight Cocos 跨模块 API 契约测试。
 *
 * 背景：`npm run test:simulation` 只编译 `assets/scripts/core/`，
 * `game/` `input/` `platform/` 完全没有类型验证。历史上因此出现过
 * 「CombatBootstrap 调用 ShipPresenter 上不存在的方法」这类错误——
 * 编译能过（core 不引用 game）、单测也全绿，但运行时每帧抛 TypeError，
 * 表现为用户永远卡在「正在初始化」。
 *
 * 这里不依赖 tsc（沙箱里跑一次要4 分钟），而是用源码契约做快速拦截：
 * 凡是 `this.<helper>(` 形式的模块级函数调用、跨类方法引用，都必须真实存在。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptsRoot = path.resolve(__dirname, '..', 'SpaceFight-Cocos', 'assets', 'scripts');

function readSource(relativePath) {
  return fs.readFileSync(path.join(scriptsRoot, relativePath), 'utf8');
}

/** 收集一个类里真实声明的成员名（public/private 方法、getter、字段）。 */
function declaredMembers(source) {
  const members = new Set();
  const methodPattern = /^\s{2}(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*[(:<]/gm;
  let match;
  while ((match = methodPattern.exec(source)) !== null) {
    members.add(match[1]);
  }
  const getterPattern = /^\s{2}(?:public|private|protected)?\s*get\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((match = getterPattern.exec(source)) !== null) {
    members.add(match[1]);
  }
  const fieldPattern = /^\s{2}(?:public|private|protected|readonly)\s+(?:readonly\s+)?[A-Za-z_$][\w$<>,.\s\[\]]*?\s([A-Za-z_$][\w$]*)\s*[=;:]/gm;
  while ((match = fieldPattern.exec(source)) !== null) {
    members.add(match[1]);
  }
  return members;
}

/** 模块级函数/常量声明（非类成员）。 */
function moduleLevelNames(source) {
  const names = new Set();
  const patterns = [
    /^function\s+([A-Za-z_$][\w$]*)/gm,
    /^async function\s+([A-Za-z_$][\w$]*)/gm,
    /^const\s+([A-Za-z_$][\w$]*)\s*=/gm,
    /^let\s+([A-Za-z_$][\w$]*)\s*=/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      names.add(match[1]);
    }
  }
  return names;
}

test('CombatBootstrap 只调用 ShipPresenter 真实存在的成员', () => {
  const bootstrap = readSource(path.join('game', 'CombatBootstrap.ts'));
  const presenter = readSource(path.join('game', 'ShipPresenter.ts'));
  const members = declaredMembers(presenter);

  const accesses = new Set();
  const pattern = /this\.shipPresenter\.([A-Za-z_$][\w$]*)/g;
  let match;
  while ((match = pattern.exec(bootstrap)) !== null) {
    accesses.add(match[1]);
  }

  const missing = [...accesses].filter((name) => !members.has(name));
  assert.deepEqual(
    missing,
    [],
    `CombatBootstrap 调用了 ShipPresenter 上不存在的成员：${missing.join(', ')}`,
  );
});

test('CombatBootstrap 不把模块级函数当实例方法调用', () => {
  const bootstrap = readSource(path.join('game', 'CombatBootstrap.ts'));
  const moduleNames = moduleLevelNames(bootstrap);

  const misused = [];
  const pattern = /this\.([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = pattern.exec(bootstrap)) !== null) {
    const name = match[1];
    // 模块级函数被误写成 this.xxx() 时，运行时 this.xxx 是 undefined。
    if (moduleNames.has(name)) {
      misused.push(name);
    }
  }

  assert.deepEqual(
    misused,
    [],
    `这些是模块级函数，不能用 this. 调用：${misused.join(', ')}`,
  );
});

test('ShipPresenter 构造参数与调用方传参一致', () => {
  const presenter = readSource(path.join('game', 'ShipPresenter.ts'));
  const bootstrap = readSource(path.join('game', 'CombatBootstrap.ts'));

  const ctor = presenter.match(/public constructor\(([\s\S]*?)\)\s*\{\}/);
  assert.ok(ctor, 'ShipPresenter 必须有可识别的 constructor');
  const ctorParams = (ctor[1].match(/(readonly\s+)?[A-Za-z_$][\w$]*/g) || [])
    .filter((token) => !['public', 'private', 'protected', 'readonly'].includes(token));

  const call = bootstrap.match(/new ShipPresenter\(([\s\S]*?)\)/);
  assert.ok(call, 'CombatBootstrap 必须构造 ShipPresenter');
  const callArgs = call[1].trim() === '' ? [] : call[1].split(',').map((part) => part.trim());

  // 可选参数（带默认值）允许调用方少传。
  const required = (ctor[1].match(/private readonly (\w+)(?!:)/g) || []).length;
  assert.ok(
    callArgs.length <= ctorParams.length,
    `ShipPresenter 调用传了 ${callArgs.length} 个参数，构造函数只接受 ${ctorParams.length} 个`,
  );
  assert.ok(
    callArgs.length >= required,
    `ShipPresenter 调用传了 ${callArgs.length} 个参数，至少需要 ${required} 个`,
  );
});

test('WsCoopSession 字段名不与方法名冲突', () => {
  const source = readSource(path.join('platform', 'WsCoopSession.ts'));
  const body = source.match(/export class WsCoopSession \{([\s\S]*)\n\}/);
  assert.ok(body, '必须能定位 WebCoopSession 类体');

  const fieldNames = [...body[1].matchAll(/private\s+(\w+)\s*[=:]/g)].map((m) => m[1]);
  const methodNames = [...body[1].matchAll(/public\s+(?:static\s+)?(?:async\s+)?(\w+)\s*\(/g)]
    .map((m) => m[1]);

  const conflicts = fieldNames.filter((name) => methodNames.includes(name));
  assert.deepEqual(
    conflicts,
    [],
    `字段名与方法名冲突会让字段被覆盖（恒为 undefined）：${conflicts.join(', ')}`,
  );
});

test('createCoopClientId 只产出字母数字字符', () => {
  const source = readSource(path.join('core', 'CoopNetwork.ts'));
  //曾经的 bug：数组声明成 number[] 却 push 字符串，类型与运行时都不一致。
  assert.ok(
    !/const\s+\w+\s*:\s*number\[\]/.test(source),
    '不要用 number[] 承载字符数组',
  );
  const fn = source.match(/export function createCoopClientId\(\): string \{[\s\S]*?\n\}/);
  assert.ok(fn, '必须能定位 createCoopClientId');
  // 剥掉 TS 语法：export、返回类型标注、变量类型注解、as 断言。
  const body = fn[0]
    .replace(/^export\s+/, '')
    .replace(/\(\)\s*:\s*string/, '()')
    .replace(/^(\s*)(const|let)\s+(\w+)\s*:\s*[^=]+=/gm, '$1$2 $3 =')
    .replace(/\s+as\s+const\b/g, '')
    .replace(/\s+as\s+[A-Za-z_$][\w$<>,.\s[\]]*?(?=[,;)\n])/g, '');
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', `${body}\nexports.id = createCoopClientId();`)(sandbox);
  assert.match(sandbox.id, /^p[a-z0-9]{1,15}$/);
});