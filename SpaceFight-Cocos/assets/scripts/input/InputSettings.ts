import {
  normalizeKeyBindings,
  normalizeTouchOffsets,
  type KeyBindings,
  type TouchLayoutOffsets,
} from './KeyBindings';

export interface InputSettings {
  sensitivity: number;
  invertY: boolean;
  leftHanded: boolean;
  controlScale: number;
  /** 可改键位：桌面 / 外接键盘的动作 → 按键映射。 */
  keyBindings: KeyBindings;
  /** 可改键位：触屏摇杆与动作按钮的自定义位置（归一化坐标，空对象＝跟随默认布局）。 */
  touchOffsets: TouchLayoutOffsets;
}

export interface InputSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// v2 保留 v1 键：老存档里的灵敏度 / 左右手设置不能因为加字段被丢掉。
const STORAGE_KEY = 'spacefight.input.v1';

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  sensitivity: 1,
  invertY: false,
  leftHanded: false,
  controlScale: 1,
  keyBindings: normalizeKeyBindings({}),
  touchOffsets: {},
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeInputSettings(settings?: Partial<InputSettings> | null): InputSettings {
  const source = settings || {};
  return {
    sensitivity: clamp(finiteNumber(source.sensitivity, 1), 0.25, 3),
    invertY: source.invertY === true,
    leftHanded: source.leftHanded === true,
    controlScale: clamp(finiteNumber(source.controlScale, 1), 0.75, 1.35),
    keyBindings: normalizeKeyBindings(source.keyBindings ?? {}),
    touchOffsets: normalizeTouchOffsets(source.touchOffsets ?? {}),
  };
}

export function loadInputSettings(storage: InputSettingsStorage): InputSettings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? normalizeInputSettings(JSON.parse(raw) as Partial<InputSettings>) : { ...DEFAULT_INPUT_SETTINGS };
  } catch {
    return { ...DEFAULT_INPUT_SETTINGS };
  }
}

export function saveInputSettings(
  storage: InputSettingsStorage,
  settings: Partial<InputSettings>,
): InputSettings {
  const normalized = normalizeInputSettings(settings);
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
