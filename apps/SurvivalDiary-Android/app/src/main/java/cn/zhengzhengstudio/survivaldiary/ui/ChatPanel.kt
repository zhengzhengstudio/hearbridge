package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.network.IslandConnectionStatus

@Composable
fun ChatPanel(
    online: OnlineUiState,
    onRefresh: () -> Unit,
    onCreate: () -> Unit,
    onJoin: (String) -> Unit,
    onSend: (String) -> Unit,
    onLeave: () -> Unit,
    close: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    val connected = online.status == IslandConnectionStatus.ONLINE
    GamePanelSurface("公共岛", "本地日记不会上传，只有公共岛动作和消息会同步", close) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(when (online.status) {
                IslandConnectionStatus.LOCAL -> "当前为本地游玩"
                IslandConnectionStatus.CONNECTING -> "正在加入 ${online.islandId}"
                IslandConnectionStatus.RECONNECTING -> "连接中断，正在恢复公共岛"
                IslandConnectionStatus.OFFLINE -> "公共岛暂时离线"
                IslandConnectionStatus.ONLINE -> "已连接 ${online.islandId} · 世界版本 ${online.revision}"
            }, color = if (connected) Color(0xFF82B77D) else SurvivalTheme.PaperDim)
            online.error?.let { Text(it, color = Color(0xFFE48B78)) }
            if (!connected) {
                GameButton(label = "创建公共岛", enabled = !online.loading, onClick = onCreate)
                GameButton(label = if (online.loading) "正在读取公共岛" else "刷新公共岛", variant = GameButtonVariant.GHOST, enabled = !online.loading, onClick = onRefresh)
                online.publicIslands.forEach { island ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(island.name, color = SurvivalTheme.Paper)
                            Text("${island.memberCount} / 4", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall)
                        }
                        GameButton(label = "加入", enabled = !island.full, onClick = { onJoin(island.id) })
                    }
                }
            } else {
                Text("岛屿聊天", color = SurvivalTheme.Sun, style = MaterialTheme.typography.titleSmall)
                online.messages.forEach { message -> Text("${message.uid.take(12)}：${message.text}", color = SurvivalTheme.Paper) }
                if (online.messages.isEmpty()) Text("还没有消息，先和岛友打个招呼吧。", color = SurvivalTheme.PaperDim)
            }
        }
        BasicTextField(
            value = text,
            onValueChange = { text = it.take(200) },
            modifier = Modifier.fillMaxWidth().clip(SurvivalTheme.PanelShape).background(Color(0xFF202A24)).border(1.dp, SurvivalTheme.BrownSoft, SurvivalTheme.PanelShape).padding(12.dp),
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = SurvivalTheme.Paper),
            cursorBrush = SolidColor(SurvivalTheme.Sun),
            enabled = connected,
            decorationBox = { innerTextField ->
                Box {
                    if (text.isEmpty()) Text(if (connected) "输入岛屿消息" else "连接公共岛后可发送", color = SurvivalTheme.PaperDim)
                    innerTextField()
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GameButton(label = "发送", enabled = connected && text.isNotBlank(), onClick = { onSend(text); text = "" })
            GameButton(label = "退出联机", variant = GameButtonVariant.GHOST, enabled = online.status != IslandConnectionStatus.LOCAL, onClick = onLeave)
        }
    }
}
