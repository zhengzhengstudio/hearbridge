/**
 * Shared cooperative-multiplayer protocol.
 *
 * Pure TypeScript and free of any `cc`, DOM, or platform imports so the same
 * code serves the web build and every native app. The layer below it only has
 * to provide a `CoopTransport` that can send small JSON messages and deliver
 * inbound ones to `onMessage`.
 *
 * Model: one authoritative host owns a session and streams compact per-player
 * "presence" frames (position, attitude, health, current intent) a few times a
 * second. Guests apply the host snapshot and render the joined pilot as a
 * friendly ship. The simulation itself stays local — this is snapshot sync,
 * not lockstep.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Role in a session. Host owns the world; guest joins into it. */
export type CoopPeerRole = 'host' | 'guest';

export interface CoopPeerIdentity {
  readonly clientId: string;
  readonly displayName: string;
  readonly platform: string;
  readonly role: CoopPeerRole;
}

export interface CoopHandshake {
  readonly v: 1;
  readonly host: string;
  readonly room: string;
  readonly client: string;
  readonly name: string;
  readonly platform: string;
  readonly role: CoopPeerRole;
}

export interface CoopPresence {
  readonly t: 'presence';
  readonly seq: number;
  readonly elapsed: number;
  readonly health: number;
  readonly shield: number;
  readonly energy: number;
  readonly score: number;
  readonly position: Vec3Like;
  readonly velocity: Vec3Like;
  readonly forward: Vec3Like;
  readonly firing: boolean;
  readonly boosting: boolean;
}

export interface CoopSignal {
  readonly t: 'signal';
  readonly kind: 'join' | 'leave' | 'ready';
  readonly client: string;
  readonly name?: string;
}

export type CoopMessage =
  | CoopHandshake
  | CoopPresence
  | CoopSignal;

/** Resolver invoked when a guest attempts to enter a room. */
export type CoopAdmit = (guest: CoopPeerIdentity, room: string) => boolean;

export interface CoopTransport {
  send(message: CoopMessage): void;
  close(): void;
  onMessage(handler: (message: CoopMessage) => void): void;
}

export interface CoopSessionSnapshot {
  readonly host: string;
  readonly room: string;
  readonly role: CoopPeerRole;
  readonly connected: boolean;
  readonly peers: readonly CoopPeerIdentity[];
  readonly latencyMs: number | null;
}

/** A short, alphabet-only id that is URL friendly. */
export function createCoopClientId(): string {
  const pool = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const chars: string[] = [];
  const source =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? crypto.getRandomValues(new Uint8Array(12))
      : Array.from({ length: 12 }, () => (Math.random() * 256) | 0);
  for (const byte of Array.from(source as Iterable<number>)) {
    chars.push(pool[byte % pool.length]);
  }
  return `p${chars.join('').slice(0, 15)}`;
}

export function normalizeName(raw: string | undefined): string {
  const trimmed = (raw || '').trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : 'Pilot';
}

export function createCoopHandshake(
  room: string,
  identity: CoopPeerIdentity,
): CoopHandshake {
  return {
    v: 1,
    host: identity.role === 'host' ? identity.clientId : room,
    room,
    client: identity.clientId,
    name: identity.displayName,
    platform: identity.platform,
    role: identity.role,
  };
}

/** Validates an inbound message; returns null when the frame is corrupt. */
export function parseCoopMessage(raw: unknown): CoopMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as Record<string, unknown>;
  if (message.v === 1 && typeof message.host === 'string' && typeof message.room === 'string') {
    const handshake = message as unknown as CoopHandshake;
    if (typeof handshake.client !== 'string' || typeof handshake.name !== 'string') return null;
    if (handshake.role !== 'host' && handshake.role !== 'guest') return null;
    return handshake;
  }
  if (message.t === 'presence') {
    const presence = message as unknown as CoopPresence;
    if (typeof presence.seq !== 'number' || !presence.position) return null;
    return presence;
  }
  if (message.t === 'signal') {
    const signal = message as unknown as CoopSignal;
    if (signal.kind === 'join' || signal.kind === 'leave' || signal.kind === 'ready') {
      if (typeof signal.client !== 'string') return null;
      return signal;
    }
  }
  return null;
}

/**
 * A small deterministic buffer that keeps a rolling window of the most recent
 * valid presence frames, in order, and hands back the latest coherent state.
 * Used by the renderer so late/duplicate/out-of-order frames never desync the
 * local simulation.
 */
export class CoopPresenceBuffer {
  private readonly frames = new Map<number, CoopPresence>();
  private readonly order: number[] = [];
  private lastAppliedSeq = -1;

  public constructor(
    private readonly maxWindow = 64,
    private readonly localElapsedScore = 0,
  ) {}

  public push(frame: CoopPresence): void {
    if (typeof frame.seq !== 'number' || Number.isNaN(frame.seq)) return;
    const had = this.frames.has(frame.seq);
    this.frames.set(frame.seq, frame);
    if (!had) this.order.push(frame.seq);
    while (this.order.length > this.maxWindow) {
      const dropped = this.order.shift();
      if (dropped !== undefined) this.frames.delete(dropped);
    }
    this.lastAppliedSeq = Math.max(this.lastAppliedSeq, frame.seq);
  }

  public latest(): CoopPresence | null {
    if (this.order.length === 0) return null;
    return this.frames.get(this.order[this.order.length - 1]) || null;
  }

  public clear(): void {
    this.frames.clear();
    this.order.length = 0;
    this.lastAppliedSeq = -1;
  }

  public get appliedSeq(): number {
    return this.lastAppliedSeq;
  }
}

let transport: CoopTransport | null = null;

export function activeCoopTransport(): CoopTransport | null {
  return transport;
}

export function setActiveCoopTransport(next: CoopTransport | null): void {
  transport = next;
}