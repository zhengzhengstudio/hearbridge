/**
 * 最近 3 次运行日志。
 *
 * 每次启动开一条会话，运行中追加关键节点，正常退出时结案；
 * 若下次启动发现上一条还停在 running，就判定「上次未正常结束」。
 * 原生层 SIGSEGV 直接杀进程，JS 来不及写任何东西，因此安卓端再向 AppActivity
 * 取一份「系统退出原因 + 启动轨迹 + 崩溃报告」，与这里的会话记录合并展示。
 *
 * 只保留 3 条，每条最多 MAX_LINES 行：日志面板要看的是「最近三次发生了什么」，
 * 不是无限增长的调试文件。
 */

import { BUILD_INFO } from '../core/BuildInfo';

export interface RunLogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type RunResult = 'running' | 'normal' | 'abnormal' | 'crash';

export interface RunLogEntry {
  id: string;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  result: RunResult;
  version: string;
  build: number;
  lines: string[];
}

/** 安卓 AppActivity 提供的最近三次进程退出记录。 */
export interface NativeRunLog {
  time: string;
  result: string;
  version: string;
  reason: string;
  trace: string;
  crash: string;
}

export const RUN_LOG_LIMIT = 3;
const STORAGE_KEY = 'spacefight.runlog.v1';
const MAX_LINES = 80;
const MAX_DETAIL_CHARS = 12000;

export const RUN_RESULT_LABELS: Readonly<Record<RunResult, string>> = {
  running: '运行中',
  normal: '正常结束',
  abnormal: '未正常结束',
  crash: '崩溃退出',
};

function now(): number {
  return Date.now();
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatTimestamp(millis: number): string {
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} `
    + `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

function clock(millis: number): string {
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return '--:--:--';
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

function readEntries(storage: RunLogStorage): RunLogEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RunLogEntry => {
      const entry = item as RunLogEntry | null;
      return !!entry && typeof entry.id === 'string' && typeof entry.startedAt === 'number'
        && Array.isArray(entry.lines);
    }).slice(-RUN_LOG_LIMIT);
  } catch {
    return [];
  }
}

function writeEntries(storage: RunLogStorage, entries: RunLogEntry[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-RUN_LOG_LIMIT)));
  } catch {
    // 存储写失败不能影响游戏启动
  }
}

/** 开始一次运行：旧会话没结案就标成「未正常结束」，然后开新的一条。 */
export function startRunLog(
  storage: RunLogStorage,
  info: { version?: string; build?: number; platform?: string } = {},
): RunLogEntry {
  const entries = readEntries(storage);
  const stamp = now();
  const previous = entries[entries.length - 1];
  if (previous && previous.result === 'running') {
    previous.result = 'abnormal';
    previous.endedAt = stamp;
    previous.updatedAt = stamp;
    previous.lines.push(`[${clock(stamp)}] 上次运行未正常结束，进程可能被系统终止`);
  }
  const platform = info.platform || '本机';
  const entry: RunLogEntry = {
    id: `run-${stamp}-${Math.floor(Math.random() * 10000)}`,
    startedAt: stamp,
    updatedAt: stamp,
    endedAt: null,
    result: 'running',
    version: info.version || BUILD_INFO.version,
    build: info.build || BUILD_INFO.build,
    lines: [
      `[${clock(stamp)}] 启动 ${platform} 客户端 ${info.version || BUILD_INFO.version}`,
    ],
  };
  entries.push(entry);
  writeEntries(storage, entries);
  return entry;
}

/** 追加一条运行事件；没有活跃会话时不凭空造记录。 */
export function appendRunLog(storage: RunLogStorage, message: string, detail?: string): void {
  if (!message) return;
  const entries = readEntries(storage);
  const entry = entries[entries.length - 1];
  if (!entry) return;
  const stamp = now();
  const line = `[${clock(stamp)}] ${message}${detail ? ` · ${detail}` : ''}`;
  entry.lines.push(line.slice(0, 400));
  if (entry.lines.length > MAX_LINES) {
    entry.lines = [entry.lines[0], '…… 中间记录已省略 ……', ...entry.lines.slice(-(MAX_LINES - 2))];
  }
  entry.updatedAt = stamp;
  writeEntries(storage, entries);
}

/** 结案：正常退出 / 脚本捕获到崩溃。 */
export function finishRunLog(storage: RunLogStorage, result: RunResult, message?: string): void {
  const entries = readEntries(storage);
  const entry = entries[entries.length - 1];
  if (!entry || entry.result !== 'running') return;
  const stamp = now();
  entry.result = result;
  entry.endedAt = stamp;
  entry.updatedAt = stamp;
  entry.lines.push(`[${clock(stamp)}] ${message || RUN_RESULT_LABELS[result]}`);
  writeEntries(storage, entries);
}

/** 新的在前；面板按这个顺序显示 3 张卡片。 */
export function readRunLogs(storage: RunLogStorage): RunLogEntry[] {
  return readEntries(storage).slice().reverse();
}

export function runLogSummary(entry: RunLogEntry): string {
  const duration = Math.max(0, ((entry.endedAt || entry.updatedAt) - entry.startedAt) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  const length = minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
  return `${RUN_RESULT_LABELS[entry.result]} · 运行 ${length} · ${entry.lines.length} 条记录`;
}

/** 一条会话的完整可读文本（复制按钮用）。 */
export function formatRunLog(entry: RunLogEntry, native?: NativeRunLog): string {
  const head = [
    `共 ${entry.lines.length} 条记录 · ${RUN_RESULT_LABELS[entry.result]}`,
    `开始：${formatTimestamp(entry.startedAt)}`,
    entry.endedAt ? `结束：${formatTimestamp(entry.endedAt)}` : '结束：未记录',
    `版本：${entry.version} / BUILD ${entry.build}`,
    '',
    '---- 运行过程 ----',
    ...entry.lines,
  ];
  if (native) {
    head.push(
      '',
      '---- 系统退出记录 ----',
      `时间：${native.time}`,
      `原因：${native.reason || '无'}`,
      `结论：${native.result || '无'}`,
      native.trace ? `\n---- 启动轨迹 ----\n${native.trace}` : '',
      native.crash ? `\n---- 崩溃报告 ----\n${native.crash}` : '',
    );
  }
  return head.filter((line) => line !== '').join('\n').slice(0, MAX_DETAIL_CHARS);
}

// ---- 安卓原生侧 ----

type ReflectionApi = {
  callStaticMethod(className: string, methodName: string, signature: string, ...args: unknown[]): unknown;
};

function reflection(): ReflectionApi | null {
  const globals = globalThis as unknown as {
    jsb?: { reflection?: ReflectionApi };
    native?: { reflection?: ReflectionApi };
  };
  const api = globals.native?.reflection || globals.jsb?.reflection;
  return api && typeof api.callStaticMethod === 'function' ? api : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 读取 AppActivity 保存的最近 3 次系统运行记录；非安卓或无桥接时返回空数组。 */
export function nativeRunLogs(): NativeRunLog[] {
  try {
    const raw = reflection()?.callStaticMethod(
      'com/cocos/game/AppActivity',
      'spaceFightInvoke',
      '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
      'runLogs',
      '{}',
    );
    if (typeof raw !== 'string' || !raw.startsWith('[')) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, RUN_LOG_LIMIT).map((item): NativeRunLog => {
      const record = (item || {}) as Record<string, unknown>;
      return {
        time: asText(record.time) || '时间未知',
        result: asText(record.result),
        version: asText(record.version),
        reason: asText(record.reason),
        trace: asText(record.trace),
        crash: asText(record.crash),
      };
    });
  } catch {
    return [];
  }
}

/** 复制完整日志：安卓走 AppActivity 剪贴板桥，网页走浏览器剪贴板。 */
export function copyRunLogText(text: string): boolean {
  try {
    const result = reflection()?.callStaticMethod(
      'com/cocos/game/AppActivity',
      'spaceFightInvoke',
      '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
      'copyText',
      JSON.stringify({ text }),
    );
    if (typeof result === 'string') return true;
  } catch {
    // 非安卓或桥接不可用时继续尝试浏览器剪贴板
  }
  try {
    const clipboard = (globalThis as unknown as {
      navigator?: { clipboard?: { writeText?(text: string): Promise<void> } };
    }).navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard.writeText(text).catch(() => {});
      return true;
    }
  } catch {
    // 剪贴板不可用时由界面提示用户截图
  }
  return false;
}

/** 全局脚本异常写进当前会话，避免「页面报错但日志里什么都没有」。 */
export function installRunLogErrorHooks(storage: RunLogStorage): void {
  const scope = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  if (typeof scope.addEventListener !== 'function') return;
  const describe = (event: unknown): string => {
    const candidate = event as { message?: unknown; reason?: unknown } | null;
    const message = typeof candidate?.message === 'string'
      ? candidate.message
      : typeof candidate?.reason === 'string' ? candidate.reason : '未知脚本错误';
    return message.slice(0, 160);
  };
  scope.addEventListener('error', (event) => {
    appendRunLog(storage, '脚本错误', describe(event));
    if (/Fatal signal|SIGABRT|SIGSEGV|out_of_range/i.test(describe(event))) {
      finishRunLog(storage, 'crash', '脚本捕获到致命信号');
    }
  });
  scope.addEventListener('unhandledrejection', (event) => {
    appendRunLog(storage, '未处理的异步错误', describe(event));
  });
}
