package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.ConsumableCatalog
import cn.zhengzhengstudio.survivaldiary.domain.InventoryRules
import cn.zhengzhengstudio.survivaldiary.domain.ToolDurabilityEngine

@Composable
fun InventoryScreen(state: GameUiState, model: GameViewModel, close: () -> Unit) {
    val capacity = InventoryRules.capacity(state.save.inventory)
    GamePanelSurface("背包", "${"%.1f".format(state.save.vitals.carriedMass)} / ${capacity.toInt()} kg", close) {
        val entries = state.save.inventory.entries.filter { it.value > 0 }
        if (entries.isEmpty()) {
            Box(Modifier.fillMaxWidth().clip(SurvivalTheme.PanelShape).background(Color(0xFF202A24)).border(1.dp, SurvivalTheme.BrownSoft, SurvivalTheme.PanelShape).padding(12.dp)) {
                Text("背包还是空的。回到岛上，靠近资源后使用金色情境动作。", color = SurvivalTheme.PaperDim)
            }
        } else {
            LazyVerticalGrid(
                GridCells.Adaptive(220.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                items(entries) { entry ->
                    val item = state.items[entry.key]
                    val hotbarSlot = state.hotbarSlots.indexOf(entry.key)
                    Column(
                        Modifier.background(Color(0xFF202A24), SurvivalTheme.PanelShape)
                            .border(1.dp, SurvivalTheme.BrownSoft, SurvivalTheme.PanelShape).padding(9.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ItemIcon(entry.key, item, Modifier.size(52.dp))
                            Spacer(Modifier.width(9.dp))
                            Column(Modifier.weight(1f)) {
                                Text(item?.name ?: "未知物品", color = SurvivalTheme.Paper, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${entry.value} 个  ·  ${"%.1f".format((item?.mass ?: 0.0) * entry.value)} kg", color = Color(0xFFA7BE99), style = MaterialTheme.typography.labelSmall)
                                ToolDurabilityEngine.maximum(entry.key)?.let { maximum ->
                                    Text("耐久 ${state.save.toolDurability[entry.key] ?: maximum} / $maximum", color = Color(0xFFB36942), style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        Text(item?.use ?: "可用于生存与制作", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            GameButton(
                                label = if (hotbarSlot >= 0) "移出快捷栏" else "放入快捷栏",
                                variant = GameButtonVariant.GHOST,
                                modifier = Modifier.weight(1f),
                                onClick = { if (hotbarSlot >= 0) model.clearHotbar(hotbarSlot) else model.equipHotbar(entry.key) },
                            )
                            when {
                                ConsumableCatalog.effect(entry.key) != null -> GameButton(label = "进食", modifier = Modifier.weight(1f), onClick = { model.consume(entry.key) })
                                item?.category == "building" -> GameButton(label = "放置", modifier = Modifier.weight(1f), onClick = { model.beginPlacement(entry.key); close() })
                            }
                        }
                        GameButton(
                            label = "丢到脚边 · 1 个",
                            variant = GameButtonVariant.DANGER,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { model.dropItem(entry.key) },
                        )
                    }
                }
            }
        }
    }
}
