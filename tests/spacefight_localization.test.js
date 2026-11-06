'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const localizationSource = path.join(projectRoot, 'assets', 'scripts', 'ui', 'Localization.ts');
const hudSource = readFileSync(path.join(
  projectRoot,
  'assets',
  'scripts',
  'game',
  'NativeCombatHud.ts',
), 'utf8');
const outputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-localization-'));

test.after(() => rmSync(outputRoot, { recursive: true, force: true }));

const compile = spawnSync('npx', [
  '--yes', '--package', 'typescript@4.9.5', 'tsc',
  '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--skipLibCheck', '--lib', 'ES2020,DOM',
  '--outDir', outputRoot,
  localizationSource,
], { cwd: projectRoot, encoding: 'utf8' });

assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);

const localization = require(path.join(outputRoot, 'Localization.js'));

test('ships exactly eight complete combat HUD locales', () => {
  assert.deepEqual(localization.SUPPORTED_LOCALES, [
    'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'pt-BR', 'fr',
  ]);

  const baselineKeys = Object.keys(localization.COMBAT_HUD_MESSAGES['zh-CN']).sort();
  assert.ok(baselineKeys.length >= 65, 'combat HUD catalog should cover all visible surfaces');
  for (const locale of localization.SUPPORTED_LOCALES) {
    const messages = localization.COMBAT_HUD_MESSAGES[locale];
    assert.deepEqual(Object.keys(messages).sort(), baselineKeys, `${locale} has missing keys`);
    assert.ok(Object.values(messages).every(value => typeof value === 'string' && value.trim()));
    for (const key of ['expedition.primary', 'expedition.decision', 'expedition.return', 'cargo.capacity', 'tutorial.return', 'settings.checkUpdate']) {
      assert.ok(messages[key], `${locale} is missing ${key}`);
    }
  }
});

test('non-English catalogs do not inherit English player copy', () => {
  const english = localization.COMBAT_HUD_MESSAGES.en;
  for (const locale of ['ja', 'ko', 'es', 'pt-BR', 'fr']) {
    const inherited = Object.keys(english).filter(key => (
      localization.COMBAT_HUD_MESSAGES[locale][key] === english[key]
    ));
    assert.deepEqual(inherited, [], `${locale} still exposes English keys: ${inherited.join(', ')}`);
  }
});

test('detects browser and system language variants with zh-CN fallback', () => {
  const cases = [
    [['zh-Hant-HK'], 'zh-TW'],
    [['zh-SG'], 'zh-CN'],
    [['en-US'], 'en'],
    [['ja-JP'], 'ja'],
    [['ko-KR'], 'ko'],
    [['es-MX'], 'es'],
    [['pt-PT'], 'pt-BR'],
    [['fr-CA'], 'fr'],
    [['de-DE', 'ja-JP'], 'ja'],
    [['de-DE'], 'zh-CN'],
    [[], 'zh-CN'],
  ];

  for (const [languages, expected] of cases) {
    assert.equal(localization.resolveCombatLocale(languages), expected, languages.join(','));
  }
});

test('translates placeholders and obtains browser language without throwing', () => {
  assert.equal(
    localization.combatText('en', 'status.hull', { current: 72, max: 100 }),
    'HULL 72/100',
  );
  assert.equal(
    localization.combatText('zh-CN', 'target.range', { range: 418 }),
    '418米',
  );
  assert.equal(localization.detectCombatLocale({ languages: ['fr-FR'] }), 'fr');
  assert.equal(localization.detectCombatLocale({}), 'zh-CN');
});

test('NativeCombatHud routes key player-visible copy through localization', () => {
  assert.match(hudSource, /from ['"]\.\.\/ui\/Localization['"]/);
  assert.match(hudSource, /detectCombatLocale\(/);
  assert.match(hudSource, /combatText\(/);

  for (const rawCopy of [
    'NO TARGET',
    'STARTUP ERROR',
    '战场资源未能完成装载',
    '请重新启动应用',
    '战备装配台  /  HARDPOINTS',
    '应用并进入战场',
    '使用默认装配进入',
    '确认装配后进入战场',
  ]) {
    assert.doesNotMatch(hudSource, new RegExp(rawCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
