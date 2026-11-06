import type { GraphicsTier } from './GraphicsProfile';
import type { DeviceFormFactor } from './DeviceFormFactor';

export interface CapabilityInput {
  readonly platform: 'web' | 'android' | 'ios' | 'macos' | 'harmonyos';
  readonly memoryGB: number | null;
  readonly availableMemoryGB?: number | null;
  readonly lowRamDevice?: boolean | null;
  readonly emulator?: boolean | null;
  readonly benchmarkFrameMs: number | null;
  readonly promptPreference?: 'ask' | 'never';
  readonly requestedTier?: GraphicsTier;
  /** 折叠/展开态。展开后可视面积变大但 GPU 不变，能力未知时保守选档。 */
  readonly formFactor?: DeviceFormFactor;
}

export interface GraphicsDecision {
  readonly tier: GraphicsTier;
  readonly prompt: boolean;
  readonly reason: 'user-selected' | 'harmony-default-high' | 'harmony-critical-fallback' | 'harmony-unknown-safe-fallback' | 'android-below-baseline' | 'android-runtime-constrained' | 'android-emulator' | 'expanded-form-factor-conservative' | 'platform-default-high';
  readonly persistPromptSuppression: boolean;
}

export type GraphicsSimulationState = 'pre-combat' | 'playing';
export type NativePlatformName = Exclude<CapabilityInput['platform'], 'web'>;

export interface CocosSystemSnapshot {
  readonly isNative?: boolean;
  readonly os?: unknown;
  readonly OS?: {
    readonly ANDROID?: unknown;
    readonly IOS?: unknown;
    readonly OSX?: unknown;
    readonly OHOS?: unknown;
    readonly OPENHARMONY?: unknown;
  };
}

const ANDROID_MEMORY_BASELINE_GB = 4;
const ANDROID_FRAME_TIME_BASELINE_MS = 40;
const HARMONY_MEMORY_CRITICAL_GB = 4;
const HARMONY_FRAME_TIME_CRITICAL_MS = 50;
const ANDROID_AVAILABLE_MEMORY_CRITICAL_GB = 0.75;

const EXPANDED_FORM_FACTORS: readonly DeviceFormFactor[] = [
  'fold-open', 'wide-fold', 'tri-fold-dual', 'tri-fold-triple', 'dual-screen',
];

function expandedFormFactor(formFactor: DeviceFormFactor): boolean {
  return EXPANDED_FORM_FACTORS.includes(formFactor);
}

function androidRuntimeConstrained(input: CapabilityInput): boolean {
  return input.lowRamDevice === true
    || (input.availableMemoryGB !== null
      && input.availableMemoryGB !== undefined
      && input.availableMemoryGB < ANDROID_AVAILABLE_MEMORY_CRITICAL_GB);
}

function belowAndroidBaseline(input: CapabilityInput): boolean {
  const capabilityUnknown = input.memoryGB === null && input.benchmarkFrameMs === null;
  return capabilityUnknown
    || (input.memoryGB !== null && input.memoryGB < ANDROID_MEMORY_BASELINE_GB)
    || (input.benchmarkFrameMs !== null && input.benchmarkFrameMs > ANDROID_FRAME_TIME_BASELINE_MS);
}

function criticallyBelowHarmonyBaseline(input: CapabilityInput): boolean {
  return (input.memoryGB !== null && input.memoryGB < HARMONY_MEMORY_CRITICAL_GB)
    || (input.benchmarkFrameMs !== null && input.benchmarkFrameMs > HARMONY_FRAME_TIME_CRITICAL_MS);
}

function harmonyCapabilityUnknown(input: CapabilityInput): boolean {
  return input.memoryGB === null
    && (input.availableMemoryGB === null || input.availableMemoryGB === undefined)
    && (input.lowRamDevice === null || input.lowRamDevice === undefined)
    && input.benchmarkFrameMs === null;
}

export function resolveGraphicsDecision(input: CapabilityInput): GraphicsDecision {
  if (input.requestedTier) {
    return {
      tier: input.requestedTier,
      prompt: false,
      reason: 'user-selected',
      persistPromptSuppression: false,
    };
  }

  if (input.platform === 'harmonyos') {
    if (criticallyBelowHarmonyBaseline(input)) {
      return {
        tier: 'low',
        prompt: false,
        reason: 'harmony-critical-fallback',
        persistPromptSuppression: false,
      };
    }
    // Device information can be unavailable during the first native frame.
    // Prefer a safe launch over allocating the high profile blindly.
    if (harmonyCapabilityUnknown(input)) {
      return {
        tier: 'low',
        prompt: false,
        reason: 'harmony-unknown-safe-fallback',
        persistPromptSuppression: false,
      };
    }
    return {
      tier: 'high',
      prompt: false,
      reason: 'harmony-default-high',
      persistPromptSuppression: false,
    };
  }

  if (input.platform === 'android' && input.emulator === true) {
    return {
      tier: 'low',
      prompt: false,
      reason: 'android-emulator',
      persistPromptSuppression: false,
    };
  }

  if (input.platform === 'android' && androidRuntimeConstrained(input)) {
    return {
      tier: 'low',
      prompt: false,
      reason: 'android-runtime-constrained',
      persistPromptSuppression: false,
    };
  }

  if (input.platform === 'android' && belowAndroidBaseline(input)) {
    return {
      tier: 'low',
      prompt: input.promptPreference !== 'never',
      reason: 'android-below-baseline',
      persistPromptSuppression: input.promptPreference === 'never',
    };
  }

  // 折叠屏展开 / 三折叠 / 双屏：可视面积变大但 GPU 与内存并未变强，
  // 能力探针又拿不到数据时，别盲目按高档分配 60fps + 全特效。
  if (input.formFactor && expandedFormFactor(input.formFactor)
    && input.memoryGB === null
    && input.benchmarkFrameMs === null
    && (input.availableMemoryGB === null || input.availableMemoryGB === undefined)
    && input.lowRamDevice !== true) {
    return {
      tier: 'low',
      prompt: false,
      reason: 'expanded-form-factor-conservative',
      persistPromptSuppression: false,
    };
  }

  return {
    tier: 'high',
    prompt: false,
    reason: 'platform-default-high',
    persistPromptSuppression: false,
  };
}

export function shouldShowGraphicsPrompt(
  decision: GraphicsDecision,
  simulationState: GraphicsSimulationState,
): boolean {
  return decision.prompt && simulationState !== 'playing';
}

function trustedNativePlatform(platform: unknown): NativePlatformName | undefined {
  switch (platform) {
    case 'android':
    case 'ios':
    case 'macos':
    case 'harmonyos':
      return platform;
    default:
      return undefined;
  }
}

export function resolveRuntimePlatform(
  shellSignal: unknown,
  cocosSystem: CocosSystemSnapshot | undefined,
): NativePlatformName | undefined {
  const trustedShellPlatform = trustedNativePlatform(shellSignal);
  if (trustedShellPlatform) return trustedShellPlatform;
  if (!cocosSystem?.isNative || !cocosSystem.OS) return undefined;

  const { os, OS } = cocosSystem;
  if (os === OS.ANDROID) return 'android';
  if (os === OS.IOS) return 'ios';
  if (os === OS.OSX) return 'macos';
  if (os === OS.OHOS || os === OS.OPENHARMONY) return 'harmonyos';
  return undefined;
}
