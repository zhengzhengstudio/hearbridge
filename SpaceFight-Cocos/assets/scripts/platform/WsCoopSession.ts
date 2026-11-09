/**
 * Unified cooperative-session orchestrator over the WebSocket relay.
 *
 * Replaces `WebCoopSession` (which was WebRTC + QR, web-only). This version
 * works on every platform because it only needs a WebSocket: the host picks a
 * room code, the guest types it, and the relay (`/coop`) pairs them by code.
 * No QR, no SDP, no WebView — so Android / HarmonyOS / web / desktop all work
 * and inter-operate through one shared protocol (`CoopNetwork`).
 *
 * Lifecycle:
 *   host(room, name)  -> WS join(host)      -> onRoomCode(room) + onState('hosting')
 *   join(room, name)  -> WS join(guest)     -> onState('joining')
 *   relay coop:peer join (the other pilot)  -> onPeerJoin + onConnected + onState('connected')
 *   relay coop:peer leave                  -> onState('peer-left')
 *   relay coop:error room-host-exists       -> onState('error', ...)
 */

import {
  createCoopClientId,
  setActiveCoopTransport,
  type CoopMessage,
} from '../core/CoopNetwork';
import { WsCoopTransport } from './WsCoopTransport';

export interface CoopPeerInfo {
  readonly client: string;
  readonly name: string;
  readonly platform: string;
  readonly role: string;
}

export interface CoopSessionCallbacks {
  /** Host only: the room code the guest must type to join. */
  onRoomCode?(roomCode: string): void;
  /** A peer joined / left the room. */
  onPeerJoin?(peer: CoopPeerInfo): void;
  /** The relay confirmed both pilots are present — game sync may start. */
  onConnected(): void;
  onState(state: 'idle' | 'hosting' | 'joining' | 'connected' | 'peer-left' | 'error', detail?: string): void;
}

export class WsCoopSession {
  private transport: WsCoopTransport | null = null;
  private messageHandler: ((message: CoopMessage) => void) | null = null;
  private readonly callbacks: CoopSessionCallbacks;
  private readonly options: { endpoint?: string };
  private connected = false;
  private role: 'host' | 'guest' = 'host';
  private peers: CoopPeerInfo[] = [];

  public constructor(
    callbacks: CoopSessionCallbacks,
    options: { endpoint?: string } = {},
  ) {
    this.callbacks = callbacks;
    this.options = options;
  }

  /** WebSocket relay is available on every platform — no feature gate needed. */
  public static get available(): boolean {
    return true;
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Create a room others can join with `room`. */
  public host(room: string, name: string): void {
    this.teardown();
    this.role = 'host';
    this.connect(room.trim(), name.trim() || 'Host');
    this.callbacks.onRoomCode?.(room.trim());
    this.callbacks.onState('hosting');
  }

  /** Join an existing room by its code. */
  public join(room: string, name: string): void {
    this.teardown();
    this.role = 'guest';
    this.connect(room.trim(), name.trim() || 'Pilot');
    this.callbacks.onState('joining');
  }

  public send(message: CoopMessage): void {
    this.transport?.send(message);
  }

  public close(): void {
    this.teardown();
    // 断开连接后 HUD 必须回落到 idle，否则仍显示「房间已创建 / 联机已建立」。
    this.callbacks.onState('idle');
  }

  private connect(room: string, name: string): void {
    const transport = new WsCoopTransport({ endpoint: this.options.endpoint });
    transport.onMessage((message) => this.messageHandler?.(message));
    transport.onControl((message) => this.handleControl(message));
    transport.onClose(() => {
      // 断线期间不能继续显示「已连接」和静止的僚机；重连成功后服务端会
      // 重发 coop:joined，由 markConnected 再推回 connected。
      this.connected = false;
      this.peers = [];
      this.callbacks.onState('error', '联机中断，正在重连…');
    });
    transport.join({
      room,
      role: this.role,
      name,
      platform: WsCoopTransport.detectPlatform(),
      client: createCoopClientId(),
    });
    this.transport = transport;
    setActiveCoopTransport(transport);
  }

  private handleControl(message: unknown): void {
    const msg = message as { type?: string; detail?: string; event?: string; peers?: CoopPeerInfo[]; client?: string; name?: string; platform?: string; role?: string };
    if (msg.type === 'coop:joined') {
      this.peers = (msg.peers || []).filter((p) => p.client !== undefined) as CoopPeerInfo[];
      // 初次加入和断线重连都会收到 joined：对方角色与己方相反即视为配对成功，
      // 旧版只处理 guest，host 重连后永远回不到 connected。
      const opposite = this.role === 'host' ? 'guest' : 'host';
      if (this.peers.some((p) => p.role === opposite)) {
        this.markConnected();
      }
    } else if (msg.type === 'coop:peer') {
      if (msg.event === 'join') {
        const peer: CoopPeerInfo = { client: msg.client ?? '', name: msg.name ?? 'Pilot', platform: msg.platform ?? 'unknown', role: msg.role ?? 'guest' };
        this.peers = [...this.peers.filter((p) => p.client !== peer.client), peer];
        this.callbacks.onPeerJoin?.(peer);
        this.markConnected();
      } else if (msg.event === 'leave') {
        this.peers = this.peers.filter((p) => p.client !== msg.client);
        if (this.peers.length === 0) {
          this.connected = false;
          this.callbacks.onState('peer-left');
          // 房间已空，别让 transport 在后台无限自动重连。
          this.teardown();
        }
      }
    } else if (msg.type === 'coop:error') {
      const detail = msg.detail === 'room-host-exists'
        ? '房间已有主机，请换一个房间码'
        : '联机出错，请重试';
      this.callbacks.onState('error', detail);
    }
  }

  private markConnected(): void {
    if (this.connected) return;
    this.connected = true;
    this.callbacks.onConnected();
    this.callbacks.onState('connected');
  }

  private teardown(): void {
    this.connected = false;
    this.peers = [];
    this.transport?.close();
    this.transport = null;
    setActiveCoopTransport(null);
  }
}
