package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import org.junit.Assert.*
import org.junit.Test

class SurvivalLoopTest {
    @Test fun `eating consumes one item and restores clamped survival values`() {
        val save = GameSave(
            seed = "food",
            inventory = mapOf("fruit-bowl" to 2),
            vitals = Vitals(health = 92.0, stamina = 70.0, hunger = 61.0, hydration = 75.0, effects = listOf("starving")),
        )

        val result = ConsumptionEngine.consume(save, "fruit-bowl", ConsumableEffect(hunger = 32.0, hydration = 18.0, stamina = 8.0, health = 4.0))

        assertEquals(1, result.inventory["fruit-bowl"])
        assertEquals(93.0, result.vitals.hunger, 0.001)
        assertEquals(93.0, result.vitals.hydration, 0.001)
        assertEquals(78.0, result.vitals.stamina, 0.001)
        assertEquals(96.0, result.vitals.health, 0.001)
        assertFalse("starving" in result.vitals.effects)
        assertTrue(result.milestones["consumed:any"] == true)
        assertNotNull(ConsumableCatalog.effect("fresh-water"))
    }

    @Test fun `inventory mass and backpack upgrades enforce a finite capacity`() {
        val masses = mapOf("stone" to 1.2, "branch" to 0.5, "small-backpack" to 0.8, "frame-backpack" to 1.8)
        assertEquals(18.0, InventoryRules.capacity(emptyMap()), 0.001)
        assertEquals(28.0, InventoryRules.capacity(mapOf("small-backpack" to 1)), 0.001)
        assertEquals(38.0, InventoryRules.capacity(mapOf("small-backpack" to 2)), 0.001)
        assertEquals(40.0, InventoryRules.capacity(mapOf("frame-backpack" to 1)), 0.001)
        assertEquals(50.0, InventoryRules.capacity(mapOf("small-backpack" to 1, "frame-backpack" to 1)), 0.001)
        assertFalse(InventoryRules.canAdd(mapOf("stone" to 15), "branch", 1, masses))
        assertTrue(InventoryRules.canAdd(mapOf("stone" to 14), "branch", 1, masses))
    }

    @Test fun `tools lose durability per action and break only when durability reaches zero`() {
        val fresh = GameSave(seed = "wear", inventory = mapOf("stone-machete" to 1), toolDurability = mapOf("stone-machete" to 3))
        val worn = ToolDurabilityEngine.use(fresh, "stone-machete", 2)
        assertEquals(1, worn.toolDurability["stone-machete"])
        assertEquals(1, worn.inventory["stone-machete"])

        val broken = ToolDurabilityEngine.use(worn, "stone-machete", 1)
        assertFalse("stone-machete" in broken.inventory)
        assertFalse("stone-machete" in broken.toolDurability)
        assertTrue(broken.milestones["broken:stone-machete"] == true)
    }

    @Test fun `axe and pickaxe never satisfy the same harvest requirement`() {
        assertTrue(ToolCompatibility.canHarvest(listOf("axe"), setOf("stone-axe")))
        assertFalse(ToolCompatibility.canHarvest(listOf("pickaxe"), setOf("stone-axe")))
        assertTrue(ToolCompatibility.canHarvest(listOf("pickaxe"), setOf("stone-pickaxe")))
        assertFalse(ToolCompatibility.canHarvest(listOf("axe"), setOf("stone-pickaxe")))
    }

    @Test fun `guided objective advances from foraging through first night preparation`() {
        val initial = SurvivalSimulation.create("guide").copy(
            inventory = mapOf("branch" to 1, "stone" to 2, "palm-fiber" to 4),
            milestones = mapOf("tutorial:moved" to true, "meet_atuo" to true),
        )
        assertEquals("tools", GuidanceEngine.current(initial).id)

        val equipped = initial.copy(
            inventory = initial.inventory + mapOf("stone-axe" to 1, "coconut" to 1, "palm-fiber" to 5),
            milestones = initial.milestones + mapOf("collected:fresh-water" to true),
        )
        assertEquals("fire", GuidanceEngine.current(equipped).id)

        val camp = equipped.copy(
            entities = equipped.entities + ("fire" to Entity("fire", "campfire", Coordinates(4, 4))),
        )
        assertEquals("shelter", GuidanceEngine.current(camp).id)

        val sheltered = camp.copy(entities = camp.entities + ("shelter" to Entity("shelter", "shelter", Coordinates(5, 4))))
        assertEquals("meal", GuidanceEngine.current(sheltered).id)
        val fed = sheltered.copy(milestones = sheltered.milestones + ("consumed:any" to true))
        assertEquals("rest", GuidanceEngine.current(fed).id)
    }

    @Test fun `new player tutorial follows real movement materials water tool and food actions`() {
        val fresh = SurvivalSimulation.create("tutorial")
        assertEquals("tutorial-move", GuidanceEngine.current(fresh).id)

        val moved = fresh.copy(milestones = fresh.milestones + ("tutorial:moved" to true))
        assertEquals("tutorial-atuo", GuidanceEngine.current(moved).id)

        val met = moved.copy(milestones = moved.milestones + ("meet_atuo" to true))
        assertEquals("tutorial-gather", GuidanceEngine.current(met).id)

        val gathered = met.copy(inventory = met.inventory + mapOf("branch" to 1, "stone" to 2, "palm-fiber" to 4))
        assertEquals("tools", GuidanceEngine.current(gathered).id)

        val equipped = gathered.copy(inventory = gathered.inventory + ("stone-machete" to 1))
        assertEquals("water-food", GuidanceEngine.current(equipped).id)

        val supplied = equipped.copy(
            inventory = equipped.inventory + mapOf("coconut" to 1, "palm-fiber" to 5),
            milestones = equipped.milestones + ("collected:fresh-water" to true),
        )
        assertEquals("fire", GuidanceEngine.current(supplied).id)
    }

    @Test fun `opening chapter has an explicit completion state without ending the open game`() {
        val completed = SurvivalSimulation.create("chapter").copy(
            inventory = mapOf("fresh-water" to 1, "coconut" to 1, "stone-axe" to 1, "branch" to 1, "stone" to 2, "palm-fiber" to 5),
            entities = mapOf(
                "fire" to Entity("fire", "campfire", Coordinates(1, 1)),
                "shelter" to Entity("shelter", "shelter", Coordinates(2, 2)),
            ),
            milestones = mapOf("tutorial:moved" to true, "meet_atuo" to true, "consumed:any" to true, "slept:any" to true),
            discoveredChunks = mapOf("0,0" to DiscoveredChunk(0, 0), "1,0" to DiscoveredChunk(1, 0)),
        )
        assertTrue(GuidanceEngine.isOpeningChapterComplete(completed))
        assertTrue(GuidanceEngine.current(completed).title.startsWith("岛屿传闻"))
        assertEquals("向迷雾前进", GuidanceEngine.current(completed).progress)
    }

    @Test fun `fresh water collection completes the forage objective even after the water was used`() {
        val save = SurvivalSimulation.create("water-guide").copy(
            inventory = mapOf("branch" to 1, "stone" to 2, "palm-fiber" to 4, "stone-axe" to 1),
            milestones = mapOf("tutorial:moved" to true, "meet_atuo" to true, "collected:fresh-water" to true),
        )

        assertEquals("water-food", GuidanceEngine.current(save).id)
        assertTrue(GuidanceEngine.current(save).progress.startsWith("水 1/1"))
    }

    @Test fun `hotbar is an explicit eight slot loadout instead of the first eight inventory entries`() {
        val inventory = linkedMapOf("stone" to 3, "branch" to 2, "stone-axe" to 1)
        val empty = List<String?>(8) { null }
        val equipped = HotbarRules.assign(empty, 3, "stone-axe", inventory)

        assertEquals("stone-axe", equipped[3])
        assertNull(equipped[0])
        assertEquals(empty, HotbarRules.remove(equipped, 3))
        assertThrows(IllegalArgumentException::class.java) { HotbarRules.assign(empty, 0, "missing", inventory) }
    }

    @Test fun `using a shelter advances time and restores stamina without ignoring hunger and thirst`() {
        val save = SurvivalSimulation.create("rest").copy(
            time = 1_200,
            vitals = Vitals(health = 70.0, stamina = 22.0, hunger = 65.0, hydration = 60.0),
        )

        val rested = ShelterRules.rest(save, "shelter")

        assertTrue(rested.day > save.day)
        assertEquals(360, rested.time)
        assertTrue(rested.vitals.stamina > save.vitals.stamina)
        assertTrue(rested.vitals.health > save.vitals.health)
        assertTrue(rested.milestones["used:shelter"] == true)
    }

    @Test fun `starvation dehydration and storms cause health loss instead of only changing labels`() {
        val exposed = SurvivalSimulation.create("danger").copy(
            weather = Weather("storm", 1.0, 1.0, 0.9),
            vitals = Vitals(health = 80.0, hunger = 0.0, hydration = 0.0, bodyTemperature = 35.0),
        )
        val result = SurvivalSimulation.advance(exposed, 75_000, SurvivalActivity.IDLE)
        assertTrue(result.vitals.health < 80.0)
        assertTrue(result.recoveryBlockers.isNotEmpty())
    }

    @Test fun `renewable resource nodes recover with world time but mineral deposits stay depleted`() {
        val water = ResourceNodeState(
            id = "water@1,1", resourceId = "fresh-water-spring", itemId = "fresh-water",
            x = 1.0, y = 1.0, remaining = 0, state = "depleted", recoveryMinutes = 60,
            maxRemaining = 3,
        )
        val stone = ResourceNodeState(
            id = "ore@2,2", resourceId = "stone-outcrop", itemId = "stone",
            x = 2.0, y = 2.0, remaining = 0, state = "depleted", recoveryMinutes = 0,
            maxRemaining = 4,
        )
        val save = SurvivalSimulation.create("recovery").copy(resourceNodes = mapOf(water.id to water, stone.id to stone))

        val halfway = SurvivalSimulation.advance(save, 37_500, SurvivalActivity.IDLE)
        assertEquals("recovering", halfway.resourceNodes.getValue(water.id).state)
        assertEquals(0, halfway.resourceNodes.getValue(water.id).remaining)

        val recovered = SurvivalSimulation.advance(halfway, 37_500, SurvivalActivity.IDLE)
        assertEquals("full", recovered.resourceNodes.getValue(water.id).state)
        assertEquals(3, recovered.resourceNodes.getValue(water.id).remaining)
        assertEquals("depleted", recovered.resourceNodes.getValue(stone.id).state)
    }
}
