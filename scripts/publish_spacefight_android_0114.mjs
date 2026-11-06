import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.11.4';
const build = 48;
const size = 57_132_610;
const sha256 = '75d7fed0930151b190aa5fbde04729a782aec6e8050ed232e55ca9eff4366d92';
const source = path.join(root, `SpaceFight-Cocos/native-build/artifacts/SpaceFight-Android-v${version}.apk`);
const versionedName = `SpaceFight-Android-v${version}.apk`;
const latestName = 'SpaceFight-Android-latest.apk';
const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];
const metadataNames = ['manifest.json', 'client-downloads.json'];
const now = new Date();
const iso = now.toISOString();
const localIso = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(now).replace(' ', 'T') + '+08:00';

const notes = [
  `${version} build ${build}：修复短横屏手机前哨大厅、设置页和装配台越界，底部操作不再穿出屏幕。`,
  '船内视角固定到 GLB 船舱相机挂点并跟随机体姿态，瞄准移动不再拖走整套船舱视角。',
  '六类低配和高配战机 GLB 加入真实网格装甲、武器舱、引擎与皮肤材质节点；敌机波次扩充为侦察机、战斗机、轰炸机、炮艇和首领。',
  '开放战区加入货运中继、跃迁环、导航信标和残骸设施，低配模式每区块仅启用一种设施。',
  '联机保持 30Hz 模拟并以 20Hz 发送快照，加入输入序列确认和插值元数据；旧客户端保持兼容。',
  '应用展示名恢复为 SpaceFight；Release APK 已完成包名、版本、arm64、V1/V2/V3 签名、证书连续性和包内内容检查。Windows 在线但 ADB 未连接设备，本批次未完成设备运行验证。',
];

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

if (!fs.existsSync(source)) throw new Error(`Missing Android release: ${source}`);
if (fs.statSync(source).size !== size) throw new Error(`Unexpected Android release size: ${fs.statSync(source).size}`);
if (digest(source) !== sha256) throw new Error(`Unexpected Android release SHA-256: ${digest(source)}`);

for (const appRoot of appRoots) {
  fs.copyFileSync(source, path.join(appRoot, versionedName));
  fs.copyFileSync(source, path.join(appRoot, latestName));
  for (const metadataName of metadataNames) {
    const file = path.join(appRoot, metadataName);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entry = document.apps.find((candidate) => candidate.id === 'spacefight-android');
    if (!entry) throw new Error(`Missing spacefight-android in ${file}`);
    document.updatedAt = localIso;
    document.generatedAt = localIso;
    Object.assign(entry, {
      version, latestVersion: version, versionName: version, build, versionCode: build,
      artifactType: 'apk', fileName: versionedName,
      url: `/api/apps/${latestName}`, latestUrl: `/api/apps/${latestName}`,
      versionedUrl: `/api/apps/${versionedName}`,
      downloadURL: `/api/apps/${versionedName}`,
      title: `SpaceFight Android v${version} build ${build}`,
      description: 'Cocos Creator 原生横屏空战客户端，包含响应式前哨、固定船舱视角、完整装配、开放战区和应用内更新。',
      remarks: 'Release APK；沿用既有证书，应用内多线程下载更新，不跳转浏览器。',
      notes, size, fileSize: size, sha256, checksum: sha256, updatedAt: iso,
      verificationStatus: 'not-device-tested', deviceTested: false,
      verificationNote: 'Windows 在线但 ADB 未连接设备，未完成设备运行验证',
    });
    writeJson(file, document);
  }
}

const changelogEntry = {
  id: '2026-08-30-spacefight-0114-android-release',
  date: localIso,
  type: 'release',
  product: 'SpaceFight',
  title: 'SpaceFight Android 0.11.4：横屏布局、船舱视角与战区扩充',
  content: 'SpaceFight Android 更新至 0.11.4 build 48。修复短横屏前哨、设置和装配台越界；船内视角固定到 GLB 相机挂点。十二套正式 GLB 加入真实网格细节和皮肤材质节点，战斗波次加入五档敌机，开放战区新增货运中继、跃迁环、导航信标和残骸设施。联机快照降至 20Hz 并加入输入确认。应用展示名恢复为 SpaceFight。APK 已完成版本、arm64、V1/V2/V3 签名、证书和包内内容检查；Windows 在线但 ADB 未连接设备，本批次未完成设备运行验证。',
  version,
  build,
  platforms: ['android'],
};

for (const file of [
  path.join(root, 'website/api/data/changelogs.json'),
  path.join(root, 'website/zhengzhengstudio.cn/api/changelogs.json'),
]) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const existing = document.findIndex((entry) => entry.id === changelogEntry.id);
  if (existing >= 0) document.splice(existing, 1);
  document.unshift(changelogEntry);
  writeJson(file, document);
}

process.stdout.write(`Published SpaceFight Android ${version} build ${build} to both download roots.\n`);
