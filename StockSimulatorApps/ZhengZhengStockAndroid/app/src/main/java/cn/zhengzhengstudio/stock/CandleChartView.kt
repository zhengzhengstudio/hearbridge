package cn.zhengzhengstudio.stock

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * K 线图自定义 View：蜡烛图 + 均线叠加 + 成交量副图 + 十字光标。
 *
 * 手写 Canvas 绘制，不引入任何第三方图表库（减小体积、避免依赖）。
 * 配色遵循中国市场惯例：涨红跌绿（A 股），与 stockColor() 保持一致。
 */
class CandleChartView(context: Context) : View(context) {

    private var candles: List<Indicators.Candle> = emptyList()
    private var ma5: List<Double?> = emptyList()
    private var ma20: List<Double?> = emptyList()
    private var bollUpper: List<Double?> = emptyList()
    private var bollLower: List<Double?> = emptyList()

    var upColor: Int = Color.rgb(215, 67, 76)
    var downColor: Int = Color.rgb(34, 164, 102)
    var gridColor: Int = Color.rgb(50, 59, 70)
    var textColor: Int = Color.rgb(159, 169, 181)
    var lineColor: Int = Color.rgb(120, 160, 220)
    var ma5Color: Int = Color.rgb(240, 190, 90)
    var ma20Color: Int = Color.rgb(140, 200, 240)
    var bollColor: Int = Color.rgb(90, 110, 130)

    private var showMA = true
    private var showBoll = false
    private var showVolume = true

    private val candlePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 24f
        color = textColor
    }
    private val gridPaint = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f
        color = gridColor
    }
    private val bollFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        alpha = 28
        color = bollColor
    }

    private val padLeft = 12f
    private val padRight = 8f
    private val padTop = 10f
    private val priceAxisW = 108f
    private var volumeH = 0f

    private var touchX = -1f
    private var activeIndex = -1

    /** 设置数据并绘制 */
    fun setData(list: List<Indicators.Candle>) {
        candles = list
        val snap = Indicators.snapshot(list)
        val closes = snap.closes
        ma5 = closes.indices.map { Indicators.movingAverage(closes.subList(0, it + 1), 5) }
        ma20 = closes.indices.map { Indicators.movingAverage(closes.subList(0, it + 1), 20) }
        bollUpper = closes.indices.map { Indicators.boll(closes.subList(0, it + 1))?.second }
        bollLower = closes.indices.map { Indicators.boll(closes.subList(0, it + 1))?.third }
        invalidate()
    }

    fun toggleMA() { showMA = !showMA; invalidate() }
    fun toggleBoll() { showBoll = !showBoll; invalidate() }
    fun toggleVolume() { showVolume = !showVolume; invalidate() }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (candles.isEmpty()) return
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= padLeft + padRight + priceAxisW || h <= padTop + 20) return

        volumeH = if (showVolume) min(90f, h * 0.24f) else 0f
        val chartBottom = h - volumeH - padTop - 16f
        val chartTop = padTop + 18f
        val chartLeft = padLeft
        val chartRight = w - padRight - priceAxisW
        val chartW = chartRight - chartLeft
        if (chartW <= 0 || chartBottom <= chartTop) return

        // 计算价格区间
        var hi = candles.maxOf { it.high }
        var lo = candles.minOf { it.low }
        if (showBoll) {
            bollUpper.filterNotNull().maxOrNull()?.let { hi = max(hi, it) }
            bollLower.filterNotNull().minOrNull()?.let { lo = min(lo, it) }
        }
        if (showMA) {
            ma5.filterNotNull().maxOrNull()?.let { hi = max(hi, it) }
            ma5.filterNotNull().minOrNull()?.let { lo = min(lo, it) }
            ma20.filterNotNull().maxOrNull()?.let { hi = max(hi, it) }
            ma20.filterNotNull().minOrNull()?.let { lo = min(lo, it) }
        }
        if (hi <= lo) hi = lo + 1.0
        val pad = (hi - lo) * 0.06
        hi += pad
        lo -= pad

        fun yOf(p: Double) = chartBottom - ((p - lo) / (hi - lo)).toFloat() * (chartBottom - chartTop)
        fun xOf(i: Int) = chartLeft + (i.toFloat() + 0.5f) / candles.size * chartW

        // 网格 + 价格刻度
        val rows = 4
        for (i in 0..rows) {
            val y = chartTop + (chartBottom - chartTop) * i / rows
            canvas.drawLine(chartLeft, y, chartRight, y, gridPaint)
            val price = hi - (hi - lo) * i / rows
            canvas.drawText(formatPrice(price), chartRight + 6f, y + 7f, textPaint)
        }

        val slot = chartW / candles.size
        val bodyW = max(1.5f, slot * 0.62f)

        // 布林带填充
        if (showBoll) {
            val path = Path()
            var started = false
            for (i in bollUpper.indices) {
                val v = bollUpper[i] ?: continue
                if (!started) { path.moveTo(xOf(i), yOf(v)); started = true } else path.lineTo(xOf(i), yOf(v))
            }
            for (i in bollLower.indices.reversed()) {
                val v = bollLower[i] ?: continue
                path.lineTo(xOf(i), yOf(v))
            }
            path.close()
            canvas.drawPath(path, bollFillPaint)
        }

        // 蜡烛
        for (i in candles.indices) {
            val c = candles[i]
            val x = xOf(i)
            val color = if (c.isUp) upColor else downColor
            candlePaint.color = color
            canvas.drawRect(x - 0.5f, yOf(c.high), x + 0.5f, yOf(c.low), candlePaint)
            val top = yOf(max(c.open, c.close))
            val bottom = yOf(min(c.open, c.close))
            val h = max(1.5f, bottom - top)
            if (c.body < 1e-9) {
                canvas.drawRect(x - bodyW / 2, top - 1f, x + bodyW / 2, top + 1f, candlePaint)
            } else {
                canvas.drawRect(x - bodyW / 2, top, x + bodyW / 2, top + h, candlePaint)
            }
        }

        // 均线与布林上下轨
        fun drawSeries(series: List<Double?>, color: Int) {
            linePaint.color = color
            val p = Path()
            var started = false
            for (i in series.indices) {
                val v = series[i] ?: continue
                val x = xOf(i); val y = yOf(v)
                if (!started) { p.moveTo(x, y); started = true } else p.lineTo(x, y)
            }
            canvas.drawPath(p, linePaint)
        }
        if (showBoll) { drawSeries(bollUpper, bollColor); drawSeries(bollLower, bollColor) }
        if (showMA) { drawSeries(ma5, ma5Color); drawSeries(ma20, ma20Color) }

        // 成交量副图
        if (showVolume) {
            val maxVol = max(1L, candles.maxOf { it.volume }).toFloat()
            val vTop = chartBottom + 16f
            val vBottom = h - padTop
            if (vBottom > vTop) {
                val bw = max(1f, slot * 0.5f)
                for (i in candles.indices) {
                    val c = candles[i]
                    val bh = (c.volume.toFloat() / maxVol) * (vBottom - vTop)
                    candlePaint.color = if (c.isUp) upColor else downColor
                    candlePaint.alpha = 150
                    canvas.drawRect(xOf(i) - bw / 2, vBottom - bh, xOf(i) + bw / 2, vBottom, candlePaint)
                    candlePaint.alpha = 255
                }
            }
        }

        // 十字光标与浮层
        if (activeIndex in candles.indices) {
            val x = xOf(activeIndex)
            candlePaint.color = gridColor
            canvas.drawRect(x, chartTop, x + 1f, chartBottom, candlePaint)
            val c = candles[activeIndex]
            drawTooltip(canvas, c, chartLeft, chartTop, chartW, w)
        }
    }

    private fun drawTooltip(canvas: Canvas, c: Indicators.Candle, left: Float, top: Float, cw: Float, w: Float) {
        val lines = listOf(
            "开 ${formatPrice(c.open)}",
            "高 ${formatPrice(c.high)}",
            "低 ${formatPrice(c.low)}",
            "收 ${formatPrice(c.close)}",
            "量 ${c.volume}"
        )
        val lh = 26f
        val boxH = lh * lines.size + 16f
        val boxW = 190f
        val bx = left + 6f
        val by = top + 4f
        candlePaint.color = (0xCC000000.toInt())
        canvas.drawRoundRect(RectF(bx, by, bx + boxW, by + boxH), 8f, 8f, candlePaint)
        textPaint.color = Color.WHITE
        lines.forEachIndexed { i, s ->
            canvas.drawText(s, bx + 12f, by + 24f + i * lh, textPaint)
        }
        textPaint.color = textColor
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (candles.isEmpty()) return true
        when (event.action) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                val chartRight = width - padRight - priceAxisW
                val ratio = ((event.x - padLeft) / (chartRight - padLeft)).toDouble()
                activeIndex = (ratio * candles.size).toInt().coerceIn(0, candles.size - 1)
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                activeIndex = -1
                invalidate()
            }
        }
        return true
    }

    private fun formatPrice(v: Double): String =
        if (abs(v) >= 1000) "%.0f".format(v) else "%.2f".format(v)
}
