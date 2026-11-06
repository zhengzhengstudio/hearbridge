package cn.zhengzhengstudio.stock

/**
 * 历史序列生成与策略回测（玩法引擎第二部分）。
 *
 * 此前 App 没有历史数据，所以「回测」无从谈起。这里用可复现的
 * 几何布朗运动式随机游走**向前生成**一段历史（种子固定，同一只股票
 * 每次打开走势一致，便于练习与比较不同策略）。
 *
 * 合规：回测结果基于虚构历史数据，仅用于教学演示策略逻辑，
 * **不代表任何真实历史行情，也不构成投资建议**。
 */
object Backtest {

    /** 成交记录 */
    data class TradeRecord(
        val time: Long,
        val code: String,
        val name: String,
        val side: String,      // "buy" / "sell"
        val price: Double,
        val quantity: Int,
        val amount: Double,
        val pnl: Double = 0.0, // 仅卖出时结算
        val reason: String = "" // 触发原因，便于复盘
    ) {
        val isBuy: Boolean get() = side == "buy"
    }

    /** 回测结果 */
    data class Result(
        val strategyName: String,
        val initialCash: Double,
        val finalCash: Double,
        val trades: List<TradeRecord>,
        val equityCurve: List<Double>,
        val maxDrawdown: Double,   // 百分比
        val winRate: Double,       // 百分比
        val benchmarkReturn: Double // 同期买入持有收益
    ) {
        val totalReturn: Double get() = if (initialCash <= 0) 0.0 else (finalCash - initialCash) / initialCash * 100
        val tradeCount: Int get() = trades.size
        val profitFactor: Double get() {
            val win = trades.filter { it.pnl > 0 }.sumOf { it.pnl }
            val loss = kotlin.math.abs(trades.filter { it.pnl < 0 }.sumOf { it.pnl })
            return if (loss <= 1e-9) (if (win > 0) 99.0 else 0.0) else win / loss
        }
    }

    /** 策略参数与判定 */
    data class Strategy(
        val name: String,
        val fast: Int = 5,
        val slow: Int = 20,
        val rsiBuyBelow: Double = 35.0,
        val rsiSellAbove: Double = 68.0,
        val stopLossPct: Double = 4.0,
        val takeProfitPct: Double = 8.0,
        val maxPositionPct: Double = 60.0
    )

    /**
     * 可复现的伪随机数（LCG），保证同一 seed 生成同一段历史。
     */
    private class Lcg(seed: Long) {
        private var state = if (seed == 0L) 88172645463325252L else seed
        fun nextDouble(): Double {
            state = (state * 6364136223846793005L + 1442695040888963407L)
            val v = (state ushr 33).toInt().toLong() and 0x7FFFFFFF
            return v.toDouble() / 0x7FFFFFFF
        }
        fun nextGaussian(): Double {
            // Box-Muller
            val u1 = nextDouble().coerceAtLeast(1e-12)
            val u2 = nextDouble()
            return kotlin.math.sqrt(-2.0 * kotlin.math.ln(u1)) * kotlin.math.cos(2 * Math.PI * u2)
        }
    }

    /**
     * 为某只股票生成历史 K 线。
     * @param count 根数
     * @param intervalMinutes 每根间隔
     * @param endTime 结束时间戳
     */
    fun generateHistory(
        seed: Long,
        basePrice: Double,
        count: Int = 240,
        intervalMinutes: Int = 30,
        endTime: Long = System.currentTimeMillis()
    ): List<Indicators.Candle> {
        if (count <= 0 || basePrice <= 0) return emptyList()
        val rng = Lcg(seed)
        val out = ArrayList<Indicators.Candle>(count)
        val stepMs = intervalMinutes * 60_000L
        var price = basePrice
        // 先正向走完，再整体平移到以 basePrice 收尾，保证起点量级合理
        for (i in 0 until count) {
            val drift = 0.00012
            val vol = 0.011
            val shock = rng.nextGaussian() * vol
            val open = price
            val close = (open * (1 + drift + shock)).coerceAtLeast(0.01)
            val high = maxOf(open, close) * (1 + kotlin.math.abs(rng.nextGaussian()) * vol * 0.55)
            val low = minOf(open, close) * (1 - kotlin.math.abs(rng.nextGaussian()) * vol * 0.55)
            val volume = (2_000 + kotlin.math.abs(rng.nextGaussian()) * 18_000).toLong() + 1
            out.add(
                Indicators.Candle(
                    time = endTime - (count - 1 - i) * stepMs,
                    open = open, high = high, low = low.coerceAtLeast(0.01), close = close, volume = volume
                )
            )
            price = close
        }
        // 按目标基准价整体缩放，使最后一根收在 basePrice 附近
        val scale = basePrice / out.last().close
        return out.map { c ->
            c.copy(
                open = c.open * scale,
                high = c.high * scale,
                low = c.low * scale,
                close = c.close * scale
            )
        }
    }

    /**
     * 双均线 + RSI 的组合策略回测。
     */
    fun run(
        strategy: Strategy,
        candles: List<Indicators.Candle>,
        code: String,
        name: String,
        initialCash: Double = 100_000.0
    ): Result {
        val records = mutableListOf<TradeRecord>()
        if (candles.size < strategy.slow + 2) {
            return Result(strategy.name, initialCash, initialCash, records, listOf(initialCash), 0.0, 0.0, 0.0)
        }

        var cash = initialCash
        var qty = 0
        var entryPrice = 0.0
        val equity = mutableListOf<Double>()
        var peak = initialCash
        var maxDd = 0.0

        for (i in strategy.slow until candles.size) {
            val window = candles.subList(0, i + 1)
            val closes = window.map { it.close }
            val fastMa = Indicators.movingAverage(closes, strategy.fast)
            val slowMa = Indicators.movingAverage(closes, strategy.slow)
            val rsi = Indicators.rsi(closes)
            val candle = candles[i]
            val equityNow = cash + qty * candle.close
            equity.add(equityNow)
            peak = maxOf(peak, equityNow)
            if (peak > 0) maxDd = maxOf(maxDd, (peak - equityNow) / peak * 100)

            if (fastMa != null && slowMa != null) {
                val golden = previousCross(window, strategy) == false && fastMa > slowMa
                val dead = previousCross(window, strategy) == true && fastMa < slowMa

                // 买入：金叉 或 RSI 超卖
                val wantBuy = (golden || (rsi != null && rsi < strategy.rsiBuyBelow)) && qty == 0
                if (wantBuy) {
                    val spendable = cash * (strategy.maxPositionPct / 100.0)
                    val shares = (spendable / candle.close).toInt() / 100 * 100
                    if (shares > 0) {
                        val amount = shares * candle.close
                        cash -= amount
                        qty += shares
                        entryPrice = candle.close
                        records.add(TradeRecord(candle.time, code, name, "buy", candle.close, shares, amount, 0.0, "金叉/RSI超卖"))
                    }
                }

                // 卖出：死叉 / RSI 超买 / 止损 / 止盈
                val changePct = if (entryPrice > 0) (candle.close - entryPrice) / entryPrice * 100 else 0.0
                val stopHit = qty > 0 && changePct <= -strategy.stopLossPct
                val targetHit = qty > 0 && changePct >= strategy.takeProfitPct
                val overbought = qty > 0 && rsi != null && rsi > strategy.rsiSellAbove
                val wantSell = qty > 0 && (dead || overbought || stopHit || targetHit)
                if (wantSell) {
                    val amount = qty * candle.close
                    val pnl = (candle.close - entryPrice) * qty
                    cash += amount
                    records.add(
                        TradeRecord(
                            candle.time, code, name, "sell", candle.close, qty, amount, pnl,
                            when {
                                stopHit -> "止损"
                                targetHit -> "止盈"
                                overbought -> "RSI超买"
                                else -> "死叉"
                            }
                        )
                    )
                    qty = 0
                    entryPrice = 0.0
                }
            }
        }

        // 收尾：按最后价格清算剩余持仓
        if (qty > 0 && candles.isNotEmpty()) {
            val last = candles.last()
            val amount = qty * last.close
            val pnl = (last.close - entryPrice) * qty
            cash += amount
            records.add(TradeRecord(last.time, code, name, "sell", last.close, qty, amount, pnl, "回测结束清算"))
        }

        val wins = records.count { it.pnl > 0 }
        val closed = records.count { !it.isBuy }
        val benchmark = if (candles.isNotEmpty() && candles.first().close > 0) {
            (candles.last().close - candles.first().close) / candles.first().close * 100
        } else 0.0

        return Result(
            strategyName = strategy.name,
            initialCash = initialCash,
            finalCash = cash,
            trades = records,
            equityCurve = equity,
            maxDrawdown = maxDd,
            winRate = if (closed == 0) 0.0 else wins.toDouble() / closed * 100,
            benchmarkReturn = benchmark
        )
    }

    /** 判断在最后一根之前是否刚发生交叉 */
    private fun previousCross(candles: List<Indicators.Candle>, strategy: Strategy): Boolean? {
        if (candles.size < strategy.slow + 1) return null
        val prevCloses = candles.subList(0, candles.size - 1).map { it.close }
        val f = Indicators.movingAverage(prevCloses, strategy.fast) ?: return null
        val s = Indicators.movingAverage(prevCloses, strategy.slow) ?: return null
        return f > s
    }

    /** 内置策略库 */
    val LIBRARY = listOf(
        Strategy(name = "稳健双均线 5/20", fast = 5, slow = 20, rsiBuyBelow = 40.0, rsiSellAbove = 65.0),
        Strategy(name = "灵敏双均线 3/10", fast = 3, slow = 10, rsiBuyBelow = 42.0, rsiSellAbove = 62.0),
        Strategy(name = "长线双均线 10/60", fast = 10, slow = 60, rsiBuyBelow = 38.0, rsiSellAbove = 72.0),
        Strategy(name = "严格风控 5/20", fast = 5, slow = 20, rsiBuyBelow = 30.0, rsiSellAbove = 70.0,
            stopLossPct = 2.5, takeProfitPct = 5.0, maxPositionPct = 40.0)
    )
}
