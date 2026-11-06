package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.BuildingAppearance
import cn.zhengzhengstudio.survivaldiary.domain.Coordinates
import cn.zhengzhengstudio.survivaldiary.domain.Entity
import cn.zhengzhengstudio.survivaldiary.domain.GroundItem
import cn.zhengzhengstudio.survivaldiary.domain.RecipeDefinition
import cn.zhengzhengstudio.survivaldiary.domain.ResourceNodeState
import cn.zhengzhengstudio.survivaldiary.game.BuildingMetrics
import cn.zhengzhengstudio.survivaldiary.game.Camera2D
import cn.zhengzhengstudio.survivaldiary.game.ExplorationVisibility
import cn.zhengzhengstudio.survivaldiary.game.FogBoundaryPolicy
import cn.zhengzhengstudio.survivaldiary.game.FogCloudLayout
import cn.zhengzhengstudio.survivaldiary.game.FogEdge
import cn.zhengzhengstudio.survivaldiary.game.GroundMaterialPolicy
import cn.zhengzhengstudio.survivaldiary.game.PlayerMotion
import cn.zhengzhengstudio.survivaldiary.game.WorldNavigation
import cn.zhengzhengstudio.survivaldiary.game.WorldPoint
import cn.zhengzhengstudio.survivaldiary.game.TerrainLighting
import cn.zhengzhengstudio.survivaldiary.ui.RecipeUnlockPolicy
import cn.zhengzhengstudio.survivaldiary.ui.mapBiomeHint
import cn.zhengzhengstudio.survivaldiary.ui.mapWindow
import cn.zhengzhengstudio.survivaldiary.domain.DiscoveredChunk
import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorldPresentationTest {
    @Test fun fogFrontierOnlyFacesAlreadyExploredLand() {
        val explored = setOf("0,1")
        assertEquals(listOf(FogEdge.WEST), FogBoundaryPolicy.frontierEdges(explored, 1, 1))
        assertEquals(listOf(FogEdge.WEST, FogEdge.NORTH), FogBoundaryPolicy.frontierEdges(explored + "1,0", 1, 1))
        assertTrue(FogBoundaryPolicy.frontierEdges(explored, 4, 4).isEmpty())
    }

    @Test fun fogCloudsRepeatAlongTheFrontierWithoutStretchingTheRaster() {
        val horizontal = FogCloudLayout.segments(
            edge = FogEdge.NORTH,
            left = 0f,
            top = 0f,
            size = 384f,
            rasterWidth = 1024,
            rasterHeight = 384,
        )
        val vertical = FogCloudLayout.segments(
            edge = FogEdge.WEST,
            left = 0f,
            top = 0f,
            size = 384f,
            rasterWidth = 1024,
            rasterHeight = 384,
        )

        assertTrue(horizontal.size >= 3)
        assertEquals(horizontal.size, vertical.size)
        assertTrue(horizontal.all { it.rotationDegrees == 0f })
        assertTrue(vertical.all { it.rotationDegrees == 90f })
        assertTrue(horizontal.all { kotlin.math.abs(it.width / it.height - 1024f / 384f) < 0.02f })
        assertTrue(vertical.all { kotlin.math.abs(it.width / it.height - 1024f / 384f) < 0.02f })
        assertTrue(horizontal.zipWithNext().all { (a, b) -> b.centerX - a.centerX < a.width })
        assertTrue(vertical.zipWithNext().all { (a, b) -> b.centerY - a.centerY < a.width })
    }

    @Test fun mapWindowFollowsLivePlayerAndKeepsConcreteChunkDetails() {
        val player = DiscoveredChunk(7, -3)
        val window = mapWindow(player, listOf(DiscoveredChunk(0, 0), player, DiscoveredChunk(10, -3)))
        assertEquals(4, window.radius)
        assertEquals(81, window.cells.size)
        assertTrue(player in window.cells)
        assertTrue(DiscoveredChunk(3, -7) in window.cells)
        assertEquals("椰林、纤维与可食资源", mapBiomeHint("palm-grove"))
    }

    @Test fun groundMaterialUsesOrganicImagegenTexturesWithoutCoveringWater() {
        assertEquals("tropical-floor", GroundMaterialPolicy.materialFor("palm-grove"))
        assertEquals("tropical-floor", GroundMaterialPolicy.materialFor("mangrove"))
        assertEquals("coastal-earth", GroundMaterialPolicy.materialFor("beach"))
        assertEquals("coastal-earth", GroundMaterialPolicy.materialFor("rockland"))
        assertEquals(null, GroundMaterialPolicy.materialFor("lagoon"))
        assertEquals(null, GroundMaterialPolicy.materialFor("deep-water"))
        assertEquals(
            "survival-v3/game/ground-material-v6/tropical-floor.webp",
            GroundMaterialPolicy.assetPath("tropical-floor"),
        )
    }
    @Test fun terrainLightingMakesHighGroundAndSlopesVisiblyDifferent() {
        val low = TerrainLighting.factor(height = 0.25, eastHeight = 0.25, southHeight = 0.25)
        val high = TerrainLighting.factor(height = 0.75, eastHeight = 0.75, southHeight = 0.75)
        val slope = TerrainLighting.factor(height = 0.5, eastHeight = 0.8, southHeight = 0.2)
        assertTrue(high > low)
        assertNotEquals(high, slope, 0.001)
    }
    @Test fun undiscoveredChunksDoNotRevealResourceEntities() {
        val visible = ResourceNodeState("palm@2,2", "palm", "branch", 2.0, 2.0, 3)
        val hidden = ResourceNodeState("ore@20,2", "ore", "stone", 20.0, 2.0, 3)
        val visibleEntity = Entity("visible-villager", "castaway-builder", Coordinates(2, 2))
        val hiddenEntity = Entity("hidden-villager", "island-trader", Coordinates(20, 2))
        val visibleDrop = GroundItem("visible-drop", "branch", 1, 2.0, 2.0, 0.0)
        val hiddenDrop = GroundItem("hidden-drop", "stone", 1, 20.0, 2.0, 0.0)

        assertEquals(listOf(visible), ExplorationVisibility.resources(listOf(visible, hidden), setOf("0,0")))
        assertEquals(listOf(visibleEntity), ExplorationVisibility.entities(listOf(visibleEntity, hiddenEntity), setOf("0,0")))
        assertEquals(listOf(visibleDrop), ExplorationVisibility.groundItems(listOf(visibleDrop, hiddenDrop), setOf("0,0")))
        assertTrue(ExplorationVisibility.contains(Coordinates(15, 15), setOf("0,0")))
        assertFalse(ExplorationVisibility.contains(Coordinates(16, 15), setOf("0,0")))
    }

    @Test fun buildingRenderSizeUsesItsCollisionFootprint() {
        val campfire = BuildingAppearance("campfire", 1, 1)
        val shelter = BuildingAppearance("shelter", 4, 4)
        val dock = BuildingAppearance("dock", 3, 5)

        assertEquals(64f to 72f, BuildingMetrics.renderSize(campfire))
        assertEquals(192f to 192f, BuildingMetrics.renderSize(shelter))
        assertEquals(144f to 240f, BuildingMetrics.renderSize(dock))
    }

    @Test fun firstViewStartsInsideTheChunkAtReadableScale() {
        assertEquals(2f, Camera2D().zoom)
        assertEquals(384f, PlayerMotion().position.x)
        assertEquals(384f, PlayerMotion().position.y)
    }

    @Test fun recipesUnlockFromKnownMaterialsAndPlacedStations() {
        val pickaxe = RecipeDefinition("craft-stone-pickaxe", "hand", 1, mapOf("branch" to 2, "stone" to 3, "rope" to 1), "stone-pickaxe", 1)
        val waterskin = RecipeDefinition("craft-waterskin", "hand", 1, mapOf("latex" to 1, "rope" to 1), "waterskin", 1)
        val machete = RecipeDefinition("craft-machete", "workbench", 1, mapOf("bronze-ingot" to 1), "machete", 1)
        val known = setOf("branch", "stone", "rope")

        assertTrue(RecipeUnlockPolicy.isUnlocked(pickaxe, known, setOf("hand")))
        assertFalse(RecipeUnlockPolicy.isUnlocked(waterskin, known, setOf("hand")))
        assertFalse(RecipeUnlockPolicy.isUnlocked(machete, known + "bronze-ingot", setOf("hand")))
        assertTrue(RecipeUnlockPolicy.isUnlocked(machete, known + "bronze-ingot", setOf("hand", "workbench")))
    }

    @Test fun visibleResourcesAndBuildingsBlockWalkingButRoadsStayPassable() {
        val seed = "navigation-settlement"
        val land = (0..63).flatMap { y -> (0..63).map { x -> x to y } }.first { (x, y) ->
            WorldGenerator.sample(seed, x.toDouble(), y.toDouble()).biome !in setOf("lagoon", "deep-water")
        }
        val point = WorldPoint(land.first * 48f, land.second * 48f)
        val coordinates = Coordinates(land.first, land.second)
        val shelter = Entity("blocking-shelter", "shelter", coordinates)
        val road = Entity("ground-road", "road-segment", coordinates)
        val resource = ResourceNodeState("blocking-tree", "tree", "branch", land.first.toDouble(), land.second.toDouble(), 3)
        val looseBranches = ResourceNodeState("loose-branches", "fallen-branches", "branch", land.first.toDouble(), land.second.toDouble(), 3)

        assertTrue(WorldNavigation.isWalkable(seed, point, emptyList()))
        assertFalse(WorldNavigation.isWalkable(seed, point, listOf(shelter)))
        assertTrue(WorldNavigation.isWalkable(seed, point, listOf(road)))
        assertFalse(WorldNavigation.isWalkable(seed, point, emptyList(), listOf(resource)))
        assertTrue(WorldNavigation.isWalkable(seed, point, emptyList(), listOf(looseBranches)))
    }
}
