package com.zzsys.debugassistant

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * 主屏：配置 Mac 服务地址 + token + 连接测试 + 项目列表。
 * 布局用代码构建（不依赖额外库，规避资源/CSS 之类的坑）。
 */
class MainActivity : Activity() {
    private lateinit var etHost: EditText
    private lateinit var etPort: EditText
    private lateinit var etToken: EditText
    private lateinit var tvResult: TextView
    private lateinit var llProjects: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sp = getSharedPreferences("zzda", MODE_PRIVATE)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        scroll.addView(root)
        setContentView(scroll)

        fun label(text: String): TextView = TextView(this).apply {
            this.text = text
            textSize = 14f
            setPadding(0, pad / 2, 0, 4)
        }

        root.addView(TextView(this).apply {
            text = "铮铮调试助手 v0.1.0"
            textSize = 22f
        })
        root.addView(TextView(this).apply {
            text = "Mac 侧先启动：ZhengZhengDebugAssistant/mac-service → node server.mjs"
            textSize = 12f
            setPadding(0, 4, 0, pad / 2)
        })

        root.addView(label("Mac 服务地址（局域网 IP）"))
        etHost = EditText(this).apply { hint = "如 192.168.1.10"; setText(sp.getString("host", "")) }
        root.addView(etHost)

        root.addView(label("端口"))
        etPort = EditText(this).apply { setText(sp.getString("port", "8124")) }
        root.addView(etPort)

        root.addView(label("Token"))
        etToken = EditText(this).apply { setText(sp.getString("token", "zhengzheng-debug-2026")) }
        root.addView(etToken)

        val btnSave = Button(this).apply { text = "保存并测试连接" }
        root.addView(btnSave)

        tvResult = TextView(this).apply { textSize = 13f; setPadding(0, pad / 2, 0, 0) }
        root.addView(tvResult)

        root.addView(TextView(this).apply {
            text = "项目（点击进入文件浏览）"
            textSize = 16f
            setPadding(0, pad, 0, 4)
        })
        llProjects = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(llProjects)

        // 也支持安装本机已存在的调试包（下载目录/缓存）
        val btnLocal = Button(this).apply { text = "从本机文件安装调试包（.apk/.apks）" }
        btnLocal.setOnClickListener {
            startActivity(Intent(this, FileActivity::class.java).putExtra("mode", "local"))
        }
        root.addView(btnLocal)

        btnSave.setOnClickListener {
            val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            imm.hideSoftInputFromWindow(currentFocus?.windowToken ?: View(this).windowToken, 0)
            sp.edit()
                .putString("host", etHost.text.toString().trim())
                .putString("port", etPort.text.toString().trim())
                .putString("token", etToken.text.toString().trim())
                .apply()
            tvResult.text = "连接中…"
            MacApi.ping(this) { ok, msg ->
                if (ok) {
                    tvResult.text = "✓ 已连接：$msg"
                    loadProjects()
                } else {
                    tvResult.text = "✗ 连接失败：$msg"
                }
            }
        }

        if (MacApi.baseUrl(this).isNotEmpty()) {
            MacApi.ping(this) { ok, msg ->
                tvResult.text = if (ok) "✓ 已连接：$msg" else "✗ 未连接：$msg"
                if (ok) loadProjects()
            }
        }
    }

    private fun loadProjects() {
        MacApi.projects(this) { ok, msg ->
            llProjects.removeAllViews()
            if (!ok) {
                llProjects.addView(TextView(this).apply { text = "获取项目失败：$msg" })
                return@projects
            }
            val arr = org.json.JSONObject(msg).optJSONArray("projects") ?: return@projects
            for (i in 0 until arr.length()) {
                val name = arr.getString(i)
                val btn = Button(this).apply { text = "📁 $name"; setAllCaps(false) }
                btn.setOnClickListener {
                    startActivity(Intent(this, FileActivity::class.java).putExtra("project", name))
                }
                llProjects.addView(btn)
            }
            if (arr.length() == 0) {
                llProjects.addView(TextView(this).apply {
                    text = "工作区还没有项目。把代码目录放进 mac-service/workspace/ 下即可。"
                })
            }
        }
    }
}
