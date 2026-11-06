package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class NativeInventoryAndFarmRulesTest {
    @Test fun dropAndPickupPreserveWorldPositionAndInventory() {
        val save = GameSave(seed = "drop", inventory = mapOf("coconut" to 2), players = mapOf("local" to PlayerRecord("local", PlayerPosition(12.0, 7.0))))
        val dropped = NativeInventoryRules.drop(save, "coconut", 1, "one")
        val item = dropped.groundItems["ground-one"]
        assertNotNull(item)
        assertEquals(1, dropped.inventory["coconut"])
        assertEquals(12.4, item!!.x, 0.0001)
        assertEquals(2, NativeInventoryRules.pickup(dropped, item.id).inventory["coconut"])
    }

    @Test fun cropUsesOneWaterPerSixtyIslandMinutesAndCanHarvest() {
        var save = GameSave(seed = "farm", inventory = mapOf("taro-seed" to 1, "fresh-water" to 1))
        save = NativeFarmRules.ensurePlot(save, "farm")
        save = NativeFarmRules.plant(save, "farm", 0, "taro-seed")
        save = NativeFarmRules.water(save, "farm")
        repeat(59) { save = NativeFarmRules.advance(save, 1.0) }
        assertEquals(1, save.plots.getValue("farm").water)
        save = NativeFarmRules.advance(save, 661.0)
        assertEquals("ripe", save.plots.getValue("farm").slots[0]?.stage)
        save = NativeFarmRules.harvest(save, "farm", 0)
        assertEquals(2, save.inventory["taro"])
    }

    @Test fun freshWorldHasStableBeachSpawnAndReachableSeed() {
        val first = SurvivalSimulation.create("fresh-a")
        val second = SurvivalSimulation.create("fresh-b")
        assertEquals(PlayerPosition(8.0, 8.0), first.players.getValue("local").position)
        assertEquals(first.players.getValue("local").position, second.players.getValue("local").position)
        assertEquals(1, first.inventory["taro-seed"])
    }

    @Test fun transportStarterKeepsIndustryOutOfTutorialAndMoorsBoatAtReachableShore() {
        val save = TransportRules.ensureStarter(GameSave(seed = "transport-starter"))
        assertEquals(0, save.entities.values.count { it.type == "rail-segment" })
        assertEquals(0, save.entities.values.count { it.type == "minecart" })
        assertEquals(0, save.inventory["rail-segment"] ?: 0)
        val boat = save.entities.getValue("starter-rowboat")
        val spawn = save.players["local"]?.position ?: PlayerPosition(8.0, 8.0)
        assertTrue(kotlin.math.hypot(boat.coordinates.x - spawn.x, boat.coordinates.y - spawn.y) >= 4.5)
        assertEquals("lagoon", WorldGenerator.sample(save.seed, boat.coordinates.x.toDouble(), boat.coordinates.y.toDouble()).biome)
        assertTrue(
            listOf(-1 to 0, 1 to 0, 0 to -1, 0 to 1).any { (dx, dy) ->
                WorldGenerator.sample(save.seed, (boat.coordinates.x + dx).toDouble(), (boat.coordinates.y + dy).toDouble()).height >= 0.3
            },
        )
    }

    @Test fun contextualUsePrefersPeopleAndFacilitiesOverTransportScenery() {
        assertTrue(InteractionTargetRules.priority("castaway-builder") < InteractionTargetRules.priority("rowboat"))
        assertTrue(InteractionTargetRules.priority("workbench") < InteractionTargetRules.priority("rail-segment"))
    }

    @Test fun minecartCanBeBoardedDrivenAndLeftWithPlayerAttached() {
        val rails = (0..2).associate { x -> "rail-$x" to Entity("rail-$x", "rail-segment", Coordinates(x, 0)) }
        val cart = Entity("cart", "minecart", Coordinates(0, 0))
        var save = GameSave(
            seed = "minecart",
            entities = rails + (cart.id to cart),
            players = mapOf("local" to PlayerRecord("local", PlayerPosition(0.0, 1.0))),
        )

        save = TransportRules.toggleMinecart(save, cart)
        assertEquals("cart", TransportRules.aboardMinecartId(save))
        assertEquals(PlayerPosition(0.0, 0.0), save.players.getValue("local").position)

        save = TransportRules.advanceMinecart(save, save.entities.getValue("cart"))
        assertEquals(Coordinates(1, 0), save.entities.getValue("cart").coordinates)
        assertEquals(PlayerPosition(1.0, 0.0), save.players.getValue("local").position)

        save = TransportRules.toggleMinecart(save, save.entities.getValue("cart"))
        assertEquals(null, TransportRules.aboardMinecartId(save))
        assertFalse(save.players.getValue("local").position == PlayerPosition(1.0, 0.0))
    }
}
