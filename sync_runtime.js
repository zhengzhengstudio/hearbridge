const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function getInitialWebsiteSyncEntries(rootPath) {
    return [
        {
            type: 'file',
            remotePath: 'api/routes/green_home.js',
            localPath: path.join(rootPath, 'website', 'api', 'routes', 'green_home.js')
        },
        {
            type: 'directory',
            remotePath: 'zheng-homework.zhengzhengstudio.cn',
            includeAssets: true
        }
    ];
}

function loadStore(filePath) {
    try {
        return new Map(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return new Map();
    }
}

function saveStore(filePath, store, label) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify([...store.entries()], null, 2));
        fs.renameSync(tempPath, filePath);
        return true;
    } catch (error) {
        try { fs.rmSync(tempPath, { force: true }); } catch {}
        console.warn(`⚠️ [Package Cache] ${label}写入失败，已保留原记录: ${error.message}`);
        return false;
    }
}

function normalizeKey(relativePath) {
    return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function getFileSha256(fullPath) {
    return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
}

function getFingerprint(fullPath, targetKey) {
    try {
        const stats = fs.statSync(fullPath);
        return {
            size: stats.size,
            mtime: stats.mtimeMs,
            device: stats.dev,
            inode: stats.ino,
            sha256: getFileSha256(fullPath),
            targetKey: String(targetKey || '')
        };
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function fingerprintMatches(record, fullPath, targetKey) {
    if (!record || !record.sha256 || !record.targetKey || record.targetKey !== String(targetKey || '')) {
        return false;
    }
    try {
        const stats = fs.statSync(fullPath);
        if (record.size !== stats.size || record.mtime !== stats.mtimeMs) return false;
        return record.sha256 === getFileSha256(fullPath);
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function pathStillMatchesFingerprint(fullPath, fingerprint) {
    if (!fingerprint) return false;
    try {
        const stats = fs.statSync(fullPath);
        return stats.size === fingerprint.size
            && stats.mtimeMs === fingerprint.mtime
            && (fingerprint.device === undefined || stats.dev === fingerprint.device)
            && (fingerprint.inode === undefined || stats.ino === fingerprint.inode);
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function createPackageSyncStore({ packageDbPath, apkDbPath }) {
    const packageStore = loadStore(packageDbPath);
    const apkStore = loadStore(apkDbPath);

    const selectStore = relativePath => path.extname(relativePath).toLowerCase() === '.apk'
        ? apkStore
        : packageStore;

    return {
        captureFingerprint(fullPath, targetKey) {
            return getFingerprint(fullPath, targetKey);
        },
        isSynced(relativePath, fullPath, targetKey) {
            const key = normalizeKey(relativePath);
            return fingerprintMatches(selectStore(key).get(key), fullPath, targetKey);
        },
        markSynced(relativePath, fullPath, targetKey, uploadedFingerprint = null) {
            const key = normalizeKey(relativePath);
            const store = selectStore(key);
            const fingerprint = uploadedFingerprint || getFingerprint(fullPath, targetKey);
            if (!fingerprint
                || fingerprint.targetKey !== String(targetKey || '')
                || !pathStillMatchesFingerprint(fullPath, fingerprint)) {
                console.warn(`⚠️ [Package Cache] ${key} 上传后已被移动或替换，跳过本地指纹记录`);
                return false;
            }
            store.set(key, fingerprint);
            const isApk = path.extname(key).toLowerCase() === '.apk';
            return saveStore(
                isApk ? apkDbPath : packageDbPath,
                store,
                isApk ? 'APK 同步记录' : '安装包同步记录'
            );
        }
    };
}

function getWatchPathSignature(fullPath, stats = null) {
    try {
        const fileStats = stats || fs.statSync(fullPath);
        const type = fileStats.isDirectory() ? 'dir' : 'file';
        return `${type}:${fileStats.size}:${fileStats.mtimeMs}`;
    } catch {
        return null;
    }
}

function selectPackageChunkSize(target = {}) {
    return target.protocol === 'https' ? 1024 * 1024 : 8 * 1024 * 1024;
}

function isProcessRunning(pid, proc = process) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        proc.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

const WATCH_LOCK_HEARTBEAT_STALE_MS = 90 * 1000;
const WATCH_LOCK_HEARTBEAT_INTERVAL_MS = 15 * 1000;

function readLockFile(lockPath) {
    try {
        return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * 监听进程锁。相比旧版额外做两件事：
 *  1. 记录 heartbeatAt，并提供 heartbeat() 定时续约——进程被 SIGKILL / 断网 / 崩溃后
 *     锁不会永久卡死后续启动，超时后新进程可安全接管；
 *  2. stale 判定不依赖 ps（部分环境 ps 会 EPERM），只用 process.kill(pid, 0)。
 */
function acquireProcessLock(lockPath, {
    proc = process,
    heartbeatIntervalMs = WATCH_LOCK_HEARTBEAT_INTERVAL_MS,
    staleAfterMs = WATCH_LOCK_HEARTBEAT_STALE_MS
} = {}) {
    const token = `${proc.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    const readHeartbeat = () => {
        const current = readLockFile(lockPath);
        if (!current) return null;
        const beat = Number(current.heartbeatAt);
        if (Number.isFinite(beat) && beat > 0) return Date.now() - beat;
        const started = Date.parse(current.startedAt);
        return Number.isFinite(started) ? Date.now() - started : null;
    };

    const removeStaleLock = (reason) => {
        try { fs.rmSync(lockPath, { force: true }); } catch {}
        return reason;
    };

    const existing = readLockFile(lockPath);
    if (existing) {
        const ownerPid = Number(existing.pid);
        const alive = isProcessRunning(ownerPid, proc);
        if (!alive) {
            removeStaleLock('owner-exited');
        } else {
            const age = readHeartbeat();
            const stale = age !== null && age > staleAfterMs;
            if (!stale) {
                return {
                    acquired: false,
                    ownerPid,
                    ownerPidAlive: true,
                    ownerStale: false,
                    ownerHeartbeatAgeMs: age,
                    release() {}
                };
            }
            // 进程还在但心跳早已过期：判定为僵死 watcher，让新进程接管
            removeStaleLock('heartbeat-timeout');
        }
    } else {
        removeStaleLock('unreadable');
    }

    try {
        fs.writeFileSync(lockPath, JSON.stringify({
            pid: proc.pid,
            token,
            startedAt: new Date().toISOString(),
            heartbeatAt: Date.now()
        }, null, 2), { flag: 'wx' });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const current = readLockFile(lockPath);
        const ownerPid = Number(current && current.pid) || 0;
        const alive = isProcessRunning(ownerPid, proc);
        if (!alive) {
            removeStaleLock('owner-exited-race');
            fs.writeFileSync(lockPath, JSON.stringify({
                pid: proc.pid, token, startedAt: new Date().toISOString(), heartbeatAt: Date.now()
            }, null, 2));
        } else {
            return {
                acquired: false,
                ownerPid,
                ownerPidAlive: true,
                ownerStale: false,
                ownerHeartbeatAgeMs: readHeartbeat(),
                release() {}
            };
        }
    }

    let released = false;
    let heartbeatTimer = null;
    const clearHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };
    if (heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(() => {
            if (released) return;
            try {
                const current = readLockFile(lockPath);
                if (!current || current.token !== token) return;
                fs.writeFileSync(lockPath, JSON.stringify({
                    ...current,
                    heartbeatAt: Date.now()
                }, null, 2));
            } catch {}
        }, heartbeatIntervalMs);
        if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
    }

    return {
        acquired: true,
        ownerPid: proc.pid,
        heartbeat() {
            if (released) return;
            try {
                const current = readLockFile(lockPath);
                if (!current || current.token !== token) return;
                fs.writeFileSync(lockPath, JSON.stringify({ ...current, heartbeatAt: Date.now() }, null, 2));
            } catch {}
        },
        release() {
            if (released) return;
            released = true;
            clearHeartbeat();
            try {
                const current = readLockFile(lockPath);
                if (current && current.token === token) fs.rmSync(lockPath, { force: true });
            } catch {}
        }
    };
}

/**
 * 依次用 SIGINT / SIGTERM / SIGKILL 关闭目标进程。
 * 只发一次信号就放弃是「Ctrl+C 杀不掉监听」的根因——watch 进程可能
 * 正在等 IO 或被自身 handler 挡住，单发信号经常打不掉。
 */
function stopProcessGracefully(pid, {
    proc = process,
    timeoutMs = 6000,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    onStep = () => {}
} = {}) {
    if (!isProcessRunning(pid, proc)) {
        return Promise.resolve({ stopped: true, alreadyExited: true, signal: null });
    }
    const steps = [
        { signal: 'SIGINT', wait: Math.max(500, Math.floor(timeoutMs / 3)) },
        { signal: 'SIGTERM', wait: Math.max(500, Math.floor(timeoutMs / 3)) },
        { signal: 'SIGKILL', wait: 300 }
    ];
    return (async () => {
        for (const step of steps) {
            try {
                proc.kill(pid, step.signal);
            } catch (error) {
                if (error.code === 'ESRCH') {
                    return { stopped: true, alreadyExited: true, signal: step.signal };
                }
            }
            onStep(step.signal);
            const deadline = Date.now() + step.wait;
            while (Date.now() < deadline) {
                await sleep(150);
                if (!isProcessRunning(pid, proc)) {
                    return { stopped: true, alreadyExited: false, signal: step.signal };
                }
            }
        }
        const alive = isProcessRunning(pid, proc);
        return { stopped: !alive, alreadyExited: false, signal: 'SIGKILL', failed: alive };
    })();
}

function startWatchWithBackgroundBackup({
    startWatch,
    downloadBackup,
    scheduleBackup,
    onBackupSettled,
    reason
}) {
    startWatch();
    scheduleBackup();
    let operation;
    try {
        operation = Promise.resolve(downloadBackup(reason)).catch(error => {
            console.warn(`⚠️ [API Backup] 后台备份失败: ${error.message}`);
            return false;
        });
    } catch (error) {
        console.warn(`⚠️ [API Backup] 后台备份失败: ${error.message}`);
        operation = Promise.resolve(false);
    }
    return operation.finally(() => {
        if (typeof onBackupSettled !== 'function') return;
        try { onBackupSettled(); } catch {}
    });
}

function installWatchShutdownHandlers({
    processRef = process,
    cleanup = () => {},
    log = () => {}
}) {
    let stopping = false;

    const dispose = () => {
        processRef.removeListener('SIGINT', onSigInt);
        processRef.removeListener('SIGTERM', onSigTerm);
        processRef.removeListener('SIGHUP', onSigHup);
    };
    const stop = (signal) => {
        if (stopping) return;
        stopping = true;
        dispose();
        log(`stop:${signal}`);
        // cleanup 里可能抛错（例如锁文件被删/定时器已清），必须保证进程一定退出，
        // 否则 Ctrl+C 看起来「没反应」，watch 就成了杀不掉的孤儿进程。
        try {
            cleanup(signal);
        } catch (error) {
            try { console.warn(`⚠️ [Watch Mode] 清理时出错（已忽略）: ${error.message}`); } catch {}
        } finally {
            try { processRef.exit(0); } catch {}
        }
    };
    const onSigInt = () => stop('SIGINT');
    const onSigTerm = () => stop('SIGTERM');
    const onSigHup = () => stop('SIGHUP');

    processRef.once('SIGINT', onSigInt);
    processRef.once('SIGTERM', onSigTerm);
    // 终端窗口关闭 / SSH 断开时也走同一套清理，避免留下孤儿 watch
    processRef.once('SIGHUP', onSigHup);
    return dispose;
}

module.exports = {
    acquireProcessLock,
    createPackageSyncStore,
    getInitialWebsiteSyncEntries,
    getWatchPathSignature,
    installWatchShutdownHandlers,
    isProcessRunning,
    selectPackageChunkSize,
    startWatchWithBackgroundBackup,
    stopProcessGracefully,
    WATCH_LOCK_HEARTBEAT_INTERVAL_MS,
    WATCH_LOCK_HEARTBEAT_STALE_MS
};
