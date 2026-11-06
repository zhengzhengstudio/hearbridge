'use strict';

const { existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const creator = process.env.COCOS_CREATOR_BIN
  || '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator';
const configPath = path.join(projectRoot, 'config', 'build-web-release.json');

if (!existsSync(creator)) {
  process.stderr.write(`Cocos Creator executable not found: ${creator}\n`);
  process.exit(1);
}

// CocosCreator 是个 Electron 应用，必须以 Electron 身份启动。
// 若环境里残留 ELECTRON_RUN_AS_NODE / NODE_OPTIONS，Electron 会退化成裸 node，
// 于是 --project / --build 被当成 node 的未知参数，报 "bad option: --project"
// 并以退出码 9 静默失败。这里显式清掉，避免把 20 分钟的构建变成 1 秒失败。
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.NODE_OPTIONS;
delete childEnv.NODE_PATH;

// Cocos 自带的 Electron 还会再套一层 Chromium sandbox，在受限环境（CI、受管
// 沙箱、非交互会话）下会因无法写 ~/Library/Application Support/CocosCreator 的
// crashpad/blob_storage 而 GPU 进程直接退出：
//   "sandbox initialization failed: Operation not permitted"
//   "GPU process isn't usable. Goodbye."
// 加 --no-sandbox 关掉这层；无头构建不需要 GPU。
const result = spawnSync(creator, [
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--disable-crash-reporter',
  '--project', projectRoot,
  '--build', `configPath=${configPath}`,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: 'inherit',
  env: childEnv,
});

// Cocos Creator documents exit code 36 as a successful command-line build.
if (result.status !== 0 && result.status !== 36) {
  process.exit(result.status || 1);
}

const sourceDirectory = path.join(projectRoot, 'release', 'web-desktop', 'src');
const settingsFile = readdirSync(sourceDirectory).find((file) => /^settings\.[^.]+\.json$/.test(file));
if (!settingsFile) {
  process.stderr.write('Generated web settings file is unavailable\n');
  process.exit(1);
}
const settingsPath = path.join(sourceDirectory, settingsFile);
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
delete settings.splashScreen;
writeFileSync(settingsPath, `${JSON.stringify(settings)}\n`);
