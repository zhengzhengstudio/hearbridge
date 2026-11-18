/**
 * 前哨站「建筑内」玩法地基。
 *
 * 设计约束（与 CombatSimulation 一致）：
 * - core 层绝不依赖 `cc`：存档用 StationStorage 端口注入，券的增减用 StationEconomyPort 注入。
 * - 纯逻辑、确定性、可单测；所有操作返回明确结果，界面据此给反馈。
 * - 四类玩法：任务板(contract) / 交易(trade) / 设施(facility) / 校准改装(refit)。
 *
 * 这是「地基」：只管数据与规则，不画界面、不改战斗。上层 HUD 与 CombatBootstrap
 * 通过本模块驱动四个面板，后续加深度玩法只需扩展这里的数据与规则。
 */

const STORAGE_KEY = 'spacefight.station.v1';
/** 设施从未领过券的哨兵值：保证首次互动必定过冷却。 */
const FACILITY_NEVER = -999;

export type ContractKind = 'escort' | 'purge' | 'delivery';
export type ContractStatus = 'available' | 'active' | 'ready' | 'claimed';

export interface ContractDef {
  readonly id: string;
  readonly kind: ContractKind;
  readonly goal: number;
  readonly reward: number;
  readonly titleKey: string;
  readonly descKey: string;
}

/** 固定任务表：goal 是所需远征进度（击杀数 / 货值 / 趟数），reward 是星港券。 */
export const CONTRACTS: readonly ContractDef[] = [
  { id: 'c-escort-1', kind: 'escort', goal: 6, reward: 90, titleKey: 'station.contract.escort1.title', descKey: 'station.contract.escort1.desc' },
  { id: 'c-purge-1', kind: 'purge', goal: 10, reward: 130, titleKey: 'station.contract.purge1.title', descKey: 'station.contract.purge1.desc' },
  { id: 'c-delivery-1', kind: 'delivery', goal: 240, reward: 110, titleKey: 'station.contract.delivery1.title', descKey: 'station.contract.delivery1.desc' },
];

export interface ContractProgress {
  readonly id: string;
  readonly progress: number;
  readonly status: ContractStatus;
}

export type TradeGoodId = 'ore' | 'alloy' | 'circuit' | 'medkit' | 'fuel' | 'data';

export interface TradeGood {
  readonly id: TradeGoodId;
  readonly basePrice: number;
  /** 价格波动幅度（0~1），越大越适合低买高卖。 */
  readonly volatility: number;
  readonly titleKey: string;
}

export const TRADE_GOODS: readonly TradeGood[] = [
  { id: 'ore', basePrice: 18, volatility: 0.18, titleKey: 'station.good.ore' },
  { id: 'alloy', basePrice: 46, volatility: 0.24, titleKey: 'station.good.alloy' },
  { id: 'circuit', basePrice: 88, volatility: 0.3, titleKey: 'station.good.circuit' },
  { id: 'medkit', basePrice: 34, volatility: 0.12, titleKey: 'station.good.medkit' },
  { id: 'fuel', basePrice: 26, volatility: 0.2, titleKey: 'station.good.fuel' },
  { id: 'data', basePrice: 120, volatility: 0.36, titleKey: 'station.good.data' },
];

export type FacilityId = 'repair-bay' | 'reactor' | 'mess' | 'bridge' | 'shipment';

export interface FacilityDef {
  readonly id: FacilityId;
  readonly titleKey: string;
  readonly descKey: string;
  /** 互动给券的冷却趟数（0 = 不给券，纯氛围）。 */
  readonly ticketCooldown: number;
  readonly ticketReward: number;
}

export const FACILITIES: readonly FacilityDef[] = [
  { id: 'repair-bay', titleKey: 'station.facility.repair', descKey: 'station.facility.repair.desc', ticketCooldown: 0, ticketReward: 0 },
  { id: 'reactor', titleKey: 'station.facility.reactor', descKey: 'station.facility.reactor.desc', ticketCooldown: 3, ticketReward: 12 },
  { id: 'mess', titleKey: 'station.facility.mess', descKey: 'station.facility.mess.desc', ticketCooldown: 4, ticketReward: 8 },
  { id: 'bridge', titleKey: 'station.facility.bridge', descKey: 'station.facility.bridge.desc', ticketCooldown: 0, ticketReward: 0 },
  { id: 'shipment', titleKey: 'station.facility.shipment', descKey: 'station.facility.shipment.desc', ticketCooldown: 5, ticketReward: 20 },
];

export type RefitStage = 'idle' | 'align' | 'charge' | 'verify' | 'done';

export interface StationSave {
  readonly version: number;
  readonly contracts: readonly ContractProgress[];
  readonly claimed: readonly string[];
  readonly holdings: Readonly<Record<TradeGoodId, number>>;
  readonly priceSeed: number;
  /** 各设施上次领券的返航趟数，用于冷却。 */
  readonly facilityVisits: Readonly<Record<string, number>>;
  readonly visited: readonly string[];
  readonly refitCount: number;
  readonly refitBest: number;
  /** 返航趟数计数器，任务交付与设施冷却共用。 */
  readonly trips: number;
}

export interface StationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StationEconomyPort {
  getTickets(): number;
  spendTickets(amount: number, receipt: string): boolean;
  grantTickets(amount: number, receipt: string): boolean;
}

export interface RunProgress {
  readonly kills: number;
  readonly cargoValue: number;
}

export interface Result {
  readonly ok: boolean;
  readonly reason?: string;
  readonly value?: number;
}

function emptyHoldings(): Record<TradeGoodId, number> {
  return { ore: 0, alloy: 0, circuit: 0, medkit: 0, fuel: 0, data: 0 };
}

export function defaultStationSave(): StationSave {
  const facilityVisits: Record<string, number> = {};
  for (const fac of FACILITIES) facilityVisits[fac.id] = FACILITY_NEVER;
  return {
    version: 1,
    contracts: [],
    claimed: [],
    holdings: emptyHoldings(),
    priceSeed: 7,
    facilityVisits,
    visited: [],
    refitCount: 0,
    refitBest: 0,
    trips: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 从存档 JSON 复原，字段缺失/损坏时逐项回退默认值，保证老存档可平滑升级。 */
export function parseStationSave(raw: string | null): StationSave {
  if (!raw) return defaultStationSave();
  try {
    const parsed = JSON.parse(raw) as Partial<StationSave>;
    const holdings = emptyHoldings();
    for (const good of TRADE_GOODS) holdings[good.id] = Math.max(0, Math.floor(finite(parsed.holdings?.[good.id], 0)));
    const validContractIds = new Set(CONTRACTS.map((c) => c.id));
    const contracts = (parsed.contracts || [])
      .filter((p) => p && validContractIds.has(p.id))
      .map((p) => ({
        id: p.id,
        progress: Math.max(0, finite(p.progress, 0)),
        status: (['active', 'ready', 'claimed'].includes(p.status) ? p.status : 'active') as ContractStatus,
      }));
    const facilityVisits: Record<string, number> = {};
    for (const fac of FACILITIES) facilityVisits[fac.id] = Math.max(FACILITY_NEVER, Math.floor(finite(parsed.facilityVisits?.[fac.id], FACILITY_NEVER)));
    return {
      version: 1,
      contracts,
      claimed: (parsed.claimed || []).filter((id) => validContractIds.has(id)),
      holdings,
      priceSeed: Math.floor(finite(parsed.priceSeed, 7)),
      facilityVisits,
      visited: Array.from(new Set((parsed.visited || []).filter((id) => FACILITIES.some((f) => f.id === id)))),
      refitCount: Math.max(0, Math.floor(finite(parsed.refitCount, 0))),
      refitBest: clamp(Math.floor(finite(parsed.refitBest, 0)), 0, 100),
      trips: Math.max(0, Math.floor(finite(parsed.trips, 0))),
    };
  } catch (_) {
    return defaultStationSave();
  }
}

/** 价格随机但确定：同一 seed + 商品恒定，便于展示「行情」又保证可测。 */
function priceFor(good: TradeGood, seed: number): number {
  const step = 1 + Math.sin(seed * 0.73 + good.basePrice * 0.11) * good.volatility;
  return Math.max(1, Math.round(good.basePrice * step));
}

export class StationSystem {
  private state: StationSave;
  /** 单调交易序号：让每次买卖/领券的 receipt 唯一，避免同趟内连续买两次被幂等误挡。 */
  private txnSeq = 0;

  constructor(
    private readonly storage: StationStorage,
    private readonly economy: StationEconomyPort,
  ) {
    this.state = parseStationSave(storage.getItem(STORAGE_KEY));
  }

  public snapshot(): StationSave {
    return this.state;
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private nextReceipt(kind: string): string {
    this.txnSeq += 1;
    // 带命名空间 + 单调序号：同一会话每次调用都唯一，正常连续交易不会被幂等挡住；
    // 命名空间避免与商城/远征结算共用 receipts 池时串号。
    return `sf.station.${kind}.${this.state.trips}.${this.txnSeq}`;
  }

  // ---------- 任务板 ----------

  /** 当前可接任务（未接、未领奖）。 */
  public availableContracts(): readonly ContractDef[] {
    const known = new Set([...this.state.contracts.map((c) => c.id), ...this.state.claimed]);
    return CONTRACTS.filter((c) => !known.has(c.id));
  }

  public acceptContract(id: string): Result {
    const def = CONTRACTS.find((c) => c.id === id);
    if (!def) return { ok: false, reason: 'unknown-contract' };
    if (this.state.contracts.some((c) => c.id === id) || this.state.claimed.includes(id)) {
      return { ok: false, reason: 'already-accepted' };
    }
    this.state = {
      ...this.state,
      contracts: [...this.state.contracts, { id, progress: 0, status: 'active' }],
    };
    this.persist();
    return { ok: true };
  }

  /**
   * 一趟远征结束后推进任务进度。不同 kind 用不同指标；达标置 ready。
   * 只在返航时调用一次，避免战斗中每帧累加。
   */
  public recordTrip(run: RunProgress): void {
    const progress = this.state.contracts.map((c) => {
      if (c.status !== 'active') return c;
      const def = CONTRACTS.find((d) => d.id === c.id);
      if (!def) return c;
      const delta = def.kind === 'purge' ? Math.max(0, run.kills)
        : def.kind === 'delivery' ? Math.max(0, run.cargoValue)
          : 1; // escort 按趟数
      const next = c.progress + delta;
      return { ...c, progress: next, status: next >= def.goal ? 'ready' as ContractStatus : 'active' as ContractStatus };
    });
    this.state = { ...this.state, contracts: progress, trips: this.state.trips + 1 };
    this.persist();
  }

  public claimContract(id: string): Result {
    const current = this.state.contracts.find((c) => c.id === id);
    const def = CONTRACTS.find((c) => c.id === id);
    if (!current || !def) return { ok: false, reason: 'unknown-contract' };
    if (current.status !== 'ready') return { ok: false, reason: 'not-ready' };
    if (!this.economy.grantTickets(def.reward, this.nextReceipt('contract'))) {
      return { ok: false, reason: 'grant-failed' };
    }
    this.state = {
      ...this.state,
      contracts: this.state.contracts.map((c) => (c.id === id ? { ...c, status: 'claimed' as ContractStatus } : c)),
      claimed: [...this.state.claimed, id],
    };
    this.persist();
    return { ok: true, value: def.reward };
  }

  // ---------- 交易终端 ----------

  /** 当前行情：买价略高于基准，卖价略低，形成价差。 */
  public market(): Readonly<Record<TradeGoodId, { buy: number; sell: number }>> {
    const result = {} as Record<TradeGoodId, { buy: number; sell: number }>;
    for (const good of TRADE_GOODS) {
      const mid = priceFor(good, this.state.priceSeed);
      result[good.id] = {
        buy: Math.max(1, Math.round(mid * 1.12)),
        sell: Math.max(1, Math.round(mid * 0.82)),
      };
    }
    return result;
  }

  public buy(goodId: TradeGoodId, qty = 1): Result {
    const qtySafe = Math.floor(qty);
    if (!TRADE_GOODS.some((g) => g.id === goodId) || qtySafe < 1) return { ok: false, reason: 'invalid-order' };
    const cost = this.market()[goodId].buy * qtySafe;
    if (!this.economy.spendTickets(cost, this.nextReceipt('buy'))) return { ok: false, reason: 'insufficient' };
    this.state = {
      ...this.state,
      holdings: { ...this.state.holdings, [goodId]: this.state.holdings[goodId] + qtySafe },
    };
    this.persist();
    return { ok: true, value: cost };
  }

  public sell(goodId: TradeGoodId, qty = 1): Result {
    const qtySafe = Math.floor(qty);
    if (!TRADE_GOODS.some((g) => g.id === goodId) || qtySafe < 1) return { ok: false, reason: 'invalid-order' };
    if (this.state.holdings[goodId] < qtySafe) return { ok: false, reason: 'insufficient-stock' };
    const payout = this.market()[goodId].sell * qtySafe;
    if (!this.economy.grantTickets(payout, this.nextReceipt('sell'))) return { ok: false, reason: 'grant-failed' };
    this.state = {
      ...this.state,
      holdings: { ...this.state.holdings, [goodId]: this.state.holdings[goodId] - qtySafe },
    };
    this.persist();
    return { ok: true, value: payout };
  }

  /** 每次返航刷新一次行情，制造低买高卖的时间差。 */
  public refreshMarket(): void {
    this.state = { ...this.state, priceSeed: this.state.priceSeed + 1 };
    this.persist();
  }

  // ---------- 设施互动 ----------

  public interactFacility(id: FacilityId): Result {
    const fac = FACILITIES.find((f) => f.id === id);
    if (!fac) return { ok: false, reason: 'unknown-facility' };
    const visited = this.state.visited.includes(id) ? this.state.visited : [...this.state.visited, id];
    let rewarded = 0;
    const last = this.state.facilityVisits[id] ?? -999;
    if (fac.ticketReward > 0 && this.state.trips - last >= fac.ticketCooldown) {
      if (this.economy.grantTickets(fac.ticketReward, this.nextReceipt(`fac-${id}`))) {
        rewarded = fac.ticketReward;
      }
    }
    this.state = {
      ...this.state,
      visited,
      facilityVisits: rewarded > 0 ? { ...this.state.facilityVisits, [id]: this.state.trips } : this.state.facilityVisits,
    };
    this.persist();
    return { ok: true, value: rewarded };
  }

  // ---------- 校准改装小游戏 ----------

  /**
   * 一次性校准判定：给一个 0~100 的准度，越接近 100 效果越好。
   * 改装消耗券（与 serviceStation 的 refit 价格错开），按准度提升永久护盾改装次数。
   * 纯逻辑：上层把一次点击/拖动换算成 accuracy 传进来。
   */
  public completeRefit(accuracy: number): Result {
    const acc = clamp(Math.floor(finite(accuracy, 0)), 0, 100);
    if (acc < 40) return { ok: false, reason: 'calibration-failed' };
    const price = 60;
    if (!this.economy.spendTickets(price, this.nextReceipt('refit'))) return { ok: false, reason: 'insufficient' };
    this.state = {
      ...this.state,
      refitCount: this.state.refitCount + 1,
      refitBest: Math.max(this.state.refitBest, acc),
    };
    this.persist();
    return { ok: true, value: acc };
  }
}
