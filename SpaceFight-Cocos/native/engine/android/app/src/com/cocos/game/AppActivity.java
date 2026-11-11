/****************************************************************************
Copyright (c) 2015-2016 Chukong Technologies Inc.
Copyright (c) 2017-2018 Xiamen Yaji Software Co., Ltd.

http://www.cocos2d-x.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
****************************************************************************/
package com.cocos.game;

import cn.zhengzhengstudio.spacefight.R;

import android.animation.ObjectAnimator;
import android.app.AlertDialog;
import android.app.ActivityManager;
import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.cocos.service.SDKWrapper;
import com.cocos.lib.CocosActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.RandomAccessFile;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.lang.ref.WeakReference;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;

public class AppActivity extends CocosActivity {
    private static final String UPDATE_MANIFEST = "https://zhengzhengstudio.cn/api/apps/manifest.json";
    private static final String UPDATE_ID = "spacefight-android";
    private static final int MAX_UPDATE_NOTES = 4;
    private static final int DOWNLOAD_WORKERS = 4;
    private static final long MIN_PARALLEL_BYTES = 4L * 1024L * 1024L;
    private Uri pendingInstallUri;
    private volatile boolean updateDownloadRunning = false;
    private FrameLayout launchOverlay;
    private LinearLayout updateProgressOverlay;
    private ProgressBar updateProgressBar;
    private TextView updateProgressLabel;
    private ObjectAnimator updateProgressAnimator;
    private static WeakReference<AppActivity> activeActivity = new WeakReference<>(null);

    // ---- 崩溃诊断：会话标记 / 错因暂存 / JS 阶段轨迹 ----
    private static final String CRASH_SESSION_FILE = "spacefight-session.txt";
    private static final String CRASH_REPORT_FILE = "spacefight-last-crash.txt";
    private static final String CRASH_TRACE_FILE = "spacefight-trace.txt";
    private static Thread.UncaughtExceptionHandler originalCrashHandler;
    private static boolean crashHandlerInstalled = false;
    private static boolean crashDialogVisible = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeActivity = new WeakReference<>(this);
        showSpaceFightLaunchScreen();
        SDKWrapper.shared().init(this);
        installSpaceFightCrashReporting();
        getWindow().getDecorView().postDelayed(() -> checkForUpdates(false), 2500L);
    }

    @Override
    protected void onResume() {
        super.onResume();
        SDKWrapper.shared().onResume();
        writeSpaceFightText(new File(getFilesDir(), CRASH_SESSION_FILE), "foreground");
        if (pendingInstallUri != null && canInstallPackages()) {
            Uri uri = pendingInstallUri;
            pendingInstallUri = null;
            launchPackageInstaller(uri);
        }
    }

    @Override
    protected void onPause() {
        // 切到后台属于正常状态：之后即便被系统回收，也不应误判为闪退。
        writeSpaceFightText(new File(getFilesDir(), CRASH_SESSION_FILE), "background");
        super.onPause();
        SDKWrapper.shared().onPause();
    }

    @Override
    protected void onDestroy() {
        // 正常退出时清掉会话标记；原生崩溃不会走到这里，标记会留到下次启动。
        new File(getFilesDir(), CRASH_SESSION_FILE).delete();
        if (activeActivity.get() == this) {
            activeActivity.clear();
        }
        super.onDestroy();
        // Workaround in https://stackoverflow.com/questions/16283079/re-launch-of-activity-on-home-button-but-only-the-first-time/16447508
        if (!isTaskRoot()) {
            return;
        }
        SDKWrapper.shared().onDestroy();
    }

    public static String spaceFightInvoke(String method, String payload) {
        AppActivity activity = activeActivity.get();
        if (activity == null) return "null";
        try {
            JSONObject request = payload == null || payload.isEmpty()
                    ? new JSONObject()
                    : new JSONObject(payload);
            if ("deviceSnapshot".equals(method)) return activity.deviceSnapshot().toString();
            if ("readText".equals(method)) {
                String value = activity.getSharedPreferences("spacefight", MODE_PRIVATE)
                        .getString(request.optString("key"), null);
                return value == null ? "null" : JSONObject.quote(value);
            }
            if ("writeText".equals(method)) {
                activity.getSharedPreferences("spacefight", MODE_PRIVATE).edit()
                        .putString(request.optString("key"), request.optString("value"))
                        .apply();
                return "null";
            }
            if ("haptic".equals(method)) {
                activity.runOnUiThread(activity::performSpaceFightHaptic);
                return "null";
            }
        } catch (Exception error) {
            android.util.Log.w("SpaceFight", "Native bridge request failed", error);
        }
        return "null";
    }

    /** JS 阶段打点：崩溃前的最后一条轨迹会写进错因报告。Web 端无此桥时由 TS 侧静默跳过。 */
    public static void spaceFightTrace(String stage) {
        AppActivity activity = activeActivity.get();
        if (activity == null) return;
        activity.appendSpaceFightTrace(stage);
    }

    /** JS 致命错误：立刻弹诊断窗，不依赖「下次启动」。 */
    public static void spaceFightFatal(String reason, String detail) {
        AppActivity activity = activeActivity.get();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            String report = activity.buildSpaceFightCrashReport("脚本致命错误 · " + reason, detail);
            activity.showSpaceFightCrashDialog(report, false);
        });
    }

    public static void hideSpaceFightLaunchScreen() {
        AppActivity activity = activeActivity.get();
        if (activity == null) return;
        activity.runOnUiThread(activity::dismissSpaceFightLaunchScreen);
    }

    public static void requestSpaceFightUpdateCheck() {
        AppActivity activity = activeActivity.get();
        if (activity == null) return;
        activity.runOnUiThread(() -> activity.checkForUpdates(true));
    }

    private void showSpaceFightLaunchScreen() {
        FrameLayout content = findViewById(android.R.id.content);
        if (content == null || launchOverlay != null) return;

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.rgb(2, 7, 10));
        overlay.setClickable(true);
        overlay.setFocusable(true);

        ImageView keyArt = new ImageView(this);
        // Keep this reference static so release resource shrinking preserves the launch artwork.
        keyArt.setImageResource(R.drawable.spacefight_launcher_keyart);
        keyArt.setScaleType(ImageView.ScaleType.CENTER_CROP);
        overlay.addView(keyArt, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        ViewGroup.LayoutParams full = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        android.view.View shade = new android.view.View(this);
        GradientDrawable shadeDrawable = new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[] { Color.argb(244, 2, 8, 12), Color.argb(178, 2, 8, 12), Color.argb(20, 2, 8, 12) }
        );
        shade.setBackground(shadeDrawable);
        overlay.addView(shade, full);

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.setGravity(Gravity.BOTTOM | Gravity.START);
        brand.setPadding(dp(34), dp(26), dp(32), dp(34));

        // 启动页版本必须来自 APK 自身（versionName/versionCode），不能写死。
        // 之前硬编码 "CLIENT 57"，导致 0.13.x 包仍显示老客户端号。
        String launcherVersionLabel;
        try {
            launcherVersionLabel = "ORBITAL FRONTIER  /  v" + localVersion() + "  BUILD " + localBuild();
        } catch (Exception error) {
            launcherVersionLabel = "ORBITAL FRONTIER";
        }
        TextView signal = updateLabel(launcherVersionLabel, 11, Color.rgb(113, 199, 210), true);
        signal.setLetterSpacing(0.12f);
        TextView title = updateLabel("SPACEFIGHT", 38, Color.WHITE, true);
        title.setLetterSpacing(0.04f);
        title.setPadding(0, dp(4), 0, dp(5));
        TextView subtitle = updateLabel("轨道前哨正在进入作战状态", 14, Color.rgb(207, 221, 226), false);
        TextView status = updateLabel("校验航电、战机与本地远征资源", 11, Color.rgb(141, 164, 173), false);
        status.setPadding(0, dp(18), 0, dp(8));
        android.view.View progressTrack = new android.view.View(this);
        progressTrack.setBackgroundColor(Color.rgb(32, 58, 65));
        android.view.View progress = new android.view.View(this);
        progress.setBackgroundColor(Color.rgb(112, 205, 211));

        brand.addView(signal);
        brand.addView(title);
        brand.addView(subtitle);
        brand.addView(status);
        brand.addView(progressTrack, new LinearLayout.LayoutParams(dp(310), dp(2)));
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(206), dp(2));
        progressParams.setMargins(0, dp(-2), 0, 0);
        brand.addView(progress, progressParams);
        overlay.addView(brand, full);
        content.addView(overlay, full);
        launchOverlay = overlay;
    }

    private void dismissSpaceFightLaunchScreen() {
        FrameLayout overlay = launchOverlay;
        if (overlay == null) return;
        launchOverlay = null;
        overlay.animate()
            .alpha(0f)
            .setDuration(360L)
            .withEndAction(() -> {
                ViewGroup parent = (ViewGroup) overlay.getParent();
                if (parent != null) parent.removeView(overlay);
            })
            .start();
    }

    private JSONObject deviceSnapshot() throws Exception {
        ActivityManager activityManager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
        activityManager.getMemoryInfo(memoryInfo);
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int requiredGles = activityManager.getDeviceConfigurationInfo().reqGlEsVersion;
        int glesMajor = (requiredGles >> 16) & 0xffff;
        int glesMinor = requiredGles & 0xffff;
        return new JSONObject()
                .put("memoryGB", memoryInfo.totalMem / 1073741824.0)
                .put("availableMemoryGB", memoryInfo.availMem / 1073741824.0)
                .put("lowRamDevice", activityManager.isLowRamDevice())
                .put("emulator", isEmulator())
                .put("logicalCores", Runtime.getRuntime().availableProcessors())
                .put("gpuRenderer", "OpenGL ES " + glesMajor + "." + glesMinor)
                .put("viewportWidth", metrics.widthPixels)
                .put("viewportHeight", metrics.heightPixels)
                .put("pixelRatio", metrics.density);
    }

    private static boolean isEmulator() {
        String fingerprint = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT.toLowerCase(Locale.ROOT);
        String model = Build.MODEL == null ? "" : Build.MODEL.toLowerCase(Locale.ROOT);
        String product = Build.PRODUCT == null ? "" : Build.PRODUCT.toLowerCase(Locale.ROOT);
        String hardware = Build.HARDWARE == null ? "" : Build.HARDWARE.toLowerCase(Locale.ROOT);
        return fingerprint.contains("generic")
                || fingerprint.contains("emulator")
                || model.contains("sdk_gphone")
                || model.contains("emulator")
                || product.contains("sdk_gphone")
                || hardware.contains("goldfish")
                || hardware.contains("ranchu");
    }

    private void performSpaceFightHaptic() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(android.Manifest.permission.VIBRATE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(18L, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(18L);
        }
    }

    private void checkForUpdates(boolean manual) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(UPDATE_MANIFEST + "?release=" + System.currentTimeMillis()).openConnection();
                connection.setConnectTimeout(7000);
                connection.setReadTimeout(7000);
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Accept", "application/json");

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("Update service returned " + status);
                String body = readAll(connection.getInputStream());
                JSONObject root = new JSONObject(body);
                JSONArray apps = root.optJSONArray("apps");
                if (apps == null) throw new IllegalStateException("Update manifest has no apps array");

                JSONObject update = null;
                for (int index = 0; index < apps.length(); index += 1) {
                    JSONObject candidate = apps.optJSONObject(index);
                    if (candidate != null && UPDATE_ID.equals(candidate.optString("id"))) {
                        update = candidate;
                        break;
                    }
                }
                if (update == null) throw new IllegalStateException("Android release is missing");

                String version = update.optString("version");
                long build = update.optLong("build", 0L);
                String rawDownload = update.optString("downloadURL");
                String download = rawDownload.startsWith("/")
                    ? "https://zhengzhengstudio.cn" + rawDownload
                    : rawDownload;
                String sha256 = update.optString("sha256");
                long size = update.optLong("size", 0L);
                final List<String> notes = readUpdateNotes(update);
                int versionComparison = compareVersions(version, localVersion());
                boolean newer = versionComparison > 0
                    || (versionComparison == 0 && build > localBuild());

                runOnUiThread(() -> {
                    if (newer && !download.isEmpty()) showUpdatePrompt(version, build, download, sha256, size, notes);
                    else if (manual) Toast.makeText(this, "已是最新版本", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception error) {
                if (manual) runOnUiThread(() -> Toast.makeText(this, "暂时无法检查更新", Toast.LENGTH_SHORT).show());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "SpaceFight-UpdateCheck").start();
    }

    /** 更新内容取自发布清单 notes，缺失时退回 remarks；最多保留最近 4 条，避免弹窗过长。 */
    private static List<String> readUpdateNotes(JSONObject update) {
        List<String> notes = new ArrayList<>();
        JSONArray raw = update.optJSONArray("notes");
        if (raw != null) {
            for (int index = 0; index < raw.length() && notes.size() < MAX_UPDATE_NOTES; index += 1) {
                String line = raw.optString(index, "").trim();
                if (!line.isEmpty()) notes.add(line);
            }
        }
        if (notes.isEmpty()) {
            String remark = update.optString("remarks", "").trim();
            if (!remark.isEmpty()) notes.add(remark);
        }
        return notes;
    }

    private void showUpdatePrompt(String version, long build, String download, String sha256, long size, List<String> notes) {
        if (isFinishing() || isDestroyed()) return;
        Dialog dialog = new Dialog(this);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(24), dp(22), dp(24), dp(20));
        panel.setBackground(panelBackground(Color.rgb(13, 20, 27), 8));

        TextView channel = updateLabel("SPACEFIGHT // RELEASE CHANNEL", 11, Color.rgb(89, 218, 235), true);
        TextView title = updateLabel("作战客户端更新", 24, Color.WHITE, true);
        TextView release = updateLabel("版本 " + version + "   ·   BUILD " + build, 14, Color.rgb(198, 211, 219), true);
        TextView detail = updateLabel(
            "新版本将在游戏内下载。下载完成后，仅由 Android 系统显示安装确认。",
            14,
            Color.rgb(154, 171, 181),
            false
        );
        channel.setLetterSpacing(0.08f);
        title.setPadding(0, dp(9), 0, dp(8));
        release.setPadding(0, 0, 0, dp(14));
        detail.setLineSpacing(0, 1.18f);
        panel.addView(channel);
        panel.addView(title);
        panel.addView(release);
        panel.addView(detail);

        // 更新内容折叠区：默认收起，点小箭头展开；不写偏好，每次弹窗保持默认关闭。
        final LinearLayout notesBody = buildUpdateNotesBody(notes);
        notesBody.setVisibility(View.GONE);
        final TextView notesToggle = updateLabel("更新内容  ▸", 13, Color.rgb(89, 218, 235), true);
        notesToggle.setPadding(0, dp(14), 0, dp(4));
        notesToggle.setClickable(true);
        notesToggle.setOnClickListener(view -> {
            boolean expanded = notesBody.getVisibility() == View.VISIBLE;
            notesBody.setVisibility(expanded ? View.GONE : View.VISIBLE);
            notesToggle.setText(expanded ? "更新内容  ▸" : "更新内容  ▾");
        });
        panel.addView(notesToggle);
        panel.addView(notesBody);

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.END);
        actions.setPadding(0, dp(22), 0, 0);
        Button later = updateButton("稍后", Color.rgb(34, 45, 55), Color.rgb(218, 226, 232));
        Button install = updateButton("下载并安装", Color.rgb(67, 213, 229), Color.rgb(5, 17, 22));
        LinearLayout.LayoutParams laterParams = new LinearLayout.LayoutParams(dp(92), dp(46));
        laterParams.setMarginEnd(dp(10));
        actions.addView(later, laterParams);
        actions.addView(install, new LinearLayout.LayoutParams(dp(138), dp(46)));
        panel.addView(actions);

        later.setOnClickListener(view -> dialog.dismiss());
        install.setOnClickListener(view -> {
            dialog.dismiss();
            downloadUpdate(version, download, sha256, size);
        });
        dialog.setContentView(panel);
        dialog.setCanceledOnTouchOutside(true);
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.dimAmount = 0.78f;
            window.setAttributes(attributes);
            int available = Math.max(dp(300), getResources().getDisplayMetrics().widthPixels - dp(32));
            window.setLayout(Math.min(available, dp(520)), ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }

    // ==================== 崩溃诊断 ====================
    // 原生层 SIGABRT 会直接结束进程，无法当场弹窗；因此用「会话标记 + 下次启动补弹」覆盖，
    // Java 未捕获异常则当场写完整堆栈。两者共用同一套错因文本与同一个诊断弹窗。

    private void installSpaceFightCrashReporting() {
        if (!crashHandlerInstalled) {
            crashHandlerInstalled = true;
            originalCrashHandler = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
                try {
                    StringWriter buffer = new StringWriter();
                    error.printStackTrace(new PrintWriter(buffer));
                    String report = buildSpaceFightCrashReport(
                        "Java 未捕获异常 · " + thread.getName(), buffer.toString());
                    writeSpaceFightText(new File(getFilesDir(), CRASH_REPORT_FILE), report);
                } catch (Throwable ignored) {
                    // 崩溃处理本身不允许再抛异常
                }
                if (originalCrashHandler != null) {
                    originalCrashHandler.uncaughtException(thread, error);
                } else {
                    android.os.Process.killProcess(android.os.Process.myPid());
                    System.exit(2);
                }
            });
        }

        File session = new File(getFilesDir(), CRASH_SESSION_FILE);
        File pending = new File(getFilesDir(), CRASH_REPORT_FILE);
        String previousState = readSpaceFightText(session).trim();
        String report = readSpaceFightText(pending);
        if (report.isEmpty() && "foreground".equals(previousState)) {
            // 上次运行在前台被直接终止：原生崩溃不会走 onDestroy，也不会触发 Java 异常处理器。
            report = buildSpaceFightCrashReport(
                "前台异常退出（疑似原生层崩溃）",
                "上次运行时进程在前台被直接终止，未经过正常退出流程。\n"
                    + "常见原因：Cocos 原生渲染 / 脚本绑定层抛出未捕获异常（如 SIGABRT）。");
        }
        pending.delete();
        writeSpaceFightText(session, "foreground");
        if (!report.isEmpty()) {
            final String finalReport = report;
            getWindow().getDecorView().postDelayed(
                () -> showSpaceFightCrashDialog(finalReport, true), 1200L);
        }
    }

    private String buildSpaceFightCrashReport(String kind, String detail) {
        StringBuilder report = new StringBuilder();
        report.append("SPACEFIGHT 错误报告\n");
        report.append("时间: ").append(spaceFightTimestamp()).append('\n');
        report.append(spaceFightVersionLabel()).append('\n');
        report.append("设备: ").append(Build.MODEL).append(" / Android ").append(Build.VERSION.RELEASE)
            .append(" / ").append(Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown")
            .append('\n');
        report.append("类型: ").append(kind == null ? "未知" : kind).append('\n');
        report.append("\n---- 最后执行阶段 ----\n");
        report.append(readSpaceFightText(new File(getFilesDir(), CRASH_TRACE_FILE)));
        report.append("\n---- 错误详情 ----\n");
        report.append(detail == null || detail.isEmpty()
            ? "（无可用堆栈；多为原生层信号中断）" : detail);
        report.append("\n\n---- 系统日志片段 ----\n");
        String logs = collectSpaceFightLogcat();
        report.append(logs.isEmpty() ? "（当前应用无可读日志）" : logs);
        report.append("\n---- 反馈时请复制以上全部内容 ----\n");
        return report.toString();
    }

    private static String collectSpaceFightLogcat() {
        java.lang.Process process = null;
        BufferedReader reader = null;
        try {
            process = Runtime.getRuntime().exec(
                new String[] { "logcat", "-d", "-v", "brief", "-t", "400" });
            reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String[] keys = { "SpaceFight", "cocos", "Fatal", "DEBUG", "libc", "abort",
                "tombstone", "out_of_range", "SIG", "JS:", "AndroidRuntime" };
            StringBuilder kept = new StringBuilder();
            String line;
            int count = 0;
            while ((line = reader.readLine()) != null) {
                boolean matched = false;
                for (String key : keys) {
                    if (line.contains(key)) { matched = true; break; }
                }
                if (matched) {
                    kept.append(line).append('\n');
                    if (++count >= 60) break;
                }
            }
            return kept.toString();
        } catch (Exception ignored) {
            return "";
        } finally {
            if (reader != null) {
                try { reader.close(); } catch (Exception ignored) {}
            }
            if (process != null) process.destroy();
        }
    }

    private void appendSpaceFightTrace(String stage) {
        if (stage == null || stage.isEmpty()) return;
        File file = new File(getFilesDir(), CRASH_TRACE_FILE);
        String[] lines = readSpaceFightText(file).split("\n");
        StringBuilder next = new StringBuilder();
        int start = Math.max(0, lines.length - 11);
        for (int i = start; i < lines.length; i++) {
            String line = lines[i].trim();
            if (!line.isEmpty()) next.append(line).append('\n');
        }
        next.append(spaceFightTimestamp()).append("  ").append(stage).append('\n');
        writeSpaceFightText(file, next.toString());
    }

    private static String spaceFightTimestamp() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date());
    }

    private String spaceFightVersionLabel() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode() : info.versionCode;
            return "版本 " + info.versionName + " / BUILD " + code;
        } catch (Exception ignored) {
            return "版本 未知";
        }
    }

    private static void writeSpaceFightText(File file, String value) {
        try (FileOutputStream output = new FileOutputStream(file, false)) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (Exception ignored) {}
    }

    private static String readSpaceFightText(File file) {
        try (InputStream input = new FileInputStream(file)) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = input.read(chunk)) >= 0) buffer.write(chunk, 0, read);
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return "";
        }
    }

    /** 与「作战客户端更新」同款排版：深色圆角面板、频道标签、滚动错因、成对按钮。 */
    private void showSpaceFightCrashDialog(String report, boolean previousSession) {
        if (isFinishing() || isDestroyed() || crashDialogVisible) return;
        crashDialogVisible = true;
        final Dialog dialog = new Dialog(this);
        dialog.setCancelable(false);
        dialog.setCanceledOnTouchOutside(false);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(24), dp(22), dp(24), dp(20));
        panel.setBackground(panelBackground(Color.rgb(13, 20, 27), 8));

        TextView channel = updateLabel("SPACEFIGHT // DIAGNOSTICS", 11,
            Color.rgb(255, 143, 112), true);
        channel.setLetterSpacing(0.08f);
        TextView title = updateLabel(previousSession ? "上次运行异常退出" : "运行错误",
            24, Color.WHITE, true);
        title.setPadding(0, dp(9), 0, dp(8));
        TextView release = updateLabel(spaceFightVersionLabel() + "   ·   " + spaceFightTimestamp(),
            13, Color.rgb(198, 211, 219), true);
        release.setPadding(0, 0, 0, dp(12));
        TextView detail = updateLabel(
            "错误详情已生成。可复制错因反馈给开发者，或按「退出」关闭应用。",
            14, Color.rgb(154, 171, 181), false);
        detail.setLineSpacing(0, 1.18f);
        panel.addView(channel);
        panel.addView(title);
        panel.addView(release);
        panel.addView(detail);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackground(panelBackground(Color.rgb(7, 14, 20), 6));
        scroll.setPadding(dp(10), dp(8), dp(10), dp(8));
        TextView body = new TextView(this);
        body.setText(report);
        body.setTextSize(11);
        body.setTextColor(Color.rgb(198, 211, 219));
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextIsSelectable(true);
        scroll.addView(body);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            Math.min(dp(230), getResources().getDisplayMetrics().heightPixels / 3));
        bodyParams.topMargin = dp(14);
        panel.addView(scroll, bodyParams);

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.END);
        actions.setPadding(0, dp(20), 0, 0);
        Button exit = updateButton("退出", Color.rgb(34, 45, 55), Color.rgb(218, 226, 232));
        Button copy = updateButton("复制错因", Color.rgb(67, 213, 229), Color.rgb(5, 17, 22));
        LinearLayout.LayoutParams exitParams = new LinearLayout.LayoutParams(dp(92), dp(46));
        exitParams.setMarginEnd(dp(10));
        actions.addView(exit, exitParams);
        actions.addView(copy, new LinearLayout.LayoutParams(dp(128), dp(46)));
        panel.addView(actions);

        copy.setOnClickListener(view -> {
            ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (manager != null) {
                manager.setPrimaryClip(ClipData.newPlainText("SpaceFight 错误报告", report));
                Toast.makeText(this, "错因已复制", Toast.LENGTH_SHORT).show();
            }
        });
        exit.setOnClickListener(view -> {
            dialog.dismiss();
            finishAffinity();
            getWindow().getDecorView().postDelayed(() -> {
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(0);
            }, 150L);
        });

        dialog.setContentView(panel);
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.dimAmount = 0.78f;
            window.setAttributes(attributes);
            int available = Math.max(dp(300),
                getResources().getDisplayMetrics().widthPixels - dp(32));
            window.setLayout(Math.min(available, dp(520)), ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }

    private LinearLayout buildUpdateNotesBody(List<String> notes) {
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setBackground(panelBackground(Color.rgb(7, 14, 20), 6));
        body.setPadding(dp(12), dp(10), dp(12), dp(8));
        if (notes.isEmpty()) {
            body.addView(updateLabel("本次更新暂未提供更新说明。", 12, Color.rgb(154, 171, 181), false));
            return body;
        }
        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        for (String note : notes) {
            TextView item = updateLabel("•  " + note, 12, Color.rgb(198, 211, 219), false);
            item.setLineSpacing(0, 1.18f);
            item.setPadding(0, 0, 0, dp(8));
            list.addView(item);
        }
        scroll.addView(list);
        int maxHeight = Math.min(dp(180), getResources().getDisplayMetrics().heightPixels / 3);
        body.addView(scroll, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, maxHeight));
        return body;
    }

    private TextView updateLabel(String text, float size, int color, boolean bold) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(size);
        label.setTextColor(color);
        label.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        return label;
    }

    private Button updateButton(String text, int background, int foreground) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(foreground);
        button.setTextSize(14);
        button.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setBackground(panelBackground(background, 6));
        return button;
    }

    private GradientDrawable panelBackground(int color, int radiusDp) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radiusDp));
        background.setStroke(dp(1), Color.rgb(48, 67, 78));
        return background;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void downloadUpdate(String version, String download, String expectedSha256, long expectedSize) {
        if (updateDownloadRunning) {
            Toast.makeText(this, "更新正在下载", Toast.LENGTH_SHORT).show();
            return;
        }
        updateDownloadRunning = true;
        showUpdateProgress("正在连接更新服务器", 0, true);
        new Thread(() -> {
            File partial = null;
            try {
                File directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (directory == null && !((directory = getFilesDir()).exists())) {
                    throw new IllegalStateException("Update directory is unavailable");
                }
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IllegalStateException("Cannot create update directory");
                }
                String safeVersion = version.replaceAll("[^0-9A-Za-z._-]", "_");
                partial = new File(directory, "SpaceFight-update-" + safeVersion + ".apk.part");
                File packageFile = new File(directory, "SpaceFight-update-" + safeVersion + ".apk");
                if (partial.exists() && !partial.delete()) throw new IllegalStateException("Cannot reset partial update");
                if (packageFile.exists() && !packageFile.delete()) throw new IllegalStateException("Cannot replace old update");

                DownloadProbe probe = probeDownload(download);
                long total = expectedSize > 0 ? expectedSize : probe.totalBytes;
                if (total <= 0) throw new IllegalStateException("Update size is unavailable");
                if (expectedSize > 0 && probe.totalBytes > 0 && expectedSize != probe.totalBytes) {
                    throw new SecurityException("Update manifest size mismatch");
                }
                AtomicLong downloaded = new AtomicLong(0L);
                AtomicLong lastProgressAt = new AtomicLong(0L);
                boolean parallel = probe.acceptsRanges && total >= MIN_PARALLEL_BYTES;
                try {
                    if (parallel) {
                        runOnUiThread(() -> updateProgressLabel.setText("4 通道并行下载"));
                        downloadParallel(download, partial, total, downloaded, lastProgressAt);
                    } else {
                        runOnUiThread(() -> updateProgressLabel.setText("兼容模式下载"));
                        downloadSingle(download, partial, total, downloaded, lastProgressAt);
                    }
                } catch (Exception parallelError) {
                    if (!parallel) throw parallelError;
                    downloaded.set(0L);
                    if (partial.exists() && !partial.delete()) throw parallelError;
                    runOnUiThread(() -> updateProgressLabel.setText("并行不可用，切换兼容模式"));
                    downloadSingle(download, partial, total, downloaded, lastProgressAt);
                }

                if (partial.length() != total) throw new IllegalStateException("Update size mismatch");
                if (!expectedSha256.isEmpty() && !expectedSha256.equalsIgnoreCase(sha256(partial))) {
                    throw new SecurityException("Update checksum mismatch");
                }
                if (!partial.renameTo(packageFile)) throw new IllegalStateException("Cannot finalize update");
                // 安装前校验下载 APK 的签名证书与当前已安装包是否一致，避免覆盖安装被拒绝。
                String expectedFingerprint = installedCertificateFingerprint();
                if (expectedFingerprint == null) {
                    throw new IllegalStateException("Cannot read installed certificate");
                }
                if (!expectedFingerprint.equalsIgnoreCase(apkCertificateFingerprint(packageFile))) {
                    throw new SignatureMismatchException(expectedFingerprint, apkCertificateFingerprint(packageFile));
                }
                final Uri packageUri = UpdateFileProvider.uriFor(this, packageFile);
                runOnUiThread(() -> {
                    updateDownloadProgress(total, total);
                    updateProgressLabel.setText("下载完成，准备安装");
                    finishDownloadedUpdate(packageUri);
                });
            } catch (SignatureMismatchException error) {
                if (partial != null && partial.exists()) partial.delete();
                runOnUiThread(() -> {
                    updateProgressLabel.setText("更新包签名证书与当前版本不一致");
                    getWindow().getDecorView().postDelayed(this::hideUpdateProgress, 2000L);
                    promptSignatureMismatch(error);
                });
            } catch (Exception error) {
                android.util.Log.w("SpaceFight", "Update download failed", error);
                if (partial != null && partial.exists()) partial.delete();
                runOnUiThread(() -> {
                    updateProgressLabel.setText("更新下载失败，请稍后重试");
                    updateProgressBar.setIndeterminate(false);
                    updateProgressBar.setProgress(0);
                    getWindow().getDecorView().postDelayed(this::hideUpdateProgress, 2600L);
                    Toast.makeText(this, "更新下载失败", Toast.LENGTH_SHORT).show();
                });
            } finally {
                updateDownloadRunning = false;
            }
        }, "SpaceFight-UpdateDownload").start();
    }

    private DownloadProbe probeDownload(String download) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(download).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("Range", "bytes=0-0");
        connection.setRequestProperty("Accept-Encoding", "identity");
        try {
            int status = connection.getResponseCode();
            String contentRange = connection.getHeaderField("Content-Range");
            long total = parseContentRangeTotal(contentRange);
            if (total <= 0) total = connection.getContentLengthLong();
            try (InputStream ignored = connection.getInputStream()) {
                // Opening and closing the body confirms that the range endpoint is readable.
            }
            return new DownloadProbe(status == HttpURLConnection.HTTP_PARTIAL && total > 0, total);
        } finally {
            connection.disconnect();
        }
    }

    private void downloadParallel(String download, File destination, long total, AtomicLong downloaded,
                                  AtomicLong lastProgressAt) throws Exception {
        try (RandomAccessFile output = new RandomAccessFile(destination, "rw")) {
            output.setLength(total);
        }
        ExecutorService executor = Executors.newFixedThreadPool(DOWNLOAD_WORKERS);
        List<Future<?>> tasks = new ArrayList<>();
        try {
            for (int worker = 0; worker < DOWNLOAD_WORKERS; worker += 1) {
                long start = total * worker / DOWNLOAD_WORKERS;
                long end = total * (worker + 1) / DOWNLOAD_WORKERS - 1L;
                tasks.add(executor.submit(() -> {
                    downloadRange(download, destination, start, end, total, downloaded, lastProgressAt);
                    return null;
                }));
            }
            for (Future<?> task : tasks) task.get();
        } finally {
            for (Future<?> task : tasks) if (!task.isDone()) task.cancel(true);
            executor.shutdownNow();
        }
    }

    private void downloadRange(String download, File destination, long start, long end, long total,
                               AtomicLong downloaded, AtomicLong lastProgressAt) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(download).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Range", "bytes=" + start + "-" + end);
        connection.setRequestProperty("Accept-Encoding", "identity");
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_PARTIAL) {
                throw new IllegalStateException("Range request was not accepted");
            }
            long remaining = end - start + 1L;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 RandomAccessFile output = new RandomAccessFile(destination, "rw")) {
                output.seek(start);
                byte[] buffer = new byte[64 * 1024];
                while (remaining > 0) {
                    int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                    if (read < 0) break;
                    output.write(buffer, 0, read);
                    remaining -= read;
                    reportDownloaded(downloaded.addAndGet(read), total, lastProgressAt);
                }
            }
            if (remaining != 0) throw new IllegalStateException("Range ended early");
        } finally {
            connection.disconnect();
        }
    }

    private void downloadSingle(String download, File destination, long total, AtomicLong downloaded,
                                AtomicLong lastProgressAt) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(download).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept-Encoding", "identity");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Download returned " + status);
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 RandomAccessFile output = new RandomAccessFile(destination, "rw")) {
                output.setLength(0L);
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, read);
                    reportDownloaded(downloaded.addAndGet(read), total, lastProgressAt);
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    private void reportDownloaded(long downloaded, long total, AtomicLong lastProgressAt) {
        long now = android.os.SystemClock.elapsedRealtime();
        long previous = lastProgressAt.get();
        if (downloaded < total && (now - previous < 100L || !lastProgressAt.compareAndSet(previous, now))) return;
        runOnUiThread(() -> updateDownloadProgress(downloaded, total));
    }

    private void showUpdateProgress(String status, int progress, boolean indeterminate) {
        FrameLayout content = findViewById(android.R.id.content);
        if (content == null) return;
        if (updateProgressOverlay == null) {
            LinearLayout overlay = new LinearLayout(this);
            overlay.setOrientation(LinearLayout.VERTICAL);
            overlay.setPadding(dp(14), dp(7), dp(14), dp(6));
            overlay.setBackgroundColor(Color.argb(238, 5, 13, 18));
            overlay.setElevation(dp(8));
            TextView label = updateLabel(status, 11, Color.rgb(218, 235, 239), true);
            ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            bar.setMax(1000);
            bar.setProgress(progress);
            bar.setProgressTintList(ColorStateList.valueOf(Color.rgb(75, 216, 226)));
            bar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.rgb(35, 58, 66)));
            bar.setIndeterminateTintList(ColorStateList.valueOf(Color.rgb(75, 216, 226)));
            overlay.addView(label, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(18)));
            overlay.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(34), Gravity.TOP
            );
            content.addView(overlay, params);
            updateProgressOverlay = overlay;
            updateProgressBar = bar;
            updateProgressLabel = label;
        }
        boolean reveal = updateProgressOverlay.getVisibility() != android.view.View.VISIBLE;
        updateProgressOverlay.setVisibility(android.view.View.VISIBLE);
        if (reveal) {
            updateProgressOverlay.setAlpha(0f);
            updateProgressOverlay.setTranslationY(-dp(34));
            updateProgressOverlay.animate()
                .alpha(1f)
                .translationY(0f)
                .setDuration(220L)
                .setInterpolator(new DecelerateInterpolator())
                .start();
        }
        updateProgressLabel.setText(status);
        updateProgressBar.setIndeterminate(indeterminate);
        if (!indeterminate) updateProgressBar.setProgress(progress);
    }

    private void updateDownloadProgress(long downloaded, long total) {
        if (updateProgressBar == null || total <= 0) return;
        int progress = (int) Math.min(1000L, downloaded * 1000L / total);
        updateProgressBar.setIndeterminate(false);
        if (updateProgressAnimator != null) updateProgressAnimator.cancel();
        updateProgressAnimator = ObjectAnimator.ofInt(updateProgressBar, "progress", updateProgressBar.getProgress(), progress);
        updateProgressAnimator.setDuration(140L);
        updateProgressAnimator.setInterpolator(new DecelerateInterpolator());
        updateProgressAnimator.start();
        updateProgressLabel.setText(String.format(
            Locale.US, "更新下载 %d%%  ·  %.1f / %.1f MB",
            progress / 10,
            downloaded / 1048576.0,
            total / 1048576.0
        ));
    }

    private void hideUpdateProgress() {
        if (updateProgressOverlay == null) return;
        updateProgressOverlay.animate()
            .alpha(0f)
            .translationY(-dp(34))
            .setDuration(240L)
            .withEndAction(() -> {
                updateProgressOverlay.setVisibility(android.view.View.GONE);
                updateProgressOverlay.setAlpha(1f);
                updateProgressOverlay.setTranslationY(0f);
            })
            .start();
    }

    private void finishDownloadedUpdate(Uri packageUri) {
        getWindow().getDecorView().postDelayed(this::hideUpdateProgress, 1800L);
        if (canInstallPackages()) {
            launchPackageInstaller(packageUri);
        } else {
            pendingInstallUri = packageUri;
            new AlertDialog.Builder(this)
                .setTitle("允许安装更新")
                .setMessage("请允许 SpaceFight 安装此来源的应用，返回后会继续安装。")
                .setPositiveButton("前往设置", (dialog, which) -> {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                    startActivity(settingsIntent);
                })
                .setNegativeButton("取消", null)
                .show();
        }
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getPackageManager().canRequestPackageInstalls();
    }

    private void launchPackageInstaller(Uri packageUri) {
        Intent install = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(packageUri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        install.setClipData(android.content.ClipData.newRawUri("SpaceFight update", packageUri));
        startActivity(install);
    }

    private static long parseContentRangeTotal(String contentRange) {
        if (contentRange == null) return -1L;
        int slash = contentRange.lastIndexOf('/');
        if (slash < 0 || slash == contentRange.length() - 1) return -1L;
        try {
            return Long.parseLong(contentRange.substring(slash + 1));
        } catch (NumberFormatException ignored) {
            return -1L;
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format(Locale.US, "%02x", value & 0xff));
        return result.toString();
    }

    // 当前已安装应用的签名证书 SHA-256 指纹（小写十六进制），获取失败返回 null。
    private String installedCertificateFingerprint() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), packageManagerSignFlags());
            return signerFingerprint(info);
        } catch (Exception error) {
            android.util.Log.w("SpaceFight", "installed certificate unavailable", error);
            return null;
        }
    }

    // 下载 APK 的签名证书 SHA-256 指纹，读取失败返回 null。
    private String apkCertificateFingerprint(File apkFile) {
        try {
            PackageInfo info = getPackageManager().getPackageArchiveInfo(
                apkFile.getAbsolutePath(), packageManagerSignFlags());
            if (info == null) return null;
            return signerFingerprint(info);
        } catch (Exception error) {
            android.util.Log.w("SpaceFight", "apk certificate unavailable", error);
            return null;
        }
    }

    // Android P+ 用 GET_SIGNING_CERTIFICATES，兼容旧版用 GET_SIGNATURES。
    private int packageManagerSignFlags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
    }

    // 取首个签名者证书的 SHA-256 指纹。
    private String signerFingerprint(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signingInfo = info.signingInfo;
            signatures = signingInfo == null ? null : signingInfo.getApkContentsSigners();
            if ((signatures == null || signatures.length == 0) && signingInfo != null) {
                signatures = signingInfo.getSigningCertificateHistory();
            }
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) return null;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest(signatures[0].toByteArray())) {
            result.append(String.format(Locale.US, "%02x", value & 0xff));
        }
        return result.toString();
    }

    // 签名证书不一致时提示玩家，提供上报到网站的操作。
    private void promptSignatureMismatch(SignatureMismatchException error) {
        new AlertDialog.Builder(this)
            .setTitle("更新包签名不一致")
            .setMessage("下载的更新包签名证书与当前已安装版本不一致，为安全起见已停止安装。\n\n"
                + "当前版本: " + fingerprintShort(error.installed) + "\n"
                + "更新包: " + fingerprintShort(error.downloaded) + "\n\n"
                + "请将上方两组指纹上报给开发者，以便尽快修复此问题。")
            .setPositiveButton("上报到网站", (dialog, which) -> {
                Intent open = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://zhengzhengstudio.cn/"));
                try {
                    startActivity(open);
                } catch (Exception ignored) {
                    Toast.makeText(this, "请访问 zhengzhengstudio.cn 反馈", Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton("以后再说", null)
            .show();
    }

    private static String fingerprintShort(String fingerprint) {
        return fingerprint == null || fingerprint.length() < 12
            ? "未知"
            : fingerprint.substring(0, 12) + "…";
    }

    private static final class SignatureMismatchException extends Exception {
        final String installed;
        final String downloaded;

        SignatureMismatchException(String installed, String downloaded) {
            super("Update signature certificate does not match installed package");
            this.installed = installed;
            this.downloaded = downloaded;
        }
    }

    private static final class DownloadProbe {
        final boolean acceptsRanges;
        final long totalBytes;

        DownloadProbe(boolean acceptsRanges, long totalBytes) {
            this.acceptsRanges = acceptsRanges;
            this.totalBytes = totalBytes;
        }
    }

    private long localBuild() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private String localVersion() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        return info.versionName == null ? "0" : info.versionName;
    }

    private static int compareVersions(String remote, String local) {
        String[] remoteParts = remote.split("\\.");
        String[] localParts = local.split("\\.");
        int size = Math.max(remoteParts.length, localParts.length);
        for (int index = 0; index < size; index += 1) {
            int remotePart = index < remoteParts.length ? numericPart(remoteParts[index]) : 0;
            int localPart = index < localParts.length ? numericPart(localParts[index]) : 0;
            if (remotePart != localPart) return Integer.compare(remotePart, localPart);
        }
        return 0;
    }

    private static int numericPart(String value) {
        try {
            return Integer.parseInt(value.replaceAll("[^0-9].*$", ""));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String readAll(InputStream input) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        SDKWrapper.shared().onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        SDKWrapper.shared().onNewIntent(intent);
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        SDKWrapper.shared().onRestart();
    }

    @Override
    protected void onStop() {
        super.onStop();
        SDKWrapper.shared().onStop();
    }

    @Override
    public void onBackPressed() {
        SDKWrapper.shared().onBackPressed();
        super.onBackPressed();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        SDKWrapper.shared().onConfigurationChanged(newConfig);
        super.onConfigurationChanged(newConfig);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        SDKWrapper.shared().onRestoreInstanceState(savedInstanceState);
        super.onRestoreInstanceState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        SDKWrapper.shared().onSaveInstanceState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onStart() {
        SDKWrapper.shared().onStart();
        super.onStart();
    }

    @Override
    public void onLowMemory() {
        SDKWrapper.shared().onLowMemory();
        super.onLowMemory();
    }
}
