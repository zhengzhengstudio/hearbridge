package cn.zhengzhengstudio.stock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarketQuoteMergerTest {
    private val local = listOf(
        Stock("000001.SH", "上证指数", "cn", "指数", true, 3000.0, 2990.0, 1_000_000, 0.05),
        Stock("600000", "浦发银行", "cn", "金融", false, 10.0, 9.9, 500_000, 0.12)
    )

    @Test
    fun serverQuotesReplaceSyntheticRowsAndDerivePreviousClose() {
        val remote = listOf(
            RemoteStockQuote("000001.SH", "上证指数", "cn", "指数", true, 3060.0, 2.0, 1_500_000, "hybrid", "ths"),
            RemoteStockQuote("600000", "浦发银行", "cn", "金融", false, 10.5, 5.0, 880_000, "real", "ths")
        )

        val result = MarketQuoteMerger.merge(local, remote, "hybrid", "hybrid")

        assertEquals(2, result.stocks.size)
        assertEquals(3000.0, result.stocks.first().previousClose, 0.001)
        assertEquals(10.0, result.stocks[1].previousClose, 0.001)
        assertEquals("服务器混合行情", result.status)
        assertEquals("ths", result.stocks[1].quoteSource)
        assertTrue(!result.usedFallback)
    }

    @Test
    fun realModeFallsBackToLocalSimulationWhenServerReturnsNoRows() {
        val result = MarketQuoteMerger.merge(local, emptyList(), "real", "simulation")

        assertEquals(local, result.stocks)
        assertEquals("真实行情不可用，已启用持续仿真", result.status)
        assertTrue(result.usedFallback)
    }
}
