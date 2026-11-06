package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.update.ReleaseUpdate

@Composable
fun SystemScreen(version: String, build: Int, checking: Boolean, update: ReleaseUpdate?, onCheck: () -> Unit, onRestart: () -> Unit, close: () -> Unit) {
    var confirmingRestart by remember { mutableStateOf(false) }
    GamePanelSurface("系统", "版本 $version · build $build", close, heightFraction = 0.76f) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
          item {
           Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            SectionTitle("游戏更新")
            Text(
                update?.let { "发现 ${it.version} build ${it.build}，返回游戏后会弹出下载窗口。" }
                    ?: "更新检查不会常驻占用游戏顶部。发现新版本时会弹出独立窗口，并显示真实下载进度。",
                color = SurvivalTheme.PaperDim,
                style = MaterialTheme.typography.bodyMedium,
            )
            GameButton(
                label = if (checking) "正在检查" else "检查更新",
                enabled = !checking,
                modifier = Modifier.fillMaxWidth(),
                onClick = onCheck,
            )
            HorizontalDivider()
            SectionTitle("提示")
            Text("石斧用于树木和竹林，石镐用于岩石与矿脉。背包有重量上限，制作背包可扩容。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
            HorizontalDivider()
            SectionTitle("世界存档")
            Text("重新开始会永久删除当前世界、背包、建筑、任务和日记。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
            GameButton(
                label = "重新开始",
                variant = GameButtonVariant.DANGER,
                modifier = Modifier.fillMaxWidth(),
                onClick = { confirmingRestart = true },
            )
           }
          }
        }
    }
    if (confirmingRestart) {
        GameDialog(
            title = "确认重新开始？",
            body = "这个操作无法撤销。当前岛屿、背包、建筑和日记都会被删除。",
            confirm = "确认删除并重新开始" to { confirmingRestart = false; onRestart() },
            dismiss = "保留当前世界" to { confirmingRestart = false },
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, color = SurvivalTheme.Paper, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
}

@Composable
private fun HorizontalDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFF42534E)))
}

@Composable
private fun GameDialog(title: String, body: String, confirm: Pair<String, () -> Unit>, dismiss: Pair<String, () -> Unit>) {
    Box(
        Modifier.fillMaxSize().background(Color(0xCC000000)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 320.dp).padding(16.dp)
                .clip(SurvivalTheme.PanelShape)
                .border(1.dp, Color(0xFF7D6A3E), SurvivalTheme.PanelShape)
                .background(SurvivalTheme.Night)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Text(body, color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(4.dp))
            GameButton(label = confirm.first, onClick = confirm.second)
            GameButton(label = dismiss.first, variant = GameButtonVariant.GHOST, onClick = dismiss.second)
        }
    }
}
