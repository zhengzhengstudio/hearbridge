'use strict';

/**
 * SpaceFight 0.13.13 收尾回归契约。
 *
 * `test:all` 的 tsc 只编译 core/ 与 input/，game/ ui/ platform/ 与 Web 壳
 * 全靠源码契约兜住。本轮修的 12 条确定性 bug（联机换连接、任务预设同步、
 * 面板 dataset/aria、引擎未就绪点教学、GPU 资源释放、glb mimeType 等）
 * 在这里逐条留一条断言，避免下次改动悄悄回退。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cocosRoot = path.resolve(__dirname, '..', 'SpaceFight-Cocos');
const scriptsRoot = path.join(cocosRoot, 'assets', 'scripts');
const templatesRoot = path.join(cocosRoot, 'build-templates');

function read(relative) {
  return fs.readFileSync(path.join(cocosRoot, relative), 'utf8');
}
function script(relative) {
  return fs.readFileSync(path.join(scriptsRoot, relative), 'utf8');
}
function template(name, file) {
  return fs.readFileSync(path.join(templatesRoot, name, file), 'utf8');
}

const SHELLS = ['web-desktop', 'web-mobile'];

test('六艘舰 low/high 两档 glb 齐备，贴图 mimeType 与实际编码一致，且已压到手游体量', () => {
  const dirs = [
    'assets/resources/models-low/ships',
    'assets/spacefight-high/models/ships',
  ];
  const ships = ['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss'];
  for (const dir of dirs) {
    for (const ship of ships) {
      const file = path.join(cocosRoot, dir, `${ship}.glb`);
      assert.ok(fs.existsSync(file), `${dir}/${ship}.glb 缺失`);
      const size = fs.statSync(file).size;
      assert.ok(size < 8 * 1024 * 1024, `${dir}/${ship}.glb 有 ${size} B，疑似未压缩原始件`);
      assert.ok(fs.existsSync(`${file}.meta`), `${dir}/${ship}.glb.meta 缺失（Cocos uuid 会漂）`);

      // 解析 GLB chunk：旧压缩脚本把 PNG 转 JPEG 却没改 mimeType，原生端会解码失败。
      const buf = fs.readFileSync(file);
      assert.equal(buf.readUInt32LE(0), 0x46546c67, '非法 GLB magic');
      let off = 12;
      let json = null;
      let bin = null;
      while (off + 8 <= buf.length) {
        const len = buf.readUInt32LE(off);
        const type = buf.readUInt32LE(off + 4);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
        if (type === 0x004e4942) bin = data;
        off += 8 + len + ((4 - (len % 4)) % 4);
      }
      assert.ok(json && bin, `${dir}/${ship}.glb chunk 不完整`);
      for (const image of json.images || []) {
        if (!image.bufferView) continue;
        const view = json.bufferViews[image.bufferView];
        const magic = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + 4);
        const actual = magic[0] === 0x89 && magic[1] === 0x50 ? 'image/png' : 'image/jpeg';
        assert.equal(image.mimeType, actual, `${dir}/${ship}.glb 贴图声明与编码不符`);
      }
    }
  }
});

test('NativeCombatHud 的 MissionPreset 联合类型含 tutorial', () => {
  const hud = script('game/NativeCombatHud.ts');
  const match = hud.match(/type MissionPreset = ([^;]+);/);
  assert.ok(match, '找不到 MissionPreset 声明');
  assert.match(match[1], /'tutorial'/, 'missions 数组已用 tutorial，类型必须同步');
});

test('CombatBootstrap：任务预设同步、重新出击不回落、联机换连接重绑、GPU 资源释放', () => {
  const boot = script('game/CombatBootstrap.ts');
  assert.match(boot, /private lastCoopTransport[^\n]+=\s*null/,
    '缺少 lastCoopTransport，第二局联机会把 handler 留在旧 transport 上');
  assert.match(boot, /transport !== this\.lastCoopTransport \|\| !this\.coopSignalHandler/,
    'syncCoopNetwork 必须按 transport 实例重新绑定 onMessage');
  assert.match(boot, /this\.lastCoopTransport = transport;/, '换连接后未记录新 transport');
  assert.match(boot, /this\.worldStreamer\?\.dispose\(\);/,
    'onDestroy 未释放 WorldStreamer 的运行时材质/网格');

  const missionChange = boot.slice(
    boot.indexOf('private readonly handleMissionChange'),
    boot.indexOf('private readonly applyNativeLoadout'),
  );
  assert.match(missionChange, /this\.currentMissionPreset = preset;/,
    'handleMissionChange 未回写当前任务，重新出击会回落到 salvage');

  const restart = boot.slice(
    boot.indexOf('private readonly handleRestart'),
    boot.indexOf('private readonly handleGraphicsTier'),
  );
  assert.match(restart, /this\.currentMissionPreset === 'tutorial'/,
    '教学结束后重新出击应回到常规任务');

  const loadoutChange = boot.slice(
    boot.indexOf('private readonly handleLoadoutChange'),
    boot.indexOf('private readonly handleMissionChange'),
  );
  assert.match(loadoutChange, /resetSimulation\(loadout, this\.currentMissionPreset\)/,
    '换装配必须走 resetSimulation，否则沿用旧预设且 presenter 不重绘');

  assert.match(boot, /clearTicketSettlement\(\)/,
    '离港/重新出击未清空「本趟 +N」，站内面板会一直显示上一趟收益');
});

test('WsCoopSession：主动断开回落 idle、意外断线复位、重连双向配对、房间空了停重连', () => {
  const session = script('platform/WsCoopSession.ts');
  const closeBody = session.slice(
    session.indexOf('public close(): void'),
    session.indexOf('private connect('),
  );
  assert.match(closeBody, /this\.callbacks\.onState\('idle'\)/,
    '点「断开连接」后 HUD 仍显示已连接');
  assert.match(session, /transport\.onClose\(/, 'transport 意外断线没有回调复位状态');
  assert.match(session, /const opposite = this\.role === 'host' \? 'guest' : 'host'/,
    'coop:joined 重连后 host 侧无法恢复 connected');
  assert.match(session, /this\.callbacks\.onState\('error', '联机中断，正在重连…'\)/,
    '断线期间应给出可见状态而不是静止僚机');
  assert.match(session, /onState\('peer-left'\);[\s\S]{0,160}this\.teardown\(\);/,
    '对方离开后仍在后台无限自动重连');
});

test('WsCoopTransport：onOpen 单 handler、意外断线有回调', () => {
  const transport = script('platform/WsCoopTransport.ts');
  assert.doesNotMatch(transport, /openHandlers/, 'openHandlers 数组会在重连时重复执行');
  assert.match(transport, /private openHandler: \(\(\) => void\) \| null = null/);
  assert.match(transport, /this\.openHandler\?\.\(\)/);
  assert.match(transport, /this\.closeHandler\?\.\(true\)/,
    'onclose 未通知上层，断线状态永远不复位');
});

test('ShipPresenter：三艘新舰按「竖立平板」放平，缩放与包围盒量级匹配', () => {
  const presenter = script('game/ShipPresenter.ts');
  const block = presenter.slice(
    presenter.indexOf('  bomber: {'),
    presenter.indexOf('};', presenter.indexOf('  boss: {')),
  );
  for (const ship of ['bomber', 'gunship', 'boss']) {
    const body = block.slice(block.indexOf(`  ${ship}: {`));
    const segment = body.slice(0, body.indexOf('  },') + 4);
    assert.match(segment, /orientationX: -90/, `${ship} 未放平`);
    const scale = Number((segment.match(/scale: ([\d.]+)/) || [])[1]);
    assert.ok(scale >= 3 && scale <= 8, `${ship} scale=${scale} 不在新模型量级`);
  }
});

test('物品种类：五类货舱在任务补给里都有产出，视觉映射同步', () => {
  const tuning = script('core/FlightTuning.ts');
  const block = tuning.slice(tuning.indexOf('export const PICKUP_KINDS'), tuning.indexOf('/**', tuning.indexOf('export const PICKUP_KINDS')));
  for (const category of ['equipment', 'material', 'currency', 'intel', 'cosmetic']) {
    assert.match(block, new RegExp(`cargoCategory: '${category}'`), `${category} 类没有任务补给来源`);
  }
  for (const kind of ['credit', 'alloy', 'core', 'relic']) {
    assert.match(block, new RegExp(`${kind}: \\{ id: '${kind}'`), `缺少新补给 ${kind}`);
  }
  const loot = script('game/LootPresenter.ts');
  for (const kind of ['credit', 'alloy', 'core', 'relic']) {
    assert.match(loot, new RegExp(`  ${kind}: new Color\\(`), `${kind} 缺颜色`);
    assert.match(loot, new RegExp(`  ${kind}: \\{ sphere:`), `${kind} 缺轮廓`);
  }
  const boot = script('game/CombatBootstrap.ts');
  assert.match(boot, /kind: 'relic'/);
  assert.match(boot, /kind: 'core'/);
});

test('前哨站舱内：Web 素材齐备、面板与交互接线、8 语言文案', () => {
  const localization = script('ui/Localization.ts');
  for (const key of ['outpost.interior', 'outpost.interiorBack', 'outpost.interiorEmpty']) {
    const count = (localization.match(new RegExp(`'${key.replace('.', '\\.')}'`, 'g')) || []).length;
    assert.ok(count >= 8, `${key} 只出现在 ${count} 个语言块`);
  }
  const hud = script('game/NativeCombatHud.ts');
  assert.match(hud, /NativeOutpostInterior/, '原生前哨面板没有「舱内物资」按钮');
  assert.match(hud, /cargoManifestText\(snapshot: CombatSnapshot\)/, '缺少五类物资台账');
  assert.match(hud, /this\.toggleInterior\(\)/, '舱内按钮未接线');
});

for (const name of SHELLS) {
  test(`${name}：前哨站室内素材、面板与离港交互`, () => {
    const dir = path.join(templatesRoot, name);
    const assets = ['outpost-interior.jpg', ...['energy', 'repair', 'shield', 'loot', 'scrap', 'data'].map((n) => `supply-${n}.jpg`)];
    for (const file of assets) {
      assert.ok(fs.existsSync(path.join(dir, file)), `${name} 缺少 ${file}`);
    }
    const ejs = template(name, 'index.ejs');
    assert.match(ejs, /id="OutpostPanel"[^>]*aria-hidden="true"/);
    assert.match(ejs, /id="OutpostUndock"/, '没有离港入口，进站后会卡住');
    assert.match(ejs, /由 AI 生成/, 'ImageGen 素材必须标注 AI 生成');
    const js = template(name, 'spacefight-shell.js');
    for (const fn of ['function setOutpostOpen', 'function fillOutpost']) {
      assert.ok(js.includes(fn), `${name} 缺少 ${fn}`);
    }
    assert.match(js, /spacefight:outpost-entered/, '未监听进站事件');
    assert.match(js, /spacefight:outpost-exit/, '离港按钮未派发离港事件');
    assert.match(js, /closePanels\(\) \{[\s\S]{0,200}setOutpostOpen\(false\)/,
      '进入/退出战斗未关闭舱内面板');
  });

  test(`${name}：面板开合统一、aria-hidden 同步、进战斗清场`, () => {
    const js = template(name, 'spacefight-shell.js');
    for (const fn of ['function setLoadoutOpen', 'function setSettingsOpen', 'function closePanels']) {
      assert.ok(js.includes(fn), `${name} 缺少 ${fn}`);
    }
    assert.match(js, /getElementById\('LoadoutPanel'\)\?\.setAttribute\('aria-hidden'/,
      `${name} 装配面板可见时仍标记 aria-hidden=true`);
    assert.match(js, /getElementById\('SettingsPanel'\)\?\.setAttribute\('aria-hidden'/);
    const closeCalls = js.match(/closePanels\(\);/g) || [];
    assert.ok(closeCalls.length >= 5,
      `${name} closePanels 调用仅 ${closeCalls.length} 处，进入/退出战斗仍有面板残留`);
  });

  test(`${name}：引擎未就绪点教学不吃点击、按钮默认禁用`, () => {
    const js = template(name, 'spacefight-shell.js');
    const handler = js.slice(js.indexOf("tutorialStartButton?.addEventListener('click'"));
    const segment = handler.slice(0, handler.indexOf("document.body.dataset.missionPreset = 'tutorial'"));
    assert.match(segment, /if \(!engineReady\)/, '未就绪时会先切任务再 return');
    assert.match(segment, /closePanels\(\)/, '进入教学未关闭两个面板');
    const ejs = template(name, 'index.ejs');
    assert.match(ejs, /<button id="TutorialStart"[^>]*\bdisabled\b/,
      '教学按钮应像 LaunchButton 一样初始禁用');
  });

  test(`${name}：启动页版本号与 BuildInfo 单一真源一致`, () => {
    const info = script('core/BuildInfo.ts');
    const version = (info.match(/version:\s*'([\d.]+)'/) || [])[1];
    const build = (info.match(/build:\s*(\d+)/) || [])[1];
    assert.ok(version && build);
    const ejs = template(name, 'index.ejs');
    assert.ok(ejs.includes(`<b>${version}</b>`), `${name} 启动页版本仍写死旧值`);
    assert.ok(ejs.includes(`<span>BUILD ${build}</span>`), `${name} 启动页 BUILD 仍写死旧值`);
  });
}
