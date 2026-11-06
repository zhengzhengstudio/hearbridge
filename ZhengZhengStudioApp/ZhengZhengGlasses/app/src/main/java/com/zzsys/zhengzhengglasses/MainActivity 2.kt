package com.zzsys.zhengzhengglasses

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var updateState: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildHome())
        checkUpdate(manual = false)
    }

    private fun buildHome(): ScrollView {
        val scroll = ScrollView(this)
        scroll.setBackgroundColor(Color.rgb(238, 245, 244))

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(24), dp(18), dp(28))
        }
        scroll.addView(root, ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        root.addView(label("ZHENGZHENG GLASSES", 13f, Color.rgb(230, 111, 81), true))
        root.addView(label("铮铮眼镜", 34f, Color.rgb(16, 32, 42), true).withTop(6))
        root.addView(label("在线试戴、配镜报告、心愿单和商家沟通入口。App 会自动检查下载中心版本。", 16f, Color.rgb(93, 106, 115), false).withTopBottom(8, 18))

        root.addView(card(
            "当前版本",
            "Android v${BuildConfig.VERSION_NAME} build ${BuildConfig.VERSION_CODE}",
            "检查更新"
        ) { checkUpdate(manual = true) })

        updateState = label("正在读取下载中心版本...", 13f, Color.rgb(93, 106, 115), false).withTopBottom(6, 8)
        root.addView(updateState)

        root.addView(card("开始配镜", "进入采集、试戴、报告和心愿单流程。", "打开配镜流程") {
            open(BuildConfig.ONBOARD_URL)
        })
        root.addView(card("配镜顾问", "和商家或铮铮顾问沟通镜框、度数、定制需求。", "打开聊天") {
            open(BuildConfig.CHAT_URL)
        })
        root.addView(card("商家入口", "上传镜框、查看客户心愿单和处理定制沟通。", "打开商家端") {
            open(BuildConfig.MERCHANT_URL)
        })
        root.addView(card("官网与下载中心", "查看线上 Demo、PPT、后续版本和安装包。", "打开官网") {
            open(BuildConfig.SITE_URL)
        })

        root.addView(label("提示：本版为原生 App 入口和更新检查版本；摄像头试戴仍使用线上正式流程，后续版本会继续下沉原生 MediaPipe 能力。", 12f, Color.rgb(93, 106, 115), false).withTop(8))
        return scroll
    }

    private fun card(title: String, body: String, action: String, onClick: () -> Unit): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(16))
            setBackgroundColor(Color.WHITE)
        }
        val params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, dp(8), 0, dp(8))
        }
        card.layoutParams = params
        card.addView(label(title, 20f, Color.rgb(16, 32, 42), true))
        card.addView(label(body, 14f, Color.rgb(93, 106, 115), false).withTopBottom(8, 12))
        val button = Button(this).apply {
            text = action
            isAllCaps = false
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(15, 118, 110))
            setOnClickListener { onClick() }
        }
        card.addView(button, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(48)
        ))
        return card
    }

    private fun label(text: String, sp: Float, color: Int, bold: Boolean): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = sp
            setTextColor(color)
            setLineSpacing(0f, 1.12f)
            if (bold) setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        }
    }

    private fun TextView.withTop(top: Int): TextView {
        setPadding(paddingLeft, dp(top), paddingRight, paddingBottom)
        return this
    }

    private fun TextView.withTopBottom(top: Int, bottom: Int): TextView {
        setPadding(paddingLeft, dp(top), paddingRight, dp(bottom))
        return this
    }

    private fun checkUpdate(manual: Boolean) {
        updateState.text = "正在读取下载中心版本..."
        thread {
            var hasUpdate = false
            var version = ""
            var downloadUrl = ""
            try {
                val conn = URL(BuildConfig.MANIFEST_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.setRequestProperty("Accept", "application/json")
                val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                val apps = json.optJSONArray("apps")
                if (apps != null) {
                    for (i in 0 until apps.length()) {
                        val item = apps.getJSONObject(i)
                        if (item.optString("id") == BuildConfig.APP_UPDATE_ID) {
                            if (item.optInt("build", 0) > BuildConfig.VERSION_CODE) {
                                hasUpdate = true
                                version = item.optString("version", "未知版本")
                                downloadUrl = item.optString("downloadURL", "")
                                if (downloadUrl.startsWith("/")) downloadUrl = "https://zhengzhengstudio.cn$downloadUrl"
                            }
                            break
                        }
                    }
                }
            } catch (_: Exception) {
            }
            Handler(Looper.getMainLooper()).post {
                if (hasUpdate && downloadUrl.isNotBlank()) {
                    updateState.text = "发现新版本 $version"
                    MaterialAlertDialogBuilder(this)
                        .setTitle("发现新版本")
                        .setMessage("铮铮眼镜 $version 已发布，建议更新以获得最佳体验。")
                        .setPositiveButton("立即更新") { _, _ -> open(downloadUrl) }
                        .setNegativeButton("稍后再说", null)
                        .show()
                } else {
                    updateState.text = if (manual) "已是最新版本" else "当前已是最新版本"
                }
            }
        }
    }

    private fun open(url: String) {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
