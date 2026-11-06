#!/usr/bin/env node
'use strict';

/**
 * 无损包体瘦身：合并 Cocos 纹理压缩 preset 的冗余变体。
 *
 * 背景（2026-11-04）：Cocos 3.8.8 在 Android 构建时为每张 GLB 内嵌的
 * 4096² 贴图生成 3 个 preset 变体（@7e97f / @df027 / @92111），
 * 三个都是同一张图、同一分辨率的不同编码。其中 @7e97f 体积最大，
 * 即未二次压缩的原图 —— 保留它画质不降，另外两个纯属冗余。
 * resources 与 spacefight-high 两个 bundle 各有一整套，共 18 个大 PNG。
 *
 * 做法：把 cc.config 里指向被删变体的 uuid / import hash / native hash
 * 全部改写成保留变体的值。运行时无论选哪个 preset，解析出的都是同一份
 * 最高质量原图，因此不会 404，也不需要改引擎。
 *
 * 用法：
 *   node tools/prune-duplicate-texture-variants.js [assetsDir] [--verify]
 * 默认 assetsDir = native-build/spacefight-android/data/assets
 *
 * ⚠️ 必须在「Cocos 导出完成」之后、「gradlew assembleRelease」之前执行。
 *    只跑 gradlew 不会重编 TS，也不会重新生成 data。
 */

const fs = require('node:fs');
const path = require('node:path');

const KEEP_PRESET = '7e97f';
const DROP_PRESETS = ['df027', '92111'];
const VARIANT_RE = /^(.+?)@([0-9a-f]{5})\.([0-9a-f]{5})\.png$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sizeOf(dir) {
  return walk(dir).reduce((total, file) => total + fs.statSync(file).size, 0);
}

function versionHash(list, index) {
  for (let i = 0; i + 1 < list.length; i += 2) {
    if (list[i] === index) return { at: i + 1, value: list[i + 1] };
  }
  return null;
}

function configFileOf(bundleDir) {
  return fs.readdirSync(bundleDir)
    .filter((name) => /^cc\.config\.[0-9a-f]+\.json$/.test(name))
    .map((name) => path.join(bundleDir, name))[0];
}

/** 把磁盘上的变体文件按 <uuid> 分组。 */
function variantGroups(bundleDir) {
  const nativeDir = path.join(bundleDir, 'native');
  const groups = new Map();
  for (const file of walk(nativeDir)) {
    const match = VARIANT_RE.exec(path.basename(file));
    if (!match) continue;
    const [, uuid, preset, hash] = match;
    if (preset !== KEEP_PRESET && !DROP_PRESETS.includes(preset)) continue;
    if (!groups.has(uuid)) groups.set(uuid, new Map());
    groups.get(uuid).set(preset, { file, hash });
  }
  return groups;
}

/** 校验 cc.config 里每个变体引用都还能在磁盘上找到实体文件。 */
function verifyBundleIntegrity(bundleDir) {
  const configPath = configFileOf(bundleDir);
  if (!configPath) return [];
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const nativeNames = walk(path.join(bundleDir, 'native')).map((file) => path.basename(file));
  const importNames = walk(path.join(bundleDir, 'import')).map((file) => path.basename(file));
  const missing = [];
  // 变体实体不止 .png：GLB 子资源还有 .bin / .jpg，按 <preset>.<hash> 匹配即可。
  const check = (versions, names, label) => {
    for (let i = 0; i + 1 < versions.length; i += 2) {
      const uuidText = config.uuids[versions[i]];
      const hash = versions[i + 1];
      if (typeof uuidText !== 'string' || !uuidText.includes('@')) continue;
      const preset = uuidText.slice(uuidText.lastIndexOf('@') + 1);
      const found = names.some((name) => name.includes(`@${preset}.`)
        && name.includes(`.${hash}.`));
      if (!found) missing.push(`${label}: ${uuidText} (hash ${hash})`);
    }
  };
  check(config.versions?.native || [], nativeNames, 'native');
  check(config.versions?.import || [], importNames, 'import');
  return missing;
}

function pruneBundle(bundleDir, { verifyOnly }) {
  const configPath = configFileOf(bundleDir);
  if (!configPath) return { changed: 0, freed: 0, errors: [] };
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const uuids = config.uuids;
  const importVersions = config.versions?.import || [];
  const nativeVersions = config.versions?.native || [];
  const groups = variantGroups(bundleDir);
  const errors = [];
  let changed = 0;
  let freed = 0;

  for (const [uuid, presets] of groups) {
    const keep = presets.get(KEEP_PRESET);
    if (!keep) {
      errors.push(`${uuid}: 缺少保留变体 @${KEEP_PRESET}，跳过以免破坏引用`);
      continue;
    }
    // 用 native hash + preset 后缀在 config 里定位索引（hash 可能重复，故两个条件一起用）。
    const findIndex = (hash, preset) => {
      for (let i = 0; i + 1 < nativeVersions.length; i += 2) {
        const idx = nativeVersions[i];
        if (nativeVersions[i + 1] !== hash) continue;
        const uuidText = uuids[idx];
        if (typeof uuidText === 'string' && uuidText.endsWith(`@${preset}`)) return idx;
      }
      return -1;
    };
    const keepIndex = findIndex(keep.hash, KEEP_PRESET);
    if (keepIndex < 0) {
      errors.push(`${uuid}: config 中找不到 @${KEEP_PRESET} 的引用索引，跳过`);
      continue;
    }
    const keepImport = versionHash(importVersions, keepIndex);

    for (const preset of DROP_PRESETS) {
      const drop = presets.get(preset);
      if (!drop) continue;
      const dropIndex = findIndex(drop.hash, preset);
      if (dropIndex < 0) {
        errors.push(`${uuid}: config 中找不到 @${preset} 的引用索引，保留实体文件`);
        continue;
      }
      if (verifyOnly) {
        errors.push(`${uuid}: 仍存在冗余变体 @${preset}`);
        continue;
      }
      // 三个 preset 统一指向最高质量原图。
      uuids[dropIndex] = uuids[keepIndex];
      const dropImport = versionHash(importVersions, dropIndex);
      if (dropImport && keepImport) importVersions[dropImport.at] = keepImport.value;
      const dropNative = versionHash(nativeVersions, dropIndex);
      if (dropNative) nativeVersions[dropNative.at] = keep.hash;

      // 删除实体 PNG 与它对应的 import json（config 已不再引用）。
      for (const candidate of [drop.file, path.join(
        bundleDir, 'import', path.basename(path.dirname(drop.file)),
        path.basename(drop.file).replace(/\.png$/, `.${dropImport?.value || ''}.json`),
      )]) {
        if (fs.existsSync(candidate)) {
          freed += fs.statSync(candidate).size;
          fs.unlinkSync(candidate);
        }
      }
      // 通用兜底：扫描 import 目录里同 uuid + preset 的 json。
      const importDir = path.join(bundleDir, 'import');
      for (const file of walk(importDir)) {
        if (path.basename(file).includes(`@${preset}.`) && path.basename(file).startsWith(uuid)) {
          freed += fs.statSync(file).size;
          fs.unlinkSync(file);
        }
      }
      changed += 1;
    }
  }

  if (!verifyOnly && changed > 0) {
    fs.writeFileSync(configPath, JSON.stringify(config));
  }
  return { changed, freed, errors };
}

function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify');
  const explicit = args.find((arg) => !arg.startsWith('--'));
  const assetsDir = path.resolve(explicit || path.join(
    __dirname, '..', 'native-build', 'spacefight-android', 'data', 'assets',
  ));
  if (!fs.existsSync(assetsDir)) {
    console.error(`assetsDir 不存在: ${assetsDir}`);
    process.exit(2);
  }
  const bundles = fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(assetsDir, entry.name));
  const before = sizeOf(assetsDir);
  let changed = 0;
  let freed = 0;
  const errors = [];
  for (const bundle of bundles) {
    const result = pruneBundle(bundle, { verifyOnly });
    changed += result.changed;
    freed += result.freed;
    errors.push(...result.errors.map((message) => `${path.basename(bundle)}: ${message}`));
    if (verifyOnly) {
      for (const message of verifyBundleIntegrity(bundle)) {
        errors.push(`${path.basename(bundle)}: 引用缺失 ${message}`);
      }
    }
  }
  const after = sizeOf(assetsDir);
  console.log(JSON.stringify({
    assetsDir,
    verifyOnly,
    prunedVariants: changed,
    bytesOnDiskBefore: before,
    bytesOnDiskAfter: after,
    bytesFreed: before - after,
    errors,
  }, null, 2));
  if (!verifyOnly && errors.length > 0) process.exitCode = 1;
  if (verifyOnly && (errors.length > 0 || changed > 0)) process.exitCode = 1;
}

main();
