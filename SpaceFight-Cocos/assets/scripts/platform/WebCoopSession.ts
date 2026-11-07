/**
 * Web cooperative-session orchestrator.
 *
 * Wraps the WebRTC transports from `WebCoopTransport` with a QR-friendly
 * handshake so two devices can pair without typing long SDP blobs. Signaling
 * is compressed into compact "invite" payloads that fit in a QR code:
 *
 *   Host   -> creates a room, packs   INVITE(offer)  ->  shows QR-A
 *   Guest  -> scans QR-A, answers, packs ANSWER        ->  shows QR-B
 *   Host   -> scans QR-B, accepts                       ->  channel opens
 *
 * The Cocos scene only deals with orchestration; camera capture and QR
 * rendering are owned by the surrounding web shell, which talks to this
 * module through DOM events (`spacefight:coop-*`). Pure web: any file that is
 * worried about being imported on native can rely on this staying guarded.
 */

import {
  setActiveCoopTransport,
  type CoopMessage,
} from '../core/CoopNetwork';
import {
  webRtcAvailable,
  WebCoopGuest,
  WebCoopHost,
  type WebCoopOptions,
} from './WebCoopTransport';

/** Host-ready invite (contains the compressed SDP offer + room metadata). */
export interface CoopInvite {
  readonly v: 1;
  readonly id: 'sf/coop';
  readonly room: string;
  readonly name: string;
  readonly offer: string;
}

/** Serialized invite payload — the string placed into a QR code. */
export type CoopInviteString = string;

export interface CoopSessionCallbacks {
  onInvite(invite: CoopInviteString): void;
  onAnswer(answer: CoopInviteString): void;
  onConnected(): void;
  onState(state: 'idle' | 'hosting' | 'joining' | 'connected' | 'error', detail?: string): void;
}

/** Base64-url encoding (no padding) so SDP fits comfortably in a QR. */
function encode(bytes: string): string {
  if (typeof btoa !== 'function') return encodeURIComponent(bytes);
  return btoa(unescape(encodeURIComponent(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decode(token: string): string {
  if (typeof atob !== 'function') return decodeURIComponent(token);
  const padded = token.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(padded)));
}

/**
 * 修复：encode() 产出的是 base64url（[A-Za-z0-9_-]，不含点），不能再靠点号判合法。
 * 校验字符集 + 解码后 JSON 的 type 字段，坏二维码一律返回 null。
 */
function decodeSignalPayload(offer: string): { sdp: string; type: string } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(offer)) return null;
  try {
    const sdp = decode(offer);
    const parsed = JSON.parse(sdp) as { type?: unknown };
    if (typeof parsed.type !== 'string') return null;
    return { sdp, type: parsed.type };
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates an invite string. Returns the parsed invite when well-formed,
 * otherwise null. Used both by the host (to verify a pasted/scan answer) and
 * the guest (to verify the scanned host invite).
 */
export function parseCoopInvite(raw: string): CoopInvite | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CoopInvite>;
    if (
      parsed.v !== 1
      || parsed.id !== 'sf/coop'
      || typeof parsed.room !== 'string'
      || typeof parsed.name !== 'string'
      || typeof parsed.offer !== 'string'
      || !parsed.room
      || !parsed.offer
    ) {
      return null;
    }
    return parsed as CoopInvite;
  } catch {
    return null;
  }
}

/**
 * 注意：字段名不能叫 `host`—— 同名方法 `host()` 会覆盖字段，
 * 导致 `acceptAnswer()` 里`this.host` 恒为 undefined，主机流程永远走不通。
 */
export class WebCoopSession {
  private hostPeer: WebCoopHost | null = null;
  private guest: WebCoopGuest | null = null;
  private messageHandler: ((message: CoopMessage) => void) | null = null;
  private readonly options: WebCoopOptions;
  private errorReported = false;

  public constructor(
    private readonly callbacks: CoopSessionCallbacks,
    options: WebCoopOptions = {},
  ) {
    this.options = options;
  }

  /** True when this browser can participate in a WebRTC session. */
  public static get available(): boolean {
    return webRtcAvailable();
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Create a host room and emit an offer that can be QR-encoded. */
  public async host(room: string, name: string): Promise<void> {
    this.errorReported = false;
    if (!webRtcAvailable()) {
      this.fail('WebRTC unsupported');
      return;
    }
    this.teardown();
    // 修复：全程 try/catch，坏输入/连接异常统一转 error 并清理。
    try {
      const host = new WebCoopHost({
        onSignalOffer: (offerSdp) => {
          const invite: CoopInvite = {
            v: 1,
            id: 'sf/coop',
            room,
            name: name.trim() || room,
            offer: encode(offerSdp),
          };
          this.callbacks.onInvite(JSON.stringify(invite));
          this.callbacks.onState('hosting');
        },
        onConnected: () => {
          this.callbacks.onConnected();
          this.callbacks.onState('connected');
        },
        onDisconnected: () => this.callbacks.onState('idle'),
        onError: (reason) => this.fail(reason),
      }, { iceServers: (this.options.iceServers || []).length ? this.options.iceServers : undefined });
      if (this.messageHandler) host.onMessage(this.messageHandler);
      this.hostPeer = host;
      setActiveCoopTransport(host);
      await host.createOffer();
    } catch (error) {
      this.fail(`Host failed: ${describeError(error)}`);
    }
  }

  /**
   * Let the host consume a guest answer (from the scanned QR-B). Safe to
   * call when already hosting; is a no-op otherwise (so a stray paste cannot
   * corrupt a running session).
   */
  public async acceptAnswer(invite: CoopInviteString): Promise<boolean> {
    this.errorReported = false;
    if (!this.hostPeer) {
      this.fail('No active host session to accept an answer on.');
      return false;
    }
    const parsed = parseCoopInvite(invite);
    // 修复：校验 base64url + 解码后 type==='answer'，不再依赖点号判非法。
    const signal = parsed ? decodeSignalPayload(parsed.offer) : null;
    if (!parsed || !signal || signal.type !== 'answer') {
      this.fail('Invalid answer payload.');
      return false;
    }
    // 修复：try/catch 兜住解码/SDP 异常，失败时 teardown + error。
    try {
      await this.hostPeer.acceptAnswer(signal.sdp);
      return true;
    } catch (error) {
      this.fail(`Failed to accept answer: ${describeError(error)}`);
      return false;
    }
  }

  /** Join a host by scanning QR-A. Emits the answer (QR-B) when ready. */
  public async join(invite: CoopInviteString): Promise<void> {
    this.errorReported = false;
    if (!webRtcAvailable()) {
      this.fail('WebRTC unsupported');
      return;
    }
    const parsed = parseCoopInvite(invite);
    if (!parsed) {
      this.fail('Unrecognized invite.');
      return;
    }
    // 修复：校验 base64url + 解码后 type==='offer'，不再依赖点号判非法。
    const signal = decodeSignalPayload(parsed.offer);
    if (!signal || signal.type !== 'offer') {
      this.fail('Invalid offer payload.');
      return;
    }
    this.teardown();
    // 修复：全程 try/catch，坏二维码不会留下未捕获 Promise rejection。
    try {
      const guest = new WebCoopGuest({
        onSignalOffer: (answerSdp) => {
          const answer: CoopInvite = {
            v: 1,
            id: 'sf/coop',
            room: parsed.room,
            name: parsed.name,
            offer: encode(answerSdp),
          };
          this.callbacks.onAnswer(JSON.stringify(answer));
          this.callbacks.onState('joining');
        },
        onConnected: () => {
          this.callbacks.onConnected();
          this.callbacks.onState('connected');
        },
        onDisconnected: () => this.callbacks.onState('idle'),
        onError: (reason) => this.fail(reason),
      }, { iceServers: (this.options.iceServers || []).length ? this.options.iceServers : undefined });
      if (this.messageHandler) guest.onMessage(this.messageHandler);
      this.guest = guest;
      setActiveCoopTransport(guest);
      await guest.acceptOffer(signal.sdp);
    } catch (error) {
      this.fail(`Join failed: ${describeError(error)}`);
    }
  }

  public close(): void {
    this.teardown();
  }

  /** 修复：统一失败处理——清理会话并上报明确原因，避免重复回调 error。 */
  private fail(reason: string): void {
    if (this.errorReported) return;
    this.errorReported = true;
    this.teardown();
    this.callbacks.onState('error', reason);
  }

  private teardown(): void {
    this.hostPeer?.close();
    this.guest?.close();
    this.hostPeer = null;
    this.guest = null;
    setActiveCoopTransport(null);
  }
}
