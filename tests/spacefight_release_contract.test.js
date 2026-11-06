const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const releaseIdentity = readJson(path.join(root, 'SpaceFight-Cocos/package.json'));
const currentVersion = releaseIdentity.version;
const currentBuild = releaseIdentity.build;
const androidVersion = currentVersion;
const androidBuild = currentBuild;
const harmonyVersion = currentVersion;
const harmonyBuild = currentBuild;
const publishedApps = readJson(path.join(root, 'website/api/apps/manifest.json')).apps;
const publishedMac = publishedApps.find(app => app.id === 'spacefight-macos');
const macVersion = publishedMac.version;
const macBuild = publishedMac.build;
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];

const releases = {
  'spacefight-android': {
    platform: 'android',
    bundleIdentifier: 'cn.zhengzhengstudio.spacefight',
    version: androidVersion,
    build: androidBuild,
    signed: true,
    debug: false,
    versioned: `SpaceFight-Android-v${androidVersion}.apk`,
    latest: 'SpaceFight-Android-latest.apk',
  },
  'spacefight-harmonyos-offline': {
    platform: 'harmonyos',
    bundleIdentifier: 'cn.zhengzhengstudio.spacefight.huawei',
    variant: 'offline',
    version: harmonyVersion,
    build: harmonyBuild,
    signed: true,
    versioned: `SpaceFight-HarmonyOS-Offline-v${harmonyVersion}.hap`,
    latest: 'SpaceFight-HarmonyOS-Offline-latest.hap',
  },
  'spacefight-harmonyos-offline-app': {
    platform: 'harmonyos',
    bundleIdentifier: 'cn.zhengzhengstudio.spacefight.huawei',
    variant: 'offline',
    version: harmonyVersion,
    build: harmonyBuild,
    signed: true,
    storeReady: true,
    versioned: `SpaceFight-HarmonyOS-Offline-v${harmonyVersion}.app`,
    latest: 'SpaceFight-HarmonyOS-Offline-latest.app',
  },
  'spacefight-macos': {
    platform: 'macos',
    bundleIdentifier: 'cn.zhengzhengstudio.spacefight',
    version: macVersion,
    build: macBuild,
    signed: true,
    debug: true,
    versioned: `SpaceFight-macOS-v${macVersion}-debug.dmg`,
    latest: 'SpaceFight-macOS-latest-debug.dmg',
  },
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function cloudPlaceholder(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.icloud`);
}

function resolvePackageFiles(appRoot, release) {
  if (release.versioned) return [release.versioned, release.latest];
  const files = fs.readdirSync(appRoot);
  const versioned = files.find(file => release.versionedPattern.test(file));
  const latest = files.find(file => release.latestPattern.test(file));
  return [versioned, latest];
}

test('SpaceFight packages and metadata match in both distribution roots', () => {
  for (const appRoot of appRoots) {
    for (const manifestName of ['manifest.json', 'client-downloads.json']) {
      const manifest = readJson(path.join(appRoot, manifestName));
      for (const [id, release] of Object.entries(releases)) {
        const entry = manifest.apps.find(app => app.id === id && app.platform === release.platform);
        assert.ok(entry, `${id} is missing from ${manifestName}`);
        assert.equal(entry.version, release.version);
        assert.equal(entry.build, release.build);
        assert.equal(entry.bundleIdentifier, release.bundleIdentifier);
        if (release.variant) assert.equal(entry.variant, release.variant);
        if (release.signed) assert.equal(entry.signed, true);
        if (release.debug) assert.equal(entry.debug, true);
        if (release.storeReady) assert.equal(entry.storeReady, true);

        const [versionedName, latestName] = resolvePackageFiles(appRoot, release);
        assert.ok(versionedName, `${id} versioned package is missing`);
        assert.ok(latestName, `${id} latest package is missing`);
        const versionedFile = path.join(appRoot, versionedName);
        const latestFile = path.join(appRoot, latestName);
        assert.equal(entry.fileName, versionedName);
        if (fs.existsSync(versionedFile) && fs.existsSync(latestFile)) {
          assert.equal(entry.size, fs.statSync(versionedFile).size);
          assert.equal(entry.sha256, sha256(versionedFile));
          assert.equal(sha256(versionedFile), sha256(latestFile), `${id} latest package is stale`);
        } else {
          assert.equal(fs.existsSync(cloudPlaceholder(versionedFile)), true,
            `${id} versioned package is neither local nor cloud-backed`);
          assert.equal(fs.existsSync(cloudPlaceholder(latestFile)), true,
            `${id} latest package is neither local nor cloud-backed`);
          assert.ok(entry.size > 0, `${id} cloud-backed size is missing`);
          assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${id} cloud-backed digest is invalid`);
        }
      }
    }
  }
});

test('both public app directories contain identical SpaceFight releases', () => {
  const [privateRoot, publicRoot] = appRoots;
  for (const release of Object.values(releases)) {
    const [versionedName, latestName] = resolvePackageFiles(privateRoot, release);
    for (const fileName of [versionedName, latestName]) {
      assert.ok(fileName, 'release filename is missing');
      const privateFile = path.join(privateRoot, fileName);
      const publicFile = path.join(publicRoot, fileName);
      if (fs.existsSync(privateFile) && fs.existsSync(publicFile)) {
        assert.equal(sha256(privateFile), sha256(publicFile), `${fileName} differs between distribution roots`);
      } else {
        assert.equal(fs.existsSync(cloudPlaceholder(privateFile)), true, `${fileName} private placeholder is missing`);
        assert.equal(fs.existsSync(cloudPlaceholder(publicFile)), true, `${fileName} public placeholder is missing`);
      }
    }
  }
});

test('legacy 2D release builder cannot overwrite current Cocos packages by default', () => {
  const script = fs.readFileSync(path.join(root, 'apps/build_spacefight_apps.sh'), 'utf8');
  assert.match(script, /VERSION="0\.10\.2"/);
  assert.match(script, /BUILD="20"/);
  assert.match(script, /SPACEFIGHT_ALLOW_LEGACY_2D_BUILD/);
  assert.match(script, /旧版 2D 构建器已停用/);
});

test('download center relies on current server metadata instead of a stale SpaceFight card', () => {
  const page = fs.readFileSync(path.join(root, 'website/zhengzhengstudio.cn/downloads.html'), 'utf8');
  assert.match(page, /fetchWithTimeout\(`\$\{API_BASE\}\/api\/downloads`/);
  assert.doesNotMatch(page, /SpaceFight - 太空射击大作 v0\.4\.0/);
});
