import type {
  DeviceSnapshot,
  HapticEvent,
  NativeHost,
  PlatformBridge,
  PlatformName,
} from './PlatformBridge';

type NativeMethod = 'readText' | 'writeText' | 'haptic' | 'deviceSnapshot';
type NativePlatform = Exclude<PlatformName, 'web'>;

export interface PlatformDiagnostic {
  readonly code: 'native-response-invalid-json' | 'native-response-invalid-payload' | 'native-response-invocation-failed';
  readonly method: NativeMethod;
}

export interface NativePlatformBridgeOptions {
  readonly platform: NativePlatform;
  readonly offline?: boolean;
  readonly diagnostic?: (event: PlatformDiagnostic) => void;
}

const DEFAULT_DEVICE_SNAPSHOT: DeviceSnapshot = {
  memoryGB: null,
  availableMemoryGB: null,
  lowRamDevice: null,
  emulator: null,
  logicalCores: null,
  gpuRenderer: null,
  viewportWidth: 0,
  viewportHeight: 0,
  pixelRatio: 1,
};

function report(
  diagnostic: NativePlatformBridgeOptions['diagnostic'],
  code: PlatformDiagnostic['code'],
  method: NativeMethod,
): void {
  diagnostic?.({ code, method });
}

async function invokeJson<T>(
  host: NativeHost,
  method: NativeMethod,
  payload: Record<string, unknown>,
  fallback: T,
  validate: (value: unknown) => boolean,
  diagnostic: NativePlatformBridgeOptions['diagnostic'],
): Promise<T> {
  let raw: string;
  try {
    raw = await host.invoke(method, JSON.stringify(payload));
  } catch {
    report(diagnostic, 'native-response-invocation-failed', method);
    return fallback;
  }

  let response: unknown;
  try {
    response = JSON.parse(raw);
  } catch {
    report(diagnostic, 'native-response-invalid-json', method);
    return fallback;
  }

  if (!validate(response)) {
    report(diagnostic, 'native-response-invalid-payload', method);
    return fallback;
  }
  return response as T;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isVoidResponse(value: unknown): value is null {
  return value === null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function normalizeDeviceSnapshot(value: unknown): DeviceSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Record<string, unknown>;
  const memoryGB = finiteNumber(snapshot.memoryGB, 0.25, 256);
  const availableMemoryGB = finiteNumber(snapshot.availableMemoryGB, 0, 256);
  const logicalCores = finiteNumber(snapshot.logicalCores, 1, 256);
  const viewportWidth = finiteNumber(snapshot.viewportWidth, 0, 32768) || 0;
  const viewportHeight = finiteNumber(snapshot.viewportHeight, 0, 32768) || 0;
  const pixelRatio = finiteNumber(snapshot.pixelRatio, 0.25, 8) || 1;
  const gpuRenderer = typeof snapshot.gpuRenderer === 'string'
    && snapshot.gpuRenderer.length > 0
    && snapshot.gpuRenderer.length <= 256
    ? snapshot.gpuRenderer
    : null;
  return {
    memoryGB,
    availableMemoryGB,
    lowRamDevice: typeof snapshot.lowRamDevice === 'boolean' ? snapshot.lowRamDevice : null,
    emulator: typeof snapshot.emulator === 'boolean' ? snapshot.emulator : null,
    logicalCores: logicalCores === null ? null : Math.floor(logicalCores),
    gpuRenderer,
    viewportWidth,
    viewportHeight,
    pixelRatio,
  };
}

function isObjectResponse(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export class NativePlatformBridge implements PlatformBridge {
  readonly platform: NativePlatform;
  readonly offline: boolean;
  readonly capabilities = { auth: false, updates: false, haptics: true };

  constructor(
    private readonly host: NativeHost,
    private readonly options: NativePlatformBridgeOptions,
  ) {
    this.platform = options.platform;
    this.offline = options.offline === true;
  }

  async readText(key: string): Promise<string | null> {
    return invokeJson(
      this.host,
      'readText',
      { key },
      null,
      isNullableString,
      this.options.diagnostic,
    );
  }

  async writeText(key: string, value: string): Promise<void> {
    await invokeJson(
      this.host,
      'writeText',
      { key, value },
      null,
      isVoidResponse,
      this.options.diagnostic,
    );
  }

  async haptic(event: HapticEvent): Promise<void> {
    await invokeJson(
      this.host,
      'haptic',
      { event },
      null,
      isVoidResponse,
      this.options.diagnostic,
    );
  }

  async deviceSnapshot(): Promise<DeviceSnapshot> {
    const value = await invokeJson(
      this.host,
      'deviceSnapshot',
      {},
      DEFAULT_DEVICE_SNAPSHOT,
      isObjectResponse,
      this.options.diagnostic,
    );
    const normalized = normalizeDeviceSnapshot(value);
    if (normalized) return normalized;
    report(this.options.diagnostic, 'native-response-invalid-payload', 'deviceSnapshot');
    return DEFAULT_DEVICE_SNAPSHOT;
  }
}
