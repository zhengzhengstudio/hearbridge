'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../website/survival-diary.zhengzhengstudio.cn');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('farm panel localizes every persisted crop stage without leaking engine enums', () => {
  const { cropStageLabel } = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
  assert.deepEqual(
    ['seeded', 'seedling', 'sprout', 'growing', 'mature', 'ripe', 'dry', 'prepared', 'watered', 'planted'].map(cropStageLabel),
    ['已播种', '幼苗', '萌芽', '生长中', '成熟', '可收获', '缺水', '待播种', '已浇水', '已播种'],
  );
  assert.equal(cropStageLabel('future-stage'), '未知阶段');
});

test('quality profile is deterministic and presentation-only', () => {
  const { qualityProfile, qualityVisualProfile, runtimeQualityProfile } = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
  assert.equal(qualityProfile({ memory: 2, cores: 8 }), 'low');
  assert.equal(qualityProfile({ memory: 8, cores: 4 }), 'balanced');
  assert.equal(qualityProfile({ memory: 4, cores: 4 }), 'low');
  assert.equal(qualityProfile({ memory: 8, cores: 8 }), 'high');
  assert.equal(qualityProfile({ memory: 4, cores: 6 }), 'balanced');
  assert.equal(qualityProfile({}), 'balanced');
  assert.equal(runtimeQualityProfile(null, 'high'), 'balanced');
  assert.equal(runtimeQualityProfile(null, 'balanced'), 'balanced');
  assert.equal(runtimeQualityProfile('high', 'balanced'), 'high');
  assert.equal(runtimeQualityProfile('low', 'high'), 'low');
  assert.deepEqual(qualityVisualProfile('low'), { oceanStride: 2, shadowBlur: 0, particleScale: 0.35 });
  assert.deepEqual(qualityVisualProfile('balanced'), { oceanStride: 1, shadowBlur: 0.65, particleScale: 0.7 });
  assert.deepEqual(qualityVisualProfile('high'), { oceanStride: 1, shadowBlur: 1, particleScale: 1 });
});

test('compact HUD projection has six slots, five destinations and one permanent action', () => {
  const { compactHudProjection } = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
  const hud = compactHudProjection();
  assert.equal(hud.hotbarSlots, 6);
  assert.deepEqual(hud.destinations, ['inventory', 'crafting', 'map', 'journal', 'system']);
  assert.deepEqual(hud.permanentActions, ['context']);
  assert.ok(hud.actionBottomInset >= 84);
  assert.equal(hud.taskCard.textOverflow, 'clip');
});

test('real shell exposes one raster-icon dock and no truncated objective or action', () => {
  const html = read('index.html'); const css = read('game-hud-v2.css');
  const dock = html.match(/<nav class="[^"]*game-dock[^"]*"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((dock.match(/<button/g) || []).length, 5);
  for (const token of ['inventory-panel', 'open-crafting', 'map-panel', 'open-journal', 'menu-panel']) assert.match(dock, new RegExp(token));
  assert.equal((html.match(/id="context-action"/g) || []).length, 1);
  assert.equal((html.match(/id="gather-action"/g) || []).length, 1);
  assert.match(html, /id="gather-action"[^>]*aria-label="采集附近资源"/);
  assert.equal((html.match(/class="game-icon/g) || []).length > 5, true);
  assert.doesNotMatch(html, /[—–]/);
  assert.match(css, /#context-object[\s\S]*text-overflow:\s*clip/);
  assert.match(css, /#context-verb[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /#guide-title[\s\S]*text-overflow:\s*clip/);
  assert.match(css, /#placement-status[\s\S]*text-overflow:\s*clip/);
  assert.match(html, /data-crafting-view="compendium"[^>]*>岛屿图鉴/);
  assert.match(html, /id="compendium-list"/);
  assert.match(css, /\.compendium-card/);
});

test('responsive geometry derives from safe-area tokens and supports landscape', () => {
  const css = read('game-hud-v2.css');
  for (const token of ['--safe-bottom', '--dock-height', '--action-lane']) assert.match(css, new RegExp(`${token}:`));
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /bottom:\s*calc\(var\(--safe-bottom\) \+ var\(--dock-height\)/);
  assert.match(css, /right:\s*calc\(var\(--action-lane\)/);
  assert.match(css, /@media \(max-height:\s*480px\) and \(orientation:\s*landscape\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*?#game-shell\.world-first-hud \.guide-cue p\s*\{[^}]*display:\s*block/);
  assert.match(css, /@media \(min-width:\s*1101px\)[\s\S]*?\.gather-action[\s\S]*?\.camera-controls/);
  assert.match(css, /\.camera-controls\s*\{[^}]*right:\s*calc\(max\(16px,[^}]*\+ 244px\)/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*?\.entity-toolbar\s*\{[^}]*min-width:\s*0[^}]*translate:\s*0/);
});

test('hotbar and quality integration use six UI slots without changing simulation state', () => {
  const game = read('js/game.js');
  assert.match(game, /const HOTBAR_SLOT_COUNT = 6/);
  assert.match(read('js/world.js'), /hotbarSlots:\s*\['branch', 'stone', 'palm-fiber', 'coconut', null, null\]/);
  assert.doesNotMatch(game, /slice\(0, 8\)|slots\.length < 8|index > 7|Math\.min\(7/);
  assert.match(game, /dataset\.quality = renderQualityProfile/);
  assert.match(game, /qualityProfile\(\{ memory: navigator\.deviceMemory, cores: navigator\.hardwareConcurrency \}\)/);
  assert.doesNotMatch(game, /state\s*=\s*\{[^}]*renderQualityProfile/);
});

test('non-modal game sheets become inert and return focus before aria hiding', () => {
  const { setNonModalPanelVisibility } = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
  const events = [];
  const focused = { blur() { events.push('blur'); } };
  const panel = {
    hidden: false,
    inert: false,
    contains(value) { return value === focused; },
    setAttribute(name, value) { events.push(`${name}:${value}`); },
    removeAttribute(name) { events.push(`remove:${name}`); },
  };
  const returnFocus = { focus() { events.push('focus:return'); } };
  assert.equal(setNonModalPanelVisibility(panel, false, { activeElement: focused, returnFocus }), true);
  assert.equal(panel.hidden, true);
  assert.equal(panel.inert, true);
  assert.ok(events.indexOf('focus:return') < events.indexOf('aria-hidden:true'), 'focus must leave before aria-hidden is applied');
  setNonModalPanelVisibility(panel, true);
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  const html = read('index.html');
  for (const id of ['crafting-panel', 'facility-sheet', 'villager-sheet']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-hidden="true"[^>]*inert[^>]*hidden`));
  }
});
