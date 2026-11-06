const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const site = path.join(root, 'website/survival-diary.zhengzhengstudio.cn');
const { migrateSaveV2 } = require('../apps/SurvivalDiaryShared/src/migrate-save.js');
const { createGuideState, nextGuideCue, setPlayMode } = require('../website/survival-diary.zhengzhengstudio.cn/js/play-mode.js');
const SaveStore = require('../website/survival-diary.zhengzhengstudio.cn/js/save-store.js');

test('new saves default to A while an explicit B preference survives migration', () => {
  const fresh = setPlayMode(migrateSaveV2({ seed: 'first-run' }));
  const returning = setPlayMode(migrateSaveV2({ seed: 'returning', playMode: 'free' }), 'free');

  assert.equal(fresh.playMode, 'guided');
  assert.equal(returning.playMode, 'free');
});

test('A and B share world progress without mutating the active save', () => {
  const save = migrateSaveV2({
    playMode: 'guided',
    inventory: { fiber: 7 },
    entities: [{ id: 'fire-1', type: 'campfire' }],
    journals: { local: { text: '潮水退了。' } },
  });
  const free = setPlayMode(save, 'free');

  assert.equal(save.playMode, 'guided');
  assert.equal(free.playMode, 'free');
  assert.deepEqual(free.entities, save.entities);
  assert.deepEqual(free.inventory, save.inventory);
  assert.deepEqual(free.journals, save.journals);
  assert.equal(nextGuideCue(createGuideState(free), { type: 'tick' }), null);
});

test('guided cues are derived from progress and never lock game actions', () => {
  const save = {
    playMode: 'guided',
    discovered: ['0,0'],
    inventory: { fish: 1, 'stone-axe': 1 },
    entities: [{ id: 'fire-1', type: 'campfire' }],
    journalEntries: [{ facts: [{ type: 'discovery', subject: 'fresh-water' }] }],
    milestones: {},
  };
  const guide = createGuideState(save);
  const cue = nextGuideCue(guide, { type: 'tick' });

  assert.equal(cue.id, 'place_shelter');
  assert.equal(cue.blocking, false);
  assert.equal(cue.presentation, 'screen-space');
  assert.equal(cue.action, 'open-crafting');
});

test('finishing the opening guide reports chapter completion without ending the open game', () => {
  const save = {
    playMode: 'guided',
    discovered: ['0,0', '1,0'],
    inventory: { 'fresh-water': 1, fish: 1, 'stone-axe': 1 },
    entities: [
      { id: 'fire-1', type: 'campfire' },
      { id: 'shelter-1', type: 'shelter' },
      { id: 'bench-1', type: 'workbench' },
    ],
    milestones: { observe_shore: true },
  };
  const cue = nextGuideCue(createGuideState(save), { type: 'tick' });
  assert.equal(cue.id, 'opening_complete');
  assert.equal(cue.title, '岛屿传闻 · 继续探索');
  assert.equal(cue.actionLabel, '向迷雾前进');
  assert.equal(cue.completion, true);
  assert.equal(cue.blocking, false);
});

test('pause menu exposes A/B switching and loads play mode before the game', () => {
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src=["']([^"']+)["']><\/script>/g)].map(match => match[1].split('?')[0]);

  assert.match(html, /引导模式 A/);
  assert.match(html, /自由模式 B/);
  assert.match(html, /切换不会重置世界或日记/);
  assert.ok(scripts.indexOf('js/play-mode.js') >= 0);
  assert.ok(scripts.indexOf('js/play-mode.js') < scripts.indexOf('js/game.js'));
});

test('v2 persistence reads a legacy slot and writes the next save under the v2 key', () => {
  const storage = new Map();
  const previousStorage = global.localStorage;
  global.localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
  };
  try {
    storage.set(`${SaveStore.LEGACY_PREFIX}main`, JSON.stringify({ world: { saveSchemaVersion: 2, playMode: 'free', inventory: { fiber: 4 } } }));
    const loaded = SaveStore.loadLocal('main');
    assert.equal(loaded.world.playMode, 'free');
    assert.deepEqual(loaded.world.inventory, { fiber: 4 });

    assert.equal(SaveStore.saveLocal('main', loaded.world), true);
    const current = JSON.parse(storage.get(`${SaveStore.PREFIX}main`));
    assert.equal(current.world.playMode, 'free');
    assert.deepEqual(current.world.inventory, { fiber: 4 });
  } finally {
    global.localStorage = previousStorage;
  }
});

test('the offline shell upgrades its cache and includes the play-mode controller', () => {
  const worker = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  assert.match(worker, /survival-diary-shell-v83/);
  assert.match(worker, /\.\/js\/play-mode\.js/);
});
