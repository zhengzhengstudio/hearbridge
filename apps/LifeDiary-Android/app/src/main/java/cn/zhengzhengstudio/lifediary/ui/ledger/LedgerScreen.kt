package cn.zhengzhengstudio.lifediary.ui.ledger

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
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun LedgerScreen(online: Boolean, onSync: suspend (JSONArray) -> Unit) {
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var label by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("记账", style = MaterialTheme.typography.titleLarge)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            if (online) "已连接账户，可同步到云端。" else "当前离线，记录仅保存在本地。",
            style = MaterialTheme.typography.bodySmall
        )
        Spacer(modifier = Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextField(
                value = label,
                onValueChange = { label = it },
                placeholder = { Text("用途") },
                modifier = Modifier.weight(1f)
            )
            Spacer(modifier = Modifier.width(8.dp))
            TextField(
                value = amount,
                onValueChange = { amount = it },
                placeholder = { Text("金额") },
                modifier = Modifier.width(96.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Button(onClick = {
                val value = amount.toDoubleOrNull() ?: 0.0
                if (label.isNotBlank()) {
                    items = items + JSONObject()
                        .put("id", System.currentTimeMillis().toString())
                        .put("label", label)
                        .put("amount", value)
                        .put("revision", 1)
                    label = ""
                    amount = ""
                }
            }) { Text("添加") }
        }
        Spacer(modifier = Modifier.height(12.dp))
        LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
            items(items) { item ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(item.optString("label"), modifier = Modifier.weight(1f))
                    Text("¥" + String.format("%.2f", item.optDouble("amount", 0.0)))
                }
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Button(
            onClick = {
                val array = JSONArray()
                items.forEach { array.put(it) }
                scope.launch { onSync(array) }
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("同步到云端") }
    }
}
