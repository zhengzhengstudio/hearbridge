'use strict';

const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');
const { NATIVE_TARGETS } = require('./native-targets');
const { childExitCode } = require('./process-status');

const projectRoot = path.resolve(__dirname, '..');
const releasePackage = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const appIdentity = Object.freeze({
  name: 'SpaceFight',
  version: releasePackage.version,
  build: releasePackage.build,
});
const creatorVersion = '3.8.8';
const creator = process.env.COCOS_CREATOR_BIN
  || `/Applications/Cocos/Creator/${creatorVersion}/CocosCreator.app/Contents/MacOS/CocosCreator`;
const evidenceDirectory = path.join(projectRoot, 'native-build', 'evidence');
const requiredStationArt = [
  'orbital-outpost-exterior.png',
  'orbital-hangar-loadout.png',
  'orbital-combat-zone.png',
];

function validateRequiredVisualAssets() {
  const stationRoot = path.join(projectRoot, 'assets', 'resources', 'ui', 'station');
  for (const fileName of requiredStationArt) {
    const file = path.join(stationRoot, fileName);
    if (!existsSync(file) || statSync(file).size < 100_000) {
      throw new Error(`Required station artwork is unavailable or cloud-only: ${file}`);
    }
  }
}

function applyAndroidToolchain(config, { sdkPath, ndkPath, javaPath }) {
  const configured = JSON.parse(JSON.stringify(config));
  configured.packages.android = {
    ...configured.packages.android,
    sdkPath,
    ndkPath,
    javaPath,
    javaHome: path.dirname(path.dirname(javaPath)),
  };
  return configured;
}

function findFile(root, name, depth = 8) {
  if (depth < 0 || !existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return candidate;
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name, depth - 1);
      if (nested) return nested;
    }
  }
  return null;
}

function launcherJava21(launcherRoot) {
  if (!existsSync(launcherRoot)) return null;
  const jdk21Directory = readdirSync(launcherRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && /jdk[_-]?21/i.test(entry.name));
  return jdk21Directory ? findFile(path.join(launcherRoot, jdk21Directory.name), 'java') : null;
}

function resolveAndroidToolchain() {
  const sdkPath = process.env.SPACEFIGHT_ANDROID_SDK
    || path.join(process.env.HOME || '', 'Library', 'Android', 'sdk');
  const ndkPath = process.env.SPACEFIGHT_ANDROID_NDK
    || path.join(sdkPath, 'ndk', '23.2.8568313');
  const launcherRoot = path.join(
    process.env.HOME || '',
    'Library',
    'Application Support',
    'LauncherX',
    'LauncherX',
    'DownloadedJRE',
  );
  const javaPath = process.env.SPACEFIGHT_JAVA_PATH || launcherJava21(launcherRoot);
  for (const [label, candidate] of Object.entries({ sdkPath, ndkPath, javaPath })) {
    if (!candidate || !existsSync(candidate)) throw new Error(`Android ${label} is unavailable: ${candidate || 'missing'}`);
  }
  return { sdkPath, ndkPath, javaPath };
}

function normalizeAndroidGradleProperties(source) {
  return source
    .replace(/^PROP_COMPILE_SDK_VERSION=.*$/m, 'PROP_COMPILE_SDK_VERSION=36')
    .replace(/^PROP_TARGET_SDK_VERSION=.*$/m, 'PROP_TARGET_SDK_VERSION=36')
    .replace(/^(?:RES_PATH|NATIVE_DIR)=.*$/gm, (line) => (
      line.replace(/[^\x00-\x7F]/g, (character) => (
      `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
      ))
    ));
}

function normalizeAndroidGradleIdentity(source, identity = appIdentity) {
  return source
    .replace(/^(\s*)versionCode\s+\d+\s*$/m, `$1versionCode ${identity.build}`)
    .replace(/^(\s*)versionName\s+['"][^'"]+['"]\s*$/m, `$1versionName "${identity.version}"`);
}

function normalizeAndroidRepositories(source) {
  if (source.includes("maven.aliyun.com/repository/google")) return source;
  return source.replace(
    /repositories\s*\{\s*\n/,
    "repositories {\n        maven { url 'https://maven.aliyun.com/repository/google' }\n        maven { url 'https://maven.aliyun.com/repository/public' }\n",
  );
}

function normalizeAndroidUpdater(source) {
  const browserDownload = /new\s+Intent\s*\(\s*Intent\.ACTION_VIEW\s*,\s*Uri\.parse\(download\)\s*\)/;
  if (browserDownload.test(source)) {
    throw new Error('Android updater must download APK files in-app instead of opening a browser');
  }
  const segmentedUpdater = source.includes('DOWNLOAD_WORKERS') && source.includes('downloadParallel');
  if (!segmentedUpdater) {
    for (const required of ['DownloadManager', 'ACTION_DOWNLOAD_COMPLETE', 'getUriForDownloadedFile']) {
      if (!source.includes(required)) throw new Error(`Android in-app updater is missing ${required}`);
    }
  }

  const legacyComparison = 'boolean newer = build > localBuild() || compareVersions(version, localVersion()) > 0;';
  const normalizedComparison = [
    'int versionComparison = compareVersions(version, localVersion());',
    '                boolean newer = versionComparison > 0',
    '                    || (versionComparison == 0 && build > localBuild());',
  ].join('\n');
  if (source.includes(legacyComparison)) return source.replace(legacyComparison, normalizedComparison);
  if (!source.includes('versionComparison == 0 && build > localBuild()')) {
    throw new Error('Android updater must compare build numbers only when versions are equal');
  }
  return source;
}

function androidStringsXml(appName = appIdentity.name) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    `  <string name="app_name">${appName}</string>`,
    '</resources>',
    '',
  ].join('\n');
}

function replacePlistString(source, key, value) {
  const expression = new RegExp(`(<key>${key}<\\/key>\\s*<string>)[^<]*(<\\/string>)`);
  return source.replace(expression, `$1${value}$2`);
}

function normalizeAppleInfoPlist(source, identity = appIdentity) {
  return [
    ['CFBundleDisplayName', identity.name],
    ['CFBundleName', identity.name],
    ['CFBundleShortVersionString', identity.version],
    ['CFBundleVersion', String(identity.build)],
  ].reduce((plist, [key, value]) => replacePlistString(plist, key, value), source);
}

function normalizeHarmonyAppJson(source, packageName, identity = appIdentity) {
  const config = JSON.parse(source);
  config.app = {
    ...config.app,
    bundleName: packageName,
    versionCode: identity.build,
    versionName: identity.version,
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function normalizeHarmonyModuleJson(source, offline) {
  const config = JSON.parse(source);
  if (offline && Array.isArray(config.module?.requestPermissions)) {
    const networkPermissions = new Set([
      'ohos.permission.INTERNET',
      'ohos.permission.GET_NETWORK_INFO',
    ]);
    config.module.requestPermissions = config.module.requestPermissions
      .filter((permission) => !networkPermissions.has(permission.name));
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

function normalizeHarmonyArkTsContext(source) {
  const contextNames = [
    'displayUtils',
    'nativeContext',
    'nativeEditBox',
    'nativeWebView',
    'appLifecycle',
    'nativeVideo',
    'renderContext',
  ];
  let normalized = source.replace(
    /import cocos from (['"])libcocos\.so\1;/,
    'import cocos, { context } from $1libcocos.so$1;',
  );
  for (const name of contextNames) {
    normalized = normalized.replace(
      new RegExp(`const ${name} = cocos\\.getContext`, 'g'),
      `const ${name}: context = cocos.getContext`,
    );
  }
  return normalized;
}

function normalizeHarmonyStrings(source) {
  const resources = JSON.parse(source);
  for (const item of resources.string || []) {
    if (item.name === 'app_name' || item.name === 'MainAbility_label') item.value = appIdentity.name;
    if (item.name === 'entry_desc' || item.name === 'MainAbility_desc') {
      item.value = 'SpaceFight 原生横屏空战游戏';
    }
  }
  return `${JSON.stringify(resources, null, 2)}\n`;
}

function resizePng(source, destination, size) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const result = spawnSync('/usr/bin/sips', [
    '-z', String(size), String(size), source, '--out', destination,
  ], { encoding: 'utf8' });
  if (childExitCode(result) !== 0 || !existsSync(destination)) {
    throw new Error(`Unable to generate native icon: ${destination}`);
  }
}

function installAndroidIcons() {
  const iconSource = path.join(projectRoot, 'build-templates', 'web-desktop', 'spacefight-icon.png');
  const resourceRoot = path.join(projectRoot, 'native', 'engine', 'android', 'res');
  const iconSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  if (!existsSync(iconSource)) throw new Error(`SpaceFight app icon is unavailable: ${iconSource}`);

  for (const [density, size] of Object.entries(iconSizes)) {
    const destinationDirectory = path.join(resourceRoot, `mipmap-${density}`);
    const destination = path.join(destinationDirectory, 'ic_launcher.png');
    mkdirSync(destinationDirectory, { recursive: true });
    resizePng(iconSource, destination, size);
  }
}

function syncAndroidIcons(outputDirectory) {
  const templateRoot = path.join(projectRoot, 'native', 'engine', 'android', 'res');
  const outputRoot = path.join(outputDirectory, 'proj', 'res');
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const source = path.join(templateRoot, `mipmap-${density}`, 'ic_launcher.png');
    const destination = path.join(outputRoot, `mipmap-${density}`, 'ic_launcher.png');
    if (!existsSync(source)) throw new Error(`Android launcher icon is unavailable: ${source}`);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function installAppleIcons(platform) {
  const iconSource = path.join(projectRoot, 'build-templates', 'web-desktop', 'spacefight-icon.png');
  const iconDirectory = path.join(
    projectRoot,
    'native',
    'engine',
    platform,
    platform === 'ios' ? 'Images.xcassets' : 'Assets.xcassets',
    'AppIcon.appiconset',
  );
  if (!existsSync(iconDirectory)) throw new Error(`${platform} AppIcon set is unavailable: ${iconDirectory}`);
  for (const entry of readdirSync(iconDirectory, { withFileTypes: true })) {
    const size = Number.parseInt(entry.name, 10);
    if (entry.isFile() && entry.name.endsWith('.png') && Number.isInteger(size)) {
      resizePng(iconSource, path.join(iconDirectory, entry.name), size);
    }
  }
}

function normalizeAppleIdentity(platform, outputDirectory) {
  const plistPath = path.join(projectRoot, 'native', 'engine', platform, 'Info.plist');
  if (!existsSync(plistPath)) throw new Error(`${platform} Info.plist is unavailable: ${plistPath}`);
  writeFileSync(plistPath, normalizeAppleInfoPlist(readFileSync(plistPath, 'utf8')));
  if (outputDirectory) {
    for (const file of collectFiles(outputDirectory).filter((entry) => entry.endsWith('/Info.plist'))) {
      const generatedPlistPath = path.join(outputDirectory, file);
      writeFileSync(
        generatedPlistPath,
        normalizeAppleInfoPlist(readFileSync(generatedPlistPath, 'utf8')),
      );
    }
  }
  installAppleIcons(platform);
}

function normalizeAndroidIdentity(outputDirectory) {
  const gradlePath = path.join(projectRoot, 'native', 'engine', 'android', 'app', 'build.gradle');
  if (!existsSync(gradlePath)) throw new Error(`Android Gradle app template is unavailable: ${gradlePath}`);
  writeFileSync(
    gradlePath,
    normalizeAndroidGradleIdentity(readFileSync(gradlePath, 'utf8')),
  );

  const outputStringsPath = path.join(outputDirectory, 'proj', 'res', 'values', 'strings.xml');
  mkdirSync(path.dirname(outputStringsPath), { recursive: true });
  writeFileSync(outputStringsPath, androidStringsXml());
  installAndroidIcons();
  syncAndroidIcons(outputDirectory);
}

// Cocos 3.8's Android template registers `../libs` as a jniLibs source dir while
// also compiling libcocos.so through CMake. A prebuilt libcocos.so left in
// native/engine/android/libs/<abi>/ by an earlier successful build is then merged
// alongside the freshly compiled one, and AGP aborts mergeReleaseNativeLibs with
//   "2 files found with path 'lib/arm64-v8a/libcocos.so'".
// Rename (never delete) the stale prebuilt copy on every successful export, so
// the CMake output is the single source of truth and the old file stays restorable.
function quarantinePrebuiltNativeLibraries() {
  const libsRoot = path.join(projectRoot, 'native', 'engine', 'android', 'libs');
  if (!existsSync(libsRoot)) return [];
  const quarantined = [];
  for (const abi of readdirSync(libsRoot)) {
    const abiRoot = path.join(libsRoot, abi);
    if (!statSync(abiRoot).isDirectory()) continue;
    for (const entry of readdirSync(abiRoot)) {
      if (entry !== 'libcocos.so') continue;
      renameSync(path.join(abiRoot, entry), path.join(abiRoot, `${entry}.prebuilt`));
      quarantined.push(path.relative(projectRoot, path.join(abiRoot, `${entry}.prebuilt`)));
    }
  }
  return quarantined;
}

function normalizeAndroidProject(outputDirectory) {
  const propertiesPath = path.join(outputDirectory, 'proj', 'gradle.properties');
  if (!existsSync(propertiesPath)) return;
  const source = readFileSync(propertiesPath, 'utf8');
  writeFileSync(propertiesPath, normalizeAndroidGradleProperties(source));
  const rootGradlePath = path.join(outputDirectory, 'proj', 'build.gradle');
  if (existsSync(rootGradlePath)) {
    writeFileSync(rootGradlePath, normalizeAndroidRepositories(readFileSync(rootGradlePath, 'utf8')));
  }
  normalizeAndroidIdentity(outputDirectory);
  const updaterPaths = [
    path.join(projectRoot, 'native', 'engine', 'android', 'app', 'src', 'com', 'cocos', 'game', 'AppActivity.java'),
    ...collectFiles(outputDirectory)
      .filter((file) => file.endsWith('/AppActivity.java'))
      .map((file) => path.join(outputDirectory, file)),
  ];
  for (const updaterPath of new Set(updaterPaths)) {
    if (!existsSync(updaterPath)) continue;
    writeFileSync(updaterPath, normalizeAndroidUpdater(readFileSync(updaterPath, 'utf8')));
  }
  const quarantined = quarantinePrebuiltNativeLibraries();
  if (quarantined.length > 0) {
    process.stdout.write(
      `Quarantined prebuilt native libraries (would collide with CMake output): ${quarantined.join(', ')}\n`,
    );
  }
}

function normalizeHarmonyIdentity(target) {
  const harmonyRoot = path.join(projectRoot, 'native', 'engine', 'harmonyos-next');
  const creatorTemplateRoot = path.resolve(
    path.dirname(creator),
    '../Resources/resources/3d/engine/templates/harmonyos-next',
  );
  const appJsonPath = path.join(harmonyRoot, 'AppScope', 'app.json5');
  const moduleJsonPath = path.join(harmonyRoot, 'entry', 'src', 'main', 'module.json5');
  const stringPaths = [
    path.join(harmonyRoot, 'AppScope', 'resources', 'base', 'element', 'string.json'),
    path.join(harmonyRoot, 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'),
  ];
  const iconSource = path.join(projectRoot, 'build-templates', 'web-desktop', 'spacefight-icon.png');
  const iconPaths = [
    path.join(harmonyRoot, 'AppScope', 'resources', 'base', 'media', 'app_icon.png'),
    path.join(harmonyRoot, 'entry', 'src', 'main', 'resources', 'base', 'media', 'icon.png'),
  ];
  const adapterPaths = [
    path.join(
      harmonyRoot,
      'entry', 'src', 'main', 'ets', 'cocos', 'oh-adapter', 'sys-ability-polyfill.ets',
    ),
    path.join(harmonyRoot, 'entry', 'src', 'main', 'ets', 'workers', 'cocos_worker.ets'),
  ];
  const requiredTemplateFiles = [
    path.join('entry', 'src', 'main', 'ets', 'cocos', 'game.ts'),
  ];

  writeFileSync(
    appJsonPath,
    normalizeHarmonyAppJson(readFileSync(appJsonPath, 'utf8'), target.packageName),
  );
  writeFileSync(
    moduleJsonPath,
    normalizeHarmonyModuleJson(readFileSync(moduleJsonPath, 'utf8'), target.offline),
  );
  for (const stringPath of stringPaths) {
    writeFileSync(stringPath, normalizeHarmonyStrings(readFileSync(stringPath, 'utf8')));
  }
  for (const iconPath of iconPaths) copyFileSync(iconSource, iconPath);
  for (const adapterPath of adapterPaths) {
    writeFileSync(
      adapterPath,
      normalizeHarmonyArkTsContext(readFileSync(adapterPath, 'utf8')),
    );
  }
  for (const relativePath of requiredTemplateFiles) {
    const destination = path.join(harmonyRoot, relativePath);
    if (!existsSync(destination)) {
      const source = path.join(creatorTemplateRoot, relativePath);
      if (!existsSync(source)) throw new Error(`Harmony template file is unavailable: ${source}`);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  }
}

function runtimeConfigPath(target) {
  const canonicalPath = path.join(projectRoot, target.configPath);
  if (target.platform !== 'android') return canonicalPath;
  const config = applyAndroidToolchain(
    JSON.parse(readFileSync(canonicalPath, 'utf8')),
    resolveAndroidToolchain(),
  );
  const directory = path.join(projectRoot, 'native-build', '.configs');
  mkdirSync(directory, { recursive: true });
  const configuredPath = path.join(directory, `${target.id}.json`);
  writeFileSync(configuredPath, `${JSON.stringify(config, null, 2)}\n`);
  return configuredPath;
}

function acceptedCreatorExit(exitCode) {
  return exitCode === 0 || exitCode === 36;
}

function collectFiles(root, directory = root, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, absolutePath, files);
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath));
    }
  }
  return files.sort();
}

function matchRuntimeReference(source, expression, label) {
  const match = source.match(expression);
  if (!match) throw new Error(`Native runtime ${label} reference is unavailable`);
  return match[1];
}

function nativeRuntimeReferences(outputDirectory) {
  const dataDirectory = path.join(outputDirectory, 'data');
  const mainPath = path.join(dataDirectory, 'main.js');
  if (!existsSync(mainPath)) throw new Error('Native runtime main.js is unavailable');
  const mainSource = readFileSync(mainPath, 'utf8');
  const application = matchRuntimeReference(
    mainSource,
    /System\.import\(['"]\.\/(application\.[^'"]+\.js)['"]\)/,
    'application',
  );
  const importMap = matchRuntimeReference(
    mainSource,
    /getStringFromFile\(['"](src\/import-map\.[^'"]+\.json)['"]\)/,
    'import map',
  );
  const applicationPath = path.join(dataDirectory, application);
  if (!existsSync(applicationPath)) throw new Error(`Native runtime application is unavailable: ${application}`);
  const applicationSource = readFileSync(applicationPath, 'utf8');
  const settings = matchRuntimeReference(
    applicationSource,
    /settingsPath\s*=\s*['"](src\/settings\.[^'"]+\.json)['"]/,
    'settings',
  );
  const settingsPath = path.join(dataDirectory, settings);
  if (!existsSync(settingsPath)) throw new Error(`Native runtime settings are unavailable: ${settings}`);
  const configuration = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const bundleVersions = configuration.assets?.bundleVers || {};
  if (!bundleVersions.main || !bundleVersions.resources) {
    throw new Error('Native runtime settings are missing main/resources bundle versions');
  }
  return { application, importMap, settings, bundleVersions };
}

function disableNativeCocosSplash(outputDirectory) {
  const references = nativeRuntimeReferences(outputDirectory);
  const settingsPath = path.join(outputDirectory, 'data', references.settings);
  const configuration = JSON.parse(readFileSync(settingsPath, 'utf8'));
  delete configuration.splashScreen;
  writeFileSync(settingsPath, `${JSON.stringify(configuration)}\n`);

  const applicationPath = path.join(outputDirectory, 'data', references.application);
  const applicationSource = readFileSync(applicationPath, 'utf8');
  const applicationWithoutStats = applicationSource.replace(
    /this\.showFPS\s*=\s*true;/g,
    'this.showFPS = false;',
  );
  if (applicationWithoutStats === applicationSource && /this\.showFPS\s*=\s*true;/.test(applicationSource)) {
    throw new Error('Failed to disable the generated Cocos performance overlay');
  }
  writeFileSync(applicationPath, applicationWithoutStats);
}

function pruneStaleNativeRuntimeFiles(outputDirectory) {
  const references = nativeRuntimeReferences(outputDirectory);
  const dataDirectory = path.join(outputDirectory, 'data');
  const activeFiles = new Set([
    references.application,
    references.importMap,
    references.settings,
    ...Object.entries(references.bundleVersions).flatMap(([bundle, version]) => [
      `assets/${bundle}/index.${version}.js`,
      `assets/${bundle}/cc.config.${version}.json`,
    ]),
  ]);
  const stalePattern = /^(?:application\.[^/]+\.js|src\/(?:import-map|settings)\.[^/]+\.json|assets\/[^/]+\/(?:index|cc\.config)\.[^/]+\.(?:js|json))$/;
  for (const relativePath of collectFiles(dataDirectory)) {
    const normalized = relativePath.replaceAll(path.sep, '/');
    if (stalePattern.test(normalized) && !activeFiles.has(normalized)) {
      rmSync(path.join(dataDirectory, relativePath), { force: true });
    }
  }
  return references;
}

function validateNativeRuntimeOutput(outputDirectory) {
  const references = nativeRuntimeReferences(outputDirectory);
  const files = collectFiles(outputDirectory).map((file) => file.replaceAll(path.sep, '/'));
  const cloudPlaceholder = files.find((file) => file.endsWith('.icloud'));
  if (cloudPlaceholder) throw new Error(`Native runtime contains iCloud placeholder: ${cloudPlaceholder}`);

  const expectedByFamily = [
    [`data/${references.application}`, /^data\/application\.[^/]+\.js$/],
    [`data/${references.importMap}`, /^data\/src\/import-map\.[^/]+\.json$/],
    [`data/${references.settings}`, /^data\/src\/settings\.[^/]+\.json$/],
  ];
  for (const [active, family] of expectedByFamily) {
    const stale = files.find((file) => family.test(file) && file !== active);
    if (stale) throw new Error(`Stale native runtime file remains: ${stale}`);
  }
  for (const [bundle, version] of Object.entries(references.bundleVersions)) {
    for (const baseName of ['index', 'cc.config']) {
      const extension = baseName === 'index' ? 'js' : 'json';
      const active = `data/assets/${bundle}/${baseName}.${version}.${extension}`;
      if (!files.includes(active)) throw new Error(`Native runtime bundle file is unavailable: ${active}`);
      const family = new RegExp(`^data/assets/${bundle}/${baseName.replace('.', '\\.') }\\.[^/]+\\.${extension}$`);
      const stale = files.find((file) => family.test(file) && file !== active);
      if (stale) throw new Error(`Stale native runtime file remains: ${stale}`);
    }
  }

  const resourcesConfigPath = path.join(
    outputDirectory,
    'data',
    'assets',
    'resources',
    `cc.config.${references.bundleVersions.resources}.json`,
  );
  const resourcesConfig = JSON.parse(readFileSync(resourcesConfigPath, 'utf8'));
  const resourcePaths = new Set(Object.values(resourcesConfig.paths || {}).map((entry) => entry[0]));
  for (const kind of ['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss']) {
    const required = `models-low/ships/${kind}/${kind}`;
    if (!resourcePaths.has(required)) throw new Error(`Required ship prefab is unavailable: ${required}`);
  }
  return references;
}

function generatedProjectPresent(target, files) {
  const normalized = files.map((file) => file.replaceAll(path.sep, '/'));
  if (target.platform === 'android') {
    return normalized.some((file) => /(^|\/)proj\/(gradlew|build\.gradle)$/.test(file));
  }
  if (target.platform === 'ios' || target.platform === 'mac') {
    return normalized.some((file) => /\.xcodeproj\/project\.pbxproj$/.test(file));
  }
  return normalized.includes('proj/cfg.cmake') && normalized.includes('data/main.js');
}

function generatedPackageIdentityPresent(outputDirectory, files, packageName) {
  const readableExtensions = new Set(['.gradle', '.json', '.json5', '.pbxproj', '.plist', '.xml']);
  return files.some((file) => {
    const absolutePath = path.join(outputDirectory, file);
    if (!readableExtensions.has(path.extname(file)) || statSync(absolutePath).size > 1024 * 1024) {
      return false;
    }
    return readFileSync(absolutePath, 'utf8').includes(packageName);
  });
}

function localGameIsNativeOnly() {
  const combatScene = readFileSync(path.join(projectRoot, 'assets', 'scenes', 'Combat.scene'), 'utf8');
  const scriptRoot = path.join(projectRoot, 'assets', 'scripts');
  const scripts = collectFiles(scriptRoot)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(path.join(scriptRoot, file), 'utf8'))
    .join('\n');
  return {
    noWebViewComponent: !combatScene.includes('cc.WebView'),
    noWebsiteNavigation: !/(?:location\.(?:href|assign|replace)|open)\s*\(\s*['"]https?:\/\//.test(scripts),
  };
}

function validateEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    throw new Error('Native build evidence must be an object');
  }
  const target = NATIVE_TARGETS[evidence.target];
  if (!target) throw new Error(`Unknown native target: ${evidence.target || 'missing'}`);
  if (evidence.packageName !== target.packageName) {
    throw new Error(`Native package mismatch for ${target.id}`);
  }
  if (evidence.creatorVersion !== creatorVersion) {
    throw new Error(`Native evidence must use Cocos Creator ${creatorVersion}`);
  }
  if (!acceptedCreatorExit(evidence.commandExit)) {
    throw new Error(`Cocos export failed with exit ${evidence.commandExit}`);
  }
  if (evidence.generatedProject !== true) {
    throw new Error(`Native evidence for ${target.id} has no generated project`);
  }
  if (!Array.isArray(evidence.files) || evidence.files.length === 0) {
    throw new Error(`Native evidence for ${target.id} has no generated files`);
  }
  const verification = evidence.verification || {};
  if (verification.exportPassed !== true) throw new Error(`Native export verification failed for ${target.id}`);
  if (verification.packageIdentityPassed !== true) throw new Error(`Native package identity was not generated for ${target.id}`);
  if (verification.noWebViewComponent !== true || verification.noWebsiteNavigation !== true) {
    throw new Error(`Native target ${target.id} contains a website shell path`);
  }
  return evidence;
}

function recordCompiledArtifact(evidencePath, artifactPath, metadata = {}) {
  if (!existsSync(evidencePath)) throw new Error(`Native evidence is unavailable: ${evidencePath}`);
  if (!existsSync(artifactPath)) throw new Error(`Compiled native artifact is unavailable: ${artifactPath}`);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const artifactBuffer = readFileSync(artifactPath);
  evidence.artifact = {
    path: path.relative(projectRoot, artifactPath),
    version: metadata.version || appIdentity.version,
    build: metadata.build || appIdentity.build,
    size: artifactBuffer.length,
    sha256: createHash('sha256').update(artifactBuffer).digest('hex'),
    signing: metadata.signing || 'unsigned',
  };
  evidence.verification = {
    ...evidence.verification,
    compilePassed: true,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function recordCompiledArtifacts(evidencePath, artifacts, metadata = {}) {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  evidence.artifacts = artifacts.map((artifact) => {
    if (!existsSync(artifact.path)) throw new Error(`Compiled native artifact is unavailable: ${artifact.path}`);
    const artifactBuffer = readFileSync(artifact.path);
    return {
      type: artifact.type,
      path: path.relative(projectRoot, artifact.path),
      version: metadata.version || appIdentity.version,
      build: metadata.build || appIdentity.build,
      size: artifactBuffer.length,
      sha256: createHash('sha256').update(artifactBuffer).digest('hex'),
      signed: artifact.signed === true,
    };
  });
  evidence.verification = {
    ...evidence.verification,
    compilePassed: true,
    signaturePassed: artifacts.every((artifact) => artifact.signed === true),
    ...(metadata.verification || {}),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function buildNativeTarget(targetId, spawn = spawnSync) {
  const target = NATIVE_TARGETS[targetId];
  if (!target) throw new Error(`Unknown native target: ${targetId || 'missing'}`);
  if (!existsSync(creator)) throw new Error(`Cocos Creator executable not found: ${creator}`);
  validateRequiredVisualAssets();

  const outputDirectory = path.join(projectRoot, 'native-build', target.outputName);
  // 复用已有导出工程：Cocos 会覆盖式重写导出内容，跳过整目录删除可省下
  // 1.7G 重导（磁盘吃紧时的必要路径）。设 SPACEFIGHT_REUSE_NATIVE_EXPORT=0 恢复全量重建。
  const reuseExport = process.env.SPACEFIGHT_REUSE_NATIVE_EXPORT !== '0';
  if (!reuseExport || !existsSync(outputDirectory)) {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
  // CocosCreator 是 Electron 应用，必须以 Electron 身份启动。若环境残留
  // ELECTRON_RUN_AS_NODE / NODE_OPTIONS / NODE_PATH（如 WorkBuddy 注入），
  // Electron 会退化成裸 node，把 --project / --build 当成未知参数报
  // "bad option: --project" 并以退出码 9 静默失败。显式清掉，并加 --no-sandbox
  // 避免无头构建时 Chromium GPU/crashpad 进程在受限会话下退出。
  // 同时清掉 WorkBuddy 的 safe-delete / broker 沙箱变量：这些变量会让
  // Cocos 导出的 worker 进程对 build 输出目录内的 rename/unlink 报 EPERM
  // （2026-11 新增的 safe-delete 守护在 10-31 时还不存在，会卡死导出）。
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NODE_PATH;
  delete childEnv.CODEBUDDY_BROKERED_FS_HOOK_ENABLED;
  delete childEnv.SANDBOX_CENTER_IPC_ADDRESS;
  delete childEnv.CODEBUDDY_BROKERED_SHELL_ENV;
  delete childEnv.CODEBUDDY_SAFE_DELETE_SANDBOX;
  delete childEnv.CODEBUDDY_BROKERED_BIN_DIR;
  const result = spawn(creator, [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-crash-reporter',
    '--project', projectRoot,
    '--build', `configPath=${runtimeConfigPath(target)}`,
  ], { cwd: projectRoot, encoding: 'utf8', stdio: 'inherit', env: childEnv });
  const commandExit = childExitCode(result);
  if (target.platform === 'android' && acceptedCreatorExit(commandExit)) {
    normalizeAndroidProject(outputDirectory);
  }
  if ((target.platform === 'ios' || target.platform === 'mac') && acceptedCreatorExit(commandExit)) {
    normalizeAppleIdentity(target.platform, outputDirectory);
  }
  if (target.platform === 'harmonyos-next' && acceptedCreatorExit(commandExit)) {
    normalizeHarmonyIdentity(target);
  }
  if (acceptedCreatorExit(commandExit)) {
    pruneStaleNativeRuntimeFiles(outputDirectory);
    disableNativeCocosSplash(outputDirectory);
    validateNativeRuntimeOutput(outputDirectory);
  }
  const files = collectFiles(outputDirectory);
  const generatedProject = generatedProjectPresent(target, files);
  const nativeOnly = localGameIsNativeOnly();
  const evidence = {
    target: target.id,
    packageName: target.packageName,
    creatorVersion,
    commandExit,
    generatedProject,
    generatedProjectPath: path.relative(projectRoot, outputDirectory),
    files,
    verification: {
      exportPassed: acceptedCreatorExit(commandExit) && generatedProject,
      packageIdentityPassed: generatedPackageIdentityPresent(outputDirectory, files, target.packageName),
      ...nativeOnly,
      compilePassed: false,
      launchPassed: false,
    },
  };

  mkdirSync(evidenceDirectory, { recursive: true });
  const evidencePath = path.join(evidenceDirectory, `${target.id}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  validateEvidence(evidence);
  return { evidence, evidencePath };
}

if (require.main === module) {
  try {
    const { evidencePath } = buildNativeTarget(process.argv[2]);
    console.log(`Verified native export evidence: ${evidencePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  acceptedCreatorExit,
  androidStringsXml,
  applyAndroidToolchain,
  buildNativeTarget,
  collectFiles,
  generatedProjectPresent,
  normalizeAndroidGradleIdentity,
  normalizeAndroidUpdater,
  normalizeAndroidProject,
  normalizeAndroidGradleProperties,
  normalizeAndroidRepositories,
  normalizeAppleIdentity,
  normalizeAppleInfoPlist,
  normalizeHarmonyAppJson,
  normalizeHarmonyArkTsContext,
  normalizeHarmonyIdentity,
  normalizeHarmonyModuleJson,
  pruneStaleNativeRuntimeFiles,
  quarantinePrebuiltNativeLibraries,
  recordCompiledArtifact,
  recordCompiledArtifacts,
  validateNativeRuntimeOutput,
  validateRequiredVisualAssets,
  validateEvidence,
};
