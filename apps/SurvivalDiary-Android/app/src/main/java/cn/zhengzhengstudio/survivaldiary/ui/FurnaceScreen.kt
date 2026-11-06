package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.FacilityProcess
import cn.zhengzhengstudio.survivaldiary.domain.FurnaceStatus

@Composable
fun FurnaceScreen(
    state: GameUiState,
    start: (String) -> Unit,
    claim: () -> Unit,
    close: () -> Unit,
) {
    val process = state.save.facilityProcesses[state.activeFurnaceId] ?: FacilityProcess()
    val recipes = state.recipes.filter { it.station == "furnace" }
    val subtitle = when (process.status) {
        FurnaceStatus.IDLE -> "矿料与燃料分槽投入"
        FurnaceStatus.WORKING -> "熔炼中 · ${process.progressMinutes.toInt()} / ${process.durationMinutes.toInt()} 岛屿分钟"
        FurnaceStatus.READY -> "熔炼完成 · 领取后才能开始下一炉"
    }
    GamePanelSurface("石砌熔炉", subtitle, close) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            FurnaceSlot("矿料", process.input, state, Modifier.weight(1f))
            Text("+", color = SurvivalTheme.Sun, fontWeight = FontWeight.Black)
            FurnaceSlot("燃料", process.fuel, state, Modifier.weight(1f))
            Text("→", color = SurvivalTheme.Sun, fontWeight = FontWeight.Black)
            FurnaceSlot("产物", process.output, state, Modifier.weight(1f))
        }
        val progress = if (process.durationMinutes <= 0.0) 0f else (process.progressMinutes / process.durationMinutes).toFloat().coerceIn(0f, 1f)
        LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth(), color = Color(0xFFD99A4E), trackColor = Color(0xFF29352E))
        Text(
            when (process.status) {
                FurnaceStatus.IDLE -> "选择一个配方。矿料和燃料会分别消耗，队列会自动保存。"
                FurnaceStatus.WORKING -> "离开面板后熔炉仍会随岛屿时间工作。"
                FurnaceStatus.READY -> "产物仍在熔炉里，不会自动塞进背包。"
            },
            style = MaterialTheme.typography.bodySmall,
            color = SurvivalTheme.PaperDim,
        )
        if (process.status == FurnaceStatus.READY) {
            GameButton(label = "领取熔炼产物", onClick = claim)
        }
        LazyColumn(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(recipes, key = { it.id }) { recipe ->
                val ingredientText = recipe.ingredients.entries.joinToString("、") { (id, amount) -> "${state.itemNames[id] ?: id}×$amount" }
                val fuelText = recipe.fuelItemId?.let { "${state.itemNames[it] ?: it}×${recipe.fuelAmount}" } ?: "未配置"
                Row(
                    Modifier.fillMaxWidth().background(Color(0xFF30251B), SurvivalTheme.PanelShape).padding(9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    ItemIcon(recipe.outputItemId, state.items[recipe.outputItemId], Modifier.size(44.dp))
                    Column(Modifier.weight(1f)) {
                        Text(state.itemNames[recipe.outputItemId] ?: recipe.outputItemId, color = SurvivalTheme.Paper, fontWeight = FontWeight.Bold)
                        Text("矿料 $ingredientText · 燃料 $fuelText", style = MaterialTheme.typography.labelSmall, color = SurvivalTheme.PaperDim)
                    }
                    GameButton(
                        label = "熔炼",
                        enabled = process.status == FurnaceStatus.IDLE,
                        modifier = Modifier.heightIn(min = 44.dp),
                        onClick = { start(recipe.id) },
                    )
                }
            }
        }
    }
}
@Composable
private fun FurnaceSlot(title: String, items: Map<String, Int>, state: GameUiState, modifier: Modifier = Modifier) {
    val entry = items.entries.firstOrNull { it.value > 0 }
    Column(
        modifier.background(Color(0x334A3926), SurvivalTheme.PanelShape).padding(8.dp).heightIn(min = 82.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, style = MaterialTheme.typography.labelSmall, color = Color(0xFF746955))
        if (entry == null) Text("空", color = SurvivalTheme.PaperDim)
        else {
            ItemIcon(entry.key, state.items[entry.key], Modifier.size(38.dp))
            Text("${state.itemNames[entry.key] ?: entry.key} × ${entry.value}", style = MaterialTheme.typography.labelSmall, maxLines = 2)
        }
    }
}
