package cn.zhengzhengstudio.lifediary.ui.diary

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.data.DiaryEntry
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiaryScreen(entries: List<DiaryEntry>, signedIn: Boolean, onPublish: (DiaryEntry) -> Unit) {
    var sharing by remember { mutableStateOf<DiaryEntry?>(null) }
    Column(Modifier.fillMaxSize()) {
        Text("个人日记", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(20.dp, 18.dp, 20.dp, 4.dp))
        Text("这里只保存你的私人原文。公开内容在“公共日记”查看。", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
            if (entries.isEmpty()) Box(Modifier.fillMaxSize().padding(24.dp)) { Text("还没有日记。去“今天”写下第一篇吧。") }
            else LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(entries, key = { it.id }) { entry ->
                    ElevatedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(entry.title, style = MaterialTheme.typography.titleMedium)
                        Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(entry.createdAt)), style = MaterialTheme.typography.labelMedium)
                        Text(entry.body)
                        TextButton(onClick = { sharing = entry }, enabled = signedIn) { Text(if (signedIn) "分享一个社区副本" else "登录后可分享") }
                    } }
                }
            }
    }
    sharing?.let { entry -> AlertDialog(onDismissRequest = { sharing = null }, title = { Text("确认发布到社区？") },
        text = { Text("将创建公开副本。个人日记仍保持私密，社区不支持匿名发布，也不会显示设备名称。") },
        confirmButton = { Button(onClick = { onPublish(entry); sharing = null }) { Text("确认公开副本") } },
        dismissButton = { TextButton(onClick = { sharing = null }) { Text("取消") } }) }
}
