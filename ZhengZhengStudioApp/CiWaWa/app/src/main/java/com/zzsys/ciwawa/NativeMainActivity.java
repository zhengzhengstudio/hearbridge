package com.zzsys.ciwawa;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Environment;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.io.File;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class NativeMainActivity extends Activity {
    private static final String API = "https://zhengzhengstudio.cn";
    private static final String MANIFEST_URL = API + "/api/apps/manifest.json";
    private static final int BG = Color.rgb(248, 247, 244);
    private static final int PANEL = Color.WHITE;
    private static final int INK = Color.rgb(30, 38, 47);
    private static final int MUTED = Color.rgb(95, 107, 118);
    private static final int LINE = Color.rgb(222, 218, 211);
    private static final int ACCENT = Color.rgb(54, 105, 140);

    private LinearLayout content;
    private TextView accountLabel;
    private TextView updateLabel;
    private String activeRole = "ceramic";
    private String activePage = "home";
    private JSONObject user;
    private JSONArray ciwawaApps = new JSONArray();
    private long pendingDownloadId = -1L;
    private String pendingDownloadName = "";
    private boolean updatePromptShown = false;

    private interface Action { void run(); }

    private static final String[][] ROLES = new String[][] {
        {"ceramic", "瓷娃娃本人", "记录疼痛、用药、复诊和每天的身体状态。"},
        {"parent", "家长", "照护日程、紧急联系人和孩子记录放在一起。"},
        {"doctor", "医生", "查看结构化记录，便于复诊前快速了解情况。"},
        {"teacher", "教师", "课堂照护、活动限制和学习备注集中管理。"},
        {"volunteer", "志愿者", "服务任务、活动协助和注意事项一目了然。"},
        {"seller", "瓷娃娃专属售货员", "处理积分商品、兑换说明和订单跟进。"}
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildShell();
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
        render();
        loadManifest(false);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        unregisterReceiver(downloadReceiver);
    }

    private void buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(14), dp(18), dp(12));
        header.setBackgroundColor(PANEL);
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        header.addView(titleBox, new LinearLayout.LayoutParams(0, -2, 1));
        titleBox.addView(label("瓷娃娃", 22, INK, true));
        accountLabel = label("通行证未登录 · 瓷娃娃本人", 12, MUTED, false);
        titleBox.addView(accountLabel);
        header.addView(outlineButton("角色", new Action() { public void run() { chooseRole(); } }));
        header.addView(primaryButton("登录", new Action() { public void run() { showLogin(); } }));

        HorizontalScrollView navScroll = new HorizontalScrollView(this);
        navScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout nav = new LinearLayout(this);
        nav.setPadding(dp(12), dp(8), dp(12), dp(8));
        navScroll.addView(nav);
        root.addView(navScroll, new LinearLayout.LayoutParams(-1, -2));
        addNav(nav, "home", "主页");
        addNav(nav, "record", "记录");
        addNav(nav, "contacts", "联系人");
        addNav(nav, "points", "积分商店");
        addNav(nav, "profile", "我的");
        addNav(nav, "downloads", "下载");

        ScrollView scroll = new ScrollView(this);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(14), dp(8), dp(14), dp(18));
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        updateLabel = label("正在读取版本...", 12, MUTED, false);
        updateLabel.setGravity(Gravity.CENTER);
        updateLabel.setPadding(dp(12), dp(8), dp(12), dp(8));
        root.addView(updateLabel, new LinearLayout.LayoutParams(-1, -2));
        setContentView(root);
    }

    private void addNav(LinearLayout nav, final String page, String title) {
        Button button = outlineButton(title, new Action() {
            public void run() {
                activePage = page;
                render();
            }
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(42));
        params.setMargins(0, 0, dp(8), 0);
        nav.addView(button, params);
    }

    private void render() {
        content.removeAllViews();
        accountLabel.setText((user == null ? "通行证未登录" : user.optString("nickname", user.optString("username", "通行证用户"))) + " · " + roleName(activeRole));
        if ("record".equals(activePage)) renderRecord();
        else if ("contacts".equals(activePage)) renderContacts();
        else if ("points".equals(activePage)) renderPoints();
        else if ("profile".equals(activePage)) renderProfile();
        else if ("downloads".equals(activePage)) renderDownloads();
        else renderHome();
    }

    private void renderHome() {
        content.addView(hero("现在先记一条", "点一下就保存，不用先写完整。"));
        content.addView(quickActions());
        content.addView(tile("今日记录", "查看或补充疼痛、用药、复诊和照护备注。", "写详细", new Action() { public void run() { activePage = "record"; render(); } }));
        content.addView(tile("通行证积分", user == null ? "登录后读取真实积分余额。" : user.optInt("points", 0) + " 积分", "去商店", new Action() { public void run() { activePage = "points"; render(); } }));
        if ("seller".equals(activeRole)) {
            content.addView(tile("售货员工作台", "查看兑换、领取备注和订单跟进。", "处理订单", new Action() { public void run() { activePage = "points"; render(); } }));
        }
    }

    private void renderRecord() {
        content.addView(hero("记录", "只记录真实发生的照护情况。"));
        content.addView(tile("今日打卡", "疼痛程度、用药、复诊提醒。", "保存到本机", null));
        content.addView(tile(roleName(activeRole) + "备注", roleFocus(activeRole), "添加备注", null));
    }

    private void renderContacts() {
        content.addView(hero("联系人", "不预置假联系人，只添加真实关系。"));
        content.addView(tile("添加联系人", "医院、学校、家长、志愿者联系方式。", "添加", null));
    }

    private void renderPoints() {
        content.addView(hero("积分商店", user == null ? "请先登录通行证读取余额。" : "当前余额 " + user.optInt("points", 0) + " 积分"));
        content.addView(tile("积分兑换", "使用通行证 uid 与服务端商店结算。", "刷新积分", new Action() { public void run() { refreshUser(); } }));
        content.addView(tile("瓷娃娃专属售货员", "商品兑换、领取备注、订单跟进。", "售货员视角", new Action() { public void run() { activeRole = "seller"; render(); } }));
    }

    private void renderProfile() {
        content.addView(hero("我的", "账号、角色和版本集中管理。"));
        content.addView(tile("通行证", user == null ? "未登录" : user.optString("username", ""), user == null ? "登录" : "刷新", new Action() { public void run() { if (user == null) showLogin(); else refreshUser(); } }));
        content.addView(tile("版本", "v" + BuildConfig.VERSION_NAME + " build " + BuildConfig.VERSION_CODE, "检查更新", new Action() { public void run() { loadManifest(true); } }));
    }

    private void renderDownloads() {
        content.addView(hero("安装与更新", "Android 会下载 APK 并拉起系统安装器。"));
        for (int i = 0; i < ciwawaApps.length(); i++) {
            JSONObject app = ciwawaApps.optJSONObject(i);
            if (app == null) continue;
            final String url = absolute(app.optString("url", app.optString("downloadURL")));
            final String platform = app.optString("platform");
            final String name = app.optString("fileName", app.optString("name", "CiWaWa.apk"));
            content.addView(tile(app.optString("name"), app.optString("minimumSystem") + " · build " + app.optInt("build"), "安装/更新", new Action() {
                public void run() {
                    if ("android".equals(platform)) downloadAndInstall(url, name);
                    else openUrl(url);
                }
            }));
        }
        if (ciwawaApps.length() == 0) content.addView(tile("正在读取", "下载中心清单加载中。", "刷新", new Action() { public void run() { loadManifest(true); } }));
    }

    private View quickActions() {
        LinearLayout box = panel();
        LinearLayout row1 = new LinearLayout(this);
        row1.setOrientation(LinearLayout.HORIZONTAL);
        row1.setGravity(Gravity.CENTER);
        row1.addView(primaryButton("疼痛明显", new Action() { public void run() { quickSave("疼痛", "疼痛明显", "今天疼痛明显，需要留意。"); } }), new LinearLayout.LayoutParams(0, dp(50), 1));
        row1.addView(primaryButton("已用药", new Action() { public void run() { quickSave("用药", "已用药", "今天已按计划用药。"); } }), new LinearLayout.LayoutParams(0, dp(50), 1));
        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);
        row2.setGravity(Gravity.CENTER);
        row2.addView(outlineButton("需要帮助", new Action() { public void run() { quickSave("求助", "需要帮助", "我现在需要联系家长、医生或老师。"); } }), new LinearLayout.LayoutParams(0, dp(50), 1));
        row2.addView(outlineButton("还可以", new Action() { public void run() { quickSave("还可以", "还可以", "今天状态还可以，先留一条记录。"); } }), new LinearLayout.LayoutParams(0, dp(50), 1));
        box.addView(row1);
        box.addView(row2);
        return box;
    }

    private void quickSave(String type, String level, String note) {
        updateLabel.setText("已保存：" + level);
        activePage = "record";
        render();
    }

    private View hero(String title, String body) {
        LinearLayout box = panel();
        box.setBackgroundColor(Color.rgb(244, 248, 249));
        box.addView(label(title, 28, INK, true));
        TextView b = label(body, 15, MUTED, false);
        b.setPadding(0, dp(8), 0, 0);
        box.addView(b);
        return box;
    }

    private View tile(String title, String body, String action, final Action callback) {
        LinearLayout box = panel();
        box.addView(label(title, 18, INK, true));
        TextView b = label(body, 14, MUTED, false);
        b.setPadding(0, dp(8), 0, dp(12));
        box.addView(b);
        if (action != null) box.addView(callback == null ? outlineButton(action, new Action() { public void run() {} }) : primaryButton(action, callback));
        return box;
    }

    private LinearLayout panel() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(18), dp(16), dp(18), dp(16));
        box.setBackgroundColor(PANEL);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, 0, 0, dp(12));
        box.setLayoutParams(params);
        return box;
    }

    private void chooseRole() {
        final String[] names = new String[ROLES.length];
        for (int i = 0; i < ROLES.length; i++) names[i] = ROLES[i][1];
        new AlertDialog.Builder(this).setTitle("切换角色").setItems(names, new DialogInterface.OnClickListener() {
            public void onClick(DialogInterface dialog, int which) {
                activeRole = ROLES[which][0];
                render();
            }
        }).show();
    }

    private void showLogin() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), 0, dp(12), 0);
        final EditText username = new EditText(this);
        username.setHint("用户名 / 邮箱 / 手机号");
        final EditText password = new EditText(this);
        password.setHint("密码");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(username);
        box.addView(password);
        new AlertDialog.Builder(this)
            .setTitle("通行证登录")
            .setView(box)
            .setPositiveButton("登录", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface dialog, int which) {
                    login(username.getText().toString(), password.getText().toString());
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void login(final String username, final String password) {
        updateLabel.setText("正在登录通行证...");
        new Thread(new Runnable() {
            public void run() {
                try {
                    String body = "{\"username\":\"" + json(username) + "\",\"password\":\"" + json(password) + "\"}";
                    JSONObject result = postJson(API + "/api/auth/login", body);
                    if (result.optBoolean("success")) user = result.optJSONObject("user");
                    postUi(result.optBoolean("success") ? "通行证已登录" : result.optString("error", "登录失败"));
                } catch (Exception e) {
                    postUi("登录失败：" + e.getMessage());
                }
            }
        }).start();
    }

    private void refreshUser() {
        if (user == null) { showLogin(); return; }
        final String uid = user.optString("uid");
        updateLabel.setText("正在刷新积分...");
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject data = getJson(API + "/api/auth/user/" + uid);
                    if (data.optBoolean("success")) user = data.optJSONObject("user");
                    postUi("积分已刷新");
                } catch (Exception e) {
                    postUi("刷新失败");
                }
            }
        }).start();
    }

    private void loadManifest(final boolean manual) {
        updateLabel.setText("正在读取下载中心版本...");
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject manifest = getJson(MANIFEST_URL);
                    JSONArray apps = manifest.optJSONArray("apps");
                    JSONArray filtered = new JSONArray();
                    boolean newer = false;
                    String latest = "";
                    JSONObject latestAndroid = null;
                    if (apps != null) {
                        for (int i = 0; i < apps.length(); i++) {
                            JSONObject item = apps.getJSONObject(i);
                            if (item.optString("id").startsWith("ciwawa-")) filtered.put(item);
                            if ("ciwawa-android".equals(item.optString("id"))) {
                                newer = item.optInt("build") > BuildConfig.VERSION_CODE;
                                latest = item.optString("version");
                                latestAndroid = item;
                            }
                        }
                    }
                    ciwawaApps = filtered;
                    final boolean hasUpdate = newer;
                    final String version = latest;
                    final JSONObject updateApp = latestAndroid;
                    runOnUiThread(new Runnable() {
                        public void run() {
                            updateLabel.setText(hasUpdate ? "发现新版本 " + version : (manual ? "已是最新版本" : "当前已是最新版本"));
                            render();
                            if (hasUpdate && updateApp != null && (!updatePromptShown || manual)) {
                                updatePromptShown = true;
                                showUpdateDialog(updateApp);
                            }
                        }
                    });
                } catch (Exception e) {
                    postUi("下载中心读取失败");
                }
            }
        }).start();
    }

    private JSONObject getJson(String raw) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(raw).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        return new JSONObject(sb.toString());
    }

    private JSONObject postJson(String raw, String body) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(raw).openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        conn.setDoOutput(true);
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        OutputStream os = conn.getOutputStream();
        os.write(bytes);
        os.close();
        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        return new JSONObject(sb.toString());
    }

    private void postUi(final String text) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            public void run() {
                updateLabel.setText(text);
                render();
            }
        });
    }

    private Button primaryButton(String text, final Action action) {
        Button button = baseButton(text, action);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(ACCENT);
        return button;
    }

    private Button outlineButton(String text, final Action action) {
        Button button = baseButton(text, action);
        button.setTextColor(INK);
        button.setBackgroundColor(PANEL);
        return button;
    }

    private Button baseButton(String text, final Action action) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextSize(13);
        button.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { action.run(); } });
        return button;
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private String roleName(String id) {
        for (String[] role : ROLES) if (role[0].equals(id)) return role[1];
        return "瓷娃娃本人";
    }

    private String roleFocus(String id) {
        for (String[] role : ROLES) if (role[0].equals(id)) return role[2];
        return ROLES[0][2];
    }

    private String absolute(String url) {
        if (url == null || url.length() == 0) return API;
        return url.startsWith("/") ? API + url : url;
    }

    private void openUrl(String url) {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    private void showUpdateDialog(final JSONObject app) {
        final String version = app.optString("version", "");
        final int build = app.optInt("build", 0);
        new AlertDialog.Builder(this)
            .setTitle("发现新版本")
            .setMessage("瓷娃娃 " + version + " build " + build + " 已发布。现在下载并打开安装器吗？")
            .setPositiveButton("立即更新", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface dialog, int which) {
                    String url = absolute(app.optString("downloadURL", app.optString("url")));
                    String fileName = app.optString("fileName", "CiWaWa-Android-v" + version + ".apk");
                    downloadAndInstall(url, fileName);
                }
            })
            .setNegativeButton("稍后", null)
            .show();
    }

    private void downloadAndInstall(String url, String fileName) {
        try {
            updateLabel.setText("正在下载更新...");
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("瓷娃娃更新");
            request.setDescription(fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            request.setMimeType("application/vnd.android.package-archive");
            pendingDownloadName = fileName;
            pendingDownloadId = manager.enqueue(request);
        } catch (Exception e) {
            updateLabel.setText("无法启动下载：" + e.getMessage());
            openUrl(url);
        }
    }

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id != pendingDownloadId) return;
            updateLabel.setText("下载完成，正在打开安装器...");
            File file = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), pendingDownloadName);
            installApk(file);
        }
    };

    private void installApk(File file) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 24) {
                Method method = android.os.StrictMode.class.getMethod("disableDeathOnFileUriExposure");
                method.invoke(null);
            }
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.fromFile(file), "application/vnd.android.package-archive");
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            updateLabel.setText("安装器打开失败，请在下载目录手动打开 APK");
        }
    }

    private String json(String s) {
        return String.valueOf(s).replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
