const assert = require('node:assert/strict');
const test = require('node:test');

const product = require('../website/zhengzhengstudio.cn/boardgames/product-model.js');

test('primary navigation stays focused on three player tasks', () => {
  assert.deepEqual(product.navigation.map(item => item.id), ['lobby', 'games', 'profile']);
});

test('theme modes support system, light and dark appearances', () => {
  assert.deepEqual(product.themeModes.map(item => item.id), ['system', 'light', 'dark']);
});

test('every game declares whether it is playable instead of falling back to Gomoku', () => {
  assert.ok(product.games.length >= 15);
  for (const game of product.games) {
    assert.match(game.id, /^[a-z0-9-]+$/);
    assert.ok(['ready', 'preview'].includes(game.availability), `${game.id} has invalid availability`);
    assert.ok(Array.isArray(game.modes) && game.modes.length > 0, `${game.id} has no modes`);
  }
});

test('core ready games expose the correct player counts', () => {
  const byId = Object.fromEntries(product.games.map(game => [game.id, game]));
  assert.deepEqual(byId.gobang.players, [2, 2]);
  assert.deepEqual(byId.go.players, [2, 2]);
  assert.deepEqual(byId.rummy.players, [2, 4]);
  assert.deepEqual(byId.ludo.players, [2, 4]);
});
