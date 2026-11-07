/**
 * Web cooperative-multiplayer transport.
 *
 * A WebRTC (RTCPeerConnection) transport that implements the shared
 * `CoopTransport` contract from `../core/CoopNetwork`. Signaling is exchanged
 * as hand-rolled JSON offers/answers that players paste between each other —
 * this needs no sign-up, account, or relay server, so it runs on any static
 * web deployment. The transport is deliberately split from `CoopNetwork` so
 * the protocol layer stays reusable by native apps that can supply their own
 * `CoopTransport`.
 *
 * Web-only: guarded with `globalThis` feature detection so importing the file
 * on desktop/mobile (where RTCPeerConnection does not exist) is harmless.
 */

import {
  parseCoopMessage,
  type CoopMessage,
  type CoopTransport,
} from '../core/CoopNetwork';

export interface WebCoopCallbacks {
  onSignalOffer(payload: string): void;
  onConnected(): void;
  onDisconnected(): void;
  /** 可选：连接失败 / 超时 / 异常时上报明确原因；旧调用方省略也兼容。 */
  onError?(reason: string): void;
}

export interface WebCoopOptions {
  /** Optional STUN servers for NAT traversal; empty array means LAN-only. */
  iceServers?: ReadonlyArray<{ urls: string }>;
}

const RTC = () => (globalThis as {
  RTCPeerConnection?: typeof RTCPeerConnection;
}).RTCPeerConnection;

/** 15s 内没有建立数据通道即视为连接失败。 */
const CONNECTION_TIMEOUT_MS = 15000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function webRtcAvailable(): boolean {
  return typeof RTC() === 'function';
}

/**
 * Host (initiator): creates an offer and exposes it through onSignalOffer.
 * Pass the answer from the guest via `acceptAnswer`.
 */
export class WebCoopHost implements CoopTransport {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private readonly callbacks: WebCoopCallbacks;
  private readonly options: WebCoopOptions;
  private messageHandler: ((message: CoopMessage) => void) | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private failed = false;

  public constructor(
    callbacks: WebCoopCallbacks,
    options: WebCoopOptions = {},
  ) {
    this.callbacks = callbacks;
    this.options = options;
  }

  public async createOffer(): Promise<string> {
    try {
      const Peer = RTC();
      if (!Peer) throw new Error('WebRTC is not available on this device.');
      const connection = new Peer({
        iceServers: (this.options.iceServers || []).map((server) => ({ urls: server.urls })),
      });
      this.connection = connection;
      this.closed = false;
      this.failed = false;
      const channel = connection.createDataChannel('coop');
      this.bindChannel(channel);
      this.channel = channel;
      connection.ondatachannel = (event) => this.bindChannel(event.channel);

      // 修复：ICE gathering 完成即回调 onSignalOffer，不再要求 messageHandler /
      // remoteDescription（主机此时还没有 remoteDescription，旧条件导致永远不发邀请码）。
      connection.onicecandidate = (event) => {
        if (event.candidate) return;
        // Full ICE gathering (trickle unsupported is fine for 1v1 on LAN/same-host).
        const local = connection.localDescription;
        if (local) this.callbacks.onSignalOffer(JSON.stringify(local));
      };

      // 修复：监听 ICE / 连接状态并加连接超时，失败时上报 error 并清理。
      this.watchConnection(connection);
      this.startConnectionTimeout();

      // 数据通道由 createDataChannel 单独建，offer 不需要音视频接收选项。
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      return JSON.stringify(connection.localDescription);
    } catch (error) {
      this.fail(`Failed to create offer: ${describeError(error)}`);
      throw error;
    }
  }

  public async acceptAnswer(serialized: string): Promise<void> {
    try {
      const connection = this.connection;
      if (!connection) throw new Error('No host connection to accept an answer on.');
      const answer = JSON.parse(serialized) as RTCSessionDescriptionInit;
      await connection.setRemoteDescription(answer);
    } catch (error) {
      this.fail(`Failed to accept answer: ${describeError(error)}`);
      throw error;
    }
  }

  public send(message: CoopMessage): void {
    this.channel?.send(JSON.stringify(message));
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearConnectionTimeout();
    try {
      this.channel?.close();
      this.connection?.close();
    } catch (_) {
      // 关闭已失效的连接可能抛错，忽略即可。
    }
    this.channel = null;
    this.connection = null;
  }

  private startConnectionTimeout(): void {
    this.clearConnectionTimeout();
    this.connectionTimer = setTimeout(() => {
      this.fail(`Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s.`);
    }, CONNECTION_TIMEOUT_MS);
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimer !== null) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private watchConnection(connection: RTCPeerConnection): void {
    const checkState = (state: string): void => {
      if (this.closed || this.failed) return;
      // failed / disconnected 都视为连接失败：回调 error 并清理。
      if (state === 'failed' || state === 'disconnected') {
        this.fail(`Connection ${state}.`);
      }
    };
    connection.oniceconnectionstatechange = () => checkState(String(connection.iceConnectionState));
    connection.onconnectionstatechange = () => checkState(String(connection.connectionState));
  }

  private fail(reason: string): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.clearConnectionTimeout();
    this.callbacks.onError?.(reason);
    this.close();
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.clearConnectionTimeout();
      this.callbacks.onConnected();
      // Host announces readiness so the guest knows when to start streaming.
      const ready: CoopMessage = { t: 'signal', kind: 'ready', client: '' };
      channel.send(JSON.stringify(ready));
    };
    channel.onmessage = (event) => {
      const message = parseCoopMessage(JSON.parse(String(event.data)));
      if (message && this.messageHandler) this.messageHandler(message);
    };
    channel.onclose = () => {
      // 已上报失败的断开不再回调 idle，避免状态抖动。
      if (!this.failed) this.callbacks.onDisconnected();
    };
  }
}

/**
 * Guest (answerer): consumes the host offer, produces an answer, exposes it
 * through onSignalOffer for the host to paste back.
 */
export class WebCoopGuest implements CoopTransport {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private readonly callbacks: WebCoopCallbacks;
  private readonly options: WebCoopOptions;
  private messageHandler: ((message: CoopMessage) => void) | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private failed = false;

  public constructor(
    callbacks: WebCoopCallbacks,
    options: WebCoopOptions = {},
  ) {
    this.callbacks = callbacks;
    this.options = options;
  }

  public async acceptOffer(serialized: string): Promise<string> {
    try {
      const Peer = RTC();
      if (!Peer) throw new Error('WebRTC is not available on this device.');
      const offer = JSON.parse(serialized) as RTCSessionDescriptionInit;
      const connection = new Peer({
        iceServers: (this.options.iceServers || []).map((server) => ({ urls: server.urls })),
      });
      this.connection = connection;
      this.closed = false;
      this.failed = false;
      connection.ondatachannel = (event) => {
        this.channel = event.channel;
        this.bindChannel(event.channel);
      };
      connection.onicecandidate = (event) => {
        if (event.candidate) return;
        const local = connection.localDescription;
        if (local) this.callbacks.onSignalOffer(JSON.stringify(local));
      };
      // 修复：坏 offer / 连接失败时统一上报 error 并清理。
      this.watchConnection(connection);
      this.startConnectionTimeout();
      await connection.setRemoteDescription(offer);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      return JSON.stringify(connection.localDescription);
    } catch (error) {
      this.fail(`Failed to accept offer: ${describeError(error)}`);
      throw error;
    }
  }

  public send(message: CoopMessage): void {
    this.channel?.send(JSON.stringify(message));
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearConnectionTimeout();
    try {
      this.channel?.close();
      this.connection?.close();
    } catch (_) {
      // 关闭已失效的连接可能抛错，忽略即可。
    }
    this.channel = null;
    this.connection = null;
  }

  private startConnectionTimeout(): void {
    this.clearConnectionTimeout();
    this.connectionTimer = setTimeout(() => {
      this.fail(`Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s.`);
    }, CONNECTION_TIMEOUT_MS);
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimer !== null) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private watchConnection(connection: RTCPeerConnection): void {
    const checkState = (state: string): void => {
      if (this.closed || this.failed) return;
      // failed / disconnected 都视为连接失败：回调 error 并清理。
      if (state === 'failed' || state === 'disconnected') {
        this.fail(`Connection ${state}.`);
      }
    };
    connection.oniceconnectionstatechange = () => checkState(String(connection.iceConnectionState));
    connection.onconnectionstatechange = () => checkState(String(connection.connectionState));
  }

  private fail(reason: string): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.clearConnectionTimeout();
    this.callbacks.onError?.(reason);
    this.close();
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.clearConnectionTimeout();
      this.callbacks.onConnected();
    };
    channel.onmessage = (event) => {
      const message = parseCoopMessage(JSON.parse(String(event.data)));
      if (message && this.messageHandler) this.messageHandler(message);
    };
    channel.onclose = () => {
      // 已上报失败的断开不再回调 idle，避免状态抖动。
      if (!this.failed) this.callbacks.onDisconnected();
    };
  }
}
