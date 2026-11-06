package cn.zhengzhengstudio.lifediary.ui.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.data.ChatMessage

@Composable
fun CompanionScreen(signedIn: Boolean, messages: List<ChatMessage>, sending: Boolean, onLogin: () -> Unit, onSend: (String) -> Unit) {
    var draft by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("陪伴助手", style = MaterialTheme.typography.headlineMedium)
        Text("倾听与整理，不替代医疗或紧急帮助。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!signedIn) { Button(onClick = onLogin) { Text("绑定通行证后开始") }; return@Column }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (messages.isEmpty()) item { Text("今天想从哪里说起？") }
            items(messages, key = { it.id }) { message -> Surface(color = if (message.role == "user") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.large) { Text(message.body, Modifier.padding(14.dp)) } }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(draft, { draft = it }, Modifier.weight(1f), label = { Text("写下想说的话") })
            Button(onClick = { onSend(draft); draft = "" }, enabled = draft.isNotBlank() && !sending, modifier = Modifier.heightIn(min = 56.dp)) { Text(if (sending) "发送中" else "发送") }
        }
    }
}
