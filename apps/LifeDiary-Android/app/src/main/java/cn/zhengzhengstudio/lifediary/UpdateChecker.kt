package cn.zhengzhengstudio.lifediary

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

data class UpdateInfo(val version: String, val build: Int, val url: String, val fileName: String, val sha256: String, val notes: String)

class UpdateChecker(private val activity: Activity) {
    suspend fun check(): UpdateInfo? = withContext(Dispatchers.IO) {
        val manifest = JSONObject(readText(BuildConfig.MANIFEST_URL))
        val apps = manifest.optJSONArray("apps") ?: return@withContext null
        for (index in 0 until apps.length()) {
            val app = apps.getJSONObject(index)
            if (app.optString("id") != BuildConfig.UPDATE_ID && app.optString("bundleIdentifier") != BuildConfig.APPLICATION_ID) continue
            val remoteBuild = app.optInt("build")
            val localBuild = BuildConfig.VERSION_CODE
            val remoteVersion = app.optString("version", "0")
            if (remoteBuild > localBuild || compareVersions(remoteVersion, BuildConfig.VERSION_NAME) > 0) {
                val rawUrl = app.optString("downloadURL", app.optString("url"))
                val url = if (rawUrl.startsWith("http")) rawUrl else BuildConfig.API_BASE_URL + "/" + rawUrl.removePrefix("/")
                val notes = app.optJSONArray("notes")?.let { values -> (0 until values.length()).joinToString("\n") { values.optString(it) } }.orEmpty()
                return@withContext UpdateInfo(remoteVersion, remoteBuild, url,
                    app.optString("fileName", "LifeDiary-Android-$remoteVersion.apk"), app.optString("sha256"), notes)
            }
            return@withContext null
        }
        null
    }

    suspend fun download(info: UpdateInfo, onProgress: (Float) -> Unit = {}): File = withContext(Dispatchers.IO) {
        require(info.sha256.isNotBlank()) { "更新清单缺少 SHA-256" }
        val downloads = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: error("Downloads 不可用")
        val apk = File(downloads, info.fileName.replace(Regex("[^A-Za-z0-9._-]"), "_"))
        val metadata = remoteMetadata(info.url)
        if (metadata.first > 1 && metadata.second) downloadParallel(info.url, apk, metadata.first, onProgress)
        else downloadSequential(info.url, apk, metadata.first, onProgress)
        if (!info.sha256.equals(sha256(apk), ignoreCase = true)) {
            apk.delete()
            error("安装包校验失败")
        }
        apk
    }

    private suspend fun downloadParallel(address: String, destination: File, length: Long, onProgress: (Float) -> Unit) = coroutineScope {
        val ranges = DownloadRangePlanner.plan(length, 4)
        val downloaded = AtomicLong(0)
        val lastPercent = AtomicInteger(-1)
        val parts = ranges.mapIndexed { index, _ -> File(destination.parentFile, "${destination.name}.part$index") }
        try {
            ranges.mapIndexed { index, range -> async(Dispatchers.IO) {
                val connection = open(address).apply { setRequestProperty("Range", "bytes=${range.first}-${range.last}") }
                if (connection.responseCode != HttpURLConnection.HTTP_PARTIAL) error("服务器不支持分片下载")
                connection.inputStream.use { input -> parts[index].outputStream().use { output ->
                    copyWithProgress(input, output, downloaded, length, lastPercent, onProgress)
                } }
                connection.disconnect()
            } }.awaitAll()
            destination.outputStream().use { output -> parts.forEach { part -> part.inputStream().use { it.copyTo(output) } } }
        } finally { parts.forEach { it.delete() } }
    }

    private fun downloadSequential(address: String, destination: File, expectedLength: Long, onProgress: (Float) -> Unit) {
        val connection = open(address)
        val length = expectedLength.takeIf { it > 0 } ?: connection.contentLengthLong
        connection.inputStream.use { input -> destination.outputStream().use { output ->
            copyWithProgress(input, output, AtomicLong(0), length, AtomicInteger(-1), onProgress)
        } }
        connection.disconnect()
    }

    private fun copyWithProgress(input: java.io.InputStream, output: java.io.OutputStream, downloaded: AtomicLong, total: Long, lastPercent: AtomicInteger, onProgress: (Float) -> Unit) {
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            if (total > 0) {
                val percent = ((downloaded.addAndGet(count.toLong()) * 100) / total).toInt().coerceIn(0, 100)
                var previous = lastPercent.get()
                while (percent > previous) {
                    if (lastPercent.compareAndSet(previous, percent)) {
                        activity.runOnUiThread { onProgress(percent / 100f) }
                        break
                    }
                    previous = lastPercent.get()
                }
            }
        }
    }

    private fun remoteMetadata(address: String): Pair<Long, Boolean> {
        val connection = open(address).apply { requestMethod = "HEAD" }
        return try { connection.contentLengthLong to connection.getHeaderField("Accept-Ranges").orEmpty().contains("bytes", true) }
        finally { connection.disconnect() }
    }

    private fun open(address: String) = (URL(address).openConnection() as HttpURLConnection).apply {
        connectTimeout = 12_000; readTimeout = 30_000
    }

    fun install(apk: File): Boolean {
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return false
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    companion object {
        fun compareVersions(left: String?, right: String?): Int {
            val a = left.orEmpty().split('.'); val b = right.orEmpty().split('.')
            for (index in 0 until maxOf(a.size, b.size)) {
                val av = a.getOrNull(index)?.takeWhile(Char::isDigit)?.toIntOrNull() ?: 0
                val bv = b.getOrNull(index)?.takeWhile(Char::isDigit)?.toIntOrNull() ?: 0
                if (av != bv) return av.compareTo(bv)
            }
            return 0
        }
        private fun readText(address: String): String = (URL(address).openConnection() as HttpURLConnection).run {
            connectTimeout = 8_000; readTimeout = 8_000
            inputStream.bufferedReader().use { it.readText() }
        }
        private fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}

object DownloadRangePlanner {
    fun plan(contentLength: Long, requestedParts: Int): List<LongRange> {
        if (contentLength <= 0 || requestedParts <= 0) return emptyList()
        val count = minOf(contentLength, requestedParts.toLong()).toInt()
        val base = contentLength / count
        val remainder = contentLength % count
        var start = 0L
        return List(count) { index ->
            val size = base + if (index < remainder) 1 else 0
            (start until start + size).also { start += size }
        }
    }
}
