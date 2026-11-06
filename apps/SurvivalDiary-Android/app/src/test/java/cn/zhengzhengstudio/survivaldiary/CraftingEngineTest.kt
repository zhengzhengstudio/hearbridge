package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.CraftingEngine
import cn.zhengzhengstudio.survivaldiary.domain.GameSave
import cn.zhengzhengstudio.survivaldiary.domain.RecipeDefinition
import cn.zhengzhengstudio.survivaldiary.domain.ToolDurabilityEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CraftingEngineTest {
    private val pickaxe = RecipeDefinition(
        id = "craft-stone-pickaxe",
        station = "hand",
        durationSeconds = 22,
        ingredients = mapOf("branch" to 2, "stone" to 3, "rope" to 1),
        outputItemId = "stone-pickaxe",
        outputAmount = 1,
    )

    @Test fun `stone pickaxe recipe consumes materials and creates the required tool`() {
        val save = GameSave(seed = "test", inventory = mapOf("branch" to 2, "stone" to 3, "rope" to 1))
        val result = CraftingEngine.craft(save, pickaxe, setOf("hand"))
        assertEquals(1, result.inventory["stone-pickaxe"])
        assertTrue("branch" !in result.inventory)
        assertTrue("stone" !in result.inventory)
        assertEquals(ToolDurabilityEngine.maximum("stone-pickaxe"), result.toolDurability["stone-pickaxe"])
    }

    @Test(expected = IllegalArgumentException::class)
    fun `station recipes stay visible but cannot craft without placed station`() {
        CraftingEngine.craft(
            GameSave(seed = "test", inventory = mapOf("stone" to 2)),
            pickaxe.copy(station = "workbench", ingredients = mapOf("stone" to 2)),
            setOf("hand"),
        )
    }
}
