package cn.zhengzhengstudio.lifediary.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.auth.PassportState
import cn.zhengzhengstudio.lifediary.data.HealthMode
import cn.zhengzhengstudio.lifediary.data.HealthSettings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(passportState: PassportState, health: HealthSettings, minorModeEnabled: Boolean, minorPromptDisabled: Boolean,
                  onLogin: () -> Unit, onLogout: () -> Unit, onHealthChange: (HealthSettings) -> Unit,
                  onMinorModeEnabled: (Boolean) -> Unit, onMinorPromptDisabled: (Boolean) -> Unit, onCheckUpdate: () -> Unit, updateStatus: String?) {
    val uriHandler = LocalUriHandler.current
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("我的生活", style = MaterialTheme.typography.headlineMedium)
        ElevatedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (passportState) {
                PassportState.SignedOut -> { Text("尚未绑定通行证"); Button(onClick = onLogin) { Text("绑定通行证") } }
                PassportState.Authorizing -> { Text("正在等待通行证确认…"); LinearProgressIndicator(Modifier.fillMaxWidth()) }
                is PassportState.Failed -> { Text(passportState.message, color = MaterialTheme.colorScheme.error); Button(onClick = onLogin) { Text("重新登录") } }
                is PassportState.SignedIn -> { Text("通行证已绑定", style = MaterialTheme.typography.titleMedium); Text("账户 ${passportState.credential.accountId}"); TextButton(onClick = onLogout) { Text("退出登录") } }
            }
        } }
        Text("健康日记", style = MaterialTheme.typography.titleLarge)
        Text("这些入口由你自己选择，不根据性别自动开启。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            HealthMode.entries.forEachIndexed { index, mode -> SegmentedButton(
                selected = health.mode == mode, onClick = { onHealthChange(health.copy(mode = mode)) },
                shape = SegmentedButtonDefaults.itemShape(index, HealthMode.entries.size)
            ) { Text(when (mode) { HealthMode.None -> "不启用"; HealthMode.Period -> "经期记录"; HealthMode.SmokeFree -> "戒烟日记" }) } }
        }
        when (health.mode) {
            HealthMode.Period -> ElevatedCard { Column(Modifier.padding(16.dp)) {
                Text("今天有多难受：${health.painToday}/10")
                Slider(health.painToday.toFloat(), { onHealthChange(health.copy(painToday = it.toInt())) }, valueRange = 0f..10f, steps = 9)
                Text("周期预测只作生活参考，不作为医学诊断。", style = MaterialTheme.typography.bodySmall)
            } }
            HealthMode.SmokeFree -> ElevatedCard { Column(Modifier.padding(16.dp)) {
                Text(if (health.smokeFreeSince == null) "准备好时，记录戒烟起点。" else "正在守住这段不吸烟的时间")
                Button(onClick = { onHealthChange(health.copy(smokeFreeSince = health.smokeFreeSince ?: System.currentTimeMillis())) }) { Text("从今天开始") }
            } }
            HealthMode.None -> Unit
        }
        HorizontalDivider()
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) { Text("未成年人模式"); Text("加强社区确认与内容保护", style = MaterialTheme.typography.bodySmall) }
            Switch(minorModeEnabled, onMinorModeEnabled)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) { Text("永久不提示未成年人模式"); Text("仍可随时在这里恢复", style = MaterialTheme.typography.bodySmall) }
            Switch(minorPromptDisabled, onMinorPromptDisabled)
        }
        OutlinedButton(onClick = onCheckUpdate, Modifier.fillMaxWidth()) { Text("检查新版本") }
        TextButton(onClick = { uriHandler.openUri("https://life.zhengzhengstudio.cn") }, Modifier.fillMaxWidth()) { Text("打开生活日记网站") }
        updateStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
