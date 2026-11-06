const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    acquireProcessLock,
    createPackageSyncStore,
    getInitialWebsiteSyncEntries,
    getWatchPathSignature,
    installWatchShutdownHandlers,
    selectPackageChunkSize,
    startWatchWithBackgroundBackup,
    stopProcessGracefully
} = require('../sync_runtime');

test('initial watch sync schedules the complete green-home website before watching changes', () => {
  assert.deepEqual(getInitialWebsiteSyncEntries('/workspace'), [
    {
      type: 'file',
      remotePath: 'api/routes/green_home.js',
      localPath: path.join('/workspace', 'website', 'api', 'routes', 'green_home.js')
    },
    {
      type: 'directory',
      remotePath: 'zheng-homework.zhengzhengstudio.cn',
      includeAssets: true
    }
  ]);
});

test('public web package uploads use Cloudflare-safe chunks while LAN keeps larger chunks', () => {
  assert.equal(selectPackageChunkSize({ protocol: 'https' }), 1024 * 1024);
  assert.equal(selectPackageChunkSize({ protocol: 'http' }), 8 * 1024 * 1024);
});

test('unchanged published packages are skipped for every supported package type', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-package-store-'));
  const store = createPackageSyncStore({
    packageDbPath: path.join(tempDir, 'packages.json'),
    apkDbPath: path.join(tempDir, 'apks.json')
  });

  try {
    for (const extension of ['.apk', '.app', '.hap', '.ipa', '.dmg', '.pkg']) {
      const relativePath = `api/apps/example${extension}`;
      const fullPath = path.join(tempDir, `example${extension}`);
      fs.writeFileSync(fullPath, `unchanged-${extension}`);

      assert.equal(store.isSynced(relativePath, fullPath, 'lan:192.168.1.10'), false);
      store.markSynced(relativePath, fullPath, 'lan:192.168.1.10');
      assert.equal(store.isSynced(relativePath, fullPath, 'lan:192.168.1.10'), true);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('package cache is isolated by upload target', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-package-target-'));
  const store = createPackageSyncStore({
    packageDbPath: path.join(tempDir, 'packages.json'),
    apkDbPath: path.join(tempDir, 'apks.json')
  });
  const relativePath = 'api/apps/example.apk';
  const fullPath = path.join(tempDir, 'example.apk');

  try {
    fs.writeFileSync(fullPath, 'same-package');
    store.markSynced(relativePath, fullPath, 'lan:192.168.1.10');

    assert.equal(store.isSynced(relativePath, fullPath, 'lan:192.168.1.10'), true);
    assert.equal(store.isSynced(relativePath, fullPath, 'lan:192.168.1.11'), false);
    assert.equal(store.isSynced(relativePath, fullPath, 'web:sync.example.com'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('package cache detects same-size content changes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-package-hash-'));
  const apkDbPath = path.join(tempDir, 'apks.json');
  const store = createPackageSyncStore({
    packageDbPath: path.join(tempDir, 'packages.json'),
    apkDbPath
  });
  const relativePath = 'api/apps/example.apk';
  const fullPath = path.join(tempDir, 'example.apk');

  try {
    fs.writeFileSync(fullPath, 'package-one');
    store.markSynced(relativePath, fullPath, 'lan:192.168.1.10');

    fs.writeFileSync(fullPath, 'package-two');
    const records = JSON.parse(fs.readFileSync(apkDbPath, 'utf8'));
    records[0][1].mtime = fs.statSync(fullPath).mtimeMs;
    fs.writeFileSync(apkDbPath, JSON.stringify(records));
    const reloadedStore = createPackageSyncStore({
      packageDbPath: path.join(tempDir, 'packages.json'),
      apkDbPath
    });
    assert.equal(reloadedStore.isSynced(relativePath, fullPath, 'lan:192.168.1.10'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('package cache does not crash or record a package removed after upload', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-package-removed-'));
  const apkDbPath = path.join(tempDir, 'apks.json');
  const store = createPackageSyncStore({
    packageDbPath: path.join(tempDir, 'packages.json'),
    apkDbPath
  });
  const relativePath = 'api/apps/example.apk';
  const fullPath = path.join(tempDir, 'example.apk');

  try {
    fs.writeFileSync(fullPath, 'uploaded-package');
    const uploadedFingerprint = store.captureFingerprint(fullPath, 'lan:192.168.1.10');
    fs.rmSync(fullPath);

    assert.equal(
      store.markSynced(relativePath, fullPath, 'lan:192.168.1.10', uploadedFingerprint),
      false
    );
    assert.equal(fs.existsSync(apkDbPath), false);
    assert.equal(store.isSynced(relativePath, fullPath, 'lan:192.168.1.10'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('package cache rejects a replacement created while the old package uploads', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-package-replaced-'));
  const store = createPackageSyncStore({
    packageDbPath: path.join(tempDir, 'packages.json'),
    apkDbPath: path.join(tempDir, 'apks.json')
  });
  const relativePath = 'api/apps/example.apk';
  const fullPath = path.join(tempDir, 'example.apk');

  try {
    fs.writeFileSync(fullPath, 'old-upload');
    const uploadedFingerprint = store.captureFingerprint(fullPath, 'lan:192.168.1.10');
    fs.writeFileSync(fullPath, 'new-published-package');

    assert.equal(
      store.markSynced(relativePath, fullPath, 'lan:192.168.1.10', uploadedFingerprint),
      false
    );
    assert.equal(store.isSynced(relativePath, fullPath, 'lan:192.168.1.10'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('watch starts before a slow backup finishes', async () => {
  const events = [];
  let finishBackup;
  const backup = new Promise(resolve => { finishBackup = resolve; });

  const backgroundBackup = startWatchWithBackgroundBackup({
    startWatch: () => events.push('watch'),
    downloadBackup: async () => {
      events.push('backup-start');
      await backup;
      events.push('backup-finish');
    },
    scheduleBackup: () => events.push('schedule'),
    onBackupSettled: () => events.push('watch-active'),
    reason: 'watch-start'
  });

  assert.deepEqual(events, ['watch', 'schedule', 'backup-start']);
  finishBackup();
  await backgroundBackup;
  assert.deepEqual(events, ['watch', 'schedule', 'backup-start', 'backup-finish', 'watch-active']);
});

test('a second watcher cannot acquire a live process lock', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-lock-'));
  const lockPath = path.join(tempDir, 'watch.lock');
  const first = acquireProcessLock(lockPath);

  try {
    assert.equal(first.acquired, true);
    const second = acquireProcessLock(lockPath);
    assert.equal(second.acquired, false);
    assert.equal(second.ownerPid, process.pid);

    first.release();
    const replacement = acquireProcessLock(lockPath);
    assert.equal(replacement.acquired, true);
    replacement.release();
  } finally {
    first.release();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('watch signatures use file metadata so large packages are not read during startup', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-signature-'));
  const fullPath = path.join(tempDir, 'large.ipa');

  try {
    fs.writeFileSync(fullPath, 'package-content');
    const stats = fs.statSync(fullPath);
    assert.equal(
      getWatchPathSignature(fullPath, stats),
      `file:${stats.size}:${stats.mtimeMs}`
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Ctrl+C stops every watch resource and exits only once', () => {
  const { EventEmitter } = require('node:events');
  const processRef = new EventEmitter();
  const events = [];
  processRef.exit = code => events.push(`exit:${code}`);

  const dispose = installWatchShutdownHandlers({
    processRef,
    cleanup: signal => events.push(`cleanup:${signal}`),
    log: message => events.push(message)
  });

  processRef.emit('SIGINT');
  processRef.emit('SIGTERM');

  assert.deepEqual(events, [
    'stop:SIGINT',
    'cleanup:SIGINT',
    'exit:0'
  ]);
  assert.equal(processRef.listenerCount('SIGINT'), 0);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);

  dispose();
});

test('a stale heartbeat lock is taken over so the next --watch can always start', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-stale-'));
  const lockPath = path.join(tempDir, 'watch.lock');

  try {
    // 模拟「进程被 SIGKILL 后残留的锁」：PID 仍存活（就是当前进程）但心跳早已过期
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      token: 'stale-token',
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      heartbeatAt: Date.now() - 10 * 60 * 1000
    }));

    const lock = acquireProcessLock(lockPath, { heartbeatIntervalMs: 0 });
    assert.equal(lock.acquired, true, '心跳过期的残留锁应被接管');
    assert.equal(lock.ownerPid, process.pid);
    lock.release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a fresh heartbeat lock still blocks a second watcher', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-fresh-'));
  const lockPath = path.join(tempDir, 'watch.lock');
  const first = acquireProcessLock(lockPath, { heartbeatIntervalMs: 0 });

  try {
    assert.equal(first.acquired, true);
    const second = acquireProcessLock(lockPath, { heartbeatIntervalMs: 0 });
    assert.equal(second.acquired, false, '心跳正常的锁必须继续挡住第二个 watcher');
    assert.equal(second.ownerPid, process.pid);
  } finally {
    first.release();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('heartbeat() refreshes the lock so a busy watcher is not treated as stale', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-beat-'));
  const lockPath = path.join(tempDir, 'watch.lock');
  const lock = acquireProcessLock(lockPath, { heartbeatIntervalMs: 0 });

  try {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      token: JSON.parse(fs.readFileSync(lockPath, 'utf8')).token,
      startedAt: new Date().toISOString(),
      heartbeatAt: Date.now() - 5 * 1000
    }));
    lock.heartbeat();
    const beat = JSON.parse(fs.readFileSync(lockPath, 'utf8')).heartbeatAt;
    assert.ok(Date.now() - beat < 1000, 'heartbeat() 应把心跳刷新到当前时间');
  } finally {
    lock.release();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('stopProcessGracefully escalates SIGINT to SIGKILL until the process is gone', async () => {
  const signals = [];
  let alive = true;
  const fakeProc = {
    kill(pid, signal) {
      if (signal === 0) {
        if (!alive) {
          const error = new Error('no such process');
          error.code = 'ESRCH';
          throw error;
        }
        return true;
      }
      signals.push(signal);
      if (signal === 'SIGKILL') alive = false;
      return true;
    }
  };

  const result = await stopProcessGracefully(4242, {
    proc: fakeProc,
    timeoutMs: 900,
    sleep: () => Promise.resolve()
  });

  assert.equal(result.stopped, true);
  assert.equal(alive, false);
  assert.deepEqual(signals, ['SIGINT', 'SIGTERM', 'SIGKILL'], '必须逐级升级，而不是只发一次信号');
});

test('stopProcessGracefully reports an already exited process without signalling', async () => {
  const signals = [];
  const fakeProc = {
    kill(pid, signal) {
      if (signal === 0) {
        const error = new Error('no such process');
        error.code = 'ESRCH';
        throw error;
      }
      signals.push(signal);
      return true;
    }
  };

  const result = await stopProcessGracefully(4242, { proc: fakeProc });
  assert.equal(result.alreadyExited, true);
  assert.deepEqual(signals, []);
});

test('closing the terminal (SIGHUP) also stops the watcher', () => {
  const { EventEmitter } = require('node:events');
  const processRef = new EventEmitter();
  const events = [];
  processRef.exit = code => events.push(`exit:${code}`);

  const dispose = installWatchShutdownHandlers({
    processRef,
    cleanup: signal => events.push(`cleanup:${signal}`),
    log: message => events.push(message)
  });

  processRef.emit('SIGHUP');
  assert.deepEqual(events, ['stop:SIGHUP', 'cleanup:SIGHUP', 'exit:0']);
  dispose();
});

test('the watcher exits even when cleanup throws', () => {
  const { EventEmitter } = require('node:events');
  const processRef = new EventEmitter();
  const events = [];
  processRef.exit = code => events.push(`exit:${code}`);

  const dispose = installWatchShutdownHandlers({
    processRef,
    cleanup: () => {
      throw new Error('lock file already removed');
    },
    log: () => {}
  });

  processRef.emit('SIGINT');
  assert.deepEqual(events, ['exit:0'], 'cleanup 抛错也必须退出，否则会留下杀不掉的孤儿进程');
  dispose();
});
