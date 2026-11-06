export type ExpeditionEventKind = 'intercept' | 'signal' | 'breach' | 'surge' | 'hunt';
export type ExpeditionPhase = 'infiltration' | 'primary' | 'decision' | 'deep-zone' | 'returning' | 'complete' | 'failed';

export interface ExpeditionEventDefinition {
  readonly id: string;
  readonly kind: ExpeditionEventKind;
  readonly threat: number;
}

export interface ExpeditionSnapshot {
  readonly phase: ExpeditionPhase;
  readonly threat: number;
  readonly completedEvents: readonly string[];
  readonly availableEvents: readonly ExpeditionEventDefinition[];
  readonly canReturn: boolean;
  readonly returnProgress: number;
}

export interface ExpeditionStepInput {
  readonly delta?: number;
  readonly returnRequested?: boolean;
  readonly insideReturnZone?: boolean;
  readonly damaged?: boolean;
}

const EVENT_KINDS: readonly ExpeditionEventKind[] = ['intercept', 'signal', 'breach', 'surge', 'hunt'];
const RETURN_SECONDS = 2.4;

export class ExpeditionDirector {
  private phase: ExpeditionPhase = 'primary';
  private threat = 1;
  private readonly completedEvents: string[] = [];
  private availableEvents: ExpeditionEventDefinition[];
  private returnProgress = 0;
  private damagePause = 0;

  public constructor(private readonly options: { seed: number; primaryEvent: ExpeditionEventKind }) {
    this.availableEvents = [this.event(options.primaryEvent, 0)];
  }

  public completeEvent(eventId: string): void {
    if (!this.completedEvents.includes(eventId)) this.completedEvents.push(eventId);
    if (eventId === 'primary' || this.phase === 'primary') {
      this.phase = 'decision';
      this.availableEvents = this.chooseOptionalEvents();
    } else if (this.phase === 'deep-zone') {
      this.phase = 'decision';
      this.availableEvents = this.chooseOptionalEvents();
    }
  }

  public continueExpedition(): ExpeditionSnapshot {
    if (this.phase !== 'decision') return this.snapshot();
    this.threat += 1;
    this.phase = 'deep-zone';
    this.returnProgress = 0;
    this.availableEvents = this.chooseOptionalEvents();
    return this.snapshot();
  }

  public fail(): void {
    this.phase = 'failed';
    this.returnProgress = 0;
  }

  public step(input: ExpeditionStepInput = {}): ExpeditionSnapshot {
    if (this.phase === 'complete' || this.phase === 'failed') return this.snapshot();
    const delta = Math.max(0, Number.isFinite(input.delta) ? input.delta || 0 : 0);
    if (input.damaged) this.damagePause = 0.35;
    this.damagePause = Math.max(0, this.damagePause - delta);

    if (!this.canReturn() || !input.returnRequested) {
      if (this.phase === 'returning') this.phase = 'decision';
      return this.snapshot();
    }
    this.phase = 'returning';
    // 返航进度不再被「受到伤害」打断：此前 `damagePause > 0` 时进度停滞，在碎石/
    // 敌机持续擦碰的战场里永远凑不满 → 返航卡死、没有动画、进不了前哨。
    // 现在无论是否挨打，返航都稳定推进，确保一定能把玩家送回基地。
    if (input.insideReturnZone !== false) {
      this.returnProgress = Math.min(1, this.returnProgress + delta / RETURN_SECONDS);
    }
    if (this.returnProgress >= 1 - 0.000000001) {
      this.returnProgress = 1;
      this.phase = 'complete';
    }
    return this.snapshot();
  }

  public snapshot(): ExpeditionSnapshot {
    return {
      phase: this.phase,
      threat: this.threat,
      completedEvents: [...this.completedEvents],
      availableEvents: this.availableEvents.map((event) => ({ ...event })),
      canReturn: this.canReturn(),
      returnProgress: Math.round(this.returnProgress * 1000000) / 1000000,
    };
  }

  private canReturn(): boolean {
    // 保底修复「无法停靠 / 卡在远处」：除已失败、已完成外，任何阶段都允许长按返回键回基地。
    // 原先仅在 decision / deep-zone / returning 阶段为真，导致开局 primary 阶段飞远后
    // （outpostRange 很大）既无返航键、又飞不回那 6 单位停靠薄环，永久卡死无法进站。
    return this.phase !== 'failed' && this.phase !== 'complete';
  }

  private chooseOptionalEvents(): ExpeditionEventDefinition[] {
    const start = Math.floor(this.seededUnit(this.threat * 37 + this.completedEvents.length * 19) * EVENT_KINDS.length);
    const first = EVENT_KINDS[start];
    const second = EVENT_KINDS[(start + 1 + (this.options.seed % (EVENT_KINDS.length - 1))) % EVENT_KINDS.length];
    return [this.event(first, this.completedEvents.length + 1), this.event(second, this.completedEvents.length + 2)];
  }

  private event(kind: ExpeditionEventKind, index: number): ExpeditionEventDefinition {
    return { id: index === 0 ? 'primary' : `${kind}-${this.threat}-${index}`, kind, threat: this.threat };
  }

  private seededUnit(salt: number): number {
    let value = Math.imul((this.options.seed | 0) ^ salt, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 0xffffffff;
  }
}
