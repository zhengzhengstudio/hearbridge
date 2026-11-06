package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.BiomePresentation
import cn.zhengzhengstudio.survivaldiary.domain.Coordinates
import cn.zhengzhengstudio.survivaldiary.domain.Entity
import cn.zhengzhengstudio.survivaldiary.game.CameraFollowController
import cn.zhengzhengstudio.survivaldiary.game.ChunkRenderer
import cn.zhengzhengstudio.survivaldiary.game.PlayerMotion
import cn.zhengzhengstudio.survivaldiary.game.WorldPoint
import cn.zhengzhengstudio.survivaldiary.game.WorldNavigation
import cn.zhengzhengstudio.survivaldiary.ui.PlacementDraft
import cn.zhengzhengstudio.survivaldiary.ui.PlacementFlow
import org.junit.Assert.*
import org.junit.Test

class WorldInteractionTest {
    @Test fun `players cannot path onto lagoon water unless a traversable structure covers it`() {
        val seed = "water-collision"
        val water = (-80..80).asSequence().flatMap { y -> (-80..80).asSequence().map { x -> x to y } }
            .first { (x, y) -> !WorldNavigation.isWalkable(seed, WorldPoint(x * ChunkRenderer.WORLD_UNIT, y * ChunkRenderer.WORLD_UNIT), emptyList()) }
        val point = WorldPoint(water.first * ChunkRenderer.WORLD_UNIT, water.second * ChunkRenderer.WORLD_UNIT)
        assertFalse(WorldNavigation.isWalkable(seed, point, emptyList()))

        val dock = Entity("dock", "dock", Coordinates(water.first, water.second))
        assertTrue(WorldNavigation.isWalkable(seed, point, listOf(dock)))

        val motion = PlayerMotion(position = WorldPoint(0f, 0f))
        assertFalse(motion.moveTo(point) { candidate -> WorldNavigation.isWalkable(seed, candidate, emptyList()) })
        assertFalse(motion.isMoving)

        val spawn = WorldNavigation.nearestWalkable(seed, WorldPoint(8 * ChunkRenderer.WORLD_UNIT, 8 * ChunkRenderer.WORLD_UNIT), emptyList())
        assertTrue(WorldNavigation.isWalkable(seed, spawn, emptyList()))
    }

    @Test fun `placement tap only moves the preview and manual pan releases camera follow`() {
        val draft = PlacementDraft("shelter", Coordinates(1, 1))
        val moved = PlacementFlow.previewAt(draft, Coordinates(9, -3))
        assertEquals(Coordinates(9, -3), moved.coordinates)

        val follow = CameraFollowController()
        assertTrue(follow.enabled)
        follow.onManualPan()
        assertFalse(follow.enabled)
        follow.onCenterPlayer()
        assertTrue(follow.enabled)
    }

    @Test fun `every generated biome has a clear player facing Chinese name and distinct map color`() {
        val ids = listOf("lagoon", "palm-grove", "basalt-ridge", "mangrove", "cloud-forest", "dry-savanna", "limestone-upland")
        assertEquals(ids.size, ids.map(BiomePresentation::name).toSet().size)
        assertEquals(ids.size, ids.map(BiomePresentation::mapColor).toSet().size)
        assertEquals("红树林", BiomePresentation.name("mangrove"))
        assertEquals("浅海泻湖", BiomePresentation.name("lagoon"))
    }
}
