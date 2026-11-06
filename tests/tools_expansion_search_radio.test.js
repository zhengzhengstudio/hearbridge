const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../website/zhengzhengstudio.cn');
const catalogPath = path.join(root, 'assets/js/quick-tools-data.js');
const enginePath = path.join(root, 'assets/js/quick-tools-engine.js');
const searchPath = path.join(root, 'assets/js/tools-search.js');
const indexPath = path.join(root, 'tools/index.html');
const quickToolPath = path.join(root, 'tools/quick_tool.html');
const radioPath = path.join(root, 'tools/radio_direction_finder.html');
const quickCssPath = path.join(root, 'assets/css/quick-tools.css');
const radioCssPath = path.join(root, 'assets/css/radio-direction.css');
const radioScriptPath = path.join(root, 'assets/js/radio-direction.js');
const indexControllerPath = path.join(root, 'assets/js/tools-index.js');

test('quick tool catalog adds at least 36 unique, searchable tools', () => {
    const catalog = require(catalogPath);
    assert.ok(catalog.length >= 36, `expected at least 36 tools, got ${catalog.length}`);
    assert.equal(new Set(catalog.map(tool => tool.id)).size, catalog.length);

    catalog.forEach(tool => {
        assert.match(tool.id, /^[a-z0-9-]+$/);
        assert.ok(tool.title.length >= 2);
        assert.ok(tool.description.length >= 8);
        assert.ok(tool.category.length >= 2);
        assert.ok(Array.isArray(tool.keywords) && tool.keywords.length >= 3);
        assert.ok(Array.isArray(tool.fields) && tool.fields.length >= 1);
    });
});

test('every quick tool has an executable calculator and produces output', () => {
    const catalog = require(catalogPath);
    const engine = require(enginePath);

    catalog.forEach(tool => {
        assert.equal(typeof engine.calculators[tool.id], 'function', `${tool.id} calculator missing`);
        const sample = Object.fromEntries(tool.fields.map(field => [field.name, field.sample ?? field.value ?? '1']));
        const result = engine.runTool(tool.id, sample);
        assert.equal(result.ok, true, `${tool.id}: ${result.error || 'no output'}`);
        assert.ok(result.summary || result.text || result.rows?.length, `${tool.id} returned empty output`);
    });
});

test('search handles aliases, mixed keywords and relevance ordering', () => {
    const catalog = require(catalogPath);
    const { searchTools } = require(searchPath);
    const indexed = catalog.map(tool => ({ ...tool, href: `quick_tool.html?tool=${tool.id}` }));

    assert.equal(searchTools(indexed, '折扣')[0].id, 'discount-calculator');
    assert.equal(searchTools(indexed, 'css 阴影')[0].id, 'css-shadow-generator');
    assert.equal(searchTools(indexed, 'jwt token')[0].id, 'jwt-decoder');
    assert.equal(searchTools(indexed, 'shui dian fei')[0].id, 'electricity-cost');
    assert.equal(searchTools(indexed, '波长')[0].id, 'frequency-wavelength');
    assert.deepEqual(searchTools(indexed, '不存在的工具'), []);
});

test('tools index loads catalog, working search controller and standalone radio entry', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.match(html, /quick-tools-data\.js/);
    assert.match(html, /tools-search\.js/);
    assert.match(html, /tools-index\.js/);
    assert.match(html, /radio_direction_finder\.html/);
    assert.match(html, /id="searchResultCount"[^>]*aria-live="polite"/);
});

test('every existing top-level tool page has a searchable home entry', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const controller = fs.readFileSync(indexControllerPath, 'utf8');
    const indexedSource = `${html}\n${controller}`;
    const excluded = new Set(['index.html', 'quick_tool.html', 'radio_direction_finder.html']);
    const pages = fs.readdirSync(path.join(root, 'tools')).filter(name => name.endsWith('.html') && !excluded.has(name));
    const missing = pages.filter(name => !indexedSource.includes(name));
    assert.deepEqual(missing, []);
});

test('expanded tools index exposes 143 entries in total', () => {
    const catalog = require(catalogPath);
    const html = fs.readFileSync(indexPath, 'utf8');
    const controller = fs.readFileSync(indexControllerPath, 'utf8');
    const staticCards = (html.match(/class="tool-card(?:\s|\")/g) || []).length;
    const restoredCards = (controller.match(/href: '[^']+\.html'/g) || []).length;
    assert.equal(staticCards + restoredCards + catalog.length, 143);
});

test('quick tool runner and radio direction finder expose responsive functional surfaces', () => {
    const quickHtml = fs.readFileSync(quickToolPath, 'utf8');
    const radioHtml = fs.readFileSync(radioPath, 'utf8');
    const quickCss = fs.readFileSync(quickCssPath, 'utf8');
    const radioCss = fs.readFileSync(radioCssPath, 'utf8');
    const radioScript = fs.readFileSync(radioScriptPath, 'utf8');

    assert.match(quickHtml, /id="quickToolForm"/);
    assert.match(quickHtml, /quick-tools-engine\.js/);
    assert.match(quickCss, /@media \(max-width: 680px\)/);
    assert.match(radioHtml, /Tone\.js/);
    assert.match(radioScript, /AudioContext|webkitAudioContext/);
    assert.match(radioHtml, /id="bearingDial"/);
    assert.match(radioHtml, /id="signalMeter"/);
    assert.match(radioHtml, /id="startAudio"/);
    assert.match(radioCss, /@media \(max-width: 760px\)/);
});
