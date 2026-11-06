package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun FarmScreen(state: GameUiState, plant: (Int, String) -> Unit, water: () -> Unit, harvest: (Int) -> Unit, close: () -> Unit) {
    val plot = state.activeFarmId?.let(state.save.plots::get)
    GamePanelSurface("九格耕作田", "水量 ${plot?.water ?: 0} / 12", close) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GameButton(label = "浇水", onClick = water)
            Text("种子会随岛屿时间生长，缺水时暂停。", modifier = Modifier.padding(top = 12.dp), color = SurvivalTheme.PaperDim)
        }
        repeat(9) { index ->
            val slot = plot?.slots?.getOrNull(index)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val cropName = when (slot?.cropId) { "taro" -> "海岛芋"; "millet" -> "粟米"; "herb" -> "药草"; else -> "空地" }
                val stage = when (slot?.stage) { "ripe" -> "成熟"; "growing" -> "生长中"; "seeded" -> "已播种"; else -> "" }
                Text("${index + 1}. $cropName${slot?.let { " · $stage ${it.progressMinutes.toInt()}/${it.durationMinutes.toInt()}" } ?: ""}", Modifier.weight(1f), color = SurvivalTheme.Paper)
                if (slot == null) {
                    listOf("taro-seed" to "芋", "millet-seed" to "粟", "herb-seed" to "药草").forEach { (id, label) ->
                        if ((state.save.inventory[id] ?: 0) > 0) GameButton(label = label, variant = GameButtonVariant.GHOST, onClick = { plant(index, id) })
                    }
                } else if (slot.stage == "ripe") GameButton(label = "收获", onClick = { harvest(index) })
            }
        }
    }
}
