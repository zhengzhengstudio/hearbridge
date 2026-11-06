const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const site = path.join(root, 'website/survival-diary.zhengzhengstudio.cn');

function read(relativePath) {
  return fs.readFileSync(path.join(site, relativePath), 'utf8');
}

function readRgbaPng(relativePath) {
  const png = fs.readFileSync(path.join(site, relativePath));
  assert.equal(png.subarray(1, 4).toString(), 'PNG', `${relativePath} is not a PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(png[24], 8, `${relativePath} must use 8-bit channels`);
  assert.equal(png[25], 6, `${relativePath} must be RGBA`);
  assert.equal(png[28], 0, `${relativePath} must not be interlaced`);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString();
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const source = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      assert.notEqual(predictor, undefined, `${relativePath} has unknown PNG filter ${filter}`);
      pixels[y * stride + x] = (source + predictor) & 255;
    }
  }
  return { png, width, height, pixels };
}

test('login hierarchy and local-only disclosure are exact', () => {
  const html = read('index.html');
  assert.match(html, /建议使用铮铮通行证登录/);
  assert.match(html, /本地游玩/);
  assert.match(html, /本地存档仅保存在当前设备/);
  assert.doesNotMatch(html, /WebView|最终结局|通关/);
  const loginLinks = [...html.matchAll(/href=["']([^"']*passport\/login\.html[^"']*)["']/g)].map(match => match[1]);
  assert.ok(loginLinks.length >= 2);
  assert.ok(loginLinks.every(link => link.includes('redirect=https%3A%2F%2Fsurvival-diary.zhengzhengstudio.cn%2F')));
});

test('game surface exposes zoom, pan, follow, map, diary, friends and public islands', () => {
  const html = read('index.html');
  for (const id of [
    'world-canvas', 'zoom-in', 'zoom-out', 'follow-player', 'world-map',
    'diary-button', 'friends-button', 'public-islands-button',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`), `${id} is missing`);
  assert.match(html, /aria-label=["']放大地图["']/);
  assert.match(html, /aria-label=["']缩小地图["']/);
});

test('journal is statically loaded before save store, world and game without runtime injection', () => {
  const html = read('index.html');
  const saveStore = read('js/save-store.js');
  const scripts = [...html.matchAll(/<script\s+src=["']([^"']+)["']><\/script>/g)].map(match => match[1].split('?')[0]);

  const journalIndex = scripts.indexOf('js/journal.js');
  assert.ok(journalIndex >= 0, 'journal.js must be loaded by index.html');
  for (const dependent of ['js/save-store.js', 'js/world.js', 'js/game.js']) {
    assert.ok(journalIndex < scripts.indexOf(dependent), `journal.js must load before ${dependent}`);
  }
  assert.doesNotMatch(saveStore, /createElement\(['"]script['"]\)|append\(script\)|appendChild\(script\)/);
});

test('diary exposes labelled title and body controls for authored text', () => {
  const html = read('index.html');

  assert.match(html, /<label[^>]*for=["']journal-title["'][^>]*>[^<]+<\/label>/);
  assert.match(html, /<input[^>]*id=["']journal-title["'][^>]*>/);
  assert.match(html, /<label[^>]*for=["']journal-body["'][^>]*>[^<]+<\/label>/);
  assert.match(html, /<textarea[^>]*id=["']journal-body["'][^>]*>/);
});

test('play surface exposes real crafting, placement and journal controls', () => {
  const html = read('index.html');
  for (const id of ['crafting-panel', 'recipe-list', 'placement-toolbar', 'rotate-placement',
    'confirm-placement', 'cancel-placement', 'journal-panel', 'journal-title',
    'journal-body', 'journal-history']) assert.match(html, new RegExp(`id=["']${id}["']`));

  assert.match(html, /<aside[^>]*id=["']crafting-panel["']/);
  assert.match(html, /<aside[^>]*id=["']crafting-panel["'][^>]*\shidden(?:\s|>)/);
  assert.match(html, /<div[^>]*id=["']placement-toolbar["'][^>]*role=["']toolbar["']/);
  assert.match(html, /<section[^>]*id=["']journal-panel["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["']/);
  assert.match(html, /id=["']placement-status["'][^>]*role=["']status["']/);
  for (const id of ['rotate-placement', 'confirm-placement', 'cancel-placement']) {
    assert.match(html, new RegExp(`id=["']${id}["'][^>]*aria-label=["'][^"']+["']`));
  }
  assert.doesNotMatch(html, />\s*[🔥📦🪓📖]\s*</);
  assert.doesNotMatch(html, /\balert\s*\(/);
  const game = read('js/game.js');
  const content = read('js/content.js');
  assert.match(game, /item === 'road-segment'\) placeRoadAhead\(\)/);
  assert.match(game, /function placeRoadAhead\(\)/);
  assert.match(game, /Placement\.previewPlacement\(state, 'road-segment'/);
  assert.match(content, /roadSegment:\s*\{\s*input:\s*\{\s*stone:\s*1,\s*branch:\s*1\s*\}/);
});

test('responsive game UI provides a safe mobile action dock and desktop drawers', () => {
  const html = read('index.html');
  const css = read('styles.css');
  const mobile = css.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\n\}/i)?.[1] || '';

  assert.match(html, /class=["'][^"']*mobile-action-dock[^"']*["']/);
  assert.match(css, /\.crafting-panel[\s\S]*left:/);
  assert.match(css, /\.journal-panel[\s\S]*right:/);
  assert.match(mobile, /min-height:\s*100dvh/i);
  assert.match(mobile, /min-height:\s*44px/i);
  assert.match(mobile, /safe-area-inset-top/);
  assert.match(mobile, /safe-area-inset-bottom/);
  assert.doesNotMatch(mobile, /width:\s*100vw/i);
});

test('game controllers render recipe availability, explicit placement preview and journal history', () => {
  const game = read('js/game.js');

  for (const controller of ['openCraftingPanel', 'selectPlaceable', 'renderPlacementPreview', 'openJournal', 'renderJournalHistory']) {
    assert.match(game, new RegExp(`function ${controller}\\b`), `${controller} controller is missing`);
    assert.match(game, new RegExp(`window\\.${controller}\\s*=\\s*${controller}`), `${controller} is not exposed`);
  }
  assert.match(game, /Content\.RECIPES/);
  assert.match(game, /Crafting\.craft/);
  assert.match(game, /\w+Button\.disabled\s*=/);
  assert.match(game, /pointermove[\s\S]*renderPlacementPreview/);
  assert.match(game, /Placement\.rotatePlacement/);
  assert.match(game, /if\s*\(!placementPreview\?\.valid\)\s*return/);
  assert.match(game, /#6e9b78/i);
  assert.match(game, /#b85d52/i);
  assert.match(game, /drawEntityTexture\([^;]+,\s*view,\s*\.55\)/);
  assert.match(game, /Journal\.entriesForHistory/);
  assert.doesNotMatch(game, /\balert\s*\(/);
});

test('all playable mutations use the tested journal transaction interface', () => {
  const game = read('js/game.js');

  assert.match(game, /Journal\.commitActionMutation/);
  for (const action of ['applyWorldAction', 'craftRecipe', 'confirmPlacement', 'dismantleEntity', 'useEntity']) {
    assert.match(game, new RegExp(`function ${action}\\b[\\s\\S]*?commitMutation\\(`), `${action} must use commitMutation`);
  }
  for (const exposed of ['craftRecipe', 'dismantleEntity', 'useEntity']) {
    assert.match(game, new RegExp(`window\\.${exposed}\\s*=\\s*${exposed}`));
  }
});

test('game connects both authored controls and lifecycle flushes to tested controllers', () => {
  const game = read('js/game.js');

  assert.match(game, /Journal\.createDraftController/);
  assert.match(game, /SaveCoordinator\.createBrowserSaveCoordinator/);
  assert.match(game, /getElementById\(['"]journal-title['"]\)/);
  assert.match(game, /journal-title['"]\)\.addEventListener\(['"]input['"], queueDiaryDraft\)/);
  assert.match(game, /journal-body['"]\)\.addEventListener\(['"]input['"], queueDiaryDraft\)/);
  assert.match(game, /visibilitychange[\s\S]*flushDiaryDraft/);
  assert.match(game, /beforeunload[\s\S]*flushDiaryDraft/);
});

test('2.5D world supports multiple regions and an expanding camera', () => {
  const world = require('../website/survival-diary.zhengzhengstudio.cn/js/world.js');
  const state = world.createWorldView('20260726');
  assert.equal(state.camera.zoom, 1.85);
  assert.ok(state.regionKinds.length >= 5);
  assert.equal(state.projection, '2.5d');
  assert.equal(world.setZoom(state, 0.1).camera.zoom, 0.35);
  assert.equal(world.setZoom(state, 9).camera.zoom, 3);
  assert.equal(Object.keys(state.regions).length, 9);

  const expanded = world.ensureRegions(state, { x: 8_000, y: -6_000 });
  assert.ok(Object.keys(expanded.regions).length > Object.keys(state.regions).length);
  assert.equal('ending' in expanded, false);
  assert.equal('mapBoundary' in expanded, false);
});

test('camera keeps at least one source pixel per CSS pixel across the supported zoom range', () => {
  const world = require('../website/survival-diary.zhengzhengstudio.cn/js/world.js');
  const overview = world.renderPlanForZoom(1);
  const closeUp = world.renderPlanForZoom(world.MAX_ZOOM);

  assert.equal(overview.mode, 'overview');
  assert.ok(overview.sourcePixelsPerCssPixel >= 1, `overview density was ${overview.sourcePixelsPerCssPixel}`);
  assert.equal(closeUp.mode, 'region-detail');
  assert.ok(closeUp.sourcePixelsPerCssPixel >= 1, `close-up density was ${closeUp.sourcePixelsPerCssPixel}`);
});

test('tap movement advances the player toward a world target without requiring a keyboard', () => {
  const world = require('../website/survival-diary.zhengzhengstudio.cn/js/world.js');
  const state = world.createWorldView('touch-input');
  state.resourceNodes = {};
  state.entities = [];
  const targeted = world.setPlayerTarget(state, { x: state.player.x + 90, y: state.player.y });
  const moved = world.stepPlayer(targeted, 0.5);

  assert.ok(moved.player.x > state.player.x);
  assert.equal(moved.player.y, state.player.y);
  assert.equal(moved.player.moving, true);
});

test('gathering, fishing, eating and building form a resource-consuming survival loop', () => {
  const world = require('../website/survival-diary.zhengzhengstudio.cn/js/world.js');
  const initial = world.createWorldView('survival-loop');
  const gathered = world.performAction(initial, { type: 'gather', regionKind: 'palm-grove' });
  assert.equal(gathered.state.inventory['palm-fiber'], (initial.inventory['palm-fiber'] || 0) + 1);
  assert.equal(gathered.state.vitals.energy, initial.vitals.energy - 2);

  const fished = world.performAction(gathered.state, { type: 'fish', regionKind: 'lagoon' });
  assert.equal(fished.state.inventory['reef-fish'], (gathered.state.inventory['reef-fish'] || 0) + 1);

  const hungry = { ...fished.state, vitals: { ...fished.state.vitals, food: 50 } };
  const eaten = world.performAction(hungry, { type: 'use', item: 'reef-fish' });
  assert.equal(eaten.state.inventory['reef-fish'], hungry.inventory['reef-fish'] - 1);
  assert.equal(eaten.state.vitals.food, 68);

  const buildReady = { ...eaten.state, inventory: { ...eaten.state.inventory, palisade: 1 } };
  const built = world.performAction(buildReady, { type: 'build', item: 'palisade' });
  assert.equal(built.state.inventory.palisade, buildReady.inventory.palisade - 1);
});

test('mobile viewport preserves accessibility zoom instead of disabling it', () => {
  const html = read('index.html');
  const viewport = html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i)?.[1] || '';

  assert.match(viewport, /width=device-width/);
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(viewport, /maximum-scale\s*=\s*1/i);
});

test('production art includes character/action sheets and modular terrain tiles', () => {
  const expected = [
    'assets/art/survivor-directions-v1.png',
    'assets/art/survivor-actions-v1.png',
    'assets/art/building-props-v1.png',
    'assets/game/terrain-v4/palm-grove/base-01.png',
    'assets/game/terrain-v4/lagoon/base-01.png',
  ];
  for (const file of expected) {
    const stats = fs.statSync(path.join(site, file));
    assert.ok(stats.size > 20_000, `${file} is not a production asset`);
  }
});

test('all eight placeables are detailed transparent textures without magenta edge pixels', () => {
  const files = [
    'campfire-v1.png', 'shelter-v1.png', 'storage-crate-v1.png', 'rain-collector-v1.png',
    'workbench-v1.png', 'fish-rack-v1.png', 'palisade-v1.png', 'garden-plot-v1.png',
  ];
  for (const file of files) {
    const relativePath = `assets/art/placeables/${file}`;
    const { png, width, height, pixels } = readRgbaPng(relativePath);
    assert.ok(png.length > 40_000, `${file} is too small to be a detailed texture`);
    assert.ok(width >= 512 && height >= 512, `${file} must be at least 512x512`);
    for (const pixelOffset of [3, (width - 1) * 4 + 3, (height - 1) * width * 4 + 3, pixels.length - 1]) {
      assert.equal(pixels[pixelOffset], 0, `${file} must have transparent corners`);
    }
    let magentaEdgePixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [red, green, blue, alpha] = pixels.subarray(offset, offset + 4);
      if (alpha > 0 && alpha < 255 && red > 180 && blue > 180 && green < 100) magentaEdgePixels += 1;
    }
    assert.equal(magentaEdgePixels, 0, `${file} has magenta fringe pixels`);
  }
});

test('app icon master and PWA derivatives have exact production dimensions', () => {
  for (const [file, expected] of [
    ['assets/art/app-icon-master-v1.png', 1024],
    ['assets/icons/icon-192.png', 192],
    ['assets/icons/icon-512.png', 512],
  ]) {
    const { width, height, pixels } = readRgbaPng(file);
    assert.equal(width, expected, `${file} width`);
    assert.equal(height, expected, `${file} height`);
    assert.equal(pixels[3], 0, `${file} must retain transparent safe corners`);
    let magentaEdgePixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [red, green, blue, alpha] = pixels.subarray(offset, offset + 4);
      if (alpha > 0 && alpha < 255 && red > 180 && blue > 180 && green < 100) magentaEdgePixels += 1;
    }
    assert.equal(magentaEdgePixels, 0, `${file} has magenta fringe pixels`);
  }
  assert.match(read('index.html'), /<link[^>]+rel=["']icon["'][^>]+href=["']assets\/icons\/icon-192\.png["']/);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.deepEqual(manifest.icons.map(icon => [icon.src, icon.sizes, icon.type, icon.purpose]), [
    ['assets/icons/icon-192.png', '192x192', 'image/png', 'any'],
    ['assets/icons/icon-512.png', '512x512', 'image/png', 'any'],
  ]);
});

test('world entities preload and render their exact 2.5D texture map with fallback', () => {
  const game = read('js/game.js');
  const expected = {
    campfire: 'campfire-v1.png', shelter: 'shelter-v1.png', storageCrate: 'storage-crate-v1.png',
    rainCollector: 'rain-collector-v1.png', workbench: 'workbench-v1.png', fishRack: 'fish-rack-v1.png',
    palisade: 'palisade-v1.png', gardenPlot: 'garden-plot-v1.png',
  };
  for (const [type, file] of Object.entries(expected)) {
    assert.match(game, new RegExp(`${type}:\\s*['\"][^'\"]*${file.replace('.', '\\.')}['\"]`));
  }
  assert.match(game, /World\.entitySpriteKey\(entity\)/);
  assert.match(game, /function drawEntityTexture\b/);
  assert.match(game, /context\.drawImage\(image/);
  assert.match(game, /drawEntityFallback\(entity/);
  assert.match(game, /asset error|\u7d20\u6750\u52a0\u8f7d\u5931\u8d25/i);
});

test('the visible world is rendered from deterministic modular chunks without an authored atlas', () => {
  const game = read('js/game.js');
  assert.match(game, /WorldChunks\.visibleChunkCoordinates/);
  assert.match(game, /WorldChunks\.chunkAt/);
  assert.match(game, /TerrainRenderer\.render/);
  assert.doesNotMatch(game, /continuous-world-atlas-v3|drawContinuousWorld|drawRegionDetails/);
});

test('placement module is loaded and the canvas uses persistent entities between terrain and player', () => {
  const html = read('index.html');
  const game = read('js/game.js');
  assert.match(html, /<script\s+src=["']js\/placement\.js(?:\?[^"']+)?["']><\/script>/);
  assert.match(game, /const Placement = window\.SurvivalPlacement/);
  assert.match(game, /Placement\.previewPlacement/);
  assert.match(game, /Placement\.confirmPlacement/);
  assert.doesNotMatch(game, /applyWorldAction\(\{ type: 'build'/);
  assert.doesNotMatch(game, /state\.placed/);
  assert.match(game, /frameVisibleEntities = WorldPhysics\.visibleEntities\(state/);
  assert.doesNotMatch(game, /visibleEntities = World\.sceneObjectsForRender\(state\)/);
  assert.match(game, /drawEntityFallback/);
  assert.ok(game.indexOf('TerrainRenderer.render(') < game.indexOf('WorldPhysics.visibleEntities(state'));
  assert.ok(game.indexOf('WorldPhysics.visibleEntities(state') < game.indexOf("item.kind === 'player'"));
  assert.ok(game.indexOf("item.kind === 'player'") < game.indexOf('drawPlayer(view);'));
  assert.match(game, /entities:\s*Array\.isArray\(saved\.world\.entities\)/);
});

test('design tokens, responsive layout and reduced motion follow the accepted concept', () => {
  const css = read('styles.css');
  assert.match(css, /--ocean:\s*#176b78/i);
  assert.match(css, /--forest:\s*#2f6b4f/i);
  assert.match(css, /--coral:\s*#e56f51/i);
  assert.match(css, /--radius-panel:\s*14px/i);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/i);
});

test('PWA shell contains the playable files and defers activation', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const serviceWorker = read('sw.js');
  assert.equal(manifest.name, '生存日记');
  assert.equal(manifest.display, 'standalone');
  assert.match(serviceWorker, /survival-diary-shell-v83/);
  assert.match(html, /js\/terrain-renderer\.js\?v=05019/);
  for (const modulePath of ['./js/content.js', './js/crafting.js', './js/placement.js', './js/journal.js', './js/save-coordinator.js', './js/onboarding-controller.js']) {
    assert.match(serviceWorker, new RegExp(modulePath.replaceAll('.', '\\.')));
  }
  for (const assetPath of [
    './assets/icons/icon-192.png', './assets/icons/icon-512.png',
    './assets/art/placeables/campfire-v1.png', './assets/art/placeables/shelter-v1.png',
    './assets/art/placeables/storage-crate-v1.png', './assets/art/placeables/rain-collector-v1.png',
    './assets/art/placeables/workbench-v1.png', './assets/art/placeables/fish-rack-v1.png',
    './assets/art/placeables/palisade-v1.png', './assets/art/placeables/garden-plot-v1.png',
  ]) assert.match(serviceWorker, new RegExp(assetPath.replaceAll('.', '\\.')));
  assert.doesNotMatch(serviceWorker, /skipWaiting\(\)/);
});

test('keyboard movement is released inside journal editing while Escape still closes panels', () => {
  const { handleSurvivalDiaryKeydown } = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
  const movement = [];
  let escapeCount = 0;
  const actions = {
    move: key => movement.push(key),
    escape: () => { escapeCount += 1; },
    isBuilding: () => false,
  };
  const editingContexts = ['input', 'textarea', 'select', '[contenteditable]', '#journal-panel'];

  for (const context of editingContexts) {
    const editableTarget = { closest: selector => selector.includes(context) ? {} : null };
    for (const key of ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      let prevented = false;
      const result = handleSurvivalDiaryKeydown({
        key,
        target: editableTarget,
        preventDefault: () => { prevented = true; },
      }, actions);
      assert.equal(result, 'editing', `${key} in ${context}`);
      assert.equal(prevented, false, `${key} must remain available to ${context}`);
    }
  }
  assert.deepEqual(movement, []);

  const editableTarget = { closest: selector => selector.includes('#journal-panel') ? {} : null };
  const escapeResult = handleSurvivalDiaryKeydown({ key: 'Escape', target: editableTarget }, actions);
  assert.equal(escapeResult, 'escape');
  assert.equal(escapeCount, 1);

  let prevented = false;
  const movementResult = handleSurvivalDiaryKeydown({
    key: 'w',
    target: { closest: () => null },
    preventDefault: () => { prevented = true; },
  }, actions);
  assert.equal(movementResult, 'movement');
  assert.equal(prevented, true);
  assert.deepEqual(movement, ['w']);
});

test('web stamina visibly recovers while idle and drains while the player is walking', () => {
  const { advanceVitals } = require('../website/survival-diary.zhengzhengstudio.cn/js/environment.js');
  const world = {
    player: { temperature: 37 },
    vitals: { health: 80, energy: 20, food: 90, water: 90, effects: [] },
  };

  const idle = advanceVitals(world, 8, { activity: 'idle' });
  const walking = advanceVitals(world, 8, { activity: 'walking' });
  const starving = advanceVitals({
    ...world,
    vitals: { ...world.vitals, food: 10, water: 10 },
  }, 8, { activity: 'idle' });

  assert.ok(idle.vitals.energy >= 21.7);
  assert.ok(walking.vitals.energy < world.vitals.energy);
  assert.equal(starving.vitals.energy, world.vitals.energy);
  assert.ok(idle.recoveryState.staminaRate > 0);
});

test('fog-bank artwork is tiled at its native aspect ratio instead of stretched across an edge', () => {
  const { fogBankTileLayout } = require('../website/survival-diary.zhengzhengstudio.cn/js/terrain-renderer.js');
  const source = { width: 1536, height: 384 };
  const tiles = fogBankTileLayout(1440, 180, source.width, source.height);

  assert.ok(tiles.length > 1, 'a long frontier should use more than one fog-bank tile');
  assert.ok(Math.abs(tiles.reduce((sum, tile) => sum + tile.width, 0) - 1440) < 0.001);
  for (const tile of tiles) {
    assert.equal(tile.height, 180);
    assert.ok(Math.abs(tile.width / tile.height - tile.sourceWidth / tile.sourceHeight) < 0.000001);
  }
});

test('discovery focus buttons invoke their region operation and select the nearest matching region', () => {
  const {
    bindSurvivalDiscoveryFocus,
    nearestSurvivalRegion,
  } = require('../website/survival-diary.zhengzhengstudio.cn/js/game.js');
  const listeners = new Map();
  const buttons = ['palm-grove', 'mangrove', 'tide-ruins'].map(kindId => ({
    dataset: { focus: kindId },
    addEventListener: (type, listener) => listeners.set(kindId, { type, listener }),
  }));
  const focused = [];

  assert.equal(bindSurvivalDiscoveryFocus({ querySelectorAll: () => buttons }, kindId => focused.push(kindId)), 3);
  listeners.get('mangrove').listener();
  assert.equal(listeners.get('mangrove').type, 'click');
  assert.deepEqual(focused, ['mangrove']);

  const nearest = nearestSurvivalRegion({
    far: { id: 'far', kindId: 'mangrove', x: 5, y: 4 },
    other: { id: 'other', kindId: 'palm-grove', x: 0, y: 0 },
    near: { id: 'near', kindId: 'mangrove', x: 1, y: 2 },
  }, 'mangrove', { x: 1.5, y: 1.5 });
  assert.equal(nearest.id, 'near');
});
