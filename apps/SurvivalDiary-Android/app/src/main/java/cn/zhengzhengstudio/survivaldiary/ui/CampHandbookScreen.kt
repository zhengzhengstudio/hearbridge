package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun CampHandbookScreen(openCompendium: () -> Unit, openMap: () -> Unit, openDiary: () -> Unit, openSystem: () -> Unit, openOnline: () -> Unit, close: () -> Unit) {
    GamePanelSurface("营地手册", "低频功能集中在这里，世界画面保持清爽", close) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("记录", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
            GameButton(label = "海岛图鉴 · 物品、配方与发现关系", onClick = openCompendium)
            GameButton(label = "无边海图 · 地形与探索范围", onClick = openMap)
            GameButton(label = "生存日记 · 今天与往日记录", onClick = openDiary)
            Text("联机", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
            GameButton(label = "公共岛 · 2 至 4 人协作与聊天", onClick = openOnline)
            Text("配置", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
            GameButton(label = "设置、更新与重新开始", variant = GameButtonVariant.GHOST, onClick = openSystem)
        }
    }
}
