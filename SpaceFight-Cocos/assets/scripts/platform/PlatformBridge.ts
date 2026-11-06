export type HapticEvent =
  | 'ui-light'
  | 'lock-confirm'
  | 'weapon-light'
  | 'weapon-heavy'
  | 'impact-medium'
  | 'shield-break';

export type PlatformName = 'web' | 'android' | 'ios' | 'macos' | 'harmonyos';

export interface DeviceSnapshot {
  readonly memoryGB: number | null;
  readonly availableMemoryGB: number | null;
  readonly lowRamDevice: boolean | null;
  readonly emulator: boolean | null;
  readonly logicalCores: number | null;
  readonly gpuRenderer: string | null;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pixelRatio: number;
}

export interface PlatformBridge {
  readonly platform: PlatformName;
  readonly offline: boolean;
  readonly capabilities: { auth: boolean; updates: boolean; haptics: boolean };
  readText(key: string): Promise<string | null>;
  writeText(key: string, value: string): Promise<void>;
  haptic(event: HapticEvent): Promise<void>;
  deviceSnapshot(): Promise<DeviceSnapshot>;
}

export interface NativeHost {
  invoke(
    method: 'readText' | 'writeText' | 'haptic' | 'deviceSnapshot',
    payload: string,
  ): string | Promise<string>;
}

export interface TextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let registeredBridge: PlatformBridge | null = null;

export function registerPlatformBridge(bridge: PlatformBridge): void {
  registeredBridge = bridge;
}

export function platformBridge(): PlatformBridge {
  if (!registeredBridge) {
    throw new Error('Platform bridge has not been registered.');
  }
  return registeredBridge;
}
