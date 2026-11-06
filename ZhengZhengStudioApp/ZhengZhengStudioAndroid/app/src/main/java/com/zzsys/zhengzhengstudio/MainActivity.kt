package cn.zhengzhengstudio.spacefight

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.ViewCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

private const val APP_VERSION = "0.8.0"
private const val APP_BUILD = 10
private const val PASSPORT_URL = "https://zhengzhengstudio.cn/api/auth/login"

class MainActivity : AppCompatActivity() {
    private val http = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).build()
    private lateinit var battle: BattleView
    private lateinit var deckUi: FrameLayout
    private lateinit var combatUi: FrameLayout
    private lateinit var statusText: TextView
    private lateinit var missionName: TextView
    private lateinit var missionDetail: TextView
    private lateinit var launchButton: Button
    private lateinit var loginButton: Button
    private lateinit var pauseButton: ImageButton
    private lateinit var cameraButton: ImageButton
    private var mode = MissionKind.SURVIVAL.id
    private val missionButtons = linkedMapOf<String, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        window.statusBarColor = Color.rgb(5, 8, 11)
        window.navigationBarColor = Color.rgb(5, 8, 11)
        buildInterface()
        checkUpdates(false)
    }

    private fun buildInterface() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(5, 8, 11)) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, windowInsets ->
            val safe = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            windowInsets
        }
        battle = BattleView(this, ::onBattleStatus, ::showGameOver, ::showMissionComplete)
        root.addView(battle, FrameLayout.LayoutParams(-1, -1))

        deckUi = buildDeckUi()
        root.addView(deckUi, FrameLayout.LayoutParams(-1, -1))
        combatUi = buildCombatUi()
        root.addView(combatUi, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
    }

    private fun buildDeckUi(): FrameLayout {
        val layer = FrameLayout(this)
        val compact = resources.configuration.smallestScreenWidthDp < 600
        val strip = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), 0, dp(14), 0)
            background = surface(0xD805080B.toInt(), 0, 0x55384045)
        }
        layer.addView(strip, FrameLayout.LayoutParams(-1, dp(52), Gravity.TOP))
        strip.addView(View(this).apply { background = surface(0xFFF0A44B.toInt(), 0, 0xFFF0A44B.toInt()) },
            LinearLayout.LayoutParams(dp(3), dp(28)).apply { rightMargin = dp(10) })
        val identity = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        identity.addView(text("SPACEFIGHT", 17f, 0xFFF3F5F6.toInt(), Typeface.BOLD).apply { letterSpacing = 0.08f })
        statusText = text("本机战术链路已就绪", 10f, 0xFF91A0AC.toInt(), Typeface.NORMAL)
        identity.addView(statusText)
        strip.addView(identity, LinearLayout.LayoutParams(0, -2, 1f))
        strip.addView(iconButton(R.drawable.ic_profile, "飞行员档案") { showProfile() },
            LinearLayout.LayoutParams(dp(38), dp(38)).apply { leftMargin = dp(6) })
        strip.addView(iconButton(R.drawable.ic_update, "检查更新") { checkUpdates(true) },
            LinearLayout.LayoutParams(dp(38), dp(38)).apply { leftMargin = dp(6) })

        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = surface(0xF2080C10.toInt(), 2, 0xFF52606A.toInt())
        }
        rail.addView(text("任务编队 // LOCAL", 12f, 0xFFE1E7EA.toInt(), Typeface.BOLD))
        val missionGrid = GridLayout(this).apply {
            rowCount = if (compact) 2 else MissionKind.entries.size
            columnCount = if (compact) 3 else 1
            alignmentMode = GridLayout.ALIGN_BOUNDS
        }
        MissionKind.entries.forEachIndexed { index, mission ->
            val button = Button(this).apply {
                text = "${(index + 1).toString().padStart(2, '0')}  ${missionTitle(mission)}"
                textSize = 12f
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                isAllCaps = false
                minWidth = 0
                setPadding(dp(10), 0, dp(4), 0)
                setOnClickListener { selectMode(mission.id) }
            }
            missionButtons[mission.id] = button
            missionGrid.addView(button, GridLayout.LayoutParams().apply {
                width = if (compact) dp(132) else dp(172)
                height = dp(40)
                rowSpec = GridLayout.spec(if (compact) index / 3 else index)
                columnSpec = GridLayout.spec(if (compact) index % 3 else 0)
                setMargins(dp(3), dp(4), dp(3), 0)
            })
        }
        rail.addView(missionGrid)
        if (compact) {
            val scroller = HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                addView(rail, FrameLayout.LayoutParams(-2, -2))
            }
            layer.addView(scroller, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
                topMargin = dp(58)
                leftMargin = dp(8)
                rightMargin = dp(330)
            })
        } else {
            layer.addView(rail, FrameLayout.LayoutParams(-2, -2, Gravity.START or Gravity.CENTER_VERTICAL).apply {
                leftMargin = dp(18)
            })
        }

        val briefing = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(12), dp(18), dp(14))
            background = surface(0xF4080C10.toInt(), 2, 0xFF52606A.toInt())
        }
        val detailContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(text("当前任务", 12f, 0xFFB5C1C7.toInt(), Typeface.BOLD))
            missionName = text("", if (compact) 19f else 22f, 0xFFF5F7F8.toInt(), Typeface.BOLD).apply {
                setPadding(0, dp(3), 0, 0)
            }
            addView(missionName)
            missionDetail = text("", 13f, 0xFFD0D8DC.toInt(), Typeface.NORMAL).apply {
                setPadding(0, dp(4), 0, dp(8))
            }
            addView(missionDetail)
            addView(text("操作：左侧移动 · 右侧瞄准开火 · 相机键切换视角", 12f, 0xFFF0A44B.toInt(), Typeface.BOLD).apply {
                setPadding(0, 0, 0, dp(8))
            })
        }
        briefing.addView(ScrollView(this).apply {
            isFillViewport = true
            addView(detailContent)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        launchButton = actionButton("启动本地任务", true) {
            deckUi.visibility = View.GONE
            combatUi.visibility = View.VISIBLE
            battle.connect(mode, pilotName())
        }
        briefing.addView(launchButton, LinearLayout.LayoutParams(-1, dp(48)))
        loginButton = actionButton(loginLabel(), false) { showPassportLogin() }
        briefing.addView(loginButton, LinearLayout.LayoutParams(-1, dp(38)).apply { topMargin = dp(8) })
        layer.addView(briefing, FrameLayout.LayoutParams(
            if (compact) dp(312) else dp(328),
            if (compact) dp(206) else dp(252),
            Gravity.END or Gravity.BOTTOM
        ).apply {
            rightMargin = dp(if (compact) 10 else 18)
            bottomMargin = dp(if (compact) 10 else 18)
        })
        selectMode(MissionKind.SURVIVAL.id)
        return layer
    }

    private fun buildCombatUi(): FrameLayout {
        val layer = FrameLayout(this).apply { visibility = View.GONE }
        pauseButton = iconButton(R.drawable.ic_pause, "暂停任务") { togglePause() }
        layer.addView(pauseButton, FrameLayout.LayoutParams(dp(42), dp(42), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(12); rightMargin = dp(14)
        })
        cameraButton = iconButton(R.drawable.ic_camera, "切换驾驶舱与追尾视角") { toggleCamera() }
        layer.addView(cameraButton, FrameLayout.LayoutParams(dp(42), dp(42), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(12); rightMargin = dp(62)
        })
        return layer
    }

    private fun selectMode(value: String) {
        val mission = MissionKind.entries.firstOrNull { it.id == value } ?: MissionKind.SURVIVAL
        mode = mission.id
        val name = missionTitle(mission)
        val detail = missionDetail(mission)
        if (::missionName.isInitialized) {
            missionName.text = name
            missionDetail.text = "$detail 本机 60 Hz · 离线可用"
        }
        missionButtons.forEach { (id, button) ->
            val active = id == value
            button.background = surface(if (active) 0xFFF0A44B.toInt() else 0xFF11171C.toInt(), 0, if (active) 0xFFF0A44B.toInt() else 0xFF3D4A53.toInt())
            button.setTextColor(if (active) 0xFF111417.toInt() else 0xFFD8E0E4.toInt())
        }
    }

    private fun onBattleStatus(value: String) = runOnUiThread { statusText.text = value }

    private fun togglePause() {
        val paused = battle.togglePause()
        pauseButton.contentDescription = if (paused) "继续任务" else "暂停任务"
        Toast.makeText(this, if (paused) "任务已暂停" else "任务继续", Toast.LENGTH_SHORT).show()
    }

    private fun toggleCamera() {
        val camera = battle.toggleCamera()
        cameraButton.contentDescription = if (camera == CameraMode.COCKPIT) "切换到追尾视角" else "切换到驾驶舱视角"
        Toast.makeText(this, if (camera == CameraMode.COCKPIT) "驾驶舱视角" else "追尾视角", Toast.LENGTH_SHORT).show()
    }

    private fun showGameOver(reason: String) = runOnUiThread {
        AlertDialog.Builder(this)
            .setTitle("任务失败")
            .setMessage("$reason\n飞行甲板已保留当前任务设置。")
            .setPositiveButton("再次部署") { _, _ -> battle.restart(mode) }
            .setNegativeButton("返回甲板") { _, _ -> returnToDeck() }
            .setOnCancelListener { returnToDeck() }
            .show()
    }

    private fun showMissionComplete() = runOnUiThread {
        AlertDialog.Builder(this)
            .setTitle("任务完成")
            .setMessage("战术目标已达成，战果已记录在本机。")
            .setPositiveButton("再次部署") { _, _ -> battle.restart(mode) }
            .setNegativeButton("返回甲板") { _, _ -> returnToDeck() }
            .setOnCancelListener { returnToDeck() }
            .show()
    }

    private fun returnToDeck() {
        battle.disconnect()
        combatUi.visibility = View.GONE
        deckUi.visibility = View.VISIBLE
        statusText.text = "本机战术链路已就绪"
    }

    private fun showPassportLogin() {
        val fields = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(8), dp(22), 0) }
        val account = EditText(this).apply { hint = "用户名 / 邮箱 / 手机号"; setSingleLine() }
        val password = EditText(this).apply { hint = "密码"; setSingleLine(); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        fields.addView(account); fields.addView(password)
        val dialog = AlertDialog.Builder(this)
            .setTitle("铮铮通行证")
            .setMessage("在 App 内直接登录，不会打开网页。")
            .setView(fields).setNegativeButton("取消", null).setPositiveButton("登录", null).create()
        dialog.setOnShowListener {
            val submit = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            submit.setOnClickListener {
                val username = account.text.toString().trim(); val secret = password.text.toString()
                if (username.isEmpty() || secret.isEmpty()) { Toast.makeText(this, "请填写账号和密码", Toast.LENGTH_SHORT).show(); return@setOnClickListener }
                submit.isEnabled = false; submit.text = "登录中"
                val body = JSONObject().put("username", username).put("password", secret).toString().toRequestBody("application/json".toMediaType())
                http.newCall(Request.Builder().url(PASSPORT_URL).post(body).build()).enqueue(object : okhttp3.Callback {
                    override fun onFailure(call: okhttp3.Call, e: java.io.IOException) = runOnUiThread {
                        submit.isEnabled = true; submit.text = "登录"; Toast.makeText(this@MainActivity, "连接通行证失败", Toast.LENGTH_SHORT).show()
                    }
                    override fun onResponse(call: okhttp3.Call, response: Response) {
                        val payload = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrNull()
                        runOnUiThread {
                            if (response.isSuccessful && payload?.optBoolean("success") == true) {
                                val user = payload.optJSONObject("user")
                                val display = user?.optString("nickname")?.takeIf(String::isNotBlank) ?: user?.optString("username")?.takeIf(String::isNotBlank) ?: username
                                getSharedPreferences("spacefight", MODE_PRIVATE).edit().putString("display_name", display).putString("uid", user?.optString("uid").orEmpty()).apply()
                                loginButton.text = loginLabel(); dialog.dismiss(); Toast.makeText(this@MainActivity, "已登录为 $display", Toast.LENGTH_SHORT).show()
                            } else {
                                submit.isEnabled = true; submit.text = "登录"; Toast.makeText(this@MainActivity, payload?.optString("error") ?: "登录失败", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                })
            }
        }
        dialog.show()
    }

    private fun showProfile() {
        val pilot = pilotName()
        AlertDialog.Builder(this).setTitle("飞行员档案")
            .setMessage("${if (pilot == "Player") "未登录通行证" else "飞行员：$pilot"}\n版本 $APP_VERSION · build $APP_BUILD\n包名 cn.zhengzhengstudio.spacefight")
            .setPositiveButton(if (pilot == "Player") "登录" else "切换账号") { _, _ -> showPassportLogin() }
            .setNeutralButton("检查更新") { _, _ -> checkUpdates(true) }.setNegativeButton("关闭", null).show()
    }

    private fun checkUpdates(manual: Boolean) {
        http.newCall(Request.Builder().url(BuildConfig.MANIFEST_URL).build()).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) { if (manual) runOnUiThread { Toast.makeText(this@MainActivity, "暂时无法检查更新", Toast.LENGTH_SHORT).show() } }
            override fun onResponse(call: okhttp3.Call, response: Response) {
                val apps = runCatching { JSONObject(response.body?.string().orEmpty()).optJSONArray("apps") }.getOrNull() ?: return
                var latestBuild = 0; var latestVersion = ""; var download = ""
                for (i in 0 until apps.length()) {
                    val app = apps.optJSONObject(i) ?: continue
                    if (app.optString("id") == BuildConfig.APP_UPDATE_ID) {
                        latestBuild = app.optInt("build"); latestVersion = app.optString("version")
                        download = app.optString("downloadURL").let { if (it.startsWith("/")) "https://zhengzhengstudio.cn$it" else it }
                    }
                }
                runOnUiThread {
                    if (latestBuild > APP_BUILD && download.isNotBlank()) AlertDialog.Builder(this@MainActivity).setTitle("发现新版本 $latestVersion")
                        .setMessage("当前 $APP_VERSION，安装后可继续使用原账号。")
                        .setPositiveButton("下载更新") { _, _ -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(download))) }.setNegativeButton("稍后", null).show()
                    else if (manual) Toast.makeText(this@MainActivity, "已是最新版本", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun pilotName() = getSharedPreferences("spacefight", MODE_PRIVATE).getString("display_name", null) ?: "Player"
    private fun loginLabel() = if (pilotName() == "Player") "通行证登录" else "飞行员：${pilotName()}"
    private fun missionTitle(mission: MissionKind) = when (mission) {
        MissionKind.SURVIVAL -> "生存巡航"
        MissionKind.BOSS -> "首领截击"
        MissionKind.ESCORT -> "运输护航"
        MissionKind.DEFENSE -> "据点防守"
        MissionKind.TIMED -> "限时歼灭"
        MissionKind.RAID -> "资源突袭"
    }
    private fun missionDetail(mission: MissionKind) = when (mission) {
        MissionKind.SURVIVAL -> "清理不断升级的敌方编队，坚持更久并刷新得分。"
        MissionKind.BOSS -> "先摧毁三个武器组件，再击穿首领核心。"
        MissionKind.ESCORT -> "跟随运输舰穿越航线，阻止敌机摧毁友军。"
        MissionKind.DEFENSE -> "进入能源节点范围夺取控制权，并挡住敌军反扑。"
        MissionKind.TIMED -> "倒计时内完成歼灭；有效击毁会延长任务时间。"
        MissionKind.RAID -> "收集散布的能源容器，同时突破持续拦截。"
    }
    override fun onDestroy() { battle.disconnect(); http.dispatcher.executorService.shutdown(); super.onDestroy() }

    private fun text(value: String, size: Float, color: Int, style: Int) = TextView(this).apply { text = value; textSize = size; setTextColor(color); typeface = Typeface.create("sans-serif", style) }
    private fun iconButton(icon: Int, description: String, action: () -> Unit) = ImageButton(this).apply {
        setImageResource(icon); contentDescription = description; background = surface(0xC910151A.toInt(), 0, 0xFF46545E.toInt()); setPadding(dp(9), dp(9), dp(9), dp(9)); setOnClickListener { action() }
    }
    private fun actionButton(label: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        text = label; textSize = if (primary) 14f else 12f; isAllCaps = false
        setTextColor(if (primary) 0xFF121518.toInt() else 0xFFDDE4E7.toInt())
        background = surface(if (primary) 0xFFF0A44B.toInt() else 0xFF151D23.toInt(), 0, if (primary) 0xFFF0A44B.toInt() else 0xFF43515A.toInt()); setOnClickListener { action() }
    }
    private fun surface(fill: Int, radius: Int, stroke: Int) = GradientDrawable().apply { setColor(fill); cornerRadius = dp(radius).toFloat(); setStroke(dp(1), stroke) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}

private data class Entity(val id: String, val type: String, val x: Float, val z: Float, val rotation: Float, val health: Float, val maxHealth: Float, val owner: String = "", val weapon: String = "")
private enum class MissionKind(val id: String) {
    SURVIVAL("survival"), BOSS("boss"), ESCORT("escort"), DEFENSE("defense"), TIMED("timed"), RAID("raid")
}
private enum class CameraMode(val id: String) { COCKPIT("cockpit"), CHASE("chase") }
private enum class RegionKind(val id: String) { CANYON("canyon"), STORM("storm") }
private data class ObjectiveState(
    val label: String = "",
    val progress: Float = 0f,
    val escortHealth: Int = 100,
    val controlProgress: Int = 0,
    val timeRemaining: Float = 0f,
    val raidCollected: Int = 0,
    val bossComponents: Int = 0
)
private data class Snapshot(
    val self: String = "",
    val wave: Int = 0,
    val score: Int = 0,
    val health: Int = 100,
    val shield: Int = 100,
    val energy: Int = 100,
    val players: List<Entity> = emptyList(),
    val enemies: List<Entity> = emptyList(),
    val bullets: List<Entity> = emptyList(),
    val powerups: List<Entity> = emptyList(),
    val objective: ObjectiveState = ObjectiveState(),
    val region: RegionKind = RegionKind.CANYON,
    val missionComplete: Boolean = false,
    val missionFailed: Boolean = false,
    val lockRange: Float = 34f,
    val failureReason: String = ""
)
private data class FlightInput(val throttle: Float, val strafe: Float, val turn: Float, val boost: Boolean, val fire: Boolean, val weapon: Int)
private data class LocalBody(val id: String, val type: String, var x: Float, var z: Float, var rotation: Float, var health: Float, val maxHealth: Float, val owner: String, val weapon: String, var vx: Float = 0f, var vz: Float = 0f, var life: Float = 0f)

private class LocalBattle {
    private var mission = MissionKind.SURVIVAL
    private var region = RegionKind.CANYON
    private var x = 0f
    private var z = 8f
    private var rotation = 0f
    private var health = 100f; private var shield = 80f; private var energy = 100f
    private var score = 0; private var wave = 0; private var cooldown = 0f; private var waveDelay = .6f; private var nextId = 1
    private var missionElapsed = 0f
    private var timeRemaining = 0f
    private var controlProgress = 0f
    private var raidCollected = 0
    private var kills = 0
    private var lockRange = 32f
    private var energyRecovery = 20f
    private var missionComplete = false
    private var missionFailed = false
    private val enemies = mutableListOf<LocalBody>()
    private val bullets = mutableListOf<LocalBody>()
    private val resources = mutableListOf<LocalBody>()
    private var transport: LocalBody? = null

    fun reset(mode: String): Snapshot {
        mission = MissionKind.entries.firstOrNull { it.id == mode } ?: MissionKind.SURVIVAL
        region = when (mission) {
            MissionKind.ESCORT, MissionKind.TIMED, MissionKind.RAID -> RegionKind.STORM
            else -> RegionKind.CANYON
        }
        x = 0f; z = 8f; rotation = 0f; health = 100f; shield = 80f; energy = 100f
        score = 0; wave = 0; cooldown = 0f; waveDelay = .45f; nextId = 1
        missionElapsed = 0f; timeRemaining = if (mission == MissionKind.TIMED) 55f else 0f
        controlProgress = 0f; raidCollected = 0; kills = 0; missionComplete = false; missionFailed = false
        enemies.clear(); bullets.clear(); resources.clear(); transport = null
        when (mission) {
            MissionKind.BOSS -> spawnBoss()
            MissionKind.ESCORT -> transport = LocalBody("transport", "transport", 0f, 24f, 0f, 100f, 100f, "friendly", "none")
            MissionKind.RAID -> spawnRaidResources()
            else -> Unit
        }
        return snapshot()
    }

    fun step(dt: Float, input: FlightInput, training: Boolean = false): Snapshot {
        if (missionComplete || missionFailed) return snapshot()
        rotation += input.turn * dt * 3.4f
        val speed = if (input.boost && energy > 1f) 15f else 9f; val forwardX = sin(rotation); val forwardZ = -cos(rotation); val rightX = cos(rotation); val rightZ = sin(rotation)
        x += (forwardX * input.throttle + rightX * input.strafe * .86f) * speed * dt; z += (forwardZ * input.throttle + rightZ * input.strafe * .86f) * speed * dt
        applyRegionRules(dt)
        val radius = hypot(x, z); if (radius > 34f) { x *= 34f / radius; z *= 34f / radius }
        energy = (energy + if (input.boost) -34f * dt else energyRecovery * dt).coerceIn(0f, 100f)
        shield = min(80f, shield + 3.5f * dt)
        cooldown = max(0f, cooldown - dt)
        if (input.fire && cooldown <= 0f && energy >= 4f) fire(input.weapon, forwardX, forwardZ)
        if (!training) {
            missionElapsed += dt
            updateMission(dt)
        }
        if (!training) enemies.forEach { enemy ->
            val escortTarget = transport?.takeIf { mission == MissionKind.ESCORT && it.health > 0f }
            val targetX = escortTarget?.x ?: x
            val targetZ = escortTarget?.z ?: z
            val dx = targetX - enemy.x; val dz = targetZ - enemy.z; val distance = max(.001f, hypot(dx, dz))
            val base = when (enemy.type) { "boss" -> 1.5f; "boss_component" -> 1.1f; "bomber" -> 3.4f; else -> 5f }
            enemy.x += dx / distance * (base + min(4f, wave * .22f)) * dt; enemy.z += dz / distance * (base + min(4f, wave * .22f)) * dt; enemy.rotation = atan2(dx, -dz)
            if (distance < if (enemy.type == "boss") 3.2f else 1.25f) {
                val impact = (if (enemy.type == "boss") 28f else 13f) * dt
                if (escortTarget != null) escortTarget.health = max(0f, escortTarget.health - impact) else damage(impact)
            }
        }
        bullets.forEach { bullet ->
            bullet.x += bullet.vx * dt; bullet.z += bullet.vz * dt; bullet.life -= dt
            enemies.firstOrNull {
                hypot(bullet.x - it.x, bullet.z - it.z) < if (it.type == "boss") 3.6f else 1.15f
            }?.let { target ->
                val coreShielded = target.type == "boss" && enemies.any { it.type == "boss_component" && it.health > 0f }
                if (!coreShielded) target.health -= bullet.health
                bullet.life = 0f
            }
        }
        bullets.removeAll { it.life <= 0f || hypot(it.x, it.z) > 52f }; val destroyed = enemies.filter { it.health <= 0f }
        destroyed.forEach {
            score += when (it.type) { "boss" -> 2500; "boss_component" -> 450; else -> 120 }
            kills++
            if (mission == MissionKind.TIMED) timeRemaining = min(70f, timeRemaining + 2.5f)
        }
        enemies.removeAll(destroyed.toSet())
        if (destroyed.isNotEmpty() && enemies.isEmpty()) waveDelay = 1.1f
        collectRaidResources()
        evaluateMission()
        return snapshot()
    }

    private fun applyRegionRules(dt: Float) {
        when (region) {
            RegionKind.CANYON -> {
                val corridor = 18f
                val terrainWave = sin(z * .18f) * 3.5f
                val collision = kotlin.math.abs(x - terrainWave) > corridor
                if (collision) {
                    x = terrainWave + (x - terrainWave).coerceIn(-corridor, corridor)
                    damage(12f * dt)
                }
                lockRange = 34f
                energyRecovery = 20f
            }
            RegionKind.STORM -> {
                lockRange = 17f
                energyRecovery = 11f
                val electricCloud = sin(missionElapsed * 1.7f + x * .2f)
                if (electricCloud > .93f) energy = max(0f, energy - 10f * dt)
            }
        }
    }

    private fun updateMission(dt: Float) {
        when (mission) {
            MissionKind.SURVIVAL -> spawnNextWave(dt)
            MissionKind.BOSS -> Unit
            MissionKind.ESCORT -> {
                transport?.let {
                    it.z -= 2.25f * dt
                    if (it.health <= 0f) missionFailed = true
                    if (it.z <= -26f) missionComplete = true
                }
                spawnNextWave(dt)
            }
            MissionKind.DEFENSE -> {
                val playerNear = hypot(x, z + 4f) < 7f
                val enemyNear = enemies.any { hypot(it.x, it.z + 4f) < 8f }
                controlProgress = when {
                    playerNear && !enemyNear -> controlProgress + 14f * dt
                    enemyNear -> controlProgress - 9f * dt
                    else -> controlProgress - 2f * dt
                }.coerceIn(0f, 100f)
                spawnNextWave(dt)
            }
            MissionKind.TIMED -> {
                timeRemaining = max(0f, timeRemaining - dt)
                spawnNextWave(dt)
            }
            MissionKind.RAID -> spawnNextWave(dt)
        }
    }

    private fun evaluateMission() {
        when (mission) {
            MissionKind.SURVIVAL -> Unit
            MissionKind.BOSS -> if (enemies.none { it.type == "boss" }) missionComplete = true
            MissionKind.ESCORT -> if ((transport?.health ?: 0f) <= 0f) missionFailed = true
            MissionKind.DEFENSE -> if (controlProgress >= 100f) missionComplete = true
            MissionKind.TIMED -> {
                if (kills >= 18) missionComplete = true
                else if (timeRemaining <= 0f) missionFailed = true
            }
            MissionKind.RAID -> if (raidCollected >= 8) missionComplete = true
        }
    }

    private fun spawnNextWave(dt: Float) {
        if (enemies.isNotEmpty()) return
        waveDelay -= dt
        if (waveDelay <= 0f) beginWave()
    }

    private fun fire(weapon: Int, forwardX: Float, forwardZ: Float) {
        val selected = weapon.coerceIn(0, 4); val rates = floatArrayOf(.13f, .38f, .58f, .7f, .26f); val speeds = floatArrayOf(48f, 38f, 28f, 82f, 34f); val damage = floatArrayOf(12f, 9f, 34f, 52f, 27f)
        cooldown = rates[selected]; energy -= if (selected == 0 || selected == 4) 5f else 2f
        bullets += LocalBody(id("b"), "bullet", x + forwardX * 1.4f, z + forwardZ * 1.4f, rotation, damage[selected], damage[selected], "player", if (selected == 2) "missile" else selected.toString(), forwardX * speeds[selected], forwardZ * speeds[selected], 1.5f)
    }
    private fun beginWave() {
        wave++
        val count = min(20, 3 + wave + if (mission == MissionKind.TIMED) 3 else 0)
        repeat(count) { index ->
            val angle = index.toFloat() / max(1, count) * Math.PI.toFloat() * 2f + wave * .37f; val type = when { wave >= 4 && index % 7 == 0 -> "gunship"; wave >= 3 && index % 5 == 0 -> "bomber"; index % 3 == 0 -> "fighter"; else -> "scout" }; val hp = when (type) { "gunship" -> 110f; "bomber" -> 78f; "fighter" -> 42f; else -> 24f }
            enemies += LocalBody(id("e"), type, cos(angle) * 34f, sin(angle) * 34f, angle, hp, hp, "enemy", type)
        }
        waveDelay = 1.1f
    }
    private fun spawnBoss() {
        val hp = 1250f
        enemies += LocalBody(id("boss"), "boss", 0f, -22f, Math.PI.toFloat(), hp, hp, "enemy", "boss")
        repeat(3) { index ->
            val angle = index * Math.PI.toFloat() * 2f / 3f
            enemies += LocalBody(id("component"), "boss_component", cos(angle) * 6f, -22f + sin(angle) * 6f, angle, 180f, 180f, "enemy", "component")
        }
    }
    private fun spawnRaidResources() {
        repeat(10) { index ->
            val angle = index * Math.PI.toFloat() * 2f / 10f + .3f
            val radius = 10f + (index % 3) * 6f
            resources += LocalBody(id("resource"), "resource", cos(angle) * radius, sin(angle) * radius, angle, 1f, 1f, "neutral", "resource")
        }
    }
    private fun collectRaidResources() {
        if (mission != MissionKind.RAID) return
        val collected = resources.filter { hypot(x - it.x, z - it.z) < 2.1f }
        if (collected.isNotEmpty()) {
            raidCollected += collected.size
            score += collected.size * 300
            resources.removeAll(collected.toSet())
        }
    }
    private fun damage(value: Float) { val shieldHit = min(shield, value); shield -= shieldHit; health = max(0f, health - max(0f, value - shieldHit)) }
    private fun id(prefix: String) = "$prefix${nextId++}"
    private fun entity(body: LocalBody) = Entity(body.id, body.type, body.x, body.z, body.rotation, body.health, body.maxHealth, body.owner, body.weapon)
    private fun objective(): ObjectiveState {
        val components = enemies.count { it.type == "boss_component" && it.health > 0f }
        return when (mission) {
            MissionKind.SURVIVAL -> ObjectiveState("坚持生存 · 波次 $wave", min(1f, wave / 12f))
            MissionKind.BOSS -> ObjectiveState("摧毁组件后攻击核心", if (components > 0) (3 - components) / 3f else 1f, bossComponents = components)
            MissionKind.ESCORT -> {
                val ship = transport
                ObjectiveState("护送运输舰抵达出口", ((24f - (ship?.z ?: 24f)) / 50f).coerceIn(0f, 1f), escortHealth = (ship?.health ?: 0f).toInt())
            }
            MissionKind.DEFENSE -> ObjectiveState("占领能源节点", controlProgress / 100f, controlProgress = controlProgress.toInt())
            MissionKind.TIMED -> ObjectiveState("倒计时内击毁 18 个目标", kills / 18f, timeRemaining = timeRemaining)
            MissionKind.RAID -> ObjectiveState("收集 8 个能源容器", raidCollected / 8f, raidCollected = raidCollected)
        }
    }
    private fun snapshot(): Snapshot {
        val friendlies = buildList {
            add(Entity("local", "player", x, z, rotation, health, 100f, "local", "player"))
            transport?.let { add(entity(it)) }
        }
        return Snapshot(
            "local", wave, score, health.toInt(), shield.toInt(), energy.toInt(),
            friendlies, enemies.map(::entity), bullets.map(::entity), resources.map(::entity),
            objective(), region, missionComplete, missionFailed, lockRange, failureReason()
        )
    }
    private fun failureReason() = when {
        health <= 0f -> "机体失效，任务被迫中止。"
        mission == MissionKind.ESCORT && (transport?.health ?: 0f) <= 0f -> "运输舰已被摧毁，护航失败。"
        mission == MissionKind.TIMED && timeRemaining <= 0f -> "倒计时结束，歼灭目标未完成。"
        else -> "战术目标未达成。"
    }
}

private class BattleView(
    context: Context,
    private val setStatus: (String) -> Unit,
    private val onGameOver: (String) -> Unit,
    private val onMissionComplete: () -> Unit
) : View(context) {
    private val appContext = context.applicationContext
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG); private val handler = Handler(Looper.getMainLooper()); private val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build(); private val localBattle = LocalBattle()
    @Volatile private var battlefield: Bitmap? = null
    private val shipSprites = ConcurrentHashMap<String, Bitmap>()
    private val shipResources = linkedMapOf(
        "player" to R.drawable.spacefight_interceptor,
        "scout" to R.drawable.spacefight_scout,
        "fighter" to R.drawable.spacefight_fighter,
        "bomber" to R.drawable.spacefight_bomber,
        "gunship" to R.drawable.spacefight_gunship,
        "boss" to R.drawable.spacefight_boss
    )
    private var socket: WebSocket? = null; private var connected = false; private var localRunning = false; private var paused = false; private var gameOver = false; private var resultDelivered = false; private var playerId = ""
    @Volatile private var state = Snapshot(); private var hitFlash = 0f; private var leftPointer = -1; private var rightPointer = -1; private var anchorX = 0f; private var anchorY = 0f; private var throttle = 0f; private var strafe = 0f; private var turn = 0f; private var firing = false; private var weapon = 0; private var trainingStep = -1
    private var cameraMode = CameraMode.entries.firstOrNull {
        it.id == appContext.getSharedPreferences("spacefight", Context.MODE_PRIVATE).getString("camera_mode", CameraMode.CHASE.id)
    } ?: CameraMode.CHASE
    private val stars = List(120) { i -> floatArrayOf(((i * 47) % 997) / 997f, ((i * 83 + 19) % 991) / 991f, .7f + (i % 5) * .22f) }
    private val inputPump = object : Runnable { override fun run() {
        if (localRunning && !paused) {
            val previousHealth = state.health; state = localBattle.step(1f / 60f, FlightInput(throttle, strafe, turn, hypot(throttle, strafe) > .82f, firing, weapon), trainingStep >= 0); if (state.health < previousHealth) hitFlash = 1f
            when {
                (state.health <= 0 || state.missionFailed) && !resultDelivered -> {
                    resultDelivered = true; gameOver = true; paused = true; setStatus("任务失败 · 返回飞行甲板重新部署"); onGameOver(state.failureReason)
                }
                state.missionComplete && !resultDelivered -> {
                    resultDelivered = true; paused = true; setStatus("任务完成 · 战果已记录"); onMissionComplete()
                }
                else -> { postInvalidateOnAnimation(); handler.postDelayed(this, 16) }
            }
        } else if (connected && !paused) {
            val input = JSONObject().put("throttle", throttle).put("strafe", strafe).put("turn", turn).put("boost", hypot(throttle.toDouble(), strafe.toDouble()) > .82).put("fire", firing).put("weapon", weapon); send(JSONObject().put("type", "input").put("input", input)); handler.postDelayed(this, 33)
        }
    } }

    init { setBackgroundColor(Color.rgb(5, 8, 11)); loadVisualAssetsAsync() }
    private fun loadVisualAssetsAsync() {
        Thread({
            val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 }
            battlefield = BitmapFactory.decodeResource(resources, R.drawable.spacefight_battlefield, options)
            shipResources.forEach { (key, resource) ->
                BitmapFactory.decodeResource(resources, resource)?.let { shipSprites[key] = it }
                postInvalidateOnAnimation()
            }
        }, "spacefight-visual-assets").start()
    }
    fun connect(mode: String, name: String) {
        disconnect(); gameOver = false; resultDelivered = false; paused = false
        if (mode != "public") {
            localRunning = true
            state = localBattle.reset(mode)
            trainingStep = if (appContext.getSharedPreferences("spacefight", Context.MODE_PRIVATE).getBoolean("flight_training_complete", false)) -1 else 0
            setStatus(if (trainingStep >= 0) "飞行校准 · 完成三项操作后敌潮抵达" else "离线战斗 · 本机 60 Hz")
            handler.post(inputPump)
            postInvalidateOnAnimation()
            return
        }
        setStatus("正在连接战区")
        socket = client.newWebSocket(Request.Builder().url("wss://spacefight.zhengzhengstudio.cn/ws").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { connected = true; send(JSONObject().put("type", "join").put("mode", mode).put("difficulty", "normal").put("name", name)); setStatus("已连接 · ${modeLabel(mode)}"); handler.post(inputPump) }
            override fun onMessage(webSocket: WebSocket, text: String) = parse(text); override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { connected = false; setStatus("连接已结束") }; override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { connected = false; setStatus("无法连接服务器") }
        })
    }
    fun restart(mode: String) { disconnect(); connect(mode, "Player") }
    fun togglePause(): Boolean { if (!localRunning && !connected) return false; paused = !paused; if (!paused) { handler.post(inputPump); postInvalidateOnAnimation() }; return paused }
    fun toggleCamera(): CameraMode {
        cameraMode = if (cameraMode == CameraMode.COCKPIT) CameraMode.CHASE else CameraMode.COCKPIT
        appContext.getSharedPreferences("spacefight", Context.MODE_PRIVATE).edit().putString("camera_mode", cameraMode.id).apply()
        postInvalidateOnAnimation()
        return cameraMode
    }
    fun isGameOver() = gameOver
    fun disconnect() { localRunning = false; connected = false; paused = false; trainingStep = -1; handler.removeCallbacks(inputPump); socket?.send(JSONObject().put("type", "leave").toString()); socket?.close(1000, "leave"); socket = null; resetInput(); postInvalidateOnAnimation() }
    private fun modeLabel(value: String) = when (value) {
        "public" -> "公开协作"; "boss" -> "首领截击"; "escort" -> "运输护航"
        "defense" -> "据点防守"; "timed" -> "限时歼灭"; "raid" -> "资源突袭"; else -> "生存巡航"
    }
    private fun send(json: JSONObject) { socket?.send(json.toString()) }
    private fun parse(raw: String) {
        val root = runCatching { JSONObject(raw) }.getOrNull() ?: return; if (root.optString("type") == "welcome") playerId = root.optString("playerId"); if (root.optString("type") != "snapshot") return
        val players = entities(root, "players", "player"); val own = root.optJSONArray("players")?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) }.firstOrNull { it.optString("id") == playerId } }
        state = Snapshot(playerId, root.optJSONObject("room")?.optInt("wave") ?: 0, own?.optInt("score") ?: 0, own?.optInt("health") ?: 100, own?.optInt("shield") ?: 100, own?.optInt("energy") ?: 100, players, entities(root, "enemies", "enemy"), entities(root, "bullets", "bullet"), entities(root, "powerups", "powerup")); postInvalidateOnAnimation()
    }
    private fun entities(root: JSONObject, key: String, fallback: String): List<Entity> {
        val array = root.optJSONArray(key) ?: return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            array.optJSONObject(i)?.let { item ->
                val position = item.optJSONObject("position")
                Entity(item.optString("id"), item.optString("type", fallback), position?.optDouble("x")?.toFloat() ?: 0f, position?.optDouble("z")?.toFloat() ?: 0f, item.optDouble("rotation").toFloat(), item.optDouble("health", 1.0).toFloat(), item.optDouble("maxHealth", 1.0).toFloat(), item.optString("owner"), item.optString("weapon"))
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawColor(Color.rgb(5, 8, 11)); paint.alpha = 170; battlefield?.let { canvas.drawBitmap(it, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), paint) }; paint.alpha = 255
        stars.forEachIndexed { index, star -> paint.color = Color.argb(((sin(System.currentTimeMillis() / 850.0 + index) * .2 + .62) * 185).toInt(), 190, 204, 211); canvas.drawCircle(star[0] * width, star[1] * height, star[2], paint) }
        if (!localRunning && !connected) drawDeckShip(canvas) else {
            drawRegion(canvas)
            state.powerups.filter(::visible).forEach { drawPowerup(canvas, it) }
            state.bullets.filter(::visible).forEach { drawBullet(canvas, it) }
            if (cameraMode == CameraMode.CHASE) state.players.forEach { drawEngineBloom(canvas, it, it.id == state.self) }
            state.enemies.filter(::visible).forEach { drawEnemy(canvas, it) }
            state.players.filter(::visible).forEach { entity ->
                val localShip = entity.id == state.self
                if (!localShip || cameraMode == CameraMode.CHASE) drawShip(canvas, entity, localShip)
            }
            if (cameraMode == CameraMode.COCKPIT) drawCockpitOverlay(canvas)
            drawHud(canvas); drawControls(canvas); if (trainingStep >= 0) drawTraining(canvas); if (paused) drawPauseState(canvas)
        }
        if ((localRunning || connected) && !paused) postInvalidateOnAnimation()
    }
    private fun d(value: Float) = value * resources.displayMetrics.density
    private fun localShip() = state.players.firstOrNull { it.id == state.self }
    private fun cameraSpace(e: Entity): Triple<Float, Float, Float> {
        val local = localShip() ?: return Triple(e.x, -e.z, 0f)
        val dx = e.x - local.x
        val dz = e.z - local.z
        val lateral = dx * cos(local.rotation) + dz * sin(local.rotation)
        val forward = dx * sin(local.rotation) - dz * cos(local.rotation)
        return Triple(lateral, forward, local.rotation)
    }
    private fun visible(e: Entity): Boolean {
        if (e.id == state.self) return cameraMode == CameraMode.CHASE
        return cameraMode == CameraMode.CHASE || cameraSpace(e).second > -2.5f
    }
    private fun point(e: Entity): Pair<Float, Float> {
        val (lateral, forward) = cameraSpace(e)
        return if (cameraMode == CameraMode.COCKPIT) {
            val depth = max(4f, forward + 7f)
            Pair(width * .5f + lateral / depth * width * .72f, height * .38f + height * .34f / (depth * .12f))
        } else {
            Pair(width * .5f + lateral / 34f * width * .44f, height * .72f - forward / 45f * height * .58f)
        }
    }
    private fun drawRegion(canvas: Canvas) {
        val horizon = height * .39f
        when (state.region) {
            RegionKind.CANYON -> {
                paint.color = 0xD712171A.toInt()
                val leftWall = Path().apply {
                    moveTo(0f, horizon * .76f); lineTo(width * .24f, horizon)
                    lineTo(width * .38f, height.toFloat()); lineTo(0f, height.toFloat()); close()
                }
                val rightWall = Path().apply {
                    moveTo(width.toFloat(), horizon * .72f); lineTo(width * .76f, horizon)
                    lineTo(width * .62f, height.toFloat()); lineTo(width.toFloat(), height.toFloat()); close()
                }
                canvas.drawPath(leftWall, paint); canvas.drawPath(rightWall, paint)
                paint.style = Paint.Style.STROKE; paint.strokeWidth = d(2f); paint.color = 0xAAE1A34F.toInt()
                canvas.drawLine(width * .24f, horizon, width * .38f, height.toFloat(), paint)
                canvas.drawLine(width * .76f, horizon, width * .62f, height.toFloat(), paint)
                paint.style = Paint.Style.FILL
            }
            RegionKind.STORM -> {
                val phase = System.currentTimeMillis() / 24f
                repeat(7) { index ->
                    val x = ((index * 173f + phase * (index % 3 + 1) * .06f) % (width + d(180f))) - d(90f)
                    val y = horizon * (.48f + (index % 3) * .16f)
                    paint.color = if (index % 2 == 0) 0xC11B2730.toInt() else 0xB22E3941.toInt()
                    canvas.drawOval(RectF(x - d(74f), y - d(23f), x + d(74f), y + d(23f)), paint)
                }
                if ((System.currentTimeMillis() / 170L) % 9L == 0L) {
                    paint.style = Paint.Style.STROKE; paint.strokeWidth = d(2f); paint.color = 0xFF79D8E4.toInt()
                    val boltX = width * .67f
                    val bolt = Path().apply {
                        moveTo(boltX, horizon * .36f); lineTo(boltX - d(14f), horizon * .63f)
                        lineTo(boltX + d(8f), horizon * .72f); lineTo(boltX - d(18f), horizon)
                    }
                    canvas.drawPath(bolt, paint); paint.style = Paint.Style.FILL
                }
            }
        }
    }
    private fun drawCockpitOverlay(canvas: Canvas) {
        val bottom = height.toFloat()
        val railTop = height * .78f
        paint.color = 0xF20A0E11.toInt()
        val frame = Path().apply {
            moveTo(0f, bottom); lineTo(0f, height * .22f); lineTo(d(24f), height * .22f)
            lineTo(width * .31f, railTop); lineTo(width * .69f, railTop)
            lineTo(width - d(24f), height * .22f); lineTo(width.toFloat(), height * .22f)
            lineTo(width.toFloat(), bottom); close()
        }
        canvas.drawPath(frame, paint)
        paint.style = Paint.Style.STROKE; paint.strokeWidth = d(3f); paint.color = 0xFF63717A.toInt()
        canvas.drawLine(d(24f), height * .22f, width * .31f, railTop, paint)
        canvas.drawLine(width - d(24f), height * .22f, width * .69f, railTop, paint)
        canvas.drawLine(width * .31f, railTop, width * .69f, railTop, paint)
        paint.strokeWidth = d(1f); paint.color = 0x88F0A44B.toInt()
        canvas.drawLine(width * .35f, railTop + d(10f), width * .65f, railTop + d(10f), paint)
        paint.style = Paint.Style.FILL; paint.typeface = Typeface.MONOSPACE; paint.textSize = d(8f); paint.color = 0xFFE0E6E8.toInt(); paint.textAlign = Paint.Align.CENTER
        canvas.drawText("COCKPIT // FLIGHT VECTOR STABLE", width * .5f, railTop + d(24f), paint)
        paint.textAlign = Paint.Align.LEFT
    }
    private fun drawDeckShip(canvas: Canvas) { val sprite = shipSprites["player"] ?: return; val size = min(width, height) * .52f; val x = width * .62f; val y = height * .49f; val bloom = LinearGradient(x, y - size * .18f, x, y + size * .35f, intArrayOf(0x00F0A44B, 0x66F0A44B, 0x00F0A44B), null, Shader.TileMode.CLAMP); paint.shader = bloom; canvas.drawCircle(x, y + size * .16f, size * .31f, paint); paint.shader = null; canvas.save(); canvas.rotate(-12f, x, y); canvas.drawBitmap(sprite, null, RectF(x - size / 2, y - size / 2, x + size / 2, y + size / 2), paint); canvas.restore() }
    private fun drawEngineBloom(canvas: Canvas, e: Entity, local: Boolean) { val (x, y) = point(e); if (!local) return; val size = min(width, height) * .13f; paint.color = Color.argb(80, 240, 164, 75); paint.setShadowLayer(d(18f), 0f, d(4f), 0xFFF0A44B.toInt()); canvas.drawOval(RectF(x - size * .18f, y + size * .12f, x + size * .18f, y + size * .52f), paint); paint.clearShadowLayer() }
    private fun relativeRotation(e: Entity) = e.rotation - (localShip()?.rotation ?: 0f)
    private fun drawShip(canvas: Canvas, e: Entity, local: Boolean) { val (x, y) = point(e); val size = min(width, height) * if (local) .13f else .09f; val sprite = shipSprites[if (local) "player" else "fighter"] ?: return; canvas.save(); canvas.rotate(Math.toDegrees(relativeRotation(e).toDouble()).toFloat(), x, y); canvas.drawBitmap(sprite, null, RectF(x - size / 2, y - size / 2, x + size / 2, y + size / 2), paint); canvas.restore() }
    private fun drawEnemy(canvas: Canvas, e: Entity) { val (x, y) = point(e); val size = min(width, height) * if (e.type == "boss") .23f else .09f; val sprite = shipSprites[e.type] ?: shipSprites["scout"] ?: return; canvas.save(); canvas.rotate(Math.toDegrees(relativeRotation(e).toDouble()).toFloat(), x, y); canvas.drawBitmap(sprite, null, RectF(x - size / 2, y - size / 2, x + size / 2, y + size / 2), paint); canvas.restore(); if (e.maxHealth > 1f) { val ratio = (e.health / e.maxHealth).coerceIn(0f, 1f); val barWidth = size * .72f; paint.color = 0xB4141B20.toInt(); canvas.drawRect(x - barWidth / 2, y + size * .44f, x + barWidth / 2, y + size * .48f, paint); paint.color = 0xFFD6604C.toInt(); canvas.drawRect(x - barWidth / 2, y + size * .44f, x - barWidth / 2 + barWidth * ratio, y + size * .48f, paint) } }
    private fun drawBullet(canvas: Canvas, e: Entity) { val (x, y) = point(e); paint.color = if (e.owner == "enemy") 0xFFDC5C4A.toInt() else 0xFFF5C16A.toInt(); paint.setShadowLayer(d(8f), 0f, 0f, paint.color); canvas.drawCircle(x, y, if (e.weapon == "missile") d(5f) else d(3f), paint); paint.clearShadowLayer() }
    private fun drawPowerup(canvas: Canvas, e: Entity) { val (x, y) = point(e); paint.style = Paint.Style.STROKE; paint.strokeWidth = d(2f); paint.color = 0xFF67C6B2.toInt(); canvas.drawCircle(x, y, d(12f), paint); paint.style = Paint.Style.FILL; canvas.drawCircle(x, y, d(4f), paint) }
    private fun drawHud(canvas: Canvas) {
        val inset = d(16f); val unit = d(1f); paint.style = Paint.Style.STROKE; paint.strokeWidth = unit; paint.color = 0xAA52606A.toInt(); canvas.drawLine(inset, d(64f), inset + d(138f), d(64f), paint); canvas.drawLine(width - inset - d(138f), d(64f), width - inset, d(64f), paint); paint.style = Paint.Style.FILL
        paint.typeface = Typeface.create("sans-serif", Typeface.BOLD); paint.textSize = d(13f); paint.color = 0xFFF0F3F4.toInt(); canvas.drawText("WAVE ${state.wave.toString().padStart(2, '0')}", inset, d(52f), paint); paint.typeface = Typeface.MONOSPACE; paint.textAlign = Paint.Align.RIGHT; canvas.drawText(state.score.toString().padStart(7, '0'), width - inset, d(52f), paint); paint.textAlign = Paint.Align.LEFT
        meter(canvas, inset, d(76f), "HULL", state.health, 0xFFD6604C.toInt()); meter(canvas, inset, d(112f), "SHIELD", state.shield, 0xFF5EB8C5.toInt()); meter(canvas, inset, d(148f), "ENERGY", state.energy, 0xFFF0A44B.toInt())
        drawObjectivePanel(canvas); drawReticle(canvas); drawThreatCue(canvas); drawWeaponRail(canvas); drawDamageVignette(canvas)
    }
    private fun drawObjectivePanel(canvas: Canvas) {
        val objective = state.objective
        val panelW = min(d(206f), width * .32f)
        val left = width - panelW - d(16f)
        val top = d(72f)
        paint.color = 0xE80A0F13.toInt(); canvas.drawRect(left, top, left + panelW, top + d(67f), paint)
        paint.color = 0xFFF0A44B.toInt(); canvas.drawRect(left, top, left + d(4f), top + d(67f), paint)
        paint.typeface = Typeface.create("sans-serif", Typeface.BOLD); paint.textSize = d(9f); paint.color = 0xFFABB8BE.toInt()
        canvas.drawText("TACTICAL OBJECTIVE", left + d(13f), top + d(17f), paint)
        paint.textSize = d(11f); paint.color = 0xFFF0F3F4.toInt(); canvas.drawText(objective.label.take(22), left + d(13f), top + d(36f), paint)
        val detail = when {
            objective.bossComponents > 0 -> "组件 ${objective.bossComponents}"
            objective.escortHealth < 100 -> "护航舰 ${objective.escortHealth}%"
            objective.timeRemaining > 0f -> "剩余 ${objective.timeRemaining.toInt()} 秒"
            objective.raidCollected > 0 -> "已回收 ${objective.raidCollected}/8"
            objective.controlProgress > 0 -> "控制 ${objective.controlProgress}%"
            else -> "区域 ${state.region.id.uppercase()}"
        }
        paint.typeface = Typeface.MONOSPACE; paint.textSize = d(8f); paint.color = 0xFFC4CED2.toInt(); canvas.drawText(detail, left + d(13f), top + d(52f), paint)
        paint.color = 0xFF263139.toInt(); canvas.drawRect(left + d(13f), top + d(57f), left + panelW - d(10f), top + d(61f), paint)
        paint.color = 0xFFF0A44B.toInt(); canvas.drawRect(left + d(13f), top + d(57f), left + d(13f) + (panelW - d(23f)) * objective.progress.coerceIn(0f, 1f), top + d(61f), paint)
    }
    private fun meter(canvas: Canvas, x: Float, y: Float, label: String, value: Int, color: Int) { val w = d(148f); paint.color = 0xB40B1014.toInt(); canvas.drawRect(x, y, x + w, y + d(17f), paint); paint.color = color; canvas.drawRect(x, y, x + w * (value / 100f).coerceIn(0f, 1f), y + d(17f), paint); paint.typeface = Typeface.MONOSPACE; paint.textSize = d(9f); paint.color = 0xFFF1F3F4.toInt(); canvas.drawText("$label ${value.toString().padStart(3, '0')}", x + d(6f), y + d(12f), paint) }
    private fun drawReticle(canvas: Canvas) { val x = width * .5f; val y = height * .43f; val r = d(20f); paint.style = Paint.Style.STROKE; paint.strokeWidth = d(1.5f); paint.color = if (firing) 0xFFF0A44B.toInt() else 0xBDE2E8EA.toInt(); canvas.drawCircle(x, y, r, paint); canvas.drawLine(x - r - d(8f), y, x - r + d(1f), y, paint); canvas.drawLine(x + r - d(1f), y, x + r + d(8f), y, paint); canvas.drawLine(x, y - r - d(8f), x, y - r + d(1f), paint); canvas.drawLine(x, y + r - d(1f), x, y + r + d(8f), paint); paint.style = Paint.Style.FILL; canvas.drawCircle(x, y, d(2f), paint) }
    private fun drawThreatCue(canvas: Canvas) { val own = localShip() ?: return; val target = state.enemies.minByOrNull { hypot(it.x - own.x, it.z - own.z) } ?: return; if (hypot(target.x - own.x, target.z - own.z) > state.lockRange) return; val (tx, ty) = point(target); val cx = width * .5f; val cy = height * .43f; val angle = atan2(ty - cy, tx - cx); val r = min(width, height) * .27f; val x = cx + cos(angle) * r; val y = cy + sin(angle) * r; paint.color = if (target.type == "boss") 0xFFF0A44B.toInt() else 0xFFD6604C.toInt(); paint.style = Paint.Style.STROKE; paint.strokeWidth = d(2f); canvas.drawCircle(x, y, d(8f), paint); canvas.drawLine(x, y, tx, ty, paint); paint.style = Paint.Style.FILL; paint.textSize = d(9f); canvas.drawText(if (target.type == "boss") "PRIORITY" else "THREAT", x + d(12f), y + d(3f), paint) }
    private fun drawWeaponRail(canvas: Canvas) { val names = arrayOf("PULSE", "SCATTER", "MISSILE", "RAIL", "PLASMA"); val slotW = d(62f); val slotH = d(34f); val gap = d(5f); val total = names.size * slotW + (names.size - 1) * gap; val start = (width - total) / 2f; val y = height - d(54f); names.forEachIndexed { i, name -> val left = start + i * (slotW + gap); paint.color = if (i == weapon) 0xFFF0A44B.toInt() else 0xCC10171C.toInt(); canvas.drawRect(left, y, left + slotW, y + slotH, paint); paint.style = Paint.Style.STROKE; paint.strokeWidth = d(1f); paint.color = if (i == weapon) 0xFFF0A44B.toInt() else 0xFF46545E.toInt(); canvas.drawRect(left, y, left + slotW, y + slotH, paint); paint.style = Paint.Style.FILL; paint.typeface = Typeface.MONOSPACE; paint.textAlign = Paint.Align.CENTER; paint.textSize = d(8f); paint.color = if (i == weapon) 0xFF141719.toInt() else 0xFFD3DDE1.toInt(); canvas.drawText(name, left + slotW / 2, y + d(20f), paint); paint.textSize = d(7f); canvas.drawText("${i + 1}", left + slotW / 2, y + d(29f), paint) }; paint.textAlign = Paint.Align.LEFT }
    private fun drawDamageVignette(canvas: Canvas) { if (hitFlash > 0f) hitFlash = max(0f, hitFlash - .035f); val severity = max(hitFlash, (35 - state.health).coerceAtLeast(0) / 100f); if (severity <= 0f) return; paint.color = Color.argb((severity * 120).toInt(), 214, 96, 76); canvas.drawRect(0f, 0f, width.toFloat(), d(10f), paint); canvas.drawRect(0f, height - d(10f), width.toFloat(), height.toFloat(), paint); canvas.drawRect(0f, 0f, d(10f), height.toFloat(), paint); canvas.drawRect(width - d(10f), 0f, width.toFloat(), height.toFloat(), paint) }
    private fun drawControls(canvas: Canvas) { val radius = d(54f); val lx = if (leftPointer >= 0) anchorX else d(88f); val ly = if (leftPointer >= 0) anchorY else height - d(98f); paint.style = Paint.Style.STROKE; paint.strokeWidth = d(2f); paint.color = 0x7391A3AC; canvas.drawCircle(lx, ly, radius, paint); paint.style = Paint.Style.FILL; paint.color = 0x80F0A44B.toInt(); canvas.drawCircle(lx + strafe * radius * .55f, ly - throttle * radius * .55f, radius * .28f, paint); val rx = width - d(88f); val ry = height - d(98f); paint.style = Paint.Style.STROKE; paint.color = if (firing) 0xFFF0A44B.toInt() else 0x7391A3AC; canvas.drawCircle(rx, ry, radius, paint); paint.style = Paint.Style.FILL; paint.color = if (firing) 0x96F0A44B.toInt() else 0x505C6870; canvas.drawCircle(rx, ry, radius * .48f, paint); paint.color = 0xFFE6EAEB.toInt(); paint.textSize = d(10f); paint.textAlign = Paint.Align.CENTER; canvas.drawText("瞄准 / 开火", rx, ry + d(3f), paint); paint.textSize = d(9f); paint.color = 0xFFBFC9CE.toInt(); canvas.drawText("移动", lx, ly + radius + d(16f), paint); paint.textAlign = Paint.Align.LEFT }
    private fun drawTraining(canvas: Canvas) {
        val titles = arrayOf("移动校准", "瞄准并开火", "切换武器")
        val copies = arrayOf("左侧拖动移动", "右侧拖动瞄准并自动开火", "点选底部武器")
        val boxW = min(width * .54f, d(440f)); val boxH = d(82f); val left = (width - boxW) / 2f; val top = d(74f)
        paint.color = 0xE60A0F13.toInt(); canvas.drawRect(left, top, left + boxW, top + boxH, paint)
        paint.color = 0xFFF0A44B.toInt(); canvas.drawRect(left, top, left + d(4f), top + boxH, paint)
        paint.typeface = Typeface.create("sans-serif", Typeface.BOLD); paint.textSize = d(17f); paint.textAlign = Paint.Align.LEFT; paint.color = 0xFFF2F4F5.toInt(); canvas.drawText("飞行校准 ${trainingStep + 1}/3 · ${titles[trainingStep]}", left + d(18f), top + d(31f), paint)
        paint.typeface = Typeface.MONOSPACE; paint.textSize = d(11f); paint.color = 0xFFB3C0C7.toInt(); canvas.drawText(copies[trainingStep], left + d(18f), top + d(56f), paint)
    }
    private fun drawPauseState(canvas: Canvas) { paint.color = 0xB805080B.toInt(); canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint); paint.color = 0xFFF1F3F4.toInt(); paint.typeface = Typeface.create("sans-serif", Typeface.BOLD); paint.textSize = d(19f); paint.textAlign = Paint.Align.CENTER; canvas.drawText("任务暂停", width / 2f, height / 2f, paint); paint.typeface = Typeface.MONOSPACE; paint.textSize = d(10f); paint.color = 0xFFB4C0C6.toInt(); canvas.drawText("操作：左侧移动 · 右侧瞄准开火 · 底部切换武器", width / 2f, height / 2f + d(25f), paint); paint.textAlign = Paint.Align.LEFT }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val index = event.actionIndex
        val id = event.getPointerId(index)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                if (paused) return true
                val x = event.getX(index)
                val y = event.getY(index)
                val slotW = d(62f)
                val gap = d(5f)
                val total = 5 * slotW + 4 * gap
                val start = (width - total) / 2f
                val railY = height - d(60f)
                val insideRail = y in railY..(railY + d(42f)) && x in start..(start + total)
                if (insideRail) {
                    val offset = x - start
                    val picked = (offset / (slotW + gap)).toInt()
                    val insideSlot = offset - picked * (slotW + gap) <= slotW
                    if (picked in 0..4 && insideSlot) {
                        weapon = picked
                        if (trainingStep == 2) completeTraining()
                    }
                } else if (x < width / 2f && leftPointer < 0) {
                    leftPointer = id; anchorX = x; anchorY = y
                } else if (rightPointer < 0) {
                    rightPointer = id; firing = true; updateAim(x)
                    if (trainingStep == 1) trainingStep = 2
                }
            }
            MotionEvent.ACTION_MOVE -> for (i in 0 until event.pointerCount) when (event.getPointerId(i)) {
                leftPointer -> updateMove(event.getX(i), event.getY(i))
                rightPointer -> updateAim(event.getX(i))
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                if (id == leftPointer) { leftPointer = -1; throttle = 0f; strafe = 0f }
                if (id == rightPointer) { rightPointer = -1; firing = false; turn = 0f }
            }
            MotionEvent.ACTION_CANCEL -> resetInput()
        }
        invalidate()
        return true
    }
    private fun updateMove(x: Float, y: Float) { val radius = d(54f); val dx = x - anchorX; val dy = y - anchorY; val length = max(1f, hypot(dx, dy)); val scale = min(1f, radius / length); strafe = (dx * scale / radius).coerceIn(-1f, 1f); throttle = (-dy * scale / radius).coerceIn(-1f, 1f); if (trainingStep == 0 && hypot(strafe, throttle) > .22f) trainingStep = 1 }
    private fun updateAim(x: Float) { turn = ((x - (width - d(88f))) / d(140f)).coerceIn(-.5f, .5f) }
    private fun completeTraining() { trainingStep = -1; appContext.getSharedPreferences("spacefight", Context.MODE_PRIVATE).edit().putBoolean("flight_training_complete", true).apply(); setStatus("校准完成 · 敌潮接近") }
    private fun resetInput() { leftPointer = -1; rightPointer = -1; throttle = 0f; strafe = 0f; turn = 0f; firing = false }
    override fun onDetachedFromWindow() { disconnect(); client.dispatcher.executorService.shutdown(); super.onDetachedFromWindow() }
}
