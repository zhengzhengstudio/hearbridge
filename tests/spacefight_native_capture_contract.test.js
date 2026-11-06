const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const {
  buildWindowInfoSwiftScript,
  captureCommands,
  createRuntimeCapture,
  finalizeCapture,
  inspectScreenshotAttempt,
  parseBootedSimulators,
} = require('../SpaceFight-Cocos/tools/capture-native-baselines.js');

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function writeFixturePng(filePath, width, height, painter) {
  fs.writeFileSync(filePath, createFixturePngBuffer(width, height, painter));
}

function createFixturePngBuffer(width, height, painter) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + (x * 4);
      const [r, g, b, a = 255] = painter(x, y);
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createChunk(type, data, overrideCrc = null) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  const crcValue = overrideCrc === null ? crc32(Buffer.concat([name, data])) : overrideCrc >>> 0;
  crc.writeUInt32BE(crcValue, 0);
  return Buffer.concat([length, name, data, crc]);
}

function createCustomPngBuffer(chunks) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
  ]);
}

function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function gradientPainter(seed) {
  return (x, y) => {
    const stripe = ((x + seed * 13) % 37) < 18 ? 48 : 0;
    const accent = ((y + seed * 7) % 29) < 12 ? 26 : 0;
    return [
      (x * 7 + seed * 19 + stripe) % 256,
      (y * 9 + seed * 11 + accent) % 256,
      ((x + y) * 5 + seed * 23) % 256,
      255,
    ];
  };
}

test('captureCommands exposes the required native screenshot adapters', () => {
  assert.deepEqual(captureCommands(), {
    android: ['adb', ['exec-out', 'screencap', '-p']],
    ios: ['xcrun', ['simctl', 'io', 'booted', 'screenshot', '{outputPath}']],
    harmonyos: ['hdc', ['shell', 'snapshot_display']],
    macos: ['/usr/sbin/screencapture', ['-x', '{outputPath}']],
  });
});

test('buildWindowInfoSwiftScript binds owner filters and keeps the tuple shape consistent', () => {
  const script = buildWindowInfoSwiftScript({ ownerPid: 42, ownerName: 'Simulator' });
  assert.match(script, /let targetOwnerPid: Int\? = 42/);
  assert.match(script, /let targetOwnerName: String\? = "Simulator"/);
  assert.match(script, /var best: \(Int, Int, Int, Int, Int, Int\)\? = nil/);
  assert.match(script, /let candidate = \(windowId, Int\(x\), Int\(y\), Int\(width\), Int\(height\), area\)/);
  assert.doesNotMatch(script, /\bwhere ownerPid ==|\bwhere ownerName ==/);
});

test('runtime capture never reports success without a real PNG', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-capture-'));
  const outputPath = path.join(tmpRoot, 'android-launch.png');
  fs.writeFileSync(outputPath, 'not-a-png');

  const result = finalizeCapture({
    platform: 'android',
    status: 'captured',
    command: 'adb exec-out screencap -p > android-launch.png',
    screenshotPaths: [outputPath],
  });

  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /screenshot/i);
  assert.deepEqual(result.screenshots, []);
});

test('inspectScreenshotAttempt rejects black or near-uniform frames as unusable evidence', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-uniform-'));
  const blackPath = path.join(tmpRoot, 'black.png');
  const uniformPath = path.join(tmpRoot, 'uniform.png');
  writeFixturePng(blackPath, 24, 24, () => [0, 0, 0, 255]);
  writeFixturePng(uniformPath, 24, 24, (x, y) => [8 + (x % 2), 9 + (y % 2), 10, 255]);

  const black = inspectScreenshotAttempt({ root: tmpRoot, platform: 'macos', state: 'launch', outputPath: blackPath });
  const uniform = inspectScreenshotAttempt({ root: tmpRoot, platform: 'macos', state: 'combat', outputPath: uniformPath });

  for (const attempt of [black, uniform]) {
    assert.equal(attempt.syntactic.validPng, true);
    assert.equal(attempt.evidence.usable, false);
    assert.deepEqual(attempt.evidence.reasons, ['black-or-near-uniform']);
  }
});

test('inspectScreenshotAttempt rejects PNGs with a short IHDR payload without throwing', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-short-ihdr-'));
  const brokenPath = path.join(tmpRoot, 'short-ihdr.png');
  const shortIhdr = Buffer.alloc(8);
  shortIhdr.writeUInt32BE(16, 0);
  shortIhdr.writeUInt32BE(16, 4);
  fs.writeFileSync(brokenPath, createCustomPngBuffer([
    createChunk('IHDR', shortIhdr),
    createChunk('IEND', Buffer.alloc(0)),
  ]));

  const attempt = inspectScreenshotAttempt({ root: tmpRoot, platform: 'macos', state: 'launch', outputPath: brokenPath });
  assert.equal(attempt.syntactic.validPng, false);
  assert.match(attempt.syntactic.reason, /IHDR/i);
});

test('inspectScreenshotAttempt rejects PNGs with a bad chunk CRC', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-bad-crc-'));
  const brokenPath = path.join(tmpRoot, 'bad-crc.png');
  const valid = createFixturePngBuffer(8, 8, gradientPainter(3));
  const mutated = Buffer.from(valid);
  mutated[mutated.length - 5] ^= 0xff;
  fs.writeFileSync(brokenPath, mutated);

  const attempt = inspectScreenshotAttempt({ root: tmpRoot, platform: 'macos', state: 'launch', outputPath: brokenPath });
  assert.equal(attempt.syntactic.validPng, false);
  assert.match(attempt.syntactic.reason, /CRC/i);
});

test('inspectScreenshotAttempt rejects PNGs without a complete IEND chunk', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-no-iend-'));
  const brokenPath = path.join(tmpRoot, 'no-iend.png');
  const valid = createFixturePngBuffer(8, 8, gradientPainter(5));
  fs.writeFileSync(brokenPath, valid.subarray(0, valid.length - 12));

  const attempt = inspectScreenshotAttempt({ root: tmpRoot, platform: 'macos', state: 'launch', outputPath: brokenPath });
  assert.equal(attempt.syntactic.validPng, false);
  assert.match(attempt.syntactic.reason, /IEND/i);
});

test('finalizeCapture accepts distinct usable launch and combat evidence', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-usable-'));
  const launchPath = path.join(tmpRoot, 'launch.png');
  const combatPath = path.join(tmpRoot, 'combat.png');
  writeFixturePng(launchPath, 48, 32, gradientPainter(1));
  writeFixturePng(combatPath, 48, 32, gradientPainter(7));

  const result = finalizeCapture({
    platform: 'ios',
    status: 'captured',
    command: 'xcrun simctl io booted screenshot launch.png',
    screenshotPaths: [launchPath, combatPath],
  });

  assert.equal(result.status, 'captured');
  assert.equal(result.screenshots.length, 2);
  assert.equal(result.reason, null);
});

test('finalizeCapture marks visually indistinguishable states unavailable', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-identical-'));
  const launchPath = path.join(tmpRoot, 'launch.png');
  const combatPath = path.join(tmpRoot, 'combat.png');
  writeFixturePng(launchPath, 48, 32, gradientPainter(4));
  writeFixturePng(combatPath, 48, 32, gradientPainter(4));

  const result = finalizeCapture({
    platform: 'macos',
    status: 'captured',
    command: '/usr/sbin/screencapture -x launch.png && /usr/sbin/screencapture -x combat.png',
    screenshotPaths: [launchPath, combatPath],
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'indistinguishable');
  assert.deepEqual(result.screenshots, []);
});

test('finalizeCapture rejects distinct PNGs when the trigger step failed', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-trigger-'));
  const launchPath = path.join(tmpRoot, 'launch.png');
  const combatPath = path.join(tmpRoot, 'combat.png');
  writeFixturePng(launchPath, 48, 32, gradientPainter(2));
  writeFixturePng(combatPath, 48, 32, gradientPainter(9));

  const result = finalizeCapture({
    platform: 'android',
    status: 'captured',
    command: 'adb exec-out screencap -p > launch.png',
    screenshotPaths: [launchPath, combatPath],
    reason: 'android trigger step failed: shell input tap returned exit code 1.',
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'android trigger step failed: shell input tap returned exit code 1.');
  assert.deepEqual(result.screenshots, []);
});

test('parseBootedSimulators returns a typed reason for malformed simctl JSON', () => {
  const parsed = parseBootedSimulators('{not-json');
  assert.deepEqual(parsed.simulators, []);
  assert.match(parsed.reason, /Could not parse booted iOS simulators JSON/);
});

test('createRuntimeCapture still writes runtime-capture.json when simctl output is malformed', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacefight-runtime-capture-fixture-'));
  const repositoryRoot = path.resolve(__dirname, '..');
  const repoEvidencePath = path.join(repositoryRoot, 'docs/spacefight/baselines/2026-08-03/runtime-capture.json');
  assert.ok(fs.existsSync(repoEvidencePath), 'production runtime-capture.json must exist before the fixture capture');
  const repoEvidenceBefore = fs.readFileSync(repoEvidencePath);
  writeFixture(fixtureRoot, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/build.gradle.kts', 'applicationId = "cn.zhengzhengstudio.spacefight"\n');
  writeFixture(fixtureRoot, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/AndroidManifest.xml', '<activity android:name=".MainActivity" />\n');
  writeFixture(fixtureRoot, 'apps/SpaceFight-iOS/Sources/main.swift', '包名 cn.zhengzhengstudio.spacefight\n');
  writeFixture(fixtureRoot, 'HarmonyOS-App/SpaceFightHarmony/AppScope/app.json5', '{ "app": { "bundleName": "cn.zhengzhengstudio.spacefight.hmos" } }\n');
  writeFixture(fixtureRoot, 'HarmonyOS-App/SpaceFightHarmony/entry/src/main/module.json5', '{ "module": { "mainElement": "EntryAbility" } }\n');
  const now = new Date('2026-08-03T08:00:00.000Z');
  const tempOutputPath = path.join(fixtureRoot, 'artifacts/runtime-capture.json');
  const { manifest, outputPath } = createRuntimeCapture({
    root: fixtureRoot,
    now,
    outputPath: tempOutputPath,
    overrides: {
      captureMacos: () => ({
        platform: 'macos',
        status: 'unavailable',
        command: 'macos',
        screenshots: [],
        reason: 'stubbed for malformed simctl test',
      }),
      captureAndroid: () => ({
        platform: 'android',
        status: 'unavailable',
        command: 'android',
        screenshots: [],
        reason: 'stubbed for malformed simctl test',
      }),
      captureHarmony: () => ({
        platform: 'harmonyos',
        status: 'unavailable',
        command: 'harmonyos',
        screenshots: [],
        reason: 'stubbed for malformed simctl test',
      }),
      envs: {
        ios: {
          commandExists: () => '/usr/bin/xcrun',
          runCommand: (_cmd, args) => {
            if (args.join(' ') === 'simctl list devices booted --json') {
              return { status: 0, signal: null, stdout: '{bad-json', stderr: '', error: null, timedOut: false };
            }
            return { status: 0, signal: null, stdout: '', stderr: '', error: null, timedOut: false };
          },
        },
      },
    },
  });

  assert.ok(fs.existsSync(outputPath));
  assert.equal(outputPath, tempOutputPath);
  const ios = manifest.results.find((result) => result.platform === 'ios');
  assert.equal(ios.status, 'unavailable');
  assert.match(ios.reason, /Could not parse booted iOS simulators JSON/);
  assert.ok(fs.existsSync(repoEvidencePath), 'production runtime-capture.json must still exist after the fixture capture');
  const repoEvidenceAfter = fs.readFileSync(repoEvidencePath);
  assert.deepEqual(repoEvidenceAfter, repoEvidenceBefore);
});
