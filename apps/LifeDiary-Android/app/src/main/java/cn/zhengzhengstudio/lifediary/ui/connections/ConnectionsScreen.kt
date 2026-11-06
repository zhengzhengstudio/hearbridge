package cn.zhengzhengstudio.lifediary.ui.connections

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.data.Friend
import cn.zhengzhengstudio.lifediary.data.LoadState

@Composable
fun ConnectionsScreen(signedIn: Boolean, friends: LoadState<List<Friend>>, onLogin: () -> Unit,
                      onRefresh: () -> Unit, onSearch: (String) -> Unit, onRequest: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("连接", style = MaterialTheme.typography.headlineMedium)
        Text("好友申请只包含通行证身份，不会显示设备名称。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!signedIn) { Button(onClick = onLogin) { Text("绑定通行证") }; return@Column }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(query, { query = it }, Modifier.weight(1f), label = { Text("按昵称或 UID 查找") }, singleLine = true)
            Button(onClick = { onSearch(query) }, enabled = query.isNotBlank(), modifier = Modifier.heightIn(min = 56.dp)) { Text("查找") }
        }
        when (friends) {
            LoadState.Loading -> CircularProgressIndicator()
            LoadState.Empty -> Text("还没有好友。可以先查找一位认识的人。")
            is LoadState.Error -> TextButton(onClick = onRefresh) { Text("${friends.message} · 重试") }
            is LoadState.Offline -> Text(friends.message)
            is LoadState.Ready -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(friends.value, key = { it.uid }) { friend ->
                ElevatedCard(Modifier.fillMaxWidth()) { Row(Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column { Text(friend.displayName, style = MaterialTheme.typography.titleMedium); Text(friend.status) }
                    if (friend.status != "friend") TextButton(onClick = { onRequest(friend.uid) }) { Text("发送申请") }
                } }
            } }
        }
    }
}
