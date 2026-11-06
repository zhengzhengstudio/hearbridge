package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.StorageRules

@Composable
fun StorageScreen(
    state: GameUiState,
    deposit: (String, Int) -> Unit,
    withdraw: (String, Int) -> Unit,
    close: () -> Unit,
) {
    val storage = state.save.containerInventories[state.activeStorageId].orEmpty()
    val limits = state.items.mapValues { it.value.stackLimit }
    val slots = StorageRules.slotsUsed(storage, limits)
    GamePanelSurface("储物箱", "$slots / ${StorageRules.MAX_SLOTS} 格", close) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val compact = maxWidth < 680.dp
            if (compact) {
                var tab by remember { mutableIntStateOf(0) }
                Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().background(Color(0xFF211A14))) {
                        GameTab("背包 ${state.save.inventory.count { it.value > 0 }}", tab == 0) { tab = 0 }
                        GameTab("箱内 ${storage.count { it.value > 0 }}", tab == 1) { tab = 1 }
                    }
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (tab == 0) StorageColumn("背包", state.save.inventory, state, "存入", deposit)
                        else StorageColumn("箱内", storage, state, "取回", withdraw)
                    }
                }
            } else Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) { StorageColumn("背包", state.save.inventory, state, "存入", deposit) }
                Box(Modifier.weight(1f)) { StorageColumn("箱内", storage, state, "取回", withdraw) }
            }
        }
    }
}

@Composable
private fun RowScope.GameTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(Modifier.weight(1f).clip(SurvivalTheme.PanelShape).background(if (selected) Color(0xFF3A2E20) else Color.Transparent)
        .border(1.dp, if (selected) SurvivalTheme.Sun else Color(0xFF5A4F45), SurvivalTheme.PanelShape)
        .clickable(onClick = onClick).padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Text(label, color = if (selected) SurvivalTheme.Sun else SurvivalTheme.PaperDim, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
    }
}

@Composable
private fun StorageColumn(
    title: String,
    inventory: Map<String, Int>,
    state: GameUiState,
    action: String,
    transfer: (String, Int) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(Color(0xFF1E2923), SurvivalTheme.PanelShape).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold, color = SurvivalTheme.Sun)
        val entries = inventory.entries.filter { it.value > 0 }.sortedBy { state.itemNames[it.key] ?: it.key }
        if (entries.isEmpty()) Text("这里还没有物品", color = Color(0xFFB7AA8D))
        else LazyColumn(Modifier.fillMaxWidth().weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            items(entries, key = { it.key }) { entry ->
                Row(
                    Modifier.fillMaxWidth().background(Color(0xFF29352E), SurvivalTheme.PanelShape).padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ItemIcon(entry.key, state.items[entry.key], Modifier.size(42.dp))
                    Column(Modifier.weight(1f)) {
                        Text(state.itemNames[entry.key] ?: entry.key, color = SurvivalTheme.Paper, fontWeight = FontWeight.SemiBold)
                        Text("数量 ${entry.value}", style = MaterialTheme.typography.labelSmall, color = Color(0xFFB7AA8D))
                    }
                    GameButton(label = action, modifier = Modifier.widthIn(min = 88.dp), onClick = { transfer(entry.key, minOf(entry.value, state.items[entry.key]?.stackLimit ?: 30)) })
                }
            }
        }
    }
}
