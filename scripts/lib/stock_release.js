const STOCK_IDS = {
  android: 'cn.zhengzhengstudio.stock',
  harmonyos: 'cn.zhengzhengstudio.stock.harmony',
};

const PLATFORM_LABELS = {
  android: 'Android',
  harmonyos: 'HarmonyOS',
};

function releaseNotes(version, platform) {
  return [
    `${version}：原生端接入服务器行情，真实优先、真实+仿真和纯仿真三种模式可随时切换。`,
    '服务器不可用或闭市时自动转入本地连续演算，行情列表保持更新。',
    'A股覆盖 520 只股票并包含上证指数，港股和美股使用独立账户，同一通行证统一绑定。',
    `${PLATFORM_LABELS[platform]} 交易台重做为紧凑专业行情界面，修复窄屏拥挤、暗色模式和状态反馈。`,
    '修复服务器行情 JSON 代理偶发截断；格式异常时明确提示并自动回退本地连续仿真。',
    '保留应用内检查更新与安装入口，全程使用原生页面。',
  ];
}

function updateStockReleaseEntry(document, artifact) {
  const id = STOCK_IDS[artifact.platform];
  if (!id) throw new Error(`Unsupported stock platform: ${artifact.platform}`);
  const apps = document.apps || (document.apps = []);
  const entry = apps.find((candidate) => candidate.id === id && candidate.platform === artifact.platform);
  if (!entry) throw new Error(`Missing ${id}/${artifact.platform} release entry`);
  const notes = releaseNotes(artifact.version, artifact.platform);
  Object.assign(entry, {
    version: artifact.version,
    versionName: artifact.version,
    latestVersion: artifact.version,
    build: artifact.build,
    versionCode: artifact.build,
    fileName: artifact.fileName,
    url: `/api/apps/${artifact.latestName}`,
    latestUrl: `/api/apps/${artifact.latestName}`,
    versionedUrl: `/api/apps/${artifact.fileName}`,
    downloadURL: `/api/apps/${artifact.fileName}`,
    size: artifact.size,
    fileSize: artifact.size,
    sha256: artifact.sha256,
    checksum: artifact.sha256,
    updatedAt: artifact.updatedAt,
    title: `铮铮模拟炒股 ${PLATFORM_LABELS[artifact.platform]} v${artifact.version}`,
    remarks: artifact.platform === 'android'
      ? '原生 Android 可安装测试包，服务器行情与本地连续仿真自动切换。'
      : '原生 HarmonyOS 未签名开发包，服务器行情与本地连续仿真自动切换。',
    notes,
  });
  document.updatedAt = artifact.updatedAt;
  document.generatedAt = artifact.updatedAt;
  return entry;
}

module.exports = { releaseNotes, updateStockReleaseEntry };
