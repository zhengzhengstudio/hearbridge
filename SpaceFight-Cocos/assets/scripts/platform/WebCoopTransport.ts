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
}

export interface WebCoopOptions {
  /** Optional STUN servers for NAT traversal; empty array means LAN-only. */
  iceServers?: ReadonlyArray<{ urls: string }>;
}

const RTC = () => (globalThis as {
  RTCPeerConnection?: typeof RTCPeerConnection;
}).RTCPeerConnection;

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

  public constructor(
    callbacks: WebCoopCallbacks,
    options: WebCoopOptions = {},
  ) {
    this.callbacks = callbacks;
    this.options = options;
  }

  public async createOffer(): Promise<string> {
    const Peer = RTC();
    if (!Peer) throw new Error('WebRTC is not available on this device.');
    const connection = new Peer({
      iceServers: (this.options.iceServers || []).map((server) => ({ urls: server.urls })),
    });
    this.connection = connection;
    const channel = connection.createDataChannel('coop');
    this.bindChannel(channel);
    this.channel = channel;
    connection.ondatachannel = (event) => this.bindChannel(event.channel);

    connection.onicecandidate = (event) => {
      if (event.candidate) return;
      if (this.messageHandler && connection.remoteDescription) {
        // Full ICE gathering (trickle unsupported is fine for 1v1 on LAN/same-host).
        const local = connection.localDescription;
        if (local) this.callbacks.onSignalOffer(JSON.stringify(local));
      }
    };

    // 数据通道由 createDataChannel 单独建，offer 不需要音视频接收选项。
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    return JSON.stringify(connection.localDescription);
  }

  public async acceptAnswer(serialized: string): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new Error('No host connection to accept an answer on.');
    const answer = JSON.parse(serialized) as RTCSessionDescriptionInit;
    await connection.setRemoteDescription(answer);
  }

  public send(message: CoopMessage): void {
    this.channel?.send(JSON.stringify(message));
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  public close(): void {
    this.channel?.close();
    this.connection?.close();
    this.channel = null;
    this.connection = null;
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.callbacks.onConnected();
      // Host announces readiness so the guest knows when to start streaming.
      const ready: CoopMessage = { t: 'signal', kind: 'ready', client: '' };
      channel.send(JSON.stringify(ready));
    };
    channel.onmessage = (event) => {
      const message = parseCoopMessage(JSON.parse(String(event.data)));
      if (message && this.messageHandler) this.messageHandler(message);
    };
    channel.onclose = () => this.callbacks.onDisconnected();
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

  public constructor(
    callbacks: WebCoopCallbacks,
    options: WebCoopOptions = {},
  ) {
    this.callbacks = callbacks;
    this.options = options;
  }

  public async acceptOffer(serialized: string): Promise<string> {
    const Peer = RTC();
    if (!Peer) throw new Error('WebRTC is not available on this device.');
    const offer = JSON.parse(serialized) as RTCSessionDescriptionInit;
    const connection = new Peer({
      iceServers: (this.options.iceServers || []).map((server) => ({ urls: server.urls })),
    });
    this.connection = connection;
    connection.ondatachannel = (event) => {
      this.channel = event.channel;
      this.bindChannel(event.channel);
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) return;
      const local = connection.localDescription;
      if (local) this.callbacks.onSignalOffer(JSON.stringify(local));
    };
    await connection.setRemoteDescription(offer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    return JSON.stringify(connection.localDescription);
  }

  public send(message: CoopMessage): void {
    this.channel?.send(JSON.stringify(message));
  }

  public onMessage(handler: (message: CoopMessage) => void): void {
    this.messageHandler = handler;
  }

  public close(): void {
    this.channel?.close();
    this.connection?.close();
    this.channel = null;
    this.connection = null;
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.onopen = () => this.callbacks.onConnected();
    channel.onmessage = (event) => {
      const message = parseCoopMessage(JSON.parse(String(event.data)));
      if (message && this.messageHandler) this.messageHandler(message);
    };
    channel.onclose = () => this.callbacks.onDisconnected();
  }
}