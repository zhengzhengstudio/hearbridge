#!/usr/bin/env node

'use strict';

/**
 * 把 SpaceFight 网页版条目同步到当前 Cocos release 版本。
 *
 * 背景：`publish_spacefight_harmony_offline.js` 只负责鸿蒙/Android 包，
 * 网页版条目是手写并**长期滞留**在旧版本——2026-10-11 网页版已实际发布
 * 0.12.0/63，manifest 里却还写着 0.11.18/62。
 *
 * 危害：官网「检查更新」和任何读 manifest 判断新版的逻辑都会拿到错误答案，
 * 且因为网页版没有安装包（url 指向线上站点），**不会有任何报错提示**——
 * 属于典型的静默不一致。
 *
 * 版本号仍以 `SpaceFight-Cocos/package.json` 为唯一来源，
 * 网页版的 `index.html` 里 BUILD 号也由同一个 package.json 渲染，两者天然一致。
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'SpaceFight-Cocos/package.json'), 'utf8'),
);
const version = pkg.version;
const build = pkg.build;

const appRoots = [
  path.join(root, 'website/api/apps'),
  path.join(root, 'website/zhengzhengstudio.cn/api/apps'),
];

const notes = [
  `${version} build ${build}：飞行手感改为「速度一阶收敛」——推油门逐渐加速，松手沿当前朝向自然滑行后停住，不再像在冰面上滑。`,
  '受击新增短暂无敌帧，并在同一步内累积伤害后统一结算：同一梭子齐射不会瞬间清空血量，跨帧的持续伤害依然有效。',
  '修复启动卡在「正在初始化」：战斗引导改用真实存在的接口，并补齐跨模块调用与联机主机状态的契约测试。',
  '模型资源加载改为后台补载，资源异常时保留轻量占位机体，不阻塞输入、准星和开火反馈。',
  '网页端同步当前战斗、输入、模型和资源改动，保留横屏、鼠标锁定、触屏摇杆和手柄支持。',
];

const updatedAt = new Date().toISOString();

for (const appRoot of appRoots) {
  for (const fileName of ['manifest.json', 'client-downloads.json']) {
    const file = path.join(appRoot, fileName);
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    let touched = false;
    for (const entry of metadata.apps || []) {
      if (entry.id !== 'spacefight-web') continue;
      entry.version = version;
      entry.latestVersion = version;
      entry.versionName = version;
      entry.build = build;
      entry.versionCode = build;
      entry.title = `SpaceFight Web v${version} build ${build}`;
      entry.notes = notes;
      entry.updatedAt = updatedAt;
      touched = true;
    }
    if (!touched) {
      process.stderr.write(`未在 ${file} 找到 spacefight-web 条目，已跳过。\n`);
      continue;
    }
    metadata.updatedAt = updatedAt;
    metadata.generatedAt = updatedAt;
    fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
    process.stdout.write(`已更新 ${path.relative(root, file)} 的 spacefight-web → ${version}/${build}\n`);
  }
}
