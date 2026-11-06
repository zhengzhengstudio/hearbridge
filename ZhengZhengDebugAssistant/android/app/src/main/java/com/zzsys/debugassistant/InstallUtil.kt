package com.zzsys.debugassistant

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream
import java.util.zip.ZipInputStream

/** 调试包安装：.apk 单包直装；.apks（split APK 压缩包）走 PackageInstaller 会话按流写入 */
object InstallUtil {

    fun installApk(ctx: Context, file: File) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !ctx.packageManager.canRequestPackageInstalls()
            ) {
                Toast.makeText(ctx, "请先允许「安装未知应用」：设置 → 应用 → 铮铮调试助手 → 安装未知应用", Toast.LENGTH_LONG).show()
                return
            }
            val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(ctx, "安装失败：${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    fun installApks(ctx: Context, file: File) {
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)
            var installed = 0

            ZipInputStream(FileInputStream(file)).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (entry.name.lowercase().endsWith(".apk")) {
                        val out = session.openWrite(entry.name, 0, entry.size)
                        zip.copyTo(out)
                        session.fsync(out)
                        out.close()
                        installed++
                    }
                    entry = zip.nextEntry
                }
                if (installed == 0) throw IllegalStateException("apks 里没有 .apk 分包")
            }

            val callbackIntent = Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setPackage(ctx.packageName)
            val pi = PendingIntent.getBroadcast(
                ctx, sessionId, callbackIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            session.commit(pi.intentSender)
            session.close()
            Toast.makeText(ctx, "apks 分包已提交安装（$installed 个）", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(ctx, "apks 安装失败：${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}
