package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.ui.CraftingGuide
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CraftingGuideTest {
    @Test fun `machete guide exposes a complete reachable production chain`() {
        val route = CraftingGuide.routeFor("machete")
        assertEquals("青铜砍刀（升级）", route.title)
        assertTrue(route.steps.first().contains("石斧"))
        assertTrue(route.steps.any { it.contains("铜矿") && it.contains("锡矿") })
        assertTrue(route.steps.any { it.contains("熔炉") })
        assertTrue(route.steps.last().contains("2 青铜锭") && route.steps.last().contains("工作台"))
    }

    @Test fun `stone machete guide is the short early-game route`() {
        val route = CraftingGuide.routeFor("stone-machete")
        assertTrue(route.title.contains("前期开荒"))
        assertTrue(route.steps.any { it.contains("2 海蚀石") && it.contains("1 绳索") })
        assertTrue(route.steps.last().contains("耐久 55") && route.steps.last().contains("耐久 180"))
    }
}
