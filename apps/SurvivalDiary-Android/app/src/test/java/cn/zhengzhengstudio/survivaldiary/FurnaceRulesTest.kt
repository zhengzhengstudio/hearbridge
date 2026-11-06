package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FurnaceRulesTest {
    private val copper = RecipeDefinition(
        id = "smelt-copper",
        station = "furnace",
        durationSeconds = 90,
        ingredients = mapOf("copper-ore" to 3),
        outputItemId = "copper-ingot",
        outputAmount = 1,
        fuelItemId = "charcoal",
        fuelAmount = 2,
    )

    private fun save(inventory: Map<String, Int>) = GameSave(
        seed = "furnace-test",
        inventory = inventory,
        entities = mapOf("f-1" to Entity("f-1", "furnace", Coordinates(4, 4))),
    )

    @Test fun inputAndFuelAreValidatedSeparately() {
        val missingFuel = FurnaceRules.start(save(mapOf("copper-ore" to 3)), "f-1", copper)
        assertFalse(missingFuel.ok)
        assertEquals("missing-fuel", missingFuel.reasonId)
    }

    @Test fun processAdvancesWithWorldTimeAndOutputMustBeClaimed() {
        val started = FurnaceRules.start(save(mapOf("copper-ore" to 3, "charcoal" to 2)), "f-1", copper)
        assertTrue(started.ok)
        assertEquals(0, started.save.inventory["copper-ore"] ?: 0)
        assertEquals(0, started.save.inventory["charcoal"] ?: 0)

        val working = FurnaceRules.advance(started.save, 15.0)
        assertEquals(FurnaceStatus.WORKING, working.facilityProcesses.getValue("f-1").status)
        val ready = FurnaceRules.advance(working, 15.0)
        assertEquals(FurnaceStatus.READY, ready.facilityProcesses.getValue("f-1").status)
        assertEquals(1, ready.facilityProcesses.getValue("f-1").output["copper-ingot"])

        val claimed = FurnaceRules.claim(ready, "f-1")
        assertTrue(claimed.ok)
        assertEquals(1, claimed.save.inventory["copper-ingot"])
        assertEquals(FurnaceStatus.IDLE, claimed.save.facilityProcesses.getValue("f-1").status)
    }

    @Test fun sameItemUsedAsInputAndFuelConsumesTheCombinedAmount() {
        val unusualRecipe = copper.copy(
            ingredients = mapOf("charcoal" to 2),
            fuelItemId = "charcoal",
            fuelAmount = 1,
        )
        val missingCombinedAmount = FurnaceRules.start(save(mapOf("charcoal" to 2)), "f-1", unusualRecipe)
        assertFalse(missingCombinedAmount.ok)
        assertEquals("missing-fuel", missingCombinedAmount.reasonId)

        val started = FurnaceRules.start(save(mapOf("charcoal" to 3)), "f-1", unusualRecipe)
        assertTrue(started.ok)
        assertEquals(0, started.save.inventory["charcoal"] ?: 0)
    }
}
