import {
  registerPlatformBridge,
  type NativeHost,
  type PlatformBridge,
  type PlatformName,
  type TextStorage,
} from './PlatformBridge';
import {
  NativePlatformBridge,
  type NativePlatformBridgeOptions,
} from './NativePlatformBridge';
import { WebPlatformBridge } from './WebPlatformBridge';

export interface PlatformBootstrapOptions {
  readonly nativeHost?: NativeHost;
  readonly platform?: PlatformName;
  readonly offline?: boolean;
  readonly storage?: TextStorage;
  readonly diagnostic?: NativePlatformBridgeOptions['diagnostic'];
}

declare global {
  var __SPACEFIGHT_NATIVE__: NativeHost | undefined;
}

function hostFromGlobal(): NativeHost | undefined {
  const candidate = globalThis.__SPACEFIGHT_NATIVE__;
  return candidate && typeof candidate.invoke === 'function' ? candidate : undefined;
}

interface ReflectionApi {
  callStaticMethod(
    className: string,
    methodName: string,
    signature: string,
    ...parameters: unknown[]
  ): unknown;
}

function reflectionFromGlobal(): ReflectionApi | undefined {
  const globals = globalThis as unknown as {
    jsb?: { reflection?: ReflectionApi };
    native?: { reflection?: ReflectionApi };
  };
  return globals.native?.reflection || globals.jsb?.reflection;
}

function androidReflectionHost(platform: Exclude<PlatformName, 'web'> | null): NativeHost | undefined {
  if (platform !== 'android') return undefined;
  const reflection = reflectionFromGlobal();
  if (!reflection || typeof reflection.callStaticMethod !== 'function') return undefined;
  return {
    invoke(method, payload): string {
      const result = reflection.callStaticMethod(
        'com/cocos/game/AppActivity',
        'spaceFightInvoke',
        '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
        method,
        payload,
      );
      return typeof result === 'string' ? result : 'null';
    },
  };
}

function requestedNativeHost(
  options: PlatformBootstrapOptions,
  platform: Exclude<PlatformName, 'web'> | null,
): NativeHost | undefined {
  return Object.prototype.hasOwnProperty.call(options, 'nativeHost')
    ? options.nativeHost
    : hostFromGlobal() || androidReflectionHost(platform);
}

function trustedNativePlatform(platform: unknown): Exclude<PlatformName, 'web'> | null {
  switch (platform) {
    case 'android':
    case 'ios':
    case 'macos':
    case 'harmonyos':
      return platform;
    default:
      return null;
  }
}

export function createPlatformBridge(options: PlatformBootstrapOptions = {}): PlatformBridge {
  const nativePlatform = trustedNativePlatform(options.platform);
  const nativeHost = requestedNativeHost(options, nativePlatform);
  if (nativeHost && nativePlatform) {
    return new NativePlatformBridge(nativeHost, {
      platform: nativePlatform,
      offline: options.offline,
      diagnostic: options.diagnostic,
    });
  }
  return new WebPlatformBridge({ offline: options.offline, storage: options.storage });
}

export function bootstrapPlatformBridge(options: PlatformBootstrapOptions = {}): PlatformBridge {
  const bridge = createPlatformBridge(options);
  registerPlatformBridge(bridge);
  return bridge;
}

export function dismissNativeLaunchScreen(platform: PlatformName | null): void {
  if (platform !== 'android') return;
  const reflection = reflectionFromGlobal();
  if (!reflection || typeof reflection.callStaticMethod !== 'function') return;
  try {
    reflection.callStaticMethod(
      'com/cocos/game/AppActivity',
      'hideSpaceFightLaunchScreen',
      '()V',
    );
  } catch (error: unknown) {
    console.warn('[SpaceFight boot] native launch overlay remains visible', error);
  }
}

export function requestNativeUpdateCheck(): boolean {
  const reflection = reflectionFromGlobal();
  if (!reflection || typeof reflection.callStaticMethod !== 'function') return false;
  try {
    reflection.callStaticMethod(
      'com/cocos/game/AppActivity',
      'requestSpaceFightUpdateCheck',
      '()V',
    );
    return true;
  } catch (error: unknown) {
    console.warn('[SpaceFight update] native update checker unavailable', error);
    return false;
  }
}
