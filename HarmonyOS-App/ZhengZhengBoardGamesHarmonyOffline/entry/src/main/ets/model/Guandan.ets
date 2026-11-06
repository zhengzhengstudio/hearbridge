/*
 * 掼蛋（Guandan）规则引擎
 *
 * 独立成文件而不是塞进 Index.ets：Index.ets 已经 8000+ 行，
 * 而掼蛋的规则逻辑（级牌 / 逢人配 / 板 / 炸弹分级）自成一体，可单测。
 *
 * 牌张用字符串表示，沿用斗地主已有的风格（'♠A' / '♥10' / '小王' / '大王'），
 * 两副牌即同名字符各出现两次。
 *
 * 规则依据（多方资料交叉核对）：
 *  - 牌数：两副牌 108 张，四人每人 27 张，2v2 对家配合
 *  - 牌点序：2 < 3 < 4 … < A < **级牌** < 小王 < 大王
 *    （级牌随局升级，不是固定最大；这是新手最容易错的一点）
 *  - 顺子：固定 5 张连续，A 可当最大(10JQKA)或最小(A2345)，不能跨头(JQKA2)
 *  - 木板（拖拉机）：固定 3 对连续，如 334455
 *  - 钢板：固定 2 组三张连续，如 333444
 *  - 三带二：只比三张的点数，不比带的对子
 *  - 炸弹：4 张及以上同点，**张数多的大于张数少的**
 *  - 牌力：四王 > 8炸 > 7炸 > 6炸 > 同花顺 > 5炸 > 4炸 > 其他牌型
 *  - 逢人配：**红桃级牌**（当级牌是几，红桃几就是逢人配），除大小王外可当任意牌
 *  - 同类牌型比较需类型相同且张数相同
 */

// ===== 基础定义 =====

/** 自然点数序：2 最小 … A 最大。级牌会在运行时被临时抬高，不在此处体现。 */
const GD_ORDER: string[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

/** 各点数对应的比较权重（级牌会在此基础上动态插到 A 与小王之间） */
const GD_BASE: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
const GD_JOKER_LOW = 20   // 小王
const GD_JOKER_HIGH = 21  // 大王

export interface GuandanCombo {
  /** 牌型标识，见 analyzeGuandan() */
  type: string
  /** 比较权重（含级牌抬升后的实际大小） */
  rank: number
  /** 张数 */
  size: number
  /** 炸弹级数（4 炸=4 … 8 炸=8）；非炸弹为 0 */
  bombLevel: number
}

/**
 * 单张牌的比较权重。
 * @param card 牌字符串
 * @param level 当前级牌点数（2=2 … A=14，即 GD_ORDER 下标+2）
 */
export function guandanRank(card: string, level: number): number {
  if (card === '大王') return GD_JOKER_HIGH
  if (card === '小王') return GD_JOKER_LOW
  const idx = GD_ORDER.indexOf(card.substring(1))
  if (idx < 0) return 0
  // 级牌插到 A(13) 之上、小王(20) 之下
  const levelIdx = level - 2
  if (idx === levelIdx) return 15
  return GD_BASE[idx]
}

/** 牌的花色字符（'♠' '♥' '♣' '♦'），王返回空串 */
export function guandanSuit(card: string): string {
  return card.length > 1 ? card.charAt(0) : ''
}

/**
 * 是否「逢人配」：**红桃级牌**。
 * 例：打 2 时红桃 2；打 5 时红桃 5。
 */
export function guandanIsWild(card: string, level: number): boolean {
  const idx = GD_ORDER.indexOf(card.substring(1))
  return guandanSuit(card) === '♥' && idx === level - 2
}

/** 是否王（大小王都不能当逢人配） */
export function guandanIsJoker(card: string): boolean {
  return card === '大王' || card === '小王'
}

/** 造两副牌共 108 张 */
export function guandanDeck(): string[] {
  const suits: string[] = ['♠', '♥', '♣', '♦']
  const deck: string[] = []
  for (let copy = 0; copy < 2; copy++) {
    suits.forEach((suit: string) => {
      GD_ORDER.forEach((face: string) => deck.push(suit + face))
    })
    deck.push('小王')
    deck.push('大王')
  }
  return deck
}

/** 洗牌（Fisher-Yates），返回新数组 */
export function guandanShuffle(deck: string[]): string[] {
  const result = deck.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = result[i]
    result[i] = result[j]
    result[j] = temp
  }
  return result
}

function suitOrder(card: string): number {
  const suits: string[] = ['♠', '♥', '♣', '♦']
  const idx = suits.indexOf(guandanSuit(card))
  return idx < 0 ? 9 : idx
}

/**
 * 手牌排序：按当前级牌下的实际大小降序，同大小按花色稳定排序。
 *
 * ⚠️ tie-break 必须用**数值权重**（花色序号），不能用 `localeCompare`：
 * 牌面字符串含 '10'，字典序会把 '10' 排到 '3' 前面，导致大张牌反而排在后面。
 */
export function guandanSortHand(hand: string[], level: number): string[] {
  const weight = (card: string): number => guandanRank(card, level) * 10 + suitOrder(card)
  return hand.slice().sort((a: string, b: string) => weight(b) - weight(a))
}

// ===== 牌型识别 =====

/**
 * 牌的自然点数（不含级牌抬升）：2=1 … A=13，小王=20、大王=21。
 *
 * ⚠️ 顺子/木板/钢板的**连续性判定必须用自然点数，不能用 guandanRank()**：
 * 级牌会被临时抬到 A 之上，用抬升后的值判连续会全部错乱
 *（例：打 5 时红桃 5 的 rank=15，于是 A2345 判不出连续，而 JQKA2 反倒被判成 A2345）。
 */
function naturalRank(card: string): number {
  if (card === '大王') return GD_JOKER_HIGH
  if (card === '小王') return GD_JOKER_LOW
  const idx = GD_ORDER.indexOf(card.substring(1))
  return idx < 0 ? 0 : idx + 1
}

/**
 * 牌型识别。level = 当前级牌点数（2..14，对应 2..A）。
 * 返回 null 表示不是合法牌型。
 *
 * 支持：
 *  single       单张
 *  pair         对子
 *  trio         三同张（三不带）
 *  full_house   三带二（只比三张点数）
 *  straight     顺子（固定 5 张，A 可当最大或最小）
 *  tractor      木板 / 拖拉机（固定 3 对连续）
 *  steel        钢板（固定 2 组三张连续）
 *  wood         同花顺（固定 5 张同花连续）
 *  bomb         炸弹（4~8 张同点，bombLevel = 张数）
 *  joker_storm  四王（2 大王 + 2 小王，最大牌型）
 */
export function analyzeGuandan(cards: string[], level: number): GuandanCombo | null {
  const size = cards.length
  if (size === 0) return null

  // 比较用计数（级牌抬升后的权重，决定大小）
  const counter: Map<number, number> = new Map()
  // 连续性用计数（自然点数，决定牌型是否成立）
  const natural: Map<number, number> = new Map()
  cards.forEach((card: string) => {
    const rk = guandanRank(card, level)
    counter.set(rk, (counter.get(rk) || 0) + 1)
    const nr = naturalRank(card)
    natural.set(nr, (natural.get(nr) || 0) + 1)
  })

  // ---- 四王（最大）：2 大王 + 2 小王 ----
  if (size === 4 && cards.filter((c: string) => c === '大王').length === 2 &&
    cards.filter((c: string) => c === '小王').length === 2) {
    return { type: 'joker_storm', rank: 100, size: 4, bombLevel: 10 }
  }

  // ---- 炸弹：4~8 张同点 ----
  // ⚠️ 上限必须是 8：两副牌里同一个点数最多只有 8 张，
  // 超过 8 张的输入（脏数据/测试构造）要判为非法牌型，否则会被当成超大炸弹。
  if (size >= 4 && size <= 8 && counter.size === 1) {
    let bombRank = 0
    counter.forEach((c: number, r: number) => {
      if (c === size) bombRank = r
    })
    if (bombRank !== 0) {
      return { type: 'bomb', rank: bombRank, size: size, bombLevel: size }
    }
  }

  // ---- 同花顺（固定 5 张同花连续）----
  const suits: Set<string> = new Set(cards.map((card: string) => guandanSuit(card)))
  if (size === 5 && suits.size === 1 && maxCount(natural) === 1) {
    const seq = sortedKeys(natural)
    if (isConsecutive(seq) || isAceLow(seq)) {
      const tail = isAceLow(seq) ? 5 : seq[seq.length - 1]
      return { type: 'wood', rank: tail, size: 5, bombLevel: 0 }
    }
  }

  // ---- 钢板（固定 2 组三张连续，共 6 张）----
  if (size === 6 && maxCount(natural) === 3 && natural.size === 2) {
    const seq = sortedKeys(natural)
    if (isConsecutive(seq)) {
      return { type: 'steel', rank: guandanRankOf(seq[seq.length - 1], level), size: 6, bombLevel: 0 }
    }
  }

  // ---- 木板 / 拖拉机（固定 3 对连续，共 6 张）----
  if (size === 6 && maxCount(natural) === 2 && natural.size === 3) {
    const seq = sortedKeys(natural)
    if (isConsecutive(seq)) {
      return { type: 'tractor', rank: guandanRankOf(seq[seq.length - 1], level), size: 6, bombLevel: 0 }
    }
  }

  // ---- 顺子（固定 5 张连续，A 可当最大或最小）----
  if (size === 5 && maxCount(natural) === 1) {
    const seq = sortedKeys(natural)
    if (isConsecutive(seq)) {
      return { type: 'straight', rank: guandanRankOf(seq[seq.length - 1], level), size: 5, bombLevel: 0 }
    }
    // A2345：A 接到 2 的下面（自然点数 13 接 1），算最小顺子
    if (isAceLow(seq)) {
      return { type: 'straight', rank: guandanRankOf(5, level), size: 5, bombLevel: 0 }
    }
  }

  // ---- 三带二（只比三张点数）----
  // ⚠️ 踢脚的 2 张**允许是不同点数**（也可能同点成对），所以不能要求整体只有 2 个点数。
  //判据：5 张里存在一组 count===3，其余 2 张不限点数。
  //注意这条必须排在钢板/木板/顺子之后，否则 333 44 这类会被误当成钢板。
  if (size === 5) {
    let trioRank = 0
    counter.forEach((c: number, r: number) => {
      if (c === 3) trioRank = r
    })
    if (trioRank !== 0) {
      return { type: 'full_house', rank: trioRank, size: 5, bombLevel: 0 }
    }
  }

  // ---- 基础牌型 ----
  if (size === 1) {
    return { type: 'single', rank: guandanRank(cards[0], level), size: 1, bombLevel: 0 }
  }
  if (size === 2 && maxCount(counter) === 2) {
    const sorted = sortedKeys(counter)
    return { type: 'pair', rank: sorted[0], size: 2, bombLevel: 0 }
  }
  if (size === 3 && maxCount(counter) === 3) {
    const sorted = sortedKeys(counter)
    return { type: 'trio', rank: sorted[0], size: 3, bombLevel: 0 }
  }

  return null
}

/** 把「自然点数」换成该局面下的实际比较权重 */
function guandanRankOf(naturalRankValue: number, level: number): number {
  if (naturalRankValue >= GD_JOKER_LOW) return naturalRankValue
  const face = GD_ORDER[naturalRankValue - 1]
  if (face === undefined) return naturalRankValue
  return guandanRank('♠' + face, level)
}

function sortedKeys(counter: Map<number, number>): number[] {
  const keys: number[] = []
  counter.forEach((c: number, r: number) => {
    if (c > 0) keys.push(r)
  })
  return keys.sort((a: number, b: number) => a - b)
}

function maxCount(counter: Map<number, number>): number {
  let m = 0
  counter.forEach((c: number) => {
    if (c > m) m = c
  })
  return m
}

/**
 * 是否等差为 1 的连续序列（按**自然点数**判定）。
 * 王(20/21)不能出现在顺子/木板/钢板里。
 */
function isConsecutive(sorted: number[]): boolean {
  if (sorted.length < 2) return false
  if (sorted[sorted.length - 1] >= GD_JOKER_LOW) return false
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false
  }
  return true
}

/**
 * 是否 A2345（自然点数 13,1,2,3,4 恰好连续，A 当 1 用）。
 * ⚠️ 必须严格限定为「恰好这 5 个点数且首尾是 13 和 1」，
 * 否则 JQKA2（11,12,13,13? 不含 2…）这类会被误判。
 */
function isAceLow(sorted: number[]): boolean {
  return sorted.length === 5 &&
    sorted[0] === 1 &&
    sorted[1] === 2 &&
    sorted[2] === 3 &&
    sorted[3] === 4 &&
    sorted[4] === 13
}

/** 牌型的中文名，供 UI 提示用 */
export function guandanComboName(type: string): string {
  if (type === 'single') return '单张'
  if (type === 'pair') return '对子'
  if (type === 'trio') return '三同张'
  if (type === 'full_house') return '三带二'
  if (type === 'straight') return '顺子'
  if (type === 'tractor') return '木板'
  if (type === 'steel') return '钢板'
  if (type === 'wood') return '同花顺'
  if (type === 'bomb') return '炸弹'
  if (type === 'joker_storm') return '四大天王'
  return type
}

/**
 * combo 能否压过 last。
 *
 * 掼蛋牌力（一张总表，跨类型统一比较）：
 *   四大天王 > 8炸 > 7炸 > 6炸 > 同花顺 > 5炸 > 4炸 > 普通牌型
 *
 * ⚠️ 同花顺是个特殊档：它**只压 5 炸**（比 5 炸大、比 6 炸小），
 * 但**不能拿去压普通牌型** —— 想出同花顺只能主动出，或者用它压 5 炸。
 * 所以普通牌型「压不过同花顺」必须返回 false，不能只靠档位大小比较。
 */
export function guandanBeats(combo: GuandanCombo, last: GuandanCombo | null): boolean {
  // ⚠️ 必须用 == null 而非 === null：ArkTS 里 last 可能来自 @State 初始化的
  // undefined（自由出牌态），`undefined === null` 为 false 会一路穿到 isWood(last) 崩掉。
  if (last === undefined || last === null) return true

  const isWood = (c: GuandanCombo): boolean => c.type === 'wood'
  const isJokerStorm = (c: GuandanCombo): boolean => c.type === 'joker_storm'
  const isBomb = (c: GuandanCombo): boolean => c.bombLevel >= 4
  // 普通牌型：非炸弹、非同花顺、非四王
  const isPlain = (c: GuandanCombo): boolean => c.bombLevel === 0 && !isWood(c) && !isJokerStorm(c)

  // ⚠️ 同花顺的特殊限制：它只用来「压 5 炸」，不能拿去压任何普通牌型
  //（想出同花顺只能主动出，或者用它压 5 炸）。这条不能靠档位大小自动得出，
  //  必须显式拦，否则档位 55 > 10 会让它错误地压过单张/顺子。
  if (isWood(combo) && !isBomb(last)) return false
  if (isPlain(combo) && isWood(last)) return false

  // 档位：越大越强。四王最高，同花顺夹在 6 炸(60) 与 5 炸(50) 之间。
  const tier = (c: GuandanCombo): number => {
    if (isJokerStorm(c)) return 100
    if (c.bombLevel >= 6) return 60 + (c.bombLevel - 6)   // 6炸=60 7炸=61 8炸=62
    if (isWood(c)) return 55                               // 同花顺
    if (c.bombLevel >= 4) return 40 + (c.bombLevel - 4)   // 4炸=40 5炸=41
    return 10                                              // 普通牌型
  }

  const tc = tier(combo)
  const tl = tier(last)
  if (tc !== tl) return tc > tl

  // 同档比较
  if (isPlain(combo) || isPlain(last)) {
    // 普通牌型之间：类型与张数都一致才能比点数
    if (combo.type !== last.type || combo.size !== last.size) return false
  }
  return combo.rank > last.rank
}

// ===== 逢人配 =====

/**
 * 尝试用「逢人配」（红桃级牌）把这手牌补成合法牌型。
 *
 * 做法：把逢人配从手牌里取出，枚举它顶替的点数（2..A），
 * 逐个尝试能否构成合法牌型；能则返回该牌型。
 *
 * @param cards 待检出的牌
 * @param level 当前级牌点数（2..14）
 * @returns 能凑出的牌型；不能则 null
 */
export function guandanWithWilds(cards: string[], level: number): GuandanCombo | null {
  // 没有逢人配 → 直接判定
  if (!cards.some((c: string) => guandanIsWild(c, level))) {
    return analyzeGuandan(cards, level)
  }
  // 多张逢人配：优先保留 1 张做万能牌，其余按原牌面参与（简化策略）
  const wildIndex = cards.findIndex((c: string) => guandanIsWild(c, level))
  const wild = cards[wildIndex]
  const rest = cards.filter((_: string, i: number) => i !== wildIndex)
  const wildSuit = guandanSuit(wild)

  // 直接判定原手牌（万一本身合法）
  const direct = analyzeGuandan(cards, level)
  if (direct !== null) return direct

  // 枚举顶替的点数。用 ♠ 表示万能牌的花色（不影响点数判定）。
  for (let face = 0; face < GD_ORDER.length; face++) {
    // 不能顶替成王
    const trial: string[] = rest.concat(['♠' + GD_ORDER[face]])
    const combo = analyzeGuandan(trial, level)
    if (combo !== null) return combo
  }
  // 万能牌顶替成王不合法（王不能当逢人配的反面）
  return null
}

/**
 * 判断这手牌是否可以打出（合法且能压过上家）。
 * @param cards 选中的牌
 * @param level 当前级牌
 * @param last 上家的牌型（自由出牌时传 null）
 * @param wildMode 是否允许逢人配（一般只在出牌时允许）
 */
export function guandanCanPlay(cards: string[], level: number, last: GuandanCombo | null,
  wildMode: boolean): boolean {
  if (cards.length === 0) return false
  const combo = wildMode ? guandanWithWilds(cards, level) : analyzeGuandan(cards, level)
  if (combo === null) return false
  return guandanBeats(combo, last)
}

// ===== AI 选牌：枚举候选=====

/**
 * 从手牌里枚举所有「能压过 last」的出牌候选，供 AI 挑选。
 *
 * 枚举策略（按牌型分类构造，而不是全量子集搜索——2 副牌 27 张手牌做子集搜索会爆）：
 *   单张/对子/三张/三带二/炸弹：按 rank 分组直接取
 *   顺子/同花顺/木板/钢板：按自然点数找连续段
 *   四大天王：4张王
 *最后用 guandanBeats 过滤 + analyzeGuandan 兜底校验，保证每个候选都是真牌型。
 *
 * @param hand 手牌
 * @param level 当前级牌
 * @param last 上家牌型；null = 自由出牌
 * @return 候选牌数组数组，按「张数少 → 点数低」排序（AI 取第一个即最小合法应牌）
 */
export function guandanCandidatePlays(hand: string[], level: number,
  last: GuandanCombo | null): string[][] {
  const out: string[][] = []
  const seen: Set<string> = new Set<string>()
  const push = (cards: string[]): void => {
    if (cards.length === 0) return
    const key = guandanSortHand(cards, level).join(',')
    if (seen.has(key)) return
    const combo = guandanWithWilds(cards, level)
    if (combo === null) return
    if (!guandanBeats(combo, last)) return
    seen.add(key)
    out.push(cards)
  }

  // 按比较权重分组（级牌抬升后的 rank，同 rank 即同点数）
  const groups: Map<number, string[]> = new Map<number, string[]>()
  hand.forEach((card: string) => {
    const r = guandanRank(card, level)
    const bucket = groups.get(r)
    if (bucket === undefined) groups.set(r, [card])
    else bucket.push(card)
  })
  const ranks: number[] = []
  groups.forEach((_cards: string[], r: number) => ranks.push(r))
  ranks.sort((a: number, b: number) => a - b)

  // ---- 单张 / 对子 / 三张 / 炸弹（4~8 张） ----
  ranks.forEach((r: number) => {
    const g: string[] = groups.get(r) as string[]
    const upper = Math.min(8, g.length)
    for (let size = 1; size <= upper; size++) {
      push(g.slice(0, size))
    }
  })

  // ---- 三带二：三张 + 任意两张（点数可不同） ----
  ranks.forEach((r: number) => {
    const trio: string[] = (groups.get(r) as string[]).slice(0, 3)
    if (trio.length < 3) return
    const kickers: string[] = []
    hand.forEach((card: string) => {
      if (kickers.length < 2 && guandanRank(card, level) !== r) kickers.push(card)
    })
    if (kickers.length === 2) push(trio.concat(kickers))
  })

  // ---- 顺子 / 同花顺：自然点数连续 5 段，A 可当 1 或 14 ----
  // 26个起点太多，改为枚举所有「同点数组」长度 5 的窗口
  const windows: number[][] = []
  for (let start = 1; start + 4 <= 13; start++) {
    windows.push([start, start + 1, start + 2, start + 3, start + 4])
  }
  windows.push([1, 2, 3, 4, 13])  // A2345（A 当 1）
  windows.forEach((win: number[]) => {
    const suits: string[] = ['♠', '♥', '♣', '♦']
    // 杂花顺子
    const mixed: string[] = []
    let ok = true
    win.forEach((n: number) => {
      const c = pickByNatural(hand, n, level, '')
      if (c.length === 0) ok = false
      else mixed.push(c[0])
    })
    if (ok) push(mixed)
    // 同花顺（同花色各取一张）
    suits.forEach((suit: string) => {
      const flush: string[] = []
      win.forEach((n: number) => {
        const c = pickByNatural(hand, n, level, suit)
        if (c.length > 0) flush.push(c[0])
      })
      if (flush.length === win.length) push(flush)
    })
  })

  // ---- 木板（3 对连续）/ 钢板（2 组三张连续）：点数窗口 × 每点取 2/3 张 ----
  const runEnumerate = (runLen: number, per: number): void => {
    for (let start = 1; start + runLen - 1 <= 13; start++) {
      const seq: string[] = []
      let ok = true
      for (let k = 0; k < runLen; k++) {
        const c = pickByNatural(hand, start + k, level, '', per)
        if (c.length < per) {
          ok = false
          break
        }
        // ⚠️ 不能用 seq.push.apply(seq, ...)：ArkTS 禁止 Function.apply（arkts-no-func-apply-call）
        for (let j = 0; j < per; j++) seq.push(c[j])
      }
      if (ok) push(seq)
    }
    // A 当 1 的木板/钢板窗口（A 参与连续段）
    if (runLen === 2) {
      const c = pickByNatural(hand, 13, level, '', per).slice(0, per)
        .concat(pickByNatural(hand, 1, level, '', per).slice(0, per))
      if (c.length === per * 2) push(c)
    } else if (runLen === 3) {
      const c = pickByNatural(hand, 13, level, '', per).slice(0, per)
        .concat(pickByNatural(hand, 1, level, '', per).slice(0, per))
        .concat(pickByNatural(hand, 2, level, '', per).slice(0, per))
      if (c.length === per * 3) push(c)
    }
  }
  runEnumerate(3, 2)   // 木板
  runEnumerate(2, 3)   // 钢板

  // ---- 四大天王 ----
  const jokers: string[] = hand.filter((c: string) => guandanIsJoker(c))
  if (jokers.length === 4) push(jokers.slice(0, 4))

  // 排序：先按张数少（好走），同张数按比较权重低（浪费最小）
  out.sort((a: string[], b: string[]) => {
    if (a.length !== b.length) return a.length - b.length
    const ca = guandanWithWilds(a, level) as GuandanCombo
    const cb = guandanWithWilds(b, level) as GuandanCombo
    if (ca.rank !== cb.rank) return ca.rank - cb.rank
    return 0
  })
  return out
}

/** 从手牌里取自然点数为 n 的牌，可指定花色；limit 缺省取 1 */
function pickByNatural(hand: string[], n: number, level: number, suit: string,
  limit: number = 1): string[] {
  const found: string[] = []
  for (let i = 0; i < hand.length && found.length < (limit > 0 ? limit : 1); i++) {
    if (naturalRank(hand[i]) !== n) continue
    if (suit.length > 0 && guandanSuit(hand[i]) !== suit) continue
    found.push(hand[i])
  }
  return found
}
