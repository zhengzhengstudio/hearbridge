import type {
  DeviceSnapshot,
  HapticEvent,
  PlatformBridge,
  TextStorage,
} from './PlatformBridge';

export interface WebPlatformBridgeOptions {
  readonly offline?: boolean;
  readonly storage?: TextStorage;
}

function browserValue(name: string): unknown {
  return (globalThis as unknown as Record<string, unknown>)[name];
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function supportedHaptics(): boolean {
  const navigatorRef = browserValue('navigator') as { vibrate?: unknown } | undefined;
  return typeof navigatorRef?.vibrate === 'function';
}

export class WebPlatformBridge implements PlatformBridge {
  readonly platform = 'web' as const;
  readonly offline: boolean;
  readonly capabilities: { auth: boolean; updates: boolean; haptics: boolean };

  constructor(private readonly options: WebPlatformBridgeOptions = {}) {
    this.offline = options.offline === true;
    this.capabilities = { auth: false, updates: false, haptics: supportedHaptics() };
  }

  async readText(key: string): Promise<string | null> {
    try {
      return this.options.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  async writeText(key: string, value: string): Promise<void> {
    try {
      this.options.storage?.setItem(key, value);
    } catch {
      // Storage is optional; failure leaves the scene usable.
    }
  }

  async haptic(_event: HapticEvent): Promise<void> {
    const navigatorRef = browserValue('navigator') as { vibrate?: (pattern: number) => unknown } | undefined;
    try {
      navigatorRef?.vibrate?.(12);
    } catch {
      // Browser haptics are best-effort.
    }
  }

  async deviceSnapshot(): Promise<DeviceSnapshot> {
    const navigatorRef = browserValue('navigator') as {
      deviceMemory?: unknown;
      hardwareConcurrency?: unknown;
    } | undefined;
    return {
      memoryGB: typeof navigatorRef?.deviceMemory === 'number' ? navigatorRef.deviceMemory : null,
      availableMemoryGB: null,
      lowRamDevice: null,
      emulator: null,
      logicalCores: typeof navigatorRef?.hardwareConcurrency === 'number'
        ? navigatorRef.hardwareConcurrency
        : null,
      gpuRenderer: null,
      viewportWidth: finiteNonNegative(browserValue('innerWidth'), 0),
      viewportHeight: finiteNonNegative(browserValue('innerHeight'), 0),
      pixelRatio: finiteNonNegative(browserValue('devicePixelRatio'), 1) || 1,
    };
  }
}
