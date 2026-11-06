export type EnemyRole = 'interceptor' | 'suppressor' | 'bomber' | 'support' | 'elite';
export type EnemyIntentMode = 'close' | 'flank' | 'hold' | 'retreat' | 'support';

export interface BehaviorVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EnemyBehaviorState {
  readonly id: string;
  readonly role?: EnemyRole;
  readonly kind?: EnemyRole;
  readonly position: BehaviorVector3;
  readonly telegraphElapsed?: number;
  readonly attackReady?: boolean;
}

export interface EnemyBehaviorTarget {
  readonly position: BehaviorVector3;
  readonly velocity?: BehaviorVector3;
}

export interface EnemyBehaviorContext {
  readonly threat?: number;
  readonly allies?: readonly EnemyBehaviorState[];
  readonly lineOfSight?: boolean;
  /** 当前波次，用于难度递进（>= startWave 起生效）。不给则按第1 波（无加成） */
  readonly wave?: number;
}

export interface EnemyIntent {
  readonly role: EnemyRole;
  readonly mode: EnemyIntentMode;
  readonly desiredVelocity: BehaviorVector3;
  readonly desiredRange: readonly [number, number];
  readonly telegraphSeconds: number;
  readonly canFire: boolean;
  readonly flankSide: -1 | 1;
}

interface RoleTuning {
  readonly minimumRange: number;
  readonly maximumRange: number;
  readonly speed: number;
  readonly telegraphSeconds: number;
  readonly preferredMode: EnemyIntentMode;
}

/** 同队机之间的最小间距，防止挤成一坨 */
const MINIMUM_SEPARATION = 12;

/**
 * 敌机难度递进。
 *
 * 之前波次只加血（CombatSimulation 里 `+6/波`）和分值，
 * `ROLE_TUNING` 的速度与预警时间恒定 → 「波次变多但没变难」，
 * 玩家感觉只是在拖时间。
 * 现在速度随波次递增、预警时间随波次压缩，第 3 波起开始有压迫感，
 * 10 波时预警只剩约 3/4，给玩家真实的「打起来了」感受。
 */
export const ENEMY_DIFFICULTY_RAMP = {
  /** 从第几波开始生效（前面几波让玩家熟悉操作） */
  startWave: 3,
  /** 每波速度增幅（线性）。10 波时约 +70%，20 波约 +140%，有明显的「越来越快」体感 */
  speedPerWave: 0.07,
  /** 每波预警时间压缩比例（线性）。10 波约 -67%，20 波触底 */
  telegraphCompressionPerWave: 0.075,
  /** 预警时间压缩下限（防止高波次变成无预警秒杀） */
  minimumTelegraphScale: 0.45,
} as const;

/**
 * 按波次算强度系数。
 * @param wave 当前波次（1 起）
 */
export function enemyRampForWave(wave: number): { speed: number; telegraphScale: number } {
  const w = Number.isFinite(wave) ? wave : 1;
  if (w <= ENEMY_DIFFICULTY_RAMP.startWave) return { speed: 1, telegraphScale: 1 };
  const steps = w - ENEMY_DIFFICULTY_RAMP.startWave;
  return {
    speed: 1 + steps * ENEMY_DIFFICULTY_RAMP.speedPerWave,
    telegraphScale: Math.max(
      ENEMY_DIFFICULTY_RAMP.minimumTelegraphScale,
      1 - steps * ENEMY_DIFFICULTY_RAMP.telegraphCompressionPerWave,
    ),
  };
}

const ROLE_TUNING: Readonly<Record<EnemyRole, RoleTuning>> = {
  interceptor: { minimumRange: 18, maximumRange: 52, speed: 13, telegraphSeconds: 0.42, preferredMode: 'flank' },
  suppressor: { minimumRange: 54, maximumRange: 96, speed: 10, telegraphSeconds: 0.64, preferredMode: 'hold' },
  bomber: { minimumRange: 62, maximumRange: 118, speed: 8.5, telegraphSeconds: 0.96, preferredMode: 'hold' },
  support: { minimumRange: 74, maximumRange: 132, speed: 10.5, telegraphSeconds: 0.74, preferredMode: 'support' },
  elite: { minimumRange: 30, maximumRange: 72, speed: 14.5, telegraphSeconds: 0.48, preferredMode: 'flank' },
};

export class EnemyBehaviorSystem {
  public constructor(private readonly seed: number) {}

  public intent(
    enemy: EnemyBehaviorState,
    target: EnemyBehaviorTarget,
    context: EnemyBehaviorContext = {},
  ): EnemyIntent {
    const role = enemy.role ?? enemy.kind ?? 'interceptor';
    const tuning = ROLE_TUNING[role];
    const offset = subtract(target.position, enemy.position);
    const distance = length(offset);
    const towardTarget = normalized(offset, this.fallbackDirection(enemy.id));
    const flankSide = this.flankSide(enemy.id);
    const lateral = normalized(
      { x: -towardTarget.z * flankSide, y: towardTarget.y * 0.15, z: towardTarget.x * flankSide },
      this.fallbackDirection(`${enemy.id}:flank`),
    );
    const mode = this.selectMode(distance, tuning);
    const threat = clamp(finite(context.threat, 1), 1, 10);
    // 波次难度：速度递增 + 预警压缩（下限由 minimumTelegraphScale 兜底）
    const ramp = enemyRampForWave(finite(context.wave, 1));
    const speed = tuning.speed * (1 + (threat - 1) * 0.0125) * ramp.speed;
    const telegraphSeconds = tuning.telegraphSeconds * ramp.telegraphScale;
    const telegraphElapsed = Math.max(0, finite(enemy.telegraphElapsed, 0));
    const steering = this.steeringForMode(mode, towardTarget, lateral, telegraphElapsed, tuning.speed, distance, role);
    const separation = this.separation(enemy, context.allies ?? []);
    const desiredDirection = normalized(add(steering, scale(separation, 1.4)), steering);
    const inAttackBand = distance >= tuning.minimumRange * 0.8 && distance <= tuning.maximumRange * 1.1;

    return {
      role,
      mode,
      desiredVelocity: scale(desiredDirection, mode === 'hold' ? speed * 0.2 : speed),
      desiredRange: [tuning.minimumRange, tuning.maximumRange],
      telegraphSeconds,
      canFire: enemy.attackReady !== false
        && context.lineOfSight !== false
        && inAttackBand
        && telegraphElapsed >= telegraphSeconds,
      flankSide,
    };
  }

  private selectMode(distance: number, tuning: RoleTuning): EnemyIntentMode {
    if (distance < tuning.minimumRange) return 'retreat';
    if (distance > tuning.maximumRange) return 'close';
    return tuning.preferredMode;
  }

  private steeringForMode(
    mode: EnemyIntentMode,
    towardTarget: BehaviorVector3,
    lateral: BehaviorVector3,
    phase: number,
    speed: number,
    distance: number,
    role: EnemyRole,
  ): BehaviorVector3 {
    const weave = Math.sin(phase * 2.2) * 0.55;
    const bob = Math.sin(phase * 1.7) * 0.35;
    if (mode === 'close') {
      // Jinking approach: snake across the target plane to make the approach less predictable.
      return normalized(add(scale(towardTarget, 0.8), scale(lateral, weave)), lateral);
    }
    if (mode === 'retreat') return scale(towardTarget, -1);
    if (mode === 'flank') {
      // Hold an offset orbit while occasionally straightening out to threaten a shot.
      const commit = Math.sin(phase * 1.1) * 0.4;
      return normalized(add(scale(towardTarget, 0.2 + Math.max(0, commit)), scale(lateral, 1 - Math.abs(commit) * 0.5)), lateral);
    }
    if (mode === 'support') {
      return normalized(add(scale(towardTarget, -0.1), scale(lateral, 0.65)), lateral);
    }
    // hold: idle orbit with a gentle altitude bob so the ship never sits still.
    const orbit = normalized(add(scale(lateral, 0.5), scale(towardTarget, weave * 0.35)), lateral);
    return {
      x: orbit.x,
      y: orbit.y + bob * 0.2,
      z: orbit.z,
    };
  }

  private separation(enemy: EnemyBehaviorState, allies: readonly EnemyBehaviorState[]): BehaviorVector3 {
    let result: BehaviorVector3 = { x: 0, y: 0, z: 0 };
    for (const ally of allies) {
      if (ally.id === enemy.id) continue;
      const away = subtract(enemy.position, ally.position);
      const distance = length(away);
      if (distance <= 0 || distance >= MINIMUM_SEPARATION) continue;
      const strength = (MINIMUM_SEPARATION - distance) / MINIMUM_SEPARATION;
      result = add(result, scale(normalized(away, this.fallbackDirection(ally.id)), strength));
    }
    return result;
  }

  private flankSide(enemyId: string): -1 | 1 {
    return (hash32(`${this.seed | 0}:${enemyId}:side`) & 1) === 0 ? -1 : 1;
  }

  private fallbackDirection(salt: string): BehaviorVector3 {
    const angle = (hash32(`${this.seed | 0}:${salt}:direction`) / 0xffffffff) * Math.PI * 2;
    return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
  }
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function add(a: BehaviorVector3, b: BehaviorVector3): BehaviorVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: BehaviorVector3, b: BehaviorVector3): BehaviorVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector: BehaviorVector3, amount: number): BehaviorVector3 {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

function length(vector: BehaviorVector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalized(vector: BehaviorVector3, fallback: BehaviorVector3): BehaviorVector3 {
  const magnitude = length(vector);
  if (magnitude <= 1e-9 || !Number.isFinite(magnitude)) return fallback;
  return scale(vector, 1 / magnitude);
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}
