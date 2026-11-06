package cn.zhengzhengstudio.lifediary.ui

import android.app.Activity
import android.content.Context
import android.view.WindowManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.UpdateChecker
import cn.zhengzhengstudio.lifediary.UpdateInfo
import cn.zhengzhengstudio.lifediary.auth.PassportManager
import cn.zhengzhengstudio.lifediary.auth.PassportState
import cn.zhengzhengstudio.lifediary.data.*
import cn.zhengzhengstudio.lifediary.navigation.LifeDestination
import cn.zhengzhengstudio.lifediary.network.HttpLifeApi
import cn.zhengzhengstudio.lifediary.ui.companion.CompanionScreen
import cn.zhengzhengstudio.lifediary.ui.community.CommunityScreen
import cn.zhengzhengstudio.lifediary.ui.diary.DiaryScreen
import cn.zhengzhengstudio.lifediary.ui.ledger.LedgerScreen
import cn.zhengzhengstudio.lifediary.ui.profile.ProfileScreen
import cn.zhengzhengstudio.lifediary.ui.today.TodayScreen
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun LifeDiaryApp(passportManager: PassportManager) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val passportState by passportManager.state.collectAsState()
    val api = remember { HttpLifeApi(passportManager::accessToken) }
    val repository = remember { DefaultLifeRepository(JsonLocalStore(context), api) }
    val entries by repository.entries.collectAsState()
    val syncState by repository.syncState.collectAsState()
    var selected by remember { mutableStateOf(LifeDestination.Today) }
    var community by remember { mutableStateOf<LoadState<List<CommunityPost>>>(LoadState.Empty) }
    var friends by remember { mutableStateOf<LoadState<List<Friend>>>(LoadState.Empty) }
    var messages by remember { mutableStateOf(emptyList<ChatMessage>()) }
    var sending by remember { mutableStateOf(false) }
    var health by remember { mutableStateOf(loadHealth(context)) }
    var updateStatus by remember { mutableStateOf<String?>(null) }
    var pendingUpdate by remember { mutableStateOf<UpdateInfo?>(null) }
    var downloadProgress by remember { mutableStateOf<Float?>(null) }
    val minorPrefs = remember { context.getSharedPreferences("minor_mode_prompt", Context.MODE_PRIVATE) }
    var minorPromptDisabled by remember { mutableStateOf(minorPrefs.getBoolean("permanent", false)) }
    var minorModeEnabled by remember { mutableStateOf(minorPrefs.getBoolean("enabled", false)) }
    var showMinorPrompt by remember { mutableStateOf(false) }
    var authorizationInProgress by remember { mutableStateOf(passportState is PassportState.Authorizing) }

    SideEffect {
        val protectSensitiveScreen = selected == LifeDestination.Diary || selected == LifeDestination.Ledger || selected == LifeDestination.Profile
        val window = (context as Activity).window
        if (protectSensitiveScreen) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    fun refreshCommunity() { scope.launch {
        community = LoadState.Loading
        community = runCatching { api.posts() }.fold({ if (it.isEmpty()) LoadState.Empty else LoadState.Ready(it) }, { LoadState.Offline() })
    } }
    fun refreshFriends(query: String? = null) { val token = passportManager.accessToken() ?: return; scope.launch {
        friends = LoadState.Loading
        friends = runCatching { if (query.isNullOrBlank()) api.friends(token) else api.searchFriends(token, query) }
            .fold({ if (it.isEmpty()) LoadState.Empty else LoadState.Ready(it) }, { LoadState.Error(it.message ?: "好友加载失败") })
    } }

    LaunchedEffect(passportState) {
        if (passportState is PassportState.Authorizing) {
            authorizationInProgress = true
            return@LaunchedEffect
        }
        val signed = passportState as? PassportState.SignedIn
        if (signed != null) {
            refreshFriends()
            if (authorizationInProgress) {
                val mutedUntil = minorPrefs.getLong("until", 0)
                showMinorPrompt = signed.credential.isMinor && !minorPromptDisabled && System.currentTimeMillis() >= mutedUntil
            }
        }
        authorizationInProgress = false
    }
    LaunchedEffect(Unit) {
        runCatching { UpdateChecker(context as Activity).check() }.onSuccess { pendingUpdate = it }
    }

    Box(Modifier.fillMaxSize()) {
        LifeDiaryShell(selected, { selected = it }) {
            when (selected) {
                    LifeDestination.Today -> TodayScreen(onSave = { scope.launch { repository.save(it) } }, pendingCount = when (val state = syncState) { is SyncState.Pending -> state.count; is SyncState.Failed -> state.count; SyncState.Synced -> 0 })
                    LifeDestination.Diary -> DiaryScreen(entries, passportState is PassportState.SignedIn) { entry -> scope.launch {
                        runCatching { api.publish(entry.body, entry.id, minorModeEnabled) }
                            .onSuccess { refreshCommunity() }.onFailure { community = LoadState.Error(it.message ?: "发布失败") }
                    } }
                    LifeDestination.Community -> CommunityScreen(
                        community = community,
                        signedIn = passportState is PassportState.SignedIn,
                        friends = friends,
                        onLogin = passportManager::signIn,
                        onRefreshCommunity = ::refreshCommunity,
                        onRefreshFriends = { refreshFriends() },
                        onSearchFriend = { refreshFriends(it) },
                        onRequestFriend = { uid -> scope.launch {
                            passportManager.accessToken()?.let { api.requestFriend(it, uid); refreshFriends() }
                        } }
                    )
                    LifeDestination.Ledger -> LedgerScreen(
                        online = passportState is PassportState.SignedIn,
                        onSync = { values -> api.syncLedger(values) }
                    )
                    LifeDestination.Companion -> CompanionScreen(passportState is PassportState.SignedIn, messages, sending, passportManager::signIn) { text -> scope.launch {
                        val token = passportManager.accessToken() ?: return@launch
                        messages = messages + ChatMessage(UUID.randomUUID().toString(), "user", text); sending = true
                        val reply = runCatching { api.companion(token, text) }.getOrElse { "现在连接不上服务，但你写下的话仍然重要。" }
                        messages = messages + ChatMessage(UUID.randomUUID().toString(), "assistant", reply); sending = false
                    } }
                    LifeDestination.Profile -> ProfileScreen(passportState, health, minorModeEnabled, minorPromptDisabled, passportManager::signIn, passportManager::signOut,
                        { health = it; saveHealth(context, it) },
                        { enabled -> minorModeEnabled = enabled; minorPrefs.edit().putBoolean("enabled", enabled).apply() },
                        { disabled -> minorPromptDisabled = disabled; minorPrefs.edit().putBoolean("permanent", disabled).apply() },
                        { scope.launch { checkUpdate(context as Activity, { pendingUpdate = it }) { updateStatus = it } } }, updateStatus)
            }
        }

        if (showMinorPrompt) LifeMinorOverlay(
            onEnable = { minorModeEnabled = true; minorPrefs.edit().putBoolean("enabled", true).apply(); showMinorPrompt = false },
            onSevenDays = { minorPrefs.edit().putLong("until", System.currentTimeMillis() + 7 * 24 * 60 * 60 * 1000L).apply(); showMinorPrompt = false },
            onNever = { minorPromptDisabled = true; minorPrefs.edit().putBoolean("permanent", true).apply(); showMinorPrompt = false }
        )

        pendingUpdate?.let { info -> LifeUpdateOverlay(info, onInstall = { scope.launch {
                pendingUpdate = null
                downloadProgress = 0f
                updateStatus = "正在下载并校验…"
                runCatching { UpdateChecker(context as Activity).download(info) { downloadProgress = it } }
                    .onSuccess { apk -> downloadProgress = null; updateStatus = if (UpdateChecker(context as Activity).install(apk)) "已交给系统安装器" else "请允许安装未知应用后重试" }
                    .onFailure { downloadProgress = null; updateStatus = "更新失败：${it.message}" }
            } }, onLater = { pendingUpdate = null }) }
        downloadProgress?.let { LifeDownloadProgress(it) }
    }
}

private fun loadHealth(context: Context): HealthSettings {
    val prefs = context.getSharedPreferences("health_settings", Context.MODE_PRIVATE)
    return HealthSettings(mode = runCatching { HealthMode.valueOf(prefs.getString("mode", HealthMode.None.name)!!) }.getOrDefault(HealthMode.None),
        painToday = prefs.getInt("pain", 0), smokeFreeSince = prefs.getLong("smoke", 0).takeIf { it > 0 })
}
private fun saveHealth(context: Context, value: HealthSettings) {
    context.getSharedPreferences("health_settings", Context.MODE_PRIVATE).edit().putString("mode", value.mode.name)
        .putInt("pain", value.painToday).putLong("smoke", value.smokeFreeSince ?: 0).apply()
}
private suspend fun checkUpdate(activity: Activity, found: (UpdateInfo?) -> Unit, status: (String) -> Unit) {
    status("正在检查…")
    runCatching { UpdateChecker(activity).check() }.onSuccess { info ->
        found(info)
        if (info == null) status("已经是最新版本") else status("发现 ${info.version}（构建 ${info.build}）")
    }.onFailure { status("暂时无法检查更新：${it.message}") }
}

@Composable
private fun LifeMinorOverlay(
    onEnable: () -> Unit,
    onSevenDays: () -> Unit,
    onNever: () -> Unit
) {
    LifeOverlayScrim {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 8.dp,
            shape = MaterialTheme.shapes.large,
            modifier = Modifier.fillMaxWidth(0.88f)
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Text("未成年人模式", style = MaterialTheme.typography.titleLarge)
                Spacer(modifier = Modifier.height(12.dp))
                Text("检测到未成年人账号登录。开启未成年人模式将加强社区确认与内容保护。")
                Spacer(modifier = Modifier.height(12.dp))
                Text("仍可随时在这里恢复", style = MaterialTheme.typography.bodySmall)
                Spacer(modifier = Modifier.height(20.dp))
                Button(onClick = onEnable, modifier = Modifier.fillMaxWidth()) {
                    Text("启用未成年人模式")
                }
                Spacer(modifier = Modifier.height(4.dp))
                TextButton(onClick = onSevenDays, modifier = Modifier.fillMaxWidth()) {
                    Text("7 天内不再提示")
                }
                TextButton(onClick = onNever, modifier = Modifier.fillMaxWidth()) {
                    Text("永久不再提示")
                }
            }
        }
    }
}

@Composable
private fun LifeUpdateOverlay(
    info: UpdateInfo,
    onInstall: () -> Unit,
    onLater: () -> Unit
) {
    LifeOverlayScrim {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 8.dp,
            shape = MaterialTheme.shapes.large,
            modifier = Modifier.fillMaxWidth(0.88f)
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Text("发现新版本 ${info.version}（构建 ${info.build}）", style = MaterialTheme.typography.titleLarge)
                Spacer(modifier = Modifier.height(12.dp))
                Text(info.notes)
                Spacer(modifier = Modifier.height(20.dp))
                Button(onClick = onInstall, modifier = Modifier.fillMaxWidth()) {
                    Text("立即安装")
                }
                Spacer(modifier = Modifier.height(4.dp))
                TextButton(onClick = onLater, modifier = Modifier.fillMaxWidth()) {
                    Text("稍后再说")
                }
            }
        }
    }
}

@Composable
private fun LifeOverlayScrim(content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .background(color = MaterialTheme.colorScheme.scrim.copy(alpha = 0.5f))
    ) {
        content()
    }
}

@Composable
private fun LifeDownloadProgress(progress: Float) {
    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(progress = progress)
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                "正在下载并校验… ${(progress * 100).toInt()}%",
                textAlign = TextAlign.Center
            )
        }
    }
}
