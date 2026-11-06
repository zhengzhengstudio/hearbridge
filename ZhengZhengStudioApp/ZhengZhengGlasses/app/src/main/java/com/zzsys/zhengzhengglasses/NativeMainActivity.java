package com.zzsys.zhengzhengglasses;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

public class NativeMainActivity extends Activity {
    private static final String API = "https://zhengzhengstudio.cn/api";
    private TextView userLabel;
    private TextView userDetail;
    private TextView updateLabel;
    private JSONObject currentUser;
    private JSONObject latestUpdate;
    private JSONObject savedAnalysis;
    private JSONArray wishlist = new JSONArray();
    private JSONArray catalogFrames = new JSONArray();
    private int catalogPage = 0;
    private int fittingStep = 1;
    // 只记录「配镜底栏的规格」，不复用 View 实例：复用同一个 View 会在换页时抛
    // "The specified child already has a parent"。每次 setContentView 现场新建。
    private int fittingBarStep = 0;
    private String fittingBarNextText = "";
    private Action fittingBarNextAction = null;
    // 每次换页自增。异步回调带回发起时的 token，不一致就不再改 UI，避免把用户从当前页拽走。
    private int pageToken = 0;
    private JSONObject selectedFrame;
    private File pendingInstallApk;
    private String activeTab = "home";
    private String pendingChatPrefill;
    static final int REQ_CAPTURE = 4101;

    private interface Action { void run(); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loadLocalState();
        buildNativeHome();
        // 重建（语言/深色模式等配置变化）时不重复发起网络请求
        if (savedInstanceState == null) {
            fetchCatalog(false);
            checkUpdate(false);
        }
    }

    /** 所有后台线程回主线程统一走这里：Activity 已结束就不碰 UI，避免 BadTokenException / 空指针。 */
    private void runOnUi(final Runnable action) {
        if (isFinishing() || isDestroyed()) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            if (isFinishing() || isDestroyed()) return;
            action.run();
        });
    }

    /** 返回键：五步配镜回上一步，其它子页面回首页，首页才退出。避免误触一次就前功尽弃。 */
    @Override
    public void onBackPressed() {
        if (isFinishing()) { super.onBackPressed(); return; }
        if ("fit".equals(activeTab) && fittingStep > 1) {
            showFittingStep(fittingStep - 1);
            return;
        }
        if (!"home".equals(activeTab)) {
            buildNativeHome();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallApk != null && pendingInstallApk.exists()) {
            if (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls()) {
                File apk = pendingInstallApk;
                pendingInstallApk = null;
                new Handler(Looper.getMainLooper()).postDelayed(() -> openApkInstaller(apk), 350);
            }
        }
    }

    private void buildNativeHome() {
        activeTab = "home";
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(244, 248, 247));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pagePadding = isCompactWidth() ? 16 : 24;
        root.setPadding(dp(pagePadding), dp(20), dp(pagePadding), dp(32));
        scroll.addView(root, centeredContentParams());

        root.addView(hero());
        root.addView(shopEntryCard());
        root.addView(homeProgressCard());
        root.addView(quickStartCard());
        root.addView(accountCard());
        root.addView(statusCard());
        setContentView(scroll);
    }

    /** 首页入口：电商风的「先逛镜框库」卡片（2026-10-22）。 */
    private View shopEntryCard() {
        LinearLayout card = card();
        card.setOrientation(LinearLayout.VERTICAL);
        card.addView(label("镜框库", 20, Color.rgb(13, 34, 39), true));
        card.addView(label("陌森、珊珊与精选款式都在这里，先挑一副再进实时试戴。", 14, Color.rgb(83, 101, 107), false));
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(10), 0, 0);
        row.addView(button("逛镜框库", true, new Action() { @Override public void run() { showShopPage(); } }), weight());
        row.addView(button("实时试戴", false, new Action() { @Override public void run() { openNativeTryOn(); } }), weight());
        card.addView(row);
        return card;
    }

    @Override
    public void setContentView(View view) {
        pageToken++;
        if (view instanceof ScrollView) {
            LinearLayout shell = new LinearLayout(this);
            boolean wide = screenDpWidth() >= 840;
            shell.setOrientation(wide ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
            shell.setBackgroundColor(Color.rgb(244, 248, 247));
            if (wide) shell.addView(sideNav(), new LinearLayout.LayoutParams(dp(216), ViewGroup.LayoutParams.MATCH_PARENT));
            shell.addView(view, new LinearLayout.LayoutParams(
                wide ? 0 : ViewGroup.LayoutParams.MATCH_PARENT,
                wide ? ViewGroup.LayoutParams.MATCH_PARENT : 0,
                1f
            ));
            if (!wide) {
                if (activeTab.equals("fit") && fittingBarNextAction != null) {
                    // 每次现场新建底栏，绝不复用带旧父的 View（旧实现换页会崩溃）
                    LinearLayout bar = buildFittingBar(fittingBarStep, fittingBarNextText, fittingBarNextAction);
                    shell.addView(bar);
                    bar.requestApplyInsets();
                } else {
                    shell.addView(bottomNav());
                }
            }
            super.setContentView(shell);
            return;
        }
        super.setContentView(view);
    }

    private View hero() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(0, dp(4), 0, dp(22));
        LinearLayout.LayoutParams heroParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        card.setLayoutParams(heroParams);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setOrientation(LinearLayout.HORIZONTAL);
        card.addView(row);

        ImageView icon = new ImageView(this);
        icon.setImageResource(getApplicationInfo().icon);
        int iconSize = isCompactWidth() ? 44 : 54;
        row.addView(icon, new LinearLayout.LayoutParams(dp(iconSize), dp(iconSize)));

        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(14), 0, 0, 0);
        row.addView(text, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        text.addView(label("铮铮眼镜", isCompactWidth() ? 25 : 28, Color.rgb(13, 34, 39), true));
        text.addView(label("采集、试戴、报告和商家沟通", 14, Color.rgb(83, 101, 107), false));
        return card;
    }

    private View accountCard() {
        LinearLayout card = card();
        card.setOrientation(LinearLayout.VERTICAL);
        card.addView(label("账号与同步", 14, Color.rgb(22, 119, 105), true));
        userLabel = label("未登录", 18, Color.rgb(13, 34, 39), true);
        userDetail = label("可先使用本机临时用户；登录通行证后与网页版共享档案。", 14, Color.rgb(83, 101, 107), false);
        if (currentUser != null) {
            String name = currentUser.optString("nickname", currentUser.optString("username", "匿名用户"));
            boolean temp = currentUser.optBoolean("temporary", false);
            userLabel.setText(name + (temp ? " · 临时配镜用户" : " · 已登录"));
            userDetail.setText("UID：" + currentUser.optString("uid", currentUser.optString("id", "-")) + "。数据会优先同步服务器，本机也会缓存。");
        }
        card.addView(userLabel);
        card.addView(userDetail);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(10), 0, 0);
        card.addView(row);
        row.addView(button(currentUser == null ? "登录或创建临时用户" : "管理账号", false, new Action() { @Override public void run() { showAccountActions(); } }), weight());
        row.addView(button("我的档案", false, new Action() { @Override public void run() { showWorkspacePage(); } }), weight());
        LinearLayout updateRow = new LinearLayout(this);
        updateRow.setOrientation(LinearLayout.HORIZONTAL);
        updateRow.setPadding(0, dp(8), 0, 0);
        updateRow.addView(label("当前 " + BuildConfig.VERSION_NAME + " · build " + BuildConfig.VERSION_CODE, 12, Color.rgb(83, 101, 107), false), weight());
        updateRow.addView(button("检查更新", false, new Action() { @Override public void run() { checkUpdate(true); } }), weight());
        card.addView(updateRow);
        return card;
    }

    private View quickStartCard() {
        LinearLayout card = card();
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(rounded(Color.rgb(15, 68, 64), Color.rgb(15, 68, 64), 14));
        card.addView(label(savedAnalysis == null ? "开始第一次配镜" : "继续上次配镜", 22, Color.WHITE, true));
        card.addView(label(savedAnalysis == null ? "按五步完成采集、试戴和报告，结果会逐步保存。" : buildHomeSummary(), 14, Color.rgb(204, 230, 225), false));
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(12), 0, 0);
        row.addView(button(savedAnalysis == null ? "开始五步配镜" : "继续五步配镜", false, new Action() { @Override public void run() { showFittingPage(); } }), weight());
        row.addView(button("实时试戴", false, new Action() { @Override public void run() { openNativeTryOn(); } }), weight());
        card.addView(row);
        return card;
    }

    /** 首页五步进度（身份 / 采集 / 试戴 / 报告 / 定制），让用户随时知道走到哪一步。 */
    private View homeProgressCard() {
        LinearLayout card = card();
        card.addView(label("配镜进度", 14, Color.rgb(22, 119, 105), true));
        final String[] keys = {"身份", "采集", "试戴", "报告", "定制"};
        final boolean[] done = {
            currentUser != null,
            savedAnalysis != null,
            selectedFrame != null,
            savedAnalysis != null,
            wishlist.length() > 0
        };
        int currentIndex = -1;
        for (int i = 0; i < done.length; i++) {
            if (!done[i]) { currentIndex = i; break; }
        }
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(8), 0, dp(2));
        for (int i = 0; i < keys.length; i++) {
            String mark = done[i] ? "✓ " : (i == currentIndex ? "▸ " : "");
            int color = done[i] ? Color.rgb(22, 119, 105) : (i == currentIndex ? Color.rgb(230, 111, 81) : Color.rgb(120, 130, 132));
            row.addView(label(mark + keys[i], 12, color, true), weight());
        }
        card.addView(row);
        return card;
    }

    private String buildHomeSummary() {
        if (savedAnalysis == null) return "还没有配镜记录";
        return "脸宽 " + savedAnalysis.optInt("faceWidth", 0) + " mm · 瞳距 " + savedAnalysis.optInt("pd", 0)
            + " mm · 心愿单 " + wishlist.length() + " 款";
    }

    private View continuityCard() {
        LinearLayout card = card();
        card.addView(label("跨设备接力", 18, Color.rgb(13, 34, 39), true));
        card.addView(label(currentUser == null
            ? "当前先保存在本机。登录铮铮通行证后，可与网页版共享档案、心愿单和会话。"
            : "已连接铮铮通行证。App 与网页版使用同一份配镜档案、心愿单和商家会话。", 14, Color.rgb(83, 101, 107), false));
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(10), 0, 0);
        row.addView(button("同步现在的数据", false, new Action() { @Override public void run() {
            if (savedAnalysis != null) saveSession("native_analysis", savedAnalysis);
            saveSession("wishlist", wishlist);
            toast(currentUser == null ? "数据已保存在本机，登录后可同步。" : "正在与网页版同步数据。");
        }}), weight());
        row.addView(button("检查版本", false, new Action() { @Override public void run() { checkUpdate(true); } }), weight());
        card.addView(row);
        return card;
    }

    private void showAccountActions() {
        String[] items = currentUser == null
            ? new String[] { "登录通行证", "注册通行证", "创建临时配镜用户" }
            : new String[] { "查看我的档案", "切换账号", "退出登录" };
        new AlertDialog.Builder(this)
            .setTitle(currentUser == null ? "选择身份" : currentUserName())
            .setItems(items, (dialog, which) -> {
                if (currentUser == null) {
                    if (which == 0) showLogin();
                    else if (which == 1) showRegister();
                    else showTemporaryUser();
                } else {
                    if (which == 0) showWorkspacePage();
                    else if (which == 1) showLogin();
                    else logout();
                }
            })
            .show();
    }

    private View workflowGrid() {
        GridLayout grid = new GridLayout(this);
        grid.setColumnCount(screenDpWidth() < 600 ? 1 : 2);
        grid.setPadding(0, 0, 0, 0);
        addTile(grid, "开始配镜", "采集关键点、试戴、生成报告", "/onboard.html");
        addTile(grid, "原生试戴", "CameraX + MediaPipe 实时叠镜框", "/native-tryon");
        addTile(grid, "顾客工作台", "查看数据、心愿单和试戴图", "/customer.html");
        addTile(grid, "配镜聊天", "发送验光单和定制需求", "/chat.html");
        addTile(grid, "商家中心", "入驻、上传镜框、处理订单", "/merchant.html");
        addTile(grid, "项目 PPT", "查看 WAIC 展示材料", "/ppt.html");
        addTile(grid, "网站首页", "回到线上 Demo 入口", "/index.html");
        return grid;
    }

    private void addTile(GridLayout grid, String title, String desc, final String path) {
        LinearLayout tile = card();
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.addView(label(title, 18, Color.rgb(13, 34, 39), true));
        tile.addView(label(desc, 13, Color.rgb(83, 101, 107), false));
        tile.addView(button("查看", false, new Action() { @Override public void run() { showNativeFeature(title, desc, path); } }));

        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0;
        params.height = ViewGroup.LayoutParams.WRAP_CONTENT;
        params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        params.setMargins(0, dp(12), grid.getColumnCount() > 1 ? dp(10) : 0, 0);
        grid.addView(tile, params);
    }

    private View statusCard() {
        LinearLayout card = card();
        card.setOrientation(LinearLayout.VERTICAL);
        card.addView(label("当前阶段", 20, Color.rgb(13, 34, 39), true));
        card.addView(label("已接入原生第三步：CameraX 打开摄像头，MediaPipe 在本机识别人脸关键点，实时叠加镜框。网络不可用时，参数、心愿单和报告仍会先保存在本机。", 14, Color.rgb(83, 101, 107), false));
        boolean marketInstall = isAppMarketInstall();
        updateLabel = label("版本：" + BuildConfig.VERSION_NAME + " · build " + BuildConfig.VERSION_CODE + "。"
            + (marketInstall ? "应用市场版会直接打开应用市场更新。" : "官网版会在 App 内校验并安装正式 APK。"), 13, Color.rgb(22, 119, 105), true);
        card.addView(updateLabel);
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(12), 0, 0);
        row.addView(button("检查版本", false, new Action() { @Override public void run() { checkUpdate(true); } }), weight());
        row.addView(button(marketInstall ? "打开应用市场" : "检查并更新", true, new Action() { @Override public void run() {
            if (marketInstall) openAppMarket(); else installLatestUpdate();
        } }), weight());
        card.addView(row);
        return card;
    }

    private void showLogin() {
        final EditText account = input("用户名 / 手机 / 邮箱", false);
        final EditText password = input("密码", true);
        LinearLayout form = form(account, password);
        new AlertDialog.Builder(this)
            .setTitle("通行证登录")
            .setMessage("在 App 内直接登录，不跳转浏览器。")
            .setView(form)
            .setPositiveButton("登录", (dialog, which) -> login(account.getText().toString(), password.getText().toString()))
            .setNegativeButton("取消", null)
            .show();
    }

    private void showRegister() {
        final EditText username = input("用户名", false);
        final EditText nickname = input("昵称", false);
        final EditText email = input("邮箱", false);
        final EditText password = input("密码，至少 6 位", true);
        new AlertDialog.Builder(this)
            .setTitle("注册通行证")
            .setMessage("注册后作为铮铮眼镜正式用户同步数据。")
            .setView(form(username, nickname, email, password))
            .setPositiveButton("注册", (dialog, which) -> register(username.getText().toString(), nickname.getText().toString(), email.getText().toString(), password.getText().toString()))
            .setNegativeButton("取消", null)
            .show();
    }

    private void showTemporaryUser() {
        final EditText name = input("显示名称", false);
        name.setText("临时顾客");
        new AlertDialog.Builder(this)
            .setTitle("临时配镜用户")
            .setMessage("只保存在本机，不上传服务器。适合朋友、家人或现场演示先试用；之后可再登录通行证。")
            .setView(name)
            .setPositiveButton("开始体验", (dialog, which) -> {
                try {
                    JSONObject user = new JSONObject();
                    String finalName = name.getText().toString().trim();
                    if (finalName.length() == 0) finalName = "临时顾客";
                    user.put("uid", "temp_glasses_" + System.currentTimeMillis());
                    user.put("username", finalName);
                    user.put("nickname", finalName);
                    user.put("temporary", true);
                    user.put("source", "glasses-app");
                    setUser(user);
                } catch (Exception ignored) {}
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void login(String account, String password) {
        if (account.trim().length() == 0 || password.length() == 0) {
            toast("请填写账号和密码。");
            return;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("account", account.trim());
            body.put("username", account.trim());
            body.put("password", password);
        } catch (Exception ignored) {}
        post("/zz-pass/login", body, new ActionWithJson() {
            @Override public void run(JSONObject data) {
                JSONObject user = data.optJSONObject("user");
                if (user != null) {
                    setUser(user);
                    toast("登录成功。");
                } else {
                    toast(data.optString("message", data.optString("error", "登录失败")));
                }
            }
        });
    }

    private void register(String username, String nickname, String email, String password) {
        if (username.trim().length() == 0 || password.length() < 6) {
            toast("请填写用户名，密码至少 6 位。");
            return;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("account", username.trim());
            body.put("username", username.trim());
            body.put("nickname", nickname.trim());
            body.put("email", email.trim());
            body.put("password", password);
        } catch (Exception ignored) {}
        post("/zz-pass/register", body, new ActionWithJson() {
            @Override public void run(JSONObject data) {
                JSONObject user = data.optJSONObject("user");
                if (user != null) {
                    setUser(user);
                    toast("注册成功，已登录。");
                } else {
                    toast(data.optString("message", data.optString("error", "注册失败")));
                }
            }
        });
    }

    private void setUser(JSONObject user) {
        currentUser = user;
        String name = user.optString("nickname", user.optString("username", "匿名用户"));
        boolean temp = user.optBoolean("temporary", false);
        if (userLabel != null) userLabel.setText(name + (temp ? " · 临时配镜用户" : " · 已登录"));
        if (userDetail != null) userDetail.setText(temp
            ? "UID：" + user.optString("uid", "-") + "。仅保存在本机，可随时改名或退出。"
            : "UID：" + user.optString("uid", user.optString("id", "-")) + "。进入采集、试戴和聊天时会自动带上账号信息。");
        saveLocalState();
        if ("fit".equals(activeTab) && fittingStep == 1) showIdentityPage();
    }

    private void logout() {
        currentUser = null;
        if (userLabel != null) userLabel.setText("未登录");
        if (userDetail != null) userDetail.setText("可以先创建本机临时配镜用户，或登录铮铮通行证同步数据。");
        saveLocalState();
        if ("fit".equals(activeTab) && fittingStep == 1) showIdentityPage();
    }

    private void showNativeFeature(String title, String desc, String path) {
        if ("/onboard.html".equals(path)) {
            showFittingPage();
            return;
        }
        if ("/native-tryon".equals(path)) {
            openNativeTryOn();
            return;
        }
        if ("/customer.html".equals(path)) {
            showWorkspacePage();
            return;
        }
        if ("/chat.html".equals(path)) {
            showChatPage();
            return;
        }
        if ("/merchant.html".equals(path)) {
            showMerchantPage();
            return;
        }
        if ("/ppt.html".equals(path)) {
            showFeaturePage("项目 PPT", "WAIC 展示材料", "App 内暂不播放 PPT。请在下载中心或网页端查看公开版展示材料。");
            return;
        }
        String userName = "匿名用户";
        if (currentUser != null) {
            userName = currentUser.optString("nickname", currentUser.optString("username", "匿名用户"));
        }
        String detail;
        if ("/onboard.html".equals(path)) {
            detail = "1. 确认账号或临时身份\n2. 采集正脸与多角度数据\n3. 选择镜框并试戴\n4. 生成配镜报告和心愿单\n\n当前用户：" + userName;
        } else if ("/customer.html".equals(path)) {
            detail = "这里会集中显示最近一次采集数据、心愿单、试戴图和报告。正式版会把这些数据同步到服务器，减少换设备丢失。";
        } else if ("/chat.html".equals(path)) {
            detail = "顾客可以把验光单、试戴图、心愿单和定制需求发给 Kimi 顾问、你本人或商家。";
        } else if ("/merchant.html".equals(path)) {
            detail = "商家可入驻、上传镜框图、维护镜框参数，并处理顾客发来的心愿单和定制单。";
        } else if ("/ppt.html".equals(path)) {
            detail = "项目展示材料用于 WAIC 评审和现场介绍，公开版本不会展示真实人脸。";
        } else {
            detail = "这是铮铮眼镜的线上 Demo 总入口。App 会优先提供原生流程，不再把用户直接甩到网页。";
        }
        showFeaturePage(title, desc, detail);
    }

    private void showFeaturePage(String title, String desc, String detail) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(232, 241, 240));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pagePadding = isCompactWidth() ? 12 : 18;
        root.setPadding(dp(pagePadding), dp(pagePadding), dp(pagePadding), dp(24));
        scroll.addView(root, centeredContentParams());

        LinearLayout page = card();
        page.addView(label(title, 26, Color.rgb(13, 34, 39), true));
        page.addView(label(desc, 15, Color.rgb(83, 101, 107), false));
        TextView body = label(detail, 15, Color.rgb(37, 59, 65), false);
        body.setPadding(0, dp(12), 0, dp(12));
        page.addView(body);
        page.addView(button("返回首页", true, new Action() { @Override public void run() { buildNativeHome(); checkUpdate(false); } }));
        root.addView(page);
        setContentView(scroll);
    }

    private void showFittingPage() {
        showFittingStep(fittingStep);
    }

    private void showFittingStep(int step) {
        fittingStep = Math.max(1, Math.min(5, step));
        saveLocalState();
        if (fittingStep == 1) showIdentityPage();
        else if (fittingStep == 2) showMeasurementPage();
        else if (fittingStep == 3) showCatalogPage();
        else if (fittingStep == 4) showReportPage();
        else showCustomizationPage();
    }

    private void showIdentityPage() {
        activeTab = "fit";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        addStepHeader(root, 1, "第 1 步 · 身份与临时用户", "确认这次配镜记录属于谁。正式账号可跨设备同步，临时用户只保存在本机。");

        LinearLayout page = card();
        page.addView(label(currentUser == null ? "尚未选择身份" : currentUserName(), 20, Color.rgb(13, 34, 39), true));
        page.addView(label(currentUser == null
            ? "你可以登录、注册、创建临时配镜用户，也可以匿名完成本次体验。"
            : (currentUser.optBoolean("temporary", false) ? "临时配镜用户 · 数据仅保存在本机" : "铮铮通行证 · 数据会优先同步服务器"),
            14, Color.rgb(83, 101, 107), false));
        page.addView(button(currentUser == null ? "登录 / 注册 / 临时用户" : "管理当前账号", true,
            new Action() { @Override public void run() { showAccountActions(); } }));
        root.addView(page);
        root.addView(stepNavigation(1, "下一步：采集与校准", new Action() {
            @Override public void run() { showFittingStep(2); }
        }));
        setContentView(scroll);
    }

    private void showMeasurementPage() {
        activeTab = "fit";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        addStepHeader(root, 2, "第 2 步 · 多角度采集", "只采集脸部关键帧并校准毫米尺寸。本步骤不显示镜框，也不填写验光单。");
        LinearLayout page = card();
        page.addView(label("尺寸校准", 20, Color.rgb(13, 34, 39), true));
        page.addView(label("摄像头只能测比例，请至少使用一项真实测量值校准。", 13, Color.rgb(83, 101, 107), false));

        final EditText faceWidth = input("脸宽 mm，例如 139", false);
        final EditText pd = input("瞳距 PD mm，例如 63", false);
        final EditText bridge = input("鼻梁宽/鼻梁建议 mm，例如 18", false);
        if (savedAnalysis != null) {
            faceWidth.setText(String.valueOf(savedAnalysis.optInt("faceWidth", 139)));
            pd.setText(String.valueOf(savedAnalysis.optInt("pd", 63)));
            bridge.setText(String.valueOf(savedAnalysis.optInt("bridgeWidth", 18)));
        } else {
            faceWidth.setText("139");
            pd.setText("63");
            bridge.setText("18");
        }
        page.addView(form(faceWidth, pd, bridge));
        int capturedFrames = savedAnalysis == null ? 0 : savedAnalysis.optInt("capturedFrames", 0);
        page.addView(label(capturedFrames > 0
            ? "已保存多角度采集：" + capturedFrames + " 帧识别数据（每帧 " + savedAnalysis.optInt("capturedPoints", 0) + " 个关键点）。可重新采集覆盖。"
            : "尚未完成多角度采集。点击下方按钮采集正脸、左右转头与抬头低头。",
            13, capturedFrames > 0 ? Color.rgb(22, 119, 105) : Color.rgb(83, 101, 107), false));
        page.addView(button("打开多角度采集", false, new Action() {
            @Override public void run() {
                saveMeasurementInputs(faceWidth, pd, bridge);
                openNativeCapture();
            }
        }));
        root.addView(page);
        root.addView(stepNavigation(2, "保存并进入试戴", new Action() {
            @Override public void run() {
                saveMeasurementInputs(faceWidth, pd, bridge);
                showFittingStep(3);
            }
        }));
        setContentView(scroll);
    }

    private void saveMeasurementInputs(EditText faceWidth, EditText pd, EditText bridge) {
        try {
            int faceWidthValue = parseInt(faceWidth.getText().toString(), 139);
            int pdValue = parseInt(pd.getText().toString(), 63);
            int bridgeValue = parseInt(bridge.getText().toString(), 18);
            int recommendedLens = pdValue <= 60 ? 49 : (pdValue <= 63 ? 51 : 54);
            int frameTotal = recommendedLens * 2 + bridgeValue;
            double decentration = Math.max(0, (frameTotal - pdValue) / 2.0);
            int score = 100 - (int) Math.min(24, Math.abs(decentration - 3) * 5) - (faceWidthValue < 128 || faceWidthValue > 158 ? 8 : 0);
            String sizeName = recommendedLens <= 50 ? "小框" : (recommendedLens <= 52 ? "中框" : "大框");

            JSONObject analysis = savedAnalysis == null ? new JSONObject() : savedAnalysis;
            analysis.put("faceWidth", faceWidthValue);
            analysis.put("pd", pdValue);
            analysis.put("bridgeWidth", bridgeValue);
            analysis.put("recommendedLensWidth", recommendedLens);
            analysis.put("frameTotalWidth", frameTotal);
            analysis.put("decentration", Math.round(decentration * 10) / 10.0);
            analysis.put("sizeName", sizeName);
            analysis.put("fitScore", Math.max(55, Math.min(98, score)));
            analysis.put("faceShape", faceWidthValue > 148 ? "偏宽脸" : (faceWidthValue < 132 ? "偏窄脸" : "常规脸宽"));
            analysis.put("templeLength", faceWidthValue > 150 ? 150 : 145);
            analysis.put("updatedAt", System.currentTimeMillis());
            savedAnalysis = analysis;
            saveLocalState();
            saveSession("native_analysis", analysis);
            toast("尺寸已保存。");
        } catch (Exception error) {
            toast("保存失败：" + error.getMessage());
        }
    }

    private void showWorkspacePage() {
        activeTab = "profile";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        LinearLayout page = card();
        page.addView(label("顾客工作台", 26, Color.rgb(13, 34, 39), true));
        page.addView(label(currentUserName() + " · " + (savedAnalysis == null ? "还没有配镜数据" : "已有配镜数据"), 14, Color.rgb(83, 101, 107), false));
        page.addView(label(buildReportText(), 14, Color.rgb(37, 59, 65), false));
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(12), 0, 0);
        row.addView(button("继续录入", false, new Action() { @Override public void run() { showFittingPage(); } }), weight());
        row.addView(button("镜框库", true, new Action() { @Override public void run() { showShopPage(); } }), weight());
        page.addView(row);
        page.addView(button("查看心愿单", false, new Action() { @Override public void run() { showWishlistPage(); } }));
        page.addView(button("查看订单", false, new Action() { @Override public void run() { showOrdersPage(); } }));
        page.addView(button("同步数据", false, new Action() {
            @Override public void run() {
                if (savedAnalysis != null) saveSession("native_analysis", savedAnalysis);
                saveSession("wishlist", wishlist);
                toast("已尝试同步到服务器，本机缓存仍会保留。");
            }
        }));
        page.addView(button("返回首页", false, new Action() { @Override public void run() { buildNativeHome(); } }));
        root.addView(page);
        setContentView(scroll);
    }

    // ============ 电商风 · 镜框库（2026-10-22）============

    private String shopBrandFilter = "all";

    private void showShopPage() {
        activeTab = "shop";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.VERTICAL);
        head.addView(label("镜框库", 26, Color.rgb(13, 34, 39), true));
        head.addView(label("先看看有哪些款，挑中之后直接进实时试戴。", 14, Color.rgb(83, 101, 107), false));
        root.addView(head);
        root.addView(shopFilterBar());

        final GridLayout grid = new GridLayout(this);
        grid.setUseDefaultMargins(false);
        grid.setColumnCount(isCompactWidth() ? 2 : 3);
        grid.setAlignmentMode(GridLayout.ALIGN_BOUNDS);
        LinearLayout.LayoutParams gridParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gridParams.setMargins(0, dp(6), 0, dp(12));
        root.addView(grid, gridParams);

        renderShopGrid(grid);
        setContentView(scroll);

        // 目录数据以服务端 /api/glasses/catalog 为准（与网页版同源，318 款）
        get("/glasses/catalog", new ActionWithJson() {
            @Override public void run(JSONObject data) {
                JSONArray frames = data.optJSONArray("frames");
                if (frames != null && frames.length() > 0) {
                    catalogFrames = frames;
                } else {
                    fillFallbackCatalog();
                }
                renderShopGrid(grid);
            }
        });
    }

    private View shopFilterBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setPadding(0, dp(10), 0, dp(4));
        String[][] filters = {
            {"all", "全部"},
            {"molsion", "陌森"},
            {"shanshan", "珊珊"},
            {"kimi", "Kimi"}
        };
        for (final String[] item : filters) {
            final boolean active = shopBrandFilter.equals(item[0]);
            Button chip = button(item[1], active, new Action() { @Override public void run() {
                shopBrandFilter = item[0];
                showShopPage();
            }});
            chip.setTextSize(13);
            LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(38));
            chipParams.setMargins(0, 0, dp(8), 0);
            bar.addView(chip, chipParams);
        }
        return bar;
    }

    private void renderShopGrid(GridLayout grid) {
        if (grid == null) return;
        grid.removeAllViews();
        JSONArray frames = shopOrderedFrames();
        if (frames.length() == 0) {
            grid.addView(label("镜框库暂时没有加载出来，稍后再试。", 14, Color.rgb(83, 101, 107), false));
            return;
        }
        int columns = grid.getColumnCount();
        int index = 0;
        for (int i = 0; i < frames.length(); i++) {
            JSONObject frame = frames.optJSONObject(i);
            if (frame == null) continue;
            View card = shopFrameCard(frame);
            GridLayout.LayoutParams params = new GridLayout.LayoutParams(
                GridLayout.spec(GridLayout.UNDEFINED, 1f),
                GridLayout.spec(index % columns, 1f));
            params.width = 0;
            params.height = ViewGroup.LayoutParams.WRAP_CONTENT;
            params.setMargins(dp(4), dp(4), dp(4), dp(10));
            grid.addView(card, params);
            index++;
        }
    }

    /** 电商风要混排：陌森 / 珊珊 / Kimi 轮流出场，避免整屏同一品牌。 */
    private JSONArray shopOrderedFrames() {
        JSONArray molsion = new JSONArray();
        JSONArray shanshan = new JSONArray();
        JSONArray other = new JSONArray();
        for (int i = 0; i < catalogFrames.length(); i++) {
            JSONObject frame = catalogFrames.optJSONObject(i);
            if (frame == null) continue;
            if (!shopMatchesFilter(frame)) continue;
            String haystack = (frame.optString("merchantName", "") + frame.optString("id", "")
                + frame.optString("image", "")).toLowerCase();
            if (haystack.contains("陌森") || haystack.contains("molsion")) {
                molsion.put(frame);
            } else if (haystack.contains("珊珊") || haystack.contains("shanshan")
                || haystack.contains("paul") || haystack.contains("bolon")) {
                shanshan.put(frame);
            } else {
                other.put(frame);
            }
        }
        JSONArray ordered = new JSONArray();
        int guard = catalogFrames.length() * 3 + 9;
        while (ordered.length() < molsion.length() + shanshan.length() + other.length() && guard-- > 0) {
            if (molsion.length() > 0) { ordered.put(molsion.opt(0)); molsion.remove(0); }
            if (shanshan.length() > 0) { ordered.put(shanshan.opt(0)); shanshan.remove(0); }
            if (other.length() > 0) { ordered.put(other.opt(0)); other.remove(0); }
        }
        return ordered;
    }

    private boolean shopMatchesFilter(JSONObject frame) {
        if ("all".equals(shopBrandFilter)) return true;
        String haystack = (frame.optString("merchantName", "") + frame.optString("id", "")
            + frame.optString("image", "")).toLowerCase();
        if ("molsion".equals(shopBrandFilter)) {
            return haystack.contains("陌森") || haystack.contains("molsion");
        }
        if ("shanshan".equals(shopBrandFilter)) {
            return haystack.contains("珊珊") || haystack.contains("shanshan")
                || haystack.contains("paul") || haystack.contains("bolon");
        }
        if ("kimi".equals(shopBrandFilter)) {
            return haystack.contains("kimi");
        }
        return true;
    }

    private View shopFrameCard(final JSONObject frame) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(10), dp(10), dp(10), dp(12));
        card.setBackground(rounded(Color.WHITE, Color.rgb(224, 233, 232), 16));

        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setBackgroundColor(Color.rgb(243, 247, 248));
        image.setContentDescription(frame.optString("name", "镜框"));
        // 用商品原图（960px 级真实产品图）。thumb 只有 320px / 2KB，
        // 在卡片里放大后糊成一片，看起来像"画的示意图"；仅当原图缺失才退回缩略图。
        String photo = frame.optString("image", "");
        if (photo.length() == 0) photo = frame.optString("originalImage", "");
        if (photo.length() == 0) photo = frame.optString("thumb", frame.optString("tryOnImage", ""));
        FrameImageLoader.load(image, photo);
        card.addView(image, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(isCompactWidth() ? 128 : 152)));

        card.addView(label(frame.optString("merchantName", "铮铮精选"), 12, Color.rgb(22, 119, 105), true));
        card.addView(label(frame.optString("name", "未命名镜框"), 15, Color.rgb(13, 34, 39), true));
        int lens = frame.optInt("lensWidth", 0);
        int bridge = frame.optInt("bridgeSize", frame.optInt("bridgeWidth", 0));
        String spec = lens > 0 ? ("镜圈 " + lens + "mm" + (bridge > 0 ? " · 鼻梁 " + bridge + "mm" : "")) : frame.optString("type", "镜框");
        card.addView(label(spec, 12, Color.rgb(83, 101, 107), false));
        int price = frame.optInt("price", 0);
        if (price > 0) {
            card.addView(label("¥" + price, 17, Color.rgb(230, 111, 81), true));
        } else {
            card.addView(label("价格待询", 13, Color.rgb(120, 130, 132), false));
            card.addView(button("问 Kimi 价格", false, new Action() { @Override public void run() { openPriceAsk(frame); } }));
        }

        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(0, dp(8), 0, 0);
        actions.addView(button("试戴", true, new Action() { @Override public void run() {
            selectFrameForTryOn(frame);
            openNativeTryOn();
        }}), weight());
        actions.addView(button("收藏", false, new Action() { @Override public void run() { addToWishlist(frame); } }), weight());
        card.addView(actions);
        return card;
    }

    private void showCatalogPage() { showCatalogPage(true); }

    private void showCatalogPage(final boolean loadRemote) {
        activeTab = "fit";
        // 从工作台/心愿单直接进这一页时也要同步步骤，避免进度点与步骤号互相矛盾
        fittingStep = 3;
        saveLocalState();
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        addStepHeader(root, 3, "第 3 步 · 摄像头试戴", "选择一款镜框后进入 CameraX + MediaPipe 实时试戴。这里不填写验光单，也不生成报告。");
        LinearLayout page = card();
        if (catalogFrames.length() == 0) {
            fillFallbackCatalog();
        }
        page.addView(label("当前试戴", 13, Color.rgb(22, 119, 105), true));
        page.addView(label(selectedFrame == null ? "还没有选择镜框" : selectedFrame.optString("name", "未命名镜框"), 20, Color.rgb(13, 34, 39), true));
        page.addView(label("每批 4 款，共 " + catalogFrames.length() + " 款。先选择，再打开实时试戴。", 13, Color.rgb(83, 101, 107), false));
        if (selectedFrame != null) {
            page.addView(button("打开当前镜框实时试戴", true, new Action() { @Override public void run() { openNativeTryOn(); } }));
        }
        // 目录数量会在「内置 8 款」与「线上几百款」之间变化，页码越界会渲染出空白页
        int maxPage = Math.max(0, (catalogFrames.length() - 1) / 4);
        catalogPage = Math.max(0, Math.min(catalogPage, maxPage));
        int start = catalogPage * 4;
        int end = Math.min(catalogFrames.length(), start + 4);
        for (int i = start; i < end; i++) {
            final JSONObject frame = catalogFrames.optJSONObject(i);
            if (frame == null) continue;
            page.addView(frameRow(frame));
        }
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(12), 0, 0);
        row.addView(button("上一批", false, new Action() { @Override public void run() { catalogPage = Math.max(0, catalogPage - 1); showCatalogPage(); } }), weight());
        row.addView(button("下一批", false, new Action() { @Override public void run() { if ((catalogPage + 1) * 4 < catalogFrames.length()) catalogPage++; showCatalogPage(); } }), weight());
        page.addView(row);
        root.addView(page);
        root.addView(stepNavigation(3, "下一步：报告与验光单", new Action() { @Override public void run() { showFittingStep(4); } }));
        setContentView(scroll);
        // 放在 setContentView 之后：回调里用 pageToken 判断本页是否仍是当前页
        if (loadRemote) fetchCatalog(false);
    }

    private View frameRow(final JSONObject frame) {        LinearLayout item = new LinearLayout(this);
        item.setOrientation(LinearLayout.VERTICAL);
        item.setPadding(dp(14), dp(14), dp(14), dp(14));
        item.setBackground(rounded(Color.rgb(249, 252, 251), Color.rgb(218, 230, 227), 10));
        LinearLayout.LayoutParams itemParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        itemParams.setMargins(0, dp(10), 0, 0);
        item.setLayoutParams(itemParams);
        // 五步配镜第 3 步原来只有文字、没有任何商品图，"选镜框"时看不到款式长什么样。
        // 这里与商品页同源加载真实产品图（不是画出来的示意图）。
        ImageView photo = new ImageView(this);
        photo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        photo.setBackgroundColor(Color.rgb(243, 247, 248));
        photo.setContentDescription(frame.optString("name", "镜框"));
        String photoUrl = frame.optString("image", "");
        if (photoUrl.length() == 0) photoUrl = frame.optString("originalImage", "");
        if (photoUrl.length() == 0) photoUrl = frame.optString("thumb", frame.optString("tryOnImage", ""));
        FrameImageLoader.load(photo, photoUrl);
        item.addView(photo, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(isCompactWidth() ? 150 : 190)));
        item.addView(label(frame.optString("name", "未命名镜框"), 18, Color.rgb(13, 34, 39), true));
        String size = "镜圈 " + frame.optInt("lensWidth", 0) + " mm / 鼻梁 " + frame.optInt("bridgeSize", frame.optInt("bridgeWidth", 0)) + " mm";
        item.addView(label(frame.optString("merchantName", "商家") + " · " + frame.optString("type", "镜框") + " · ¥" + frame.optInt("price", 0), 13, Color.rgb(83, 101, 107), false));
        item.addView(label(size + "\n" + frame.optString("description", ""), 13, Color.rgb(37, 59, 65), false));
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(10), 0, 0);
        row.addView(button("试戴此款", true, new Action() { @Override public void run() { selectFrameForTryOn(frame); } }), weight());
        row.addView(button("加入心愿单", false, new Action() { @Override public void run() { addToWishlist(frame); } }), weight());
        item.addView(row);
        return item;
    }

    private void selectFrameForTryOn(JSONObject frame) {
        selectedFrame = frame;
        saveLocalState();
        openNativeTryOn();
    }

    private void showFrameFit(JSONObject frame) {
        String text = buildFrameFitText(frame);
        new AlertDialog.Builder(this)
            .setTitle(frame.optString("name", "镜框适配"))
            .setMessage(text)
            .setPositiveButton("加入心愿单", (dialog, which) -> addToWishlist(frame))
            .setNegativeButton("关闭", null)
            .show();
    }

    private String buildFrameFitText(JSONObject frame) {
        if (savedAnalysis == null) return "请先录入脸宽、瞳距和鼻梁宽，再判断适配。";
        int lens = frame.optInt("lensWidth", 0);
        int bridge = frame.optInt("bridgeSize", frame.optInt("bridgeWidth", savedAnalysis.optInt("bridgeWidth", 18)));
        int pd = savedAnalysis.optInt("pd", 63);
        double dec = Math.max(0, ((lens * 2 + bridge) - pd) / 2.0);
        String level = dec <= 3 ? "理想" : (dec <= 5 ? "可试戴" : "需谨慎");
        return "镜圈宽度：" + lens + " mm\n鼻梁宽：" + bridge + " mm\n移心量≈" + (Math.round(dec * 10) / 10.0) + " mm · " + level + "\n\n移心量=（镜圈宽度×2+鼻梁宽-瞳距）÷2。正式配镜前请用验光单和实物框再次校准。";
    }

    private void addToWishlist(JSONObject frame) {
        try {
            String id = frame.optString("id", "");
            JSONArray next = new JSONArray();
            boolean exists = false;
            for (int i = 0; i < wishlist.length(); i++) {
                JSONObject item = wishlist.optJSONObject(i);
                if (item == null) continue;
                if (id.equals(item.optString("id"))) exists = true;
                next.put(item);
            }
            if (!exists) next.put(frame);
            wishlist = next;
            saveLocalState();
            saveSession("wishlist", wishlist);
            toast(exists ? "心愿单里已经有这款。" : "已加入心愿单。");
        } catch (Exception error) {
            toast("加入失败：" + error.getMessage());
        }
    }

    private void showWishlistPage() {
        activeTab = "wish";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        LinearLayout page = card();
        page.addView(label("心愿单", 26, Color.rgb(13, 34, 39), true));
        page.addView(label("共 " + wishlist.length() + " 款。可以生成报告，也可以把第一款连同参数发给商家。", 14, Color.rgb(83, 101, 107), false));
        for (int i = 0; i < wishlist.length(); i++) {
            JSONObject frame = wishlist.optJSONObject(i);
            if (frame != null) page.addView(label((i + 1) + ". " + frame.optString("name") + " · " + frame.optString("merchantName") + " · ¥" + frame.optInt("price", 0), 15, Color.rgb(37, 59, 65), false));
        }
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(12), 0, 0);
        row.addView(button("发送给商家", true, new Action() { @Override public void run() { sendWishlistOrder(); } }), weight());
        row.addView(button("清空", false, new Action() { @Override public void run() { wishlist = new JSONArray(); saveLocalState(); showWishlistPage(); } }), weight());
        page.addView(row);
        page.addView(button("返回镜框库", false, new Action() { @Override public void run() { showShopPage(); } }));
        root.addView(page);
        setContentView(scroll);
    }

    private void showReportPage() {
        activeTab = "fit";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        addStepHeader(root, 4, "第 4 步 · 报告与导出", "查看尺寸报告，并选填医院或视光机构提供的验光信息。度数不会由摄像头估算。");
        LinearLayout page = card();
        final EditText right = input("右眼度数，可选，例如 -2.50", false);
        final EditText left = input("左眼度数，可选，例如 -2.25", false);
        final EditText note = input("验光单备注 / 试戴感受，可选", false);
        if (savedAnalysis != null) {
            right.setText(savedAnalysis.optString("rightDegree", ""));
            left.setText(savedAnalysis.optString("leftDegree", ""));
            note.setText(savedAnalysis.optString("note", ""));
        }
        page.addView(label("选填验光信息", 20, Color.rgb(13, 34, 39), true));
        page.addView(form(right, left, note));
        page.addView(label("配镜报告", 20, Color.rgb(13, 34, 39), true));
        page.addView(label(buildReportText(), 15, Color.rgb(37, 59, 65), false));
        page.addView(button("保存并分享报告", false, new Action() { @Override public void run() {
            saveOptometryInputs(right, left, note);
            shareText("铮铮眼镜配镜报告", buildReportText());
        } }));
        root.addView(page);
        root.addView(stepNavigation(4, "保存并进入定制", new Action() { @Override public void run() {
            saveOptometryInputs(right, left, note);
            showFittingStep(5);
        } }));
        setContentView(scroll);
    }

    private void saveOptometryInputs(EditText right, EditText left, EditText note) {
        try {
            if (savedAnalysis == null) savedAnalysis = new JSONObject();
            savedAnalysis.put("rightDegree", right.getText().toString().trim());
            savedAnalysis.put("leftDegree", left.getText().toString().trim());
            savedAnalysis.put("note", note.getText().toString().trim());
            savedAnalysis.put("updatedAt", System.currentTimeMillis());
            saveLocalState();
            saveSession("native_analysis", savedAnalysis);
            toast("验光信息与报告已保存。");
        } catch (Exception error) {
            toast("保存失败：" + error.getMessage());
        }
    }

    private void showCustomizationPage() {
        activeTab = "fit";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        addStepHeader(root, 5, "第 5 步 · 定制镜框", "最后确认镜圈、鼻梁、镜腿与个性化说明。商家制作前仍需复核实物和验光单。");
        LinearLayout page = card();
        page.addView(label("定制参数", 20, Color.rgb(13, 34, 39), true));

        final EditText lens = input("镜圈宽度 mm", false);
        final EditText bridge = input("鼻梁宽 mm", false);
        final EditText temple = input("镜腿长度 mm", false);
        final EditText note = input("鼻托、材料、颜色或其他定制说明", false);
        if (savedAnalysis != null) {
            lens.setText(String.valueOf(savedAnalysis.optInt("recommendedLensWidth", 51)));
            bridge.setText(String.valueOf(savedAnalysis.optInt("bridgeWidth", 18)));
            temple.setText(String.valueOf(savedAnalysis.optInt("templeLength", 145)));
            note.setText(savedAnalysis.optString("customizationNote", savedAnalysis.optString("note", "")));
        }
        page.addView(form(lens, bridge, temple, note));
        LinearLayout row = new LinearLayout(this);
        row.setPadding(0, dp(12), 0, 0);
        row.addView(button("保存定制参数", true, new Action() { @Override public void run() {
            saveCustomizationInputs(lens, bridge, temple, note);
        } }), weight());
        row.addView(button("发给顾问", false, new Action() { @Override public void run() { showChatPage(); } }), weight());
        page.addView(row);
        root.addView(page);
        root.addView(stepNavigation(5, "完成配镜", new Action() { @Override public void run() {
            saveCustomizationInputs(lens, bridge, temple, note);
            fittingStep = 1;
            saveLocalState();
            showWorkspacePage();
        } }));
        setContentView(scroll);
    }

    private void saveCustomizationInputs(EditText lens, EditText bridge, EditText temple, EditText note) {
        try {
            if (savedAnalysis == null) savedAnalysis = new JSONObject();
            savedAnalysis.put("recommendedLensWidth", parseInt(lens.getText().toString(), 51));
            savedAnalysis.put("bridgeWidth", parseInt(bridge.getText().toString(), 18));
            savedAnalysis.put("templeLength", parseInt(temple.getText().toString(), 145));
            savedAnalysis.put("customizationNote", note.getText().toString().trim());
            savedAnalysis.put("updatedAt", System.currentTimeMillis());
            saveLocalState();
            saveSession("native_analysis", savedAnalysis);
            toast("定制参数已保存。登录用户会继续同步到网页版。");
        } catch (Exception error) {
            toast("保存失败：" + error.getMessage());
        }
    }

    private void openNativeTryOn() {
        openNativeCamera(false);
    }

    private void openNativeCapture() {
        openNativeCamera(true);
    }

    private void openNativeCamera(boolean captureMode) {
        Intent intent = new Intent(this, NativeTryOnActivity.class);
        intent.putExtra("captureMode", captureMode);
        if (savedAnalysis != null) {
            intent.putExtra("faceWidth", savedAnalysis.optInt("faceWidth", 139));
            intent.putExtra("pd", savedAnalysis.optInt("pd", 63));
            intent.putExtra("lensWidth", savedAnalysis.optInt("recommendedLensWidth", 51));
        }
        JSONObject frame = selectedFrame != null ? selectedFrame : wishlist.optJSONObject(0);
        if (frame != null) {
            intent.putExtra("frameName", frame.optString("name", ""));
            intent.putExtra("frameType", frame.optString("type", ""));
            intent.putExtra("frameLensWidth", frame.optInt("lensWidth", 0));
            intent.putExtra("tryOnImage", frame.optString("tryOnImage", ""));
        }
        try {
            // 采集模式需要把识别帧数/关键点数回传给第 2 步，否则采集完什么都没留下
            if (captureMode) startActivityForResult(intent, REQ_CAPTURE);
            else startActivity(intent);
        } catch (Exception error) {
            toast((captureMode ? "多角度采集" : "原生试戴") + "暂时打不开：" + error.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_CAPTURE || resultCode != RESULT_OK || data == null) return;
        try {
            if (savedAnalysis == null) savedAnalysis = new JSONObject();
            savedAnalysis.put("capturedFrames", data.getIntExtra("captureFrames", 0));
            savedAnalysis.put("capturedPoints", data.getIntExtra("capturePoints", 0));
            savedAnalysis.put("capturedAt", System.currentTimeMillis());
        } catch (Exception ignored) {}
        saveLocalState();
        int frames = savedAnalysis == null ? 0 : savedAnalysis.optInt("capturedFrames", 0);
        toast(frames > 0 ? "已保存多角度采集：" + frames + " 帧识别数据" : "采集已结束，未记录到有效帧");
        if ("fit".equals(activeTab) && fittingStep == 2 && !isFinishing() && !isDestroyed()) {
            showFittingStep(2);
        }
    }

    private String buildReportText() {
        if (savedAnalysis == null) return "还没有生成配镜参数。请先在“开始配镜”里录入脸宽、瞳距和鼻梁宽。";
        return "用户：" + currentUserName()
            + "\n脸型/脸宽：" + savedAnalysis.optString("faceShape", "-") + " · " + savedAnalysis.optInt("faceWidth", 0) + " mm"
            + "\n瞳距 PD：" + savedAnalysis.optInt("pd", 0) + " mm"
            + "\n建议镜圈宽度：" + savedAnalysis.optInt("recommendedLensWidth", 0) + " mm · " + savedAnalysis.optString("sizeName", "")
            + "\n建议鼻梁宽：" + savedAnalysis.optInt("bridgeWidth", 0) + " mm"
            + "\n估算镜框总宽：" + savedAnalysis.optInt("frameTotalWidth", 0) + " mm"
            + "\n移心量：" + savedAnalysis.optDouble("decentration", 0) + " mm"
            + "\n镜腿建议：" + savedAnalysis.optInt("templeLength", 145) + " mm"
            + "\n适配评分：" + savedAnalysis.optInt("fitScore", 0) + "/100"
            + "\n右眼度数：" + savedAnalysis.optString("rightDegree", "未填")
            + "\n左眼度数：" + savedAnalysis.optString("leftDegree", "未填")
            + "\n备注：" + savedAnalysis.optString("note", "无")
            + "\n\n说明：App 只做镜框适配和沟通整理，度数、散光、轴位等以医院或视光机构验光单为准。";
    }

    /** 价格待询：打开配镜聊天并预填「问 Kimi：…价格」，用户确认后发给 Kimi 顾问。 */
    private void openPriceAsk(JSONObject frame) {
        String name = frame.optString("name", "这款镜框");
        pendingChatPrefill = "问 Kimi：" + name + " 这款的价格是多少？我想了解一下报价和是否有优惠。";
        showChatPage();
    }

    private void showChatPage() {
        activeTab = "chat";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        LinearLayout page = card();
        page.addView(label("配镜聊天", 26, Color.rgb(13, 34, 39), true));
        page.addView(label("把验光单、配镜参数、心愿单和定制需求发给镜框顾问或商家。网络不稳时，App 会保留本机数据，方便之后继续沟通。", 14, Color.rgb(83, 101, 107), false));
        final EditText message = input("输入要问的问题或定制需求", false);
        String defaultText = pendingChatPrefill != null ? pendingChatPrefill
            : (savedAnalysis == null ? "我想先了解适合什么镜框。" : "请根据我的配镜参数和心愿单，帮我整理给商家的定制需求。");
        message.setText(defaultText);
        pendingChatPrefill = null;
        page.addView(message);
        LinearLayout targets = new LinearLayout(this);
        targets.setOrientation(LinearLayout.HORIZONTAL);
        targets.addView(button("问 Kimi 2.6", true, new Action() {
            @Override public void run() {
                sendChatMessage(message.getText().toString(), "kimi", "Kimi 配镜顾问");
            }
        }), weight());
        targets.addView(button("联系闪闪", false, new Action() {
            @Override public void run() {
                sendChatMessage(message.getText().toString(), "u_1772857774898ls0t6", "闪闪");
            }
        }), weight());
        page.addView(targets);
        page.addView(button("查看已有会话", false, new Action() { @Override public void run() { showConversationsPage(); } }));
        page.addView(button("返回工作台", false, new Action() { @Override public void run() { showWorkspacePage(); } }));
        root.addView(page);
        setContentView(scroll);
    }

    private void showMerchantPage() {
        activeTab = "profile";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        LinearLayout page = card();
        page.addView(label("商家中心", 26, Color.rgb(13, 34, 39), true));
        page.addView(label("商家可以先提交店铺资料，再录入镜框名称、尺寸、价格和图片地址。顾客心愿单会带着配镜参数过来。", 14, Color.rgb(83, 101, 107), false));
        final EditText store = input("店铺名", false);
        final EditText contact = input("联系方式", false);
        final EditText desc = input("服务说明", false);
        page.addView(form(store, contact, desc));
        page.addView(button("注册/更新商家", true, new Action() {
            @Override public void run() {
                if (store.getText().toString().trim().length() == 0) {
                    toast("请先填写店铺名。");
                    return;
                }
                JSONObject body = new JSONObject();
                try {
                    body.put("uid", currentUid());
                    body.put("storeName", store.getText().toString());
                    body.put("contact", contact.getText().toString());
                    body.put("description", desc.getText().toString());
                } catch (Exception ignored) {}
                post("/glasses/merchant/register-shop", body, new ActionWithJson() {
                    @Override public void run(JSONObject data) { toast(data.optBoolean("success") ? "商家信息已提交。" : data.optString("error", "提交失败")); }
                });
            }
        }));
        page.addView(label("上传镜框样板", 20, Color.rgb(13, 34, 39), true));
        final EditText frameName = input("镜框名称", false);
        final EditText frameType = input("类型，例如 圆框/矩形框/猫眼框", false);
        final EditText framePrice = input("价格，例如 299", false);
        final EditText frameImage = input("图片 URL 或 data:image，可先留空", false);
        final EditText frameDesc = input("镜框说明", false);
        page.addView(form(frameName, frameType, framePrice, frameImage, frameDesc));
        page.addView(button("上传镜框", true, new Action() {
            @Override public void run() {
                if (frameName.getText().toString().trim().length() == 0) {
                    toast("请先填写镜框名称。");
                    return;
                }
                JSONObject body = new JSONObject();
                try {
                    body.put("uid", currentUid());
                    body.put("name", frameName.getText().toString());
                    body.put("type", frameType.getText().toString());
                    body.put("price", framePrice.getText().toString());
                    body.put("image", frameImage.getText().toString());
                    body.put("description", frameDesc.getText().toString());
                    body.put("material", "");
                    body.put("style", "");
                } catch (Exception ignored) {}
                post("/glasses/glasses/upload-shop", body, new ActionWithJson() {
                    @Override public void run(JSONObject data) {
                        toast(data.optBoolean("success") ? "镜框已上传到商家库。" : data.optString("error", "上传失败"));
                        fetchCatalog(false);
                    }
                });
            }
        }));
        page.addView(button("返回首页", false, new Action() { @Override public void run() { buildNativeHome(); } }));
        root.addView(page);
        setContentView(scroll);
    }

    private void showOrdersPage() {
        activeTab = "profile";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        LinearLayout page = card();
        page.addView(label("我的订单", 26, Color.rgb(13, 34, 39), true));
        page.addView(label("正在读取服务器订单...", 14, Color.rgb(83, 101, 107), false));
        root.addView(page);
        setContentView(scroll);
        final int token = pageToken;
        get("/glasses/orders-shop/" + currentUid(), new ActionWithJson() {
            @Override public void run(JSONObject data) {
                // 请求期间用户可能已切到别的页/退出，不能用旧结果覆盖当前界面
                if (token != pageToken || isFinishing() || isDestroyed()) return;
                ScrollView nextScroll = pageRoot();
                LinearLayout nextRoot = (LinearLayout) nextScroll.getChildAt(0);
                LinearLayout nextPage = card();
                nextPage.addView(label("我的订单", 26, Color.rgb(13, 34, 39), true));
                JSONArray orders = data.optJSONArray("orders");
                JSONArray localOrders = localOrders();
                if ((!data.optBoolean("success") || orders == null || orders.length() == 0) && localOrders.length() == 0) {
                    nextPage.addView(label(data.optBoolean("success") ? "暂无订单。先把心愿单发送给商家。" : "服务器暂不可用，且本机暂无订单草稿。", 14, Color.rgb(83, 101, 107), false));
                } else {
                    if (orders == null) orders = new JSONArray();
                    for (int i = 0; i < orders.length(); i++) {
                        JSONObject order = orders.optJSONObject(i);
                        if (order == null) continue;
                        nextPage.addView(label(order.optString("glassesName", "镜框订单") + "\n状态：" + order.optString("status", "pending") + "\n商家：" + order.optString("merchantName", "-") + "\n订单号：" + order.optString("id", "-"), 14, Color.rgb(37, 59, 65), false));
                    }
                    for (int i = 0; i < localOrders.length(); i++) {
                        JSONObject order = localOrders.optJSONObject(i);
                        if (order == null) continue;
                        JSONObject frame = order.optJSONObject("frame");
                        String frameName = frame == null ? "本机订单草稿" : frame.optString("name", "本机订单草稿");
                        nextPage.addView(label(frameName + "\n状态：本机草稿，等待服务器恢复后可重新发送\n订单号：" + order.optString("id", "-"), 14, Color.rgb(37, 59, 65), false));
                    }
                }
                nextPage.addView(button("返回工作台", false, new Action() { @Override public void run() { showWorkspacePage(); } }));
                nextRoot.addView(nextPage);
                setContentView(nextScroll);
            }
        });
    }

    private JSONArray localOrders() {
        try {
            return new JSONArray(getSharedPreferences("glasses_native", MODE_PRIVATE).getString("local_orders", "[]"));
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private void showConversationsPage() {
        activeTab = "chat";
        ScrollView scroll = pageRoot();
        LinearLayout root = (LinearLayout) scroll.getChildAt(0);
        LinearLayout page = card();
        page.addView(label("聊天会话", 26, Color.rgb(13, 34, 39), true));
        page.addView(label("正在读取服务器会话...", 14, Color.rgb(83, 101, 107), false));
        root.addView(page);
        setContentView(scroll);
        final int token = pageToken;
        get("/glasses/chat/conversations/" + currentUid(), new ActionWithJson() {
            @Override public void run(JSONObject data) {
                if (token != pageToken || isFinishing() || isDestroyed()) return;
                ScrollView nextScroll = pageRoot();
                LinearLayout nextRoot = (LinearLayout) nextScroll.getChildAt(0);
                LinearLayout nextPage = card();
                nextPage.addView(label("聊天会话", 26, Color.rgb(13, 34, 39), true));
                JSONArray conversations = data.optJSONArray("conversations");
                if (!data.optBoolean("success") || conversations == null || conversations.length() == 0) {
                    nextPage.addView(label(data.optBoolean("success") ? "暂无会话。先发送一条配镜问题。" : data.optString("error", "读取失败"), 14, Color.rgb(83, 101, 107), false));
                } else {
                    for (int i = 0; i < conversations.length(); i++) {
                        JSONObject item = conversations.optJSONObject(i);
                        if (item == null) continue;
                        nextPage.addView(label(item.optString("merchantName", "会话") + "\n" + item.optString("preview", item.optString("lastMessage", "点击网页端可继续完整对话")) + "\n" + item.optString("id", ""), 14, Color.rgb(37, 59, 65), false));
                    }
                }
                nextPage.addView(button("继续发送消息", true, new Action() { @Override public void run() { showChatPage(); } }));
                nextPage.addView(button("返回工作台", false, new Action() { @Override public void run() { showWorkspacePage(); } }));
                nextRoot.addView(nextPage);
                setContentView(nextScroll);
            }
        });
    }

    private void post(final String path, final JSONObject body, final ActionWithJson callback) {
        new Thread(() -> {
            JSONObject data = new JSONObject();
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(API + path).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(7000);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                    conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream()
                ));
                StringBuilder raw = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) raw.append(line);
                reader.close();
                data = new JSONObject(raw.toString());
            } catch (Exception error) {
                try { data.put("success", false).put("error", error.getMessage()); } catch (Exception ignored) {}
            }
            final JSONObject result = data;
            runOnUi(() -> callback.run(result));
        }).start();
    }

    private interface ActionWithJson { void run(JSONObject data); }

    private void get(final String path, final ActionWithJson callback) {
        new Thread(() -> {
            JSONObject data = new JSONObject();
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(API + path).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(7000);
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                    conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream()
                ));
                StringBuilder raw = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) raw.append(line);
                reader.close();
                data = new JSONObject(raw.toString());
            } catch (Exception error) {
                try { data.put("success", false).put("error", error.getMessage()); } catch (Exception ignored) {}
            }
            final JSONObject result = data;
            runOnUi(() -> callback.run(result));
        }).start();
    }

    private void fetchCatalog(final boolean notify) {
        if (catalogFrames.length() == 0) fillFallbackCatalog();
        final int token = pageToken;
        get("/glasses/catalog", new ActionWithJson() {
            @Override public void run(JSONObject data) {
                JSONArray frames = data.optJSONArray("frames");
                if (frames != null && frames.length() > 0) {
                    catalogFrames = frames;
                    if (notify) toast("已读取 " + frames.length() + " 款镜框。");
                } else {
                    if (catalogFrames.length() == 0) fillFallbackCatalog();
                    if (notify) toast("线上镜框库暂不可用，已使用内置示例。");
                }
                // 网络慢时第 3 步先用内置 8 款渲染，服务端返回后必须主动重绘，
                // 否则「共 8 款」和旧列表会一直挂着，看起来像加载失败。
                if ("fit".equals(activeTab) && fittingStep == 3 && token == pageToken
                        && !isFinishing() && !isDestroyed()) {
                    showCatalogPage(false);
                }
            }
        });
    }

    private void fillFallbackCatalog() {
        if (catalogFrames.length() > 0) return;
        try {
            // 断网/首启兜底直接用真实品牌款式（与线上目录同源）。原来内置的 8 款
            // "雾银圆框/雅黑矩形框"是虚构示例，连图片字段都没有，用户看到的就是
            // 没有商品图、只有文字的假款式。这里全部补齐 image/tryOnImage/thumb。
            String[][] rows = {
                {"molsion_ma6080_b20", "MA6080 B20 玫瑰金色/玳瑁", "陌森光学 MOLSION", "圆框", "399", "49", "20"},
                {"molsion_ma6080_b60", "MA6080 B60 透浅茶色", "陌森光学 MOLSION", "圆框", "399", "49", "20"},
                {"shanshan_pf_3599", "大嘴猴 PF3599 光学镜框", "闪闪", "青少年光学镜框", "0", "50", "18"},
                {"molsion_ma6080_b16", "MA6080 B16 月光银色", "陌森光学 MOLSION", "圆框", "399", "49", "20"},
                {"molsion_ma6080_b29", "MA6080 B29 玳瑁色", "陌森光学 MOLSION", "圆框", "399", "49", "20"},
                {"shanshan_pf_3600", "大嘴猴 PF3600 光学镜框", "闪闪", "青少年光学镜框", "0", "48", "18"},
                {"molsion_ma6080_b21", "MA6080 B21 玫瑰金色", "陌森光学 MOLSION", "圆框", "399", "49", "20"},
                {"molsion_ma6026_b15", "MA6026 B15 月光银色+亮黑眉", "陌森光学 MOLSION", "眉线框", "399", "51", "19"},
            };
            JSONArray frames = new JSONArray();
            for (String[] r : rows) {
                JSONObject frame = new JSONObject();
                frame.put("id", r[0]);
                frame.put("name", r[1]);
                frame.put("merchantName", r[2]);
                frame.put("merchantId", r[0].startsWith("shanshan") ? "shanshan" : "molsion");
                frame.put("type", r[3]);
                frame.put("price", Integer.parseInt(r[4]));
                frame.put("lensWidth", Integer.parseInt(r[5]));
                frame.put("bridgeSize", Integer.parseInt(r[6]));
                frame.put("description", "品牌目录款式，可先用于适配计算和心愿单沟通。");
                String original, tryOn;
                if (r[0].startsWith("shanshan")) {
                    String code = r[0].substring("shanshan_pf_".length());
                    original = "assets/merchants/shanshan/paul-frank/original/pf" + code + ".webp";
                    tryOn = "assets/merchants/shanshan/paul-frank/tryon/pf" + code + ".webp";
                } else {
                    original = "assets/merchants/molsion/original/" + r[0] + ".webp";
                    tryOn = "assets/merchants/molsion/tryon/" + r[0] + ".webp";
                }
                frame.put("image", original);
                frame.put("tryOnImage", tryOn);
                frame.put("thumb", "assets/thumbs/" + r[0] + ".webp");
                frame.put("source", "builtin-brand-fallback");
                frames.put(frame);
            }
            catalogFrames = frames;
        } catch (Exception ignored) {}
    }

    private void sendWishlistOrder() {
        if (wishlist.length() == 0) {
            toast("心愿单为空。");
            return;
        }
        JSONObject frame = wishlist.optJSONObject(0);
        JSONObject body = new JSONObject();
        try {
            body.put("uid", currentUid());
            body.put("username", currentUserName());
            body.put("frame", frame);
            body.put("analysis", savedAnalysis == null ? new JSONObject() : savedAnalysis);
            body.put("customParams", buildReportText());
            body.put("note", "来自 Android App 心愿单，共 " + wishlist.length() + " 款。");
        } catch (Exception ignored) {}
        post("/glasses/order/create-shop", body, new ActionWithJson() {
            @Override public void run(JSONObject data) {
                if (data.optBoolean("success")) {
                    toast("已发送给商家，订单号：" + data.optString("orderId", "-"));
                } else {
                    saveLocalOrder(frame);
                    toast("服务器暂不可用，已保存在本机订单草稿。");
                }
            }
        });
    }

    private void saveLocalOrder(JSONObject frame) {
        try {
            SharedPreferences prefs = getSharedPreferences("glasses_native", MODE_PRIVATE);
            JSONArray orders = new JSONArray(prefs.getString("local_orders", "[]"));
            JSONObject order = new JSONObject();
            order.put("id", "local_order_" + System.currentTimeMillis());
            order.put("status", "本机草稿");
            order.put("frame", frame == null ? new JSONObject() : frame);
            order.put("analysis", savedAnalysis == null ? new JSONObject() : savedAnalysis);
            order.put("createdAt", System.currentTimeMillis());
            orders.put(order);
            prefs.edit().putString("local_orders", orders.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void sendChatMessage(String text, String merchantId, String merchantName) {
        if (text.trim().length() == 0) {
            toast("消息不能为空。");
            return;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("uid", currentUid());
            body.put("role", "customer");
            body.put("text", text.trim());
            body.put("merchantId", merchantId);
            body.put("merchantName", merchantName);
            body.put("customerName", currentUserName());
            body.put("analysis", savedAnalysis == null ? new JSONObject() : savedAnalysis);
            if (wishlist.length() > 0) body.put("frame", wishlist.optJSONObject(0));
            JSONObject payload = new JSONObject();
            payload.put("report", buildReportText());
            payload.put("wishlistCount", wishlist.length());
            body.put("payload", payload);
        } catch (Exception ignored) {}
        post("/glasses/chat/message", body, new ActionWithJson() {
            @Override public void run(JSONObject data) {
                if (!data.optBoolean("success")) {
                    toast("发送失败：" + data.optString("error", "网络不可用"));
                    return;
                }
                JSONArray messages = data.optJSONArray("messages");
                String reply = "已发送。";
                if (messages != null && messages.length() > 0) {
                    JSONObject last = messages.optJSONObject(messages.length() - 1);
                    if (last != null) reply = last.optString("text", reply);
                }
                new AlertDialog.Builder(NativeMainActivity.this)
                    .setTitle("来自" + merchantName)
                    .setMessage(reply)
                    .setPositiveButton("继续聊天", (dialog, which) -> showChatPage())
                    .setNegativeButton("返回工作台", (dialog, which) -> showWorkspacePage())
                    .show();
            }
        });
    }

    private void saveSession(String type, Object payload) {
        JSONObject body = new JSONObject();
        try {
            body.put("uid", currentUid());
            body.put("type", type);
            body.put("payload", payload);
            body.put("createdAt", new java.util.Date().toString());
        } catch (Exception ignored) {}
        post("/glasses/session/save", body, new ActionWithJson() {
            @Override public void run(JSONObject data) {
                // 本地已经保存；服务器保存失败不打断用户流程。
            }
        });
    }

    private void loadLocalState() {
        SharedPreferences prefs = getSharedPreferences("glasses_native", MODE_PRIVATE);
        try {
            String user = prefs.getString("user", "");
            if (user != null && user.length() > 0) currentUser = new JSONObject(user);
            String analysis = prefs.getString("analysis", "");
            if (analysis != null && analysis.length() > 0) savedAnalysis = new JSONObject(analysis);
            String list = prefs.getString("wishlist", "");
            if (list != null && list.length() > 0) wishlist = new JSONArray(list);
            fittingStep = Math.max(1, Math.min(5, prefs.getInt("fittingStep", 1)));
            String frame = prefs.getString("selectedFrame", "");
            if (frame != null && frame.length() > 0) selectedFrame = new JSONObject(frame);
        } catch (Exception ignored) {}
    }

    private void saveLocalState() {
        SharedPreferences.Editor editor = getSharedPreferences("glasses_native", MODE_PRIVATE).edit();
        editor.putString("user", currentUser == null ? "" : currentUser.toString());
        editor.putString("analysis", savedAnalysis == null ? "" : savedAnalysis.toString());
        editor.putString("wishlist", wishlist == null ? "[]" : wishlist.toString());
        editor.putInt("fittingStep", fittingStep);
        editor.putString("selectedFrame", selectedFrame == null ? "" : selectedFrame.toString());
        editor.apply();
    }

    private String currentUid() {
        if (currentUser == null) return "temp_glasses_app";
        return currentUser.optString("uid", currentUser.optString("id", "temp_glasses_app"));
    }

    private String currentUserName() {
        if (currentUser == null) return "匿名用户";
        return currentUser.optString("nickname", currentUser.optString("username", "匿名用户"));
    }

    private int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (Exception error) {
            return fallback;
        }
    }

    private void addStepHeader(LinearLayout root, int step, String title, String subtitle) {
        TextView eyebrow = label("配镜进度  " + step + " / 5", 13, Color.rgb(224, 103, 76), true);
        eyebrow.setPadding(dp(2), 0, dp(2), dp(8));
        root.addView(eyebrow);
        root.addView(label(title, isCompactWidth() ? 24 : 28, Color.rgb(13, 34, 39), true));
        TextView description = label(subtitle, 14, Color.rgb(83, 101, 107), false);
        description.setPadding(0, dp(6), 0, dp(14));
        root.addView(description);

        LinearLayout progress = new LinearLayout(this);
        progress.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(6));
        progressParams.setMargins(0, 0, 0, dp(18));
        progress.setLayoutParams(progressParams);
        for (int i = 1; i <= 5; i++) {
            View segment = new View(this);
            segment.setBackground(rounded(i <= step ? Color.rgb(22, 119, 105) : Color.rgb(215, 226, 223),
                i <= step ? Color.rgb(22, 119, 105) : Color.rgb(215, 226, 223), 3));
            LinearLayout.LayoutParams segmentParams = new LinearLayout.LayoutParams(0, dp(6), 1f);
            segmentParams.setMargins(i == 1 ? 0 : dp(3), 0, 0, 0);
            progress.addView(segment, segmentParams);
        }
        root.addView(progress);
    }

    private View stepNavigation(final int step, String nextText, final Action nextAction) {
        boolean wide = screenDpWidth() >= 840;
        if (wide) {
            // 平板：保留页内底部操作条（无全局 tab 栏冲突）
            LinearLayout bar = new LinearLayout(this);
            bar.setOrientation(LinearLayout.HORIZONTAL);
            bar.setPadding(0, dp(4), 0, dp(8));
            String backText = step == 1 ? "返回首页" : "上一步";
            bar.addView(button(backText, false, new Action() { @Override public void run() {
                if (step == 1) buildNativeHome(); else showFittingStep(step - 1);
            } }), weight());
            bar.addView(button(nextText, true, nextAction), weight());
            return bar;
        }
        // 手机：只登记底栏规格，由 setContentView 现场新建（替代全局 tab 栏）。
        // 页内返回 0 高占位视图，保持所有调用点不变。
        fittingBarStep = step;
        fittingBarNextText = nextText;
        fittingBarNextAction = nextAction;
        View spacer = new View(this);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(0, 0));
        return spacer;
    }

    private ScrollView pageRoot() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(244, 248, 247));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pagePadding = isCompactWidth() ? 16 : 24;
        root.setPadding(dp(pagePadding), dp(20), dp(pagePadding), dp(28));
        scroll.addView(root, centeredContentParams());
        applyNavInset(root);
        return scroll;
    }

    private void shareText(String title, String text) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_SUBJECT, title);
        intent.putExtra(Intent.EXTRA_TEXT, text);
        try {
            startActivity(Intent.createChooser(intent, title));
        } catch (Exception e) {
            toast("当前设备没有可用的分享应用。");
        }
    }

    private void checkUpdate(final boolean manual) {
        final boolean marketInstall = isAppMarketInstall();
        if (updateLabel != null) updateLabel.setText(marketInstall ? "正在检查应用市场版本..." : "正在检查官网正式版本...");
        new Thread(() -> {
            // 默认是「检查失败」而不是「已是最新」：断网/超时/404 不能再误报成无需升级
            String message = "检查更新失败，请检查网络后重试。";
            JSONObject foundUpdate = null;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(BuildConfig.MANIFEST_URL).openConnection();
                conn.setConnectTimeout(4500);
                conn.setReadTimeout(5500);
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder raw = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) raw.append(line);
                reader.close();
                JSONArray apps = new JSONObject(raw.toString()).optJSONArray("apps");
                if (apps != null) {
                    message = "当前已是最新版本 " + BuildConfig.VERSION_NAME + "。";
                    for (int i = 0; i < apps.length(); i++) {
                        JSONObject item = apps.optJSONObject(i);
                        if (item == null) continue;
                        if (BuildConfig.APP_UPDATE_ID.equals(item.optString("id"))) {
                            if (item.optInt("build", 0) > BuildConfig.VERSION_CODE || item.optInt("versionCode", 0) > BuildConfig.VERSION_CODE) {
                                foundUpdate = item;
                                message = "发现新版本 " + item.optString("version", item.optString("versionName", ""))
                                    + (marketInstall ? "，可前往应用市场更新。" : "，可在 App 内校验并安装。");
                            } else {
                                message = "当前已是最新版本 " + BuildConfig.VERSION_NAME + "。";
                            }
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {}
            final String finalMessage = message;
            final JSONObject finalUpdate = foundUpdate;
            runOnUi(() -> {
                latestUpdate = finalUpdate;
                if (updateLabel != null) updateLabel.setText(finalMessage);
                if (manual) {
                    if (finalUpdate != null) showUpdateDialog(finalUpdate);
                    else toast(finalMessage);
                }
            });
        }).start();
    }

    private void installLatestUpdate() {
        if (latestUpdate != null) {
            showUpdateDialog(latestUpdate);
        } else {
            checkUpdate(true);
        }
    }

    private void showUpdateDialog(final JSONObject item) {
        String version = item.optString("version", item.optString("versionName", ""));
        int build = item.optInt("build", item.optInt("versionCode", 0));
        String fileName = item.optString("fileName", "ZhengZhengGlasses-Android-latest.apk");
        boolean marketInstall = isAppMarketInstall();
        AlertDialog.Builder dialog = new AlertDialog.Builder(this)
            .setTitle("发现新版本")
            .setMessage("版本：" + version + " · build " + build + (marketInstall
                ? "\n\n这是应用市场安装版本，将前往应用市场完成更新，不下载站外 APK。"
                : "\n文件：" + fileName + "\n\n这是官网安装版本，App 会下载正式 APK、校验 SHA-256，再交给系统安装程序。"))
            .setNegativeButton("稍后", null);
        if (marketInstall) dialog.setPositiveButton("前往应用市场", (d, which) -> openAppMarket());
        else dialog.setPositiveButton("下载并安装", (d, which) -> downloadAndInstall(item));
        dialog.show();
    }

    private boolean isAppMarketInstall() {
        if (BuildConfig.STORE_DISTRIBUTION) return true;
        try {
            String installer;
            if (Build.VERSION.SDK_INT >= 30) {
                installer = getPackageManager().getInstallSourceInfo(getPackageName()).getInstallingPackageName();
            } else {
                installer = getPackageManager().getInstallerPackageName(getPackageName());
            }
            if (installer == null) return false;
            String source = installer.toLowerCase();
            return source.contains("appmarket") || source.contains("vending")
                || source.contains("market") || source.contains("appstore");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void openAppMarket() {
        Uri marketUri = Uri.parse("market://details?id=" + getPackageName());
        Intent intent = new Intent(Intent.ACTION_VIEW, marketUri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (Exception firstError) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://appgallery.huawei.com/")));
            } catch (Exception secondError) {
                toast("未找到可用的应用市场，请稍后在系统应用市场搜索“铮铮眼镜”。");
            }
        }
    }

    private void openDownloadsPage() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://zhengzhengstudio.cn/downloads.html?search=ZhengZhengGlasses"));
        try {
            startActivity(intent);
        } catch (Exception error) {
            toast("无法打开下载中心：" + error.getMessage());
        }
    }

    private void downloadAndInstall(final JSONObject item) {
        if (updateLabel != null) updateLabel.setText("准备下载 APK...");
        new Thread(() -> {
            File apk = null;
            String error = null;
            try {
                String rawUrl = item.optString("latestUrl", item.optString("downloadURL", item.optString("url", item.optString("versionedUrl", ""))));
                if (rawUrl.startsWith("/")) rawUrl = "https://zhengzhengstudio.cn" + rawUrl;
                if (rawUrl.length() == 0) throw new IllegalStateException("下载地址为空");

                String fileName = item.optString("fileName", "ZhengZhengGlasses-Android-latest.apk").replace("/", "-");
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = getCacheDir();
                if (!dir.exists()) dir.mkdirs();
                apk = new File(dir, fileName);

                HttpURLConnection conn = (HttpURLConnection) new URL(rawUrl).openConnection();
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(30000);
                int code = conn.getResponseCode();
                if (code >= 400) throw new IllegalStateException("下载失败：" + code);

                InputStream input = conn.getInputStream();
                FileOutputStream output = new FileOutputStream(apk);
                byte[] buffer = new byte[16 * 1024];
                int len;
                long downloaded = 0;
                long total = conn.getContentLengthLong();
                // 原来每 16KB 就往主线程 post 一次（57MB 约 3500 次），会把消息队列淹没导致下载时界面卡顿。
                // 只在百分比变化时刷新。
                final long[] lastPercent = {-1};
                while ((len = input.read(buffer)) > 0) {
                    output.write(buffer, 0, len);
                    downloaded += len;
                    final long done = downloaded;
                    final long size = total;
                    long percent = size > 0 ? done * 100 / size : -1;
                    if (percent != lastPercent[0]) {
                        lastPercent[0] = percent;
                        runOnUi(() -> {
                            if (updateLabel != null) {
                                updateLabel.setText(size > 0 ? "正在下载 APK：" + (done * 100 / size) + "%" : "正在下载 APK：" + (done / 1024) + " KB");
                            }
                        });
                    }
                }
                output.close();
                input.close();

                String sha256 = item.optString("sha256", "");
                if (sha256.length() > 0 && !sha256.equalsIgnoreCase(sha256(apk))) {
                    throw new IllegalStateException("APK 校验失败，请重新下载。");
                }
            } catch (Exception e) {
                error = e.getMessage();
            }
            final File finalApk = apk;
            final String finalError = error;
            runOnUi(() -> {
                if (finalError != null) {
                    if (updateLabel != null) updateLabel.setText("更新失败：" + finalError);
                    toast("更新失败：" + finalError);
                } else {
                    if (updateLabel != null) updateLabel.setText("APK 下载完成，正在打开系统安装程序...");
                    openApkInstaller(finalApk);
                }
            });
        }).start();
    }

    private void openApkInstaller(File apk) {
        if (apk == null || !apk.exists()) {
            toast("APK 文件不存在，请重新下载。");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            pendingInstallApk = apk;
            new AlertDialog.Builder(this)
                .setTitle("允许安装更新")
                .setMessage("Android 需要你允许铮铮眼镜安装下载的 APK。打开系统设置后，请开启“允许来自此来源”，返回 App 会继续安装。")
                .setPositiveButton("打开设置", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    try {
                        startActivity(intent);
                    } catch (Exception e) {
                        toast("无法打开系统设置，请在「设置 → 应用 → 特殊权限 → 安装未知应用」里手动开启。");
                    }
                })
                .setNegativeButton("取消", null)
                .show();
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW);
        Uri apkUri = new Uri.Builder()
            .scheme("content")
            .authority(getPackageName() + ".apkprovider")
            .appendPath(apk.getName())
            .build();
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(intent);
        } catch (Exception error) {
            toast("无法打开系统安装程序：" + error.getMessage());
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream input = new java.io.FileInputStream(file);
        byte[] buffer = new byte[16 * 1024];
        int len;
        while ((len = input.read(buffer)) > 0) digest.update(buffer, 0, len);
        input.close();
        byte[] hash = digest.digest();
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private LinearLayout card() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        int padding = isCompactWidth() ? 14 : 18;
        view.setPadding(dp(padding), dp(padding), dp(padding), dp(padding));
        view.setBackground(rounded(Color.WHITE, Color.rgb(224, 233, 231), 12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(12));
        view.setLayoutParams(params);
        return view;
    }

    private LinearLayout bottomNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(dp(8), dp(7), dp(8), dp(7));
        nav.setBackground(rounded(Color.WHITE, Color.rgb(224, 233, 231), 0));
        nav.addView(navButton("首页", "home", new Action() { @Override public void run() { buildNativeHome(); } }), weightNav());
        nav.addView(navButton("配镜", "fit", new Action() { @Override public void run() { showFittingPage(); } }), weightNav());
        nav.addView(navButton("心愿", "wish", new Action() { @Override public void run() { showWishlistPage(); } }), weightNav());
        nav.addView(navButton("聊天", "chat", new Action() { @Override public void run() { showChatPage(); } }), weightNav());
        nav.addView(navButton("我的", "profile", new Action() { @Override public void run() { showWorkspacePage(); } }), weightNav());
        applyNavInset(nav);
        return nav;
    }

    /** 把系统导航栏（小米/华为底部操作栏）的高度作为底部内边距，避免内容被遮挡。
     *  在 Android 15 / 各厂商手势导航（内容延伸到系统栏下方）时 inset>0，旧系统保留空间时 inset=0。 */
    private void applyNavInset(final View target) {
        if (Build.VERSION.SDK_INT < 20) return;
        final int base = target.getPaddingBottom();
        target.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int inset = Build.VERSION.SDK_INT >= 29
                        ? insets.getInsets(WindowInsets.Type.navigationBars()).bottom
                        : insets.getSystemWindowInsetBottom();
                v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(), base + inset);
                return insets;
            }
        });
        target.requestApplyInsets();
    }

    /** 五步配镜专用常驻底部操作栏：步骤点 + 第 X/5 步 + 上一步/下一步。窄屏替代全局 tab 栏，始终可见且避开采统栏。 */
    private LinearLayout buildFittingBar(int step, String nextText, final Action nextAction) {
        final int s = step;
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setStroke(1, Color.rgb(224, 233, 231));
        bar.setBackground(bg);

        LinearLayout left = new LinearLayout(this);
        left.setOrientation(LinearLayout.HORIZONTAL);
        left.setGravity(Gravity.CENTER_VERTICAL);
        left.setPadding(0, 0, dp(8), 0);
        for (int i = 1; i <= 5; i++) {
            View dot = new View(this);
            int d = dp(i <= s ? 9 : 7);
            GradientDrawable dg = new GradientDrawable();
            dg.setColor(i <= s ? Color.rgb(22, 119, 105) : Color.rgb(211, 222, 219));
            dg.setCornerRadius(d / 2f);
            dot.setBackground(dg);
            LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(d, d);
            dotParams.setMargins(0, 0, dp(4), 0);
            left.addView(dot, dotParams);
        }
        TextView stepLabel = label("第 " + s + " / 5 步", 12, Color.rgb(83, 101, 107), true);
        left.addView(stepLabel);
        bar.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        String backText = s == 1 ? "返回首页" : "上一步";
        bar.addView(button(backText, false, new Action() {
            @Override public void run() { if (s == 1) buildNativeHome(); else showFittingStep(s - 1); }
        }), weightNav());
        bar.addView(button(nextText, true, nextAction), weightNav());
        applyNavInset(bar);
        return bar;
    }

    private LinearLayout sideNav() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.VERTICAL);
        nav.setPadding(dp(14), dp(20), dp(14), dp(20));
        nav.setBackgroundColor(Color.rgb(250, 252, 251));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.setPadding(dp(8), 0, dp(8), dp(22));
        brand.addView(label("铮铮眼镜", 20, Color.rgb(13, 34, 39), true));
        brand.addView(label("配镜工作台", 12, Color.rgb(83, 101, 107), false));
        nav.addView(brand);

        nav.addView(sideNavButton("首页", "home", new Action() { @Override public void run() { buildNativeHome(); } }));
        nav.addView(sideNavButton("镜框库", "shop", new Action() { @Override public void run() { showShopPage(); } }));
        nav.addView(sideNavButton("配镜", "fit", new Action() { @Override public void run() { showFittingPage(); } }));
        nav.addView(sideNavButton("心愿单", "wish", new Action() { @Override public void run() { showWishlistPage(); } }));
        nav.addView(sideNavButton("聊天", "chat", new Action() { @Override public void run() { showChatPage(); } }));
        nav.addView(sideNavButton("我的档案", "profile", new Action() { @Override public void run() { showWorkspacePage(); } }));

        TextView sync = label(currentUser == null ? "本机模式" : "已连接网页版数据", 12, Color.rgb(83, 101, 107), false);
        LinearLayout.LayoutParams syncParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        sync.setGravity(Gravity.BOTTOM);
        sync.setPadding(dp(8), dp(12), dp(8), dp(8));
        nav.addView(sync, syncParams);
        return nav;
    }

    private Button sideNavButton(String text, String tab, final Action action) {
        Button button = navButton(text, tab, action);
        button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
        params.setMargins(0, 0, 0, dp(6));
        button.setLayoutParams(params);
        return button;
    }

    private Button navButton(String text, String tab, final Action action) {
        boolean selected = tab.equals(activeTab);
        Button button = button(text, selected, action);
        button.setTextSize(12);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(2), 0, dp(2), 0);
        button.setSingleLine(true);
        return button;
    }

    private LinearLayout.LayoutParams weightNav() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(44), 1);
        params.setMargins(dp(3), 0, dp(3), 0);
        return params;
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

    private Button button(String text, boolean primary, final Action action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(isCompactWidth() ? 13 : 14);
        button.setSingleLine(true);
        button.setMaxLines(1);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(isCompactWidth() ? 6 : 10), 0, dp(isCompactWidth() ? 6 : 10), 0);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(primary ? Color.WHITE : Color.rgb(12, 101, 89));
        button.setBackground(rounded(primary ? Color.rgb(22, 119, 105) : Color.rgb(238, 247, 245), primary ? Color.rgb(22, 119, 105) : Color.rgb(210, 227, 223), 10));
        button.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { action.run(); } });
        return button;
    }

    private GradientDrawable rounded(int fill, int stroke, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(radiusDp));
        shape.setStroke(dp(1), stroke);
        return shape;
    }

    private EditText input(String hint, boolean password) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setTextSize(15);
        input.setTextColor(Color.rgb(13, 34, 39));
        input.setHintTextColor(Color.rgb(120, 139, 144));
        input.setPadding(dp(12), 0, dp(12), 0);
        input.setBackground(rounded(Color.rgb(248, 252, 251), Color.rgb(207, 224, 221), 10));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(48)
        );
        params.setMargins(0, dp(8), 0, 0);
        input.setLayoutParams(params);
        if (password) input.setInputType(0x00000081);
        return input;
    }

    private LinearLayout form(EditText... inputs) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        for (EditText input : inputs) form.addView(input);
        return form;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
        params.setMargins(dp(3), 0, dp(3), 0);
        return params;
    }

    private ScrollView.LayoutParams centeredContentParams() {
        int available = screenDpWidth() >= 840 ? screenDpWidth() - 216 : screenDpWidth();
        int contentWidth = Math.min(available, 920);
        ScrollView.LayoutParams params = new ScrollView.LayoutParams(
            dp(contentWidth),
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.gravity = Gravity.CENTER_HORIZONTAL;
        return params;
    }

    private boolean isCompactWidth() {
        return screenDpWidth() < 600;
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int screenDpWidth() {
        return Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
    }
}
