const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync(
  'MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java',
  'utf8'
);

test('Android asks every non-requesting player to approve or reject a reset', () => {
  assert.match(source, /"reset-requested"\.equals\(name\)[\s\S]*showResetVoteDialog/);
  assert.match(source, /setNegativeButton\("拒绝"/);
  assert.match(source, /setPositiveButton\("同意"/);
  assert.match(source, /sendResetVote\(true\)/);
  assert.match(source, /sendResetVote\(false\)/);
});

test('Android keeps the requester waiting and closes voting UI after a result', () => {
  assert.match(source, /requester\.equals\(playerName\)[\s\S]*等待其他玩家确认/);
  assert.match(source, /"reset-rejected"\.equals\(name\)[\s\S]*dismissResetVoteDialog\(\)/);
  assert.match(source, /"reset-approved"\.equals\(name\)[\s\S]*dismissResetVoteDialog\(\)/);
});

test('Android no longer auto-approves reset requests', () => {
  const branch = source.match(/"reset-requested"\.equals\(name\)([\s\S]*?)"reset-vote-update"\.equals\(name\)/)?.[1] || '';
  assert.doesNotMatch(branch, /put\("approve",\s*true\)/);
});

test('Android sends reset votes as protocol messages instead of board actions', () => {
  assert.match(source, /"reset-vote"\.equals\(event\.optString\("type"\)\)[\s\S]*payload\.put\("type", "reset-vote"\)[\s\S]*payload\.put\("approve", event\.optBoolean\("approve"\)\)[\s\S]*sendRaw\(payload\)/);
});
