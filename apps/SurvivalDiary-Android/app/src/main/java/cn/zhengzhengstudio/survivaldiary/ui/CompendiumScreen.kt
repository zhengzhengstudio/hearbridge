package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun CompendiumScreen(state: GameUiState, close: () -> Unit) {
    val knownItems = state.save.milestones.filterValues { it }.keys
        .filter { it.startsWith("item:") }.mapTo(mutableSetOf()) { it.removePrefix("item:") }
    val stations = setOf("hand") + state.save.entities.values.map { it.type }
    val recipeOutputs = state.recipes.filter { RecipeUnlockPolicy.isVisible(it, knownItems, stations) }
        .mapTo(mutableSetOf()) { it.outputItemId }
    val visibleIds = state.gatherableItemIds + knownItems + recipeOutputs
    val entries = state.items.values.filter { it.id in visibleIds }
        .sortedWith(compareBy({ it.id !in knownItems }, { it.category }, { it.name }))

    GamePanelSurface("海岛图鉴", "可直接采集的资源会先显示；取得材料后，关联配方和下一级产物会逐步展开", close) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(entries, key = { it.id }) { item ->
                val collected = item.id in knownItems
                val direct = item.id in state.gatherableItemIds
                Box(
                    Modifier.fillMaxWidth().background(if (collected) Color(0xFFF5E9CA) else Color(0xFFE2DED2), RoundedCornerShape(8.dp)).padding(10.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(54.dp).background(Color(0x223F6D4E), RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                            ItemIcon(item.id, item, Modifier.size(48.dp))
                        }
                        Column(Modifier.weight(1f).padding(start = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(item.name, fontWeight = FontWeight.Bold, color = Color(0xFF292C29))
                            Text(
                                when {
                                    collected -> "已取得 · ${item.use.ifBlank { categoryName(item.category) }}"
                                    direct -> "岛上可直接采集 · 尚未取得"
                                    else -> "关联配方已发现 · 制作后记录完整信息"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = if (collected) Color(0xFF3F6D4E) else Color(0xFF766F63),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun categoryName(category: String) = when (category) {
    "food" -> "食物"
    "tool" -> "工具"
    "building" -> "设施"
    "medicine" -> "药品"
    "equipment" -> "装备"
    else -> "材料"
}
