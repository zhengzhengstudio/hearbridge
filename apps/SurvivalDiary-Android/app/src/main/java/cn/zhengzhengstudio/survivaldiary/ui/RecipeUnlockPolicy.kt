package cn.zhengzhengstudio.survivaldiary.ui

import cn.zhengzhengstudio.survivaldiary.domain.RecipeDefinition

object RecipeUnlockPolicy {
    fun isVisible(recipe: RecipeDefinition, knownItems: Set<String>, stations: Set<String>): Boolean =
        recipe.outputItemId in knownItems ||
            recipe.ingredients.keys.any(knownItems::contains) ||
            (recipe.station != "hand" && recipe.station in stations)

    fun isUnlocked(recipe: RecipeDefinition, knownItems: Set<String>, stations: Set<String>): Boolean =
        recipe.station in stations && recipe.ingredients.keys.all(knownItems::contains)

    fun newlyVisibleRecipes(
        recipes: List<RecipeDefinition>,
        beforeItems: Set<String>,
        afterItems: Set<String>,
        beforeStations: Set<String>,
        afterStations: Set<String>,
    ): List<RecipeDefinition> = recipes.filter {
        isVisible(it, afterItems, afterStations) && !isVisible(it, beforeItems, beforeStations)
    }
}
