package cn.zhengzhengstudio.survivaldiary.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import cn.zhengzhengstudio.survivaldiary.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class ReleaseUpdate(val version: String, val build: Int, val url: String, val sha256: String)
data class DownloadProgress(val downloadedBytes: Long, val totalBytes: Long, val percent: Int?)

fun downloadPercent(downloadedBytes: Long, totalBytes: Long): Int? =
    if (totalBytes <= 0) null else ((downloadedBytes * 100L / totalBytes).coerceIn(0L, 100L)).toInt()

class UpdateRepository(
    private val context: Context,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .retryOnConnectionFailure(true)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .callTimeout(30, TimeUnit.MINUTES)
        .build(),
) {
    companion object {
        fun compareVersions(left: String, right: String): Int {
            val a = left.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
            val b = right.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
            repeat(maxOf(a.size, b.size)) { index ->
                val delta = a.getOrElse(index) { 0 }.compareTo(b.getOrElse(index) { 0 })
                if (delta != 0) return delta
            }
            return 0
        }

        fun selectUpdate(
            manifestJson: String,
            currentVersion: String,
            currentBuild: Int,
            manifestUrl: String,
        ): ReleaseUpdate? {
            val apps = JSONObject(manifestJson).optJSONArray("apps") ?: return null
            for (index in 0 until apps.length()) {
                val item = apps.optJSONObject(index) ?: continue
                if (item.optString("id") !in setOf("survival-diary-android", "survival-diary")) continue
                if (!item.optBoolean("available", true)) continue
                val rawUrl = sequenceOf("downloadURL", "versionedUrl", "url")
                    .map(item::optString)
                    .firstOrNull(String::isNotBlank) ?: continue
                val resolved = runCatching { URI(manifestUrl).resolve(rawUrl) }.getOrNull() ?: continue
                if (resolved.scheme?.equals("https", ignoreCase = true) != true) continue
                val checksum = sequenceOf("sha256", "checksum")
                    .map(item::optString)
                    .firstOrNull(String::isNotBlank)?.lowercase() ?: continue
                if (!checksum.matches(Regex("[0-9a-f]{64}"))) continue
                val version = item.optString("version")
                val build = item.optInt("build", -1)
                if (version.isBlank() || build < 0) continue
                return ReleaseUpdate(version, build, resolved.toString(), checksum)
                    .takeIf { compareVersions(it.version, currentVersion) > 0 || it.build > currentBuild }
            }
            return null
        }
    }
    fun check(currentVersion: String, currentBuild: Int, manifestJson: String): ReleaseUpdate? {
        return selectUpdate(manifestJson, currentVersion, currentBuild, BuildConfig.MANIFEST_URL)
    }

    fun fetchLatest(currentVersion: String, currentBuild: Int): ReleaseUpdate? {
        val response = client.newCall(Request.Builder().url(BuildConfig.MANIFEST_URL).build()).execute()
        check(response.isSuccessful) { "更新清单请求失败：${response.code}" }
        return check(currentVersion, currentBuild, response.body?.string() ?: error("更新清单为空"))
    }

    fun downloadAndVerify(update: ReleaseUpdate, onProgress: (DownloadProgress) -> Unit = {}): File {
        check(BuildConfig.DISTRIBUTION == "website") { "Play distribution must use the store listing" }
        val directory = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "SurvivalDiary").apply { mkdirs() }
        val pending = File(directory, "update-${update.build}.apk.pending")
        val target = File(directory, "SurvivalDiary-${update.version}-${update.build}.apk")
        val existingBytes = pending.takeIf(File::isFile)?.length()?.coerceAtLeast(0L) ?: 0L
        val request = Request.Builder().url(update.url).apply {
            if (existingBytes > 0L) header("Range", "bytes=$existingBytes-")
        }.build()
        val response = client.newCall(request).execute()
        check(response.isSuccessful) { "更新包请求失败：${response.code}" }
        val resumed = existingBytes > 0L && response.code == 206
        if (!resumed && existingBytes > 0L) pending.delete()
        val body = response.body ?: error("empty update")
        val baseBytes = if (resumed) existingBytes else 0L
        val responseBytes = body.contentLength()
        val total = if (responseBytes > 0L) baseBytes + responseBytes else -1L
        var downloaded = baseBytes
        val digest = MessageDigest.getInstance("SHA-256")
        if (resumed) pending.inputStream().buffered(256 * 1024).use { input ->
            val buffer = ByteArray(256 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        onProgress(DownloadProgress(downloaded, total, downloadPercent(downloaded, total)))
        var lastProgressAt = System.nanoTime()
        FileOutputStream(pending, resumed).buffered(256 * 1024).use { output ->
                body.byteStream().buffered(256 * 1024).use { input ->
                val buffer = ByteArray(256 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                    digest.update(buffer, 0, count)
                    downloaded += count
                    val now = System.nanoTime()
                    if (now - lastProgressAt >= 250_000_000L || (total > 0L && downloaded >= total)) {
                        onProgress(DownloadProgress(downloaded, total, downloadPercent(downloaded, total)))
                        lastProgressAt = now
                    }
                }
            }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        if (!hash.equals(update.sha256, ignoreCase = true)) { pending.delete(); error("SHA-256 mismatch") }
        if (!hasCurrentSigner(pending)) { pending.delete(); error("signature mismatch") }
        if (target.exists()) target.delete()
        check(pending.renameTo(target))
        return target
    }

    fun openInstaller(file: File) {
        check(BuildConfig.DISTRIBUTION == "website")
        // PackageInstaller is reached through the platform-confirmed ACTION_VIEW flow only after an explicit UI tap.
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun openPlayListing() = context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${context.packageName.removeSuffix(".debug")}")))

    @Suppress("DEPRECATION")
    private fun hasCurrentSigner(apk: File): Boolean {
        val manager = context.packageManager
        val digest: (ByteArray) -> String = { bytes ->
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        }
        return if (Build.VERSION.SDK_INT >= 28) {
            val flags = PackageManager.GET_SIGNING_CERTIFICATES
            val archiveInfo = manager.getPackageArchiveInfo(apk.path, flags) ?: return false
            if (archiveInfo.packageName != context.packageName) return false
            val archive = archiveInfo.signingInfo?.apkContentsSigners?.map { digest(it.toByteArray()) }?.sorted()
            val current = manager.getPackageInfo(context.packageName, flags).signingInfo.apkContentsSigners.map { digest(it.toByteArray()) }.sorted()
            archive == current
        } else {
            val flags = PackageManager.GET_SIGNATURES
            val archiveInfo = manager.getPackageArchiveInfo(apk.path, flags) ?: return false
            if (archiveInfo.packageName != context.packageName) return false
            val archive = archiveInfo.signatures?.map { digest(it.toByteArray()) }?.sorted()
            val current = manager.getPackageInfo(context.packageName, flags).signatures.map { digest(it.toByteArray()) }.sorted()
            archive == current
        }
    }

}
