package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.GameSave

@Composable
fun DiaryScreen(save: GameSave, itemNames: Map<String, String>, onSave: (String) -> Unit, onClose: () -> Unit) {
    val todayKey = "day-${save.day}"
    var text by remember(save.day) { mutableStateOf(save.journals[todayKey]?.text.orEmpty()) }
    val previousEntries = save.journals.entries
        .filter { it.key != todayKey && it.value.text.isNotBlank() }
        .sortedByDescending { it.key.removePrefix("day-").toIntOrNull() ?: 0 }

    GamePanelSurface("生存日记", "第 ${save.day} 天 · 自动保存", onClose, heightFraction = 0.84f) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(Modifier.fillMaxWidth().background(Color(0xFFF0E1BE), SurvivalTheme.DangerShape).padding(13.dp)) {
                    Text(
                        "${diaryWeatherName(save.weather.kind)} · 已探索 ${save.discoveredChunks.size.coerceAtLeast(1)} 个区块 · 已放置 ${save.entities.size} 件设施",
                        color = Color(0xFF765D45), style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        "发现：${save.inventory.filterValues { it > 0 }.keys.take(8).joinToString("、") { itemNames[it] ?: it }.ifBlank { "等待探索" }}",
                        color = Color(0xFF765D45), style = MaterialTheme.typography.bodySmall, maxLines = 2,
                    )
                }
            }
            item {
                Text("写下今天", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 132.dp, max = 220.dp)
                        .clip(SurvivalTheme.PanelShape).background(Color(0xFFFFF8E7))
                        .border(1.dp, SurvivalTheme.BrownLine, SurvivalTheme.PanelShape).padding(12.dp),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(color = Color(0xFF3E3325)),
                    cursorBrush = SolidColor(Color(0xFF9A7040)),
                    decorationBox = { innerTextField ->
                        Box {
                            if (text.isEmpty()) Text("潮声、天气、发现和你建造的东西……", color = Color(0xFF9A8B78))
                            innerTextField()
                        }
                    },
                )
                Spacer(Modifier.height(8.dp))
                GameButton(label = "保存今天的日记", modifier = Modifier.fillMaxWidth(), onClick = { onSave(text) })
            }
            item {
                Text("以前的日记", color = SurvivalTheme.Paper, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                if (previousEntries.isEmpty()) {
                    Text("还没有旧日记。保存今天后，之后可以随时回来翻看。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        previousEntries.take(12).forEach { (key, entry) ->
                            Column(
                                Modifier.fillMaxWidth().clip(SurvivalTheme.PanelShape)
                                    .background(Color(0xFF202A24)).border(1.dp, SurvivalTheme.BrownSoft, SurvivalTheme.PanelShape)
                                    .padding(11.dp),
                                verticalArrangement = Arrangement.spacedBy(3.dp),
                            ) {
                                Text("第 ${key.removePrefix("day-")} 天", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold)
                                Text(entry.text, color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall, maxLines = 4)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun diaryWeatherName(kind: String) = when (kind) {
    "clear" -> "晴朗"; "cloudy" -> "多云"; "fog" -> "有雾"; "rain" -> "下雨"
    "storm" -> "风暴"; "snow" -> "下雪"; "blizzard" -> "暴雪"; else -> "天气变化中"
}
