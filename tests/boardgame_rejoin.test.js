const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { findRejoinPlayer } = require('../website/api/boardgames/rejoin-seat');

test('rejoin restores the exact device seat before using a fallback', () => {
  const players = [
    { username: '铮铮', clientDeviceId: 'phone', connected: false, slotId: 'seat-1' },
    { username: '铮铮', clientDeviceId: 'tablet', connected: false, slotId: 'seat-2' }
  ];
  assert.equal(findRejoinPlayer(players, '铮铮', 'tablet')?.slotId, 'seat-2');
});

test('rejoin restores the only disconnected seat when a legacy client changes device id', () => {
  const players = [
    { username: '铮铮', clientDeviceId: 'old-connection', connected: false, slotId: 'seat-1' },
    { username: '对手', clientDeviceId: 'other', connected: true, slotId: 'seat-2' }
  ];
  assert.equal(findRejoinPlayer(players, '铮铮', 'new-connection')?.slotId, 'seat-1');
});

test('rejoin never guesses between multiple disconnected devices on one account', () => {
  const players = [
    { username: '铮铮', clientDeviceId: 'phone', connected: false, slotId: 'seat-1' },
    { username: '铮铮', clientDeviceId: 'tablet', connected: false, slotId: 'seat-2' }
  ];
  assert.equal(findRejoinPlayer(players, '铮铮', 'unknown'), null);
});

test('deployed server and HarmonyOS client use stable-seat rejoin identity', () => {
  const server = fs.readFileSync('website/api/server.js', 'utf8');
  const sync = fs.readFileSync('sync_to_termux.js', 'utf8');
  const harmony = fs.readFileSync(
    'HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets',
    'utf8'
  );
  assert.match(server, /findRejoinPlayer\(room\.players, playerName, cleanDeviceId\)/);
  assert.match(server, /findRejoinPlayer\(room\.players, playerName, clientDeviceId\)/);
  assert.match(sync, /api\/boardgames\/rejoin-seat\.js[\s\S]*api\/server\.js/);
  assert.match(harmony, /clientDeviceId:\s*this\.stableClientDeviceId\(\)/);
  assert.match(harmony, /zz_boardgame_device_id/);
});
