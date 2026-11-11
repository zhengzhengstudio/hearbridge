/**
 * Android 原生崩溃诊断桥。
 *
 * 原生层 SIGABRT 会直接结束进程，logcat / tombstone 在真机上又常被系统权限挡住，
 * 所以把启动与布局阶段写进 AppActivity 的轨迹文件：崩溃后下次启动的诊断弹窗
 * 会把「最后执行阶段」一并显示，错因可一键复制。
 * Web / 桌面 / iOS 没有这套反射，所有调用静默跳过，不影响其它端。
 */

import { installNativeGraphicsGuard, isNativeRuntime } from './NativeGraphicsGuard';

type ReflectionApi = {
  callStaticMethod(className: string, methodName: string, signature: string, ...args: unknown[]): unknown;
};

const ACTIVITY = 'com/cocos/game/AppActivity';
const TRACE_SIGNATURE = '(Ljava/lang/String;)V';
const FATAL_SIGNATURE = '(Ljava/lang/String;Ljava/lang/String;)V';

function reflection(): ReflectionApi | null {
  const globals = globalThis as unknown as {
    jsb?: { reflection?: ReflectionApi };
    native?: { reflection?: ReflectionApi };
  };
  const api = globals.native?.reflection || globals.jsb?.reflection;
  return api && typeof api.callStaticMethod === 'function' ? api : null;
}

/** 记录一个阶段；诊断埋点绝不允许影响玩法。 */
export function nativeTrace(stage: string): void {
  try {
    reflection()?.callStaticMethod(ACTIVITY, 'spaceFightTrace', TRACE_SIGNATURE, stage);
  } catch {
    // 反射不可用时静默跳过
  }
}

/** 明确要退出的脚本致命错误：立刻弹诊断窗，不等下次启动。 */
export function nativeFatal(reason: string, detail: string): void {
  try {
    reflection()?.callStaticMethod(ACTIVITY, 'spaceFightFatal', FATAL_SIGNATURE, reason, detail);
  } catch {
    // 反射不可用时静默跳过
  }
}

function describeError(event: unknown): string {
  const candidate = event as {
    message?: unknown;
    reason?: unknown;
    stack?: unknown;
    error?: { stack?: unknown };
  } | null;
  const reason = typeof candidate?.reason === 'string' ? candidate.reason : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : reason;
  const stack = typeof candidate?.stack === 'string'
    ? candidate.stack
    : typeof candidate?.error?.stack === 'string' ? candidate.error.stack : '';
  return `${message || 'unknown script error'}${stack ? `\n${stack}` : ''}`;
}

/** 全局脚本错误：先留轨迹，只有命中原生致命关键字才弹窗。 */
export function installNativeErrorHooks(): void {
  // 必须在任何 Graphics 组件被创建/绘制之前接管原型，否则首帧仍会走未受保护的绑定。
  const guarded = installNativeGraphicsGuard();
  nativeTrace(`boot: graphics guard ${guarded ? 'on' : 'off'} (native=${isNativeRuntime()})`);
  const scope = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  if (typeof scope.addEventListener !== 'function') return;
  scope.addEventListener('error', (event) => {
    const detail = describeError(event);
    nativeTrace(`js-error: ${detail.split('\n')[0].slice(0, 160)}`);
    if (/out_of_range|SIGABRT|Fatal signal|abort/i.test(detail)) {
      nativeFatal('脚本捕获到致命错误', detail.slice(0, 4000));
    }
  });
  scope.addEventListener('unhandledrejection', (event) => {
    nativeTrace(`unhandled-rejection: ${describeError(event).split('\n')[0].slice(0, 160)}`);
  });
}
