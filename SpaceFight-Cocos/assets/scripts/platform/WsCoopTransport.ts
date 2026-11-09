/**
 * Unified WebSocket cooperative-multiplayer transport.
 *
 * Replaces the old WebRTC transport so every platform — Android / HarmonyOS /
 * web / mac / windows — shares one transport and one relay. No WebView, no
 * RTCPeerConnection, no QR handshake: clients open a plain WebSocket to the
 * relay endpoint and identify themselves with a room code + role. The relay
 * (server.js `/coop`) fans CoopMessage frames out to every other peer in the
 * same room.
 *
 * The relay only ever forwards opaque `coop:msg` payloads; the structured
 * `CoopMessage` protocol lives in `../core/CoopNetwork` and is unchanged.
 *
 * Platform detection is done through `globalThis.sys` (Cocos injects it) so
 * this file stays free of `cc`/`DOM` imports and compiles on every target.
 */

import { type CoopMessage, type CoopTransport } from '../core/CoopNetwork';

export interface WsCoopJoinInfo {
  readonly room: string;
  readonly role: 'host' | 'guest';
  readonly name: string;
  readonly platform: string;
  readonly client: string;
}

export interface WsCoopOptions {
  /** Override the relay endpoint (defaults to same-origin on web, prod domain on native). */
  readonly endpoint?: string;
  /** Reconnect delay after an unexpected drop (ms). */
  readonly reconnectDelayMs?: number;
}

/** Resolves the relay URL. Web reuses its own origin; native targets a fixed prod domain. */
function defaultCoopWsUrl(): string {
  const w = (globalThis as { window?: { location?: { protocol: string; host: string } } }).window;
  if (w && w.location) {
    const proto = w.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${w.location.host}/coop`;
  }
  return 'wss://zhengzhengstudio.cn/coop';
}

function platformLabel(): string {
  const sys = (globalThis as { sys?: { isNative?: boolean; os?: string } }).sys;
  if (sys && sys.isNative) return String(sys.os || 'native').toLowerCase();
  return 'web';
}

function getWebSocket(): any {
  const WS = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof WS === 'function' ? WS : null;
}

export class WsCoopTransport implements CoopTransport {
  private ws: any = null;
  private messageHandler: ((message: CoopMessage) => void) | null = null;
  private controlHandler: ((message: unknown) => void) | null = null;
  private readonly endpoint: string;
  private readonly reconnectDelayMs: number;
  private joinInfo: WsCoopJoinInfo | null = null;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openHandlers: Array<() => void> = [];

  public constructor(options: WsCoopOptions = {}) {
    this.endpoint = options.endpoint || defaultCoopWsUrl();
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
  }

  public static detectPlatform(): string {
    return platformLabel();
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Receives server control frames (coop:hello / joined / peer / error), not game payloads. */
  public onControl(handler: (message: unknown) => void): void {
    this.controlHandler = handler;
  }

  public onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  public join(info: WsCoopJoinInfo): void {
    this.joinInfo = info;
    this.closedByUser = false;
    this.connect();
  }

  public send(message: CoopMessage): void {
    if (this.ws && this.ws.readyState === 1 && this.joinInfo) {
      this.ws.send(JSON.stringify({ type: 'coop:msg', room: this.joinInfo.room, payload: message }));
    }
  }

  public close(): void {
    this.closedByUser = true;
    this.clearReconnect();
    if (this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: 'coop:leave', room: this.joinInfo?.room }));
      } catch {
        /* socket may already be gone */
      }
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.joinInfo) return;
    const WS = getWebSocket();
    if (!WS) {
      this.scheduleReconnect();
      return;
    }
    let socket: any;
    try {
      socket = new WS(this.endpoint);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.clearReconnect();
      const info = this.joinInfo;
      if (info) {
        socket.send(JSON.stringify({
          type: 'coop:join',
          room: info.room,
          role: info.role,
          name: info.name,
          platform: info.platform,
          client: info.client,
        }));
      }
      for (const handler of this.openHandlers) handler();
    };
    socket.onmessage = (event: { data: unknown }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const msg = parsed as { type?: string; payload?: CoopMessage };
      if (msg.type === 'coop:msg') {
        if (msg.payload) this.messageHandler?.(msg.payload);
      } else {
        this.controlHandler?.(parsed);
      }
    };
    socket.onclose = () => {
      this.ws = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
