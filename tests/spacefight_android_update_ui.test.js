const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'SpaceFight-Cocos',
  'native',
  'engine',
  'android',
  'app',
  'src',
  'com',
  'cocos',
  'game',
  'AppActivity.java',
), 'utf8');

test('Android update prompt uses the in-game release panel and keeps downloads in-app', () => {
  const prompt = source.slice(
    source.indexOf('private void showUpdatePrompt'),
    source.indexOf('private void downloadUpdate'),
  );
  assert.match(prompt, /new Dialog\(this\)/);
  assert.match(prompt, /SPACEFIGHT \/\/ RELEASE CHANNEL/);
  assert.match(prompt, /下载并安装/);
  assert.match(source, /DOWNLOAD_WORKERS\s*=\s*4/);
  assert.match(source, /Executors\.newFixedThreadPool\(DOWNLOAD_WORKERS\)/);
  assert.match(source, /setRequestProperty\("Range"/);
  assert.match(source, /RandomAccessFile/);
  assert.doesNotMatch(prompt, /ACTION_VIEW/);
});

test('update dialog keeps release notes behind a collapsed arrow until tapped', () => {
  const prompt = source.slice(
    source.indexOf('private void showUpdatePrompt'),
    source.indexOf('private void downloadUpdate'),
  );
  // 内容来自发布清单 notes，缺失时退回 remarks，最多 4 条。
  assert.match(source, /optJSONArray\("notes"\)/);
  assert.match(source, /optString\("remarks", ""\)/);
  assert.match(source, /MAX_UPDATE_NOTES\s*=\s*4/);
  assert.match(source, /readUpdateNotes\(update\)/);
  // 小箭头默认收起，点击后展开并可再次收起。
  assert.match(prompt, /更新内容\s+▸/);
  assert.match(prompt, /更新内容\s+▾/);
  assert.match(prompt, /notesBody\.setVisibility\(View\.GONE\)/);
  assert.match(prompt, /notesToggle\.setOnClickListener/);
  assert.match(prompt, /expanded \? View\.GONE : View\.VISIBLE/);
  assert.ok(
    prompt.indexOf('notesBody.setVisibility(View.GONE)') < prompt.indexOf('notesToggle.setOnClickListener'),
    'release notes must start collapsed on every dialog',
  );
  assert.match(prompt, /ScrollView/);
  // 不写偏好：每次弹窗都回到默认收起状态，而不是全局设置开关。
  assert.doesNotMatch(source, /UPDATE_NOTES_KEY|updateNotesEnabled\(|SharedPreferences.*notes/i);
  // 原有更新弹窗能力保持不回归。
  assert.match(prompt, /new Dialog\(this\)/);
  assert.match(prompt, /下载并安装/);
});

test('distribution manifest supplies non-empty release notes for the dialog', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '..',
    'website',
    'zhengzhengstudio.cn',
    'api',
    'apps',
    'manifest.json',
  ), 'utf8'));
  const entry = manifest.apps.find(app => app.id === 'spacefight-android');
  assert.ok(entry, 'spacefight-android entry is required');
  assert.ok(Array.isArray(entry.notes) && entry.notes.length > 0, 'notes must be a non-empty array');
  assert.ok(entry.notes.every(note => typeof note === 'string' && note.trim()));
  assert.ok(typeof entry.remarks === 'string' && entry.remarks.trim(), 'remarks fallback must exist');
});
