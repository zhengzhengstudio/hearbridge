'use strict';

const {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const releaseRoot = path.join(projectRoot, 'release', 'web-desktop');
const websiteRoot = path.join(repositoryRoot, 'website', 'spacefight.zhengzhengstudio.cn');
const websiteAssets = path.join(websiteRoot, 'assets');
const websiteStore = path.join(websiteAssets, 'store');
const websiteModels = path.join(websiteAssets, 'models');
const approvedShipModels = path.join(
  projectRoot,
  'assets',
  'spacefight-high',
  'models',
  'ships',
);
const fallbackShipModels = path.join(
  projectRoot,
  'assets',
  'resources',
  'models-low',
  'ships',
);
const shipModelNames = ['interceptor', 'scout', 'fighter', 'bomber', 'gunship', 'boss'];
const promoSource = path.join(
  repositoryRoot,
  'apps',
  'build_output',
  'SpaceFight',
  'marketing',
  'SpaceFight-HarmonyOS-Offline-promo-1920x1080.png',
);

function removeCloudAndConflictCopies(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    const stats = statSync(target);
    if (stats.isDirectory()) {
      removeCloudAndConflictCopies(target);
      continue;
    }
    if (entry.endsWith('.icloud') || / \d+\.[^.]+$/.test(entry)) {
      rmSync(target, { force: true });
    }
  }
}

if (!existsSync(path.join(releaseRoot, 'index.html'))) {
  throw new Error('Run npm run build:web:release before publishing the web release.');
}

const shipModelSources = new Map(shipModelNames.map((modelName) => {
  const approved = path.join(approvedShipModels, `${modelName}.glb`);
  const fallback = path.join(fallbackShipModels, `${modelName}.glb`);
  if (existsSync(approved)) return [modelName, approved];
  if (existsSync(fallback)) {
    process.stdout.write(`Using verified low-spec website model for ${modelName}; high-spec source is unavailable.\n`);
    return [modelName, fallback];
  }
  throw new Error(`Missing website ship model: ${approved} and ${fallback}`);
}));

mkdirSync(websiteRoot, { recursive: true });
for (const entry of readdirSync(websiteRoot)) {
  if (entry === 'server' || entry === 'assets') continue;
  rmSync(path.join(websiteRoot, entry), { recursive: true, force: true });
}

mkdirSync(websiteAssets, { recursive: true });
for (const entry of readdirSync(websiteAssets)) {
  if (entry === 'store') continue;
  rmSync(path.join(websiteAssets, entry), { recursive: true, force: true });
}

cpSync(releaseRoot, websiteRoot, { recursive: true });
removeCloudAndConflictCopies(websiteRoot);

const projectMetadata = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const publishedIndex = path.join(websiteRoot, 'index.html');
const versionedIndex = readFileSync(publishedIndex, 'utf8')
  .replaceAll('__SPACEFIGHT_VERSION__', String(projectMetadata.version))
  .replaceAll('__SPACEFIGHT_BUILD__', String(projectMetadata.build))
  .replace(/(class="build-readout"[^>]*><i><\/i> 本机战斗核心 <b>)[^<]+/, `$1${projectMetadata.version}`)
  .replace(/(<span>BUILD )[0-9]+(<\/span>)/, `$1${projectMetadata.build}$2`);
writeFileSync(publishedIndex, versionedIndex);

mkdirSync(websiteModels, { recursive: true });
for (const modelName of shipModelNames) {
  copyFileSync(
    shipModelSources.get(modelName),
    path.join(websiteModels, `${modelName}.glb`),
  );
}

if (existsSync(promoSource)) {
  mkdirSync(websiteStore, { recursive: true });
  copyFileSync(
    promoSource,
    path.join(websiteStore, 'spacefight-harmonyos-offline-promo-1920x1080.png'),
  );
}

process.stdout.write(`Published SpaceFight web release to ${websiteRoot}\n`);
