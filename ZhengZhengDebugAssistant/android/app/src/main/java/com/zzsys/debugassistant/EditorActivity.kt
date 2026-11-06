package com.zzsys.debugassistant

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** 代码编辑器：拉取 Mac 上的文件 → 本地编辑 → 保存回推 */
class EditorActivity : Activity() {
    private lateinit var etContent: EditText
    private var project: String = ""
    private var path: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        project = intent.getStringExtra("project") ?: ""
        path = intent.getStringExtra("path") ?: ""

        val pad = (16 * resources.displayMetrics.density).toInt()
        val scroll = ScrollView(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        scroll.addView(root)
        setContentView(scroll)

        root.addView(TextView(this).apply {
            text = "✏️ $project/$path"
            textSize = 15f
        })

        etContent = EditText(this).apply {
            gravity = android.view.Gravity.TOP
            minLines = 20
            typeface = android.graphics.Typeface.MONOSPACE
            textSize = 13f
            setSingleLine(false)
        }
        root.addView(etContent)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val btnSave = Button(this).apply { text = "💾 保存到 Mac" }
        btnSave.setOnClickListener {
            Toast.makeText(this, "保存中…", Toast.LENGTH_SHORT).show()
            MacApi.writeFile(this, project, path, etContent.text.toString()) { ok, msg ->
                Toast.makeText(this, if (ok) "✓ 已保存到 Mac" else "✗ 保存失败：$msg", Toast.LENGTH_LONG).show()
            }
        }
        val btnClose = Button(this).apply { text = "关闭" }
        btnClose.setOnClickListener { finish() }
        row.addView(btnSave, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(btnClose, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(row)

        etContent.setText("加载中…")
        MacApi.readFile(this, project, path) { ok, msg ->
            if (ok) {
                etContent.setText(org.json.JSONObject(msg).optString("content"))
            } else {
                etContent.setText("// 读取失败：$msg")
            }
        }
    }
}
