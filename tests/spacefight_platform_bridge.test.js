'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const projectRoot = path.join(repositoryRoot, 'SpaceFight-Cocos');
const scriptsRoot = path.join(projectRoot, 'assets', 'scripts');
let standaloneOutputRoot = null;

function compiledPlatformPath() {
  if (process.env.SPACEFIGHT_COCOS_COMPILED_PLATFORM) {
    return process.env.SPACEFIGHT_COCOS_COMPILED_PLATFORM;
  }

  standaloneOutputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-cocos-platform-'));
  const compile = spawnSync('npx', [
    '--yes', '--package', 'typescript@4.9.5', 'tsc',
    '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--strict', '--skipLibCheck', '--lib', 'ES2020,DOM',
    '--rootDir', scriptsRoot,
    '--outDir', standaloneOutputRoot,
    path.join(scriptsRoot, 'platform', 'PlatformBridge.ts'),
    path.join(scriptsRoot, 'platform', 'WebPlatformBridge.ts'),
    path.join(scriptsRoot, 'platform', 'NativePlatformBridge.ts'),
    path.join(scriptsRoot, 'platform', 'PlatformBootstrap.ts'),
  ], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(compile.status, 0, `${compile.stdout}${compile.stderr}`);
  return path.join(standaloneOutputRoot, 'platform');
}

const compiledPlatformRoot = compiledPlatformPath();
test.after(() => {
  if (standaloneOutputRoot) {
    rmSync(standaloneOutputRoot, { recursive: true, force: true });
  }
});

const platform = {
  ...require(path.join(compiledPlatformRoot, 'PlatformBridge.js')),
  ...require(path.join(compiledPlatformRoot, 'WebPlatformBridge.js')),
  ...require(path.join(compiledPlatformRoot, 'NativePlatformBridge.js')),
  ...require(path.join(compiledPlatformRoot, 'PlatformBootstrap.js')),
};

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createNativeHost() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    invoke(method, payload) {
      const request = JSON.parse(payload);
      calls.push({ method, request });
      if (method === 'readText') return JSON.stringify(values.get(request.key) ?? null);
      if (method === 'writeText') {
        values.set(request.key, request.value);
        return 'null';
      }
      if (method === 'deviceSnapshot') {
        return JSON.stringify({
          memoryGB: 8,
          availableMemoryGB: 5,
          lowRamDevice: false,
          emulator: false,
          logicalCores: 6,
          gpuRenderer: 'SpaceFight Test GPU',
          viewportWidth: 1920,
          viewportHeight: 1080,
          pixelRatio: 2,
        });
      }
      return 'null';
    },
  };
}

test('offline native bridge keeps storage and haptics local', async () => {
  const host = createNativeHost();
  const bridge = new platform.NativePlatformBridge(host, {
    platform: 'harmonyos',
    offline: true,
  });

  await bridge.writeText('graphics.profile', 'high');
  assert.equal(await bridge.readText('graphics.profile'), 'high');
  await bridge.haptic('impact-medium');

  assert.equal(bridge.platform, 'harmonyos');
  assert.equal(bridge.offline, true);
  assert.deepEqual(bridge.capabilities, { auth: false, updates: false, haptics: true });
  assert.deepEqual(host.calls.map((call) => call.method), ['writeText', 'readText', 'haptic']);
});

test('missing native host selects a web bridge with a no-throw haptic fallback', async () => {
  const bridge = platform.createPlatformBridge({
    nativeHost: undefined,
    storage: createMemoryStorage(),
    offline: true,
  });

  await bridge.writeText('graphics.profile', 'low');
  assert.equal(await bridge.readText('graphics.profile'), 'low');
  await assert.doesNotReject(() => bridge.haptic('impact-medium'));
  assert.equal(bridge.platform, 'web');
  assert.equal(bridge.capabilities.haptics, false);
  assert.equal(bridge.capabilities.auth, false);
  assert.equal(bridge.capabilities.updates, false);
});

test('native host without a trusted platform fails closed to the web bridge', async () => {
  for (const platformOption of [undefined, 'web', 'desktop']) {
    const host = createNativeHost();
    let bridge;
    assert.doesNotThrow(() => {
      bridge = platform.createPlatformBridge({
        nativeHost: host,
        ...(platformOption === undefined ? {} : { platform: platformOption }),
      });
    });

    assert.ok(bridge instanceof platform.WebPlatformBridge, String(platformOption));
    assert.equal(bridge.platform, 'web');
    assert.equal(bridge.capabilities.haptics, false);
    await assert.doesNotReject(() => bridge.haptic('impact-medium'));
    assert.deepEqual(host.calls, []);
  }
});

test('native adapter turns invalid host JSON into one typed diagnostic and a safe snapshot', async () => {
  const diagnostics = [];
  const bridge = new platform.NativePlatformBridge({
    invoke() {
      return 'not json';
    },
  }, {
    platform: 'ios',
    diagnostic: (event) => diagnostics.push(event),
  });

  assert.deepEqual(await bridge.deviceSnapshot(), {
    memoryGB: null,
    availableMemoryGB: null,
    lowRamDevice: null,
    emulator: null,
    logicalCores: null,
    gpuRenderer: null,
    viewportWidth: 0,
    viewportHeight: 0,
    pixelRatio: 1,
  });
  assert.deepEqual(diagnostics, [{
    code: 'native-response-invalid-json',
    method: 'deviceSnapshot',
  }]);
});

test('native adapter keeps valid capability fields while sanitizing unsafe numeric values', async () => {
  const bridge = new platform.NativePlatformBridge({
    invoke() {
      return JSON.stringify({
        memoryGB: 3,
        availableMemoryGB: 0.75,
        lowRamDevice: true,
        emulator: true,
        logicalCores: 4.9,
        gpuRenderer: 'OpenGL ES 3.2',
        viewportWidth: -1,
        viewportHeight: 2400,
        pixelRatio: Number.POSITIVE_INFINITY,
      });
    },
  }, { platform: 'android' });

  assert.deepEqual(await bridge.deviceSnapshot(), {
    memoryGB: 3,
    availableMemoryGB: 0.75,
    lowRamDevice: true,
    emulator: true,
    logicalCores: 4,
    gpuRenderer: 'OpenGL ES 3.2',
    viewportWidth: 0,
    viewportHeight: 2400,
    pixelRatio: 1,
  });
});

test('Android Cocos reflection becomes a native host without web fallback', async () => {
  const calls = [];
  globalThis.jsb = {
    reflection: {
      callStaticMethod(...args) {
        calls.push(args);
        return JSON.stringify({
          memoryGB: 6,
          logicalCores: 8,
          gpuRenderer: 'OpenGL ES 3.2',
          viewportWidth: 2400,
          viewportHeight: 1080,
          pixelRatio: 2.75,
        });
      },
    },
  };

  try {
    const bridge = platform.createPlatformBridge({ platform: 'android' });
    assert.ok(bridge instanceof platform.NativePlatformBridge);
    assert.equal(bridge.platform, 'android');
    assert.equal((await bridge.deviceSnapshot()).memoryGB, 6);
    assert.deepEqual(calls[0].slice(0, 3), [
      'com/cocos/game/AppActivity',
      'spaceFightInvoke',
      '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
    ]);
  } finally {
    delete globalThis.jsb;
  }
});

test('bootstrap selects and registers the native bridge from the native host', () => {
  const host = createNativeHost();
  const bridge = platform.bootstrapPlatformBridge({
    nativeHost: host,
    platform: 'macos',
    offline: false,
  });

  assert.ok(bridge instanceof platform.NativePlatformBridge);
  assert.equal(bridge.platform, 'macos');
  assert.equal(platform.platformBridge(), bridge);
});

test('bridge adapters expose only offline foundation operations', () => {
  const nativeMethods = Object.getOwnPropertyNames(platform.NativePlatformBridge.prototype).sort();
  const webMethods = Object.getOwnPropertyNames(platform.WebPlatformBridge.prototype).sort();
  const expected = ['constructor', 'deviceSnapshot', 'haptic', 'readText', 'writeText'];

  assert.deepEqual(nativeMethods, expected);
  assert.deepEqual(webMethods, expected);
});
