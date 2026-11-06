import {
  shouldShowGraphicsPrompt,
  type GraphicsDecision,
  type GraphicsSimulationState,
} from './CapabilityPolicy';
import type { GraphicsTier } from './GraphicsProfile';

export const GRAPHICS_ADVICE_ACTIONS = [
  { id: 'switch-now', label: '立即切换' },
  { id: 'not-now', label: '暂时不' },
  { id: 'never', label: '不再提示' },
] as const;

export type GraphicsAdviceAction = typeof GRAPHICS_ADVICE_ACTIONS[number]['id'];

export interface GraphicsAdviceRequest {
  readonly decision: GraphicsDecision;
  readonly actions: typeof GRAPHICS_ADVICE_ACTIONS;
}

export interface GraphicsAdviceHandlers {
  readonly simulationState: () => GraphicsSimulationState;
  readonly applyTier: (tier: GraphicsTier) => void;
  readonly persistNever: () => Promise<void>;
}

export type GraphicsAdviceListener = (request: GraphicsAdviceRequest) => void;

export interface GraphicsAdviceChannel {
  subscribe(listener: GraphicsAdviceListener): () => void;
  current(): GraphicsAdviceRequest | null;
  publish(decision: GraphicsDecision, handlers: GraphicsAdviceHandlers): boolean;
  perform(action: GraphicsAdviceAction): Promise<boolean>;
  setPromptSuppressed(suppressed: boolean): void;
  isPromptSuppressed(): boolean;
  clear(): void;
}

export function createGraphicsAdviceChannel(): GraphicsAdviceChannel {
  const listeners = new Set<GraphicsAdviceListener>();
  let active: { request: GraphicsAdviceRequest; handlers: GraphicsAdviceHandlers } | null = null;
  let promptSuppressed = false;

  return {
    subscribe(listener): () => void {
      listeners.add(listener);
      if (active) listener(active.request);
      return () => listeners.delete(listener);
    },

    current(): GraphicsAdviceRequest | null {
      return active?.request || null;
    },

    publish(decision, handlers): boolean {
      if (promptSuppressed || !shouldShowGraphicsPrompt(decision, handlers.simulationState())) {
        active = null;
        return false;
      }
      const request: GraphicsAdviceRequest = {
        decision,
        actions: GRAPHICS_ADVICE_ACTIONS,
      };
      active = { request, handlers };
      for (const listener of listeners) listener(request);
      return true;
    },

    async perform(action): Promise<boolean> {
      const pending = active;
      if (!pending || pending.handlers.simulationState() === 'playing') {
        active = null;
        return false;
      }
      if (action === 'switch-now') {
        pending.handlers.applyTier('low');
      } else if (action === 'never') {
        await pending.handlers.persistNever();
        promptSuppressed = true;
      }
      if (active === pending) active = null;
      return true;
    },

    setPromptSuppressed(suppressed): void {
      promptSuppressed = suppressed;
      if (suppressed) active = null;
    },

    isPromptSuppressed(): boolean {
      return promptSuppressed;
    },

    clear(): void {
      active = null;
    },
  };
}

export const graphicsAdviceChannel = createGraphicsAdviceChannel();

export function subscribeGraphicsAdvice(listener: GraphicsAdviceListener): () => void {
  return graphicsAdviceChannel.subscribe(listener);
}

export function currentGraphicsAdvice(): GraphicsAdviceRequest | null {
  return graphicsAdviceChannel.current();
}

export function performGraphicsAdviceAction(action: GraphicsAdviceAction): Promise<boolean> {
  return graphicsAdviceChannel.perform(action);
}
