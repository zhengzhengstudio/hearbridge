package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.CraftingEngine

@Composable
fun CraftingScreen(state: GameUiState, craft: (String) -> Unit, openCompendium: () -> Unit, close: () -> Unit) {
    val stations = setOf("hand", state.activeCraftStation)
    val knownItems = state.save.milestones.filterValues { it }.keys.filter { it.startsWith("item:") }.mapTo(mutableSetOf()) { it.removePrefix("item:") }
        .apply { addAll(state.save.inventory.filterValues { it > 0 }.keys) }
    val directRecipes = state.recipes.filter { it.station != "furnace" }
    val visibleRecipes = directRecipes.filter { RecipeUnlockPolicy.isVisible(it, knownItems, stations) }
    val hiddenCount = directRecipes.size - visibleRecipes.size
    GamePanelSurface("制作图鉴", "探索材料并放置制作设施来解锁配方 · 尚有 $hiddenCount 份未知配方", close) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "open-compendium") {
                GameButton(
                    label = "海岛图鉴 · 查看材料、配方与设施解锁关系",
                    variant = GameButtonVariant.GHOST,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = openCompendium,
                )
            }
            if ((state.save.inventory["stone-machete"] ?: 0) <= 0) {
                item(key = "route-stone-machete") { CraftingRouteCard(CraftingGuide.routeFor("stone-machete"), state) }
            } else if ((state.save.inventory["machete"] ?: 0) <= 0) {
                item(key = "route-machete") { CraftingRouteCard(CraftingGuide.routeFor("machete"), state) }
            }
            visibleRecipes.groupBy { it.station }.forEach { (station, recipes) ->
                item(key = "station-$station") {
                    Text(stationName(station), color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold)
                }
                items(recipes, key = { it.id }) { recipe ->
                    val canCraft = CraftingEngine.canCraft(state.save, recipe, stations)
                    val newlyLinked = recipe.id in state.highlightedRecipeIds
                    val materials = recipe.ingredients.entries.joinToString(" · ") { (id, amount) ->
                        "${state.itemNames[id] ?: id} ${state.save.inventory[id] ?: 0}/$amount"
                    }
                    val hasMissingMaterial = recipe.ingredients.any { (id, amount) -> (state.save.inventory[id] ?: 0) < amount }
                    Row(
                        Modifier.fillMaxWidth().background(if (newlyLinked) Color(0xFFE7CDA3) else Color(0xFFE4D5B6), SurvivalTheme.PanelShape)
                            .border(if (newlyLinked) 2.dp else 1.dp, if (newlyLinked) Color(0xFFC7443A) else SurvivalTheme.BrownLine, SurvivalTheme.PanelShape)
                            .padding(12.dp),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        ItemIcon(recipe.outputItemId, state.items[recipe.outputItemId], Modifier.size(48.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(state.itemNames[recipe.outputItemId] ?: recipe.outputItemId, color = Color(0xFF2D271F), fontWeight = FontWeight.Bold)
                            Text(materials, color = if (canCraft) Color(0xFF396844) else if (hasMissingMaterial) Color(0xFF9E3F35) else Color(0xFF765F3E), style = MaterialTheme.typography.bodySmall)
                            if (newlyLinked) Text("新材料可用于这份配方", color = Color(0xFFC7443A), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                            if (recipe.station !in stations) Text("需要 ${stationName(recipe.station)}", color = Color(0xFF8B4D2E), style = MaterialTheme.typography.labelSmall)
                        }
                        GameButton(
                            label = "制作",
                            enabled = canCraft,
                            variant = GameButtonVariant.PRIMARY,
                            modifier = Modifier.widthIn(min = 88.dp),
                            onClick = { craft(recipe.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CraftingRouteCard(route: CraftingRoute, state: GameUiState) {
    val hasWorkbench = state.save.entities.values.any { it.type == "workbench" }
    val hasFurnace = state.save.entities.values.any { it.type == "furnace" }
    Box(Modifier.clip(SurvivalTheme.PanelShape).background(Color(0xEE17231F)).padding(13.dp)) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("追踪制作", color = SurvivalTheme.Sun, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Text(route.title, color = SurvivalTheme.Paper, fontWeight = FontWeight.Black)
            }
            route.steps.forEachIndexed { index, step ->
                val reached = when (index) {
                    0 -> (state.save.inventory["stone-axe"] ?: 0) > 0 && (state.save.inventory["stone-pickaxe"] ?: 0) > 0
                    1 -> hasWorkbench
                    2 -> hasFurnace
                    3 -> (state.save.inventory["copper-ore"] ?: 0) > 0 && (state.save.inventory["tin-ore"] ?: 0) > 0
                    4 -> (state.save.inventory["bronze-ingot"] ?: 0) >= 2
                    else -> false
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.Top) {
                    Text(if (reached) "✓" else "${index + 1}", color = if (reached) Color(0xFF82B77D) else SurvivalTheme.Sun, fontWeight = FontWeight.Black)
                    Text(step, color = if (reached) Color(0xFF91A197) else Color(0xFFE9DDC1), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

private fun stationName(id: String) = when (id) {
    "hand" -> "随身制作"
    "workbench" -> "工作台"
    "furnace" -> "熔炉"
    "cooking-pot" -> "烹饪锅"
    "drying-shed" -> "晾晒棚"
    "medicine-table" -> "医药台"
    else -> id
}
