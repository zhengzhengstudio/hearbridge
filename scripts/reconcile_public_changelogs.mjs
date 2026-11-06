import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'website');
const files = [
  path.join(root, 'api', 'data', 'changelogs.json'),
  path.join(root, 'zhengzhengstudio.cn', 'api', 'changelogs.json')
];
const sources = files.map(file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
const byId = new Map();
for (const item of sources.flat()) {
  if (item && item.id && !byId.has(item.id)) byId.set(item.id, item);
}

const release = {
  id: '2026-07-28-cantonese-course-api-loading-fix-0-1-2',
  date: '2026-07-28T17:20:00+08:00',
  type: 'fix',
  product: '粤语学堂',
  title: '粤语学堂 0.1.2：修复联网 App 课程加载失败',
  content: '已完成：\n- 定位到 cantonese 子域的 Cloudflare Tunnel 公网连接仍运行旧版服务，课程 JSON 请求返回 404 HTML，导致原生 App JSON 解码失败。\n- 课程数据已发布到稳定的 https://zhengzhengstudio.cn/api/apps/cantonese-lessons.json 公共端点，并验证公网返回 200 与完整 JSON。\n- Android、iOS、macOS、HarmonyOS 联网版和网页加载器已统一切换至新端点。\n- 版本提升至 0.1.2 build 4，并重新生成联网版、单机版与 HarmonyOS HAP/APP 产物。\n- manifest、client-downloads、manager apps、文件大小、SHA-256 与更新日志已同步。'
};
byId.set(release.id, release);

const dateValue = item => {
  const value = Date.parse(item.date || '');
  return Number.isFinite(value) ? value : 0;
};
const merged = [...byId.values()].sort((a, b) => dateValue(b) - dateValue(a) || String(b.id).localeCompare(String(a.id)));
for (const file of files) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`Reconciled ${merged.length} public changelog entries across ${files.length} files.`);
