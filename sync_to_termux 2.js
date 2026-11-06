const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const {
    acquireProcessLock,
    createPackageSyncStore,
    getWatchPathSignature,
    installWatchShutdownHandlers,
    startWatchWithBackgroundBackup,
    stopProcessGracefully
} = require('./sync_runtime');

/**
 * 同步脚本：将电脑端的代码同步到手机 Termux
 * 
 * 选项：
 *   --watch / -w: 监听模式，文件变更自动同步
 *   --ha / --homeassistant:
 *                 安全同步 HomeAssistant 代码/配置到 Termux 与 proot
 *                 (排除 .storage、数据库、日志等运行态数据)
 *   --watch-only / --no-initial-sync:
 *                 只启动监听，不在启动时先同步一轮
 *   --force-glasses-assets: 强制覆盖同步眼镜站图片资源（默认保护，避免覆盖 Termux 端图片）
 *   --glasses-ai-assets: 只补传新增 imagegen 眼镜图片资源，不覆盖已存在文件
 *   --doubao-glasses-assets: 覆盖豆包导入镜框槽位 18-72，不覆盖保留/生成槽位
 *   --glasses-ppt-assets: 只补传 glasses PPT 预览图片，不覆盖镜框资产
 *   --mc-server:  同步根目录 mc_server 服务器包到 Termux（较大，按需使用）
 *   --hap-installer / --hap:
 *                 只同步 HAP 安装器、主 API 代理与相关网页入口
 *   --hear / --hearbridge:
 *                 只同步声桥 HearBridge 静态站点、独立 server 与 Tunnel 配置
 *   --survival-diary:
 *                 只同步生存日记站点、独立 server 与 Tunnel 配置并重启线上服务
 *   --survival-diary-start:
 *                 文件已同步时，只启动生存日记服务并重启 Tunnel
 *   --survival-diary-release:
 *                 只同步生存日记更新日志、下载清单与安装包
 *   --glasses-apps:
 *                 只同步铮铮眼镜安装包、latest 文件与下载中心索引
 *   --spacefight-apps:
 *                 只同步 SpaceFight 站点、安装包与下载中心索引
 *   --spacefight-web:
 *                 只同步 SpaceFight 网页，安装包清单异常时也可独立恢复站点
 *   --exe / --win / --windows:
 *                 只定向上传 Windows 桌面端安装包 (.exe)，不做全量同步。
 *                 支持 --exe=文件名关键字 只上传匹配的包；与 --watch 同用时，
 *                 监听阶段也会持续扫描 Windows 构建产物目录并自动上传新 .exe
 *   --pkgs / --packages / --apps:
 *                 定向上传所有平台安装包：Windows .exe 与鸿蒙 .hap/.app，不做全量同步。
 *                 鸿蒙构建目录里堆着历史版本，只上传每个项目最新构建的一份
 *   --stop-watch: 结束正在运行的 watch 监听进程并清理锁文件。
 *                 会按 SIGINT → SIGTERM → SIGKILL 逐级升级，
 *                 所以「Ctrl+C 没打掉 / pkill 杀不掉」的孤儿监听也能被清掉。
 *                 正常停止直接 Ctrl+C 即可（约 0.5s 退出并自动清锁）。
 *
 * 监听进程锁（.sync_watch.lock）：
 *   - 带心跳（默认 15s 续约、90s 判定过期），进程被强杀后锁不会永久卡住下次启动；
 *   - 心跳过期的残留锁会被下一次 --watch 自动接管，无需手动清文件；
 *   - 第二个 watcher 仍会被正确拦住，并提示用 --stop-watch 释放。
 *
 * 连接（手机 IP）：
 *   - 记住上次连通的 IP 到 .sync_last_termux_ip，换网段后优先复用；
 *   - 找不到时并发扫描同网段（原先 255×4 串行，换网段基本扫不出来）；
 *   - watch 模式连不上不会退出，60s 自动重连，期间变更积压，连上后补发。
 *   --noapk:      一次性同步时排除安装包 (.apk/.app/.hap/.ipa 等)；
 *                 与 --watch 同用时，只排除启动时的初次同步，监听阶段恢复安装包上传
 *   --no-api-backup:
 *                 不在同步完成后/每天 20:00 拉取 Termux API 备份
 *   --ip=xxx:     指定 Termux IP 地址 (默认自动检测同网段)
 *   --web:        当本地 IP 所有端口都失败时，回退到 sync.zhengzhengstudio.cn 同步
 *   --web-host=xxx: 指定 web 同步域名（默认 sync.zhengzhengstudio.cn）
 */

const DEFAULT_TERMUX_IPS = ['192.168.124.18', '192.168.5.106',
'192.168.1.45','192.168.8.10'];
const LAST_TERMUX_IP_FILE = path.join(__dirname, '.sync_last_termux_ip');
const PORTS = [8110, 8115, 8117, 3010];  // 所有端口都可尝试同步（按优先级）
const SYNC_PORTS = [8110, 8115, 8117, 3010];  // 所有端口都可尝试同步（按优先级）
const CLEANUP_PORTS = [8080, 8788];  // 需要清理的旧端口
const SYNC_SECRET = 'zhengzheng_sync_secret_2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'H3CXiangshan=';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '铮铮实验室';
const API_BACKUP_DIR = path.join(__dirname, 'website_api_bak');
const API_BACKUP_ENDPOINT = '/api/admin/termux/api-backup.zip';
const API_BACKUP_PORTS = [8110, 8118];
const API_BACKUP_DAILY_HOUR = 20;
const API_BACKUP_DAILY_MINUTE = 0;
const API_BACKUP_LOCK_PATH = path.join(API_BACKUP_DIR, '.backup.lock');
// 自动备份节流：watch 启动与每次同步结束这两类自动备份，7 天只做一次；
// 每天 20:00 的定时备份与手动备份（--api-backup）永远执行，不受此限制。
const API_BACKUP_THROTTLE_DAYS = 7;
const API_BACKUP_THROTTLE_MS = API_BACKUP_THROTTLE_DAYS * 24 * 60 * 60 * 1000;
const API_BACKUP_THROTTLE_STATE_PATH = path.join(API_BACKUP_DIR, '.backup-throttle.json');
const API_BACKUP_DAILY_REASON = 'daily-2000';
// 这些触发点每次运行都会执行（watch 启动、每次同步结束），
// 若不节流会把备份目录撑满并反复拉取 12MB 压缩包。
const API_BACKUP_THROTTLED_REASONS = new Set(['watch-start', 'sync-complete']);
const API_BACKUP_MAX_BYTES = 512 * 1024 * 1024;
const WATCH_LOCK_PATH = path.join(__dirname, '.sync_watch.lock');

/**
 * 读取上次成功连上的 Termux 地址。
 * 手机热点/路由器换网段后 IP 常变，记住上次成功值可避免每次都全网段扫描。
 */
function readLastTermuxIp() {
    try {
        const value = fs.readFileSync(LAST_TERMUX_IP_FILE, 'utf8').trim();
        return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? value : null;
    } catch {
        return null;
    }
}

function rememberTermuxIp(ip) {
    if (!ip) return;
    try {
        fs.writeFileSync(LAST_TERMUX_IP_FILE, `${ip}\n`);
    } catch {}
}


const BAN_RECOVERY_CONFIG = {
    autoUnblockEnabled: true,
    baseRetryDelay: 3000,
    maxRetryDelay: 60000
};

/**
 * 获取本机局域网 IP 地址
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return null;
}

/**
 * 探测单个 IP:port 是否为 Termux 同步服务
 */
function probeTermuxHost(testIP, port, timeout = 500) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        try {
            const req = http.get(`http://${testIP}:${port}/api`, { timeout }, (res) => {
                finish(res.statusCode < 500);
            });
            req.on('error', () => finish(false));
            req.on('timeout', () => {
                req.destroy();
                finish(false);
            });
        } catch {
            finish(false);
        }
    });
}

/**
 * 自动扫描同网段的 Termux 设备。
 * 原来是 255 × 4 串行探测（每轮 500ms），最坏要几分钟，换网段基本等不到；
 * 现在先并发打一轮常用端口，再对未命中的 IP 做一次补扫，通常 10 秒内出结果。
 */
async function scanTermuxDevice() {
    const localIP = getLocalIP();
    if (!localIP) {
        console.log('⚠️ 无法获取本机 IP，使用默认地址');
        return DEFAULT_TERMUX_IPS[0];
    }

    const lastKnown = readLastTermuxIp();
    if (lastKnown) {
        const sameSubnet = localIP.startsWith(lastKnown.substring(0, lastKnown.lastIndexOf('.')));
        if (sameSubnet) {
            for (const port of PORTS) {
                if (await probeTermuxHost(lastKnown, port, 400)) {
                    console.log(`✅ 使用上次成功的 Termux 地址: ${lastKnown}:${port}`);
                    return lastKnown;
                }
            }
        }
    }

    console.log(`📍 本机 IP: ${localIP}`);
    const prefix = localIP.substring(0, localIP.lastIndexOf('.'));
    console.log(`🔍 正在扫描 ${prefix}.0/24 网段寻找 Termux 设备...`);

    const candidates = [];
    for (let i = 1; i < 255; i++) {
        const testIP = `${prefix}.${i}`;
        if (testIP === localIP) continue;
        candidates.push(testIP);
    }

    // 第一轮：全网段 × 首要端口并发探测
    const primaryPort = PORTS[0];
    const firstRound = await Promise.all(
        candidates.map(ip => probeTermuxHost(ip, primaryPort, 600).then(ok => ok ? ip : null))
    );
    const hit = firstRound.find(Boolean);
    if (hit) {
        console.log(`✅ 发现 Termux 设备: ${hit}:${primaryPort}`);
        rememberTermuxIp(hit);
        return hit;
    }

    // 第二轮：其余端口并发补扫
    for (const port of PORTS.slice(1)) {
        const round = await Promise.all(
            candidates.map(ip => probeTermuxHost(ip, port, 600).then(ok => ok ? ip : null))
        );
        const found = round.find(Boolean);
        if (found) {
            console.log(`✅ 发现 Termux 设备: ${found}:${port}`);
            rememberTermuxIp(found);
            return found;
        }
    }

    console.log('⚠️ 未找到 Termux 设备，使用默认地址');
    console.log('💡 若手机刚连上新的 Wi-Fi/热点，可手动指定：node sync_to_termux.js --ip=<手机IP>');
    return DEFAULT_TERMUX_IPS[0];
}

const APK_UPLOADED_DB = path.join(__dirname, '.sync_uploaded_apk.json');
const PACKAGE_SYNC_DB_PATH = path.join(__dirname, '.sync_packages.json');
const packageSyncStore = createPackageSyncStore({
    packageDbPath: PACKAGE_SYNC_DB_PATH,
    apkDbPath: APK_UPLOADED_DB
});

function shouldSkipSyncedPackage(relativePath, fullPath) {
    return packageSyncStore.isSynced(normalizeSyncPath(relativePath), fullPath);
}

function markPackageSynced(relativePath, fullPath) {
    packageSyncStore.markSynced(normalizeSyncPath(relativePath), fullPath);
}
const APP_PACKAGE_EXTENSIONS = new Set([
    '.apk',
    '.aab',
    '.apks',
    '.xapk',
    '.app',
    '.hap',
    '.hsp',
    '.appscope',
    '.ipa',
    '.dmg',
    '.pkg',
    '.msi',
    '.exe'
]);
const APP_DISTRIBUTION_SEGMENT_PATTERN = /(^|[-_.])(app|apps|application|applications|artifact|artifacts|dist|distribution|download|downloads|package|packages|release|releases|build_output)($|[-_.])/i;

function isAppDistributionPath(relativePath) {
    const normalized = normalizeSyncPath(relativePath).toLowerCase();
    const directory = path.posix.dirname(normalized);
    return directory.split('/').some(segment => APP_DISTRIBUTION_SEGMENT_PATTERN.test(segment));
}

function isBlockedAppPackagePath(relativePath) {
    const normalized = normalizeSyncPath(relativePath).toLowerCase();
    return path.extname(normalized) === '.ipa' && path.posix.basename(normalized).includes('citiescapes');
}

function isAppPackagePath(relativePath) {
    const normalized = normalizeSyncPath(relativePath).toLowerCase();
    const ext = path.extname(normalized);
    return APP_PACKAGE_EXTENSIONS.has(ext);
}

// 解析命令行参数
function parseArgs() {
    const args = {
        isWatch: false,
        isHa: false,
        watchOnly: false,
        isAssets: false,
        forceGlassesAssets: false,
        glassesAiAssets: false,
        doubaoGlassesAssets: false,
        glassesPptAssets: false,
        syncMcServer: false,
        hapInstallerOnly: false,
        hearOnly: false,
        survivalDiaryOnly: false,
        survivalDiaryStartOnly: false,
        survivalDiaryReleaseOnly: false,
        glassesAppsOnly: false,
        spaceFightAppsOnly: false,
        spaceFightWebOnly: false,
        exeOnly: false,
        exeFilter: '',
        packagesOnly: false,
        stopWatch: false,
        noApk: false,
        noApiBackup: false,
        termuxIp: null,
        autoDetect: true,
        useWebFallback: false,
        webHost: 'sync.zhengzhengstudio.cn'
    };

    for (const arg of process.argv.slice(2)) {
        if (arg === '--watch' || arg === '-w') {
            args.isWatch = true;
        } else if (arg === '--ha' || arg === '--homeassistant' || arg === '--hass') {
            args.isHa = true;
        } else if (arg === '--watch-only' || arg === '--no-initial-sync') {
            args.watchOnly = true;
            args.isWatch = true;
        } else if (arg === '--assets') {
            args.isAssets = true;
        } else if (arg === '--force-glasses-assets') {
            args.forceGlassesAssets = true;
        } else if (arg === '--glasses-ai-assets') {
            args.glassesAiAssets = true;
        } else if (arg === '--doubao-glasses-assets') {
            args.doubaoGlassesAssets = true;
        } else if (arg === '--glasses-ppt-assets') {
            args.glassesPptAssets = true;
        } else if (arg === '--mc-server') {
            args.syncMcServer = true;
        } else if (arg === '--hap-installer' || arg === '--hap') {
            args.hapInstallerOnly = true;
        } else if (arg === '--hear' || arg === '--hearbridge') {
            args.hearOnly = true;
        } else if (arg === '--survival-diary' || arg === '--survival') {
            args.survivalDiaryOnly = true;
        } else if (arg === '--survival-diary-start' || arg === '--survival-start') {
            args.survivalDiaryOnly = true;
            args.survivalDiaryStartOnly = true;
        } else if (arg === '--survival-diary-release' || arg === '--survival-release') {
            args.survivalDiaryOnly = true;
            args.survivalDiaryReleaseOnly = true;
        } else if (arg === '--glasses-apps') {
            args.glassesAppsOnly = true;
        } else if (arg === '--spacefight-apps') {
            args.spaceFightAppsOnly = true;
        } else if (arg === '--spacefight-web') {
            args.spaceFightWebOnly = true;
        } else if (arg === '--exe' || arg === '--win' || arg === '--windows' || arg === '--win-exe') {
            args.exeOnly = true;
        } else if (arg.startsWith('--exe=')) {
            args.exeOnly = true;
            args.exeFilter = arg.slice('--exe='.length).trim();
        } else if (arg === '--pkgs' || arg === '--packages' || arg === '--apps') {
            args.packagesOnly = true;
        } else if (arg === '--stop-watch') {
            args.stopWatch = true;
        } else if (arg === '--noapk' || arg === '--no-apk' || arg === '--no-packages') {
            args.noApk = true;
        } else if (arg === '--no-api-backup' || arg === '--skip-api-backup') {
            args.noApiBackup = true;
        } else if (arg === '--web' || arg === '--onwebsite') {
            args.useWebFallback = true;
        } else if (arg.startsWith('--web-host=')) {
            args.webHost = arg.split('=')[1];
        } else if (arg.startsWith('--ip=')) {
            args.termuxIp = arg.split('=')[1];
            args.autoDetect = false;
        }
    }

    return args;
}

const args = parseArgs();
let watchProcessLock = null;
let stopActiveWatch = null;
let dailyApiBackupTimer = null;
let watchReconnectTimer = null;
let stopActiveWatchFlush = null;

if (args.stopWatch) {
    let lock = null;
    try {
        lock = JSON.parse(fs.readFileSync(WATCH_LOCK_PATH, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`⚠️ 读取 watch 锁失败: ${error.message}`);
        }
    }

    const ownerPid = Number(lock && lock.pid) || 0;
    const clearLock = () => {
        try {
            fs.rmSync(WATCH_LOCK_PATH, { force: true });
            console.log('✅ watch 锁文件已清理');
        } catch (error) {
            console.warn(`⚠️ 清理 watch 锁文件失败: ${error.message}`);
        }
    };

    if (ownerPid === process.pid) {
        // 同一个进程既带 --stop-watch 又是 watch 主进程：不要自杀也不要删自己的锁
        console.log('ℹ️ 当前进程自身持有 watch 锁，直接 Ctrl+C 即可停止监听。');
        process.exit(0);
    }

    if (ownerPid > 0) {
        // 单发一次 SIGINT 常常打不掉（watch 可能正卡在 IO 或自身 handler），
        // 这里按 SIGINT → SIGTERM → SIGKILL 逐级升级，直到确认进程消失。
        console.log(`🛑 正在结束 watch 进程 PID ${ownerPid} ...`);
        stopProcessGracefully(ownerPid, {
            onStep: signal => console.log(`   ↳ 已发送 ${signal}`)
        }).then(result => {
            if (result.alreadyExited) {
                console.log(`ℹ️ watch 进程 PID ${ownerPid} 已不存在`);
            } else if (result.stopped) {
                console.log(`✅ watch 进程 PID ${ownerPid} 已结束（${result.signal}）`);
            } else {
                console.log(`⚠️ watch 进程 PID ${ownerPid} 仍存活，请手动检查`);
            }
            clearLock();
            process.exit(result.stopped ? 0 : 1);
        });
    } else {
        console.log('ℹ️ 当前没有运行中的 watch 进程');
        clearLock();
        process.exit(0);
    }
}

if (args.isWatch) {
    watchProcessLock = acquireProcessLock(WATCH_LOCK_PATH);
    if (!watchProcessLock.acquired) {
        const owner = watchProcessLock.ownerPid ? ` PID ${watchProcessLock.ownerPid}` : '';
        console.log(`ℹ️ [Watch Mode] 已有监听进程${owner} 正在运行，本次不重复启动。`);
        console.log('💡 当前 watcher 会继续同步文件；如需改为当前终端运行，请执行：');
        console.log('   node sync_to_termux.js --stop-watch');
        process.exit(0);
    }
    process.once('exit', () => watchProcessLock.release());
}

function stopWatchResources() {
    if (stopActiveWatch) {
        stopActiveWatch();
        stopActiveWatch = null;
    }
    stopActiveWatchFlush = null;
    if (dailyApiBackupTimer) {
        clearTimeout(dailyApiBackupTimer);
        dailyApiBackupTimer = null;
    }
    if (watchReconnectTimer) {
        clearTimeout(watchReconnectTimer);
        watchReconnectTimer = null;
    }
    fs.unwatchFile(__filename);
    watchProcessLock?.release();
}

if (args.isWatch) {
    installWatchShutdownHandlers({
        cleanup: stopWatchResources,
        log: () => console.log('\n🛑 [Watch Mode] 已停止监听，正在退出...')
    });
}

function enableWatchSelfReload() {
    if (!args.isWatch) return;

    let restarting = false;
    fs.watchFile(__filename, { interval: 1500 }, (current, previous) => {
        if (restarting || current.mtimeMs === previous.mtimeMs) return;
        restarting = true;
        console.log('\n🔄 [Watch Mode] 同步脚本已更新，正在加载新版本...');
        if (process.env.SYNC_TO_TERMUX_SUPERVISED === '1') {
            watchProcessLock?.release();
            fs.unwatchFile(__filename);
            process.exit(75);
        }

        watchProcessLock?.release();
        const child = spawn(process.execPath, [__filename, ...process.argv.slice(2)], {
            cwd: __dirname,
            env: process.env,
            stdio: 'inherit'
        });
        child.once('spawn', () => {
            fs.unwatchFile(__filename);
            process.exit(0);
        });
        child.once('error', (error) => {
            restarting = false;
            console.error(`[Watch Error] 无法重启同步脚本: ${error.message}`);
        });
    });
}

enableWatchSelfReload();
let TERMUX_IP = args.termuxIp || DEFAULT_TERMUX_IPS[0];
let connectedPort = null;
const PRIMARY_SYNC_PORT = 8110;
let suppressAppPackageSync = args.noApk;

/**
 * 连通性测试
 * @param {boolean} silent - 静默模式，不打印警告
 * @returns {Promise<number|false>} 返回成功的端口号或 false
 */
async function checkConnectivity(silent = false) {
    if (!silent) {
        console.log(`🔍 正在测试与 ${TERMUX_IP} 的连通性...`);
    }
    for (const port of PORTS) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://${TERMUX_IP}:${port}/api/status`, { timeout: 2000 }, (res) => {
                    resolve(true);
                });
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('timeout'));
                });
            });
            console.log(`✅ 端口 ${port} 响应正常`);
            connectedPort = port;
            return port;
        } catch (e) {
            // 继续尝试下一个端口
        }
    }
    if (!silent) {
        console.warn(`⚠️ 警告: 无法连接到 ${TERMUX_IP} 的任何同步端口 (${PORTS.join(', ')})`);
        console.warn(`💡 请确保手机已启动 API 服务 (node server.js 或 node start_termux.js)`);
    }
    return false;
}

async function probeSyncPort(port, timeout = 800) {
    return new Promise((resolve) => {
        const req = http.get(`http://${TERMUX_IP}:${port}/api/status`, { timeout }, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function refreshPrimarySyncPort() {
    if (connectedPort === PRIMARY_SYNC_PORT) return;
    if (await probeSyncPort(PRIMARY_SYNC_PORT)) {
        connectedPort = PRIMARY_SYNC_PORT;
        console.log(`🔁 [Sync] 主端口 ${PRIMARY_SYNC_PORT} 已恢复，自动切回`);
    }
}

async function prepareConnection() {
    // Web 回退模式：只使用公网域名同步，不尝试本地 IP
    if (args.useWebFallback) {
        console.log('🌐 Web 回退模式已启用，直接通过公网域名同步');
        TERMUX_IP = args.webHost;
        console.log(`🎯 目标同步域名: ${TERMUX_IP}`);
        console.log(`------------------------------------------`);
        return true;
    }

    if (args.autoDetect) {
        // 1) 先试上次成功过的地址（换 Wi-Fi/热点后最常命中）
        const lastKnown = readLastTermuxIp();
        if (lastKnown) {
            TERMUX_IP = lastKnown;
            console.log(`📍 尝试上次成功的 IP: ${lastKnown}`);
            if (await checkConnectivity(true)) {
                console.log(`🎯 目标 Termux IP: ${TERMUX_IP}`);
                console.log(`------------------------------------------`);
                console.log(`✅ 端口 ${connectedPort} 响应正常`);
                return true;
            }
        }

        // 2) 再逐个试默认 IP
        let found = false;
        for (const ip of DEFAULT_TERMUX_IPS) {
            TERMUX_IP = ip;
            console.log(`📍 尝试默认 IP: ${ip}`);
            const connected = await checkConnectivity(true);
            if (connected) {
                found = true;
                break;
            }
        }
        if (!found) {
            console.log('🔄 所有默认 IP 连接失败，开始扫描同网段...');
            TERMUX_IP = await scanTermuxDevice();
        }
    } else {
        console.log(`📍 指定 IP: ${TERMUX_IP}`);
    }

    console.log(`🎯 目标 Termux IP: ${TERMUX_IP}`);
    console.log(`------------------------------------------`);

    const connected = await checkConnectivity();
    if (!connected) {
        console.error('❌ 无法连接到 Termux，请确保手机已启动 API 服务');
        if (args.isWatch) {
            // watch 模式不能因为手机临时离线/换网段就退出，否则用户只能手动重开
            scheduleWatchReconnect();
            return false;
        }
        return false;
    }
    rememberTermuxIp(TERMUX_IP);
    return true;
}

/**
 * watch 模式下的后台重连：手机换了 Wi-Fi / 热点导致 IP 变化时自动找回。
 * 每 60s 重新走一遍连接流程（内部会先试上次成功 IP，再扫网段）。
 */
function scheduleWatchReconnect() {
    if (!args.isWatch || watchReconnectTimer) return;
    console.log('⏳ [Watch Mode] 手机暂时连不上，文件监听不会退出，60 秒后自动重连...');
    console.log('💡 期间改文件会先记录下来，连上后一次性补同步。');
    watchReconnectTimer = setTimeout(async () => {
        watchReconnectTimer = null;
        console.log('🔄 [Watch Mode] 正在重新连接 Termux ...');
        const reconnected = await prepareConnection();
        if (reconnected) {
            // 断线期间手机换了 IP，连上后把积压的改动立刻补发
            flushWatchBacklog();
            console.log('✅ [Watch Mode] 已重新连上，watch 继续运行');
        } else {
            scheduleWatchReconnect();
        }
    }, 60000);
    if (typeof watchReconnectTimer.unref === 'function') watchReconnectTimer.unref();
}

// 忽略列表
const IGNORE_LIST = [
    'node_modules',
    '.git',
    '.gradle',
    '.build',
    '.idea',
    'build',
    'DerivedData',
    'xcuserdata',
    '.DS_Store',
    'package-lock.json',
    '.env',
    'data', // 不同步数据文件，避免覆盖手机上的用户数据
    'logs', // 运行时日志目录，Termux 端服务自己在写，别同步
    '.log', // 运行时日志文件（app-YYYY-MM-DD-N.log 等），会被服务持续写入导致同步死循环
    '.icloud',
    '__pycache__',
    '.storage',
    'home-assistant_v2.db',
    'website_termux_deploy.zip', // 排除旧脚本生成的压缩包
    'zhengzheng-glasses-waic2026-kimi 2.pptx', // 排除本地重复 PPT 副本，站点只引用 lite 版本
    'extracted_textures', // 排除提取的纹理文件
    'extracted_models', // 排除提取的模型文件
    'extracted_audio', // 排除提取的音频文件
    'extracted_fonts', // 排除提取的字体文件
    'extracted_materials', // 排除提取的材质文件
    'Supermarket.Simulator-P2P', // 排除提取的模型文件
    'extracted_textures_raw' // 排除提取的原始纹理文件
];

// data 目录通常是 Termux 端运行时数据，默认必须保护。
// 只有这里列出的静态站点数据允许随代码同步。
const STATIC_DATA_SYNC_ALLOWLIST = new Set([
    'api/data/changelogs.json',
    'api/data/recommended_sites.json',
    'api/data/version.json',
    'zhengzhengstudio.cn/memes/data/memes.json'
]);

// 客户端安装包目录默认保护，避免全量同步误覆盖站内包或运行态数据。
// 只有这里列出的发布清单和安装包允许同步到 Termux。
const STATIC_APP_SYNC_ALLOWLIST = new Set([
    'zhengzhengstudio.cn/api/apps/client-downloads.json',
    'zhengzhengstudio.cn/api/apps/HearBridge-Android-latest.apk',
    'zhengzhengstudio.cn/api/apps/HearBridge-Android-v0.1.1.apk',
    'zhengzhengstudio.cn/api/apps/HearBridge-macOS-latest.dmg',
    'zhengzhengstudio.cn/api/apps/HearBridge-macOS-v0.1.1.dmg',
    'zhengzhengstudio.cn/api/apps/HearBridge-macOS-v0.1.0.dmg',
    'zhengzhengstudio.cn/api/apps/HearBridge-iOS-latest-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/HearBridge-iOS-v0.1.1-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/HearBridge-iOS-v0.1.0-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/HearBridge-iOS-install.plist',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-Android-latest.apk',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-Android-v0.1.1.apk',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-macOS-latest.dmg',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-macOS-v0.1.1.dmg',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-macOS-v0.1.0.dmg',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-iOS-latest-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-iOS-v0.1.1-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/download/HearBridge-iOS-v0.1.0-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/MultipleBoardGames-macOS-latest.dmg',
    'zhengzhengstudio.cn/api/apps/MultipleBoardGames-macOS-v1.1.1.dmg',
    'zhengzhengstudio.cn/api/apps/MultipleBoardGames-macOS-v1.1.7-build9-ui2-test.dmg',
    'zhengzhengstudio.cn/api/apps/ZhengZhengBoardGames-HarmonyOS-latest-unsigned.hap',
    'zhengzhengstudio.cn/api/apps/ZhengZhengBoardGames-HarmonyOS-v1.1.5-unsigned.hap',
    'zhengzhengstudio.cn/api/apps/manifest.json',
    'zhengzhengstudio.cn/api/apps/ZhengZhengGlasses-Android-latest.apk',
    'zhengzhengstudio.cn/api/apps/ZhengZhengGlasses-Android-v0.1.10.apk',
    'zhengzhengstudio.cn/api/apps/battery-organizer-macos-latest.dmg',
    'zhengzhengstudio.cn/api/apps/battery-organizer-macos-1.1.8.dmg',
    'zhengzhengstudio.cn/api/apps/battery-organizer-ios-latest.ipa',
    'zhengzhengstudio.cn/api/apps/battery-organizer-ipad-latest.ipa',
    'zhengzhengstudio.cn/api/apps/battery-organizer-ios-ipad-1.1.8.ipa',
    'zhengzhengstudio.cn/api/apps/battery-organizer-harmonyos-latest-unsigned.hap',
    'zhengzhengstudio.cn/api/apps/battery-organizer-harmonyos-1.1.8-unsigned.hap',
    'zhengzhengstudio.cn/api/apps/patches/battery-organizer-1.1.7-to-1.1.8.json',
    'zhengzhengstudio.cn/api/apps/patches/boardgames-1.1.6-to-1.1.7-ui2.json'
]);

const HOME_ASSISTANT_SAFE_FILES = new Set([
    'HomeAssistant/config/configuration.yaml',
    'HomeAssistant/config/secrets.yaml',
    'HomeAssistant/config/automations.yaml',
    'HomeAssistant/config/scripts.yaml',
    'HomeAssistant/config/scenes.yaml'
]);

const HOME_ASSISTANT_SAFE_DIRS = [
    'HomeAssistant/config/custom_components/',
    'HomeAssistant/config/themes/',
    'HomeAssistant/config/blueprints/',
    'HomeAssistant/config/www/',
    'HomeAssistant/patches/'
];

const HOME_ASSISTANT_RUNTIME_PATTERNS = [
    /(^|\/)\.storage(\/|$)/,
    /(^|\/)__pycache__(\/|$)/,
    /(^|\/)deps(\/|$)/,
    /(^|\/)tts(\/|$)/,
    /(^|\/)\.cloud(\/|$)/,
    /(^|\/)home-assistant.*\.log(\.\d+)?$/,
    /(^|\/)home-assistant.*\.db(-shm|-wal)?$/,
    /(^|\/).*\.icloud$/,
    /(^|\/).*\.bak($|[-_.])/,
    /(^|\/)\.HA_VERSION$/,
    /(^|\/)\.ha_run\.lock$/,
    /(^|\/)session\.lock$/
];

const HOME_ASSISTANT_BUNDLE_REMOTE_PATH = '__deploy/homeassistant-safe-sync.tar.gz';
const HOME_ASSISTANT_DEPLOY_REMOTE_PATH = '__deploy/deploy-ha-safe-sync.sh';

let successCount = 0;
let failCount = 0;

function normalizeSyncPath(relativePath) {
    return relativePath.split(path.sep).join('/');
}

function isHomeAssistantPath(relativePath) {
    return normalizeSyncPath(relativePath).startsWith('HomeAssistant/');
}

function isHomeAssistantRuntimePath(relativePath) {
    const normalized = normalizeSyncPath(relativePath);
    return HOME_ASSISTANT_RUNTIME_PATTERNS.some(pattern => pattern.test(normalized));
}

function isSafeHomeAssistantFile(relativePath) {
    const normalized = normalizeSyncPath(relativePath);
    if (!normalized.startsWith('HomeAssistant/')) return false;
    if (isHomeAssistantRuntimePath(normalized)) return false;
    if (HOME_ASSISTANT_SAFE_FILES.has(normalized)) return true;
    return HOME_ASSISTANT_SAFE_DIRS.some(dir => normalized.startsWith(dir));
}

function mayContainSafeHomeAssistantFile(relativePath) {
    const normalized = normalizeSyncPath(relativePath).replace(/\/?$/, '/');
    if (!normalized.startsWith('HomeAssistant/')) return false;
    if (isHomeAssistantRuntimePath(normalized)) return false;
    return (
        [...HOME_ASSISTANT_SAFE_FILES].some(file => file.startsWith(normalized)) ||
        HOME_ASSISTANT_SAFE_DIRS.some(dir => dir.startsWith(normalized) || normalized.startsWith(dir))
    );
}

function isAllowedStaticDataFile(relativePath) {
    return STATIC_DATA_SYNC_ALLOWLIST.has(normalizeSyncPath(relativePath));
}

function isAllowedStaticAppFile(relativePath) {
    const normalized = normalizeSyncPath(relativePath);
    const extension = path.extname(normalized).toLowerCase();
    if (isBlockedAppPackagePath(normalized)) return false;
    return (
        STATIC_APP_SYNC_ALLOWLIST.has(normalized) ||
        // 所有 App 发布相关目录下的安装包，无需逐个产品维护文件名。
        (isAppDistributionPath(normalized) && APP_PACKAGE_EXTENSIONS.has(extension)) ||
        // patches 配置
        /^zhengzhengstudio\.cn\/api\/apps\/patches\/boardgames-[\w.-]+\.json$/i.test(normalized)
    );
}

function mayContainAllowedStaticData(relativePath) {
    const dir = normalizeSyncPath(relativePath).replace(/\/?$/, '/');
    return [...STATIC_DATA_SYNC_ALLOWLIST].some(file => file.startsWith(dir));
}

function mayContainAllowedStaticApp(relativePath) {
    const dir = normalizeSyncPath(relativePath).replace(/\/?$/, '/');
    return (
        [...STATIC_APP_SYNC_ALLOWLIST].some(file => file.startsWith(dir)) ||
        dir.split('/').some(segment => APP_DISTRIBUTION_SEGMENT_PATTERN.test(segment)) ||
        'api/apps/'.startsWith(dir) ||
        'zhengzhengstudio.cn/api/apps/'.startsWith(dir) ||
        dir === 'zhengzhengstudio.cn/api/apps/'
    );
}

function isRuntimeDataPath(relativePath) {
    return /(^|\/)data(\/|$)/.test(normalizeSyncPath(relativePath));
}

function isProtectedAppPackagePath(relativePath) {
    return normalizeSyncPath(relativePath).startsWith('zhengzhengstudio.cn/api/apps/');
}

function isIgnoredSyncPath(relativePath) {
    const segments = normalizeSyncPath(relativePath).split('/').filter(Boolean);
    return IGNORE_LIST.some(ignore => {
        if (ignore === '.log') {
            return segments.some(segment => segment.endsWith('.log') || segment.includes('.log.'));
        }
        if (ignore === '.icloud') {
            return segments.some(segment => segment.endsWith('.icloud'));
        }
        if (ignore === '.env') {
            return segments.some(segment => segment === '.env' || segment.startsWith('.env.'));
        }
        return segments.some(segment => segment === ignore);
    });
}

function shouldSkipSyncPath(relativePath, basename, stats) {
    if (!stats.isDirectory() && isBlockedAppPackagePath(relativePath)) {
        return true;
    }

    if (suppressAppPackageSync && isAppPackagePath(relativePath)) {
        return true;
    }

    if (isHomeAssistantPath(relativePath)) {
        return stats.isDirectory()
            ? !mayContainSafeHomeAssistantFile(relativePath)
            : !isSafeHomeAssistantFile(relativePath);
    }

    if (isAllowedStaticDataFile(relativePath)) return false;
    if (isAllowedStaticAppFile(relativePath)) return false;
    if (isProtectedAppPackagePath(relativePath)) {
        return stats.isDirectory()
            ? !mayContainAllowedStaticApp(relativePath)
            : true;
    }

    // Watch events arrive for leaf files, so inspect every path segment. Checking only
    // the basename allowed .git/objects/<hash> and worktree metadata to leak through.
    const ignoredByName = isIgnoredSyncPath(relativePath);
    if (ignoredByName) {
        return !(stats.isDirectory() && (mayContainAllowedStaticData(relativePath) || mayContainAllowedStaticApp(relativePath)));
    }

    return isRuntimeDataPath(relativePath);
}

function toProotHomeAssistantPath(relativePath) {
    const normalized = normalizeSyncPath(relativePath);
    const configPrefix = 'HomeAssistant/config/';
    const patchesPrefix = 'HomeAssistant/patches/';

    if (normalized.startsWith(configPrefix)) {
        return `/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs/root/.homeassistant/config/${normalized.slice(configPrefix.length)}`;
    }
    if (normalized.startsWith(patchesPrefix)) {
        return `/data/data/com.termux/files/home/website/HomeAssistant/patches/${normalized.slice(patchesPrefix.length)}`;
    }
    return null;
}

function signAdminToken(username) {
    const payload = Buffer.from(JSON.stringify({
        username,
        exp: Date.now() + 12 * 60 * 60 * 1000
    })).toString('base64url');
    const signature = crypto
        .createHmac('sha256', ADMIN_KEY)
        .update(payload)
        .digest('base64url');
    return `${payload}.${signature}`;
}

async function runTermuxCommand(command, timeout = 30000) {
    if (!connectedPort && !args.useWebFallback) return false;

    return new Promise((resolve) => {
        const postData = JSON.stringify({
            command,
            cwd: '/data/data/com.termux/files/home',
            timeoutMs: Math.min(timeout, 30000)
        });

        const client = args.useWebFallback ? https : http;
        const req = client.request({
            hostname: args.useWebFallback ? args.webHost : TERMUX_IP,
            port: args.useWebFallback ? 443 : connectedPort,
            path: '/api/admin/termux/command',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'x-admin-username': encodeURIComponent(ADMIN_USERNAME),
                'x-admin-token': signAdminToken(ADMIN_USERNAME)
            },
            timeout
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.warn(`[HA Apply] 命令接口返回 ${res.statusCode}: ${data.slice(0, 300)}`);
                    resolve(false);
                    return;
                }
                try {
                    const result = JSON.parse(data);
                    if (result.stdout) console.log(`[Remote] ${String(result.stdout).trim().slice(0, 2000)}`);
                    if (result.stderr) console.warn(`[Remote stderr] ${String(result.stderr).trim().slice(0, 2000)}`);
                    if (result.success === false || result.exitCode) {
                        console.warn(`[HA Apply] 命令失败: ${result.stderr || result.error || data}`);
                        resolve(false);
                        return;
                    }
                } catch (e) {
                    // Older endpoints may return plain text; status 200 is enough.
                }
                resolve(true);
            });
        });

        req.on('error', (err) => {
            console.warn(`[HA Apply] 命令请求失败: ${err.message}`);
            resolve(false);
        });
        req.on('timeout', () => {
            req.destroy();
            console.warn('[HA Apply] 命令请求超时');
            resolve(false);
        });

        req.write(postData);
        req.end();
    });
}

function getBackupTargets() {
    if (args.useWebFallback) {
        return [{ hostname: args.webHost, port: 443, protocol: 'https', label: 'Web' }];
    }
    const ports = new Set([...API_BACKUP_PORTS, connectedPort].filter(Boolean));
    return Array.from(ports).map(port => ({ hostname: TERMUX_IP, port, protocol: 'http', label: `端口 ${port}` }));
}

function getFilenameFromDisposition(disposition) {
    const value = String(disposition || '');
    const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const match = value.match(/filename="?([^";]+)"?/i);
    return match ? match[1] : '';
}

function buildFallbackBackupName(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const label = String(reason || 'manual').replace(/[^a-z0-9_-]/gi, '-').slice(0, 32) || 'manual';
    return `zhengzheng-api-${label}-${stamp}.zip`;
}

function isProcessRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

function acquireApiBackupLock() {
    fs.mkdirSync(API_BACKUP_DIR, { recursive: true });
    const token = crypto.randomBytes(12).toString('hex');

    try {
        const current = JSON.parse(fs.readFileSync(API_BACKUP_LOCK_PATH, 'utf8'));
        if (isProcessRunning(Number(current.pid))) {
            console.log(`ℹ️ [API Backup] 已由进程 ${current.pid} 执行，本次跳过重复备份`);
            return null;
        }
        fs.rmSync(API_BACKUP_LOCK_PATH, { force: true });
    } catch (error) {
        if (error.code !== 'ENOENT') {
            try { fs.rmSync(API_BACKUP_LOCK_PATH, { force: true }); } catch {}
        }
    }

    try {
        fs.writeFileSync(API_BACKUP_LOCK_PATH, JSON.stringify({
            pid: process.pid,
            token,
            startedAt: new Date().toISOString()
        }), { flag: 'wx' });
        return token;
    } catch (error) {
        if (error.code === 'EEXIST') {
            console.log('ℹ️ [API Backup] 另一个同步进程已开始备份，本次跳过');
            return null;
        }
        console.warn(`⚠️ [API Backup] 无法建立备份锁: ${error.message}`);
        return null;
    }
}

function releaseApiBackupLock(token) {
    try {
        const current = JSON.parse(fs.readFileSync(API_BACKUP_LOCK_PATH, 'utf8'));
        if (current.token === token) fs.rmSync(API_BACKUP_LOCK_PATH, { force: true });
    } catch {}
}

function readApiBackupThrottleState() {
    try {
        const state = JSON.parse(fs.readFileSync(API_BACKUP_THROTTLE_STATE_PATH, 'utf8'));
        return Number.isFinite(state.lastCompletedAt) ? state : { lastCompletedAt: 0 };
    } catch {
        return { lastCompletedAt: 0 };
    }
}

function writeApiBackupThrottleState(state) {
    try {
        fs.mkdirSync(API_BACKUP_DIR, { recursive: true });
        fs.writeFileSync(API_BACKUP_THROTTLE_STATE_PATH, JSON.stringify(state, null, 2));
    } catch (error) {
        console.warn(`⚠️ [API Backup] 无法记录备份节流状态: ${error.message}`);
    }
}

function shouldSkipApiBackupByThrottle(reason) {
    if (!API_BACKUP_THROTTLED_REASONS.has(reason)) return false;

    const state = readApiBackupThrottleState();
    if (!state.lastCompletedAt) return false;

    const elapsed = Date.now() - state.lastCompletedAt;
    if (elapsed < API_BACKUP_THROTTLE_MS) {
        const nextAt = new Date(state.lastCompletedAt + API_BACKUP_THROTTLE_MS);
        console.log(
            `ℹ️ [API Backup] 距上次成功备份不足 ${API_BACKUP_THROTTLE_DAYS} 天`
            + `（${new Date(state.lastCompletedAt).toLocaleString()}），本次自动备份跳过；`
            + `下次可备份时间 ${nextAt.toLocaleString()}`
        );
        return true;
    }
    return false;
}

function markApiBackupCompleted() {
    writeApiBackupThrottleState({ lastCompletedAt: Date.now() });
}

async function downloadTermuxApiBackup(reason = 'sync-complete') {
    if (args.noApiBackup) return false;

    if (shouldSkipApiBackupByThrottle(reason)) return false;

    const targets = getBackupTargets();
    if (!targets.length) {
        console.warn('⚠️ [API Backup] 未连接 Termux，跳过本次 API 备份');
        return false;
    }

    const lockToken = acquireApiBackupLock();
    if (!lockToken) return false;

    console.log(`🗄️ [API Backup] 正在让 Termux 打包 API 并保存到 ${API_BACKUP_DIR}...`);

    const requestPath = `${API_BACKUP_ENDPOINT}?reason=${encodeURIComponent(reason)}`;

    try {
        for (const target of targets) {
            const saved = await new Promise((resolve) => {
                let settled = false;
                let tempPath = '';
                let output = null;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    if (!value && tempPath) {
                        try { fs.rmSync(tempPath, { force: true }); } catch {}
                    }
                    resolve(value);
                };

                const client = target.protocol === 'https' ? https : http;
                const req = client.request({
                    hostname: target.hostname,
                    port: target.port,
                    path: requestPath,
                    method: 'GET',
                    headers: {
                        'Accept': 'application/zip',
                        'x-admin-username': encodeURIComponent(ADMIN_USERNAME),
                        'x-admin-token': signAdminToken(ADMIN_USERNAME)
                    },
                    timeout: 120000
                }, (res) => {
                    res.setTimeout(120000, () => res.destroy(new Error('backup response timeout')));
                    if (res.statusCode !== 200) {
                        let body = '';
                        res.setEncoding('utf8');
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            console.warn(`[API Backup] ${target.label} 返回 ${res.statusCode}: ${body.slice(0, 300)}`);
                            finish(false);
                        });
                        return;
                    }

                    const fileName = path.basename(getFilenameFromDisposition(res.headers['content-disposition']) || buildFallbackBackupName(reason));
                    const finalPath = path.join(API_BACKUP_DIR, fileName);
                    tempPath = `${finalPath}.part`;
                    output = fs.createWriteStream(tempPath);
                    let bytes = 0;

                    res.on('data', chunk => {
                        bytes += chunk.length;
                        if (bytes > API_BACKUP_MAX_BYTES) {
                            res.destroy(new Error('API backup exceeds 512MB safety limit'));
                        }
                    });
                    res.on('error', error => {
                        if (output) output.destroy();
                        console.warn(`[API Backup] ${target.label} 数据流失败: ${error.message}`);
                        finish(false);
                    });
                    res.pipe(output);
                    output.on('finish', () => {
                        output.close(() => {
                            try {
                                fs.renameSync(tempPath, finalPath);
                                console.log(`✅ [API Backup] 已保存: ${finalPath} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
                                finish(true);
                            } catch (error) {
                                console.warn(`[API Backup] 保存失败: ${error.message}`);
                                finish(false);
                            }
                        });
                    });
                    output.on('error', (error) => {
                        console.warn(`[API Backup] 写入失败: ${error.message}`);
                        finish(false);
                    });
                });

                req.on('timeout', () => req.destroy(new Error('backup request timeout')));
                req.on('error', (error) => {
                    console.warn(`[API Backup] ${target.label} 下载失败: ${error.message}`);
                    finish(false);
                });
                req.end();
            });
            if (saved) {
                markApiBackupCompleted();
                return true;
            }
        }

        console.warn('[API Backup] 所有 API 备份端口都失败');
        return false;
    } finally {
        releaseApiBackupLock(lockToken);
    }
}

function getNextDailyBackupDelay() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(API_BACKUP_DAILY_HOUR, API_BACKUP_DAILY_MINUTE, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
}

function scheduleDailyApiBackup() {
    if (args.noApiBackup) return;
    const delay = getNextDailyBackupDelay();
    const next = new Date(Date.now() + delay);
    console.log(`🗓️ [API Backup] 下一次自动备份: ${next.toLocaleString()}（每天 20:00）`);
    dailyApiBackupTimer = setTimeout(async () => {
        dailyApiBackupTimer = null;
        try {
            await downloadTermuxApiBackup(API_BACKUP_DAILY_REASON);
        } catch (error) {
            console.warn(`⚠️ [API Backup] 定时备份失败: ${error.message}`);
        } finally {
            if (args.isWatch) console.log('👀 [Watch Mode] 备份任务已结束，文件监听仍在运行');
            scheduleDailyApiBackup();
        }
    }, delay);
}

let dailyApiBackupScheduled = false;

function ensureDailyApiBackupScheduled() {
    if (dailyApiBackupScheduled || args.noApiBackup) return;
    dailyApiBackupScheduled = true;
    scheduleDailyApiBackup();
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function applyHomeAssistantFile(relativePath) {
    const normalized = normalizeSyncPath(relativePath);
    const remoteSource = `/data/data/com.termux/files/home/website/${normalized}`;
    const remoteTarget = toProotHomeAssistantPath(normalized);
    if (!remoteTarget) return true;

    const command = [
        `mkdir -p ${shellQuote(path.posix.dirname(remoteTarget))}`,
        `cp ${shellQuote(remoteSource)} ${shellQuote(remoteTarget)}`
    ].join(' && ');

    const ok = await runTermuxCommand(command);
    if (ok) {
        console.log(`[HA Apply] 已应用到 proot: ${normalized}`);
    }
    return ok;
}

function copyFileForBundle(sourceRoot, bundleRoot, relativePath) {
    const normalized = normalizeSyncPath(relativePath);
    const source = path.join(sourceRoot, normalized);
    const target = path.join(bundleRoot, normalized);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

function collectSafeHomeAssistantFiles(localRoot, currentRelative = 'HomeAssistant') {
    const absolute = path.join(localRoot, currentRelative);
    if (!fs.existsSync(absolute)) return [];

    const stats = fs.statSync(absolute);
    if (shouldSkipSyncPath(currentRelative, path.basename(currentRelative), stats)) {
        return [];
    }

    if (stats.isFile()) {
        return [normalizeSyncPath(currentRelative)];
    }

    const files = [];
    for (const entry of fs.readdirSync(absolute)) {
        const childRelative = path.join(currentRelative, entry);
        files.push(...collectSafeHomeAssistantFiles(localRoot, childRelative));
    }
    return files;
}

function removeDirQuietly(dir) {
    if (!dir || !fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

function createHomeAssistantBundle() {
    const websiteRoot = path.join(__dirname, 'website');
    const files = collectSafeHomeAssistantFiles(websiteRoot);
    if (files.length === 0) {
        console.log('ℹ️ [HA Bundle] 没有可同步的 HomeAssistant 白名单文件');
        return null;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-safe-sync-'));
    const bundleRoot = path.join(tempRoot, 'bundle');
    const archivePath = path.join(tempRoot, 'homeassistant-safe-sync.tar.gz');

    fs.mkdirSync(bundleRoot, { recursive: true });
    for (const file of files) {
        copyFileForBundle(websiteRoot, bundleRoot, file);
    }

    const tarArgs = ['--no-xattrs', '-czf', archivePath, '-C', bundleRoot, 'HomeAssistant'];
    const tarEnv = {
        ...process.env,
        COPYFILE_DISABLE: '1',
        LC_ALL: 'C',
        LANG: 'C'
    };
    try {
        execFileSync('tar', tarArgs, { env: tarEnv });
    } catch (error) {
        execFileSync('tar', ['-czf', archivePath, '-C', bundleRoot, 'HomeAssistant'], { env: tarEnv });
    }
    return { archivePath, tempRoot, files };
}

function createHomeAssistantDeployScript(tempRoot) {
    const scriptPath = path.join(tempRoot, 'deploy-ha-safe-sync.sh');
    const remoteArchive = `/data/data/com.termux/files/home/website/${HOME_ASSISTANT_BUNDLE_REMOTE_PATH}`;
    const prootConfig = '/data/data/com.termux/files/usr/var/lib/proot-distro/containers/ubuntu/rootfs/root/.homeassistant/config';
    const patchesTarget = '/data/data/com.termux/files/home/website/HomeAssistant/patches';

    fs.writeFileSync(scriptPath, [
        '#!/data/data/com.termux/files/usr/bin/sh',
        'set -eu',
        `archive=${shellQuote(remoteArchive)}`,
        `proot_config=${shellQuote(prootConfig)}`,
        `patches_target=${shellQuote(patchesTarget)}`,
        'mkdir -p "$proot_config" "$patches_target"',
        'tar -xzf "$archive" -C "$proot_config" --strip-components=2 HomeAssistant/config',
        'tar -xzf "$archive" -C "$patches_target" --strip-components=2 HomeAssistant/patches 2>/dev/null || true',
        'echo "deployed"',
        ''
    ].join('\n'), 'utf8');

    return scriptPath;
}

async function syncHomeAssistantBundle() {
    const bundle = createHomeAssistantBundle();
    if (!bundle) return;

    try {
        console.log(`📦 [HA Bundle] 打包 ${bundle.files.length} 个白名单文件，准备一次性上传部署...`);
        const uploaded = await syncFile(HOME_ASSISTANT_BUNDLE_REMOTE_PATH, bundle.archivePath, 3, 1000);
        if (!uploaded) return;

        const deployScript = createHomeAssistantDeployScript(bundle.tempRoot);
        const scriptUploaded = await syncFile(HOME_ASSISTANT_DEPLOY_REMOTE_PATH, deployScript, 3, 1000);
        if (!scriptUploaded) return;

        const remoteScript = `/data/data/com.termux/files/home/website/${HOME_ASSISTANT_DEPLOY_REMOTE_PATH}`;
        const applied = await runTermuxCommand(`sh ${shellQuote(remoteScript)}`, 120000);
        if (applied) {
            console.log('✅ [HA Bundle] 已一次性部署到 Termux/proot');
        }
    } finally {
        removeDirQuietly(bundle.tempRoot);
    }
}

function isProtectedGlassesImage(relativePath) {
    return /^glasses\.zhengzhengstudio\.cn\/assets\/.+\.(png|jpe?g|webp|gif)$/i.test(relativePath);
}

function isGlassesSiteIcon(relativePath) {
    return /^glasses\.zhengzhengstudio\.cn\/assets\/(app-icon(-1024)?|apple-touch-icon|favicon(-16|-32)?)\.png$/i.test(relativePath);
}

function isGlassesAiImage(relativePath) {
    return /^glasses\.zhengzhengstudio\.cn\/assets\/glasses-frame-ai-\d{2}\.png$/i.test(relativePath);
}

function isDoubaoGlassesImage(relativePath) {
    const match = relativePath.match(/^glasses\.zhengzhengstudio\.cn\/assets\/glasses-frame-ai-(\d{2})\.png$/i);
    if (!match) return false;
    const slot = Number(match[1]);
    return slot >= 18 && slot <= 72;
}

function isGlassesPptAsset(relativePath) {
    return /^glasses\.zhengzhengstudio\.cn\/assets\/ppt\/preview-(kimi|private-v2)\/slide-\d{2}\.png$/i.test(relativePath);
}

async function trySyncChunked(target, relativePath, fullLocalPath, options = {}) {
    const CHUNK_SIZE = options.chunkSize || 4 * 1024 * 1024;
    const fileSize = fs.statSync(fullLocalPath).size;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    const uploadId = crypto.createHash('sha256')
        .update(`${relativePath}:${fileSize}:${fs.statSync(fullLocalPath).mtimeMs}`)
        .digest('hex')
        .slice(0, 24);
    const { hostname, port, protocol, label } = target;
    const isHttps = protocol === 'https';
    const client = isHttps ? https : http;

    const handle = fs.openSync(fullLocalPath, 'r');
    try {
        for (let i = 0; i < totalChunks; i++) {
            const offset = i * CHUNK_SIZE;
            const length = Math.min(CHUNK_SIZE, fileSize - offset);
            const chunk = Buffer.allocUnsafe(length);
            fs.readSync(handle, chunk, 0, length, offset);
            const chunkBase64 = chunk.toString('base64');
            const postData = JSON.stringify({
                secret: SYNC_SECRET,
                relativePath,
                uploadId,
                chunkIndex: i,
                totalChunks,
                chunk: chunkBase64,
                noOverwrite: Boolean(options.noOverwrite),
                isLast: i === totalChunks - 1
            });

            const ok = await new Promise((resolve) => {
                const requestOptions = {
                    hostname,
                    port,
                    path: '/api/internal/sync-file-chunk',
                    method: 'POST',
                    headers: {
                        'X-Sync-Secret': SYNC_SECRET,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: isHttps ? 180000 : 120000
                };
                const req = client.request(requestOptions, (res) => {
                    let data = '';
                    res.on('data', (c) => data += c);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(true);
                        } else {
                            console.log(`[分块失败] ${label} chunk ${i + 1}/${totalChunks} 状态码: ${res.statusCode}`);
                            if (data) console.log(`   响应: ${data.substring(0, 100)}`);
                            resolve(false);
                        }
                    });
                });
                req.on('error', (err) => {
                    console.log(`[分块错误] ${label} chunk ${i + 1}/${totalChunks}: ${err.message}`);
                    resolve(false);
                });
                req.on('timeout', () => { req.destroy(); resolve(false); });
                req.write(postData);
                req.end();
            });

            if (!ok) return false;
        }
    } finally {
        fs.closeSync(handle);
    }

    console.log(`[成功] ${label} | 已同步: ${relativePath} (分块 ${totalChunks})`);
    successCount++;
    return true;
}

async function trySync(target, relativePath, fullLocalPath, options = {}) {
    return new Promise((resolve) => {
        const content = fs.readFileSync(fullLocalPath);
        const base64Content = content.toString('base64');
        const postData = JSON.stringify({
            relativePath,
            content: base64Content,
            encoding: 'base64',
            noOverwrite: Boolean(options.noOverwrite),
            secret: SYNC_SECRET
        });

        const { hostname, port, protocol, label } = target;
        const isHttps = protocol === 'https';
        const client = isHttps ? https : http;
        const requestOptions = {
            hostname,
            port,
            path: '/api/internal/sync-file',
            method: 'POST',
            headers: {
                'X-Sync-Secret': SYNC_SECRET,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: isHttps ? 60000 : 5000
        };

        const req = client.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    if (!isHttps) connectedPort = port;
                    console.log(`[成功] ${label} | 已同步: ${relativePath}`);
                    successCount++;
                    resolve(true);
                } else if (res.statusCode === 429) {
                    console.log(`[被拦截] ${label} 返回 429 (Too Many Requests) | ${relativePath}`);
                    const retryAfter = Math.max(5, Number.parseInt(res.headers['retry-after'], 10) || 5);
                    resolve({ rateLimited: true, retryAfter });
                } else if (res.statusCode === 403) {
                    let errorDetail = '未知 403 错误';
                    try {
                        const errorData = JSON.parse(data);
                        if (errorData.error === 'Unauthorized sync') {
                            errorDetail = '❌ SYNC_SECRET 密钥不匹配！请检查 sync_to_termux.js 和 server.js 中的 SYNC_SECRET 是否一致';
                        } else if (errorData.error?.includes?.('Access Denied') || data.includes('Access Denied')) {
                            errorDetail = `❌ IP ${TERMUX_IP} 不在白名单中！请在 Termux 中运行: node ip-whitelist.js add ${TERMUX_IP}`;
                        } else if (errorData.error) {
                            errorDetail = `❌ 权限错误: ${errorData.error}`;
                        }
                    } catch (e) {
                        if (data.includes('Access Denied')) {
                            errorDetail = `❌ IP ${TERMUX_IP} 不在白名单中！请在 Termux 中运行: node ip-whitelist.js add ${TERMUX_IP}`;
                        } else {
                            errorDetail = `❌ 403 Forbidden: ${data}`;
                        }
                    }
                    console.log(`[拒绝] ${label} | ${relativePath}`);
                    console.log(`   ${errorDetail}`);
                    resolve(false);
                } else if (res.statusCode === 413) {
                    console.log(`[跳过大文件] ${label} 返回 413 (文件太大) | ${relativePath}`);
                    resolve({ skip: true, reason: 'entity_too_large' });
                } else {
                    console.log(`[重试] ${label} 返回状态码: ${res.statusCode} | ${relativePath}`);
                    if (data) {
                        console.log(`   响应内容: ${data.substring(0, 100)}`);
                    }
                    resolve(false);
                }
            });
        });

        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                // 拒绝连接通常意味着端口没开
            } else if (err.code === 'ETIMEDOUT') {
                console.log(`[超时] ${label} 连接超时，请检查 IP 是否正确或手机是否在同一网络`);
            } else if (err.code === 'EPIPE' || err.message?.includes('socket hang up')) {
                console.log(`[跳过] ${label} 连接中断 | ${relativePath}`);
                resolve({ skip: true, reason: 'socket_hang_up' });
                return;
            } else {
                console.log(`[错误] ${label} 网络错误: ${err.message}`);
            }
            resolve(false);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        req.write(postData);
        req.end();
    });
}

const syncFile = async (relativePath, fullLocalPath, maxRetries = 3, retryDelay = 0, options = {}) => {
    if (isBlockedAppPackagePath(relativePath)) {
        console.log(`[跳过] ${relativePath} (Citiescapes 游戏 IPA 不允许同步)`);
        return true;
    }

    if (suppressAppPackageSync && isAppPackagePath(relativePath)) {
        console.log(`[跳过] ${relativePath} (--noapk 排除安装包)`);
        return true;
    }

    if (!fs.existsSync(fullLocalPath)) {
        console.error(`[错误] 找不到本地文件: ${fullLocalPath}`);
        failCount++;
        return false;
    }

    const stats = fs.statSync(fullLocalPath);
    const isPackage = isAppPackagePath(relativePath);
    // 所有安装包统一去重；只有文件大小或修改时间变化时才重新上传。
    if (isPackage && !options.force && shouldSkipSyncedPackage(relativePath, fullLocalPath)) {
        console.log(`[跳过] ${relativePath} (安装包已上传且未变化)`);
        return true;
    }

    const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB
    const isLargeFile = isPackage || stats.size > LARGE_FILE_THRESHOLD;

    let attempts = 0;
    let wasBlocked = false;  // 在循环外部定义，以便循环结束后可以访问
    while (attempts < maxRetries) {
        attempts++;
        await refreshPrimarySyncPort();
        
        let retryAfter = 0;
        const preferredPorts = connectedPort
            ? [connectedPort, ...SYNC_PORTS.filter(port => port !== connectedPort)]
            : SYNC_PORTS;
        
        const localTargets = preferredPorts.map(port => ({
            hostname: TERMUX_IP,
            port,
            protocol: 'http',
            label: `端口 ${port}`
        }));
        const webTarget = { hostname: args.webHost, port: 443, protocol: 'https', label: 'Web 回退' };
        const targets = args.useWebFallback ? [webTarget] : localTargets;
        
        for (const target of targets) {
            let result;
            if (isLargeFile && isPackage) {
                // 安装包在局域网和 Web 模式都走分块，避免大请求超时。
                const chunkSize = 4 * 1024 * 1024;
                const ok = await trySyncChunked(target, relativePath, fullLocalPath, { ...options, chunkSize });
                if (ok) {
                    markPackageSynced(normalizeSyncPath(relativePath), fullLocalPath);
                    return true;
                }
                console.log(`[重试] ${relativePath}（分块接口暂不可用，切换目标或稍后重试）`);
                continue;
            } else {
                result = await trySync(target, relativePath, fullLocalPath, options);
            }
            if (result === true) {
                if (isAppPackagePath(relativePath)) markPackageSynced(normalizeSyncPath(relativePath), fullLocalPath);
                return true;
            } else if (result?.skip) {
                console.log(`[跳过] ${relativePath}，原因: ${result.reason === 'entity_too_large' ? '文件太大' : '连接中断'}`);
                failCount++;
                return false;
            } else if (result?.blocked) {
                wasBlocked = true;
                retryAfter = result.retryAfter || 30;
                break;
            } else if (result?.rateLimited) {
                retryAfter = result.retryAfter;
                break;
            }
        }

        
        // 计算退避延迟（指数退避）
        const backoffDelay = Math.min(
            BAN_RECOVERY_CONFIG.baseRetryDelay * Math.pow(2, attempts - 1),
            BAN_RECOVERY_CONFIG.maxRetryDelay
        );
        
        if (wasBlocked && attempts < maxRetries) {
            console.log(`⏳ [封禁等待] IP 被封禁，${backoffDelay / 1000} 秒后自动重试 (第 ${attempts}/${maxRetries} 次)`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            
            // 在重试前尝试解封
            if (attempts > 1) {
                console.log(`🔓 尝试自动解封...`);
                await tryUnblockIP();
            }
        } else if (args.useWebFallback) {
            // Web 模式下任何失败都直接跳过，不重试，避免停顿
            console.log(`[跳过] ${relativePath}（Web 同步失败）`);
            failCount++;
            return false;
        } else if (retryAfter > 0 && attempts < maxRetries) {
            console.log(`⏳ [限流等待] 触发速率限制，${retryAfter} 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        } else if (attempts < maxRetries && retryDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
            break;
        }
    }

    console.error(`[失败] 无法同步到任何端口: ${relativePath}`);
    failCount++;
    
    // 如果是被封禁导致的失败，提供手动解封建议
    if (wasBlocked) {
        console.log(`💡 手动解封建议:`);
        console.log(`   1. 在 Termux 中执行: node ip-whitelist.js add <你的IP>`);
        console.log(`   2. 或访问管理员页面手动解除封禁`);
        console.log(`   3. 等待 ${BAN_RECOVERY_CONFIG.maxRetryDelay / 1000} 秒后自动重试`);
    }
    
    return false;
};

const syncHomeAssistantFile = async (relativePath, fullLocalPath, maxRetries = 1, retryDelay = 0, options = {}) => {
    const normalized = normalizeSyncPath(relativePath);
    const ok = await syncFile(normalized, fullLocalPath, maxRetries, retryDelay, options);
    if (!ok) return false;
    return applyHomeAssistantFile(normalized);
};

const syncDir = async (dirRelativePath, options = {}) => {
    const fullLocalPath = path.join(__dirname, 'website', dirRelativePath);
    if (!fs.existsSync(fullLocalPath)) return;

    const files = fs.readdirSync(fullLocalPath);
    for (const file of files) {
        const relativePath = path.join(dirRelativePath, file);
        const localPath = path.join(fullLocalPath, file);
        const stats = fs.statSync(localPath);

        if (/-chroma-v\d+\.png$/i.test(file)) continue;
        if (shouldSkipSyncPath(relativePath, file, stats)) continue;

        if (stats.isDirectory()) {
            // 非 assets 模式时跳过大站 assets；眼镜站图片文件默认保护，避免覆盖 Termux 端资源。
            const shouldKeepGlassesAssets = dirRelativePath === 'glasses.zhengzhengstudio.cn';
            if (!args.isAssets && !options.includeAssets && file === 'assets' && !shouldKeepGlassesAssets) {
                continue;
            }
            await syncDir(relativePath, options);
        } else {
            if (isProtectedGlassesImage(relativePath) && !args.forceGlassesAssets) {
                if (isGlassesSiteIcon(relativePath)) {
                    await syncFile(relativePath, localPath);
                    continue;
                }
                if (args.doubaoGlassesAssets && isDoubaoGlassesImage(relativePath)) {
                    await syncFile(relativePath, localPath);
                    continue;
                }
                if (args.glassesAiAssets && isGlassesAiImage(relativePath)) {
                    await syncFile(relativePath, localPath, 1, 0, { noOverwrite: true });
                }
                if (args.glassesPptAssets && isGlassesPptAsset(relativePath)) {
                    await syncFile(relativePath, localPath);
                }
                continue;
            }
            if (isRuntimeDataPath(relativePath) && !isAllowedStaticDataFile(relativePath)) continue;
            if (isProtectedAppPackagePath(relativePath) && !isAllowedStaticAppFile(relativePath)) continue;
            if (isHomeAssistantPath(relativePath)) {
                await syncHomeAssistantFile(relativePath, localPath);
            } else {
                await syncFile(relativePath, localPath);
            }
        }
    }
};

const syncLocalDir = async (localRoot, remoteRoot, options = {}) => {
    if (!fs.existsSync(localRoot)) {
        console.log(`ℹ️ [Config] 跳过不存在目录: ${localRoot}`);
        return;
    }

    const deferredEntries = new Set(options.entryFilesLast || []);
    const entries = fs.readdirSync(localRoot).sort((left, right) => {
        const leftDeferred = deferredEntries.has(left);
        const rightDeferred = deferredEntries.has(right);
        if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
        return left.localeCompare(right);
    });
    for (const entry of entries) {
        if (entry === '.DS_Store' || entry === 'session.lock' || entry.endsWith('.icloud')) continue;
        if (options.skipTopLevel?.includes(entry)) continue;

        const localPath = path.join(localRoot, entry);
        const remotePath = path.join(remoteRoot, entry);
        const stats = fs.statSync(localPath);

        if (stats.isDirectory()) {
            await syncLocalDir(localPath, remotePath, options);
        } else {
            const synced = await syncFile(remotePath, localPath);
            if (!synced && options.failFast) {
                throw new Error(`目录发布中止，文件同步失败: ${remotePath}`);
            }
        }
    }
};

// ---------------------------------------------------------------------------
// 桌面端安装包（.exe）定向上传
// ---------------------------------------------------------------------------
// Windows 构建产物由 electron-builder 输出到项目自己的 dist/ 目录，不在 website/ 内，
// 常规目录同步与 watch 的 website 扫描都覆盖不到。这里显式声明构建产物根目录，
// 支持「只上传 .exe」的定向模式，以及 watch 阶段的产物自动上传。
const DESKTOP_PACKAGE_SOURCES = [
    {
        id: 'windows',
        label: 'Windows 安装包 (.exe/.msi)',
        extensions: ['.exe', '.msi'],
        remoteDir: 'zhengzhengstudio.cn/api/apps',
        // 只取构建输出根目录第一层，避免上传 win-unpacked/ 里不能独立运行的副本
        maxDepth: 1,
        skipDirs: ['win-unpacked', 'win-ia32-unpacked', 'win-x64-unpacked', '.cache', 'node_modules'],
        // 官方发布只保留「v版本-架构[-形态]」命名的四件套（x64/ia32 × 免安装/安装版）。
        // electron-builder 偶尔会另外产出不带架构后缀的重复包（体积上百 MB），
        // 既不在下载清单里又白占服务器空间，这里直接拦掉。
        requirePattern: /-(x64|ia32|x86|win32|win64|amd64|arm64)([-.]|$)/i,
        roots: [
            path.join(__dirname, 'HarmonyOS-App', 'ZhengZhengBoardGamesWindows', 'dist'),
            path.join(__dirname, 'HarmonyOS-App', 'ZhengZhengBoardGamesWindows', 'release'),
            path.join(__dirname, 'HarmonyOS-App', 'ZhengZhengBoardGamesWindows', 'build'),
            path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'api', 'apps')
        ]
    },
    {
        id: 'harmony',
        label: '鸿蒙安装包 (.hap/.app)',
        extensions: ['.hap', '.app'],
        remoteDir: 'zhengzhengstudio.cn/api/apps',
        // 构建输出目录里堆着几十个历史版本，只传每个项目最新构建的那一份
        maxDepth: 1,
        latestOnly: true,
        skipDirs: ['.cache', 'node_modules', 'outputs'],
        roots: [
            path.join(__dirname, 'HarmonyOS-App', 'ZhengZhengBoardGamesHarmonyOffline', 'entry', 'build', 'default', 'outputs', 'default'),
            path.join(__dirname, 'HarmonyOS-App', 'ZhengZhengBoardGamesHarmony', 'entry', 'build', 'default', 'outputs', 'default')
        ]
    },
    {
        id: 'mobile',
        label: 'Android / Apple 安装包 (.apk/.zip/.ipa)',
        extensions: ['.apk', '.zip', '.ipa'],
        remoteDir: 'zhengzhengstudio.cn/api/apps',
        maxDepth: 1,
        // apps 目录里堆着所有产品的历史包，只认桌游自己的命名前缀
        prefix: 'ZhengZhengBoardGames',
        roots: [
            path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'api', 'apps')
        ]
    }
];

function collectDesktopPackages(source, nameFilter = '') {
    const results = [];
    const seen = new Set();
    const extensions = new Set((source.extensions || []).map(ext => String(ext).toLowerCase()));
    const maxDepth = source.maxDepth || 1;
    const filter = String(nameFilter || '').trim();

    const walk = (dir, depth) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth >= maxDepth) continue;
                if ((source.skipDirs || []).includes(entry.name)) continue;
                walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            const fileName = entry.name;
            if (fileName === '.DS_Store' || fileName.endsWith('.icloud')) continue;
            if (fileName.includes(' 2.')) continue; // iCloud 冲突副本，不是正式产物
            if (!extensions.has(path.extname(fileName).toLowerCase())) continue;
            if (source.prefix && !fileName.startsWith(source.prefix)) continue;
            if (source.requirePattern instanceof RegExp && !source.requirePattern.test(fileName)) continue;
            if (filter && fileName !== filter && !fileName.toLowerCase().includes(filter.toLowerCase())) continue;

            // iCloud 会把构建产物驱逐成 208 字节的占位文件，传上去就是坏包
            let stats;
            try {
                stats = fs.statSync(fullPath);
            } catch (e) {
                continue;
            }
            if (stats.size < 100 * 1024) {
                console.log(`   ⚠️ 跳过异常小的文件（可能是 iCloud 占位符）: ${fileName}`);
                continue;
            }

            const remotePath = `${source.remoteDir}/${fileName}`;
            if (seen.has(remotePath)) continue;
            seen.add(remotePath);
            results.push({ fileName, fullPath, remotePath, mtimeMs: stats.mtimeMs });
        }
    };

    for (const root of source.roots || []) {
        if (fs.existsSync(root)) walk(root, 1);
    }

    let filtered = results;
    if (source.latestOnly) {
        // 同一个构建目录 + 同一种扩展名只保留最新构建的一份
        const latest = new Map();
        for (const item of filtered) {
            const key = `${path.dirname(item.fullPath)}|${path.extname(item.fileName).toLowerCase()}`;
            const prev = latest.get(key);
            if (!prev || item.mtimeMs > prev.mtimeMs) latest.set(key, item);
        }
        filtered = Array.from(latest.values());
    }

    return filtered
        .map(({ mtimeMs, ...rest }) => rest)
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

const syncDesktopPackages = async (source, options = {}) => {
    const packages = collectDesktopPackages(source, options.nameFilter || '');
    if (packages.length === 0) {
        console.log(`ℹ️ [${source.label}] 没有找到待上传的安装包`);
        for (const root of source.roots || []) {
            console.log(`   - ${root}${fs.existsSync(root) ? '' : ' (不存在)'}`);
        }
        return { uploaded: 0, skipped: 0, total: 0 };
    }

    console.log(`🪟 [${source.label}] 发现 ${packages.length} 个安装包，开始定向上传...`);
    let uploaded = 0;
    let skipped = 0;

    for (const item of packages) {
        let stats;
        try {
            stats = fs.statSync(item.fullPath);
        } catch (e) {
            continue;
        }
        const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
        console.log(`\n📦 [${source.label}] ${item.fileName} (${sizeMb} MB)`);
        // 不传 force：未变化的包走 .sync_packages.json 指纹去重，避免每次都重传上百 MB
        const ok = await syncFile(item.remotePath, item.fullPath, 5, 3000);
        if (!ok) continue;

        if (shouldSkipSyncedPackage(item.remotePath, item.fullPath)) {
            skipped++;
            console.log(`   ⏭️ 内容与上次上传一致，已跳过`);
        } else {
            uploaded++;
        }
        console.log(`   🔗 https://zhengzhengstudio.cn/api/apps/${encodeURIComponent(item.fileName)}`);

        const shaPath = `${item.fullPath}.sha256`;
        if (fs.existsSync(shaPath)) {
            await syncFile(`${item.remotePath}.sha256`, shaPath, 3, 1000);
        }
    }

    return { uploaded, skipped, total: packages.length };
};

const runDesktopPackagePass = async (sources, options = {}) => {
    const { allowEvenWhenSuppressed = false, nameFilter = '', headline = '', emptyHint = '' } = options;

    if (suppressAppPackageSync) {
        if (allowEvenWhenSuppressed) {
            console.log('⚠️ [NoAPK] --noapk 正在排除安装包，已为本次定向上传放行');
            suppressAppPackageSync = false;
        } else {
            console.log('ℹ️ [安装包] --noapk 已排除安装包，跳过定向上传');
            return;
        }
    }
    if (headline) console.log(headline);

    let uploaded = 0;
    let skipped = 0;
    let total = 0;
    for (const source of sources) {
        const result = await syncDesktopPackages(source, { nameFilter });
        uploaded += result.uploaded;
        skipped += result.skipped;
        total += result.total;
    }

    if (total === 0) {
        if (emptyHint) console.log(emptyHint);
    } else {
        console.log(`\n✅ [安装包] 上传 ${uploaded} 个 | 未变化跳过 ${skipped} 个 | 共 ${total} 个`);
    }
};

const syncWindowsPackagesPass = async (options = {}) => {
    const { allowEvenWhenSuppressed = false } = options;
    return runDesktopPackagePass(
        DESKTOP_PACKAGE_SOURCES.filter(source => source.id === 'windows'),
        {
            allowEvenWhenSuppressed,
            nameFilter: args.exeFilter,
            headline: allowEvenWhenSuppressed
                ? '🪟 [Windows] 定向上传 Windows .exe 安装包，不做全量同步...'
                : '🪟 [Windows] 定向上传 Windows .exe 安装包...',
            emptyHint: '💡 先在 ZhengZhengBoardGamesWindows 里执行 npm run dist 生成 .exe，再运行本命令'
        }
    );
};

// 下载中心索引：改了安装包就必须跟着更新，否则下载页还指着旧文件
const syncDownloadManifests = async () => {
    const manifests = [
        ['zhengzhengstudio.cn/api/apps/client-downloads.json', path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'api', 'apps', 'client-downloads.json')],
        ['api/apps/client-downloads.json', path.join(__dirname, 'website', 'api', 'apps', 'client-downloads.json')],
        ['zhengzhengstudio.cn/api/apps/manifest.json', path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'api', 'apps', 'manifest.json')],
        ['api/apps/manifest.json', path.join(__dirname, 'website', 'api', 'apps', 'manifest.json')]
    ];

    console.log('\n📋 [下载中心索引] 同步 client-downloads.json / manifest.json...');
    let uploaded = 0;
    for (const [remotePath, localPath] of manifests) {
        if (!fs.existsSync(localPath)) continue;
        const ok = await syncFile(remotePath, localPath, 3, 2000);
        if (ok) uploaded++;
    }
    console.log(`✅ [下载中心索引] 已上传 ${uploaded} 个索引文件`);
};

// 所有平台安装包一次性上传：Windows .exe + 鸿蒙 .hap/.app + 下载中心索引
const syncAllPackagesPass = async (options = {}) => {
    const { allowEvenWhenSuppressed = false } = options;
    const result = await runDesktopPackagePass(DESKTOP_PACKAGE_SOURCES, {
        allowEvenWhenSuppressed,
        nameFilter: args.exeFilter,
        headline: '📦 [安装包] 定向上传桌面端 + 鸿蒙安装包（各项目只取最新构建的一份）...'
    });
    await syncDownloadManifests();
    return result;
};

const SPACEFIGHT_WEB_ROOT = path.join(__dirname, 'website', 'spacefight.zhengzhengstudio.cn');
const SPACEFIGHT_WEB_PREFIX = 'spacefight.zhengzhengstudio.cn/';

const isSpaceFightWebPath = relativePath => (
    normalizeSyncPath(relativePath).startsWith(SPACEFIGHT_WEB_PREFIX)
);

const validateSpaceFightWebRelease = () => {
    const indexPath = path.join(SPACEFIGHT_WEB_ROOT, 'index.html');
    if (!fs.existsSync(indexPath)) {
        throw new Error(`SpaceFight 发布入口不存在: ${indexPath}`);
    }

    const html = fs.readFileSync(indexPath, 'utf8');
    const references = new Set();
    for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) references.add(match[1]);
    for (const match of html.matchAll(/System\.import\(["']([^"']+)["']\)/g)) references.add(match[1]);

    const missing = [];
    for (const rawReference of references) {
        if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(rawReference)) continue;
        const cleanReference = decodeURIComponent(rawReference.split(/[?#]/)[0]).replace(/^\.\//, '');
        if (!cleanReference) continue;
        const localPath = path.resolve(SPACEFIGHT_WEB_ROOT, cleanReference);
        if (localPath !== SPACEFIGHT_WEB_ROOT && !localPath.startsWith(`${SPACEFIGHT_WEB_ROOT}${path.sep}`)) {
            throw new Error(`SpaceFight 入口包含越界资源路径: ${rawReference}`);
        }
        if (!fs.existsSync(localPath)) missing.push(cleanReference);
    }

    if (missing.length > 0) {
        throw new Error(`SpaceFight 发布缺少入口引用资源: ${missing.join(', ')}`);
    }
    return [...references];
};

const syncSpaceFightWebRelease = async () => {
    const references = validateSpaceFightWebRelease();
    console.log(`🧭 [SpaceFight] 已校验 ${references.length} 个入口资源，资源完成后再切换 index.html`);
    await syncLocalDir(SPACEFIGHT_WEB_ROOT, 'spacefight.zhengzhengstudio.cn', {
        entryFilesLast: ['index.html'],
        failFast: true
    });
};

const collectSurvivalDiaryReleaseFiles = () => {
    const releaseFiles = [
        ['api/data/changelogs.json', 'website/api/data/changelogs.json', 3000],
        ['zhengzhengstudio.cn/api/changelogs.json', 'website/zhengzhengstudio.cn/api/changelogs.json', 3000],
        ['api/apps/manifest.json', 'website/api/apps/manifest.json', 3000],
        ['api/apps/client-downloads.json', 'website/api/apps/client-downloads.json', 3000],
        ['zhengzhengstudio.cn/api/apps/manifest.json', 'website/zhengzhengstudio.cn/api/apps/manifest.json', 3000],
        ['zhengzhengstudio.cn/api/apps/client-downloads.json', 'website/zhengzhengstudio.cn/api/apps/client-downloads.json', 3000]
    ];
    const metadataPath = path.join(__dirname, 'website/api/apps/client-downloads.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const packageNames = new Set();

    for (const entry of metadata.apps || []) {
        if (entry.product !== 'survival-diary' || entry.available === false) continue;
        for (const value of [
            entry.fileName,
            entry.latestUrl,
            entry.versionedUrl,
            entry.downloadURL,
            entry.url,
            entry.appFileName,
            entry.appLatestUrl,
            entry.appVersionedUrl,
            entry.appDownloadURL,
            entry.appUrl
        ]) {
            if (!value) continue;
            const cleanValue = decodeURIComponent(String(value).split(/[?#]/)[0]);
            const fileName = path.posix.basename(cleanValue);
            if (APP_PACKAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) packageNames.add(fileName);
        }
    }

    for (const prefix of ['api/apps', 'zhengzhengstudio.cn/api/apps']) {
        for (const fileName of packageNames) {
            const localPath = `website/${prefix}/${fileName}`;
            if (!fs.existsSync(path.join(__dirname, localPath))) continue;
            releaseFiles.push([`${prefix}/${fileName}`, localPath, 30000]);
            if (fs.existsSync(path.join(__dirname, `${localPath}.sha256`))) {
                releaseFiles.push([`${prefix}/${fileName}.sha256`, `${localPath}.sha256`, 3000]);
            }
        }
    }

    return releaseFiles;
};

const syncSurvivalDiaryBundle = async () => {
    if (args.survivalDiaryReleaseOnly) {
        console.log('🏝️ [Survival Diary] 仅同步更新日志、下载清单与安装包...');
        const releaseFiles = collectSurvivalDiaryReleaseFiles();
        for (const [remotePath, localPath, timeout] of releaseFiles) {
            const ok = await syncFile(remotePath, path.join(__dirname, localPath), 5, timeout);
            if (!ok) throw new Error(`生存日记必要文件上传失败: ${remotePath}`);
        }
        return;
    }

    if (!args.survivalDiaryStartOnly) {
        console.log('🏝️ [Survival Diary] 同步连续海岛站点、联机服务与 Tunnel 配置...');
        const requiredSync = async (remotePath, localRelativePath, retries = 5, timeout = 3000) => {
            const ok = await syncFile(remotePath, path.join(__dirname, localRelativePath), retries, timeout);
            if (!ok) throw new Error(`生存日记必要文件上传失败: ${remotePath}`);
        };
        await requiredSync('api/cloudflared/config.yaml', 'website/api/cloudflared/config.yaml');
        await requiredSync('api/cloudflared/config_termux.yaml', 'website/api/cloudflared/config_termux.yaml');
        await syncDir('survival-diary.zhengzhengstudio.cn', { includeAssets: true });
        await requiredSync('zhengzhengstudio.cn/passport/login.html', 'website/zhengzhengstudio.cn/passport/login.html');
        const releaseFiles = collectSurvivalDiaryReleaseFiles();
        for (const [remotePath, localPath, timeout] of releaseFiles) {
            await requiredSync(remotePath, localPath, 5, timeout);
        }
    } else {
        console.log('🏝️ [Survival Diary] 跳过已完成上传，只启动线上服务...');
        await syncDir('survival-diary.zhengzhengstudio.cn/server');
    }

    const remoteRoot = '$HOME/website/survival-diary.zhengzhengstudio.cn/server';
    if (!await runTermuxCommand(`cd ${remoteRoot} && npm install --omit=dev --prefer-offline`, 30000)) {
        throw new Error('生存日记线上依赖安装失败');
    }
    const startCommand = `cd ${remoteRoot} && (PORT=8121 pm2 restart survival-diary --update-env || PORT=8121 pm2 start server.js --name survival-diary --cwd ${remoteRoot} --update-env) && pm2 save`;
    if (!await runTermuxCommand(startCommand, 30000)) {
        throw new Error('生存日记线上服务启动失败');
    }
    if (!await runTermuxCommand(`sleep 2; curl -fsS http://127.0.0.1:8121/health`, 10000)) {
        await runTermuxCommand(`tail -n 80 $HOME/.pm2/logs/survival-diary-error.log; tail -n 40 $HOME/.pm2/logs/survival-diary-out.log`, 10000);
        throw new Error('生存日记线上健康检查失败');
    }
    const infrastructureRestart = `nohup sh -c 'sleep 2; pm2 restart zhengzheng-api --update-env; sleep 3; curl -fsS http://127.0.0.1:8110/api/health; pm2 restart zhengzheng-tunnel --update-env; pm2 save' >$HOME/survival-release-restart.log 2>&1 &`;
    if (!await runTermuxCommand(infrastructureRestart, 10000)) {
        throw new Error('主站 API 与 Cloudflare Tunnel 重启调度失败');
    }
};

const syncHapInstallerBundle = async () => {
    console.log('📦 [HAP Installer] 仅同步安装器、主 API 代理与网页入口...');

    const files = [
        ['api/server.js', 'website/api/server.js'],
        ['api/lib/app_manifest_merge.js', 'website/api/lib/app_manifest_merge.js'],
        ['api/start_termux.js', 'website/api/start_termux.js'],
        ['zhengzhengstudio.cn/tools/index.html', 'website/zhengzhengstudio.cn/tools/index.html'],
        ['zhengzhengstudio.cn/tools/hap_installer.html', 'website/zhengzhengstudio.cn/tools/hap_installer.html'],
        ['zhengzhengstudio.cn/downloads.html', 'website/zhengzhengstudio.cn/downloads.html']
    ];

    for (const [remotePath, localPath] of files) {
        await syncFile(remotePath, path.join(__dirname, localPath));
    }

    await syncLocalDir(
        path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'tools', 'hap-remote-installer'),
        'zhengzhengstudio.cn/tools/hap-remote-installer'
    );

    const restart = "nohup sh -c 'sleep 2; pm2 restart zhengzheng-api --update-env; sleep 3; curl -fsS http://127.0.0.1:8110/api/health; pm2 save' >$HOME/hap-installer-restart.log 2>&1 &";
    if (!await runTermuxCommand(restart, 10000)) {
        throw new Error('主站 API 重启调度失败');
    }
};

const syncHearBridgeBundle = async () => {
    console.log('🌉 [HearBridge] 仅同步声桥 H5、独立 server 与 Tunnel 配置...');

    const files = [
        ['api/hear_server.js', 'website/api/hear_server.js'],
        ['api/start_termux.js', 'website/api/start_termux.js'],
        ['api/data/changelogs.json', 'website/api/data/changelogs.json'],
        ['zhengzhengstudio.cn/api/changelogs.json', 'website/zhengzhengstudio.cn/api/changelogs.json'],
        ['zhengzhengstudio.cn/api/apps/manifest.json', 'website/zhengzhengstudio.cn/api/apps/manifest.json'],
        ['zhengzhengstudio.cn/api/apps/client-downloads.json', 'website/zhengzhengstudio.cn/api/apps/client-downloads.json'],
        ['zhengzhengstudio.cn/assets/icons/hearbridge-icon-512.png', 'website/zhengzhengstudio.cn/assets/icons/hearbridge-icon-512.png'],
        ['api/cloudflared/config.yaml', 'website/api/cloudflared/config.yaml'],
        ['api/cloudflared/config_termux.yaml', 'website/api/cloudflared/config_termux.yaml']
    ];

    for (const [remotePath, localPath] of files) {
        await syncFile(remotePath, path.join(__dirname, localPath), 5, 3000);
    }

    await syncDir('hear.zhengzhengstudio.cn', { includeAssets: true });

    const packages = [
        'HearBridge-Android-latest.apk',
        'HearBridge-Android-v0.1.1.apk',
        'HearBridge-Android-v0.1.0.apk',
        'HearBridge-macOS-latest.dmg',
        'HearBridge-macOS-v0.1.1.dmg',
        'HearBridge-macOS-v0.1.0.dmg',
        'HearBridge-iOS-latest-unsigned.ipa',
        'HearBridge-iOS-v0.1.1-unsigned.ipa',
        'HearBridge-iOS-v0.1.0-unsigned.ipa',
        'HearBridge-iOS-install.plist'
    ];
    for (const file of packages) {
        const local = path.join(__dirname, 'website/zhengzhengstudio.cn/api/apps', file);
        if (fs.existsSync(local)) {
            await syncFile(`zhengzhengstudio.cn/api/apps/${file}`, local, 5, 5000);
        }
    }
    const downloadPackages = packages.filter(file => !file.endsWith('.plist'));
    for (const file of downloadPackages) {
        const local = path.join(__dirname, 'website/zhengzhengstudio.cn/api/apps/download', file);
        if (fs.existsSync(local)) {
            await syncFile(`zhengzhengstudio.cn/api/apps/download/${file}`, local, 5, 5000);
        }
    }
};

const syncZhengZhengGlassesApps = async () => {
    console.log('👓 [Glasses Apps] 仅同步安装包与下载中心索引...');
    const appDir = path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'api', 'apps');
    const buildManifest = JSON.parse(
        fs.readFileSync(path.join(appDir, 'ZhengZhengGlasses-build.json'), 'utf8')
    );
    const metadata = [
        'manifest.json',
        'client-downloads.json',
        'ZhengZhengGlasses-build.json'
    ];
    const packages = [...new Set(
        (buildManifest.packages || []).flatMap(item => [item.fileName, item.latestFileName])
            .filter(Boolean)
    )];

    for (const file of [...metadata, ...packages]) {
        if (!fs.existsSync(path.join(appDir, file))) {
            console.warn(`⚠️ [Glasses Apps] 清单文件不存在，跳过: ${file}`);
            continue;
        }
        await syncFile(
            `zhengzhengstudio.cn/api/apps/${file}`,
            path.join(appDir, file),
            5,
            3000
        );
    }
};

const getSpaceFightPackageNames = (manifests, entryIds = null) => {
    const packageNames = new Set();
    const urlFields = ['url', 'latestUrl', 'versionedUrl', 'downloadURL'];
    const selectedIds = entryIds ? new Set(entryIds) : null;

    for (const manifest of Array.isArray(manifests) ? manifests : [manifests]) {
        for (const app of manifest.apps || []) {
            if (!String(app.id || '').startsWith('spacefight-')) continue;
            if (selectedIds && !selectedIds.has(app.id)) continue;
            if (app.fileName) packageNames.add(path.posix.basename(app.fileName));
            for (const field of urlFields) {
                const value = String(app[field] || '');
                if (!value.includes('/api/apps/')) continue;
                packageNames.add(path.posix.basename(value.split(/[?#]/)[0]));
            }
        }
    }

    return [...packageNames].filter(Boolean);
};

const syncSpaceFightApps = async () => {
    console.log('🚀 [SpaceFight] 仅同步游戏站点、安装包与下载中心索引...');
    const publicAppDir = path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'api', 'apps');
    const apiAppDir = path.join(__dirname, 'website', 'api', 'apps');
    const metadata = ['manifest.json', 'client-downloads.json'];
    const releaseEntryIds = [
        'spacefight-android',
        'spacefight-harmonyos-offline',
        'spacefight-harmonyos-offline-app'
    ];
    const { validateDistributionRoots } = require('./SpaceFight-Cocos/tools/release-distribution-policy');
    validateDistributionRoots([apiAppDir, publicAppDir], { entryIds: releaseEntryIds, checksums: true });
    const documents = [apiAppDir, publicAppDir].flatMap(appRoot => metadata.map(file => (
        JSON.parse(fs.readFileSync(path.join(appRoot, file), 'utf8'))
    )));
    const packages = getSpaceFightPackageNames(documents, releaseEntryIds);

    if (packages.length === 0) {
        throw new Error('SpaceFight 清单中没有可同步的安装包');
    }

    await syncSpaceFightWebRelease();
    await syncFile(
        'api/data/changelogs.json',
        path.join(__dirname, 'website', 'api', 'data', 'changelogs.json'),
        5,
        3000
    );

    for (const [remoteRoot, localRoot] of [
        ['zhengzhengstudio.cn/api/apps', publicAppDir],
        ['api/apps', apiAppDir]
    ]) {
        for (const file of [...metadata, ...packages]) {
            const localPath = path.join(localRoot, file);
            if (!fs.existsSync(localPath)) {
                console.warn(`⚠️ [SpaceFight] 清单文件不存在，跳过: ${localPath}`);
                continue;
            }
            await syncFile(`${remoteRoot}/${file}`, localPath, 5, 5000);
        }
    }
};

async function cleanupOldPorts() {
    console.log(`🔧 [Cleanup] 正在清理旧端口 ${CLEANUP_PORTS.join(', ')}...`);
    for (const port of CLEANUP_PORTS) {
        const cmd = `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`;
        const ok = await runTermuxCommand(cmd);
        if (ok) {
            console.log(`✅ [Cleanup] 端口 ${port} 已清理`);
        } else {
            console.log(`ℹ️ [Cleanup] 端口 ${port} 没有被占用或清理失败`);
        }
    }
}

const runSync = async () => {
    console.log(`\n🚀 [Sync Manager] 正在开始同步到 Termux...`);
    if (suppressAppPackageSync) {
        console.log('📦 [NoAPK] 本轮同步将排除安装包 (.apk/.app/.hap/.ipa 等)');
    }
    if (!await prepareConnection()) return;

    await cleanupOldPorts();

    const startTime = Date.now();

    if (args.packagesOnly) {
        await syncAllPackagesPass({ allowEvenWhenSuppressed: true });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 安装包定向上传完成（Windows + 鸿蒙）！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    if (args.hapInstallerOnly) {
        await syncHapInstallerBundle();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 HAP 安装器专用同步完成！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    if (args.hearOnly) {
        await syncHearBridgeBundle();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 HearBridge 专用同步完成！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    if (args.survivalDiaryOnly) {
        await syncSurvivalDiaryBundle();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 生存日记专用同步完成！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    if (args.glassesAppsOnly) {
        await syncZhengZhengGlassesApps();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 铮铮眼镜安装包专用同步完成！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    if (args.spaceFightWebOnly) {
        await syncSpaceFightWebRelease();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 SpaceFight 网页专用同步完成！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    if (args.spaceFightAppsOnly) {
        await syncSpaceFightApps();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`------------------------------------------`);
        console.log(`🏁 SpaceFight 专用同步完成！`);
        console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
        console.log(`⏱️ 耗时: ${duration} 秒`);
        return;
    }

    // 核心文件同步
    await syncFile('api/lib/huawei_account.js', path.join(__dirname, 'website/api/lib/huawei_account.js'));
    await syncFile('api/lib/runtime_env.js', path.join(__dirname, 'website/api/lib/runtime_env.js'));
    await syncFile('api/lib/api_backup.js', path.join(__dirname, 'website/api/lib/api_backup.js'));
    await syncFile('api/lib/request_ip.js', path.join(__dirname, 'website/api/lib/request_ip.js'));
    await syncFile('api/boardgames/rejoin-seat.js', path.join(__dirname, 'website/api/boardgames/rejoin-seat.js'));
    await syncFile('api/server.js', path.join(__dirname, 'website/api/server.js'));
    await syncFile('api/admin_server.js', path.join(__dirname, 'website/api/admin_server.js'));
    await syncFile('api/classes_server.js', path.join(__dirname, 'website/api/classes_server.js'));
    await syncFile('api/glasses_server.js', path.join(__dirname, 'website/api/glasses_server.js'));
    await syncFile('api/face_server.js', path.join(__dirname, 'website/api/face_server.js'));
    await syncFile('api/lottery_server.js', path.join(__dirname, 'website/api/lottery_server.js'));
    await syncFile('api/hear_server.js', path.join(__dirname, 'website/api/hear_server.js'));
    await syncFile('api/reading_server.js', path.join(__dirname, 'website/api/reading_server.js'));
    await syncFile('api/lib/reading_readiness.js', path.join(__dirname, 'website/api/lib/reading_readiness.js'));
    await syncFile('api/lib/direct_tunnel_start.js', path.join(__dirname, 'website/api/lib/direct_tunnel_start.js'));
    await syncFile('api/start_termux.js', path.join(__dirname, 'website/api/start_termux.js'));
    await syncFile('api/ha_runner.sh', path.join(__dirname, 'website/api/ha_runner.sh'));
    await syncFile('api/package.json', path.join(__dirname, 'website/api/package.json'));
    await syncFile('api/data/changelogs.json', path.join(__dirname, 'website/api/data/changelogs.json'));
    await syncFile('api/data/recommended_sites.json', path.join(__dirname, 'website/api/data/recommended_sites.json'));
    await syncFile('zhengzhengstudio.cn/api/changelogs.json', path.join(__dirname, 'website/zhengzhengstudio.cn/api/changelogs.json'));
    // 生存日记联机服务；通用过滤规则会排除 .env、node_modules 和运行态 data。
    await syncDir('survival-diary.zhengzhengstudio.cn/server');

    // 桌面端安装包：Windows .exe 不在 website/ 内，默认同步（不带任何参数）也要定向上传一次
    await syncWindowsPackagesPass();

    // MC 服务器管理脚本
    await syncFile('api/mc_manager.js', path.join(__dirname, 'website/api/mc_manager.js'));

    // HAP 远程安装服务，由 api/start_termux.js 统一启动
    await syncLocalDir(
        path.join(__dirname, 'website', 'zhengzhengstudio.cn', 'tools', 'hap-remote-installer'),
        'zhengzhengstudio.cn/tools/hap-remote-installer'
    );

    // HomeAssistant 安装脚本
    await syncFile('install_ha.sh', path.join(__dirname, 'website', 'install_ha.sh'));

    // 目录同步
    // 学习站（铮铮的学习站 / zz/fce）：资源放 static/ 而非 assets/，两种模式都会同步
    await syncDir('study.zhengzhengstudio.cn');

    if (args.isAssets) {
        console.log('📦 [Full] 同步核心代码 + assets 目录...');
        await syncDir('zhengzhengstudio.cn');
        await syncDir('glasses.zhengzhengstudio.cn');
        await syncDir('lottery.zhengzhengstudio.cn');
        await syncDir('hear.zhengzhengstudio.cn');
        await syncDir('reading.zhengzhengstudio.cn');
        await syncDir('kcsys.dpdns.org');
        await syncDir('api/mediapipe');
        await syncDir('api/cloudflared');
    } else {
        console.log('📦 [Code] 同步核心代码 (跳过 assets 目录)...');
        await syncDir('zhengzhengstudio.cn');
        await syncDir('glasses.zhengzhengstudio.cn');
        await syncDir('lottery.zhengzhengstudio.cn');
        await syncDir('hear.zhengzhengstudio.cn');
        await syncDir('reading.zhengzhengstudio.cn');
        await syncDir('kcsys.dpdns.org');
        await syncDir('api/mediapipe');
        await syncDir('api/cloudflared');
    }
    
    if (args.syncMcServer) {
        console.log('🎮 [MC] 同步网站 MC 配置文件...');
        await syncDir('zhengzhengstudio.cn/mc_server');
        console.log('🎮 [MC] 同步根目录 mc_server 服务器包到 Termux...');
        await syncLocalDir(path.join(__dirname, 'mc_server'), 'mc_server', {
            skipTopLevel: []
        });
    } else {
        console.log('ℹ️ [MC] 跳过 MC 配置与服务器包同步 (使用 --mc-server 开启)');
    }

    if (args.isWatch) {
        console.log('🚀 [Watch Mode] 同步 SpaceFight 网页资源...');
        await syncSpaceFightWebRelease();
    }
    
    if (args.isHa) {
        console.log('🔄 [Config] 打包同步 HomeAssistant 白名单文件到 Termux/proot...');
        await syncHomeAssistantBundle();
    } else {
        console.log('ℹ️ [Config] 跳过 HomeAssistant 全量安全同步 (watch 模式仍会同步白名单 HA 文件)');
    }

    if (!args.isAssets) {
        console.log('ℹ️ [Config] 跳过 assets 目录 (使用 --assets 开启完整同步)');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // 更新版本号
    if (successCount > 0) {
        const now = new Date();
        const version = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const buildTime = now.toISOString();
        
        let tempVersionPath = '';
        try {
            const versionData = JSON.stringify({ version, buildTime }, null, 2);
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-sync-version-'));
            tempVersionPath = path.join(tempDir, 'version.json');
            fs.writeFileSync(tempVersionPath, versionData);
            if (await syncFile('api/data/version.json', tempVersionPath, 3)) {
                console.log(`📦 版本已更新: v${version}`);
            } else {
                console.warn('⚠️ 版本更新失败');
            }
        } catch (e) {
            console.warn(`⚠️ 版本更新失败: ${e.message}`);
        } finally {
            if (tempVersionPath) {
                try {
                    fs.rmSync(path.dirname(tempVersionPath), { recursive: true, force: true });
                } catch (e) {}
            }
        }
    }

    console.log(`------------------------------------------`);
    console.log(`🏁 同步完成！`);
    console.log(`📊 统计: 总计 ${successCount + failCount} 个文件 | 成功: ${successCount} | 失败: ${failCount}`);
    console.log(`⏱️ 耗时: ${duration} 秒`);

    if (failCount === 0) {
        console.log(`\n✨ 所有代码已成功上传到 Termux！`);
    } else {
        console.warn(`\n⚠️ 有 ${failCount} 个文件同步失败，请检查网络连接或手机端服务状态。`);
    }
};

/**
 * 监听模式
 */
function startWatch() {
    console.log(`\n👀 [Watch Mode] 正在监听 website 目录下的文件变化...`);

    const trackedDesktopRoots = DESKTOP_PACKAGE_SOURCES
        .flatMap(source => source.roots || [])
        .filter(root => fs.existsSync(root));
    if (trackedDesktopRoots.length > 0) {
        console.log(`🪟 [Watch Mode] 同时监听桌面端构建产物 (.exe)，新增/重新构建会自动上传:`);
        for (const root of trackedDesktopRoots) console.log(`   - ${root}`);
    }

    if (args.noApk && suppressAppPackageSync) {
        suppressAppPackageSync = false;
        console.log('📦 [NoAPK] 已进入监听阶段，安装包变化将恢复上传');
    }
    const websitePath = path.join(__dirname, 'website');
    
    // 防抖、单队列处理与重复事件去重
    const pendingFiles = new Set();
    const lastSyncedSignatures = new Map();
    const watchSignatures = new Map();
    const watchEventTimes = new Map();
    const watchPollSignatures = new Map();
    const duplicateCooldownMs = 2500;
    const watchPollIntervalMs = Number(process.env.SYNC_WATCH_POLL_MS) || 5000;
    let timeout = null;
    let isProcessing = false;
    let isScanning = false;
    let stopped = false;

    const relativeFromWebsite = (fullPath) => normalizeSyncPath(path.relative(websitePath, fullPath));

    const getPathSignature = (fullPath, stats = null) => {
        const fileStats = stats || fs.statSync(fullPath);
        const base = getWatchPathSignature(fullPath, fileStats);
        if (!isAppPackagePath(fullPath)) return base;
        return `${base}:${fileStats.ctimeMs}:${fileStats.ino || 0}`;
    };

    const getPollSignature = (stats) => `${stats.size}:${stats.mtimeMs}`;

    const seedWatchSignatures = (dirPath) => {
        let seededFiles = 0;

        const walk = (currentPath) => {
            let entries;
            try {
                entries = fs.readdirSync(currentPath, { withFileTypes: true });
            } catch (e) {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const relativePath = relativeFromWebsite(fullPath);
                let stats;
                try {
                    stats = fs.statSync(fullPath);
                } catch (e) {
                    continue;
                }

                if (shouldSkipSyncPath(relativePath, entry.name, stats)) continue;

                watchSignatures.set(relativePath, getPathSignature(fullPath, stats));
                if (stats.isFile()) {
                    watchPollSignatures.set(relativePath, getPollSignature(stats));
                    seededFiles++;
                }
                if (stats.isDirectory()) walk(fullPath);
            }
        };

        walk(dirPath);
        return seededFiles;
    };

    const shouldEnqueueWatchEvent = (fullPath) => {
        const relativePath = relativeFromWebsite(fullPath);
        if (!relativePath || relativePath.startsWith('..')) return false;

        let stats;
        try {
            stats = fs.statSync(fullPath);
        } catch (e) {
            watchSignatures.delete(relativePath);
            watchEventTimes.delete(relativePath);
            return false;
        }

        if (stats.isDirectory()) {
            watchSignatures.set(relativePath, getPathSignature(fullPath, stats));
            return false;
        }

        if (shouldSkipSyncPath(relativePath, path.basename(relativePath), stats)) return false;

        const signature = getPathSignature(fullPath, stats);
        const previousSignature = watchSignatures.get(relativePath);
        const lastEventTime = watchEventTimes.get(relativePath) || 0;
        const now = Date.now();
        watchSignatures.set(relativePath, signature);
        watchEventTimes.set(relativePath, now);

        if (previousSignature === signature && now - lastEventTime < duplicateCooldownMs) {
            return false;
        }

        return previousSignature !== signature;
    };

    const scanWatchTree = (dirPath) => {
        const seenFiles = new Set();

        const walk = (currentPath) => {
            let entries;
            try {
                entries = fs.readdirSync(currentPath, { withFileTypes: true });
            } catch (e) {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                const relativePath = relativeFromWebsite(fullPath);
                let stats;
                try {
                    stats = fs.statSync(fullPath);
                } catch (e) {
                    continue;
                }

                if (shouldSkipSyncPath(relativePath, entry.name, stats)) continue;
                if (stats.isDirectory()) {
                    walk(fullPath);
                    continue;
                }
                if (!stats.isFile()) continue;

                seenFiles.add(relativePath);
                const signature = getPollSignature(stats);
                const previousSignature = watchPollSignatures.get(relativePath);
                watchPollSignatures.set(relativePath, signature);
                if (previousSignature === signature) continue;

                if (shouldEnqueueWatchEvent(fullPath)) pendingFiles.add(fullPath);
            }
        };

        walk(dirPath);
        for (const relativePath of watchPollSignatures.keys()) {
            if (!seenFiles.has(relativePath)) watchPollSignatures.delete(relativePath);
        }
    };

    const processPending = async () => {
        timeout = null;
        if (stopped || isProcessing) return;
        isProcessing = true;

        let files = Array.from(pendingFiles);
        pendingFiles.clear();
        
        const maxRetries = 3;
        const retryDelay = 3000;
        
        try {
            for (let retry = 1; retry <= maxRetries; retry++) {
                const currentFailed = [];

                const spaceFightFiles = files.filter(fullPath => (
                    isSpaceFightWebPath(path.relative(websitePath, fullPath))
                ));
                const filesToSync = files.filter(fullPath => !spaceFightFiles.includes(fullPath));

                if (spaceFightFiles.length > 0) {
                    try {
                        console.log(`\n🚀 [SpaceFight] 检测到 ${spaceFightFiles.length} 个站点变化，开始完整原子发布`);
                        await syncSpaceFightWebRelease();
                        for (const fullPath of spaceFightFiles) {
                            if (!fs.existsSync(fullPath)) continue;
                            const relativePath = path.relative(websitePath, fullPath);
                            const signature = getPathSignature(fullPath);
                            lastSyncedSignatures.set(relativePath, signature);
                            watchSignatures.set(normalizeSyncPath(relativePath), signature);
                        }
                    } catch (error) {
                        console.error(`❌ [SpaceFight] 完整发布失败，未切换入口: ${error.message}`);
                        currentFailed.push(...spaceFightFiles);
                    }
                }

            for (const fullPath of filesToSync) {
                try {
                    if (!fs.existsSync(fullPath)) continue;
                    const stats = fs.statSync(fullPath);
                    if (stats.isDirectory()) continue;

                    const relativePath = path.relative(websitePath, fullPath);
                    const signature = getPathSignature(fullPath, stats);
                    if (retry === 1 && lastSyncedSignatures.get(relativePath) === signature) continue;
                    
                    // 过滤运行时 data，但允许白名单中的静态站点数据。
                    if (shouldSkipSyncPath(relativePath, path.basename(relativePath), stats)) continue;

                    const isHaPath = isHomeAssistantPath(relativePath);
                    if (isHaPath && !isSafeHomeAssistantFile(relativePath)) {
                        console.log(`\n🛡️ [HA Safe] 跳过非白名单/运行态文件: ${relativePath}`);
                        continue;
                    }

                    // assets 目录自动同步单个文件；眼镜站图片文件默认保护，避免覆盖 Termux 端资源。
                    const isGlassesAsset = relativePath.startsWith('glasses.zhengzhengstudio.cn/assets/');
                    if (relativePath.includes('/assets/') && !args.isAssets && !isGlassesAsset) {
                        // 自动启用 assets 同步
                        args.isAssets = true;
                        console.log(`\n📦 [Auto-Assets] 检测到 assets 文件变化: ${relativePath}`);

                        // 只同步单个变化的文件
                        if (await syncFile(relativePath, fullPath)) {
                            lastSyncedSignatures.set(relativePath, signature);
                            watchSignatures.set(normalizeSyncPath(relativePath), getPathSignature(fullPath, stats));
                        } else {
                            currentFailed.push(fullPath);
                        }
                        continue;
                    }
                    if (isProtectedGlassesImage(relativePath) && !args.forceGlassesAssets) {
                        const allowedAiPatch = args.glassesAiAssets && isGlassesAiImage(relativePath);
                        const allowedDoubaoPatch = args.doubaoGlassesAssets && isDoubaoGlassesImage(relativePath);
                        if (!allowedAiPatch && !allowedDoubaoPatch) continue;
                    }

                    // 重置统计
                    const oldSuccess = successCount;
                    const oldFail = failCount;
                    
                    successCount = 0;
                    failCount = 0;

                    if (retry > 1) {
                        console.log(`\n🔄 [Retry ${retry}] 重新同步: ${relativePath}`);
                    } else {
                        console.log(`\n🔄 [Change] 检测到变化: ${relativePath}`);
                    }

                    // 第一次尝试不等待，后续重试等待指定时间
                    const noOverwrite = isProtectedGlassesImage(relativePath)
                        && !args.forceGlassesAssets
                        && !(args.doubaoGlassesAssets && isDoubaoGlassesImage(relativePath));
                    const result = isHaPath
                        ? await syncHomeAssistantFile(relativePath, fullPath, 2, retry > 1 ? retryDelay : 0, { noOverwrite })
                        : await syncFile(relativePath, fullPath, 2, retry > 1 ? retryDelay : 0, {
                            noOverwrite,
                            force: isAppPackagePath(relativePath)
                        });

                    if (result) {
                        lastSyncedSignatures.set(relativePath, signature);
                        watchSignatures.set(normalizeSyncPath(relativePath), getPathSignature(fullPath, stats));

                        // 同步 manifest.json / client-downloads.json 后，自动同步引用的安装包
                        const normalized = normalizeSyncPath(relativePath);
                        if (normalized.startsWith('zhengzhengstudio.cn/api/apps/')
                            && (normalized.endsWith('/manifest.json') || normalized.endsWith('/client-downloads.json'))) {
                            try {
                                const content = fs.readFileSync(fullPath, 'utf8');
                                const json = JSON.parse(content);
                                const appEntries = json.apps || (json.id ? [json] : []);
                                const appFiles = new Set();
                                for (const entry of appEntries) {
                                    if (entry.hapFileName) appFiles.add(entry.hapFileName);
                                    if (entry.appPackFileName) appFiles.add(entry.appPackFileName);
                                    if (entry.fileName) appFiles.add(entry.fileName);
                                    if (entry.latestFileName) appFiles.add(entry.latestFileName);
                                    for (const field of ['url', 'downloadURL', 'versionedUrl']) {
                                        const value = String(entry[field] || '');
                                        const marker = '/api/apps/';
                                        const markerIndex = value.toLowerCase().indexOf(marker);
                                        if (markerIndex < 0) continue;
                                        const packagePath = decodeURIComponent(value.slice(markerIndex + marker.length).split(/[?#]/)[0]);
                                        const packageFile = path.posix.basename(packagePath);
                                        if (APP_PACKAGE_EXTENSIONS.has(path.extname(packageFile).toLowerCase())) appFiles.add(packageFile);
                                    }
                                }
                                for (const appFile of appFiles) {
                                    if (!appFile) continue;
                                    const appRelPath = `zhengzhengstudio.cn/api/apps/${appFile}`;
                                    if (isBlockedAppPackagePath(appRelPath)) continue;
                                    const appFullPath = path.join(websitePath, appRelPath);
                                    if (fs.existsSync(appFullPath)) {
                                        const appSig = getPathSignature(appFullPath);
                                        if (shouldSkipSyncedPackage(appRelPath, appFullPath)) {
                                            lastSyncedSignatures.set(appRelPath, appSig);
                                            watchSignatures.set(normalizeSyncPath(appRelPath), appSig);
                                            continue;
                                        }
                                        console.log(`\n📦 [Manifest] 同步引用安装包: ${appRelPath}`);
                                        if (await syncFile(appRelPath, appFullPath, 2)) {
                                            lastSyncedSignatures.set(appRelPath, appSig);
                                            watchSignatures.set(normalizeSyncPath(appRelPath), appSig);
                                            markPackageSynced(appRelPath, appFullPath);
                                        }
                                    }
                                }
                            } catch (e) {
                                // 忽略解析错误
                            }
                        }
                    } else {
                        currentFailed.push(fullPath);
                    }

                    // 恢复统计
                    successCount = oldSuccess + successCount;
                    failCount = oldFail + failCount;

                } catch (e) {
                    // 忽略读取错误
                }
            }
            
                if (currentFailed.length === 0) {
                    break; // 全部成功，退出重试循环
                }
            
                if (retry < maxRetries) {
                    console.log(`\n⏳ [Batch Retry] ${currentFailed.length} 个文件失败，${retryDelay}ms 后一起重试...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    files = currentFailed;
                } else {
                    console.log(`\n❌ 以下文件同步失败 (已重试 ${maxRetries} 次):`);
                    for (const file of currentFailed) {
                        console.log(`   - ${path.relative(websitePath, file)}`);
                    }
                }
            }

            // 在 watch 模式下同步完成后也更新版本号
            if (successCount > 0) {
                console.log(''); // 空行分隔
                const now = new Date();
                const version = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
                const buildTime = now.toISOString();
                let tempVersionPath = '';
                try {
                    const versionData = JSON.stringify({ version, buildTime }, null, 2);
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-sync-version-'));
                    tempVersionPath = path.join(tempDir, 'version.json');
                    fs.writeFileSync(tempVersionPath, versionData);
                    if (await syncFile('api/data/version.json', tempVersionPath, 3)) {
                        console.log(`📦 版本已更新: v${version}`);
                    } else {
                        console.warn('⚠️ 版本更新失败');
                    }
                } catch (e) {
                    console.warn(`⚠️ 版本更新失败: ${e.message}`);
                } finally {
                    if (tempVersionPath) {
                        try {
                            fs.rmSync(path.dirname(tempVersionPath), { recursive: true, force: true });
                        } catch (e) {}
                    }
                }
            }
        } finally {
            isProcessing = false;
            if (!stopped && pendingFiles.size > 0) {
                timeout = setTimeout(processPending, 250);
            }
        }
    };

    const seededFiles = seedWatchSignatures(websitePath);
    console.log(`📌 [Watch Mode] 已记录 ${seededFiles} 个现有文件状态，未改动文件不会重复同步`);
    console.log(`📡 [Watch Mode] 使用 ${watchPollIntervalMs}ms 目录轮询，避免耗尽文件监听句柄`);

    // website/ 之外的桌面端构建产物（Windows .exe）单独轮询
    const externalSignatures = new Map();
    let externalSeeded = false;
    let externalSyncing = false;

    const scanExternalPackages = async () => {
        if (stopped || externalSyncing) return;
        externalSyncing = true;
        try {
            if (suppressAppPackageSync) return;
            for (const source of DESKTOP_PACKAGE_SOURCES) {
                for (const item of collectDesktopPackages(source)) {
                    let stats;
                    try {
                        stats = fs.statSync(item.fullPath);
                    } catch (e) {
                        continue;
                    }
                    const signature = `${stats.size}:${stats.mtimeMs}`;
                    const previous = externalSignatures.get(item.remotePath);
                    externalSignatures.set(item.remotePath, signature);
                    if (previous === signature) continue;
                    // 首次扫描只建立基线，避免把已存在的产物重复上传一遍
                    if (!externalSeeded) continue;

                    const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
                    console.log(`\n🪟 [${source.label}] 检测到新构建产物: ${item.fileName} (${sizeMb} MB)`);
                    const ok = await syncFile(item.remotePath, item.fullPath, 3, 2000, { force: true });
                    if (ok) {
                        console.log(`   🔗 https://zhengzhengstudio.cn/api/apps/${encodeURIComponent(item.fileName)}`);
                    }
                }
            }
        } catch (err) {
            console.error(`[Watch Error] 桌面安装包扫描失败: ${err.message}`);
        } finally {
            externalSyncing = false;
            externalSeeded = true;
        }
    };

    // 建立基线（异步，不会阻塞监听启动）
    scanExternalPackages();

    const scanForChanges = () => {
        if (stopped || isScanning) return;
        isScanning = true;
        try {
            scanWatchTree(websitePath);
            scanExternalPackages();
            if (pendingFiles.size > 0 && !timeout) {
                timeout = setTimeout(processPending, 250);
            }
        } catch (err) {
            console.error(`[Watch Error] 扫描失败: ${err.message}`);
        } finally {
            isScanning = false;
        }
    };

    const watchPollTimer = setInterval(scanForChanges, watchPollIntervalMs);
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(watchPollTimer);
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
        pendingFiles.clear();
    };
    // 连上手机后立刻补发断线期间积压的改动
    stop.flush = () => {
        if (stopped) return;
        scanForChanges();
        if (pendingFiles.size > 0) processPending();
    };
    return stop;
}

/**
 * 让当前 watch 立刻冲刷积压的变更（重连成功后调用）。
 * 手机离线期间 pendingFiles 会攒下改动，连上后不用等下一个轮询周期。
 */
function flushWatchBacklog() {
    if (!stopActiveWatchFlush) return;
    try {
        stopActiveWatchFlush();
    } catch (error) {
        console.warn(`⚠️ [Watch Mode] 补发积压变更失败: ${error.message}`);
    }
}

function activateWatch() {
    stopActiveWatch?.();
    const stop = startWatch();
    stopActiveWatch = stop.stop || stop;
    stopActiveWatchFlush = stop.flush || null;
}

if (args.stopWatch) {
    // 停止逻辑已在文件头部处理完毕（含异步 kill 分支），这里必须显式拦住，
    // 否则会继续往下走到 runSync()，表现为「停止监听」顺带跑一轮全量同步。
} else if (args.isWatch) {
    if (args.watchOnly) {
        // watch-only 的语义就是「只监听、不做首次全量同步」，所以监听必须立刻挂起来，
        // 不能被连接流程（换网段时要扫 254 个 IP，可能十几秒）挡住。
        activateWatch();
        ensureDailyApiBackupScheduled();
        // watch-only 不做启动备份：它通常被反复拉起（改代码→重启监听），
        // 每次都拉 12MB 压缩包既慢又会把备份目录撑满。
        // 只保留 ensureDailyApiBackupScheduled 的每天 20:00 定时备份（受 7 天节流）。
        prepareConnection().then(async (connected) => {
            if (!connected) return;
            flushWatchBacklog();
            console.log('ℹ️ [API Backup] watch-only 模式跳过启动备份，仅保留每天 20:00 定时备份');
        });
    } else {
        // 监听模式下先执行一次全量同步
        runSync().then(() => {
            startWatchWithBackgroundBackup({
                startWatch: activateWatch,
                downloadBackup: downloadTermuxApiBackup,
                scheduleBackup: ensureDailyApiBackupScheduled,
                onBackupSettled: () => console.log('👀 [Watch Mode] 备份任务已结束，文件监听仍在运行'),
                reason: 'sync-complete'
            });
        });
    }
} else {
    // 普通模式直接执行一次
    runSync().then(() => downloadTermuxApiBackup('sync-complete'));
}
