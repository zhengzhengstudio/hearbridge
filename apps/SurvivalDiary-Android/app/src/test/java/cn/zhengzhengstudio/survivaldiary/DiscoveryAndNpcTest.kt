package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import cn.zhengzhengstudio.survivaldiary.ui.RecipeUnlockPolicy
import org.junit.Assert.*
import org.junit.Test

class DiscoveryAndNpcTest {
    private val rope = RecipeDefinition("craft-rope", "hand", 8, mapOf("palm-fiber" to 4), "rope", 1)
    private val bridge = RecipeDefinition("build-bridge", "workbench", 20, mapOf("rope" to 2, "stone" to 2), "rope-bridge", 1)

    @Test fun discoveredMaterialRevealsLinkedRecipeButDoesNotBypassIngredientKnowledge() {
        assertFalse(RecipeUnlockPolicy.isVisible(rope, emptySet(), setOf("hand")))
        assertTrue(RecipeUnlockPolicy.isVisible(rope, setOf("palm-fiber"), setOf("hand")))
        assertTrue(RecipeUnlockPolicy.isUnlocked(rope, setOf("palm-fiber"), setOf("hand")))
        assertTrue(RecipeUnlockPolicy.isVisible(bridge, setOf("rope"), setOf("hand")))
        assertFalse(RecipeUnlockPolicy.isUnlocked(bridge, setOf("rope"), setOf("hand")))
    }

    @Test fun workstationRevealsItsCatalogWithoutPretendingMaterialsAreKnown() {
        assertFalse(RecipeUnlockPolicy.isVisible(bridge, emptySet(), setOf("hand")))
        assertTrue(RecipeUnlockPolicy.isVisible(bridge, emptySet(), setOf("hand", "workbench")))
        assertFalse(RecipeUnlockPolicy.isUnlocked(bridge, emptySet(), setOf("hand", "workbench")))
    }

    @Test fun nativeWorldAlwaysContainsARealBuilderNpcAndMigrationIsIdempotent() {
        val initial = SurvivalSimulation.create("npc-test")
        val once = NativeNpcRules.ensureStarter(initial)
        val twice = NativeNpcRules.ensureStarter(once)
        assertEquals(1, twice.entities.values.count { it.type == NativeNpcRules.BUILDER_TYPE })
        assertEquals(once, twice)
        val outposts = NativeNpcRules.outpostCenters(initial.seed)
        assertEquals(2, outposts.size)
        assertEquals(3 + outposts.size, twice.entities.values.count { NativeNpcRules.isVillager(it.type) })
        assertTrue(twice.entities.containsKey("village-shelter"))
        assertTrue(twice.entities.containsKey("village-workbench"))
        assertTrue(twice.entities.containsKey("village-garden"))
        assertTrue(twice.entities.containsKey("village-drying"))
        assertTrue(twice.entities.containsKey("village-mat"))
        assertTrue(twice.entities.values.any { it.type == "road-segment" })
        assertTrue(outposts.all { outpost -> twice.entities.values.any { it.type == NativeNpcRules.WANDERER_TYPE && kotlin.math.abs(it.coordinates.x - outpost.x) <= 1 } })
        val center = NativeNpcRules.villageCenter(initial.seed)
        val roads = NativeNpcRules.villageRoadCells(center)
        assertTrue(roads.isNotEmpty())
        assertTrue(listOf("village-shelter", "village-workbench", "village-campfire", "village-storage", "village-garden", "village-drying", "village-mat")
            .mapNotNull(twice.entities::get).none { it.coordinates in roads })
        assertNotEquals(Coordinates(8, 8), NativeNpcRules.villageCenter(initial.seed))
    }

    @Test fun firstAtuoEncounterShowsInjuryAndAdvancesTheRealTutorial() {
        val initial = NativeNpcRules.ensureStarter(SurvivalSimulation.create("atuo-first-scene")).copy(
            milestones = mapOf("tutorial:moved" to true, NativeNpcRules.VILLAGE_MILESTONE to true),
        )
        val builderBefore = requireNotNull(initial.entities[NativeNpcRules.BUILDER_ID])
        assertTrue(builderBefore.durability < builderBefore.maxDurability)
        assertTrue(NativeNpcRules.needsFirstEncounter(initial))

        val met = NativeNpcRules.beginFirstEncounter(initial)
        assertFalse(NativeNpcRules.needsFirstEncounter(met))
        assertTrue(met.milestones[NativeNpcRules.ATUO_MET_MILESTONE] == true)
        assertTrue(met.milestones[NativeNpcRules.ATUO_TALKED_MILESTONE] == true)
        assertEquals("tutorial-gather", GuidanceEngine.current(met).id)
        assertTrue(NativeNpcRules.firstEncounterDialogue().contains("受伤"))
        assertTrue(NativeNpcRules.firstEncounterDialogue().contains("天黑前"))
        assertEquals(met, NativeNpcRules.beginFirstEncounter(met))
    }

    @Test fun villagersWalkDeterministicallyAndTradesConsumeRealItems() {
        val initial = NativeNpcRules.ensureStarter(SurvivalSimulation.create("village-trade")).copy(
            inventory = mapOf("stone" to 3, "berry" to 3),
            time = 510,
        )
        val moved = NativeNpcRules.advanceResidents(initial)
        assertEquals(moved, NativeNpcRules.advanceResidents(moved))
        assertNotEquals(initial.entities[NativeNpcRules.TRADER_ID]?.coordinates, moved.entities[NativeNpcRules.TRADER_ID]?.coordinates)
        val traded = NativeNpcRules.trade(moved, NativeNpcRules.TRADER_TYPE, "stone-for-millet")
        assertEquals(0, traded.inventory["stone"] ?: 0)
        assertEquals(2, traded.inventory["millet-seed"])
        val farmTrade = NativeNpcRules.trade(traded, NativeNpcRules.FARMER_TYPE, "berry-for-herb")
        assertEquals(0, farmTrade.inventory["berry"] ?: 0)
        assertEquals(2, farmTrade.inventory["herb-seed"])
    }

    @Test fun recruitConsumesActualCampSupplies() {
        val base = NativeNpcRules.ensureStarter(SurvivalSimulation.create("recruit")).copy(
            inventory = mapOf("fresh-water" to 10, "coconut" to 6, "reef-fish" to 4),
            entities = mapOf(
                NativeNpcRules.BUILDER_ID to Entity(NativeNpcRules.BUILDER_ID, NativeNpcRules.BUILDER_TYPE, Coordinates(9, 9)),
                "bed" to Entity("bed", "shelter", Coordinates(7, 7)),
            ),
        )
        val recruited = NativeNpcRules.recruit(base, setOf("coconut", "reef-fish"))
        assertTrue(NativeNpcRules.isRecruited(recruited))
        assertEquals(0, recruited.inventory["fresh-water"] ?: 0)
        assertEquals(0, recruited.inventory["coconut"] ?: 0)
        assertEquals(0, recruited.inventory["reef-fish"] ?: 0)
    }

    @Test fun settlementBuildingsDoNotCountAsThePlayersRecruitmentBed() {
        val settlementOnly = NativeNpcRules.ensureStarter(SurvivalSimulation.create("recruit-owned-bed")).copy(
            inventory = mapOf("fresh-water" to 10, "coconut" to 10),
        )
        val failure = runCatching { NativeNpcRules.recruit(settlementOnly, setOf("coconut")) }.exceptionOrNull()
        assertNotNull(failure)
        assertTrue(failure?.message.orEmpty().contains("自己的"))

        val withPlayerBed = settlementOnly.copy(entities = settlementOnly.entities + (
            "player-bed" to Entity("player-bed", "shelter", Coordinates(7, 7))
        ))
        assertTrue(NativeNpcRules.isRecruited(NativeNpcRules.recruit(withPlayerBed, setOf("coconut"))))
    }

    @Test fun independentWanderersCanTalkWithoutPretendingTheyWereRecruited() {
        val wanderer = Entity("outpost-survivor-1", NativeNpcRules.WANDERER_TYPE, Coordinates(20, 20))
        val reply = NativeNpcRules.localDialogue(wanderer, "你能加入营地吗？", recruited = true)
        assertTrue(reply.contains("还没打算搬进营地"))
        assertFalse(reply.contains("已经是营地的一员"))
    }
}
