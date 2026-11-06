package cn.zhengzhengstudio.survivaldiary.domain

data class RecipeDefinition(
    val id: String,
    val station: String,
    val durationSeconds: Int,
    val ingredients: Map<String, Int>,
    val outputItemId: String,
    val outputAmount: Int,
    val fuelItemId: String? = null,
    val fuelAmount: Int = 0,
)

object CraftingEngine {
    fun canCraft(save: GameSave, recipe: RecipeDefinition, stations: Set<String>): Boolean =
        recipe.station in stations && recipe.ingredients.all { (id, amount) -> (save.inventory[id] ?: 0) >= amount }

    fun craft(save: GameSave, recipe: RecipeDefinition, stations: Set<String>): GameSave {
        require(recipe.station in stations) { "需要 ${recipe.station}" }
        require(recipe.ingredients.all { (id, amount) -> (save.inventory[id] ?: 0) >= amount }) { "材料不足" }
        val inventory = save.inventory.toMutableMap()
        recipe.ingredients.forEach { (id, amount) ->
            val next = inventory.getValue(id) - amount
            if (next == 0) inventory.remove(id) else inventory[id] = next
        }
        inventory[recipe.outputItemId] = (inventory[recipe.outputItemId] ?: 0) + recipe.outputAmount
        return ToolDurabilityEngine.registerCraft(save.copy(inventory = inventory), recipe.outputItemId)
    }
}
