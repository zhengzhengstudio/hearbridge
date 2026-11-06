const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'sync_to_termux.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'website/api/server.js'), 'utf8');

test('Termux watch accepts every published package type under api/apps', () => {
  for (const extension of ['.apk', '.app', '.hap', '.ipa', '.dmg', '.pkg', '.zip']) {
    assert.match(client, new RegExp(`['"]${extension.replace('.', '\\.')}['"]`));
  }
  assert.match(client, /manifest\.json[\s\S]*client-downloads\.json[\s\S]*同步引用安装包/);
  assert.match(client, /APP_DISTRIBUTION_SEGMENT_PATTERN/);
  assert.match(client, /isAppDistributionPath\(relativePath\)/);
  assert.match(client, /isBlockedAppPackagePath\(relativePath\)/);
  assert.match(client, /citiescapes/);
});

test('large packages use authenticated chunk upload on both sides', () => {
  assert.match(client, /\/api\/internal\/sync-file-chunk/);
  assert.match(client, /fs\.readSync\(handle/);
  assert.match(client, /markPackageSynced\(normalizeSyncPath\(relativePath\)/);
  assert.match(server, /app\.post\('\/api\/internal\/sync-file-chunk'/);
  assert.match(server, /secret !== SYNC_SECRET/);
  assert.match(server, /FILE_SYNC_CHUNK_ROOT/);
  assert.match(server, /fs\.move\(tempTarget, targetPath, \{ overwrite: true \}\)/);
  assert.match(client, /shouldSkipSyncedPackage\(relativePath, fullLocalPath\)/);
  assert.doesNotMatch(client, /APK_MAX_SIZE|APK 超过 100MB/);
  assert.match(client, /timeout: isHttps \? 180000 : 120000/);
  assert.match(client, /force: isAppPackagePath\(relativePath\)/);
  assert.match(client, /分块接口暂不可用，切换目标或稍后重试/);
  assert.doesNotMatch(client, /分块接口不可用，尝试普通同步/);
});

test('package fingerprint recording tolerates files replaced after upload', () => {
  assert.match(client, /const packageFingerprint = isPackage \? capturePackageFingerprint\(fullLocalPath\) : null/);
  assert.match(client, /markPackageSynced\(normalizeSyncPath\(relativePath\), fullLocalPath, packageFingerprint\)/);
  assert.match(client, /if \(ok\?\.sourceChanged\) return true/);
  assert.match(client, /if \(bytesRead !== length\)/);
  assert.match(client, /\[\u5df2变动\].*\u7b49待 watch 下一轮/);
});

test('package cache skips only after the current remote target confirms the file', () => {
  assert.match(client, /async function verifyRemotePackage\(relativePath, fullLocalPath\)/);
  assert.match(client, /method: 'HEAD'/);
  assert.match(client, /res\.statusCode === 200 && remoteSize === expectedSize/);
  assert.match(client, /await verifyRemotePackage\(relativePath, fullLocalPath\)/);
  assert.match(client, /当前目标缺失或大小不一致/);
});

test('manifest referenced packages cannot bypass remote verification through the local cache', () => {
  const manifestBranch = client.match(/for \(const appPath of appPaths\)[\s\S]*?\n\s*}\n\s*}\s*catch/)?.[0] || '';
  assert.match(manifestBranch, /await syncFile\(appRelPath, appFullPath, 2\)/);
  assert.doesNotMatch(manifestBranch, /shouldSkipSyncedPackage\(appRelPath, appFullPath\)/);
});

test('package upload path does not reference a removed APK-only flag', () => {
  assert.match(client, /const isPackage = isAppPackagePath\(relativePath\)/);
  assert.doesNotMatch(client, /\bisApk\b/);
});

test('chunk endpoint bypasses ordinary rate limiting only after secret validation', () => {
  assert.match(server, /req\.path === '\/api\/internal\/sync-file-chunk'/);
  assert.match(server, /req\.body\?\.secret === SYNC_SECRET/);
  assert.match(server, /targetPath !== FILE_SYNC_ROOT && !targetPath\.startsWith\(FILE_SYNC_ROOT \+ path\.sep\)/);
});

test('HAP installer deployment includes manifest merge protection and reloads the API', () => {
  assert.match(client, /api\/lib\/app_manifest_merge\.js/);
  assert.match(client, /pm2 restart zhengzheng-api --update-env/);
  assert.match(server, /mergeAppDistributionManifest/);
  assert.match(server, /mergeType: 'app-manifest'/);
});

test('main API dependencies are synchronized before server.js', () => {
  const coreIndex = client.indexOf("await syncFile('zhengzhengstudio.cn/boardgames/board-analysis-core.js'");
  const routeIndex = client.indexOf("await syncFile('api/boardgame_analysis.js'");
  const serverIndex = client.indexOf("await syncFile('api/server.js'");
  assert.ok(coreIndex >= 0 && routeIndex > coreIndex && serverIndex > routeIndex);
});

test('long-running watch reloads itself when the sync script changes', () => {
  assert.match(client, /fs\.watchFile\(__filename/);
  assert.match(client, /spawn\(process\.execPath, \[__filename, \.\.\.process\.argv\.slice\(2\)\]/);
  assert.match(client, /fs\.unwatchFile\(__filename\)/);
});

test('website watch polls the tree without exhausting recursive file descriptors', () => {
  assert.match(client, /const scanWatchTree = \(dirPath\) =>/);
  assert.match(client, /const watchPollTimer = setInterval\(scanForChanges, watchPollIntervalMs\)/);
  assert.match(client, /clearInterval\(watchPollTimer\)/);
  assert.doesNotMatch(client, /fs\.watch\(websitePath, \{ recursive: true \}/);
});

test('watch ignores git metadata by path segment instead of leaf filename', () => {
  assert.match(client, /function isIgnoredSyncPath\(relativePath\)/);
  assert.match(client, /segments\.some\(segment => segment === ignore\)/);
  assert.match(client, /const ignoredByName = isIgnoredSyncPath\(relativePath\)/);
  assert.doesNotMatch(client, /IGNORE_LIST\.some\(ignore => basename\.includes\(ignore\)\)/);
});

test('watch ignores generated native build trees before polling or uploading them', () => {
  for (const segment of ['.gradle', '.build', '.idea', 'build', 'DerivedData', 'xcuserdata']) {
    assert.ok(
      client.includes(`'${segment}'`) || client.includes(`"${segment}"`),
      `missing ignored build segment: ${segment}`
    );
  }
  assert.match(client, /if \(shouldSkipSyncPath\(relativePath, entry\.name, stats\)\) continue/);
  assert.match(client, /if \(shouldSkipSyncPath\(currentRelative, path\.basename\(currentRelative\), stats\)\)/);
});

test('focused directory sync excludes cloud placeholders and removes SpaceFight conflict copies', () => {
  assert.match(client, /if \(shouldSkipSyncPath\(remotePath, entry, stats\)\) continue/);
  assert.match(client, /function isSpaceFightConflictCopy\(relativePath\)/);
  assert.match(client, /if \(isSpaceFightConflictCopy\(relativePath\)\) return true/);
  assert.match(client, /remoteSpaceFightRoot[\s\S]*-name '\*\.icloud'[\s\S]*-name '\* 2\.\*'[\s\S]*-delete/);
  assert.match(client, /SpaceFight 线上 iCloud\/冲突副本清理失败/);
});

test('SpaceFight can bypass the full app queue with a focused release sync', () => {
  assert.match(client, /arg === '--spacefight-apps'/);
  assert.match(client, /startsWith\('spacefight-'\)/);
  assert.match(client, /\['zhengzhengstudio\.cn\/api\/apps', publicAppDir\]/);
  assert.match(client, /\['api\/apps', apiAppDir\]/);
  assert.match(client, /await syncSpaceFightApps\(\)/);
  assert.match(client, /validateDistributionRoots\(\[apiAppDir, publicAppDir\], \{ entryIds: releaseEntryIds, checksums: true \}\)/);
  assert.match(client, /\[apiAppDir, publicAppDir\]\.flatMap/);
});

test('Survival Diary focused release sync uploads checksum sidecars using the package path', () => {
  assert.match(client, /releaseFiles\.push\(\[`\$\{prefix\}\/\$\{packagePath\}\.sha256`/);
  assert.doesNotMatch(client, /releaseFiles\.push\(\[`\$\{prefix\}\/\$\{fileName\}\.sha256`/);
});

test('LifeDiary has a focused release mode that publishes metadata and packages', () => {
  assert.match(client, /arg === '--life-diary-release'/);
  assert.match(client, /collectProductReleaseFiles\([\s\S]*product: 'lifediary'/);
  assert.match(client, /await syncLifeDiaryRelease\(\)/);
});

test('SpaceFight web release validates assets and publishes the entry page last', () => {
  assert.match(client, /arg === '--spacefight-web'/);
  assert.match(client, /if \(args\.spaceFightWebOnly\)/);
  assert.match(client, /const validateSpaceFightWebRelease =/);
  assert.match(client, /const syncSpaceFightWebRelease = async/);
  assert.match(client, /entryFilesLast: \['index\.html'\]/);
  assert.match(client, /failFast: true/);
  assert.match(client, /entry\.endsWith\('\.icloud'\)/);
  assert.match(client, /await syncSpaceFightWebRelease\(\)/);
  assert.match(client, /isSpaceFightWebPath\(path\.relative\(websitePath, fullPath\)\)/);
});

test('SpaceFight web release also publishes and restarts its authoritative game server', () => {
  assert.match(client, /api\/lib\/spacefight_anti_cheat\.js/);
  assert.match(client, /api\/spacefight_server\.js/);
  assert.match(client, /pm2 restart zhengzheng-spacefight --update-env/);
  assert.match(client, /SpaceFight 联机服务重启失败/);
});
