package cn.zhengzhengstudio.lifediary.ui.community

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.data.CommunityPost
import cn.zhengzhengstudio.lifediary.data.Friend
import cn.zhengzhengstudio.lifediary.data.LoadState

@Composable
fun CommunityScreen(
    community: LoadState<List<CommunityPost>>,
    signedIn: Boolean,
    friends: LoadState<List<Friend>>,
    onLogin: () -> Unit,
    onRefreshCommunity: () -> Unit,
    onRefreshFriends: () -> Unit,
    onSearchFriend: (String) -> Unit,
    onRequestFriend: (String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("公共日记", style = MaterialTheme.typography.titleLarge)
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onRefreshCommunity) { Text("刷新广场") }
            Spacer(modifier = Modifier.width(8.dp))
            if (!signedIn) Button(onClick = onLogin) { Text("登录后参与") }
        }
        Spacer(modifier = Modifier.height(12.dp))
        when (community) {
            is LoadState.Loading -> Text("加载中…")
            is LoadState.Empty -> Text("还没有人分享，去写下第一条吧。")
            is LoadState.Offline -> Text(community.message)
            is LoadState.Error -> Text(community.message)
            is LoadState.Ready -> LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
                items(community.value) { post ->
                    Surface(
                        tonalElevation = 0.dp,
                        shadowElevation = 2.dp,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(post.authorName, style = MaterialTheme.typography.labelMedium)
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(post.body)
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text("好友", style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("搜索好友昵称") },
                modifier = Modifier.weight(1f)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Button(onClick = { onSearchFriend(query) }) { Text("搜索") }
            Spacer(modifier = Modifier.width(8.dp))
            Button(onClick = onRefreshFriends) { Text("我的好友") }
        }
        Spacer(modifier = Modifier.height(8.dp))
        when (friends) {
            is LoadState.Ready -> LazyColumn {
                items(friends.value) { friend ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(friend.displayName, modifier = Modifier.weight(1f))
                        TextButton(onClick = { onRequestFriend(friend.uid) }) { Text("申请") }
                    }
                }
            }
            is LoadState.Empty -> Text("还没有好友，搜索一下吧。")
            else -> Text("好友列表未加载。")
        }
        if (friends is LoadState.Error) Text(friends.message)
    }
}
