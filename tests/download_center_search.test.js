const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../website/zhengzhengstudio.cn/downloads.html'), 'utf8');

test('download search uses script-bound input events and normalized searchable text', () => {
  assert.doesNotMatch(html, /oninput="filterFiles\(\)"/);
  assert.match(html, /searchInput\.addEventListener\('input', applyFilters\)/);
  assert.match(html, /function normalizeSearchText/);
  assert.match(html, /function searchableText/);
});

test('download center exposes platform filters and a live result count', () => {
  assert.match(html, /id="platformFilters"/);
  assert.match(html, /data-platform="all"/);
  assert.match(html, /data-platform="android"/);
  assert.match(html, /data-platform="harmonyos"/);
  assert.match(html, /id="resultCount"/);
  assert.match(html, /aria-live="polite"/);
});

test('download center keeps search and cards responsive in both themes', () => {
  assert.match(html, /\.search-bar input[\s\S]*background: var\(--downloads-surface\)/);
  assert.match(html, /\.search-bar input[\s\S]*color: var\(--downloads-text\)/);
  assert.match(html, /\.download-item[\s\S]*min-width: 0/);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /overflow-wrap: anywhere/);
});
