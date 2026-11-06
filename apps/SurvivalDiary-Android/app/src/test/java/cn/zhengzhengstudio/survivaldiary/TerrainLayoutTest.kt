package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.game.TerrainLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TerrainLayoutTest {
    @Test fun nineNeighbourRegionsUseNineDifferentAtlasCells() {
        val cells = TerrainLayout.visibleRegions(
            left = -557f,
            top = -314f,
            right = 1114f,
            bottom = 628f,
        )

        assertEquals(9, cells.size)
        assertEquals(9, cells.map { it.sourceColumn to it.sourceRow }.toSet().size)
        assertTrue(cells.all { it.worldWidth == 557f && it.worldHeight == 314f })
    }

    @Test fun visibleRegionPlanDoesNotDrawOffscreenCopiesOfTheFullAtlas() {
        val cells = TerrainLayout.visibleRegions(
            left = -280f,
            top = -520f,
            right = 280f,
            bottom = 520f,
        )

        assertTrue(cells.size <= 12)
        assertTrue(cells.none { it.worldWidth == 1672f || it.worldHeight == 941f })
    }
}
