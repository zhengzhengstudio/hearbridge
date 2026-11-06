package cn.zhengzhengstudio.lifediary.ui.today

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.data.DiaryEntry
import org.json.JSONArray

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(onSave: (DiaryEntry) -> Unit, pendingCount: Int) {
    var page by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        SecondaryTabRow(page) {
            Tab(page == 0, { page = 0 }, text = { Text("快记") })
            Tab(page == 1, { page = 1 }, text = { Text("计划") })
            Tab(page == 2, { page = 2 }, text = { Text("课程") })
            Tab(page == 3, { page = 3 }, text = { Text("饮食") })
        }
        when (page) {
            0 -> QuickDiary(onSave, pendingCount)
            1 -> LocalListTool("今日计划", "添加要做的事", "plans")
            2 -> LocalListTool("课程表", "例如：08:00 数学", "schedule")
            else -> LocalListTool("饮食记录", "这一餐吃了什么", "meals", "用于观察规律，不替代医疗或营养建议。")
        }
    }
}

@Composable
private fun QuickDiary(onSave: (DiaryEntry) -> Unit, pendingCount: Int) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var mood by remember { mutableFloatStateOf(3f) }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("今天，也值得被好好记住", style = MaterialTheme.typography.headlineMedium)
        Text("不用完整，不必漂亮。先留下此刻。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("一句标题") }, singleLine = true)
        OutlinedTextField(body, { body = it }, Modifier.fillMaxWidth().heightIn(min = 120.dp), label = { Text("此刻发生了什么？") })
        Text("今天的感受 · ${mood.toInt()}/5")
        Slider(mood, { mood = it }, valueRange = 1f..5f, steps = 3)
        Button(onClick = { onSave(DiaryEntry(title = title.ifBlank { "今天" }, body = body, mood = mood.toInt())); title = ""; body = "" }, enabled = body.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Icon(Icons.Outlined.EditNote, null); Spacer(Modifier.width(8.dp)); Text("保存到个人日记")
        }
        if (pendingCount > 0) AssistChip(onClick = {}, label = { Text("已保存在本机 · $pendingCount 条待同步") })
    }
}

@Composable
private fun LocalListTool(title: String, placeholder: String, key: String, note: String? = null) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("daily_tools", Context.MODE_PRIVATE) }
    var input by remember { mutableStateOf("") }
    var values by remember(key) { mutableStateOf(readValues(prefs.getString(key, "[]") ?: "[]")) }
    fun persist(next: List<String>) { values = next; prefs.edit().putString(key, JSONArray(next).toString()).apply() }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium)
        if (note != null) Text(note, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(input, { input = it }, Modifier.weight(1f), placeholder = { Text(placeholder) }, singleLine = true)
            Button(onClick = { persist(values + input.trim()); input = "" }, enabled = input.isNotBlank(), modifier = Modifier.heightIn(min = 56.dp)) { Text("添加") }
        }
        if (values.isEmpty()) Text("今天还没有记录。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            itemsIndexed(values) { index, value -> ListItem(headlineContent = { Text(value) }, trailingContent = { TextButton(onClick = { persist(values.filterIndexed { itemIndex, _ -> itemIndex != index }) }) { Text("删除") } }) }
        }
    }
}

private fun readValues(source: String): List<String> = runCatching {
    val array = JSONArray(source); List(array.length()) { index -> array.getString(index) }
}.getOrDefault(emptyList())
