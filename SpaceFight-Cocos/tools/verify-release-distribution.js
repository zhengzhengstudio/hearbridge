#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validateDistributionRoots,
  validateOfflineHarmonyModule,
} = require('./release-distribution-policy');

const repositoryRoot = path.resolve(__dirname, '../..');
const appRoots = [
  path.join(repositoryRoot, 'website/api/apps'),
  path.join(repositoryRoot, 'website/zhengzhengstudio.cn/api/apps'),
];
const offlineModule = path.join(
  repositoryRoot,
  'SpaceFight-Cocos/native/engine/harmonyos-next/entry/src/main/module.json5',
);

try {
  const result = validateDistributionRoots(appRoots, {
    checksums: process.argv.includes('--checksums'),
  });
  const permissions = validateOfflineHarmonyModule(fs.readFileSync(offlineModule, 'utf8'));
  process.stdout.write(
    `SpaceFight distribution verified: ${result.entries.length} releases, ${result.roots.length} roots, `
      + `offline permissions [${permissions.join(', ')}]\n`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
