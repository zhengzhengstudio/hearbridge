/**
 * 可改键位：动作 → 按键码映射。
 *
 * 设计要点：
 * 1. 只认 DOM `KeyboardEvent.code` 风格的键码（KeyW / Space / ArrowUp …），
 *    桌面浏览器与 Cocos 原生键盘事件统一换算到这一套，避免两端各写一份映射。
 * 2. 一个键只能属于一个动作：改键时自动从其它动作里摘掉，杜绝「两件事一起触发」。
 * 3. 归一化永远补齐全部动作，旧存档缺字段时回落到默认键位，玩家不会丢按键。
 */

export type GameAction =
  | 'throttleForward'
  | 'throttleBack'
  | 'strafeLeft'
  | 'strafeRight'
  | 'boost'
  | 'primaryFire'
  | 'secondaryFire'
  | 'swapWeapons'
  | 'deviceAbility'
  | 'cameraToggle'
  | 'pause'
  | 'returnRequested'
  | 'advanceRequested';

export const GAME_ACTIONS: readonly GameAction[] = [
  'throttleForward',
  'throttleBack',
  'strafeLeft',
  'strafeRight',
  'primaryFire',
  'secondaryFire',
  'boost',
  'swapWeapons',
  'deviceAbility',
  'cameraToggle',
  'pause',
  'returnRequested',
  'advanceRequested',
] as const;

/** 设置面板用的动作名；保持纯中文，不塞后台术语。 */
export const GAME_ACTION_LABELS: Readonly<Record<GameAction, string>> = {
  throttleForward: '加速前进',
  throttleBack: '减速后退',
  strafeLeft: '左平移',
  strafeRight: '右平移',
  primaryFire: '主武器开火',
  secondaryFire: '副武器开火',
  boost: '推进加速',
  swapWeapons: '切换主副武器',
  deviceAbility: '战术设备技能',
  cameraToggle: '切换视角',
  pause: '暂停',
  returnRequested: '返航',
  advanceRequested: '确认继续',
};

export type KeyBindings = Record<GameAction, string[]>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  throttleForward: ['KeyW', 'ArrowUp'],
  throttleBack: ['KeyS', 'ArrowDown'],
  strafeLeft: ['KeyA', 'ArrowLeft'],
  strafeRight: ['KeyD', 'ArrowRight'],
  primaryFire: ['Space'],
  secondaryFire: ['KeyQ'],
  boost: ['ShiftLeft'],
  swapWeapons: ['KeyE'],
  deviceAbility: ['KeyF'],
  cameraToggle: ['F2'],
  pause: ['Escape'],
  returnRequested: ['KeyR'],
  advanceRequested: ['Enter'],
};

/** 允许绑定的按键。刻意不含系统保留键（F5 刷新、Ctrl+Alt 组合解锁光标等）。 */
export const BINDABLE_KEYS: readonly string[] = (() => {
  const keys: string[] = [];
  for (let index = 0; index < 26; index += 1) {
    keys.push(`Key${String.fromCharCode(65 + index)}`);
  }
  for (let digit = 0; digit <= 9; digit += 1) keys.push(`Digit${digit}`);
  keys.push(
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'Enter', 'Tab', 'Backspace', 'Escape',
    'ShiftLeft', 'ControlLeft', 'AltLeft',
  );
  for (let fn = 1; fn <= 12; fn += 1) {
    if (fn !== 5) keys.push(`F${fn}`);
  }
  return keys;
})();

const BINDABLE_SET = new Set(BINDABLE_KEYS);

export function isBindableKey(code: string): boolean {
  return BINDABLE_SET.has(code);
}

/** 干净的默认副本，避免调用方改到常量。 */
export function resetKeyBindings(): KeyBindings {
  const result = {} as KeyBindings;
  for (const action of GAME_ACTIONS) result[action] = [...DEFAULT_KEY_BINDINGS[action]];
  return result;
}

/**
 * 归一化：过滤非法键码、去重、解冲突（先出现的动作优先），缺失动作补默认。
 * 冲突解消放在读取侧，旧存档或手工改坏的 JSON 也不会让两个动作抢同一个键。
 */
export function normalizeKeyBindings(value: unknown): KeyBindings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = resetKeyBindings();
  const claimed = new Set<string>();
  // 第一轮：只采纳存档里显式给出且合法的绑定，按动作顺序先到先得。
  for (const action of GAME_ACTIONS) {
    const candidate = source[action];
    if (!Array.isArray(candidate)) {
      result[action] = [];
      continue;
    }
    const keys: string[] = [];
    for (const raw of candidate) {
      if (typeof raw !== 'string' || !isBindableKey(raw)) continue;
      if (claimed.has(raw) || keys.includes(raw)) continue;
      keys.push(raw);
      claimed.add(raw);
    }
    result[action] = keys;
  }
  // 第二轮：没配或配坏的动作，用默认键位里尚未被占用的键补齐，保证每个动作都能用。
  for (const action of GAME_ACTIONS) {
    if (result[action].length === 0) {
      result[action] = DEFAULT_KEY_BINDINGS[action].filter((code) => !claimed.has(code));
      for (const code of result[action]) claimed.add(code);
    }
  }
  return result;
}

/** 把某个动作绑定到新键：从所有其它动作里摘掉该键，返回新对象。 */
export function bindActionKey(bindings: KeyBindings, action: GameAction, code: string): KeyBindings {
  if (!isBindableKey(code)) return bindings;
  const normalized = normalizeKeyBindings(bindings);
  const next = {} as KeyBindings;
  for (const item of GAME_ACTIONS) next[item] = normalized[item].filter((key) => key !== code);
  next[action] = [code];
  return normalizeKeyBindings(next);
}

export function boundKeySet(bindings: KeyBindings): Set<string> {
  const keys = new Set<string>();
  for (const action of GAME_ACTIONS) {
    for (const code of bindings[action] || []) keys.add(code);
  }
  return keys;
}

export function isActionPressed(bindings: KeyBindings, action: GameAction, keys: ReadonlySet<string>): boolean {
  const codes = bindings[action] || [];
  for (const code of codes) if (keys.has(code)) return true;
  return false;
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: '空格', Enter: '回车', Tab: '制表', Backspace: '退格', Escape: '退出键',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: '左 Shift', ControlLeft: '左 Ctrl', AltLeft: '左 Alt',
};

/** 界面上显示的短键名；字母/数字/F 键保持键帽原字样。 */
export function displayKeyName(code: string): string {
  if (!code) return '未设置';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

/** 一个动作允许多个键时，界面用「/」串起来。 */
export function displayBinding(bindings: KeyBindings, action: GameAction): string {
  const codes = bindings[action] || [];
  return codes.length > 0 ? codes.map(displayKeyName).join(' / ') : '未设置';
}

// ---- 触屏按键位置 ----

export type TouchControlId =
  | 'movement'
  | 'primaryFire'
  | 'secondaryFire'
  | 'boost'
  | 'cameraToggle'
  | 'pause'
  | 'returnRequested'
  | 'advanceRequested'
  | 'swapWeapons'
  | 'deviceAbility';

export interface TouchControlPosition {
  /** 归一化到可见区域宽高的 0..1，避免横竖屏切换后位置跑飞。 */
  x: number;
  y: number;
}

export type TouchLayoutOffsets = Partial<Record<TouchControlId, TouchControlPosition>>;

const TOUCH_CONTROL_IDS: readonly TouchControlId[] = [
  'movement', 'primaryFire', 'secondaryFire', 'boost', 'cameraToggle', 'pause',
  'returnRequested', 'advanceRequested', 'swapWeapons', 'deviceAbility',
];

function clamp01(value: number): number {
  return Math.max(0.04, Math.min(0.96, value));
}

export function normalizeTouchOffsets(value: unknown): TouchLayoutOffsets {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: TouchLayoutOffsets = {};
  for (const id of TOUCH_CONTROL_IDS) {
    const candidate = source[id] as { x?: unknown; y?: unknown } | undefined;
    if (!candidate || typeof candidate !== 'object') continue;
    const x = typeof candidate.x === 'number' && Number.isFinite(candidate.x) ? candidate.x : NaN;
    const y = typeof candidate.y === 'number' && Number.isFinite(candidate.y) ? candidate.y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    result[id] = { x: clamp01(x), y: clamp01(y) };
  }
  return result;
}

export function setTouchControlPosition(
  offsets: TouchLayoutOffsets,
  id: TouchControlId,
  x: number,
  y: number,
): TouchLayoutOffsets {
  return { ...offsets, [id]: { x: clamp01(x), y: clamp01(y) } };
}
