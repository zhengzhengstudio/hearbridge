package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import cn.zhengzhengstudio.survivaldiary.game.PlayerMotion
import cn.zhengzhengstudio.survivaldiary.game.WorldPoint
import org.junit.Assert.*
import org.junit.Test

class Release100ParityTest {
    @Test fun `dropping and picking up is persistent and idempotent`() {
        val start = SurvivalSimulation.create("drop-parity").copy(
            inventory = mapOf("stone" to 3),
            players = mapOf("local" to PlayerRecord("local", PlayerPosition(8.5, 9.25))),
        )

        val dropped = NativeInventoryRules.drop(start, "stone", 2, "drop-1")
        assertEquals(1, dropped.inventory["stone"])
        assertEquals(2, dropped.groundItems["ground-drop-1"]?.amount)
        assertEquals(8.9, dropped.groundItems["ground-drop-1"]?.x ?: 0.0, 0.001)
        assertEquals(9.5, dropped.groundItems["ground-drop-1"]?.y ?: 0.0, 0.001)
        assertEquals(dropped, NativeInventoryRules.drop(dropped, "stone", 2, "drop-1"))

        val picked = NativeInventoryRules.pickup(dropped, "ground-drop-1")
        assertEquals(3, picked.inventory["stone"])
        assertFalse("ground-drop-1" in picked.groundItems)
        assertEquals(picked, NativeInventoryRules.pickup(picked, "ground-drop-1"))
    }

    @Test fun `large movement steps cannot tunnel through blocked terrain`() {
        val motion = PlayerMotion(position = WorldPoint(0f, 0f), speed = 200f)
        assertFalse(motion.moveTo(WorldPoint(100f, 0f)) { point -> point.x !in 40f..60f })

        motion.advance(1f)

        assertEquals(0f, motion.position.x, 0.001f)
        assertFalse(motion.isMoving)
    }

    @Test fun `food applies concrete recovery instead of a text only action`() {
        val before = SurvivalSimulation.create("meal").copy(
            inventory = mapOf("grilled-fish" to 1),
            vitals = Vitals(health = 70.0, stamina = 50.0, hunger = 40.0, hydration = 60.0),
        )

        val after = ConsumptionEngine.consume(before, "grilled-fish", ConsumableCatalog.effect("grilled-fish")!!)

        assertEquals(72.0, after.vitals.health, 0.001)
        assertEquals(58.0, after.vitals.stamina, 0.001)
        assertEquals(78.0, after.vitals.hunger, 0.001)
        assertFalse(after.inventory.containsKey("grilled-fish"))
    }
}
