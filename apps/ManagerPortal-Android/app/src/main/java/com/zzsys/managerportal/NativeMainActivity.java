package com.zzsys.managerportal;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.method.ScrollingMovementMethod;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class NativeMainActivity extends Activity {
    private static final String CHANNEL_ID = "manager_alerts";
    private static final String SITE_ROOT = "https://zhengzhengstudio.cn";
    private static final String PREF_MANAGER_TOKEN = "managerToken";
    private static final String PREF_MANAGER_USERNAME = "managerUsername";
    private static final String PREF_MANAGER_PERMISSIONS = "managerPermissions";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private LinearLayout content;
    private LinearLayout bottomNavigation;
    private TextView statusLabel;
    private EditText usernameInput;
    private EditText passwordInput;
    private EditText terminalCommandInput;
    private TextView terminalStandardOutput;
    private TextView terminalErrorOutput;
    private String username = "";
    private String token = "";
    private String role = "";
    private JSONArray permissions = new JSONArray();
    private final Map<String, JSONObject> cachedContentWorkspaces = new HashMap<>();
    private int contentPageGeneration = 0;
    private String visibleContentModuleId = "";
    private String lastNoticeId = "";
    private long updateDownloadId = -1;
    private Uri pendingInstallUri;

    private interface Action { void run(); }
    private interface JsonCallback { void done(JSONObject json); }
    private interface HttpResultCallback { void done(HttpResult result); }

    private static class HttpResult {
        final int statusCode;
        final JSONObject json;
        final String error;
        final String requestToken;
        final String requestUsername;

        HttpResult(int statusCode, JSONObject json, String error, String requestToken, String requestUsername) {
            this.statusCode = statusCode;
            this.json = json;
            this.error = error;
            this.requestToken = requestToken;
            this.requestUsername = requestUsername;
        }
    }

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id == updateDownloadId) openDownloadedApk(id);
        }
    };
    private final Runnable updateRunnable = new Runnable() {
        @Override public void run() {
            checkUpdate(false);
            handler.postDelayed(this, 30 * 60 * 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        requestNotificationPermissionIfNeeded();
        SharedPreferences prefs = getPreferences(MODE_PRIVATE);
        username = prefs.getString(PREF_MANAGER_USERNAME, prefs.getString("username", ""));
        token = prefs.getString(PREF_MANAGER_TOKEN, prefs.getString("token", ""));
        try {
            String savedPermissions = prefs.getString(PREF_MANAGER_PERMISSIONS, "");
            if (savedPermissions.length() > 0) permissions = new JSONArray(savedPermissions);
        } catch (Exception ignored) {}
        lastNoticeId = prefs.getString("lastNoticeId", "");
        buildShell();
        registerDownloadReceiver();
        restoreSession();
        handler.postDelayed(updateRunnable, 3000);
        pollNotices();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        handler.removeCallbacks(updateRunnable);
        try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallUri != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            Uri uri = pendingInstallUri;
            pendingInstallUri = null;
            launchPackageInstaller(uri);
        }
    }

    private void buildShell() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(rgb(243, 247, 247));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(18), dp(14), dp(18), dp(10));
        root.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ImageView icon = new ImageView(this);
        icon.setImageResource(getApplicationInfo().icon);
        top.addView(icon, new LinearLayout.LayoutParams(dp(36), dp(36)));

        TextView title = text("铮铮控制台", 21, ink(), true);
        title.setPadding(dp(10), 0, 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        statusLabel = text("未登录", 12, muted(), false);
        top.addView(statusLabel);

        ScrollView scroll = new ScrollView(this);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(10), dp(18), dp(28));
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        bottomNavigation = new LinearLayout(this);
        bottomNavigation.setOrientation(LinearLayout.HORIZONTAL);
        bottomNavigation.setPadding(dp(6), dp(5), dp(6), dp(7));
        bottomNavigation.setBackgroundColor(Color.WHITE);
        bottomNavigation.setVisibility(View.GONE);
        root.addView(bottomNavigation, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(66)));
        setContentView(root);
    }

    private void buildBottomNavigation(int selected) {
        bottomNavigation.removeAllViews();
        bottomNavigation.setVisibility(token.length() == 0 ? View.GONE : View.VISIBLE);
        bottomNavigation.addView(navButton("总览", android.R.drawable.ic_menu_view, selected == 0, new Action() { @Override public void run() { navigateAwayFromContent(new Action() { @Override public void run() { showDashboard(); } }); } }), weight());
        bottomNavigation.addView(navButton("事务", android.R.drawable.ic_dialog_alert, selected == 1, new Action() { @Override public void run() { navigateAwayFromContent(new Action() { @Override public void run() { showQueue(); } }); } }), weight());
        bottomNavigation.addView(navButton("工作台", android.R.drawable.ic_menu_manage, selected == 3, new Action() { @Override public void run() { navigateAwayFromContent(new Action() { @Override public void run() { showOperations(); } }); } }), weight());
        bottomNavigation.addView(navButton("账户", android.R.drawable.ic_menu_myplaces, selected == 4, new Action() { @Override public void run() { navigateAwayFromContent(new Action() { @Override public void run() { showAccount(); } }); } }), weight());
    }

    private void restoreSession() {
        if (username.length() == 0 || token.length() == 0) {
            showLogin();
            return;
        }
        getJson("/api/admin/session", new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (json == null || !json.optBoolean("success")) {
                            showLogin();
                            return;
                        }
                        username = json.optString("username", username);
                        role = json.optString("role", "admin");
                        permissions = json.optJSONArray("permissions") == null ? new JSONArray() : json.optJSONArray("permissions");
                        statusLabel.setText("已授权");
                        showDashboard();
                        checkUpdate(false);
                    }
                });
            }
        });
    }

    private void showLogin() {
        invalidateContentWorkspaceState();
        username = "";
        token = "";
        role = "";
        permissions = new JSONArray();
        if (bottomNavigation != null) bottomNavigation.setVisibility(View.GONE);
        getPreferences(MODE_PRIVATE).edit()
            .remove("username").remove("token")
            .remove(PREF_MANAGER_USERNAME).remove(PREF_MANAGER_TOKEN).remove(PREF_MANAGER_PERMISSIONS)
            .apply();
        statusLabel.setText("未登录");
        content.removeAllViews();
        content.addView(titleBlock("铮铮控制台", "管理员验证"));
        LinearLayout card = card();
        usernameInput = input("账号", false);
        passwordInput = input("密码", true);
        card.addView(smallLabel("管理员账号"));
        card.addView(usernameInput);
        card.addView(spacer(dp(10)));
        card.addView(smallLabel("管理员密码"));
        card.addView(passwordInput);
        card.addView(spacer(dp(16)));
        card.addView(primaryButton("管理员登录", new Action() { @Override public void run() { login(); } }));
        card.addView(spacer(dp(10)));
        card.addView(secondaryButton("通行证登录", new Action() { @Override public void run() { passportLogin(); } }));
        content.addView(card);
    }

    private void login() {
        final String inputUsername = usernameInput.getText().toString().trim();
        final String inputPassword = passwordInput.getText().toString();
        if (inputUsername.length() == 0 || inputPassword.length() == 0) {
            statusLabel.setText("请输入账号和密码");
            return;
        }
        statusLabel.setText("正在验证...");
        try {
            JSONObject body = new JSONObject();
            body.put("username", inputUsername);
            body.put("password", inputPassword);
            body.put("managerCompat", true);
            postJson("/api/admin/verify-password", body, new JsonCallback() {
                @Override public void done(JSONObject json) {
                    handler.post(new Runnable() {
                        @Override public void run() {
                            if (json == null || !json.optBoolean("success")) {
                                statusLabel.setText("验证失败");
                                return;
                            }
                            acceptAdminSession(inputUsername, json.optString("token", ""), json.optString("role", "admin"), json.optJSONArray("permissions"));
                        }
                    });
                }
            });
        } catch (Exception ignored) {}
    }

    private void passportLogin() {
        final String inputUsername = usernameInput.getText().toString().trim();
        final String inputPassword = passwordInput.getText().toString();
        if (inputUsername.length() == 0 || inputPassword.length() == 0) {
            statusLabel.setText("请输入通行证账号和密码");
            return;
        }
        statusLabel.setText("正在验证通行证...");
        try {
            JSONObject body = new JSONObject();
            body.put("username", inputUsername);
            body.put("password", inputPassword);
            body.put("managerCompat", true);
            postJson("/api/auth/login", body, new JsonCallback() {
                @Override public void done(JSONObject json) {
                    JSONObject user = json == null ? null : json.optJSONObject("user");
                    final String passportUid = user == null ? "" : user.optString("uid", user.optString("id", ""));
                    final String passportAuthToken = user == null ? "" : user.optString("authToken", "");
                    if (passportUid.length() == 0) {
                        handler.post(new Runnable() { @Override public void run() { statusLabel.setText(json == null ? "通行证验证失败" : json.optString("error", "通行证验证失败")); } });
                        return;
                    }
                    try {
                        JSONObject adminBody = new JSONObject();
                        adminBody.put("passportUid", passportUid);
                        adminBody.put("authToken", passportAuthToken);
                        adminBody.put("managerCompat", true);
                        postJson("/api/admin/passport-login", adminBody, new JsonCallback() {
                            @Override public void done(JSONObject adminJson) {
                                handler.post(new Runnable() {
                                    @Override public void run() {
                                        if (adminJson == null || !adminJson.optBoolean("success")) {
                                            statusLabel.setText(adminJson == null ? "通行证账号无管理员权限" : adminJson.optString("error", "通行证账号无管理员权限"));
                                            return;
                                        }
                                        acceptAdminSession(
                                            adminJson.optString("username", inputUsername),
                                            adminJson.optString("token", ""),
                                            adminJson.optString("role", "admin"),
                                            adminJson.optJSONArray("permissions")
                                        );
                                    }
                                });
                            }
                        });
                    } catch (Exception ignored) {}
                }
            });
        } catch (Exception ignored) {}
    }

    private void acceptAdminSession(String nextUsername, String nextToken, String nextRole, JSONArray nextPermissions) {
        invalidateContentWorkspaceState();
        username = nextUsername;
        token = nextToken;
        role = nextRole;
        permissions = nextPermissions == null ? new JSONArray() : nextPermissions;
        getPreferences(MODE_PRIVATE).edit()
            .putString("username", username).putString("token", token)
            .putString(PREF_MANAGER_USERNAME, username).putString(PREF_MANAGER_TOKEN, token)
            .putString(PREF_MANAGER_PERMISSIONS, permissions.toString())
            .apply();
        statusLabel.setText("已授权");
        showDashboard();
        checkUpdate(false);
    }

    private void showDashboard() {
        content.removeAllViews();
        content.addView(titleBlock("总览", username));
        buildBottomNavigation(0);
        LinearLayout stats = card();
        stats.addView(statRow("会话", "有效"));
        stats.addView(statRow("权限", isSuper() ? "全部" : String.valueOf(permissions.length())));
        stats.addView(statRow("版本", BuildConfig.VERSION_NAME));
        content.addView(stats);
        addNotices(true);
        LinearLayout actions = card();
        actions.addView(sectionTitle("常用操作"));
        actions.addView(toolButton("打开工作台", android.R.drawable.ic_menu_manage, new Action() { @Override public void run() { showOperations(); } }));
        if (can("feedback_view")) {
            actions.addView(toolButton("处理反馈", android.R.drawable.ic_dialog_email, new Action() { @Override public void run() { showFeedback(); } }));
        }
        content.addView(actions);
    }

    private void showQueue() {
        content.removeAllViews();
        content.addView(titleBlock("事务", "告警与反馈集中处理"));
        buildBottomNavigation(1);
        addNotices(true);
        if (can("feedback_view")) {
            addFeedback(true, false);
        } else {
            LinearLayout card = card();
            card.addView(small("当前账号没有反馈查看权限"));
            content.addView(card);
        }
    }

    private void showNotices() {
        content.removeAllViews();
        content.addView(titleBlock("通知", "后台信息与安全告警"));
        buildBottomNavigation(1);
        addNotices(false);
    }

    private void addNotices(boolean inline) {
        LinearLayout card = card();
        card.addView(sectionTitle("最近告警"));
        fetchNotices(new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        JSONArray items = json == null ? null : json.optJSONArray("items");
                        if (items == null || items.length() == 0) {
                            card.addView(small("暂无新通知"));
                            return;
                        }
                        for (int i = 0; i < Math.min(6, items.length()); i++) {
                            card.addView(noticeRow(items.optJSONObject(i)));
                        }
                    }
                });
            }
        });
        content.addView(card);
    }

    private void showFeedback() {
        showFeedback(false);
    }

    private void showFeedback(boolean trash) {
        if (!can("feedback_view")) {
            showDashboard();
            return;
        }
        content.removeAllViews();
        content.addView(titleBlock("反馈中心", trash ? "回收站" : "待处理队列"));
        buildBottomNavigation(1);
        addFeedback(false, trash);
    }

    private void addFeedback(boolean inline, boolean trash) {
        LinearLayout card = card();
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(sectionTitle(inline ? "反馈队列" : (trash ? "回收站" : "当前反馈")), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (!inline) {
            Button inbox = secondaryButton("处理中", new Action() { @Override public void run() { showFeedback(false); } });
            Button bin = secondaryButton("回收站", new Action() { @Override public void run() { showFeedback(true); } });
            heading.addView(inbox);
            heading.addView(bin);
        }
        card.addView(heading);
        TextView loading = small("正在读取反馈...");
        card.addView(loading);
        content.addView(card);

        getJson("/api/admin/feedback?limit=100" + (trash ? "&trash=1" : ""), new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        card.removeView(loading);
                        if (json == null || !json.optBoolean("success")) {
                            card.addView(small(json == null ? "无法读取反馈，请检查服务器连接" : json.optString("error", "读取失败")));
                            return;
                        }
                        JSONObject summary = json.optJSONObject("summary");
                        if (summary != null) {
                            card.addView(small("待处理 " + (summary.optInt("new") + summary.optInt("reviewing")) + " · 回收站 " + summary.optInt("trash")));
                        }
                        JSONArray items = json.optJSONArray("feedback");
                        if (items == null || items.length() == 0) {
                            card.addView(small(trash ? "回收站为空" : "当前没有反馈"));
                            return;
                        }
                        int limit = inline ? Math.min(3, items.length()) : Math.min(100, items.length());
                        for (int i = 0; i < limit; i++) {
                            JSONObject item = items.optJSONObject(i);
                            if (item != null) card.addView(feedbackRow(item, trash, inline));
                        }
                        if (inline && items.length() > 3) {
                            card.addView(secondaryButton("查看全部反馈", new Action() { @Override public void run() { showFeedback(false); } }));
                        }
                    }
                });
            }
        });
    }

    private LinearLayout feedbackRow(JSONObject item, boolean trash, boolean compact) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(13), 0, dp(13));
        row.addView(text(
            item.optString("category", "体验反馈") + "     " + (trash ? "回收站" : feedbackStatus(item.optString("status", "new"))),
            14, ink(), true
        ));
        TextView message = text(item.optString("message", "无反馈内容"), 13, ink(), false);
        message.setMaxLines(compact ? 2 : 4);
        message.setPadding(0, dp(6), 0, dp(6));
        row.addView(message);
        row.addView(small(
            item.optString("product", "unknown") + " · "
                + item.optString("platform", "unknown") + " · "
                + item.optString("account", "匿名")
        ));

        if (compact) {
            row.addView(secondaryButton("复制记录", new Action() {
                @Override public void run() { copyFeedbackRecord(item); }
            }));
            return row;
        }
        String id = item.optString("id", "");
        if (id.length() == 0) return row;
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        actions.setPadding(0, dp(9), 0, 0);
        actions.addView(secondaryButton("复制记录", new Action() {
            @Override public void run() { copyFeedbackRecord(item); }
        }));
        if (trash) {
            if (can("feedback_delete")) {
                actions.addView(secondaryButton("恢复", new Action() {
                    @Override public void run() { mutateFeedback(id, "/restore", "POST", null, true); }
                }));
            }
            if (isSuper() && can("feedback_purge")) {
                actions.addView(secondaryButton("永久删除", new Action() {
                    @Override public void run() { confirmPurgeFeedback(id); }
                }));
            }
        } else {
            if (can("feedback_manage")) {
                actions.addView(primaryButton("处理", new Action() {
                    @Override public void run() { editFeedback(item); }
                }));
            }
            if (can("feedback_delete")) {
                actions.addView(secondaryButton("移入回收站", new Action() {
                    @Override public void run() { mutateFeedback(id, "", "DELETE", null, false); }
                }));
            }
        }
        row.addView(actions);
        return row;
    }

    private void copyFeedbackRecord(JSONObject item) {
        String record = "反馈编号：" + item.optString("id", "-") + "\n"
            + "产品：" + item.optString("product", "-") + "\n"
            + "平台：" + item.optString("platform", "-") + "\n"
            + "账号：" + item.optString("account", "匿名") + "\n"
            + "联系方式：" + item.optString("contact", "-") + "\n"
            + "分类：" + item.optString("category", "体验反馈") + "\n"
            + "状态：" + feedbackStatus(item.optString("status", "new")) + "\n"
            + "内容：" + item.optString("message", "") + "\n"
            + "内部备注：" + item.optString("note", "-") + "\n"
            + "提交时间：" + item.optString("createdAt", "-");
        copyText("反馈记录", record);
    }

    private void editFeedback(JSONObject item) {
        String id = item.optString("id", "");
        EditText note = input("内部处理备注", false);
        note.setText(item.optString("note", ""));
        new AlertDialog.Builder(this)
            .setTitle(item.optString("category", "处理反馈"))
            .setMessage(item.optString("message", ""))
            .setView(note)
            .setPositiveButton("选择状态", (dialog, which) -> chooseFeedbackStatus(id, note.getText().toString()))
            .setNegativeButton("取消", null)
            .show();
    }

    private void chooseFeedbackStatus(String id, String note) {
        String[] labels = new String[] { "新反馈", "处理中", "已解决", "已归档" };
        String[] values = new String[] { "new", "reviewing", "resolved", "archived" };
        new AlertDialog.Builder(this)
            .setTitle("更新状态")
            .setItems(labels, (dialog, which) -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("status", values[which]);
                    body.put("note", note.length() > 2000 ? note.substring(0, 2000) : note);
                    mutateFeedback(id, "", "PUT", body, false);
                } catch (Exception ignored) {}
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void confirmPurgeFeedback(String id) {
        new AlertDialog.Builder(this)
            .setTitle("永久删除反馈？")
            .setMessage("此操作无法恢复。")
            .setPositiveButton("永久删除", (dialog, which) -> mutateFeedback(id, "/purge", "DELETE", null, true))
            .setNegativeButton("取消", null)
            .show();
    }

    private void mutateFeedback(String id, String suffix, String method, JSONObject body, boolean trash) {
        requestJson("/api/admin/feedback/" + urlEncode(id) + suffix, method, body, new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (json != null && json.optBoolean("success")) {
                            statusLabel.setText("反馈已更新");
                            showFeedback(trash);
                        } else {
                            statusLabel.setText(json == null ? "操作失败" : json.optString("error", "操作失败"));
                        }
                    }
                });
            }
        });
    }

    private String feedbackStatus(String status) {
        if ("reviewing".equals(status)) return "处理中";
        if ("resolved".equals(status)) return "已解决";
        if ("archived".equals(status)) return "已归档";
        return "新反馈";
    }

    private void showPermissions() {
        content.removeAllViews();
        content.addView(titleBlock("权限", "当前账号可用能力"));
        LinearLayout card = card();
        card.addView(text(isSuper() ? "全部权限" : permissionText(), 14, ink(), false));
        content.addView(card);
    }

    private void showTerminal() {
        content.removeAllViews();
        content.addView(titleBlock("终端", "Termux 命令工作区"));
        addTerminal(false);
    }

    private void showInsights() {
        content.removeAllViews();
        content.addView(titleBlock("用户喜好池", "实时偏好与提醒"));
        addInsights(false);
    }

    private void showTools() {
        showOperations();
    }

    private void showOperations() {
        content.removeAllViews();
        content.addView(titleBlock("工作台", "系统、人员、审计与客户端"));
        buildBottomNavigation(3);
        LinearLayout card = card();
        card.addView(sectionTitle("工具"));
        if (can("feedback_view")) {
            card.addView(toolButton("反馈中心", android.R.drawable.ic_dialog_email, new Action() { @Override public void run() { showFeedback(); } }));
        }
        if (can("user_insights")) {
            card.addView(toolButton("用户喜好", android.R.drawable.ic_menu_sort_by_size, new Action() { @Override public void run() { showInsights(); } }));
        }
        if (can("termux_terminal")) {
            card.addView(toolButton("Termux 终端", android.R.drawable.ic_menu_info_details, new Action() { @Override public void run() { showTerminal(); } }));
        }
        card.addView(toolButton("权限明细", android.R.drawable.ic_lock_lock, new Action() { @Override public void run() { showPermissions(); } }));
        card.addView(toolButton("检查更新", android.R.drawable.stat_sys_download, new Action() { @Override public void run() { checkUpdate(true); } }));
        content.addView(card);

        LinearLayout summary = card();
        TextView loading = small("正在读取工作台...");
        summary.addView(loading);
        content.addView(summary);
        getJson("/api/admin/manager/workspace-summary", new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        summary.removeView(loading);
                        if (json == null || !json.optBoolean("success")) {
                            summary.addView(small(json == null ? "工作台暂时无法读取" : json.optString("error", "工作台暂时无法读取")));
                            summary.addView(secondaryButton("重新加载", new Action() { @Override public void run() { showOperations(); } }));
                            return;
                        }
                        renderWorkspaceSummary(json, summary);
                    }
                });
            }
        });
    }

    private void renderWorkspaceSummary(JSONObject json, LinearLayout stack) {
        renderNativeModules(json.optJSONArray("modules"), stack);
        JSONObject system = json.optJSONObject("system");
        if (system != null) {
            stack.addView(sectionTitle("系统状态"));
            stack.addView(workspaceRow("在线与用户", "在线 " + system.optInt("online") + " · 通行证 " + system.optInt("unifiedUsers") + " · 管理员 " + system.optInt("admins")));
            stack.addView(workspaceRow("资源", "内存 " + system.optInt("memoryMB") + " MB · 堆 " + system.optInt("heapMB") + " MB · 运行 " + (system.optInt("uptime") / 3600) + " h"));
        }
        JSONArray admins = json.optJSONArray("admins");
        if (admins != null) {
            stack.addView(sectionTitle("管理员 · " + admins.length()));
            if (admins.length() == 0) stack.addView(small("暂无其他管理员"));
            for (int i = 0; i < Math.min(8, admins.length()); i++) {
                JSONObject item = admins.optJSONObject(i);
                if (item == null) continue;
                int count = item.optInt("permissionCount", 0);
                String adminUsername = item.optString("username", "未命名管理员");
                String adminStatus = item.optString("status", "active");
                String detail = roleLabel(item.optString("role", "editor")) + " · "
                    + ("active".equals(adminStatus) ? "启用" : "停用") + " · "
                    + (count < 0 ? "全部权限" : count + " 项权限");
                if (item.optBoolean("manageable")) {
                    stack.addView(workspaceActionRow(adminUsername, detail, "active".equals(adminStatus) ? "停用" : "启用", new Action() {
                        @Override public void run() { updateAdminStatus(adminUsername, "active".equals(adminStatus) ? "disabled" : "active"); }
                    }));
                } else {
                    stack.addView(workspaceRow(adminUsername, detail));
                }
            }
        }
        JSONArray audit = json.optJSONArray("audit");
        if (audit != null) {
            stack.addView(sectionTitle("最近审计"));
            if (audit.length() == 0) stack.addView(small("暂无审计记录"));
            for (int i = 0; i < Math.min(6, audit.length()); i++) {
                JSONObject item = audit.optJSONObject(i);
                if (item == null) continue;
                stack.addView(workspaceRow(item.optString("action", "管理员操作"),
                    item.optString("username", "unknown") + " · " + item.optString("result", "success") + "\n" + item.optString("timestamp", "")));
            }
        }
        JSONArray apps = json.optJSONArray("apps");
        int appCount = apps == null ? 0 : apps.length();
        stack.addView(sectionTitle("客户端 · " + appCount));
        if (appCount == 0) stack.addView(small("暂无已发布客户端"));
        for (int i = 0; i < appCount; i++) {
            JSONObject item = apps.optJSONObject(i);
            if (item == null) continue;
            stack.addView(workspaceRow(item.optString("platformLabel", item.optString("platform", "客户端")),
                "v" + item.optString("version", "-") + " · build " + item.optInt("build") + " · "
                    + (item.optBoolean("available") ? "可下载" : "文件缺失")));
        }
    }

    private void renderNativeModules(JSONArray modules, LinearLayout stack) {
        int count = modules == null ? 0 : modules.length();
        stack.addView(sectionTitle("全部功能 · " + count));
        if (count == 0) {
            stack.addView(small("当前账号没有可用管理模块"));
            return;
        }
        for (int i = 0; i < count; i++) {
            JSONObject module = modules.optJSONObject(i);
            if (module == null) continue;
            stack.addView(workspaceActionRow(
                module.optString("label", "管理模块"),
                module.optString("group", "管理"),
                "打开",
                new Action() { @Override public void run() { openNativeModule(module); } }
            ));
        }
    }

    private void openNativeModule(JSONObject module) {
        String id = module.optString("id", "");
        if ("feedback".equals(id)) { showFeedback(); return; }
        if ("insights".equals(id)) { showInsights(); return; }
        if ("terminal".equals(id)) { showTerminal(); return; }
        if ("system".equals(id) || "security".equals(id) || "admins".equals(id)) { showOperations(); return; }
        showNativeModuleWorkspace(module);
    }

    private void showNativeModuleWorkspace(JSONObject module) {
        String moduleId = module.optString("id", "");
        if (isContentModule(moduleId)) {
            showContentWorkspace(moduleId, module.optString("label", "内容"), module.optString("group", "内容"));
            return;
        }
        showGenericModuleWorkspace(module);
    }

    private boolean isContentModule(String moduleId) {
        return "media".equals(moduleId) || "downloads".equals(moduleId) || "documents".equals(moduleId)
            || "websites".equals(moduleId) || "works".equals(moduleId);
    }

    private void showGenericModuleWorkspace(JSONObject module) {
        String endpoint = module.optString("endpoint", "");
        if (endpoint.length() == 0) return;
        content.removeAllViews();
        content.addView(titleBlock(module.optString("label", "管理模块"), module.optString("group", "管理")));
        content.addView(secondaryButton("返回工作台", new Action() { @Override public void run() { showOperations(); } }));
        buildBottomNavigation(3);
        LinearLayout card = card();
        TextView loading = small("正在读取数据...");
        card.addView(loading);
        content.addView(card);
        getJson(endpoint, new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        card.removeAllViews();
                        if (json == null || !json.optBoolean("success")) {
                            card.addView(small(json == null ? "模块数据读取失败" : json.optString("error", "模块数据读取失败")));
                            return;
                        }
                        TextView output = text("", 12, ink(), false);
                        output.setTypeface(Typeface.MONOSPACE);
                        output.setTextIsSelectable(true);
                        output.setHorizontallyScrolling(false);
                        Object data = json.opt("data");
                        try {
                            if (data instanceof JSONObject) output.setText(((JSONObject) data).toString(2));
                            else if (data instanceof JSONArray) output.setText(((JSONArray) data).toString(2));
                            else output.setText(String.valueOf(data));
                        } catch (Exception ignored) {
                            output.setText(String.valueOf(data));
                        }
                        card.addView(output);
                    }
                });
            }
        });
    }

    private void showContentWorkspace(String moduleId, String moduleLabel, String moduleGroup) {
        final int generation = beginContentWorkspacePage(moduleId);
        content.removeAllViews();
        content.addView(titleBlock(moduleLabel, moduleGroup));
        content.addView(secondaryButton("返回工作台", new Action() { @Override public void run() { navigateAwayFromContent(new Action() { @Override public void run() { showOperations(); } }); } }));
        content.addView(secondaryButton("刷新", new Action() { @Override public void run() { showContentWorkspace(moduleId, moduleLabel, moduleGroup); } }));
        buildBottomNavigation(3);

        LinearLayout workspaceCard = card();
        workspaceCard.addView(small("正在读取内容..."));
        content.addView(workspaceCard);
        getJsonResult("/api/admin/manager/content/" + urlEncode(moduleId), new HttpResultCallback() {
            @Override public void done(HttpResult result) {
                if (handleAuthenticatedUnauthorized(result)) return;
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (!isCurrentContentPage(moduleId, generation)) return;
                        workspaceCard.removeAllViews();
                        if (result.statusCode == 403) {
                            workspaceCard.addView(small(contentError(result, "当前管理员没有该模块权限")));
                            return;
                        }
                        if (result.json == null || !result.json.optBoolean("success")) {
                            workspaceCard.addView(small(contentError(result, "内容工作区读取失败")));
                            return;
                        }
                        JSONObject workspace = result.json.optJSONObject("workspace");
                        if (workspace == null) {
                            workspaceCard.addView(small("内容工作区数据无效"));
                            return;
                        }
                        cachedContentWorkspaces.put(moduleId, workspace);
                        renderContentWorkspace(workspaceCard, moduleId, moduleLabel, moduleGroup, workspace);
                    }
                });
            }
        });
    }

    private void renderContentWorkspace(LinearLayout stack, String moduleId, String moduleLabel, String moduleGroup, JSONObject workspace) {
        if (workspace.optBoolean("canCreate")) {
            stack.addView(primaryButton("新建" + moduleLabel, new Action() {
                @Override public void run() { showContentEditor(moduleId, moduleLabel, moduleGroup, workspace, null, "create"); }
            }));
            stack.addView(spacer(dp(8)));
        }
        JSONArray records = workspace.optJSONArray("records");
        if (records == null || records.length() == 0) {
            stack.addView(small("暂无内容记录"));
            return;
        }
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.optJSONObject(i);
            if (record != null) renderContentRecord(stack, moduleId, moduleLabel, moduleGroup, workspace, record);
        }
    }

    private void renderContentRecord(LinearLayout stack, String moduleId, String moduleLabel, String moduleGroup, JSONObject workspace, JSONObject record) {
        LinearLayout recordCard = card();
        String recordId = record.optString("id", "");
        String recordTitle = record.optString("title", recordId);
        recordCard.addView(text(recordTitle, 16, ink(), true));
        String subtitle = record.optString("subtitle", "");
        String group = record.optString("group", "");
        if (subtitle.length() > 0 || group.length() > 0) recordCard.addView(small((group.length() == 0 ? "" : group) + (subtitle.length() == 0 ? "" : " · " + subtitle)));

        JSONArray fields = record.optJSONArray("fields");
        if (fields != null) {
            for (int i = 0; i < fields.length(); i++) {
                JSONObject field = fields.optJSONObject(i);
                if (field == null) continue;
                String value = displayFieldValue(field.opt("value"));
                recordCard.addView(workspaceRow(field.optString("label", field.optString("key", "字段")), value));
            }
        }
        JSONArray actions = record.optJSONArray("actions");
        if (containsAction(actions, "update")) {
            recordCard.addView(secondaryButton("编辑", new Action() {
                @Override public void run() { showContentEditor(moduleId, moduleLabel, moduleGroup, workspace, record, "update"); }
            }));
        }
        if (containsAction(actions, "delete")) {
            recordCard.addView(secondaryButton("删除", new Action() {
                @Override public void run() { showContentEditor(moduleId, moduleLabel, moduleGroup, workspace, record, "delete"); }
            }));
        }
        stack.addView(recordCard);
    }

    private void showContentEditor(String moduleId, String moduleLabel, String moduleGroup, JSONObject workspace, JSONObject record, String action) {
        JSONObject currentWorkspace = cachedContentWorkspaces.get(moduleId);
        if (workspace == null || workspace != currentWorkspace || !moduleId.equals(visibleContentModuleId)) {
            showContentWorkspace(moduleId, moduleLabel, moduleGroup);
            return;
        }
        beginContentWorkspacePage(moduleId);
        if ("delete".equals(action)) {
            showContentDeleteConfirmation(moduleId, moduleLabel, moduleGroup, record);
            return;
        }
        content.removeAllViews();
        content.addView(titleBlock("create".equals(action) ? "新建" + moduleLabel : "编辑" + moduleLabel, moduleGroup));
        content.addView(secondaryButton("返回内容列表", new Action() {
            @Override public void run() { showContentWorkspace(moduleId, moduleLabel, moduleGroup); }
        }));
        buildBottomNavigation(3);

        LinearLayout editorCard = card();
        JSONArray fields = "create".equals(action) ? workspace.optJSONArray("createFields") : record.optJSONArray("fields");
        final java.util.LinkedHashMap<String, EditText> editorInputs = new java.util.LinkedHashMap<>();
        final Map<String, Spinner> editorChoiceInputs = new HashMap<>();
        final Map<String, List<String>> editorChoiceValues = new HashMap<>();
        if (fields != null) {
            for (int i = 0; i < fields.length(); i++) {
                JSONObject field = fields.optJSONObject(i);
                if (field == null || !field.optBoolean("editable")) continue;
                String key = field.optString("key", "");
                if (key.length() == 0) continue;
                editorCard.addView(smallLabel(field.optString("label", key) + (field.optBoolean("required") ? " *" : "")));
                String type = field.optString("type", "text");
                if ("choice".equals(type)) {
                    String currentValue = displayFieldValue(field.opt("value"));
                    JSONArray options = field.optJSONArray("options");
                    List<String> optionValues = new ArrayList<>();
                    List<String> optionLabels = new ArrayList<>();
                    if (options != null) {
                        for (int optionIndex = 0; optionIndex < options.length(); optionIndex++) {
                            Object option = options.opt(optionIndex);
                            if (option instanceof JSONObject) {
                                JSONObject objectOption = (JSONObject) option;
                                String value = objectOption.optString("value", "");
                                String defaultLabel = value.length() == 0 ? "未分类" : value;
                                String label = objectOption.optString("label", defaultLabel);
                                if (label.length() == 0) label = defaultLabel;
                                optionValues.add(value);
                                optionLabels.add(label);
                            } else if (option instanceof String) {
                                optionValues.add((String) option);
                                optionLabels.add((String) option);
                            }
                        }
                    }
                    if (currentValue.length() > 0 && !optionValues.contains(currentValue)) {
                        optionValues.add(currentValue);
                        optionLabels.add(currentValue);
                    }
                    Spinner spinner = new Spinner(this);
                    if (optionValues.isEmpty()) {
                        optionValues.add(currentValue);
                        optionLabels.add(currentValue.length() == 0 ? "暂无可选项" : currentValue);
                        spinner.setEnabled(false);
                    }
                    ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, optionLabels);
                    adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
                    spinner.setAdapter(adapter);
                    int selectedIndex = optionValues.indexOf(currentValue);
                    if (selectedIndex >= 0) spinner.setSelection(selectedIndex);
                    editorCard.addView(spinner, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                    editorCard.addView(spacer(dp(10)));
                    editorChoiceInputs.put(key, spinner);
                    editorChoiceValues.put(key, optionValues);
                    continue;
                }
                EditText input = new EditText(this);
                input.setText(displayFieldValue(field.opt("value")));
                input.setTextSize(15);
                input.setPadding(dp(12), dp(8), dp(12), dp(8));
                input.setBackground(roundedBg(rgb(246, 248, 249), dp(8), rgb(213, 222, 226), dp(1)));
                int maxLength = field.optInt("maxLength", 0);
                if (maxLength > 0) input.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(maxLength) });
                if ("multiline".equals(type)) {
                    input.setSingleLine(false);
                    input.setMinLines(4);
                    input.setGravity(Gravity.TOP | Gravity.START);
                } else {
                    input.setSingleLine(true);
                    if ("url".equals(type)) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
                }
                editorCard.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                editorCard.addView(spacer(dp(10)));
                editorInputs.put(key, input);
            }
        }
        final Button[] saveButton = new Button[1];
        saveButton[0] = primaryButton("create".equals(action) ? "创建" : "保存", new Action() {
            @Override public void run() {
                try {
                    JSONObject values = new JSONObject();
                    for (java.util.Map.Entry<String, EditText> entry : editorInputs.entrySet()) {
                        String value = entry.getValue().getText().toString().trim();
                        if ("links".equals(entry.getKey()) && value.startsWith("[")) {
                            try { values.put(entry.getKey(), new JSONArray(value)); }
                            catch (Exception ignored) { values.put(entry.getKey(), value); }
                        } else {
                            values.put(entry.getKey(), value);
                        }
                    }
                    for (Map.Entry<String, Spinner> entry : editorChoiceInputs.entrySet()) {
                        List<String> optionValues = editorChoiceValues.get(entry.getKey());
                        int selectedIndex = entry.getValue().getSelectedItemPosition();
                        String value = optionValues != null && selectedIndex >= 0 && selectedIndex < optionValues.size()
                            ? optionValues.get(selectedIndex) : "";
                        values.put(entry.getKey(), value);
                    }
                    submitContentAction(moduleId, moduleLabel, moduleGroup, action, record, values, "", saveButton[0]);
                } catch (Exception e) {
                    statusLabel.setText("内容输入无效");
                }
            }
        });
        editorCard.addView(saveButton[0]);
        content.addView(editorCard);
    }

    private void showContentDeleteConfirmation(String moduleId, String moduleLabel, String moduleGroup, JSONObject record) {
        if (record == null) return;
        String recordId = record.optString("id", "");
        String recordTitle = record.optString("title", recordId);
        new AlertDialog.Builder(this)
            .setTitle("删除“" + recordTitle + "”？")
            .setMessage("将删除目标：" + recordId)
            .setPositiveButton("删除", (dialog, which) -> submitContentAction(
                moduleId, moduleLabel, moduleGroup, "delete", record, new JSONObject(), recordId, null
            ))
            .setNegativeButton("取消", null)
            .show();
    }

    private void submitContentAction(String moduleId, String moduleLabel, String moduleGroup, String action, JSONObject record, JSONObject values, String confirmation, Button saveButton) {
        try {
            final int generation = contentPageGeneration;
            JSONObject body = new JSONObject();
            body.put("moduleId", moduleId);
            body.put("action", action);
            body.put("recordId", record == null ? "" : record.optString("id", ""));
            body.put("revision", record == null ? "" : record.optString("revision", ""));
            body.put("values", values);
            body.put("confirmation", confirmation);
            if (saveButton != null) saveButton.setEnabled(false);
            statusLabel.setText("正在保存内容...");
            postJsonResult("/api/admin/manager/content/" + urlEncode(moduleId) + "/action", body, new HttpResultCallback() {
                @Override public void done(HttpResult result) {
                    if (handleAuthenticatedUnauthorized(result)) return;
                    handler.post(new Runnable() {
                        @Override public void run() {
                            if (!isCurrentContentPage(moduleId, generation)) return;
                            if (result.statusCode == 403) {
                                statusLabel.setText(contentError(result, "当前管理员没有该模块权限"));
                                if (saveButton != null) saveButton.setEnabled(true);
                                return;
                            }
                            if (result.json != null && result.json.optBoolean("success")) {
                                statusLabel.setText("内容已更新");
                                showContentWorkspace(moduleId, moduleLabel, moduleGroup);
                                return;
                            }
                            statusLabel.setText(contentError(result, "内容操作失败"));
                            if (saveButton != null) saveButton.setEnabled(true);
                        }
                    });
                }
            });
        } catch (Exception e) {
            statusLabel.setText("内容操作无效");
            if (saveButton != null) saveButton.setEnabled(true);
        }
    }

    private boolean containsAction(JSONArray actions, String action) {
        if (actions == null) return false;
        for (int i = 0; i < actions.length(); i++) {
            if (action.equals(actions.optString(i))) return true;
        }
        return false;
    }

    private String displayFieldValue(Object value) {
        if (value == null || JSONObject.NULL.equals(value)) return "";
        return String.valueOf(value);
    }

    private String contentError(HttpResult result, String fallback) {
        if (result.json != null) return result.json.optString("error", fallback);
        return result.error.length() == 0 ? fallback : result.error;
    }

    private void expireSessionAndShowLogin() {
        username = "";
        token = "";
        role = "";
        permissions = new JSONArray();
        getPreferences(MODE_PRIVATE).edit()
            .remove("username").remove("token")
            .remove(PREF_MANAGER_USERNAME).remove(PREF_MANAGER_TOKEN).remove(PREF_MANAGER_PERMISSIONS)
            .apply();
        showLogin();
        statusLabel.setText("登录已失效，请重新验证");
    }

    private int beginContentWorkspacePage(String moduleId) {
        contentPageGeneration += 1;
        visibleContentModuleId = moduleId;
        return contentPageGeneration;
    }

    private boolean isCurrentContentPage(String moduleId, int generation) {
        return generation == contentPageGeneration && moduleId.equals(visibleContentModuleId);
    }

    private void invalidateContentWorkspaceState() {
        contentPageGeneration += 1;
        visibleContentModuleId = "";
        cachedContentWorkspaces.clear();
    }

    private void navigateAwayFromContent(Action action) {
        invalidateContentWorkspaceState();
        action.run();
    }

    private LinearLayout workspaceRow(String title, String detail) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(9), 0, dp(9));
        row.addView(text(title, 14, ink(), true));
        TextView detailView = small(detail);
        detailView.setMaxLines(3);
        detailView.setTextIsSelectable(true);
        row.addView(detailView);
        return row;
    }

    private LinearLayout workspaceActionRow(String title, String detail, String actionTitle, Action action) {
        LinearLayout row = workspaceRow(title, detail);
        row.addView(secondaryButton(actionTitle, action));
        return row;
    }

    private void updateAdminStatus(String adminUsername, String nextStatus) {
        if (!can("admin_manage")) return;
        String verb = "active".equals(nextStatus) ? "启用" : "停用";
        new AlertDialog.Builder(this)
            .setTitle(verb + "管理员？")
            .setMessage(adminUsername)
            .setPositiveButton(verb, (dialog, which) -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("status", nextStatus);
                    statusLabel.setText("正在" + verb + "管理员...");
                    requestJson("/api/admin/admins/" + urlEncode(adminUsername) + "/status", "PUT", body, new JsonCallback() {
                        @Override public void done(JSONObject json) {
                            handler.post(new Runnable() {
                                @Override public void run() {
                                    if (json != null && json.optBoolean("success")) {
                                        statusLabel.setText("管理员已" + verb);
                                        showOperations();
                                    } else {
                                        statusLabel.setText(json == null ? "管理员状态更新失败" : json.optString("error", "管理员状态更新失败"));
                                    }
                                }
                            });
                        }
                    });
                } catch (Exception error) {
                    statusLabel.setText("管理员状态更新失败");
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private String roleLabel(String role) {
        if ("super".equals(role)) return "总管理员";
        if ("admin".equals(role)) return "管理员";
        if ("operator".equals(role)) return "运维";
        if ("editor".equals(role)) return "编辑";
        return role;
    }

    private void showAccount() {
        content.removeAllViews();
        content.addView(titleBlock("账户", username));
        buildBottomNavigation(4);
        LinearLayout card = card();
        card.addView(statRow("当前版本", BuildConfig.VERSION_NAME));
        card.addView(statRow("可用权限", isSuper() ? "全部" : String.valueOf(permissions.length())));
        card.addView(spacer(dp(8)));
        card.addView(secondaryButton("退出登录", new Action() { @Override public void run() { showLogin(); } }));
        content.addView(card);
    }

    private void addInsights(boolean inline) {
        LinearLayout card = card();
        card.addView(sectionTitle("喜好池"));
        if (!can("user_insights")) {
            card.addView(small("当前账号没有用户喜好洞察权限"));
            content.addView(card);
            return;
        }
        getJson("/api/admin/user-insights", new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (json == null || !json.optBoolean("success")) {
                            card.addView(small("无法读取喜好池"));
                            return;
                        }
                        JSONObject summary = json.optJSONObject("summary");
                        JSONObject today = json.optJSONObject("today");
                        JSONObject realtime = json.optJSONObject("realtime");
                        card.addView(statRow("今日信号", String.valueOf(summary == null ? 0 : summary.optInt("todaySignals", 0))));
                        card.addView(statRow("热门模块", summary == null ? "暂无" : summary.optString("topModule", "暂无")));
                        card.addView(small("今日模块\n" + insightList(today == null ? null : today.optJSONArray("modules"))));
                        card.addView(small("实时在线\n" + insightList(realtime == null ? null : realtime.optJSONArray("modules"))));
                        card.addView(spacer(dp(8)));
                        card.addView(secondaryButton("设置提醒时间", new Action() { @Override public void run() { editInsightReminder(json); } }));
                    }
                });
            }
        });
        content.addView(card);
    }

    private String insightList(JSONArray items) {
        if (items == null || items.length() == 0) return "暂无数据";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < Math.min(5, items.length()); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            if (out.length() > 0) out.append("\n");
            out.append(item.optString("label", "-")).append("  ").append(item.optInt("count", 0));
        }
        return out.length() == 0 ? "暂无数据" : out.toString();
    }

    private void editInsightReminder(JSONObject insightJson) {
        JSONObject settings = insightJson.optJSONObject("settings");
        EditText input = input("提醒间隔分钟", false);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setText(String.valueOf(settings == null ? 360 : settings.optInt("intervalMinutes", 360)));
        new AlertDialog.Builder(this)
            .setTitle("喜好池提醒")
            .setMessage("设置 app 定期提醒你查看用户偏好。")
            .setView(input)
            .setPositiveButton("保存", (dialog, which) -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("enabled", true);
                    body.put("intervalMinutes", Math.max(15, Integer.parseInt(input.getText().toString().trim())));
                    postJson("/api/admin/user-insights/settings", body, new JsonCallback() {
                        @Override public void done(JSONObject json) {
                            handler.post(new Runnable() {
                                @Override public void run() { statusLabel.setText(json != null && json.optBoolean("success") ? "提醒已保存" : "保存失败"); }
                            });
                        }
                    });
                } catch (Exception e) {
                    statusLabel.setText("请输入数字");
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void addTerminal(boolean inline) {
        LinearLayout card = card();
        card.addView(sectionTitle("终端"));
        if (!can("termux_terminal")) {
            card.addView(small("当前账号没有终端权限"));
            content.addView(card);
            return;
        }
        TextView terminalStatus = small("正在读取 Termux 状态...");
        card.addView(terminalStatus);
        getJson("/api/admin/termux/status", new JsonCallback() {
            @Override public void done(JSONObject json) {
                handler.post(new Runnable() {
                    @Override public void run() {
                        JSONObject status = json == null ? null : json.optJSONObject("status");
                        if (status == null) {
                            terminalStatus.setText("无法读取终端状态");
                        } else {
                            terminalStatus.setText("host " + status.optString("hostname", "-")
                                + " · node " + status.optString("node", "-")
                                + " · cwd " + status.optString("cwd", "-"));
                        }
                    }
                });
            }
        });
        if (inline) {
            card.addView(secondaryButton("打开终端", new Action() {
                @Override public void run() { showTerminal(); }
            }));
            content.addView(card);
            return;
        }

        card.addView(small("命令"));
        terminalCommandInput = input("输入命令，例如 pm2 status", false);
        terminalCommandInput.setText("pm2 status");
        terminalCommandInput.setTypeface(Typeface.MONOSPACE);
        terminalCommandInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        card.addView(terminalCommandInput);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(0, dp(10), 0, dp(8));
        Button run = primaryButton("执行", new Action() { @Override public void run() { runTerminalCommand(); } });
        Button copy = secondaryButton("复制", new Action() { @Override public void run() { copyTerminalOutput(); } });
        Button clear = secondaryButton("清空", new Action() { @Override public void run() { clearTerminalOutput(); } });
        actions.addView(run, weightedActionParams());
        actions.addView(copy, weightedActionParams());
        actions.addView(clear, weightedActionParams());
        card.addView(actions);

        terminalStandardOutput = terminalOutputView(ink());
        terminalErrorOutput = terminalOutputView(rgb(170, 56, 45));
        card.addView(terminalOutputSection("标准输出", terminalStandardOutput, dp(170)));
        card.addView(terminalOutputSection("错误输出", terminalErrorOutput, dp(110)));
        content.addView(card);
    }

    private void runTerminalCommand() {
        if (!can("termux_terminal")) {
            showDashboard();
            return;
        }
        String command = terminalCommandInput == null ? "" : terminalCommandInput.getText().toString().trim();
        if (command.length() == 0) {
            statusLabel.setText("请输入命令");
            return;
        }
        terminalStandardOutput.setText("正在执行...");
        terminalErrorOutput.setText("");
        statusLabel.setText("命令执行中");
        try {
            JSONObject body = new JSONObject();
            body.put("command", command);
            body.put("timeoutMs", 15000);
            requestJson("/api/admin/termux/command", "POST", body, new JsonCallback() {
                @Override public void done(JSONObject json) {
                    handler.post(new Runnable() {
                        @Override public void run() {
                            if (json == null) {
                                terminalStandardOutput.setText("");
                                terminalErrorOutput.setText("服务器未返回有效数据");
                                statusLabel.setText("命令执行失败");
                                return;
                            }
                            terminalStandardOutput.setText(json.optString("stdout", "").trim());
                            String error = json.optString("stderr", "").trim();
                            if (error.length() == 0) error = json.optString("error", "");
                            terminalErrorOutput.setText(error);
                            statusLabel.setText(json.has("exitCode")
                                ? "命令已结束，退出码 " + json.optInt("exitCode")
                                : "命令已结束");
                        }
                    });
                }
            });
        } catch (Exception error) {
            terminalErrorOutput.setText("无法创建命令请求");
            statusLabel.setText("命令执行失败");
        }
    }

    private void copyTerminalOutput() {
        String command = terminalCommandInput == null ? "" : terminalCommandInput.getText().toString();
        String standard = terminalStandardOutput == null ? "" : terminalStandardOutput.getText().toString();
        String error = terminalErrorOutput == null ? "" : terminalErrorOutput.getText().toString();
        copyText("终端输出", "$ " + command + "\n[标准输出]\n" + standard + "\n[错误输出]\n" + error);
    }

    private void clearTerminalOutput() {
        if (terminalStandardOutput != null) terminalStandardOutput.setText("");
        if (terminalErrorOutput != null) terminalErrorOutput.setText("");
        statusLabel.setText("输出已清空");
    }

    private void copyText(String label, String value) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText(label, value));
        statusLabel.setText(label + "已复制");
    }

    private TextView terminalOutputView(int color) {
        TextView output = text("", 12, color, false);
        output.setTypeface(Typeface.MONOSPACE);
        output.setTextIsSelectable(true);
        output.setHorizontallyScrolling(true);
        output.setHorizontalScrollBarEnabled(true);
        output.setVerticalScrollBarEnabled(true);
        output.setMovementMethod(new ScrollingMovementMethod());
        output.setPadding(dp(12), dp(10), dp(12), dp(10));
        output.setBackground(roundedBg(rgb(246, 248, 247), dp(8), rgb(218, 225, 221), dp(1)));
        return output;
    }

    private LinearLayout terminalOutputSection(String title, TextView output, int height) {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(8), 0, 0);
        section.addView(small(title));
        section.addView(output, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height));
        return section;
    }

    private LinearLayout.LayoutParams weightedActionParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
        params.setMargins(dp(3), 0, dp(3), 0);
        return params;
    }

    private void fetchNotices(JsonCallback callback) {
        new Thread(new Runnable() {
            @Override public void run() { callback.done(readUrl(BuildConfig.NOTIFICATION_FEED_URL, "GET", null).json); }
        }).start();
    }

    private void pollNotices() {
        fetchNotices(new JsonCallback() {
            @Override public void done(JSONObject json) {
                try {
                    JSONArray items = json == null ? null : json.optJSONArray("items");
                    if (items != null && items.length() > 0) {
                        JSONObject latest = items.getJSONObject(0);
                        String id = latest.optString("id", "");
                        if (id.length() > 0 && !id.equals(lastNoticeId)) {
                            lastNoticeId = id;
                            getPreferences(MODE_PRIVATE).edit().putString("lastNoticeId", id).apply();
                            showNotice(latest);
                        }
                    }
                } catch (Exception ignored) {}
                handler.postDelayed(new Runnable() {
                    @Override public void run() { pollNotices(); }
                }, 60000);
            }
        });
    }

    private void showNotice(JSONObject item) {
        String level = item.optString("level", "info");
        String title = item.optString("title", "通知");
        String body = item.optString("body", "");
        handler.post(new Runnable() { @Override public void run() { statusLabel.setText(levelLabel(level) + "：" + title); } });
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new android.app.Notification.Builder(this, CHANNEL_ID)
            : new android.app.Notification.Builder(this);
        builder.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(levelLabel(level) + "：" + title)
            .setContentText(body)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(item.optString("id", "notice").hashCode(), builder.build());
    }

    private void checkUpdate(boolean manual) {
        getJson("/api/admin/manager/apps", new JsonCallback() {
            @Override public void done(JSONObject json) {
                boolean hasUpdate = false;
                String version = "";
                String fileName = "";
                int remoteBuild = 0;
                try {
                    JSONArray apps = json == null ? null : json.optJSONArray("apps");
                    if (apps != null) {
                        for (int i = 0; i < apps.length(); i++) {
                            JSONObject item = apps.getJSONObject(i);
                            if (BuildConfig.APP_UPDATE_ID.equals(item.optString("id"))) {
                                hasUpdate = item.optInt("build", 0) > BuildConfig.VERSION_CODE;
                                version = item.optString("version", "");
                                fileName = item.optString("fileName", "");
                                remoteBuild = item.optInt("build", 0);
                                break;
                            }
                        }
                    }
                } catch (Exception ignored) {}
                final boolean finalHasUpdate = hasUpdate;
                final String finalVersion = version;
                final String finalFileName = fileName;
                final int finalRemoteBuild = remoteBuild;
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (finalHasUpdate && finalFileName.length() > 0) {
                            statusLabel.setText("发现新版本");
                            showUpdateNotification(finalVersion);
                            int promptedBuild = getPreferences(MODE_PRIVATE).getInt("managerLastUpdatePromptBuild", 0);
                            if (manual || promptedBuild != finalRemoteBuild) {
                                getPreferences(MODE_PRIVATE).edit().putInt("managerLastUpdatePromptBuild", finalRemoteBuild).apply();
                                showUpdateDialog(finalVersion, finalFileName);
                            }
                        } else if (manual) {
                            statusLabel.setText("已是最新版本");
                        }
                    }
                });
            }
        });
    }

    private void showUpdateDialog(String version, String fileName) {
        new AlertDialog.Builder(this)
            .setTitle("发现新版本")
            .setMessage("铮铮控制台 " + version + " 已发布。安装包会保存到 Downloads，然后交给系统安装器。")
            .setPositiveButton("下载并安装", (dialog, which) -> downloadUpdate(fileName))
            .setNegativeButton("稍后", null)
            .show();
    }

    private void showUpdateNotification(String version) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new android.app.Notification.Builder(this, CHANNEL_ID)
            : new android.app.Notification.Builder(this);
        builder.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("铮铮控制台有新版本")
            .setContentText("v" + version + " 可用，可下载到 Downloads 后安装。")
            .setAutoCancel(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(("update-" + version).hashCode(), builder.build());
    }

    private void downloadUpdate(String fileName) {
        getJson("/api/admin/manager/apps/download-token?file=" + urlEncode(fileName), new JsonCallback() {
            @Override public void done(JSONObject json) {
                String downloadPath = json == null ? "" : json.optString("downloadURL", "");
                if (downloadPath.startsWith("/")) downloadPath = SITE_ROOT + downloadPath;
                final String finalDownloadUrl = downloadPath;
                handler.post(new Runnable() {
                    @Override public void run() {
                        if (finalDownloadUrl.length() == 0) {
                            statusLabel.setText("生成下载票据失败");
                            return;
                        }
                        try {
                            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(finalDownloadUrl));
                            request.setTitle("铮铮控制台更新");
                            request.setDescription(fileName);
                            request.setMimeType("application/vnd.android.package-archive");
                            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                            updateDownloadId = manager.enqueue(request);
                            statusLabel.setText("正在下载到 Downloads...");
                        } catch (Exception e) {
                            statusLabel.setText("启动下载失败");
                        }
                    }
                });
            }
        });
    }

    private void openDownloadedApk(long downloadId) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            Uri uri = manager.getUriForDownloadedFile(downloadId);
            if (uri == null) {
                statusLabel.setText("下载完成，无法打开安装器");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                pendingInstallUri = uri;
                statusLabel.setText("请允许此应用安装更新");
                Intent permissionIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())
                );
                startActivity(permissionIntent);
                return;
            }
            launchPackageInstaller(uri);
        } catch (Exception e) {
            statusLabel.setText("无法打开安装器");
        }
    }

    private void launchPackageInstaller(Uri uri) {
        try {
            statusLabel.setText("下载完成，打开系统安装器");
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            statusLabel.setText("无法打开系统安装器");
        }
    }

    private void registerDownloadReceiver() {
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
    }

    private void getJson(String path, JsonCallback callback) {
        getJsonResult(path, new HttpResultCallback() {
            @Override public void done(HttpResult result) { deliverAuthenticatedJson(result, callback); }
        });
    }

    private void getJsonResult(String path, HttpResultCallback callback) {
        final String requestToken = token;
        final String requestUsername = username;
        new Thread(new Runnable() {
            @Override public void run() { callback.done(readUrl(SITE_ROOT + path, "GET", null, requestToken, requestUsername)); }
        }).start();
    }

    private void postJson(String path, JSONObject body, JsonCallback callback) {
        postJsonResult(path, body, new HttpResultCallback() {
            @Override public void done(HttpResult result) { deliverAuthenticatedJson(result, callback); }
        });
    }

    private void postJsonResult(String path, JSONObject body, HttpResultCallback callback) {
        final String requestToken = token;
        final String requestUsername = username;
        new Thread(new Runnable() {
            @Override public void run() { callback.done(readUrl(SITE_ROOT + path, "POST", body, requestToken, requestUsername)); }
        }).start();
    }

    private void requestJson(String path, String method, JSONObject body, JsonCallback callback) {
        requestJsonResult(path, method, body, new HttpResultCallback() {
            @Override public void done(HttpResult result) { deliverAuthenticatedJson(result, callback); }
        });
    }

    private void requestJsonResult(String path, String method, JSONObject body, HttpResultCallback callback) {
        final String requestToken = token;
        final String requestUsername = username;
        new Thread(new Runnable() {
            @Override public void run() { callback.done(readUrl(SITE_ROOT + path, method, body, requestToken, requestUsername)); }
        }).start();
    }

    private HttpResult readUrl(String raw, String method, JSONObject body) {
        return readUrl(raw, method, body, token, username);
    }

    private HttpResult readUrl(String raw, String method, JSONObject body, String requestToken, String requestUsername) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(raw).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("X-Manager-Native", "ManagerPortal/Android-" + BuildConfig.VERSION_NAME);
            if (requestToken.length() > 0) conn.setRequestProperty("x-admin-token", requestToken);
            if (requestUsername.length() > 0) conn.setRequestProperty("x-admin-username", URLEncoder.encode(requestUsername, "UTF-8"));
            if (body != null) {
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();
            }
            int statusCode = conn.getResponseCode();
            java.io.InputStream stream = statusCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) return new HttpResult(statusCode, null, "服务器未返回有效数据", requestToken, requestUsername);
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream));
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
            reader.close();
            if (out.length() == 0) return new HttpResult(statusCode, null, "服务器未返回有效数据", requestToken, requestUsername);
            try {
                return new HttpResult(statusCode, new JSONObject(out.toString()), "", requestToken, requestUsername);
            } catch (Exception ignored) {
                return new HttpResult(statusCode, null, "服务器返回无效数据", requestToken, requestUsername);
            }
        } catch (Exception ignored) {
            return new HttpResult(0, null, "网络请求失败", requestToken, requestUsername);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void deliverAuthenticatedJson(HttpResult result, JsonCallback callback) {
        if (handleAuthenticatedUnauthorized(result)) return;
        if (result.statusCode == 403) {
            callback.done(result.json == null ? safeErrorJson(result.error, "当前管理员没有权限") : result.json);
            return;
        }
        callback.done(result.json);
    }

    private boolean handleAuthenticatedUnauthorized(HttpResult result) {
        if (result.statusCode != 401 || result.requestToken.length() == 0 || result.requestUsername.length() == 0) return false;
        handler.post(new Runnable() {
            @Override public void run() {
                if (result.requestToken.equals(token) && result.requestUsername.equals(username)) {
                    expireSessionAndShowLogin();
                }
            }
        });
        return true;
    }

    private JSONObject safeErrorJson(String error, String fallback) {
        JSONObject json = new JSONObject();
        try {
            json.put("success", false);
            json.put("error", error == null || error.length() == 0 ? fallback : error);
        } catch (Exception ignored) {}
        return json;
    }

    private LinearLayout titleBlock(String title, String subtitle) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, 0, 0, dp(12));
        box.addView(text(title, 30, ink(), true));
        box.addView(text(subtitle, 13, muted(), false));
        return box;
    }

    private LinearLayout card() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setPadding(dp(18), dp(18), dp(18), dp(18));
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), rgb(220, 228, 232));
        view.setBackground(bg);
        view.setElevation(0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(14));
        view.setLayoutParams(params);
        return view;
    }

    private TextView statRow(String title, String value) {
        TextView view = text(title + "     " + value, 16, ink(), true);
        view.setPadding(0, dp(6), 0, dp(6));
        return view;
    }

    private LinearLayout noticeRow(JSONObject item) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(10), 0, dp(10));
        row.addView(text(levelLabel(item.optString("level", "info")) + " · " + item.optString("title", "通知"), 14, ink(), true));
        row.addView(text(item.optString("body", ""), 12, muted(), false));
        return row;
    }

    private EditText input(String hint, boolean password) {
        EditText view = new EditText(this);
        view.setHint(hint);
        view.setSingleLine(true);
        view.setTextSize(15);
        view.setPadding(dp(12), 0, dp(12), 0);
        if (password) view.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        view.setMinHeight(dp(46));
        view.setBackground(roundedBg(rgb(246, 248, 249), dp(8), rgb(213, 222, 226), dp(1)));
        return view;
    }

    private Button primaryButton(String text, Action action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(Color.WHITE);
        button.setMinHeight(dp(48));
        button.setBackground(roundedBg(green(), dp(8), green(), 0));
        button.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { action.run(); } });
        return button;
    }

    private Button secondaryButton(String text, Action action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(13);
        button.setTextColor(ink());
        button.setMinHeight(dp(44));
        button.setBackground(roundedBg(Color.WHITE, dp(8), rgb(213, 222, 226), dp(1)));
        button.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { action.run(); } });
        return button;
    }

    private Button toolButton(String text, int icon, Action action) {
        Button button = secondaryButton(text, action);
        button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        button.setCompoundDrawablesWithIntrinsicBounds(icon, 0, android.R.drawable.ic_media_next, 0);
        button.setCompoundDrawablePadding(dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        params.setMargins(0, 0, 0, dp(8));
        button.setLayoutParams(params);
        return button;
    }

    private Button navButton(String text, int icon, boolean selected, Action action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(11);
        button.setTextColor(selected ? green() : muted());
        button.setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0);
        button.setCompoundDrawablePadding(dp(2));
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(2), dp(2), dp(2), dp(2));
        button.setMinHeight(dp(52));
        button.setBackground(roundedBg(selected ? rgb(237, 245, 241) : Color.TRANSPARENT, dp(8), Color.TRANSPARENT, 0));
        button.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { action.run(); } });
        return button;
    }

    private TextView text(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.08f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private TextView smallLabel(String text) { return text(text, 12, muted(), true); }
    private TextView sectionTitle(String text) { return text(text, 18, ink(), true); }
    private TextView small(String text) { return text(text, 13, muted(), false); }
    private TextView mono(String text) {
        TextView view = text(text, 12, ink(), false);
        view.setTypeface(Typeface.MONOSPACE);
        return view;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(0, 0, dp(6), 0);
        return params;
    }

    private View spacer(int h) {
        View view = new View(this);
        view.setLayoutParams(new LinearLayout.LayoutParams(1, h));
        return view;
    }

    private boolean isSuper() {
        if ("super".equals(role)) return true;
        for (int i = 0; i < permissions.length(); i++) {
            if ("*".equals(permissions.optString(i))) return true;
        }
        return false;
    }

    private boolean can(String permission) {
        if (isSuper()) return true;
        for (int i = 0; i < permissions.length(); i++) {
            if (permission.equals(permissions.optString(i))) return true;
        }
        return false;
    }

    private String permissionText() {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < permissions.length(); i++) {
            if (i > 0) out.append(" / ");
            out.append(permissionLabel(permissions.optString(i)));
        }
        return out.toString();
    }

    private String permissionLabel(String id) {
        if ("*".equals(id)) return "全部权限";
        if ("system_check".equals(id)) return "系统检查";
        if ("logs_view".equals(id)) return "日志查看";
        if ("admin_manage".equals(id)) return "管理员";
        if ("security_manage".equals(id)) return "安全";
        if ("alerts_manage".equals(id)) return "通知";
        if ("user_insights".equals(id)) return "喜好";
        if ("termux_terminal".equals(id)) return "终端";
        if ("code_edit".equals(id)) return "源码";
        if ("feedback_view".equals(id)) return "反馈查看";
        if ("feedback_manage".equals(id)) return "反馈处理";
        if ("feedback_delete".equals(id)) return "反馈回收站";
        if ("feedback_purge".equals(id)) return "反馈永久删除";
        return id;
    }

    private String levelLabel(String level) {
        if ("critical".equals(level)) return "重大";
        if ("warning".equals(level)) return "提醒";
        return "信息";
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Manager 告警", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("后台信息、重大漏洞与安全告警");
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 9);
        }
    }

    private String urlEncode(String value) {
        try { return URLEncoder.encode(value, "UTF-8"); }
        catch (Exception ignored) { return value; }
    }

    private int rgb(int r, int g, int b) { return Color.rgb(r, g, b); }
    private int ink() { return rgb(24, 31, 38); }
    private int muted() { return rgb(94, 106, 118); }
    private int green() { return rgb(35, 107, 80); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private android.graphics.drawable.GradientDrawable roundedBg(int color, int radius, int strokeColor, int strokeWidth) {
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(radius);
        if (strokeWidth > 0) bg.setStroke(strokeWidth, strokeColor);
        return bg;
    }
}
