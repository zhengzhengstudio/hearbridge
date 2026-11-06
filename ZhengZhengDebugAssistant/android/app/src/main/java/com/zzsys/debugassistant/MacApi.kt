package com.zzsys.debugassistant

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONObject

/**
 * Mac 构建服务客户端（零依赖，HttpURLConnection 直连，局域网）。
 * 服务端见 ZhengZhengDebugAssistant/mac-service/server.mjs。
 */
object MacApi {
    private val main = Handler(Looper.getMainLooper())

    fun baseUrl(ctx: Context): String {
        val sp = ctx.getSharedPreferences("zzda", Context.MODE_PRIVATE)
        val host = sp.getString("host", "")?.trim().orEmpty()
        val port = sp.getString("port", "8124")?.trim().orEmpty()
        if (host.isEmpty()) return ""
        return "http://$host:$port"
    }

    fun token(ctx: Context): String =
        ctx.getSharedPreferences("zzda", Context.MODE_PRIVATE).getString("token", "zhengzheng-debug-2026") ?: ""

    /** 后台执行，主线程回调 (ok, bodyOrError) */
    private fun call(ctx: Context, method: String, urlStr: String, body: String? = null, cb: (Boolean, String) -> Unit) {
        Thread {
            var result: Pair<Boolean, String>? = null
            try {
                val conn = URL(urlStr).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = 5000
                conn.readTimeout = 30000
                conn.setRequestProperty("X-Debug-Token", token(ctx))
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readText) ?: ""
                result = Pair(code in 200..299, if (code in 200..299) text else "HTTP $code: $text")
            } catch (e: Exception) {
                result = Pair(false, e.message ?: e.toString())
            }
            val r = result
            main.post { cb(r.first, r.second) }
        }.start()
    }

    fun ping(ctx: Context, cb: (Boolean, String) -> Unit) {
        val base = baseUrl(ctx)
        if (base.isEmpty()) return cb(false, "请先填写 Mac 服务地址")
        call(ctx, "GET", "$base/api/ping", null, cb)
    }

    fun projects(ctx: Context, cb: (Boolean, String) -> Unit) {
        call(ctx, "GET", "${baseUrl(ctx)}/api/projects", null, cb)
    }

    fun tree(ctx: Context, project: String, path: String, cb: (Boolean, String) -> Unit) {
        val enc = URLEncoder.encode(path.ifEmpty { "" }, "UTF-8")
        call(ctx, "GET", "${baseUrl(ctx)}/api/tree?project=${URLEncoder.encode(project, "UTF-8")}&path=$enc", null, cb)
    }

    fun readFile(ctx: Context, project: String, path: String, cb: (Boolean, String) -> Unit) {
        call(ctx, "GET", "${baseUrl(ctx)}/api/file?project=${URLEncoder.encode(project, "UTF-8")}&path=${URLEncoder.encode(path, "UTF-8")}", null, cb)
    }

    fun writeFile(ctx: Context, project: String, path: String, content: String, cb: (Boolean, String) -> Unit) {
        val obj = JSONObject()
        obj.put("project", project)
        obj.put("path", path)
        obj.put("content", content)
        call(ctx, "POST", "${baseUrl(ctx)}/api/file", obj.toString(), cb)
    }

    fun build(ctx: Context, project: String, cb: (Boolean, String) -> Unit) {
        val obj = JSONObject().put("project", project)
        call(ctx, "POST", "${baseUrl(ctx)}/api/build", obj.toString(), cb)
    }

    fun buildStatus(ctx: Context, buildId: String, cb: (Boolean, String) -> Unit) {
        call(ctx, "GET", "${baseUrl(ctx)}/api/build/$buildId", null, cb)
    }

    fun buildStatusSync(ctx: Context, buildId: String): Pair<Boolean, String> {
        return try {
            val conn = URL("${baseUrl(ctx)}/api/build/$buildId").openConnection() as HttpURLConnection
            conn.setRequestProperty("X-Debug-Token", token(ctx))
            conn.connectTimeout = 5000; conn.readTimeout = 30000
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).readText()
            Pair(true, text)
        } catch (e: Exception) { Pair(false, e.message ?: e.toString()) }
    }

    /** 阻塞下载产物到 cache/installs/，返回本地文件（在调用线程执行） */
    fun downloadArtifact(ctx: Context, buildId: String): Pair<File?, String> {
        return try {
            val dir = File(ctx.cacheDir, "installs").apply { mkdirs() }
            val tmp = File.createTempFile("zzda-", ".bin", dir)
            val conn = URL("${baseUrl(ctx)}/api/build/$buildId/artifact").openConnection() as HttpURLConnection
            conn.setRequestProperty("X-Debug-Token", token(ctx))
            conn.connectTimeout = 5000; conn.readTimeout = 120000
            val name = conn.getHeaderField("X-Artifact-Name")?.let { java.net.URLDecoder.decode(it, "UTF-8") } ?: "artifact.bin"
            conn.inputStream.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } }
            val dest = File(dir, name)
            if (dest.exists()) dest.delete()
            tmp.renameTo(dest)
            Pair(dest, name)
        } catch (e: Exception) { Pair(null, e.message ?: e.toString()) }
    }
}
