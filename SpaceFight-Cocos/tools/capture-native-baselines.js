const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { dirname, join, relative, resolve } = require('node:path');
const { inflateSync } = require('node:zlib');

const DATE_STAMP = '2026-08-03';
const SCREENSHOT_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COMMANDS = Object.freeze({
  android: ['adb', ['exec-out', 'screencap', '-p']],
  ios: ['xcrun', ['simctl', 'io', 'booted', 'screenshot', '{outputPath}']],
  harmonyos: ['hdc', ['shell', 'snapshot_display']],
  macos: ['/usr/sbin/screencapture', ['-x', '{outputPath}']],
});

const DEFAULT_TIMEOUTS = Object.freeze({
  detectMs: 5_000,
  installMs: 120_000,
  launchMs: 20_000,
  triggerMs: 5_000,
  captureMs: 8_000,
  cleanupMs: 5_000,
  settleMs: 1_200,
});

const EVIDENCE_THRESHOLDS = Object.freeze({
  maxSamples: 8_192,
  uniformStdDevMax: 6,
  uniformRangeMax: 18,
  indistinguishableMeanDiffMax: 4,
  indistinguishableChangedFractionMax: 0.015,
});

function captureCommands() {
  return JSON.parse(JSON.stringify(COMMANDS));
}

function sleepMs(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function trimOutput(value) {
  if (!value) {
    return '';
  }
  const normalized = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  const trimmed = normalized.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length > 800 ? `${trimmed.slice(0, 797)}...` : trimmed;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderCommand(executable, args, { stdoutPath } = {}) {
  const command = [executable, ...args].map(shellQuote).join(' ');
  return stdoutPath ? `${command} > ${shellQuote(stdoutPath)}` : command;
}

function runCommand(executable, args, options = {}) {
  const {
    timeoutMs,
    encoding = 'utf8',
    maxBuffer = 32 * 1024 * 1024,
  } = options;
  const result = spawnSync(executable, args, {
    encoding,
    timeout: timeoutMs,
    maxBuffer,
  });
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  return {
    status: typeof result.status === 'number' ? result.status : null,
    signal: result.signal || null,
    stdout: result.stdout || (encoding === 'buffer' ? Buffer.alloc(0) : ''),
    stderr: result.stderr || (encoding === 'buffer' ? Buffer.alloc(0) : ''),
    error: result.error || null,
    timedOut,
  };
}

function logCommand(commandLog, platform, step, command, result) {
  commandLog.push({
    platform,
    step,
    command,
    exitCode: result.status,
    timedOut: Boolean(result.timedOut),
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
  });
}

function commandExists(executable) {
  if (executable.startsWith('/')) {
    return existsSync(executable) ? executable : null;
  }
  const probe = runCommand('bash', ['-lc', `command -v ${shellQuote(executable)}`], {
    timeoutMs: DEFAULT_TIMEOUTS.detectMs,
  });
  return probe.status === 0 ? trimOutput(probe.stdout) : null;
}

function screenshotPath(root, platform, state) {
  return join(root, 'docs/spacefight/screenshots', `${DATE_STAMP}-legacy-${platform}-${state}.png`);
}

function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function rmIfExists(filePath) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

function makeUnavailable(platform, command, reason) {
  return {
    platform,
    status: 'unavailable',
    command,
    screenshots: [],
    reason,
  };
}

function parseNumericList(raw) {
  return trimOutput(raw)
    .split('\n')
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isFinite);
}

function chunkType(buffer, offset) {
  return buffer.toString('ascii', offset + 4, offset + 8);
}

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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function decodePng(filePath) {
  if (!existsSync(filePath)) {
    return { validPng: false, reason: `screenshot missing: ${filePath}` };
  }
  const buffer = readFileSync(filePath);
  if (buffer.length < 24) {
    return { validPng: false, reason: `screenshot is too small to be a valid PNG: ${filePath}` };
  }
  if (!buffer.subarray(0, 8).equals(SCREENSHOT_SIGNATURE)) {
    return { validPng: false, reason: `screenshot is not a valid PNG: ${filePath}` };
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;
  let sawIhdr = false;
  let sawIend = false;
  const idatChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = chunkType(buffer, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      return { validPng: false, reason: `screenshot PNG chunk overruns file: ${filePath}` };
    }
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    if (expectedCrc !== actualCrc) {
      return { validPng: false, reason: `screenshot PNG chunk CRC mismatch in ${type}: ${filePath}` };
    }
    if (type === 'IHDR') {
      if (length !== 13) {
        return { validPng: false, reason: `screenshot PNG IHDR length must be 13 bytes: ${filePath}` };
      }
      sawIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filter = data[11];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) {
        return { validPng: false, reason: `screenshot PNG IEND length must be 0 bytes: ${filePath}` };
      }
      sawIend = true;
      break;
    }
    offset = dataEnd + 4;
  }

  if (!sawIhdr) {
    return { validPng: false, reason: `screenshot PNG is missing IHDR: ${filePath}` };
  }
  if (!sawIend) {
    return { validPng: false, reason: `screenshot PNG is missing a complete IEND chunk: ${filePath}` };
  }
  if (width === 0 || height === 0) {
    return { validPng: false, reason: `screenshot PNG has zero dimensions: ${filePath}` };
  }
  if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
    return { validPng: false, reason: `screenshot PNG uses unsupported encoding: ${filePath}` };
  }
  if (!idatChunks.length) {
    return { validPng: false, reason: `screenshot PNG has no image payload: ${filePath}` };
  }

  const channelCount = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  if (!channelCount) {
    return { validPng: false, reason: `screenshot PNG uses unsupported color type ${colorType}: ${filePath}` };
  }

  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idatChunks));
  } catch (error) {
    return { validPng: false, reason: `screenshot PNG could not be decompressed: ${error.message}` };
  }

  const bytesPerPixel = channelCount;
  const rowBytes = width * bytesPerPixel;
  const expectedLength = height * (1 + rowBytes);
  if (inflated.length < expectedLength) {
    return { validPng: false, reason: `screenshot PNG payload is truncated: ${filePath}` };
  }

  const raw = Buffer.alloc(height * rowBytes);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (1 + rowBytes);
    const filterType = inflated[sourceOffset];
    for (let index = 0; index < rowBytes; index += 1) {
      const current = inflated[sourceOffset + 1 + index];
      const left = index >= bytesPerPixel ? raw[(row * rowBytes) + index - bytesPerPixel] : 0;
      const up = row > 0 ? raw[((row - 1) * rowBytes) + index] : 0;
      const upLeft = (row > 0 && index >= bytesPerPixel)
        ? raw[((row - 1) * rowBytes) + index - bytesPerPixel]
        : 0;

      let value;
      switch (filterType) {
        case 0:
          value = current;
          break;
        case 1:
          value = (current + left) & 0xff;
          break;
        case 2:
          value = (current + up) & 0xff;
          break;
        case 3:
          value = (current + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          value = (current + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          return { validPng: false, reason: `screenshot PNG uses unsupported filter ${filterType}: ${filePath}` };
      }
      raw[(row * rowBytes) + index] = value;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0, pixel = 0; index < raw.length; index += bytesPerPixel, pixel += 4) {
    if (colorType === 6) {
      rgba[pixel] = raw[index];
      rgba[pixel + 1] = raw[index + 1];
      rgba[pixel + 2] = raw[index + 2];
      rgba[pixel + 3] = raw[index + 3];
    } else if (colorType === 2) {
      rgba[pixel] = raw[index];
      rgba[pixel + 1] = raw[index + 1];
      rgba[pixel + 2] = raw[index + 2];
      rgba[pixel + 3] = 255;
    } else if (colorType === 4) {
      rgba[pixel] = raw[index];
      rgba[pixel + 1] = raw[index];
      rgba[pixel + 2] = raw[index];
      rgba[pixel + 3] = raw[index + 1];
    } else {
      rgba[pixel] = raw[index];
      rgba[pixel + 1] = raw[index];
      rgba[pixel + 2] = raw[index];
      rgba[pixel + 3] = 255;
    }
  }

  return {
    validPng: true,
    width,
    height,
    rgba,
  };
}

function sampleStride(width, height) {
  const total = width * height;
  return Math.max(1, Math.floor(Math.sqrt(total / EVIDENCE_THRESHOLDS.maxSamples)));
}

function analyzeFrameEvidence(decoded) {
  if (!decoded.validPng) {
    return {
      usable: false,
      reasons: [],
      metrics: null,
    };
  }

  const { width, height, rgba } = decoded;
  const stride = sampleStride(width, height);
  let samples = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let sumLuma = 0;
  let sumSquares = 0;
  let darkSamples = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = ((y * width) + x) * 4;
      const luma = (rgba[offset] * 0.2126) + (rgba[offset + 1] * 0.7152) + (rgba[offset + 2] * 0.0722);
      samples += 1;
      sumLuma += luma;
      sumSquares += luma * luma;
      if (luma <= 18) {
        darkSamples += 1;
      }
      if (luma < minLuma) {
        minLuma = luma;
      }
      if (luma > maxLuma) {
        maxLuma = luma;
      }
    }
  }

  const averageLuma = samples > 0 ? sumLuma / samples : 0;
  const variance = samples > 0 ? Math.max(0, (sumSquares / samples) - (averageLuma * averageLuma)) : 0;
  const stdDev = Math.sqrt(variance);
  const dynamicRange = maxLuma - minLuma;
  const darkFraction = samples > 0 ? darkSamples / samples : 0;
  const nearUniform = stdDev <= EVIDENCE_THRESHOLDS.uniformStdDevMax
    && dynamicRange <= EVIDENCE_THRESHOLDS.uniformRangeMax;
  const darkDominated = averageLuma <= 12 && darkFraction >= 0.94;
  const reasons = (nearUniform || darkDominated) ? ['black-or-near-uniform'] : [];
  return {
    usable: reasons.length === 0,
    reasons,
    metrics: {
      averageLuma: Number(averageLuma.toFixed(2)),
      lumaStdDev: Number(stdDev.toFixed(2)),
      lumaRange: Number(dynamicRange.toFixed(2)),
      darkFraction: Number(darkFraction.toFixed(4)),
      samples,
    },
  };
}

function framePixel(decoded, x, y) {
  const offset = ((y * decoded.width) + x) * 4;
  return [
    decoded.rgba[offset],
    decoded.rgba[offset + 1],
    decoded.rgba[offset + 2],
    decoded.rgba[offset + 3],
  ];
}

function compareFrameEvidence(first, second) {
  if (!first.validPng || !second.validPng) {
    return { indistinguishable: false, metrics: null };
  }
  const gridX = Math.min(96, Math.max(8, Math.floor(Math.sqrt(EVIDENCE_THRESHOLDS.maxSamples))));
  const gridY = gridX;
  let samples = 0;
  let changed = 0;
  let diffSum = 0;
  for (let gy = 0; gy < gridY; gy += 1) {
    for (let gx = 0; gx < gridX; gx += 1) {
      const ax = Math.min(first.width - 1, Math.floor((gx / Math.max(1, gridX - 1)) * (first.width - 1)));
      const ay = Math.min(first.height - 1, Math.floor((gy / Math.max(1, gridY - 1)) * (first.height - 1)));
      const bx = Math.min(second.width - 1, Math.floor((gx / Math.max(1, gridX - 1)) * (second.width - 1)));
      const by = Math.min(second.height - 1, Math.floor((gy / Math.max(1, gridY - 1)) * (second.height - 1)));
      const [ar, ag, ab] = framePixel(first, ax, ay);
      const [br, bg, bb] = framePixel(second, bx, by);
      const pixelDiff = (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / 3;
      diffSum += pixelDiff;
      if (pixelDiff >= 12) {
        changed += 1;
      }
      samples += 1;
    }
  }

  const meanChannelDiff = samples > 0 ? diffSum / samples : 0;
  const changedFraction = samples > 0 ? changed / samples : 0;
  return {
    indistinguishable: meanChannelDiff <= EVIDENCE_THRESHOLDS.indistinguishableMeanDiffMax
      && changedFraction <= EVIDENCE_THRESHOLDS.indistinguishableChangedFractionMax,
    metrics: {
      meanChannelDiff: Number(meanChannelDiff.toFixed(2)),
      changedFraction: Number(changedFraction.toFixed(4)),
      samples,
    },
  };
}

function inspectScreenshotAttempt({ root, platform, state, outputPath }) {
  const decoded = decodePng(outputPath);
  const evidence = analyzeFrameEvidence(decoded);
  return {
    platform,
    state,
    path: root ? relative(root, outputPath) : outputPath,
    syntactic: {
      validPng: decoded.validPng,
      width: decoded.validPng ? decoded.width : null,
      height: decoded.validPng ? decoded.height : null,
      reason: decoded.validPng ? null : decoded.reason,
    },
    evidence,
    _decoded: decoded.validPng ? decoded : null,
  };
}

function evidenceSummaryReason(attempts) {
  const reasons = [];
  for (const attempt of attempts) {
    if (!attempt.syntactic.validPng && attempt.syntactic.reason) {
      reasons.push(attempt.syntactic.reason);
      continue;
    }
    for (const reason of attempt.evidence.reasons) {
      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }
    }
  }
  if (reasons.length === 1) {
    return reasons[0];
  }
  return `launch/combat evidence unusable: ${reasons.join(', ')}.`;
}

function finalizeCapture({ platform, status, command, screenshotPaths = [], reason = null, root = null }) {
  const attempts = screenshotPaths.map((outputPath, index) => inspectScreenshotAttempt({
    root,
    platform,
    state: index === 0 ? 'launch' : 'combat',
    outputPath,
  }));

  if (attempts.length >= 2 && attempts[0]._decoded && attempts[1]._decoded) {
    const pair = compareFrameEvidence(attempts[0]._decoded, attempts[1]._decoded);
    if (pair.indistinguishable) {
      for (const attempt of attempts.slice(0, 2)) {
        if (!attempt.evidence.reasons.includes('indistinguishable')) {
          attempt.evidence.reasons.push('indistinguishable');
        }
        attempt.evidence.usable = false;
        attempt.evidence.pairMetrics = pair.metrics;
      }
    }
  }

  for (const attempt of attempts) {
    delete attempt._decoded;
  }

  if (status !== 'captured' || reason || attempts.length === 0) {
    return makeUnavailable(platform, command, reason || `${platform} screenshot capture unavailable.`);
  }
  if (attempts.some((attempt) => !attempt.syntactic.validPng || !attempt.evidence.usable)) {
    return makeUnavailable(platform, command, evidenceSummaryReason(attempts));
  }
  return {
    platform,
    status: 'captured',
    command,
    screenshots: attempts.map((attempt) => ({
      path: root ? resolve(root, attempt.path) : attempt.path,
      width: attempt.syntactic.width,
      height: attempt.syntactic.height,
    })),
    reason: null,
  };
}

function artifactMap(root) {
  const baselinePath = join(root, 'docs/spacefight/baselines/2026-08-03/native-foundation.json');
  if (!existsSync(baselinePath)) {
    return {};
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  return Object.fromEntries((baseline.artifacts || []).map((item) => [item.platform, join(root, item.path)]));
}

function matchFirst(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

function platformMetadata(root) {
  const androidGradle = readFileSync(join(root, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/build.gradle.kts'), 'utf8');
  const androidManifest = readFileSync(join(root, 'ZhengZhengStudioApp/ZhengZhengStudioAndroid/app/src/main/AndroidManifest.xml'), 'utf8');
  const iosSource = readFileSync(join(root, 'apps/SpaceFight-iOS/Sources/main.swift'), 'utf8');
  const harmonyApp = readFileSync(join(root, 'HarmonyOS-App/SpaceFightHarmony/AppScope/app.json5'), 'utf8');
  const harmonyModule = readFileSync(join(root, 'HarmonyOS-App/SpaceFightHarmony/entry/src/main/module.json5'), 'utf8');

  const androidPackageId = matchFirst(androidGradle, /applicationId\s*=\s*"([^"]+)"/);
  const androidActivity = matchFirst(androidManifest, /android:name="([^"]*MainActivity)"/);
  const iosBundleId = matchFirst(iosSource, /包名\s+([A-Za-z0-9._-]+)/);
  const harmonyBundleName = matchFirst(harmonyApp, /"bundleName"\s*:\s*"([^"]+)"/);
  const harmonyAbilityName = matchFirst(harmonyModule, /"mainElement"\s*:\s*"([^"]+)"/);

  return {
    android: {
      packageId: androidPackageId,
      activityName: androidActivity && androidActivity.startsWith('.')
        ? `${androidPackageId}${androidActivity}`
        : androidActivity,
    },
    ios: {
      bundleId: iosBundleId,
      appBundlePath: join(root, 'apps/SpaceFight-iOS/build/Payload/SpaceFight.app'),
    },
    harmonyos: {
      bundleName: harmonyBundleName,
      abilityName: harmonyAbilityName,
    },
  };
}

function captureStdoutToFile({ executable, args, outputPath, timeoutMs, commandLog, platform, step }) {
  rmIfExists(outputPath);
  ensureParent(outputPath);
  const result = runCommand(executable, args, { timeoutMs, encoding: 'buffer' });
  logCommand(commandLog, platform, step, renderCommand(executable, args, { stdoutPath: outputPath }), result);
  if (result.status === 0 && !result.timedOut) {
    writeFileSync(outputPath, result.stdout);
  }
  return result;
}

function captureFileCommand({ executable, args, outputPath, timeoutMs, commandLog, platform, step }) {
  rmIfExists(outputPath);
  ensureParent(outputPath);
  const result = runCommand(executable, args, { timeoutMs });
  logCommand(commandLog, platform, step, renderCommand(executable, args), result);
  return result;
}

function buildWindowInfoSwiftScript({ ownerPid = null, ownerName = null }) {
  return [
    'import Foundation',
    'import CoreGraphics',
    `let targetOwnerPid: Int? = ${ownerPid === null ? 'nil' : String(ownerPid)}`,
    `let targetOwnerName: String? = ${ownerName === null ? 'nil' : JSON.stringify(ownerName)}`,
    'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
    'var best: (Int, Int, Int, Int, Int, Int)? = nil',
    'for item in windows {',
    '  let ownerPid = item[kCGWindowOwnerPID as String] as? Int',
    '  let ownerName = item[kCGWindowOwnerName as String] as? String',
    '  if let targetOwnerPid, ownerPid != targetOwnerPid { continue }',
    '  if let targetOwnerName, ownerName != targetOwnerName { continue }',
    '  guard let layer = item[kCGWindowLayer as String] as? Int, layer == 0 else { continue }',
    '  guard let windowId = item[kCGWindowNumber as String] as? Int else { continue }',
    '  guard let bounds = item[kCGWindowBounds as String] as? [String: CGFloat],',
    '        let x = bounds["X"], let y = bounds["Y"], let width = bounds["Width"], let height = bounds["Height"],',
    '        width > 0, height > 0 else { continue }',
    '  let area = Int(width * height)',
    '  let candidate = (windowId, Int(x), Int(y), Int(width), Int(height), area)',
    '  if best == nil || best!.5 < candidate.5 { best = candidate }',
    '}',
    'if let best { print("\\(best.0)|\\(best.1)|\\(best.2)|\\(best.3)|\\(best.4)") }',
  ].join('\n');
}

function getWindowInfo({ ownerPid = null, ownerName = null }) {
  const script = buildWindowInfoSwiftScript({ ownerPid, ownerName });
  const result = runCommand('swift', ['-e', script], {
    timeoutMs: DEFAULT_TIMEOUTS.detectMs,
  });
  if (result.status !== 0) {
    const failure = trimOutput(result.stderr) || trimOutput(result.stdout)
      || result.error?.message
      || `swift exited with status ${result.status}`;
    return { window: null, reason: `window-info Swift failed: ${failure}` };
  }
  const output = trimOutput(result.stdout);
  if (!output) {
    return { window: null, reason: 'window-info Swift found no matching window.' };
  }
  const [id, x, y, width, height] = output.split('|').map((value) => Number.parseInt(value, 10));
  if (![id, x, y, width, height].every(Number.isFinite)) {
    return { window: null, reason: `window-info Swift produced malformed output: ${output}` };
  }
  return { window: { id, x, y, width, height }, reason: null };
}

function waitForWindowInfo(query, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastReason = 'window-info Swift found no matching window.';
  while (Date.now() < deadline) {
    const info = getWindowInfo(query);
    if (info.window) {
      return info;
    }
    lastReason = info.reason || lastReason;
    sleepMs(150);
  }
  return { window: null, reason: `${lastReason} (timed out after ${timeoutMs}ms)` };
}

function getSpaceFightPids() {
  const probe = runCommand('pgrep', ['-x', 'SpaceFight'], { timeoutMs: DEFAULT_TIMEOUTS.detectMs });
  return probe.status === 0 ? parseNumericList(probe.stdout) : [];
}

function waitForNewPid(previousPids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = getSpaceFightPids();
    const fresh = current.find((pid) => !previousPids.includes(pid));
    if (fresh) {
      return fresh;
    }
    sleepMs(150);
  }
  return null;
}

function terminateTrackedPids(pids, timeoutMs) {
  const tracked = [...new Set(pids.filter(Number.isFinite))];
  if (!tracked.length) {
    return { terminated: [], forced: [] };
  }
  runCommand('kill', tracked.map(String), { timeoutMs: Math.min(timeoutMs, 1_000) });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const survivors = tracked.filter((pid) => runCommand('kill', ['-0', String(pid)], { timeoutMs: 300 }).status === 0);
    if (!survivors.length) {
      return { terminated: tracked, forced: [] };
    }
    sleepMs(150);
  }
  const forced = tracked.filter((pid) => runCommand('kill', ['-0', String(pid)], { timeoutMs: 300 }).status === 0);
  if (forced.length) {
    runCommand('kill', ['-9', ...forced.map(String)], { timeoutMs: 1_000 });
  }
  return { terminated: tracked, forced };
}

function recordAttempt(root, attempts, platform, state, outputPath) {
  const attempt = inspectScreenshotAttempt({ root, platform, state, outputPath });
  delete attempt._decoded;
  attempts.push(attempt);
}

function attemptAlreadyRecorded(attempts, platform, state) {
  return attempts.some((attempt) => attempt.platform === platform && attempt.state === state);
}

function preserveExistingAttempts(root, attempts) {
  for (const platform of ['macos', 'android', 'ios', 'harmonyos']) {
    for (const state of ['launch', 'combat']) {
      const outputPath = screenshotPath(root, platform, state);
      if (existsSync(outputPath) && !attemptAlreadyRecorded(attempts, platform, state)) {
        recordAttempt(root, attempts, platform, state, outputPath);
      }
    }
  }
}

function enrichAttemptEvidence(root, attempts) {
  const grouped = new Map();
  for (const attempt of attempts) {
    const key = attempt.platform;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(attempt);
  }

  for (const platformAttempts of grouped.values()) {
    const launch = platformAttempts.find((attempt) => attempt.state === 'launch');
    const combat = platformAttempts.find((attempt) => attempt.state === 'combat');
    if (!launch || !combat || !launch.syntactic.validPng || !combat.syntactic.validPng) {
      continue;
    }
    const launchDecoded = decodePng(join(root, launch.path));
    const combatDecoded = decodePng(join(root, combat.path));
    const pair = compareFrameEvidence(launchDecoded, combatDecoded);
    if (!pair.indistinguishable) {
      continue;
    }
    for (const attempt of [launch, combat]) {
      if (!attempt.evidence.reasons.includes('indistinguishable')) {
        attempt.evidence.reasons.push('indistinguishable');
      }
      attempt.evidence.usable = false;
      attempt.evidence.pairMetrics = pair.metrics;
    }
  }
}

function amberPixel(r, g, b) {
  return r >= 170 && g >= 100 && b >= 40 && r > g && g > b && (r - g) >= 18 && (g - b) >= 12;
}

function findAmberActionCenter(decoded) {
  if (!decoded.validPng) {
    return null;
  }
  const step = Math.max(2, sampleStride(decoded.width, decoded.height));
  const minY = Math.floor(decoded.height * 0.45);
  const gridWidth = Math.floor(decoded.width / step);
  const gridHeight = Math.floor((decoded.height - minY) / step);
  if (gridWidth < 4 || gridHeight < 4) {
    return null;
  }

  const visited = new Uint8Array(gridWidth * gridHeight);
  let best = null;
  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const index = gy * gridWidth + gx;
      if (visited[index]) {
        continue;
      }
      visited[index] = 1;
      const x = Math.min(decoded.width - 1, gx * step);
      const y = Math.min(decoded.height - 1, minY + (gy * step));
      const offset = ((y * decoded.width) + x) * 4;
      if (!amberPixel(decoded.rgba[offset], decoded.rgba[offset + 1], decoded.rgba[offset + 2])) {
        continue;
      }

      const queue = [[gx, gy]];
      let head = 0;
      let count = 0;
      let minGridX = gx;
      let maxGridX = gx;
      let minGridY = gy;
      let maxGridY = gy;
      while (head < queue.length) {
        const [currentX, currentY] = queue[head];
        head += 1;
        count += 1;
        if (currentX < minGridX) minGridX = currentX;
        if (currentX > maxGridX) maxGridX = currentX;
        if (currentY < minGridY) minGridY = currentY;
        if (currentY > maxGridY) maxGridY = currentY;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nextX = currentX + dx;
            const nextY = currentY + dy;
            if (nextX < 0 || nextX >= gridWidth || nextY < 0 || nextY >= gridHeight) {
              continue;
            }
            const nextIndex = nextY * gridWidth + nextX;
            if (visited[nextIndex]) {
              continue;
            }
            visited[nextIndex] = 1;
            const pixelX = Math.min(decoded.width - 1, nextX * step);
            const pixelY = Math.min(decoded.height - 1, minY + (nextY * step));
            const pixelOffset = ((pixelY * decoded.width) + pixelX) * 4;
            if (amberPixel(decoded.rgba[pixelOffset], decoded.rgba[pixelOffset + 1], decoded.rgba[pixelOffset + 2])) {
              queue.push([nextX, nextY]);
            }
          }
        }
      }

      const width = (maxGridX - minGridX + 1) * step;
      const height = (maxGridY - minGridY + 1) * step;
      if (count < 40 || width < decoded.width * 0.08 || height < decoded.height * 0.015) {
        continue;
      }
      const candidate = {
        x: Math.floor((minGridX + maxGridX + 1) * step / 2),
        y: Math.floor(minY + ((minGridY + maxGridY + 1) * step / 2)),
        bounds: {
          left: minGridX * step,
          top: minY + (minGridY * step),
          width,
          height,
        },
        score: count,
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }
  return best;
}

function clickHostPoint(x, y, commandLog, platform, step) {
  const script = [
    'import Foundation',
    'import CoreGraphics',
    `let point = CGPoint(x: ${x}, y: ${y})`,
    'guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),',
    '      let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {',
    '  fputs("could not create mouse events\\n", stderr)',
    '  exit(1)',
    '}',
    'down.post(tap: .cghidEventTap)',
    'usleep(120000)',
    'up.post(tap: .cghidEventTap)',
  ].join('\n');
  const result = runCommand('swift', ['-e', script], { timeoutMs: DEFAULT_TIMEOUTS.triggerMs });
  logCommand(commandLog, platform, step, `swift <host click ${x},${y}>`, result);
  return result;
}

function captureWindow(windowId, outputPath, timeoutMs, commandLog, platform, step) {
  return captureFileCommand({
    executable: COMMANDS.macos[0],
    args: ['-x', '-l', String(windowId), outputPath],
    outputPath,
    timeoutMs,
    commandLog,
    platform,
    step,
  });
}

function pressReturnKey(commandLog) {
  const result = runCommand('osascript', [
    '-e',
    'tell application "SpaceFight" to activate',
    '-e',
    'tell application "System Events" to key code 36',
  ], { timeoutMs: DEFAULT_TIMEOUTS.triggerMs });
  logCommand(commandLog, 'macos', 'trigger-combat', 'osascript <activate SpaceFight and send key code 36>', result);
  return result;
}

function captureMacos(root, commandLog, attempts) {
  const launchPath = screenshotPath(root, 'macos', 'launch');
  const combatPath = screenshotPath(root, 'macos', 'combat');
  const appBundlePath = join(root, 'apps/SpaceFightMac/build/SpaceFight.app');
  if (!existsSync(appBundlePath)) {
    return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS app bundle missing: ${appBundlePath}`);
  }

  const previousPids = getSpaceFightPids();
  const launchApp = runCommand('open', ['-na', appBundlePath], { timeoutMs: DEFAULT_TIMEOUTS.launchMs });
  logCommand(commandLog, 'macos', 'launch-app', renderCommand('open', ['-na', appBundlePath]), launchApp);
  if (launchApp.status !== 0 || launchApp.timedOut) {
    return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS launch step failed: ${trimOutput(launchApp.stderr) || 'open returned a non-zero exit code.'}`);
  }

  const pid = waitForNewPid(previousPids, DEFAULT_TIMEOUTS.launchMs);
  if (!pid) {
    return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS launch step failed: SpaceFight did not expose a new pid within ${DEFAULT_TIMEOUTS.launchMs}ms.`);
  }

  try {
    const window = waitForWindowInfo({ ownerPid: pid }, DEFAULT_TIMEOUTS.launchMs);
    if (!window.window) {
      return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS launch step failed: ${window.reason}`);
    }

    const launchCapture = captureWindow(window.window.id, launchPath, DEFAULT_TIMEOUTS.captureMs, commandLog, 'macos', 'capture-launch');
    recordAttempt(root, attempts, 'macos', 'launch', launchPath);
    if (launchCapture.status !== 0 || launchCapture.timedOut) {
      return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS launch screenshot step failed: ${trimOutput(launchCapture.stderr) || 'screencapture returned a non-zero exit code.'}`);
    }

    const trigger = pressReturnKey(commandLog);
    if (trigger.status !== 0 || trigger.timedOut) {
      return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS trigger step failed: ${trimOutput(trigger.stderr) || 'key injection returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const combatCapture = captureWindow(window.window.id, combatPath, DEFAULT_TIMEOUTS.captureMs, commandLog, 'macos', 'capture-combat');
    recordAttempt(root, attempts, 'macos', 'combat', combatPath);
    if (combatCapture.status !== 0 || combatCapture.timedOut) {
      return makeUnavailable('macos', renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']), `macOS combat screenshot step failed: ${trimOutput(combatCapture.stderr) || 'screencapture returned a non-zero exit code.'}`);
    }

    return finalizeCapture({
      platform: 'macos',
      status: 'captured',
      command: renderCommand(COMMANDS.macos[0], ['-x', '{outputPath}']),
      screenshotPaths: [launchPath, combatPath],
      root,
    });
  } finally {
    const cleanup = terminateTrackedPids([pid], DEFAULT_TIMEOUTS.cleanupMs);
    commandLog.push({
      platform: 'macos',
      step: 'cleanup',
      command: `terminate ${pid}`,
      exitCode: 0,
      timedOut: false,
      stdout: cleanup.forced.length ? `forced ${cleanup.forced.join(', ')}` : '',
      stderr: '',
    });
  }
}

function parseAdbDevices(stdout) {
  return trimOutput(stdout)
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });
}

function parseBootedSimulators(stdout) {
  try {
    const payload = JSON.parse(stdout || '{}');
    return {
      simulators: Object.values(payload.devices || {})
        .flat()
        .filter((device) => device.state === 'Booted')
        .map((device) => ({ udid: device.udid, name: device.name })),
      reason: null,
    };
  } catch (error) {
    return {
      simulators: [],
      reason: `Could not parse booted iOS simulators JSON: ${error.message}`,
    };
  }
}

function parseHarmonyTargets(stdout) {
  return trimOutput(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '[Empty]');
}

function captureAndroid(root, metadata, artifacts, commandLog, attempts) {
  const executable = commandExists(COMMANDS.android[0]);
  const screenshotCommand = renderCommand(COMMANDS.android[0], COMMANDS.android[1], { stdoutPath: '{outputPath}' });
  if (!executable) {
    return makeUnavailable('android', screenshotCommand, 'adb executable not found in PATH.');
  }

  const probe = runCommand(executable, ['devices'], { timeoutMs: DEFAULT_TIMEOUTS.detectMs });
  logCommand(commandLog, 'android', 'detect-device', renderCommand(executable, ['devices']), probe);
  if (probe.status !== 0 || probe.timedOut) {
    return makeUnavailable('android', screenshotCommand, trimOutput(probe.stderr) || 'adb devices failed.');
  }
  const devices = parseAdbDevices(probe.stdout);
  const device = devices.find((item) => item.state === 'device');
  if (!device) {
    const detail = devices.map((item) => `${item.serial}:${item.state}`).join(', ');
    return makeUnavailable('android', screenshotCommand, detail ? `adb devices reported no connected Android device (${detail}).` : 'adb devices reported no connected Android device.');
  }
  if (!metadata.android.packageId || !metadata.android.activityName) {
    return makeUnavailable('android', screenshotCommand, 'Android metadata missing packageId or MainActivity.');
  }
  const apkPath = artifacts.android;
  if (!apkPath || !existsSync(apkPath)) {
    return makeUnavailable('android', screenshotCommand, `Android artifact missing: ${apkPath || 'unknown apk path'}`);
  }

  const launchPath = screenshotPath(root, 'android', 'launch');
  const combatPath = screenshotPath(root, 'android', 'combat');
  const prefix = ['-s', device.serial];
  const install = runCommand(executable, [...prefix, 'install', '-r', apkPath], { timeoutMs: DEFAULT_TIMEOUTS.installMs });
  logCommand(commandLog, 'android', 'install-app', renderCommand(executable, [...prefix, 'install', '-r', apkPath]), install);
  if (install.status !== 0 || install.timedOut) {
    return makeUnavailable('android', screenshotCommand, `android install step failed: ${trimOutput(install.stderr) || trimOutput(install.stdout) || 'adb install returned a non-zero exit code.'}`);
  }

  try {
    const launch = runCommand(executable, [...prefix, 'shell', 'am', 'start', '-W', '-n', `${metadata.android.packageId}/${metadata.android.activityName}`], {
      timeoutMs: DEFAULT_TIMEOUTS.launchMs,
    });
    logCommand(commandLog, 'android', 'launch-app', renderCommand(executable, [...prefix, 'shell', 'am', 'start', '-W', '-n', `${metadata.android.packageId}/${metadata.android.activityName}`]), launch);
    if (launch.status !== 0 || launch.timedOut) {
      return makeUnavailable('android', screenshotCommand, `android launch step failed: ${trimOutput(launch.stderr) || trimOutput(launch.stdout) || 'am start returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const launchCapture = captureStdoutToFile({
      executable,
      args: [...prefix, ...COMMANDS.android[1]],
      outputPath: launchPath,
      timeoutMs: DEFAULT_TIMEOUTS.captureMs,
      commandLog,
      platform: 'android',
      step: 'capture-launch',
    });
    recordAttempt(root, attempts, 'android', 'launch', launchPath);
    if (launchCapture.status !== 0 || launchCapture.timedOut) {
      return makeUnavailable('android', screenshotCommand, `android launch screenshot step failed: ${trimOutput(launchCapture.stderr) || 'adb screencap returned a non-zero exit code.'}`);
    }

    const launchAttempt = inspectScreenshotAttempt({ root, platform: 'android', state: 'launch', outputPath: launchPath });
    const actionCenter = launchAttempt._decoded ? findAmberActionCenter(launchAttempt._decoded) : null;
    if (!actionCenter) {
      return makeUnavailable('android', screenshotCommand, 'android trigger step failed: could not locate the amber launch button in the launch screenshot.');
    }

    const trigger = runCommand(executable, [...prefix, 'shell', 'input', 'tap', String(actionCenter.x), String(actionCenter.y)], {
      timeoutMs: DEFAULT_TIMEOUTS.triggerMs,
    });
    logCommand(commandLog, 'android', 'trigger-combat', renderCommand(executable, [...prefix, 'shell', 'input', 'tap', String(actionCenter.x), String(actionCenter.y)]), trigger);
    if (trigger.status !== 0 || trigger.timedOut) {
      return makeUnavailable('android', screenshotCommand, `android trigger step failed: ${trimOutput(trigger.stderr) || trimOutput(trigger.stdout) || 'shell input tap returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const combatCapture = captureStdoutToFile({
      executable,
      args: [...prefix, ...COMMANDS.android[1]],
      outputPath: combatPath,
      timeoutMs: DEFAULT_TIMEOUTS.captureMs,
      commandLog,
      platform: 'android',
      step: 'capture-combat',
    });
    recordAttempt(root, attempts, 'android', 'combat', combatPath);
    if (combatCapture.status !== 0 || combatCapture.timedOut) {
      return makeUnavailable('android', screenshotCommand, `android combat screenshot step failed: ${trimOutput(combatCapture.stderr) || 'adb screencap returned a non-zero exit code.'}`);
    }

    return finalizeCapture({
      platform: 'android',
      status: 'captured',
      command: screenshotCommand,
      screenshotPaths: [launchPath, combatPath],
      root,
    });
  } finally {
    const cleanup = runCommand(executable, [...prefix, 'shell', 'am', 'force-stop', metadata.android.packageId], {
      timeoutMs: DEFAULT_TIMEOUTS.cleanupMs,
    });
    logCommand(commandLog, 'android', 'cleanup', renderCommand(executable, [...prefix, 'shell', 'am', 'force-stop', metadata.android.packageId]), cleanup);
  }
}

function captureIos(root, metadata, commandLog, attempts, env = {}) {
  const exec = env.runCommand || runCommand;
  const resolveCommand = env.commandExists || commandExists;
  const detectWindow = env.waitForWindowInfo || waitForWindowInfo;
  const executable = resolveCommand(COMMANDS.ios[0]);
  const launchPath = screenshotPath(root, 'ios', 'launch');
  const combatPath = screenshotPath(root, 'ios', 'combat');
  const screenshotCommand = renderCommand(COMMANDS.ios[0], COMMANDS.ios[1].map((value) => value === '{outputPath}' ? launchPath : value));
  if (!executable) {
    return makeUnavailable('ios', screenshotCommand, 'xcrun executable not found in PATH.');
  }

  const probe = exec(executable, ['simctl', 'list', 'devices', 'booted', '--json'], { timeoutMs: DEFAULT_TIMEOUTS.detectMs });
  logCommand(commandLog, 'ios', 'detect-device', renderCommand(executable, ['simctl', 'list', 'devices', 'booted', '--json']), probe);
  if (probe.status !== 0 || probe.timedOut) {
    return makeUnavailable('ios', screenshotCommand, trimOutput(probe.stderr) || 'xcrun simctl list devices booted failed.');
  }

  const parsed = parseBootedSimulators(probe.stdout);
  if (parsed.reason) {
    return makeUnavailable('ios', screenshotCommand, parsed.reason);
  }
  const simulator = parsed.simulators[0];
  if (!simulator) {
    return makeUnavailable('ios', screenshotCommand, 'xcrun simctl list devices booted returned no booted iOS simulator.');
  }
  if (!metadata.ios.bundleId || !existsSync(metadata.ios.appBundlePath)) {
    return makeUnavailable('ios', screenshotCommand, `iOS app bundle missing: ${metadata.ios.appBundlePath}`);
  }

  const install = exec(executable, ['simctl', 'install', simulator.udid, metadata.ios.appBundlePath], {
    timeoutMs: DEFAULT_TIMEOUTS.installMs,
  });
  logCommand(commandLog, 'ios', 'install-app', renderCommand(executable, ['simctl', 'install', simulator.udid, metadata.ios.appBundlePath]), install);
  if (install.status !== 0 || install.timedOut) {
    return makeUnavailable('ios', screenshotCommand, `ios install step failed: ${trimOutput(install.stderr) || trimOutput(install.stdout) || 'simctl install returned a non-zero exit code.'}`);
  }

  const tempWindowCapture = join(root, 'docs/spacefight/screenshots/.tmp-ios-simulator-window-launch.png');
  try {
    const launch = exec(executable, ['simctl', 'launch', simulator.udid, metadata.ios.bundleId], {
      timeoutMs: DEFAULT_TIMEOUTS.launchMs,
    });
    logCommand(commandLog, 'ios', 'launch-app', renderCommand(executable, ['simctl', 'launch', simulator.udid, metadata.ios.bundleId]), launch);
    if (launch.status !== 0 || launch.timedOut) {
      return makeUnavailable('ios', screenshotCommand, `ios launch step failed: ${trimOutput(launch.stderr) || trimOutput(launch.stdout) || 'simctl launch returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const launchCapture = captureFileCommand({
      executable,
      args: ['simctl', 'io', simulator.udid, 'screenshot', launchPath],
      outputPath: launchPath,
      timeoutMs: DEFAULT_TIMEOUTS.captureMs,
      commandLog,
      platform: 'ios',
      step: 'capture-launch',
    });
    recordAttempt(root, attempts, 'ios', 'launch', launchPath);
    if (launchCapture.status !== 0 || launchCapture.timedOut) {
      return makeUnavailable('ios', screenshotCommand, `ios launch screenshot step failed: ${trimOutput(launchCapture.stderr) || 'simctl screenshot returned a non-zero exit code.'}`);
    }

    exec('open', ['-a', 'Simulator'], { timeoutMs: DEFAULT_TIMEOUTS.detectMs });
    const simulatorWindow = detectWindow({ ownerName: 'Simulator' }, DEFAULT_TIMEOUTS.detectMs);
    if (!simulatorWindow.window) {
      return makeUnavailable('ios', screenshotCommand, `ios trigger step failed: ${simulatorWindow.reason}`);
    }

    const windowCapture = captureWindow(simulatorWindow.window.id, tempWindowCapture, DEFAULT_TIMEOUTS.captureMs, commandLog, 'ios', 'capture-window-launch');
    if (windowCapture.status !== 0 || windowCapture.timedOut) {
      return makeUnavailable('ios', screenshotCommand, `ios trigger step failed: could not capture the Simulator window (${trimOutput(windowCapture.stderr) || 'screencapture returned a non-zero exit code.'}).`);
    }

    const simulatorAttempt = inspectScreenshotAttempt({ root, platform: 'ios', state: 'window-launch', outputPath: tempWindowCapture });
    const actionCenter = simulatorAttempt._decoded ? findAmberActionCenter(simulatorAttempt._decoded) : null;
    if (!actionCenter) {
      return makeUnavailable('ios', screenshotCommand, 'ios trigger step failed: could not locate the amber launch button inside the Simulator window.');
    }

    const hostX = simulatorWindow.window.x + actionCenter.x;
    const hostY = simulatorWindow.window.y + actionCenter.y;
    const trigger = clickHostPoint(hostX, hostY, commandLog, 'ios', 'trigger-combat');
    if (trigger.status !== 0 || trigger.timedOut) {
      return makeUnavailable('ios', screenshotCommand, `ios trigger step failed: ${trimOutput(trigger.stderr) || 'host click injection returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const combatCapture = captureFileCommand({
      executable,
      args: ['simctl', 'io', simulator.udid, 'screenshot', combatPath],
      outputPath: combatPath,
      timeoutMs: DEFAULT_TIMEOUTS.captureMs,
      commandLog,
      platform: 'ios',
      step: 'capture-combat',
    });
    recordAttempt(root, attempts, 'ios', 'combat', combatPath);
    if (combatCapture.status !== 0 || combatCapture.timedOut) {
      return makeUnavailable('ios', screenshotCommand, `ios combat screenshot step failed: ${trimOutput(combatCapture.stderr) || 'simctl screenshot returned a non-zero exit code.'}`);
    }

    return finalizeCapture({
      platform: 'ios',
      status: 'captured',
      command: screenshotCommand,
      screenshotPaths: [launchPath, combatPath],
      root,
    });
  } finally {
    rmIfExists(tempWindowCapture);
    const cleanup = exec(executable, ['simctl', 'terminate', simulator.udid, metadata.ios.bundleId], {
      timeoutMs: DEFAULT_TIMEOUTS.cleanupMs,
    });
    logCommand(commandLog, 'ios', 'cleanup', renderCommand(executable, ['simctl', 'terminate', simulator.udid, metadata.ios.bundleId]), cleanup);
  }
}

function captureHarmony(root, metadata, artifacts, commandLog, attempts) {
  const executable = commandExists(COMMANDS.harmonyos[0]);
  const screenshotCommand = renderCommand(COMMANDS.harmonyos[0], COMMANDS.harmonyos[1], { stdoutPath: '{outputPath}' });
  if (!executable) {
    return makeUnavailable('harmonyos', screenshotCommand, 'hdc executable not found in PATH.');
  }

  const probe = runCommand(executable, ['list', 'targets'], { timeoutMs: DEFAULT_TIMEOUTS.detectMs });
  logCommand(commandLog, 'harmonyos', 'detect-device', renderCommand(executable, ['list', 'targets']), probe);
  if (probe.status !== 0 || probe.timedOut) {
    return makeUnavailable('harmonyos', screenshotCommand, trimOutput(probe.stderr) || 'hdc list targets failed.');
  }
  const target = parseHarmonyTargets(probe.stdout)[0];
  if (!target) {
    return makeUnavailable('harmonyos', screenshotCommand, trimOutput(probe.stdout) === '[Empty]' ? 'hdc list targets returned [Empty].' : 'hdc list targets reported no connected HarmonyOS target.');
  }
  if (!metadata.harmonyos.bundleName || !metadata.harmonyos.abilityName) {
    return makeUnavailable('harmonyos', screenshotCommand, 'HarmonyOS metadata missing bundleName or EntryAbility.');
  }
  const hapPath = artifacts.harmonyos;
  if (!hapPath || !existsSync(hapPath)) {
    return makeUnavailable('harmonyos', screenshotCommand, `HarmonyOS artifact missing: ${hapPath || 'unknown hap path'}`);
  }

  const launchPath = screenshotPath(root, 'harmonyos', 'launch');
  const combatPath = screenshotPath(root, 'harmonyos', 'combat');
  const prefix = ['-t', target];
  const install = runCommand(executable, [...prefix, 'install', '-r', hapPath], { timeoutMs: DEFAULT_TIMEOUTS.installMs });
  logCommand(commandLog, 'harmonyos', 'install-app', renderCommand(executable, [...prefix, 'install', '-r', hapPath]), install);
  if (install.status !== 0 || install.timedOut) {
    return makeUnavailable('harmonyos', screenshotCommand, `harmonyos install step failed: ${trimOutput(install.stderr) || trimOutput(install.stdout) || 'hdc install returned a non-zero exit code.'}`);
  }

  try {
    const launch = runCommand(executable, [...prefix, 'shell', 'aa', 'start', '-b', metadata.harmonyos.bundleName, '-a', metadata.harmonyos.abilityName], {
      timeoutMs: DEFAULT_TIMEOUTS.launchMs,
    });
    logCommand(commandLog, 'harmonyos', 'launch-app', renderCommand(executable, [...prefix, 'shell', 'aa', 'start', '-b', metadata.harmonyos.bundleName, '-a', metadata.harmonyos.abilityName]), launch);
    if (launch.status !== 0 || launch.timedOut) {
      return makeUnavailable('harmonyos', screenshotCommand, `harmonyos launch step failed: ${trimOutput(launch.stderr) || trimOutput(launch.stdout) || 'aa start returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const launchCapture = captureStdoutToFile({
      executable,
      args: [...prefix, ...COMMANDS.harmonyos[1]],
      outputPath: launchPath,
      timeoutMs: DEFAULT_TIMEOUTS.captureMs,
      commandLog,
      platform: 'harmonyos',
      step: 'capture-launch',
    });
    recordAttempt(root, attempts, 'harmonyos', 'launch', launchPath);
    if (launchCapture.status !== 0 || launchCapture.timedOut) {
      return makeUnavailable('harmonyos', screenshotCommand, `harmonyos launch screenshot step failed: ${trimOutput(launchCapture.stderr) || 'hdc snapshot_display returned a non-zero exit code.'}`);
    }

    const launchAttempt = inspectScreenshotAttempt({ root, platform: 'harmonyos', state: 'launch', outputPath: launchPath });
    const actionCenter = launchAttempt._decoded ? findAmberActionCenter(launchAttempt._decoded) : null;
    if (!actionCenter) {
      return makeUnavailable('harmonyos', screenshotCommand, 'harmonyos trigger step failed: could not locate the amber launch button in the launch screenshot.');
    }

    const trigger = runCommand(executable, [...prefix, 'shell', 'uitest', 'uiInput', 'click', String(actionCenter.x), String(actionCenter.y)], {
      timeoutMs: DEFAULT_TIMEOUTS.triggerMs,
    });
    logCommand(commandLog, 'harmonyos', 'trigger-combat', renderCommand(executable, [...prefix, 'shell', 'uitest', 'uiInput', 'click', String(actionCenter.x), String(actionCenter.y)]), trigger);
    if (trigger.status !== 0 || trigger.timedOut) {
      return makeUnavailable('harmonyos', screenshotCommand, `harmonyos trigger step failed: ${trimOutput(trigger.stderr) || trimOutput(trigger.stdout) || 'uitest uiInput click returned a non-zero exit code.'}`);
    }

    sleepMs(DEFAULT_TIMEOUTS.settleMs);
    const combatCapture = captureStdoutToFile({
      executable,
      args: [...prefix, ...COMMANDS.harmonyos[1]],
      outputPath: combatPath,
      timeoutMs: DEFAULT_TIMEOUTS.captureMs,
      commandLog,
      platform: 'harmonyos',
      step: 'capture-combat',
    });
    recordAttempt(root, attempts, 'harmonyos', 'combat', combatPath);
    if (combatCapture.status !== 0 || combatCapture.timedOut) {
      return makeUnavailable('harmonyos', screenshotCommand, `harmonyos combat screenshot step failed: ${trimOutput(combatCapture.stderr) || 'hdc snapshot_display returned a non-zero exit code.'}`);
    }

    return finalizeCapture({
      platform: 'harmonyos',
      status: 'captured',
      command: screenshotCommand,
      screenshotPaths: [launchPath, combatPath],
      root,
    });
  } finally {
    const cleanup = runCommand(executable, [...prefix, 'shell', 'aa', 'force-stop', metadata.harmonyos.bundleName], {
      timeoutMs: DEFAULT_TIMEOUTS.cleanupMs,
    });
    logCommand(commandLog, 'harmonyos', 'cleanup', renderCommand(executable, [...prefix, 'shell', 'aa', 'force-stop', metadata.harmonyos.bundleName]), cleanup);
  }
}

function createRuntimeCapture({ root, now = new Date(), overrides = {}, outputPath: requestedOutputPath = null }) {
  const resolvedRoot = resolve(root);
  const outputPath = requestedOutputPath
    ? resolve(requestedOutputPath)
    : join(resolvedRoot, 'docs/spacefight/baselines/2026-08-03/runtime-capture.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(join(resolvedRoot, 'docs/spacefight/screenshots'), { recursive: true });

  const metadata = platformMetadata(resolvedRoot);
  const artifacts = artifactMap(resolvedRoot);
  const commandLog = [];
  const attempts = [];
  const envs = overrides.envs || {};
  const results = [
    (overrides.captureMacos || captureMacos)(resolvedRoot, commandLog, attempts, envs.macos),
    (overrides.captureAndroid || captureAndroid)(resolvedRoot, metadata, artifacts, commandLog, attempts, envs.android),
    (overrides.captureIos || captureIos)(resolvedRoot, metadata, commandLog, attempts, envs.ios),
    (overrides.captureHarmony || captureHarmony)(resolvedRoot, metadata, artifacts, commandLog, attempts, envs.harmonyos),
  ];
  preserveExistingAttempts(resolvedRoot, attempts);
  enrichAttemptEvidence(resolvedRoot, attempts);

  const manifest = {
    createdAt: now.toISOString(),
    baselineReference: 'docs/spacefight/baselines/2026-08-03/native-foundation.json',
    thresholds: EVIDENCE_THRESHOLDS,
    commands: captureCommands(),
    attempts,
    results,
    commandLog,
  };
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, outputPath };
}

if (require.main === module) {
  const root = resolve(__dirname, '../..');
  const { manifest, outputPath } = createRuntimeCapture({ root, now: new Date() });
  const summary = manifest.results.map((result) => `${result.platform}:${result.status}`).join(', ');
  console.log(`Wrote ${relative(root, outputPath)} (${summary}).`);
}

module.exports = {
  buildWindowInfoSwiftScript,
  captureCommands,
  createRuntimeCapture,
  finalizeCapture,
  inspectScreenshotAttempt,
  parseBootedSimulators,
};
