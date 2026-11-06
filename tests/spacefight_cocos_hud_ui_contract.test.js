'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HUD_PATH = path.join(
  __dirname, '..', 'SpaceFight-Cocos', 'assets', 'scripts', 'game', 'NativeCombatHud.ts',
);

/** 去掉整行注释和块注释，避免注释里的示例代码触发误报。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//');
      return index < 0 ? line : line.slice(0, index);
    })
    .join('\n');
}

function lineNumberOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

test('HUD 私有方法必须通过 this 调用，不能写成裸函数', () => {
  const source = stripComments(fs.readFileSync(HUD_PATH, 'utf8'));
  const privateMethods = [...source.matchAll(
    /^\s*private\s+(?:readonly\s+)?(?:static\s+)?([A-Za-z_$][\w$]*)\s*\(/gm,
  )].map((match) => match[1]);
  assert.ok(privateMethods.length > 20, `应能识别私有方法，实际 ${privateMethods.length} 个`);

  const offenders = [];
  for (const name of new Set(privateMethods)) {
    // 裸调用 = 名称前不是 "."、也不是标识符字符，且该行不是方法定义本身。
    const pattern = new RegExp(`(^|[^.\\w$])${name}\\s*\\(`, 'gm');
    for (const match of source.matchAll(pattern)) {
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const lineEnd = source.indexOf('\n', match.index);
      const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
      const isDefinition = new RegExp(
        `private\\s+(?:readonly\\s+)?(?:static\\s+)?${name}\\s*\\(`,
      ).test(line);
      if (isDefinition) continue;
      offenders.push(`第 ${lineNumberOf(source, match.index)} 行：${name}(...) → ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `发现私有方法裸调用（运行时会抛 ReferenceError）：\n${offenders.join('\n')}`);
});

test('HUD 构造函数分步创建面板，单点异常不会吞掉整个界面', () => {
  const source = fs.readFileSync(HUD_PATH, 'utf8');
  assert.match(source, /const creators: readonly \[string, \(\) => void\]\[\]/, '应存在分步面板创建器');
  assert.match(source, /other panels continue/, '单步失败应记录日志并继续');
  assert.match(
    source,
    /for \(const panel of \[[\s\S]*?this\.homePanel, this\.loadoutPanel, this\.outpostPanel,[\s\S]*?\]\) \{[\s\S]*?panel\.active = false/,
    '构造结束应统一关闭所有覆盖层，避免半初始化面板盖住战场',
  );
});

test('任务选中态保留按钮当前尺寸，不写死 214×70', () => {
  const source = fs.readFileSync(HUD_PATH, 'utf8');
  assert.match(source, /this\.labelFontSizeFor\(button\)/, '字号回读必须走 this');
  assert.match(source, /contentSize\.width/, '选中态应使用网格布局算出的宽度');
  assert.match(source, /missionColumns = missionTotal > 3 \? 2 : 1/, '六类任务应使用两列网格');
});

test('覆盖面板共用战术框架，按钮保留刻度与角标细节', () => {
  const source = fs.readFileSync(HUD_PATH, 'utf8');
  assert.match(source, /private drawPanelFrame\(/, '应存在共用的战术面板框架绘制方法');
  const calls = [...source.matchAll(/this\.drawPanelFrame\(/g)].length;
  assert.ok(calls >= 6, `六个覆盖面板都应接入框架，实际 ${calls} 处`);
  assert.match(source, /四角 L 形锁定角标/, '面板框架应画四角锁定角标');
  assert.match(source, /顶部刻度尺/, '面板框架应画顶部刻度尺');
  assert.match(source, /战术按钮细节：切角内框/, '面板按钮应保留内框与刻度细节');
  assert.match(source, /顶边等距刻度/, '按钮顶边应有等距刻度');
});
