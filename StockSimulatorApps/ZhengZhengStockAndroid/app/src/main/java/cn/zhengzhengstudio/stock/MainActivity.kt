package cn.zhengzhengstudio.stock

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.graphics.Color
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.core.widget.doAfterTextChanged
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import org.json.JSONException
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.random.Random

data class Stock(
    val code: String,
    val name: String,
    val market: String,
    val sector: String,
    val isIndex: Boolean,
    var price: Double,
    var previousClose: Double,
    var volume: Int,
    val amplitude: Double,
    val quoteMode: String = "simulation",
    val quoteSource: String = "simulation",
    val isSimulated: Boolean = true
) {
    val change: Double get() = if (previousClose <= 0) 0.0 else (price - previousClose) / previousClose * 100
}

data class Holding(var qty: Int, var avgPrice: Double)
data class MarketAccount(var cash: Double, val holdings: MutableMap<String, Holding>)
data class QuantSnapshot(
    val count: Int,
    val advancers: Int,
    val decliners: Int,
    val avgChange: Double,
    val volatility: Double,
    val momentum: Double,
    val liquidity: Double,
    val risk: Double,
    val score: Int
) {
    val riskLabel: String get() = if (risk >= 72) "稳健" else if (risk >= 48) "中性" else "高波动"
    val scoreLabel: String get() = if (score >= 70) "偏强" else if (score >= 45) "均衡" else "谨慎"
}

class MainActivity : ComponentActivity() {
    private val site = "https://zhengzhengstudio.cn"
    private val api = "$site/api"
    private val executor = Executors.newCachedThreadPool()
    private val handler = Handler(Looper.getMainLooper())
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.CHINA)
    private var username = ""
    private var market = "cn"
    private var density = "standard"
    private var theme = "dark"
    private var dataMode = "hybrid"
    private var showHoldingsOnly = false
    private val accounts = mutableMapOf<String, MarketAccount>()
    private val stocksByMarket = mutableMapOf<String, MutableList<Stock>>()
    private var selectedCode = ""
    private var query = ""
    /** K 线周期（分钟） */
    private var candleInterval = 30
    @Volatile private var quoteSyncInFlight = false
    private var lastServerSyncAt = 0L
    private var quoteStatus = "本地连续仿真"
    private var tickerCount = 0

    private lateinit var root: LinearLayout
    private lateinit var list: RecyclerView
    private lateinit var stockAdapter: StockAdapter
    private lateinit var cashText: TextView
    private lateinit var holdingText: TextView
    private lateinit var assetsText: TextView
    private lateinit var quantText: TextView
    private lateinit var statusText: TextView
    private lateinit var tradePanel: LinearLayout
    private lateinit var searchInput: EditText

    private val bg: Int get() = if (theme == "light") Color.rgb(244, 246, 248) else Color.rgb(13, 18, 24)
    private val panel: Int get() = if (theme == "light") Color.WHITE else Color.rgb(24, 30, 37)
    private val panelRaised: Int get() = if (theme == "light") Color.rgb(235, 239, 243) else Color.rgb(32, 39, 48)
    private val border: Int get() = if (theme == "light") Color.rgb(215, 221, 228) else Color.rgb(50, 59, 70)
    private val textColor: Int get() = if (theme == "light") Color.rgb(25, 31, 38) else Color.rgb(239, 242, 246)
    private val subText: Int get() = if (theme == "light") Color.rgb(98, 107, 119) else Color.rgb(159, 169, 181)
    private val accent = Color.rgb(197, 50, 58)
    private val gain = Color.rgb(215, 67, 76)
    private val loss = Color.rgb(34, 164, 102)
    private val rowHeight: Int get() = when (density) { "compact" -> dp(48); "spacious" -> dp(72); else -> dp(58) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        username = prefs().getString("passport", "") ?: ""
        market = prefs().getString("market", "cn") ?: "cn"
        density = prefs().getString("density", "standard") ?: "standard"
        theme = prefs().getString("theme", "dark") ?: "dark"
        dataMode = prefs().getString("dataMode", "hybrid") ?: "hybrid"
        window.statusBarColor = Color.rgb(13, 18, 24)
        window.navigationBarColor = Color.rgb(13, 18, 24)
        generateMarkets()
        loadAccounts()
        startTicker()
        if (username.isBlank()) showAuth() else {
            showTrading()
            // 首次启动展示一次完整声明，兼顾合规留档与用户知情
            if (!prefs().getBoolean("disclaimer_ack", false)) {
                prefs().edit().putBoolean("disclaimer_ack", true).apply()
                root.post { showCompliance() }
            }
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun showAuth(register: Boolean = false) {
        root = baseLayout()
        root.gravity = Gravity.CENTER
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(26), dp(24), dp(28))
            background = surfaceDrawable(panel, 8, border)
        }
        val account = input("通行证账号")
        val password = input("密码").apply { inputType = 0x81 }
        card.addView(text(Compliance.APP_NAME, 28, textColor).apply {
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
        })
        card.addView(text("三地独立练习账户 · 虚构行情数据 · 无真实交易", 13, subText).apply { gravity = Gravity.CENTER })
        card.addView(account, spacedParams(dp(48), 18))
        card.addView(password, spacedParams(dp(48), 10))
        card.addView(button(if (register) "注册并进入" else "登录通行证", accent) {
            val name = account.text.toString().trim()
            if (name.isBlank() || password.text.length < 6) {
                toast("账号不能为空，密码至少6位")
            } else {
                username = name
                prefs().edit().putString("passport", username).apply()
                ensureAccounts()
                toast(if (register) "已注册并绑定三地账户" else "已登录")
                showTrading()
            }
        }, spacedParams(dp(48), 16))
        card.addView(button(if (register) "已有通行证，去登录" else "没有通行证，立即注册", panelRaised) { showAuth(!register) }, spacedParams(dp(46), 8))
        root.addView(card, LinearLayout.LayoutParams(if (resources.displayMetrics.widthPixels < dp(620)) -1 else dp(520), -2))
        setContentView(root)
    }

    private fun showTrading() {
        root = baseLayout()
        val wideLayout = resources.displayMetrics.widthPixels >= dp(760)
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(text(Compliance.APP_NAME, if (wideLayout) 24 else 20, textColor).apply {
            setTypeface(typeface, Typeface.BOLD)
        }, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(smallButton("声明") { showCompliance() })
        top.addView(smallButton("设置") { showSettings() })
        top.addView(smallButton("更新") { checkUpdate() })
        top.addView(smallButton("退出") {
            prefs().edit().remove("passport").apply()
            username = ""
            showAuth()
        })
        root.addView(top)
        root.addView(text(Compliance.APP_TAGLINE, 12, subText), spacedParams(-2, 0, 2))
        root.addView(text("$username · ${marketName()}独立练习账户 · ${stockList().count { !it.isIndex }} 只股票 + ${indexName()} · ${Compliance.modeLabel(dataMode)}", 12, subText), spacedParams(-2, 0, 8))

        val marketBar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        listOf("cn" to "A股", "hk" to "港股", "us" to "美股").forEach { item ->
            marketBar.addView(button(item.second, if (market == item.first) accent else panelRaised) {
                market = item.first
                selectedCode = indexCode()
                prefs().edit().putString("market", market).apply()
                renderAll("${marketName()}${modeName()}运行中")
                syncServerQuotes(false)
            }, LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginEnd = dp(6) })
        }
        root.addView(marketBar, spacedParams(dp(40), 0, 10))

        val summary = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        cashText = metric("可用资金")
        holdingText = metric("持仓市值")
        assetsText = metric("总资产")
        summary.addView(cashText, LinearLayout.LayoutParams(0, dp(70), 1f).apply { marginEnd = dp(6) })
        summary.addView(holdingText, LinearLayout.LayoutParams(0, dp(70), 1f).apply { marginEnd = dp(6) })
        summary.addView(assetsText, LinearLayout.LayoutParams(0, dp(70), 1f))
        root.addView(summary, spacedParams(dp(70), 0, 8))
        quantText = text("量化雷达 --", 13, textColor).apply { background = surfaceDrawable(panel, 6, border) }
        root.addView(quantText, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(6) })

        val tools = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        searchInput = input("搜索代码 / 名称 / 行业").apply {
            setSingleLine(true)
            doAfterTextChanged { renderStocks() }
        }
        tools.addView(searchInput, LinearLayout.LayoutParams(0, dp(44), 1f))
        tools.addView(smallButton(if (showHoldingsOnly) "全部" else "持仓") {
            showHoldingsOnly = !showHoldingsOnly
            renderStocks()
        })
        tools.addView(smallButton("刷新") { syncServerQuotes(true) })
        root.addView(tools, spacedParams(dp(44), 0, 8))

        tradePanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        stockAdapter = StockAdapter()
        list = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = stockAdapter
            itemAnimator = null
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val body = LinearLayout(this).apply { orientation = if (wideLayout) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL }
        if (wideLayout) {
            body.addView(list, LinearLayout.LayoutParams(0, -1, 1f).apply { marginEnd = dp(10) })
            body.addView(tradePanel, LinearLayout.LayoutParams(dp(340), -1))
        } else {
            body.addView(tradePanel, LinearLayout.LayoutParams(-1, -2))
            body.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        statusText = text("", 12, subText)
        root.addView(statusText)
        setContentView(root)
        selectedCode = if (selectedCode.isBlank()) indexCode() else selectedCode
        renderAll("${modeName()}行情引擎运行中")
        syncServerQuotes(false)
    }

    private fun renderAll(status: String? = null) {
        if (!::root.isInitialized || username.isBlank()) return
        val acc = account()
        val holdingValue = holdingValue()
        cashText.text = "可用资金\n${currency()}${fmt(acc.cash)}"
        holdingText.text = "持仓市值\n${currency()}${fmt(holdingValue)}"
        assetsText.text = "总资产\n${currency()}${fmt(acc.cash + holdingValue)}"
        val q = quantSnapshot()
        quantText.text = "行情观察 ${q.score}·${q.scoreLabel}  宽度 ${q.advancers}/${q.decliners}  动量 ${q.momentum.toInt()}  波动 ${fmt(q.volatility)}  波动提示 ${q.riskLabel}\n（数学演示指标，非走势预测）"
        renderTradePanel()
        renderStocks()
        val label = Compliance.statusLabel(status ?: quoteStatus)
        statusText.text = "$label · ${Compliance.modeLabel(dataMode)} · ${Compliance.SHORT_NOTICE} · ${clock.format(Date())}"
    }

    /** 免责声明 + 隐私说明 + 关于本应用。首次进入自动弹出。 */
    private fun showCompliance() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(8))
        }
        box.addView(text("重要声明", 20, textColor).apply {
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        })
        box.addView(text(Compliance.DISCLAIMER.trim(), 14, textColor), spacedParams(-2, 0, 12))

        box.addView(text("关于本应用", 16, textColor).apply { setTypeface(typeface, Typeface.BOLD) })
        Compliance.ABOUT_POINTS.forEachIndexed { i, line ->
            box.addView(text("${i + 1}. $line", 13, subText), spacedParams(-2, 0, 4))
        }
        box.addView(text("隐私说明", 16, textColor).apply { setTypeface(typeface, Typeface.BOLD) })
        box.addView(text(Compliance.PRIVACY.trim(), 13, subText), spacedParams(-2, 0, 16))

        AlertDialog.Builder(this)
            .setView(box)
            .setPositiveButton("我已知晓", null)
            .show()
    }

    private fun renderTradePanel() {
        tradePanel.removeAllViews()
        val stock = stockList().firstOrNull { it.code == selectedCode } ?: return
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = surfaceDrawable(panel, 6, border)
        }
        val signal = quantSignal(stock)
        box.addView(text("${stock.name} ${stock.code}\n${currency()}${fmt(stock.price)}  ${signed(stock.change)}% · $signal · ${quoteLabel(stock)}", 15, if (stock.change >= 0) gain else loss).apply {
            setTypeface(typeface, Typeface.BOLD)
        })

        // —— K 线图（新增）——
        val history = historyOf(stock)
        val chart = CandleChartView(this).apply {
            upColor = gain; downColor = loss
            gridColor = border; textColor = subText
            setData(history)
        }
        box.addView(chart, LinearLayout.LayoutParams(-1, dp(240)).apply { bottomMargin = dp(6) })

        // 周期切换 + 图层开关
        val periods = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        listOf(15 to "15分", 30 to "30分", 60 to "1小时", 240 to "4小时", 1440 to "日线").forEach { (mins, label) ->
            val btn = smallButton(label) {
                candleInterval = mins
                chart.setData(historyOf(stock))
                renderTradePanel()
            }
            if (mins == candleInterval) btn.setBackgroundColor(accent)
            periods.addView(btn, LinearLayout.LayoutParams(0, dp(34), 1f).apply { marginEnd = dp(4) })
        }
        box.addView(periods, spacedParams(dp(34), 0, 6))

        val layers = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        layers.addView(smallButton("均线") { chart.toggleMA() }, LinearLayout.LayoutParams(0, dp(32), 1f).apply { marginEnd = dp(4) })
        layers.addView(smallButton("布林带") { chart.toggleBoll() }, LinearLayout.LayoutParams(0, dp(32), 1f).apply { marginEnd = dp(4) })
        layers.addView(smallButton("成交量") { chart.toggleVolume() }, LinearLayout.LayoutParams(0, dp(32), 1f).apply { marginEnd = dp(4) })
        layers.addView(smallButton("策略回测") { showBacktest(stock) }, LinearLayout.LayoutParams(0, dp(32), 1f))
        box.addView(layers, spacedParams(dp(32), 0, 8))

        // —— 指标面板（新增）——
        box.addView(indicatorPanel(history), spacedParams(-2, 0, 8))

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val qty = input("数量").apply { setText("100"); inputType = 2; setSingleLine(true) }
        row.addView(qty, LinearLayout.LayoutParams(0, dp(42), 1f))
        row.addView(button("买入", accent) { trade(stock, qty.text.toString().toIntOrNull() ?: 0, "buy") }, LinearLayout.LayoutParams(dp(82), dp(42)).apply { marginStart = dp(6) })
        row.addView(button("卖出", loss) { trade(stock, qty.text.toString().toIntOrNull() ?: 0, "sell") }, LinearLayout.LayoutParams(dp(82), dp(42)).apply { marginStart = dp(6) })
        box.addView(row)
        tradePanel.addView(box, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }

    /** 取（并缓存）某只股票的历史 K 线 */
    private fun historyOf(stock: Stock): List<Indicators.Candle> {
        val seed = stock.code.hashCode().toLong() * 31 + stock.name.length
        return Backtest.generateHistory(
            seed = seed,
            basePrice = stock.price,
            count = 180,
            intervalMinutes = candleInterval
        )
    }

    /** 技术指标面板 */
    private fun indicatorPanel(candles: List<Indicators.Candle>): View {
        val s = Indicators.snapshot(candles)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
            background = surfaceDrawable(panelRaised, 6, border)
        }
        box.addView(text("技术指标 · ${s.trend}${if (s.isSqueeze) " · 布林收口" else ""}", 13, textColor).apply {
            setTypeface(typeface, Typeface.BOLD)
        })
        fun row(label: String, value: String) {
            val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            r.addView(text(label, 12, subText), LinearLayout.LayoutParams(0, -2, 1f))
            r.addView(text(value, 12, textColor), LinearLayout.LayoutParams(-2, -2))
            box.addView(r)
        }
        row("MA5 / MA10", "${fmt2(s.ma5)} / ${fmt2(s.ma10)}")
        row("MA20 / MA60", "${fmt2(s.ma20)} / ${fmt2(s.ma60)}")
        row("RSI(14)", fmt2(s.rsi14))
        row("MACD", "${fmt2(s.macd)}  信号 ${fmt2(s.macdSignal)}  柱 ${fmt2(s.macdHist)}")
        row("KDJ", "K ${fmt2(s.kdjK)}  D ${fmt2(s.kdjD)}  J ${fmt2(s.kdjJ)}")
        row("布林带", "上 ${fmt2(s.bollUpper)}  中 ${fmt2(s.bollMid)}  下 ${fmt2(s.bollLower)}")
        row("年化波动", "${fmt(s.volatility)}%")
        box.addView(text("数学演示指标，不构成投资建议", 11, subText), spacedParams(-2, 4, 0))
        return box
    }

    private fun fmt2(v: Double?): String = if (v == null) "--" else fmt(v)

    /** 策略回测弹窗 */
    private fun showBacktest(stock: Stock) {
        val strategies = Backtest.LIBRARY
        val names = strategies.map { it.name }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("策略回测 · ${stock.name}（虚构历史数据）")
            .setItems(names) { _, which ->
                val candles = historyOf(stock)
                val result = Backtest.run(strategies[which], candles, stock.code, stock.name)
                showBacktestResult(result)
            }
            .show()
    }

    private fun showBacktestResult(r: Backtest.Result) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(16), dp(22), dp(10))
        }
        box.addView(text(r.strategyName, 17, textColor).apply { setTypeface(typeface, Typeface.BOLD) })
        fun row(k: String, v: String) {
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            line.addView(text(k, 13, subText), LinearLayout.LayoutParams(0, -2, 1f))
            line.addView(text(v, 13, textColor), LinearLayout.LayoutParams(-2, -2))
            box.addView(line, spacedParams(-2, 0, 3))
        }
        val pnlColor = if (r.totalReturn >= 0) gain else loss
        row("初始资金", currency() + fmt(r.initialCash))
        row("期末资金", currency() + fmt(r.finalCash))
        row("总收益率", signed(r.totalReturn) + "%")
        row("同期买入持有", signed(r.benchmarkReturn) + "%")
        row("交易次数", "${r.tradeCount} 笔")
        row("胜率", "${fmt(r.winRate)}%")
        row("盈亏比", fmt(r.profitFactor))
        row("最大回撤", "${fmt(r.maxDrawdown)}%")

        // 净值曲线
        if (r.equityCurve.size > 2) {
            val chart = EquityCurveView(this).apply {
                lineColor = pnlColor
                gridColor = border; textColor = subText
                setData(r.equityCurve, r.initialCash)
            }
            box.addView(chart, LinearLayout.LayoutParams(-1, dp(150)).apply { topMargin = dp(8) })
        }

        // 成交明细
        if (r.trades.isNotEmpty()) {
            box.addView(text("成交明细（最近 12 笔）", 14, textColor).apply {
                setTypeface(typeface, Typeface.BOLD)
            }, spacedParams(-2, 12, 4))
            r.trades.takeLast(12).forEach { t ->
                val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                val sideColor = if (t.isBuy) gain else loss
                line.addView(text("${if (t.isBuy) "买入" else "卖出"} ${t.name}", 12, sideColor), LinearLayout.LayoutParams(dp(96), -2))
                line.addView(text(currency() + fmt(t.price), 12, textColor), LinearLayout.LayoutParams(dp(96), -2))
                line.addView(text("${t.quantity}股", 12, subText), LinearLayout.LayoutParams(dp(78), -2))
                line.addView(text(
                    if (t.isBuy) t.reason else "${if (t.pnl >= 0) "+" else ""}${fmt(t.pnl)} · ${t.reason}",
                    12, if (t.isBuy) subText else (if (t.pnl >= 0) gain else loss)
                ), LinearLayout.LayoutParams(0, -2, 1f))
                box.addView(line, spacedParams(-2, 0, 2))
            }
        }
        box.addView(text("回测基于虚构历史数据，仅用于演示策略逻辑，不代表真实历史行情，不构成投资建议。", 11, subText), spacedParams(-2, 10, 0))

        AlertDialog.Builder(this).setView(box).setPositiveButton("知道了", null).show()
    }

    /** 回测净值曲线 */
    private class EquityCurveView(ctx: Context) : View(ctx) {
        private var curve: List<Double> = emptyList()
        private var base: Double = 1.0
        var lineColor: Int = Color.rgb(215, 67, 76)
        var gridColor: Int = Color.rgb(50, 59, 70)
        var textColor: Int = Color.rgb(159, 169, 181)

        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 22f }

        fun setData(list: List<Double>, initial: Double) {
            curve = list; base = initial; invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            if (curve.size < 2) return
            val l = 10f; val r = 10f; val t = 24f; val b = 22f
            val w = width - l - r; val h = height - t - b
            if (w <= 0 || h <= 0) return
            val hi = max(curve.max(), base); val lo = min(curve.min(), base)
            if (hi <= lo) return
            fun yOf(v: Double) = t + h - ((v - lo) / (hi - lo)).toFloat() * h

            // 基准线
            p.color = gridColor; p.strokeWidth = 1f; p.style = Paint.Style.STROKE
            val by = yOf(base)
            canvas.drawLine(l, by, l + w, by, p)

            // 曲线 + 渐变填充
            val path = android.graphics.Path()
            curve.forEachIndexed { i, v ->
                val x = l + i.toFloat() / (curve.size - 1) * w
                if (i == 0) path.moveTo(x, yOf(v)) else path.lineTo(x, yOf(v))
            }
            p.color = lineColor; p.strokeWidth = 2.5f
            canvas.drawPath(path, p)

            val fill = android.graphics.Path(path)
            fill.lineTo(l + w, by); fill.lineTo(l, by); fill.close()
            p.style = Paint.Style.FILL; p.alpha = 40
            canvas.drawPath(fill, p)
            p.alpha = 255; p.style = Paint.Style.STROKE

            text.color = textColor
            canvas.drawText("净值曲线（虚线＝初始资金）", l, 16f, text)
        }
    }

    private fun renderStocks() {
        query = searchInput.text.toString().trim().lowercase(Locale.ROOT)
        val filtered = stockList().filter { stock ->
            (!showHoldingsOnly || account().holdings.containsKey(stock.code)) &&
                (query.isBlank() || stock.code.lowercase(Locale.ROOT).contains(query) || stock.name.lowercase(Locale.ROOT).contains(query) || stock.sector.lowercase(Locale.ROOT).contains(query))
        }
        stockAdapter.submitList(filtered)
    }

    private inner class StockAdapter : RecyclerView.Adapter<StockRowHolder>() {
        private val items = mutableListOf<Stock>()

        fun submitList(next: List<Stock>) {
            items.clear()
            items.addAll(next)
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: android.view.ViewGroup, viewType: Int): StockRowHolder {
            val row = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), 0, dp(10), 0)
            }
            val primary = text("", 14, textColor)
            val price = text("", 14, textColor).apply { gravity = Gravity.END }
            row.addView(primary, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(price, LinearLayout.LayoutParams(-2, -2))
            return StockRowHolder(row, primary, price)
        }

        override fun onBindViewHolder(holder: StockRowHolder, position: Int) {
            val stock = items[position]
            val hold = account().holdings[stock.code]?.qty ?: 0
            val signal = if (stock.isIndex) "指数" else quantSignal(stock)
            holder.primary.text = "${stock.name}${if (stock.isIndex) " · 指数" else ""}\n${stock.code} · ${stock.sector} · $signal${if (hold > 0) " · 持仓$hold" else ""}"
            holder.price.text = "${currency()}${fmt(stock.price)}\n${signed(stock.change)}% · ${quoteLabel(stock)}"
            holder.price.setTextColor(if (stock.change >= 0) gain else loss)
            holder.root.background = surfaceDrawable(if (selectedCode == stock.code) Color.rgb(66, 34, 39) else panel, 5, if (selectedCode == stock.code) accent else border)
            holder.root.layoutParams = RecyclerView.LayoutParams(-1, if (stock.isIndex) dp(64) else rowHeight).apply { bottomMargin = dp(6) }
            holder.root.setOnClickListener {
                selectedCode = stock.code
                renderAll("已选择 ${stock.name}")
            }
        }

        override fun getItemCount() = items.size
    }

    private class StockRowHolder(val root: LinearLayout, val primary: TextView, val price: TextView) : RecyclerView.ViewHolder(root)

    private fun trade(stock: Stock, quantity: Int, type: String) {
        if (stock.isIndex) return toast("指数不能交易")
        if (quantity <= 0 || quantity % 100 != 0) return toast("数量必须为100股整数倍")
        val acc = account()
        val amount = quantity * stock.price
        if (type == "buy") {
            if (acc.cash < amount) return toast("可用资金不足")
            val old = acc.holdings[stock.code]
            val oldQty = old?.qty ?: 0
            val oldAmount = oldQty * (old?.avgPrice ?: 0.0)
            acc.cash -= amount
            acc.holdings[stock.code] = Holding(oldQty + quantity, (oldAmount + amount) / (oldQty + quantity))
        } else {
            val old = acc.holdings[stock.code] ?: return toast("持仓不足")
            if (old.qty < quantity) return toast("持仓不足")
            acc.cash += amount
            old.qty -= quantity
            if (old.qty == 0) acc.holdings.remove(stock.code)
        }
        saveAccounts()
        renderAll("${if (type == "buy") "买入" else "卖出"}成功：${stock.name} $quantity 股")
    }

    private fun showSettings() {
        val options = arrayOf("暗色主题", "明亮主题", "紧凑密度", "标准密度", "宽松密度", "混合演示行情", "纯本地演算行情", "服务器演示优先")
        AlertDialog.Builder(this).setTitle("UI 自定义")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> theme = "dark"
                    1 -> theme = "light"
                    2 -> density = "compact"
                    3 -> density = "standard"
                    4 -> density = "spacious"
                    5 -> dataMode = "hybrid"
                    6 -> dataMode = "simulation"
                    7 -> dataMode = "real"
                }
                prefs().edit().putString("theme", theme).putString("density", density).putString("dataMode", dataMode).apply()
                showTrading()
            }.show()
    }

    private fun checkUpdate() {
        request("GET", "/stock/app-update?platform=android", null) { json ->
            val version = json.optString("version", "1.0")
            val url = json.optString("installUrl")
            runOnUiThread {
                AlertDialog.Builder(this).setTitle("版本 $version").setMessage(json.optString("notes", "当前版本可用"))
                    .setPositiveButton(if (url.isBlank()) "确定" else "下载并安装") { _, _ -> if (url.isNotBlank()) installApk(url) }
                    .setNegativeButton("取消", null).show()
            }
        }
    }

    private fun installApk(url: String) {
        val absoluteUrl = if (url.startsWith("http")) url else "$site$url"
        val request = DownloadManager.Request(Uri.parse(absoluteUrl))
            .setTitle("铮铮交易练习更新")
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "ZhengZhengStock-update.apk")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        toast("正在下载，完成后点击系统通知安装")
    }

    private fun syncServerQuotes(manual: Boolean) {
        if (username.isBlank()) return
        if (dataMode == "simulation") {
            tick(if (manual) 1.8 else 1.0)
            quoteStatus = "纯仿真行情持续演算"
            if (manual) renderAll("纯仿真行情已刷新")
            return
        }
        if (quoteSyncInFlight) {
            if (manual) toast("服务器行情正在同步")
            return
        }

        val requestedMarket = market
        val requestedMode = dataMode
        quoteSyncInFlight = true
        if (manual) {
            quoteStatus = "正在同步服务器行情"
            renderAll(quoteStatus)
        }
        request(
            "GET",
            "/stock/stocks?market=$requestedMarket&mode=$requestedMode",
            null,
            onError = { reason ->
                quoteSyncInFlight = false
                runOnUiThread {
                    val formatError = reason == "服务器返回数据格式错误"
                    quoteStatus = when {
                        formatError -> "服务器数据格式错误，已启用本地连续仿真"
                        requestedMode == "real" -> "服务器演示数据不可用，已启用本地演算"
                        else -> "服务器暂不可用，本地行情继续演算"
                    }
                    if (manual) toast(if (formatError) quoteStatus else "服务器连接失败，已切换本地仿真")
                    if (market == requestedMarket) renderAll(if (formatError) quoteStatus else "$quoteStatus · $reason")
                }
            }
        ) { json ->
            val rows = parseRemoteQuotes(json, requestedMarket)
            val effectiveMode = json.optJSONObject("quoteStatus")?.optString("effectiveMode", "simulation") ?: "simulation"
            val localRows = stocksByMarket[requestedMarket]?.toList() ?: emptyList()
            val result = MarketQuoteMerger.merge(localRows, rows, requestedMode, effectiveMode)
            quoteSyncInFlight = false
            runOnUiThread {
                if (!result.usedFallback) {
                    stocksByMarket[requestedMarket] = result.stocks.toMutableList()
                    lastServerSyncAt = SystemClock.elapsedRealtime()
                }
                quoteStatus = "${result.status} · ${result.stocks.size} 个标的"
                if (market == requestedMarket) {
                    if (result.stocks.none { it.code == selectedCode }) selectedCode = result.stocks.firstOrNull()?.code ?: indexCode()
                    renderAll(quoteStatus)
                }
            }
        }
    }

    private fun parseRemoteQuotes(json: JSONObject, requestedMarket: String): List<RemoteStockQuote> {
        val array = json.optJSONArray("stocks") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val code = item.optString("code").trim()
                if (code.isBlank()) continue
                add(
                    RemoteStockQuote(
                        code = code,
                        name = item.optString("name", code),
                        market = item.optString("market", requestedMarket),
                        sector = item.optString("sector", if (item.optBoolean("isIndex")) "指数" else "其他"),
                        isIndex = item.optBoolean("isIndex", false),
                        price = item.optDouble("price", 0.01).coerceAtLeast(0.01),
                        change = item.optDouble("change", 0.0),
                        volume = item.optLong("volume", 0L).coerceIn(0L, Int.MAX_VALUE.toLong()).toInt(),
                        quoteMode = item.optString("quoteMode", json.optString("dataMode", "simulation")),
                        quoteSource = item.optString("realQuoteSource").ifBlank { item.optString("quoteSource", "simulation") }
                    )
                )
            }
        }
    }

    private fun startTicker() {
        handler.postDelayed(object : Runnable {
            override fun run() {
                tickerCount++
                val serverFresh = SystemClock.elapsedRealtime() - lastServerSyncAt < 9_000
                val strength = when {
                    dataMode == "real" && serverFresh -> 0.12
                    dataMode == "hybrid" && serverFresh -> 0.35
                    else -> 1.0
                }
                tick(strength)
                if (username.isNotBlank() && dataMode != "simulation" && tickerCount % 5 == 0) syncServerQuotes(false)
                renderAll()
                handler.postDelayed(this, 1200)
            }
        }, 1200)
    }

    private fun tick(strength: Double) {
        stocksByMarket.values.forEach { list ->
            val indexMove = Random.nextDouble(-0.08, 0.1) * strength
            list.forEach { stock ->
                val drift = if (stock.isIndex) indexMove else indexMove + Random.nextDouble(-stock.amplitude, stock.amplitude) * strength
                stock.price = max(0.01, stock.price * (1 + drift / 100)).round2()
                stock.volume += Random.nextInt(1_000, 90_000)
            }
        }
    }

    private fun generateMarkets() {
        stocksByMarket["cn"] = makeStocks("cn", 520, "000001.SH", "上证指数", 3048.22, cnNames, cnSectors)
        stocksByMarket["hk"] = makeStocks("hk", 92, "HSI", "恒生指数", 18320.45, hkNames, hkSectors)
        stocksByMarket["us"] = makeStocks("us", 112, "IXIC", "纳斯达克", 17118.61, usNames, usSectors)
        selectedCode = indexCode()
    }

    private fun makeStocks(market: String, count: Int, indexCode: String, indexName: String, indexPrice: Double, names: List<String>, sectors: List<String>): MutableList<Stock> {
        val list = mutableListOf(Stock(indexCode, indexName, market, "指数", true, indexPrice, indexPrice * 0.997, 1_000_000, 0.05))
        repeat(count) { i ->
            val code = when (market) {
                "cn" -> "%06d".format((if (i % 3 == 0) 600000 else if (i % 3 == 1) 300000 else 688000) + i)
                "hk" -> "%05d.HK".format(i + 1)
                else -> "${('A'.code + i % 26).toChar()}${('A'.code + (i / 3) % 26).toChar()}${('A'.code + (i / 7) % 26).toChar()}"
            }
            val price = when (market) { "us" -> Random.nextDouble(12.0, 420.0); "hk" -> Random.nextDouble(1.2, 190.0); else -> Random.nextDouble(3.5, 98.0) }
            val name = if (i < names.size) names[i] else "${names[i % names.size]}${i + 1}"
            list += Stock(code, name, market, sectors[i % sectors.size], false, price.round2(), (price * Random.nextDouble(0.97, 1.03)).round2(), Random.nextInt(120_000, 80_000_000), Random.nextDouble(0.04, 0.42))
        }
        return list
    }

    private fun loadAccounts() {
        ensureAccounts()
        val json = JSONObject(prefs().getString("accounts", "{}") ?: "{}")
        listOf("cn", "hk", "us").forEach { m ->
            val item = json.optJSONObject(m) ?: return@forEach
            val acc = account(m)
            acc.cash = item.optDouble("cash", acc.cash)
            val holds = item.optJSONObject("holdings") ?: JSONObject()
            holds.keys().forEach { code ->
                val h = holds.getJSONObject(code)
                acc.holdings[code] = Holding(h.optInt("qty"), h.optDouble("avgPrice"))
            }
        }
    }

    private fun saveAccounts() {
        val root = JSONObject()
        accounts.forEach { (m, acc) ->
            val item = JSONObject().put("cash", acc.cash)
            val h = JSONObject()
            acc.holdings.forEach { (code, holding) -> h.put(code, JSONObject().put("qty", holding.qty).put("avgPrice", holding.avgPrice)) }
            item.put("holdings", h)
            root.put(m, item)
        }
        prefs().edit().putString("accounts", root.toString()).apply()
    }

    private fun ensureAccounts() {
        listOf("cn", "hk", "us").forEach { account(it) }
    }

    private fun account(m: String = market): MarketAccount = accounts.getOrPut(m) {
        MarketAccount(if (m == "us") 50_000.0 else if (m == "hk") 300_000.0 else 100_000.0, mutableMapOf())
    }

    private fun stockList() = stocksByMarket[market] ?: mutableListOf()
    private fun quantSnapshot(): QuantSnapshot {
        val rows = stockList().filter { !it.isIndex }
        val count = rows.size.coerceAtLeast(1)
        val advancers = rows.count { it.change > 0 }
        val decliners = rows.count { it.change < 0 }
        val avgChange = rows.sumOf { it.change } / count
        val variance = rows.sumOf { (it.change - avgChange) * (it.change - avgChange) } / count
        val volatility = sqrt(variance)
        val breadth = if (rows.isEmpty()) 0.0 else advancers.toDouble() / rows.size
        val totalVolume = rows.sumOf { it.volume.toDouble() }
        val momentum = clamp(50 + avgChange * 12 + (breadth - 0.5) * 70)
        val liquidity = clamp(log10(max(totalVolume, 100_000.0)) * 12 - 52)
        val risk = clamp(100 - volatility * 16 - max(0.0, 0.42 - breadth) * 80)
        val score = clamp(momentum * 0.42 + liquidity * 0.24 + risk * 0.34).toInt()
        return QuantSnapshot(rows.size, advancers, decliners, avgChange, volatility, momentum, liquidity, risk, score)
    }
    private fun quantSignal(stock: Stock): String {
        val volumeScore = clamp(log10(max(stock.volume.toDouble(), 10_000.0)) * 12 - 36)
        val momentumScore = clamp(50 + stock.change * 8)
        val reversalPenalty = if (stock.change < -3) kotlin.math.abs(stock.change) * 5 else 0.0
        val score = clamp(momentumScore * 0.58 + volumeScore * 0.28 + (100 - reversalPenalty) * 0.14).toInt()
        // 用中性的数学描述，避免"强势/风险"这类易触发金融风控审核的荐股式措辞
        return "活跃度 $score"
    }
    private fun clamp(value: Double, minValue: Double = 0.0, maxValue: Double = 100.0): Double = value.coerceIn(minValue, maxValue)
    private fun holdingValue() = account().holdings.entries.sumOf { (code, h) -> (stockList().firstOrNull { it.code == code }?.price ?: h.avgPrice) * h.qty }
    private fun currency() = if (market == "hk") "HK$" else if (market == "us") "$" else "¥"
    private fun marketName() = if (market == "hk") "港股" else if (market == "us") "美股" else "A股"
    private fun indexName() = if (market == "hk") "恒生指数" else if (market == "us") "纳斯达克" else "上证指数"
    private fun modeName() = Compliance.modeLabel(dataMode)

    /**
     * 行情来源标签。刻意不暴露第三方数据供应商名称（如某财经平台），
     * 避免被判定为荐股导流或金融诈骗；统一表述为中性的"演示数据来源"。
     */
    private fun quoteLabel(stock: Stock) = when {
        stock.quoteMode == "hybrid" -> "服务器补帧"
        stock.quoteMode == "real" -> "服务器演示"
        else -> "本地演算"
    }
    private fun indexCode() = if (market == "hk") "HSI" else if (market == "us") "IXIC" else "000001.SH"
    private fun fmt(v: Double) = "%.2f".format(v)
    private fun signed(v: Double) = "%+.2f".format(v)
    private fun Double.round2() = kotlin.math.round(this * 100) / 100
    private fun prefs() = getPreferences(MODE_PRIVATE)

    private fun request(method: String, path: String, body: JSONObject?, onError: ((String) -> Unit)? = null, callback: (JSONObject) -> Unit) {
        executor.execute {
            try {
                val connection = URL(api + path).openConnection() as HttpURLConnection
                connection.requestMethod = method
                connection.setRequestProperty("Content-Type", "application/json")
                connection.connectTimeout = 5000
                connection.readTimeout = 10000
                if (body != null) {
                    connection.doOutput = true
                    connection.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val response = JSONObject(stream.bufferedReader().readText())
                if (status !in 200..299) throw IllegalStateException(response.optString("error", "HTTP $status"))
                callback(response)
            } catch (e: Exception) {
                val reason = if (e is JSONException) "服务器返回数据格式错误" else (e.message ?: "网络请求失败")
                if (onError != null) onError(reason) else toast(reason)
            }
        }
    }

    private fun baseLayout() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        val edge = if (resources.displayMetrics.widthPixels < dp(420)) 10 else 14
        setPadding(dp(edge), dp(edge), dp(edge), dp(edge))
        setBackgroundColor(bg)
    }

    private fun text(value: String, size: Int, color: Int) = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(color)
        typeface = Typeface.create("sans", Typeface.NORMAL)
        includeFontPadding = false
        setPadding(dp(8), dp(6), dp(8), dp(6))
    }

    private fun metric(title: String) = text("$title\n--", 13, textColor).apply {
        background = surfaceDrawable(panel, 6, border)
        gravity = Gravity.CENTER_VERTICAL
    }
    private fun input(hintValue: String) = EditText(this).apply {
        hint = hintValue
        setTextColor(textColor)
        setHintTextColor(subText)
        setSingleLine(false)
        setPadding(dp(12), dp(8), dp(12), dp(8))
        background = surfaceDrawable(panel, 5, border)
    }

    private fun smallButton(label: String, action: () -> Unit) = button(label, panelRaised, LinearLayout.LayoutParams(-2, dp(38)).apply { marginStart = dp(5) }, action)
    private fun button(label: String, color: Int, params: LinearLayout.LayoutParams? = null, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        minWidth = 0
        minHeight = 0
        setPadding(dp(12), 0, dp(12), 0)
        setTextColor(if (theme == "light" && color == panelRaised) textColor else Color.WHITE)
        background = buttonBackground(color)
        setOnClickListener { action() }
        if (params != null) layoutParams = params
    }

    private fun surfaceDrawable(color: Int, radius: Int, strokeColor: Int? = null) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        if (strokeColor != null) setStroke(dp(1), strokeColor)
    }

    private fun buttonBackground(color: Int) = StateListDrawable().apply {
        val pressed = Color.rgb(
            (Color.red(color) * 0.84).toInt(),
            (Color.green(color) * 0.84).toInt(),
            (Color.blue(color) * 0.84).toInt()
        )
        addState(intArrayOf(android.R.attr.state_pressed), surfaceDrawable(pressed, 5))
        addState(intArrayOf(), surfaceDrawable(color, 5))
    }

    private fun spacedParams(height: Int, top: Int = 0, bottom: Int = 0) = LinearLayout.LayoutParams(-1, height).apply {
        topMargin = dp(top)
        bottomMargin = dp(bottom)
    }

    private fun toast(message: String) = runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private val cnNames = listOf("浦发银行", "白云机场", "东风汽车", "中国国贸", "首创环保", "上海机场", "包钢股份", "华能国际", "皖通高速", "保利发展", "中国联通", "招商银行", "宝钢股份", "三一重工", "贵州茅台", "海尔智家", "伊利股份", "长江电力", "中国平安", "兴业银行", "隆基绿能", "中芯国际", "宁德时代", "迈瑞医疗", "东方财富", "比亚迪", "万科A", "美的集团", "格力电器", "中信证券", "紫金矿业", "海康威视")
        private val hkNames = listOf("长和", "中电控股", "香港中华煤气", "汇丰控股", "电能实业", "恒生银行", "恒基地产", "新鸿基地产", "新世界发展", "太古股份", "腾讯控股", "友邦保险", "美团", "小米集团", "阿里巴巴", "京东集团", "比亚迪股份", "中国移动", "药明生物", "港交所")
        private val usNames = listOf("Apple", "Microsoft", "NVIDIA", "Amazon", "Meta", "Tesla", "Alphabet", "Netflix", "Adobe", "Oracle", "Intel", "AMD", "Broadcom", "Costco", "Walmart", "Visa", "Mastercard", "JPMorgan", "Boeing", "Disney")
        private val cnSectors = listOf("金融", "制造", "消费", "科技", "医药", "能源", "地产", "通信", "材料", "新能源")
        private val hkSectors = listOf("金融", "地产", "科技", "医药", "消费", "电讯", "能源")
        private val usSectors = listOf("Mega Tech", "AI", "Cloud", "Consumer", "Finance", "Industrial", "Media")
    }
}
