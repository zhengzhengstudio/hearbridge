package com.zzsys.debugassistant

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File

/**
 * 文件浏览：project 模式（Mac 工作区目录树，点文件进编辑器、可触发构建下载安装）
 *          / local 模式（列本机 Download 里的 apk/apks 直接安装）。
 */
class FileActivity : Activity() {
    private lateinit var ll: LinearLayout
    private lateinit var tvTitle: TextView
    private var project: String? = null
    private var currentPath = ""
    private var buildId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        project = intent.getStringExtra("project")
        val pad = (16 * resources.displayMetrics.density).toInt()
        val scroll = ScrollView(this)
        ll = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        scroll.addView(ll)
        setContentView(scroll)

        tvTitle = TextView(this).apply { textSize = 18f }
        ll.addView(tvTitle)

        if (project == null) {
            // local 模式：安装本机包
            tvTitle.text = "本机调试包安装"
            listLocalPackages()
        } else {
            tvTitle.text = "📁 $project/"
            buildBrowserUi()
            navigate("")
        }
    }

    // ---------- Mac 工作区浏览 ----------
    private fun buildBrowserUi() {
        val pad8 = (8 * resources.displayMetrics.density).toInt()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val btnUp = Button(this).apply { text = "⬆ 上一级" }
        btnUp.setOnClickListener {
            navigate(currentPath.substringBeforeLast('/', "").ifEmpty { "" })
        }
        val btnBuild = Button(this).apply { text = "🔨 触发构建" }
        btnBuild.setOnClickListener { triggerBuild() }
        row.addView(btnUp, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(btnBuild, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        ll.addView(row)
    }

    private fun navigate(path: String) {
        currentPath = path
        tvTitle.text = "📁 ${project}/${if (path.isEmpty()) "" else path + "/"}"
        MacApi.tree(this, project!!, path) { ok, msg ->
            ll.removeViews(2, ll.childCount - 2) // 保留标题行和按钮行
            if (!ok) {
                ll.addView(TextView(this).apply { text = "读取失败：$msg" })
                return@tree
            }
            val arr = org.json.JSONObject(msg).optJSONArray("entries") ?: return@tree
            if (arr.length() == 0) ll.addView(TextView(this).apply { text = "（空目录）" })
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val name = o.getString("name")
                val isDir = o.getBoolean("dir")
                val childPath = if (path.isEmpty()) name else "$path/$name"
                if (isDir) {
                    ll.addView(Button(this).apply {
                        text = "📁 $name"; setAllCaps(false)
                        setOnClickListener { navigate(childPath) }
                    })
                } else {
                    ll.addView(Button(this).apply {
                        text = "📄 $name"; setAllCaps(false)
                        setOnClickListener {
                            startActivity(Intent(this@FileActivity, EditorActivity::class.java)
                                .putExtra("project", project).putExtra("path", childPath))
                        }
                    })
                }
            }
        }
    }

    private fun triggerBuild() {
        val p = project ?: return
        Toast.makeText(this, "构建请求已发送…", Toast.LENGTH_SHORT).show()
        MacApi.build(this, p) { ok, msg ->
            if (!ok) { Toast.makeText(this, "构建触发失败：$msg", Toast.LENGTH_LONG).show(); return@build }
            buildId = org.json.JSONObject(msg).optString("buildId")
            pollBuild(0)
        }
    }

    private fun pollBuild(round: Int) {
        val id = buildId ?: return
        if (round > 600) { Toast.makeText(this, "构建超时（10 分钟）", Toast.LENGTH_LONG).show(); return }
        Thread {
            val (ok, body) = MacApi.buildStatusSync(this, id)
            runOnUiThread {
                if (!ok) { Toast.makeText(this, "查询状态失败：$body", Toast.LENGTH_LONG).show(); return@runOnUiThread }
                val o = org.json.JSONObject(body)
                val status = o.optString("status")
                if (status == "running") {
                    pollBuild(round + 1)
                } else if (status == "success") {
                    val artifact = o.optString("artifact")
                    Toast.makeText(this, "构建成功：${artifact.substringAfterLast('/')}", Toast.LENGTH_LONG).show()
                    downloadAndInstall(id)
                } else {
                    showLog(o.optString("logTail"))
                }
            }
        }.start()
    }

    private fun showLog(log: String) {
        ll.removeViews(2, maxOf(0, ll.childCount - 2))
        ll.addView(TextView(this).apply {
            text = "❌ 构建失败，日志（末尾）：\n$log"
            textSize = 11f
            typeface = android.graphics.Typeface.MONOSPACE
        })
    }

    private fun downloadAndInstall(buildId: String) {
        Thread {
            val (file, name) = MacApi.downloadArtifact(this, buildId)
            runOnUiThread {
                if (file == null) {
                    Toast.makeText(this, "下载失败：$name", Toast.LENGTH_LONG).show()
                    return@runOnUiThread
                }
                Toast.makeText(this, "已下载 $name，准备安装…", Toast.LENGTH_SHORT).show()
                installFile(file)
            }
        }.start()
    }

    // ---------- 本机包安装 ----------
    private fun listLocalPackages() {
        val dirs = listOfNotNull(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            externalCacheDir
        )
        val pkgs = linkedSetOf<File>()
        for (d in dirs) {
            d.listFiles()?.forEach { f ->
                if (f.isFile && f.extension.lowercase() in listOf("apk", "apks")) pkgs.add(f)
            }
        }
        if (pkgs.isEmpty()) {
            ll.addView(TextView(this).apply { text = "Download 目录里没有 .apk/.apks 文件。\n（从电脑拷包到下载目录后会出现在这里）" })
        }
        for (f in pkgs) {
            ll.addView(Button(this).apply {
                text = "📦 ${f.name}（${f.length() / 1024 / 1024}MB）"; setAllCaps(false)
                setOnClickListener { installFile(f) }
            })
        }
    }

    /** 统一安装入口：.apk 走 FileProvider+Intent；.apks 走 PackageInstaller 会话 */
    private fun installFile(file: File) {
        when (file.extension.lowercase()) {
            "apk" -> InstallUtil.installApk(this, file)
            "apks" -> InstallUtil.installApks(this, file)
            else -> Toast.makeText(this, "安卓端暂不支持安装 .${file.extension}（鸿蒙包请用鸿蒙端）", Toast.LENGTH_LONG).show()
        }
    }
}
