package cn.zhengzhengstudio.stock

import kotlin.math.max

data class RemoteStockQuote(
    val code: String,
    val name: String,
    val market: String,
    val sector: String,
    val isIndex: Boolean,
    val price: Double,
    val change: Double,
    val volume: Int,
    val quoteMode: String,
    val quoteSource: String
)

data class QuoteMergeResult(
    val stocks: List<Stock>,
    val status: String,
    val usedFallback: Boolean
)

object MarketQuoteMerger {
    fun merge(
        localStocks: List<Stock>,
        remoteQuotes: List<RemoteStockQuote>,
        requestedMode: String,
        effectiveMode: String
    ): QuoteMergeResult {
        if (remoteQuotes.isEmpty()) {
            val message = if (requestedMode == "real") {
                "真实行情不可用，已启用持续仿真"
            } else {
                "服务器暂不可用，本地行情继续演算"
            }
            return QuoteMergeResult(localStocks, message, true)
        }

        val amplitudeByCode = localStocks.associate { it.code to it.amplitude }
        val stocks = remoteQuotes.map { quote ->
            val previousClose = if (quote.change <= -99.99) {
                quote.price
            } else {
                quote.price / max(0.0001, 1 + quote.change / 100)
            }
            Stock(
                code = quote.code,
                name = quote.name,
                market = quote.market,
                sector = quote.sector,
                isIndex = quote.isIndex,
                price = quote.price,
                previousClose = previousClose,
                volume = quote.volume,
                amplitude = amplitudeByCode[quote.code] ?: if (quote.isIndex) 0.05 else 0.18,
                quoteMode = quote.quoteMode.ifBlank { effectiveMode },
                quoteSource = quote.quoteSource.ifBlank { "simulation" },
                isSimulated = quote.quoteSource.isBlank() || quote.quoteSource == "simulation"
            )
        }
        val status = when (effectiveMode) {
            "real" -> "服务器真实行情"
            "hybrid" -> "服务器混合行情"
            else -> "服务器仿真行情"
        }
        return QuoteMergeResult(stocks, status, false)
    }
}
