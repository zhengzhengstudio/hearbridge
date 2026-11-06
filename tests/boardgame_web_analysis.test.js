const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'website', 'zhengzhengstudio.cn', 'boardgames');

test('three core board pages mount the shared in-game analysis studio', () => {
  for (const page of ['gobang.html', 'go.html', 'chess.html']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(source, /board-analysis-core\.js/);
    assert.match(source, /analysis-studio\.js/);
    assert.match(source, /analysis-studio\.css/);
    assert.match(source, /ZZAnalysisStudio\.mount/);
    assert.match(source, /getState\s*:/);
    assert.match(source, /setState\s*:/);
  }
});

test('Xiangqi local AI never depends on a device localhost service', () => {
  const source = fs.readFileSync(path.join(root, 'chess.html'), 'utf8');
  assert.doesNotMatch(source, /localhost:8113/);
  assert.match(source, /ZZBoardCore\.bestMove/);
  assert.match(source, /executeMoveLocal/);
});

test('analysis studio provides analysis, puzzle, editor and local AI modes', () => {
  const source = fs.readFileSync(path.join(root, 'analysis-studio.js'), 'utf8');
  for (const contract of ['data-mode="analysis"', 'data-mode="puzzle"', 'data-mode="editor"', 'data-action="local-ai"']) {
    assert.ok(source.includes(contract), `missing ${contract}`);
  }
  assert.match(source, /validateState/);
  assert.match(source, /bestMove/);
  assert.match(source, /localStorage/);
  assert.match(source, /\/api\/boardgames\/analysis\/analyze/);
  assert.match(source, /AbortController/);
  assert.match(source, /本地结果/);
  assert.match(source, /requestedMode === 'play'/);
  assert.match(source, /startAiGame/);
  assert.match(source, /setInterval/);
});

test('website exposes a separate responsive study hub for the three supported boards', () => {
  const html = fs.readFileSync(path.join(root, 'study.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'study.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'study.js'), 'utf8');
  for (const game of ['gobang', 'go', 'xiangqi']) assert.match(html, new RegExp(`data-game="${game}"`));
  for (const mode of ['puzzle', 'editor', 'play', 'analysis']) assert.match(js, new RegExp(`'${mode}'`));
  assert.match(js, /study: mode/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /@media \(min-width: 760px\).*orientation: landscape/);
});

test('analysis studio CSS keeps the board primary on mobile and desktop', () => {
  const source = fs.readFileSync(path.join(root, 'analysis-studio.css'), 'utf8');
  assert.match(source, /@media\s*\(max-width:\s*720px\)/);
  assert.match(source, /max-height:\s*min\(/);
  assert.match(source, /prefers-color-scheme:\s*light/);
  assert.match(source, /zz-analysis-backdrop[\s\S]*z-index:\s*9700/);
  assert.match(source, /body\.zz-boardgame-enhanced \.zz-analysis-launcher\s*\{\s*display:\s*none/);
});
