const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const runtimeTextExtensions = new Set(['.ets', '.ts', '.js', '.json', '.json5', '.xml']);

function isExcludedOfflineDirectory(relativeDirectory) {
  const segments = relativeDirectory.split(path.sep);
  if (segments.some((segment) => ['.git', '.hvigor', 'build', 'node_modules'].includes(segment))) return true;
  if (segments.some((segment) => /^(?:signing|certificates?|keystores?)$/i.test(segment))) return true;
  const resources = segments.lastIndexOf('resources');
  return resources >= 0 && segments.slice(resources + 1).some((segment) => ['media', 'rawfile'].includes(segment));
}

function collectOfflineProjectText(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return isExcludedOfflineDirectory(child) ? [] : collectOfflineProjectText(child);
    }
    if (entry.name === 'oh-package-lock.json5') return [];
    return runtimeTextExtensions.has(path.extname(entry.name).toLowerCase()) ? [{ path: child, text: read(child) }] : [];
  });
}

function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '\"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findMethodBodies(source, names) {
  const escapedNames = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const declarations = [
    {
      pattern: new RegExp(`^\\s*(?:(?:private|public|protected|internal|open|override|suspend|final|static|abstract|inline|tailrec|operator|infix|external)\\s+)*fun\\s+(?:<[^>{}]+>\\s*)?(?:[A-Za-z_$][\\w$<>,.?]*\\.)?(${escapedNames})\\s*\\(`, 'gm'),
      bodySignature: /^\s*(?::\s*[^{};=\n]+)?(?:\s+where\s+[^{};=\n]+)?\s*\{/,
    },
    {
      pattern: new RegExp(`^\\s*(?:(?:private|fileprivate|internal|public|open|override|final|static|class|mutating|nonmutating|nonisolated|distributed)\\s+)*func\\s+(${escapedNames})(?:\\s*<[^>{}]+>)?\\s*\\(`, 'gm'),
      bodySignature: /^\s*(?:(?:async|throws|rethrows)\s*)*(?:->\s*[^{};=\n]+)?(?:\s+where\s+[^{};=\n]+)?\s*\{/,
    },
    {
      pattern: new RegExp(`^\\s*(?:(?:private|public|protected|static|async|abstract|override)\\s+)+(${escapedNames})\\s*\\(`, 'gm'),
      bodySignature: /^\s*(?::\s*[^{};=\n]+)?\s*\{/,
    },
    {
      pattern: new RegExp(`^\\s*(${escapedNames})\\s*\\(`, 'gm'),
      bodySignature: /^\s*:\s*[^{};=\n]+\s*\{/,
    },
  ];
  const bodies = [];
  for (const declaration of declarations) {
    for (const match of source.matchAll(declaration.pattern)) {
      const parametersStart = source.indexOf('(', match.index);
      const parametersEnd = findMatchingDelimiter(source, parametersStart, '(', ')');
      if (parametersEnd < 0) continue;
      const signatureTail = source.slice(parametersEnd + 1);
      const bodySignature = declaration.bodySignature.exec(signatureTail);
      if (!bodySignature) continue;
      const bodyStart = parametersEnd + 1 + bodySignature[0].lastIndexOf('{');
      const bodyEnd = findMatchingDelimiter(source, bodyStart, '{', '}');
      if (bodyEnd >= 0) {
        bodies.push({
          name: match[1],
          start: match.index,
          bodyStart,
          bodyEnd,
          body: source.slice(bodyStart, bodyEnd + 1),
        });
      }
    }
  }
  return bodies.sort((left, right) => left.start - right.start);
}

function regionReference(region) {
  return `(?:['\"]${region}['\"]|\\.${region}\\b|\\b${region.toUpperCase()}\\b)`;
}

function extractRegionBranch(body, region) {
  const reference = regionReference(region);
  const conditional = new RegExp(`\\bif\\s*\\([^)]*${reference}[^)]*\\)\\s*\\{`, 'i').exec(body);
  if (conditional) {
    const branchStart = body.indexOf('{', conditional.index);
    const branchEnd = findMatchingDelimiter(body, branchStart, '{', '}');
    return branchEnd >= 0 ? body.slice(branchStart, branchEnd + 1) : '';
  }

  const branch = new RegExp(`(?:\\bcase\\s+)?${reference}\\s*(?:->|:)\\s*`, 'i').exec(body);
  if (!branch) return '';
  const contentStart = branch.index + branch[0].length;
  if (body[contentStart] === '{') {
    const branchEnd = findMatchingDelimiter(body, contentStart, '{', '}');
    return branchEnd >= 0 ? body.slice(contentStart, branchEnd + 1) : '';
  }
  const nextBranch = /\n\s*(?:case\b|else\b|(?:['\"](?:canyon|storm)['\"]|\.(?:canyon|storm)\b|\b(?:CANYON|STORM)\b)\s*(?:->|:))/.exec(body.slice(contentStart));
  const contentEnd = nextBranch ? contentStart + nextBranch.index : body.length;
  return body.slice(contentStart, contentEnd);
}

function findScrollBlocks(body) {
  const scrollBuilder = /\bScroll\s*\(\s*\)\s*\{/g;
  const blocks = [];
  for (const match of body.matchAll(scrollBuilder)) {
    const bodyStart = body.indexOf('{', match.index);
    const bodyEnd = findMatchingDelimiter(body, bodyStart, '{', '}');
    if (bodyEnd >= 0) blocks.push({ start: match.index, bodyStart, bodyEnd, body: body.slice(bodyStart, bodyEnd + 1) });
  }
  return blocks;
}

function hasRegionEffect(branch, effects) {
  return new RegExp(`\\b(?:${effects.join('|')})\\b`, 'i').test(branch);
}

function importsFrom(source) {
  return [...source.matchAll(/^\s*import(?:[\s\S]*?from\s*)?['\"]([^'\"]+)['\"]/gm)].map((match) => match[1]);
}

function isNetworkOrWebModule(specifier) {
  return /(?:^|[./@_-])(?:net|http|https|websocket|socket|webview|arkweb|web)(?:$|[./@_-])/i.test(specifier);
}

function dependencySections(source) {
  return [...source.matchAll(/['\"]?(?:dependencies|devDependencies|dynamicDependencies|peerDependencies)['\"]?\s*:\s*\{([\s\S]*?)\}/g)].map((match) => match[1]);
}

function hasNetworkDependency(section) {
  return /(?:@ohos[/.]net|\b(?:axios|fetch|http|https|websocket|socket\.io|socketio|request|undici|got|superagent|network)\b)/i.test(section);
}

const nativeSources = {
  Android: read('ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/java/com/zzsys/zhengzhengstudio/MainActivity.kt'),
  Apple: read('apps/SpaceFightShared/NativeGameScene.swift'),
  'HarmonyOS online': read('HarmonyOS-App/SpaceFightHarmony/entry/src/main/ets/pages/Index.ets'),
  'HarmonyOS offline': read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/ets/pages/Index.ets'),
};
const harmonyOfflineProject = collectOfflineProjectText('HarmonyOS-App/SpaceFightHarmonyOffline');
const harmonyOfflineRuntime = harmonyOfflineProject.map((file) => file.text).join('\n');
const harmonyOfflineModule = read('HarmonyOS-App/SpaceFightHarmonyOffline/entry/src/main/module.json5');

const missions = ['survival', 'boss', 'escort', 'defense', 'timed', 'raid'];
const cameras = ['cockpit', 'chase'];
const objectiveFields = [
  'escortHealth',
  'controlProgress',
  'timeRemaining',
  'raidCollected',
  'bossComponents',
];

test('Android, Apple, and both HarmonyOS editions expose the same six local missions and two camera modes', () => {
  for (const [platform, source] of Object.entries(nativeSources)) {
    for (const mission of missions) {
      assert.match(source, new RegExp(`['\"]${mission}['\"]`), `${platform} is missing the ${mission} mission`);
    }
    for (const camera of cameras) {
      assert.match(source, new RegExp(`['\"]${camera}['\"]`), `${platform} is missing the ${camera} camera mode`);
    }
  }
});

test('each native combat engine publishes mission-specific objective state', () => {
  for (const [platform, source] of Object.entries(nativeSources)) {
    for (const field of objectiveFields) {
      assert.match(source, new RegExp(`\\b${field}\\b`), `${platform} is missing objective state ${field}`);
    }
  }
});

test('each native renderer can switch between cockpit and chase combat presentation', () => {
  for (const [platform, source] of Object.entries(nativeSources)) {
    assert.match(source, /toggleCamera\s*\(/, `${platform} is missing toggleCamera()`);
    assert.match(
      source,
      /cockpit[\s\S]{0,180}(?:overlay|frame|rail)|(?:overlay|frame|rail)[\s\S]{0,180}cockpit/i,
      `${platform} is missing a cockpit overlay`,
    );
    assert.match(
      source,
      /chase[\s\S]{0,240}(?:ship|localShip|interceptor)|(?:ship|localShip|interceptor)[\s\S]{0,240}chase/i,
      `${platform} is missing chase ship rendering`,
    );
  }
});

test('each native combat engine applies canyon and storm region rules', () => {
  for (const [platform, source] of Object.entries(nativeSources)) {
    const regionRule = findMethodBodies(source, ['applyRegionRules', 'updateRegionRules'])
      .find(({ body }) => extractRegionBranch(body, 'canyon') && extractRegionBranch(body, 'storm'));
    assert.ok(regionRule, `${platform} is missing applyRegionRules/updateRegionRules with canyon and storm branches`);
    const canyonBranch = extractRegionBranch(regionRule.body, 'canyon');
    const stormBranch = extractRegionBranch(regionRule.body, 'storm');
    assert.ok(
      hasRegionEffect(canyonBranch, ['collision', 'corridor', 'obstacle', 'terrain', 'turn', 'steer', 'speed']),
      `${platform} is missing a canyon obstacle, corridor, or collision effect inside its region rules`,
    );
    assert.ok(
      hasRegionEffect(stormBranch, ['lockRange', 'lock range', 'energyRecovery', 'energy recovery', 'visibility', 'cloud', 'electric', 'lightning']),
      `${platform} is missing a storm lock-range or energy-recovery effect inside its region rules`,
    );
  }
});

test('HarmonyOS Offline remains fully local and cannot add a remote runtime boundary', () => {
  for (const [label, pattern] of [
    ['URL scheme', /\b(?:https?|wss?):\/\//i],
    ['network import', /@ohos\.net(?:\.[A-Za-z0-9_]+)*/],
    ['passport code', /\bpassport\b/i],
    ['Web or ArkWeb', /\b(?:Web|WebView|ArkWeb)\b/],
    ['remote update or download code', /\b(?:check(?:For)?Updates?|remote(?:Update|Download)|manifest(?:Url|URL)|update(?:Id|URL|Url|Endpoint)|download(?:URL|Url|Link|Package|App|File)|installUpdate)\b/i],
    ['permission request code', /\brequestPermissions\b/i],
    ['declared permission', /\bohos\.permission\.[A-Z_]+\b/i],
  ]) {
    assert.doesNotMatch(harmonyOfflineRuntime, pattern, `HarmonyOS Offline must not contain ${label}`);
  }
  for (const file of harmonyOfflineProject.filter((entry) => ['.ets', '.ts', '.js'].includes(path.extname(entry.path)))) {
    for (const specifier of importsFrom(file.text)) {
      assert.equal(isNetworkOrWebModule(specifier), false, `HarmonyOS Offline import must remain local: ${specifier} in ${file.path}`);
    }
  }
  for (const file of harmonyOfflineProject.filter((entry) => path.basename(entry.path) === 'oh-package.json5')) {
    for (const section of dependencySections(file.text)) {
      assert.equal(hasNetworkDependency(section), false, `HarmonyOS Offline package dependency map must not include a network package: ${file.path}`);
    }
  }
  assert.doesNotMatch(harmonyOfflineModule, /\brequestPermissions\b/i, 'HarmonyOS Offline module must not define requestPermissions');
});

test('HarmonyOS launch decks keep a fixed action outside a scrollable mission detail area', () => {
  const harmonySources = {
    'HarmonyOS online': nativeSources['HarmonyOS online'],
    'HarmonyOS offline': nativeSources['HarmonyOS offline'],
  };

  for (const [platform, source] of Object.entries(harmonySources)) {
    assert.match(source, /\bcompactDeck\b/, `${platform} is missing its compact deck breakpoint`);
    const missionRail = findMethodBodies(source, ['missionRail']).find(({ body }) => /\bmissionItems\b/.test(body));
    assert.ok(missionRail, `${platform} is missing a missionRail builder backed by missionItems`);
    assert.match(
      missionRail.body,
      /if\s*\(\s*this\.compactDeck\s*\)\s*\{[\s\S]*?Scroll\s*\(\s*\)[\s\S]*?Row\s*\(/,
      `${platform} missionRail must use a horizontal Scroll in compact mode`,
    );

    const launchButton = findMethodBodies(source, ['launchButton']);
    assert.ok(launchButton.length > 0, `${platform} is missing its named launchButton builder`);
    const deck = findMethodBodies(source, ['launch', 'flightDeck', 'buildDeck'])
      .find(({ body }) => /this\.missionRail\s*\(\s*\)/.test(body) && /this\.launchButton\s*\(\s*\)/.test(body));
    assert.ok(deck, `${platform} must render missionRail and launchButton in the same deck`);
    const launchIndex = deck.body.indexOf('this.launchButton');
    const deckScroll = findScrollBlocks(deck.body).find(({ body }) => /this\.missionRail\s*\(\s*\)/.test(body));
    assert.ok(deckScroll, `${platform} deck must render missionRail inside a Scroll builder`);
    assert.ok(
      launchIndex > deckScroll.bodyEnd,
      `${platform} must render launchButton after and outside the scrolling deck content`,
    );
    assert.match(
      deck.body.slice(deckScroll.bodyEnd, launchIndex),
      /\.layoutWeight\s*\(\s*1\s*\)/,
      `${platform} deck Scroll chain must reserve the bounded content area with layoutWeight(1)`,
    );
  }
});
