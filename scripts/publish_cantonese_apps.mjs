import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const website = path.join(root, 'website');
const appsDir = path.join(website, 'api', 'apps');
const lessonsSource = path.join(website, 'cantonese.zhengzhengstudio.cn', 'data', 'lessons.json');
const version = process.argv[2] || '0.1.0';
const build = Number(process.argv[3] || 1);
const harmonySigning = process.argv[4] || 'unsigned';
const now = new Date().toISOString();
const icon = '/cantonese.zhengzhengstudio.cn/assets/icon.svg';
const notes = [
  '0.1.1 已把 Android、iOS、macOS 和 HarmonyOS 学习界面全部改为原生组件，不再使用内嵌浏览器。',
  '支持原生课程切换、粤语词句、粤拼、释义与上下句导航。',
  '联网版自动检查 manifest；Android 与 macOS 下载到 Downloads 后调用系统安装入口，iOS 使用系统支持的安装清单。',
  '单机版内置完整课程，不依赖服务器、不检查站外更新，适合应用商店分发。'
];

for (const target of [
  path.join(appsDir, 'cantonese-lessons.json'),
  path.join(website, 'zhengzhengstudio.cn', 'api', 'apps', 'cantonese-lessons.json')
]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(lessonsSource, target);
}

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(appsDir, file))).digest('hex');
const size = file => fs.statSync(path.join(appsDir, file)).size;
const harmonyFiles = [
  `Cantonese-HarmonyOS-v${version}-b${build}-${harmonySigning}.hap`,
  `CantoneseOffline-HarmonyOS-v${version}-b${build}-${harmonySigning}.hap`,
  `Cantonese-HarmonyOS-v${version}-b${build}-${harmonySigning}.app`,
  `CantoneseOffline-HarmonyOS-v${version}-b${build}-${harmonySigning}.app`
];
const packageEntry = ({ id, name, platform, variant, file, latest, bundle, min, installURL = '', artifactType = 'package', signed = true, storeReady = true }) => ({
  id, name, platform, platformLabel: platform === 'macos' ? 'macOS' : platform === 'ios' ? 'iOS' : platform === 'harmonyos' ? 'HarmonyOS' : 'Android',
  variant, variantLabel: variant === 'online' ? '联网版' : '单机版', kind: 'package',
  artifactType, signed, storeReady,
  product: 'cantonese', version, latestVersion: version, versionName: version, build, versionCode: build,
  fileName: file, url: `/api/apps/download/${file}`, latestUrl: `/api/apps/download/${latest}`, versionedUrl: `/api/apps/download/${file}`,
  downloadURL: `/api/apps/download/${file}`, installURL, bundleIdentifier: bundle,
  minimumSystem: min, minSystem: min, pageURL: 'https://cantonese.zhengzhengstudio.cn/',
  category: '语言学习', icon, notes, remarks: variant === 'online'
    ? '原生 App 连接粤语学堂服务器，支持在线课程与版本更新。'
    : '原生 App 直接读取安装包内课程，无需网络，适合商店上架。',
  title: `${name} v${version} build ${build}`, size: size(file), fileSize: size(file),
  sha256: sha(file), checksum: sha(file), updatedAt: now
});

const entries = [
  {
    id: 'cantonese-web', name: '粤语学堂 Web', platform: 'web', platformLabel: 'Web', variant: 'online',
    variantLabel: '联网版', kind: 'web', product: 'cantonese', version, latestVersion: version, versionName: version,
    build, versionCode: build, fileName: '', url: 'https://cantonese.zhengzhengstudio.cn/',
    versionedUrl: 'https://cantonese.zhengzhengstudio.cn/', downloadURL: '', pageURL: 'https://cantonese.zhengzhengstudio.cn/',
    minimumSystem: '现代浏览器', minSystem: '现代浏览器', category: '语言学习', icon, notes,
    remarks: '可安装 PWA，支持离线课程、粤拼、发音、练习与本地进度。', title: `粤语学堂 Web v${version} build ${build}`,
    size: 0, fileSize: 0, sha256: '', checksum: '', updatedAt: now
  },
  packageEntry({ id:'cantonese-android-online', name:'粤语学堂 Android 联网版', platform:'android', variant:'online', file:`Cantonese-Android-v${version}-b${build}.apk`, latest:'Cantonese-Android-latest.apk', bundle:'cn.zhengzhengstudio.cantonese', min:'Android 8.0' }),
  packageEntry({ id:'cantonese-android-offline', name:'粤语学堂 Android 单机版', platform:'android', variant:'offline', file:`CantoneseOffline-Android-v${version}-b${build}.apk`, latest:'CantoneseOffline-Android-latest.apk', bundle:'cn.zhengzhengstudio.cantonese.offline', min:'Android 8.0' }),
  packageEntry({ id:'cantonese-ios-online', name:'粤语学堂 iOS 联网版', platform:'ios', variant:'online', file:`Cantonese-iOS-v${version}-b${build}-unsigned.ipa`, latest:'Cantonese-iOS-latest-unsigned.ipa', bundle:'cn.zhengzhengstudio.cantonese', min:'iOS 16.0', installURL:'/api/apps/Cantonese-iOS-install.plist' }),
  packageEntry({ id:'cantonese-ios-offline', name:'粤语学堂 iOS 单机版', platform:'ios', variant:'offline', file:`CantoneseOffline-iOS-v${version}-b${build}-unsigned.ipa`, latest:'CantoneseOffline-iOS-latest-unsigned.ipa', bundle:'cn.zhengzhengstudio.cantonese.offline', min:'iOS 16.0', installURL:'/api/apps/CantoneseOffline-iOS-install.plist' }),
  packageEntry({ id:'cantonese-macos-online', name:'粤语学堂 macOS 联网版', platform:'macos', variant:'online', file:`Cantonese-macOS-v${version}-b${build}.dmg`, latest:'Cantonese-macOS-latest.dmg', bundle:'cn.zhengzhengstudio.cantonese', min:'macOS 12.0' }),
  packageEntry({ id:'cantonese-macos-offline', name:'粤语学堂 macOS 单机版', platform:'macos', variant:'offline', file:`CantoneseOffline-macOS-v${version}-b${build}.dmg`, latest:'CantoneseOffline-macOS-latest.dmg', bundle:'cn.zhengzhengstudio.cantonese.offline', min:'macOS 12.0' }),
  ...(harmonyFiles.every(file => fs.existsSync(path.join(appsDir, file))) ? [
    packageEntry({ id:'cantonese-harmonyos-online', name:'粤语学堂 HarmonyOS 联网版 HAP', platform:'harmonyos', variant:'online', file:harmonyFiles[0], latest:`Cantonese-HarmonyOS-latest-${harmonySigning}.hap`, bundle:'cn.zhengzhengstudio.cantonese.hmos', min:'HarmonyOS 6.0.2', artifactType:'hap', signed:harmonySigning === 'signed', storeReady:false }),
    packageEntry({ id:'cantonese-harmonyos-offline', name:'粤语学堂 HarmonyOS 单机版 HAP', platform:'harmonyos', variant:'offline', file:harmonyFiles[1], latest:`CantoneseOffline-HarmonyOS-latest-${harmonySigning}.hap`, bundle:'cn.zhengzhengstudio.cantonese.offline.hmos', min:'HarmonyOS 6.0.2', artifactType:'hap', signed:harmonySigning === 'signed', storeReady:false }),
    packageEntry({ id:'cantonese-harmonyos-online-app', name:'粤语学堂 HarmonyOS 联网版 APP 上架包', platform:'harmonyos', variant:'online', file:harmonyFiles[2], latest:`Cantonese-HarmonyOS-latest-${harmonySigning}.app`, bundle:'cn.zhengzhengstudio.cantonese.hmos', min:'HarmonyOS 6.0.2', artifactType:'app', signed:harmonySigning === 'signed', storeReady:harmonySigning === 'signed' }),
    packageEntry({ id:'cantonese-harmonyos-offline-app', name:'粤语学堂 HarmonyOS 单机版 APP 上架包', platform:'harmonyos', variant:'offline', file:harmonyFiles[3], latest:`CantoneseOffline-HarmonyOS-latest-${harmonySigning}.app`, bundle:'cn.zhengzhengstudio.cantonese.offline.hmos', min:'HarmonyOS 6.0.2', artifactType:'app', signed:harmonySigning === 'signed', storeReady:harmonySigning === 'signed' })
  ] : [])
];

function updateManifest(file, selectedEntries = entries) {
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schemaVersion: 1, channel: 'stable', apps: [] };
  const ids = new Set(selectedEntries.map(entry => entry.id));
  current.apps = [...selectedEntries, ...(current.apps || []).filter(entry => !ids.has(entry.id))];
  current.updatedAt = now;
  current.generatedAt = now;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

updateManifest(path.join(appsDir, 'manifest.json'));
updateManifest(path.join(appsDir, 'client-downloads.json'));
updateManifest(path.join(website, 'zhengzhengstudio.cn', 'api', 'apps', 'manifest.json'));
updateManifest(path.join(website, 'zhengzhengstudio.cn', 'api', 'apps', 'client-downloads.json'));
updateManifest(path.join(website, 'zhengzhengstudio.cn', 'manager_portal', 'apps.json'), entries.filter(entry => entry.kind === 'package'));

console.log(`Published ${entries.length} Cantonese download entries.`);
