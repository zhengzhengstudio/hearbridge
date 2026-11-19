/**
 * 站内自由行走（3D 舱内探索）纯逻辑。
 *
 * 与 CombatSimulation / StationSystem 一致的设计约束：
 * - core 层绝不依赖 `cc`：化身位置用平面 (x, z)，边界/终端/速度都是纯数据，可单测。
 * - 确定性、边沿触发、可注入命令；上层（CombatBootstrap）负责把位置映射到 3D 节点与相机。
 *
 * 完整站内循环：
 * 1. 机库入口出发，飞遍舱室收集 5 枚漂浮能量核心（探索 + 空间感）。
 * 2. 按序激活 3 个巡检信标（限时小游戏，给明确目标、倒计时与一次性奖励）。
 * 3. 靠近四个终端按开火键打开任务板 / 交易 / 设施 / 校准改装面板（局外成长）。
 * 4. 机务 R-7 交接下一趟远征委托，离港终端直接出击，形成「进站→玩→离港→返航」闭环。
 */

/** 舱内可交互目标：四个玩法终端 + 机库出口（离港）。 */
export type WalkTarget = 'contracts' | 'trade' | 'facilities' | 'refit' | 'mechanic' | 'undock';

export interface WalkTerminal {
  readonly id: WalkTarget;
  readonly x: number;
  readonly z: number;
  /** 交互触发半径（米）。 */
  readonly radius: number;
}

export interface WalkBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface WalkCommand {
  throttle: number;
  strafe: number;
  primaryFire: boolean;
  boost: boolean;
}

/** 漂浮能量核心：站内自由飞行时飞过去收集，属于「边走边玩」的小玩法。 */
export interface WalkCore {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

/** 限时巡检信标：必须按 1→2→3 顺序激活，集齐后给一次性奖励。 */
export interface WalkPatrolNode {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface WalkPatrolProgress {
  /** 下一个待激活信标编号（0 起；已完成为 0）。 */
  readonly step: number;
  readonly total: number;
  readonly running: boolean;
  readonly timeLeft: number;
  readonly completedRuns: number;
}

export interface WalkStepResult {
  readonly x: number;
  readonly z: number;
  /** 当前半径内最近的终端（没有则 null）。 */
  readonly near: WalkTerminal | null;
  /** 本帧发生了交互（开火上升沿 + 处于终端内），只触发一次。 */
  readonly interact: WalkTarget | null;
  readonly moved: boolean;
  /** 本帧新收集到的核心 id 列表。 */
  readonly collected: number[];
  /** 本帧首次集齐全部核心（触发一次性奖励）。 */
  readonly bonus: boolean;
  /** 本帧激活的巡检信标编号（没有则 null）。 */
  readonly patrolNode: number | null;
  /** 本帧完成一轮限时巡检。 */
  readonly patrolComplete: boolean;
  /** 本帧巡检超时，序列重置。 */
  readonly patrolTimeout: boolean;
}

/** 走廊可行走范围，略小于 WorldStreamer 的 StationInterior 墙体，避免穿墙。 */
export const STATION_WALK_BOUNDS: WalkBounds = {
  minX: -3.05, maxX: 3.05, minZ: -3.45, maxZ: 4.1,
};

/** 机库入口起点（正对走廊，玩家一进来就有明确的前进方向）。 */
export const STATION_WALK_START = { x: 0, z: 3.5 };

/** 五个终端的舱内坐标，与 StationInterior 家具分布大致对应。 */
export const STATION_WALK_TERMINALS: readonly WalkTerminal[] = [
  { id: 'contracts', x: -2.25, z: -1.85, radius: 1.95 },
  { id: 'trade', x: 2.25, z: -1.85, radius: 1.95 },
  { id: 'facilities', x: -2.25, z: 1.3, radius: 1.95 },
  { id: 'refit', x: 2.25, z: 1.3, radius: 1.95 },
  { id: 'mechanic', x: 0, z: -1.1, radius: 1.55 },
  { id: 'undock', x: 0, z: 3.75, radius: 2.05 },
];

/** 五个漂浮核心散布在走廊各处，逼玩家真的把飞船开出去逛一圈。 */
export const STATION_WALK_CORES: readonly WalkCore[] = [
  { id: 0, x: 0, z: 1.9 },
  { id: 1, x: -2.35, z: -0.5 },
  { id: 2, x: 2.35, z: -0.5 },
  { id: 3, x: -1.6, z: -2.9 },
  { id: 4, x: 1.6, z: -2.9 },
];

/**
 * 巡检路线刻意覆盖舱室两端：1 号在左后货舱，2 号在右后动力区，
 * 3 号回到中段主廊。玩家必须在倒计时内真的把飞船开一圈，不是站着点按钮。
 */
export const STATION_WALK_PATROL: readonly WalkPatrolNode[] = [
  { id: 0, x: -2.55, z: -2.75, radius: 1.05 },
  { id: 1, x: 2.55, z: -2.75, radius: 1.05 },
  { id: 2, x: 0, z: 1.25, radius: 1.05 },
];

const PATROL_TIME_LIMIT = 42;

const WALK_SPEED = 5.4;
const BOOST_MULTIPLIER = 1.75;
const CORE_PICKUP_RADIUS = 1.05;
/** 交互后的闩锁，防止面板关闭瞬间同一次长按连开两次。 */
const INTERACT_LOCK_SECONDS = 0.45;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export class StationWalkSystem {
  private x = STATION_WALK_START.x;
  private z = STATION_WALK_START.z;
  private prevFire = false;
  private interactLock = 0;
  private collected = new Set<number>();
  private bonusGranted = false;
  private patrolStep = 0;
  private patrolTimer = 0;
  private patrolRunning = false;
  private patrolRuns = 0;

  /** 每次进站重新落到机库入口，清掉按键闩锁，并重置本趟核心收集与巡检。 */
  reset(): void {
    this.x = STATION_WALK_START.x;
    this.z = STATION_WALK_START.z;
    this.prevFire = false;
    this.interactLock = 0;
    this.collected.clear();
    this.bonusGranted = false;
    this.patrolStep = 0;
    this.patrolTimer = 0;
    this.patrolRunning = false;
    this.patrolRuns = 0;
  }

  position(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  /** 已收集核心 id 集合（只读副本）。 */
  collectedCores(): ReadonlySet<number> {
    return this.collected;
  }

  coresRemaining(): number {
    return STATION_WALK_CORES.length - this.collected.size;
  }

  /** HUD 用只读巡检进度：下一步、剩余秒数、累计完成轮数。 */
  patrolProgress(): WalkPatrolProgress {
    return {
      step: this.patrolStep,
      total: STATION_WALK_PATROL.length,
      running: this.patrolRunning,
      timeLeft: Math.max(0, Math.ceil(this.patrolTimer)),
      completedRuns: this.patrolRuns,
    };
  }

  /** 半径内最近的终端；没有则 null。指定坐标便于测试与 HUD 方位计算。 */
  nearest(x = this.x, z = this.z): WalkTerminal | null {
    let best: WalkTerminal | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const terminal of STATION_WALK_TERMINALS) {
      const distance = Math.hypot(terminal.x - x, terminal.z - z);
      if (distance <= terminal.radius && distance < bestDistance) {
        best = terminal;
        bestDistance = distance;
      }
    }
    return best;
  }

  step(command: WalkCommand, deltaTime: number): WalkStepResult {
    // 单帧上限：卡顿/切后台回来时不要让飞船瞬移穿墙。
    const dt = clamp(Number.isFinite(deltaTime) ? deltaTime : 0, 0, 0.05);
    if (this.interactLock > 0) this.interactLock = Math.max(0, this.interactLock - dt);

    let moveX = clamp(Number(command.strafe) || 0, -1, 1);
    // throttle>0 表示向前（舱内 -z 方向）。
    let moveZ = -clamp(Number(command.throttle) || 0, -1, 1);
    const magnitude = Math.hypot(moveX, moveZ);
    let moved = false;
    if (magnitude > 0.001) {
      if (magnitude > 1) {
        moveX /= magnitude;
        moveZ /= magnitude;
      }
      const speed = WALK_SPEED * (command.boost ? BOOST_MULTIPLIER : 1);
      const nextX = clamp(this.x + moveX * speed * dt, STATION_WALK_BOUNDS.minX, STATION_WALK_BOUNDS.maxX);
      const nextZ = clamp(this.z + moveZ * speed * dt, STATION_WALK_BOUNDS.minZ, STATION_WALK_BOUNDS.maxZ);
      moved = Math.abs(nextX - this.x) > 1e-6 || Math.abs(nextZ - this.z) > 1e-6;
      this.x = nextX;
      this.z = nextZ;
    }

    const fire = command.primaryFire === true;
    const risingEdge = fire && !this.prevFire;
    this.prevFire = fire;

    // 核心收集：飞进拾取半径即可，无需按键——鼓励玩家真的把飞船开遍整个舱室。
    const collected: number[] = [];
    for (const core of STATION_WALK_CORES) {
      if (this.collected.has(core.id)) continue;
      if (Math.hypot(core.x - this.x, core.z - this.z) <= CORE_PICKUP_RADIUS) {
        this.collected.add(core.id);
        collected.push(core.id);
      }
    }
    let bonus = false;
    if (!this.bonusGranted && this.collected.size === STATION_WALK_CORES.length) {
      this.bonusGranted = true;
      bonus = true;
    }

    // 限时巡检：必须按固定顺序飞过三个信标。计时从第一个信标开始，
    // 每激活一个补偿 6 秒（鼓励连续跑完，又不至于让玩家在最后一个点被卡死）。
    let patrolNode: number | null = null;
    let patrolComplete = false;
    let patrolTimeout = false;
    if (this.patrolRunning) {
      this.patrolTimer = Math.max(0, this.patrolTimer - dt);
      if (this.patrolTimer <= 0) {
        this.patrolRunning = false;
        this.patrolStep = 0;
        this.patrolTimer = 0;
        patrolTimeout = true;
      }
    }
    const nextPatrol = STATION_WALK_PATROL[this.patrolStep] ?? null;
    if (nextPatrol && Math.hypot(nextPatrol.x - this.x, nextPatrol.z - this.z) <= nextPatrol.radius) {
      patrolNode = nextPatrol.id;
      if (this.patrolRunning) this.patrolTimer = Math.min(PATROL_TIME_LIMIT, this.patrolTimer + 6);
      else {
        this.patrolRunning = true;
        this.patrolTimer = PATROL_TIME_LIMIT;
      }
      this.patrolStep += 1;
      if (this.patrolStep >= STATION_WALK_PATROL.length) {
        patrolComplete = true;
        this.patrolRunning = false;
        this.patrolStep = 0;
        this.patrolTimer = 0;
        this.patrolRuns += 1;
      }
    }

    const near = this.nearest();
    let interact: WalkTarget | null = null;
    if (risingEdge && near && this.interactLock <= 0) {
      interact = near.id;
      this.interactLock = INTERACT_LOCK_SECONDS;
    }
    return {
      x: this.x, z: this.z, near, interact, moved, collected, bonus,
      patrolNode, patrolComplete, patrolTimeout,
    };
  }

  /** 打开 2D 面板/离港后调用：吃掉当前按键状态，避免关闭瞬间误触下一次交互。 */
  suspendInteraction(): void {
    this.prevFire = true;
    this.interactLock = INTERACT_LOCK_SECONDS;
  }
}
