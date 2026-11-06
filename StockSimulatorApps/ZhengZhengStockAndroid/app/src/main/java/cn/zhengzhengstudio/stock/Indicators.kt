package cn.zhengzhengstudio.stock

/**
 * 技术分析与玩法引擎（跨端共用逻辑的 Android 实现）。
 *
 * 现状缺口：此前 App 只有「实时报价 + 模拟买卖」，没有历史序列，
 * 因此无法画 K 线、算均线/指标、做回测。这里补齐这条链路：
 *   历史价格序列 → 技术指标 → K 线渲染数据 → 交易记录 → 策略回测
 *
 * 合规：所有指标仅为数学计算结果的教学演示，**不构成投资建议**。
 */
object Indicators {

    /** 单根 K 线 */
    data class Candle(
        val time: Long,
        val open: Double,
        val high: Double,
        val low: Double,
        val close: Double,
        val volume: Long
    ) {
        val range: Double get() = high - low
        val body: Double get() = Math.abs(close - open)
        val isUp: Boolean get() = close >= open
        /** 上下影线占比，用于渲染 */
        val upperShadow: Double get() = if (range <= 0) 0.0 else (high - maxOf(open, close)) / range
        val lowerShadow: Double get() = if (range <= 0) 0.0 else (minOf(open, close) - low) / range
    }

    /** 一组指标快照 */
    data class Snapshot(
        val closes: List<Double>,
        val ma5: Double?,
        val ma10: Double?,
        val ma20: Double?,
        val ma60: Double?,
        val rsi14: Double?,
        val macd: Double?,
        val macdSignal: Double?,
        val macdHist: Double?,
        val kdjK: Double?,
        val kdjD: Double?,
        val kdjJ: Double?,
        val bollMid: Double?,
        val bollUpper: Double?,
        val bollLower: Double?,
        val bollWidth: Double?,
        val volatility: Double,
        val trend: String
    ) {
        val hasMa: Boolean get() = ma20 != null
        /** 布林带开口度，衡量波动收敛/扩张 */
        val isSqueeze: Boolean get() = bollWidth != null && bollWidth < 0.06
        val macdGoldenCross: Boolean get() = macdHist != null && macdHist > 0
    }

    private fun sma(values: List<Double>, period: Int): Double? {
        if (values.size < period) return null
        return values.takeLast(period).average()
    }

    /** 简单移动平均 */
    fun movingAverage(values: List<Double>, period: Int): Double? = sma(values, period)

    /** 指数移动平均，用于 MACD */
    fun ema(values: List<Double>, period: Int): List<Double> {
        if (values.isEmpty()) return emptyList()
        val k = 2.0 / (period + 1)
        val out = ArrayList<Double>(values.size)
        var prev = values[0]
        for (v in values) {
            prev = v * k + prev * (1 - k)
            out.add(prev)
        }
        return out
    }

    /** RSI 相对强弱指标（Wilder 平滑） */
    fun rsi(closes: List<Double>, period: Int = 14): Double? {
        if (closes.size <= period) return null
        var gain = 0.0
        var loss = 0.0
        for (i in 1..period) {
            val d = closes[i] - closes[i - 1]
            if (d >= 0) gain += d else loss -= d
        }
        var avgGain = gain / period
        var avgLoss = loss / period
        for (i in period + 1 until closes.size) {
            val d = closes[i] - closes[i - 1]
            avgGain = (avgGain * (period - 1) + maxOf(d, 0.0)) / period
            avgLoss = (avgLoss * (period - 1) + maxOf(-d, 0.0)) / period
        }
        if (avgLoss <= 1e-9) return 100.0
        val rs = avgGain / avgLoss
        return 100 - 100 / (1 + rs)
    }

    /** MACD：快慢线差 + 信号线 + 柱状值 */
    fun macd(closes: List<Double>, fast: Int = 12, slow: Int = 26, signal: Int = 9): Triple<Double, Double, Double>? {
        if (closes.size < slow) return null
        val emaFast = ema(closes, fast)
        val emaSlow = ema(closes, slow)
        val diff = emaFast.indices.map { emaFast[it] - emaSlow[it] }
        val signalLine = ema(diff, signal)
        val lastDiff = diff.last()
        val lastSignal = signalLine.last()
        return Triple(lastDiff, lastSignal, lastDiff - lastSignal)
    }

    /** KDJ 随机指标 */
    fun kdj(candles: List<Candle>, period: Int = 9): Triple<Double, Double, Double>? {
        if (candles.size < period) return null
        var k = 50.0
        var d = 50.0
        for (i in period..candles.size) {
            val slice = candles.subList(i - period, i)
            val hh = slice.maxOf { it.high }
            val ll = slice.minOf { it.low }
            val rsv = if (hh - ll <= 1e-9) 50.0 else (candles[i - 1].close - ll) / (hh - ll) * 100
            k = (2 * k + rsv) / 3
            d = (2 * d + k) / 3
        }
        return Triple(k, d, 3 * k - 2 * d)
    }

    /** 布林带 */
    fun boll(closes: List<Double>, period: Int = 20, mult: Double = 2.0): Triple<Double, Double, Double>? {
        val mid = sma(closes, period) ?: return null
        val win = closes.takeLast(period)
        val variance = win.sumOf { (it - mid) * (it - mid) } / period
        val sd = kotlin.math.sqrt(variance)
        val upper = mid + mult * sd
        val lower = mid - mult * sd
        return Triple(mid, upper, lower)
    }

    /** 年化波动率（%），教学演示用 */
    fun volatility(closes: List<Double>, period: Int = 20): Double {
        if (closes.size < 3) return 0.0
        val win = closes.takeLast(minOf(period, closes.size))
        val rets = (1 until win.size).map { (win[it] - win[it - 1]) / maxOf(win[it - 1], 1e-9) }
        if (rets.isEmpty()) return 0.0
        val mean = rets.average()
        val sd = kotlin.math.sqrt(rets.sumOf { (it - mean) * (it - mean) } / rets.size)
        return sd * kotlin.math.sqrt(252.0) * 100
    }

    /** 综合计算一整套指标 */
    fun snapshot(candles: List<Candle>): Snapshot {
        val closes = candles.map { it.close }
        val macdTriple = macd(closes)
        val kdjTriple = kdj(candles)
        val bollTriple = boll(closes)
        val bollWidth = bollTriple?.let { (mid, up, _) ->
            if (mid <= 1e-9) null else (up - bollTriple.second) / mid
        }
        // 趋势判定：均线多头排列 / 空头排列 / 震荡
        val ma5 = sma(closes, 5)
        val ma10 = sma(closes, 10)
        val ma20 = sma(closes, 20)
        val ma60 = sma(closes, 60)
        val trend = when {
            ma5 != null && ma20 != null && ma60 != null && ma5 > ma20 && ma20 > ma60 -> "多头排列"
            ma5 != null && ma20 != null && ma60 != null && ma5 < ma20 && ma20 < ma60 -> "空头排列"
            else -> "震荡整理"
        }
        return Snapshot(
            closes = closes,
            ma5 = ma5, ma10 = ma10, ma20 = ma20, ma60 = ma60,
            rsi14 = rsi(closes),
            macd = macdTriple?.first,
            macdSignal = macdTriple?.second,
            macdHist = macdTriple?.third,
            kdjK = kdjTriple?.first, kdjD = kdjTriple?.second, kdjJ = kdjTriple?.third,
            bollMid = bollTriple?.first, bollUpper = bollTriple?.second, bollLower = bollTriple?.third,
            bollWidth = bollWidth,
            volatility = volatility(closes),
            trend = trend
        )
    }

    /** 按周期聚合 K 线 */
    fun aggregate(candles: List<Candle>, bucketMinutes: Int): List<Candle> {
        if (candles.isEmpty()) return emptyList()
        val bucketMs = bucketMinutes * 60_000L
        val groups = LinkedHashMap<Long, MutableList<Candle>>()
        for (c in candles) {
            val key = c.time / bucketMs * bucketMs
            groups.getOrPut(key) { mutableListOf() }.add(c)
        }
        return groups.values.map { list ->
            Candle(
                time = list.first().time,
                open = list.first().open,
                high = list.maxOf { it.high },
                low = list.minOf { it.low },
                close = list.last().close,
                volume = list.sumOf { it.volume }
            )
        }
    }
}
