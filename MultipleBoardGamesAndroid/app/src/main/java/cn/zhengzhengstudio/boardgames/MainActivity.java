package cn.zhengzhengstudio.boardgames;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class MainActivity extends Activity {
    private static final String BOARDGAMES_WS = "wss://zhengzhengstudio.cn/api/boardgames/ws";
    private static final int VOICE_PERMISSION_REQUEST = 4107;
    private static int COLOR_BG_TOP = Color.rgb(18, 23, 21);
    private static int COLOR_BG_BOTTOM = Color.rgb(22, 28, 25);
    private static int COLOR_SURFACE = Color.rgb(28, 34, 31);
    private static int COLOR_SURFACE_RAISED = Color.rgb(39, 47, 43);
    private static int COLOR_SURFACE_SOFT = Color.rgb(33, 40, 36);
    private static int COLOR_LINE = Color.rgb(69, 80, 74);
    private static int COLOR_TEXT = Color.rgb(247, 246, 241);
    private static int COLOR_MUTED = Color.rgb(193, 197, 190);
    private static int COLOR_SOFT = Color.rgb(142, 151, 145);
    private static final int COLOR_ACCENT = Color.rgb(40, 105, 75);
    private static final int COLOR_ACCENT_DARK = Color.rgb(30, 82, 58);
    private static final int COLOR_CYAN = Color.rgb(71, 133, 101);
    private static final int COLOR_GOLD = Color.rgb(181, 139, 69);
    private static final int COLOR_LACQUER = Color.rgb(164, 69, 58);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinkedHashMap<String, String> gameTypes = new LinkedHashMap<>();

    private EditText roomField;
    private EditText chatInput;
    private EditText gameSearchInput;
    private GridLayout gameLibraryGrid;
    private TextView gameLibraryCount;
    private boolean gameLibraryCompact;
    private Button passportButton;
    private TextView statusText;
    private TextView chatLog;
    private BoardView boardView;
    private AlertDialog resetVoteDialog;

    private RealtimeTransport transport;
    private LocalRoomServer localServer;
    private String playerName;
    private JSONObject passportUser;
    private String localStone = "black";
    private String currentStone = "black";
    private String socketId = "";
    private boolean myTurn = true;
    private boolean gameFinished = false;
    private boolean fallbackMode = false;
    private boolean localAiMode = false;
    private boolean challengeMode = false;
    private boolean voiceJoined = false;
    private final NativeVoiceEngine voiceEngine = new NativeVoiceEngine();
    private boolean doubleTapToPlace = true;
    private boolean sessionStarted = false;
    private String selectedGameTypeValue = "native-gobang";
    private String currentPage = "lobby";
    private String selectedGameCategory = "全部";
    private String connectionStatus = "连接状态：未连接";
    private String activeChallengeId = "";
    private int aiDifficulty = 2;
    private String studyModeSelection = "puzzle";
    private String studySideSelection = "first";
    private int puzzleIndex = -1;
    private BoardAnalysis.Puzzle activePuzzle;
    private BoardAnalysis.Position puzzleStartPosition;
    private boolean boardEditorMode = false;
    private String boardEditorPiece = "1";
    private final ArrayDeque<BoardAnalysis.Position> boardEditorHistory = new ArrayDeque<>();
    private BoardAnalysis.Position boardEditorOrigin;
    private int localTrainingSamples = 0;
    private String themeMode = "system";
    private long updateDownloadId = -1L;
    private boolean downloadReceiverRegistered = false;

    private final BroadcastReceiver apkDownloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id != updateDownloadId) return;
            openDownloadedApk(id);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DIRECT_UPDATES) {
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(apkDownloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(apkDownloadReceiver, filter);
            }
            downloadReceiverRegistered = true;
        }
        loadPassportUser();
        themeMode = getPreferences(MODE_PRIVATE).getString("theme_mode", "system");
        applyThemePalette();
        doubleTapToPlace = getPreferences(MODE_PRIVATE).getBoolean("double_tap_to_place", true);
        seedGames();
        buildLayout();
        handleAppLink(getIntent());
        if (BuildConfig.DIRECT_UPDATES) checkAppUpdates(false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAppLink(intent);
    }

    private void seedGames() {
        gameTypes.put("五子棋", "native-gobang");
        gameTypes.put("黑白棋", "native-reversi");
        gameTypes.put("井字棋", "native-tictactoe");
        gameTypes.put("围棋", "go");
        gameTypes.put("象棋", "chinese-chess");
        gameTypes.put("中国跳棋", "checkers");
        gameTypes.put("陆战棋", "junqi");
        gameTypes.put("飞行棋", "ludo");
        gameTypes.put("拉密", "rummy");
        gameTypes.put("大富翁", "monopoly");
        gameTypes.put("斗地主", "landlord");
        gameTypes.put("麻将", "mahjong");
        gameTypes.put("谁是卧底", "spy");
        gameTypes.put("狼人杀", "werewolf");
        gameTypes.put("扑克牌", "poker");
        gameTypes.put("扫雷", "minesweeper");
    }

    private void applyThemePalette() {
        boolean systemDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        boolean dark = "dark".equals(themeMode) || ("system".equals(themeMode) && systemDark);
        if (dark) {
            COLOR_BG_TOP = Color.rgb(18, 23, 21);
            COLOR_BG_BOTTOM = Color.rgb(22, 28, 25);
            COLOR_SURFACE = Color.rgb(28, 34, 31);
            COLOR_SURFACE_RAISED = Color.rgb(39, 47, 43);
            COLOR_SURFACE_SOFT = Color.rgb(33, 40, 36);
            COLOR_LINE = Color.rgb(69, 80, 74);
            COLOR_TEXT = Color.rgb(247, 246, 241);
            COLOR_MUTED = Color.rgb(193, 197, 190);
            COLOR_SOFT = Color.rgb(142, 151, 145);
        } else {
            COLOR_BG_TOP = Color.rgb(245, 244, 239);
            COLOR_BG_BOTTOM = Color.rgb(237, 237, 231);
            COLOR_SURFACE = Color.rgb(255, 255, 255);
            COLOR_SURFACE_RAISED = Color.rgb(232, 235, 229);
            COLOR_SURFACE_SOFT = Color.rgb(248, 247, 243);
            COLOR_LINE = Color.rgb(207, 211, 204);
            COLOR_TEXT = Color.rgb(25, 34, 30);
            COLOR_MUTED = Color.rgb(79, 91, 84);
            COLOR_SOFT = Color.rgb(112, 124, 117);
        }
        getWindow().setStatusBarColor(COLOR_SURFACE);
        getWindow().setNavigationBarColor(COLOR_SURFACE);
        int systemUi = dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26 && !dark) systemUi |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(systemUi);
    }

    private void buildLayout() {
        int widthDp = screenWidthDp();
        int heightDp = screenHeightDp();
        float ratio = widthDp / (float) Math.max(1, heightDp);
        boolean bookFold = widthDp >= 700 && widthDp < 980 && ratio >= 0.9f && ratio <= 1.45f;
        boolean wideFold = widthDp >= 900 && ratio > 1.45f;
        boolean streamline = ratio >= 1.8f && heightDp <= 620;
        boolean wide = widthDp >= 720;
        boolean compact = widthDp < 420 || streamline;
        boolean splitGameArea = bookFold || wideFold;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(new TabletopBackdrop(COLOR_BG_TOP, COLOR_BG_BOTTOM, COLOR_LINE));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        root.requestApplyInsets();
        root.addView(appBar(compact, sessionStarted),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(compact ? 70 : 78)));

        boardView = new BoardView(this);
        boardView.setDoubleTapToPlace(doubleTapToPlace);
        boardView.listener = (row, col) -> sendMove(row, col);
        if (!sessionStarted) {
            ScrollView pageScroll = new ScrollView(this);
            pageScroll.setFillViewport(true);
            LinearLayout page = new LinearLayout(this);
            page.setOrientation(LinearLayout.VERTICAL);
            int pagePadding = compact ? 14 : (wide ? 24 : 18);
            page.setPadding(dp(pagePadding), dp(10), dp(pagePadding), dp(18));
            if ("games".equals(currentPage)) {
                page.addView(gamesPage(compact, wide, streamline),
                        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } else if ("study".equals(currentPage)) {
                page.addView(studyPage(compact, wide),
                        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } else if ("profile".equals(currentPage)) {
                page.addView(profilePage(compact, wide),
                        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } else {
                page.addView(homePage(compact, wide),
                        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
            pageScroll.addView(page);
            root.addView(pageScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            root.addView(pageTabs(compact),
                    new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(compact ? 58 : 64)));
            setContentView(root);
            return;
        }

        int gamePadding = compact ? 10 : 18;
        LinearLayout gameContent = new LinearLayout(this);
        gameContent.setOrientation(LinearLayout.VERTICAL);
        gameContent.setPadding(dp(gamePadding), dp(8), dp(gamePadding), dp(12));
        gameContent.setBackgroundColor(COLOR_BG_TOP);
        gameContent.addView(sessionActions(compact),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(compact ? 50 : 56)));

        boardView.setBackground(roundedBg(COLOR_SURFACE, COLOR_LINE, 8));
        LinearLayout chatPanel = panel();
        LinearLayout chatHead = row();
        chatHead.addView(label("局内消息", compact ? 14 : 15, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(0, dp(28), 1));
        TextView voice = label(voiceJoined ? "语音已加入" : "语音未加入", 12,
                voiceJoined ? COLOR_ACCENT : COLOR_SOFT, true);
        voice.setGravity(android.view.Gravity.END | android.view.Gravity.CENTER_VERTICAL);
        voice.setOnClickListener(v -> toggleVoiceRoom());
        chatHead.addView(voice, new LinearLayout.LayoutParams(dp(100), dp(28)));
        chatPanel.addView(chatHead);
        ScrollView scroll = new ScrollView(this);
        chatLog = label("系统：已就绪\n", compact ? 13 : 14, COLOR_MUTED, false);
        chatLog.setPadding(dp(2), dp(4), dp(2), dp(4));
        scroll.addView(chatLog);
        chatPanel.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout chatRow = row();
        chatInput = edit("局内聊天");
        chatInput.setSingleLine(true);
        chatRow.addView(chatInput, new LinearLayout.LayoutParams(0, dp(compact ? 46 : 52), 1));
        Button send = accentButton("发送");
        send.setOnClickListener(v -> sendChat());
        chatRow.addView(send, new LinearLayout.LayoutParams(dp(compact ? 86 : 102), dp(compact ? 46 : 52)));
        chatPanel.addView(chatRow);
        if (splitGameArea) {
            LinearLayout gameBody = row();
            gameBody.setGravity(android.view.Gravity.FILL);
            gameBody.addView(boardView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, bookFold ? 1.45f : 1.72f));
            LinearLayout.LayoutParams sideParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, bookFold ? 0.92f : 0.72f);
            sideParams.setMargins(dp(10), 0, 0, 0);
            gameBody.addView(chatPanel, sideParams);
            gameContent.addView(gameBody, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        } else {
            LinearLayout.LayoutParams boardParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, compact ? 1.65f : 1.8f);
            boardParams.setMargins(0, dp(8), 0, dp(10));
            gameContent.addView(boardView, boardParams);
            gameContent.addView(chatPanel, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, 0, compact ? 0.65f : 0.72f));
        }
        root.addView(gameContent, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private LinearLayout pageTabs(boolean compact) {
        LinearLayout tabs = row();
        tabs.setPadding(dp(10), dp(5), dp(10), dp(5));
        tabs.setBackgroundColor(COLOR_SURFACE);
        tabs.addView(tabButton("大厅", "lobby", android.R.drawable.ic_menu_view, compact),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        tabs.addView(tabButton("游戏", "games", android.R.drawable.ic_menu_agenda, compact),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        tabs.addView(tabButton("我的", "profile", android.R.drawable.ic_menu_myplaces, compact),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        return tabs;
    }

    private Button tabButton(String title, String page, int icon, boolean compact) {
        Button tab = button(title);
        boolean selected = page.equals(currentPage);
        tab.setTextSize(compact ? 11 : 12);
        tab.setTextColor(selected ? COLOR_ACCENT : COLOR_MUTED);
        tab.setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0);
        tab.setCompoundDrawablePadding(dp(2));
        tab.setBackground(roundedBg(selected ? COLOR_SURFACE_SOFT : Color.TRANSPARENT,
                Color.TRANSPARENT, 8));
        tab.setOnClickListener(v -> {
            currentPage = page;
            buildLayout();
        });
        return tab;
    }

    private LinearLayout appBar(boolean compact, boolean inGame) {
        LinearLayout bar = row();
        boolean studyPage = "study".equals(currentPage);
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(compact ? 14 : 20), dp(8), dp(compact ? 14 : 20), dp(6));
        bar.setBackgroundColor(COLOR_SURFACE);
        if (inGame || studyPage) {
            Button back = subtleButton("返回");
            back.setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_media_previous, 0, 0, 0);
            back.setOnClickListener(v -> {
                if (inGame) {
                    closeTransport();
                    sessionStarted = false;
                }
                currentPage = "lobby";
                buildLayout();
            });
            bar.addView(back, new LinearLayout.LayoutParams(dp(compact ? 78 : 92), dp(44)));
        }
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        String titleText = inGame ? titleForGameType(selectedGameTypeValue)
                : studyPage ? "棋局研习" : "铮铮桌游中心";
        TextView title = label(titleText, compact ? 20 : 23, COLOR_TEXT, true);
        statusText = label(connectionStatus, compact ? 11 : 12, COLOR_MUTED, false);
        titles.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));
        titles.addView(statusText, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(20)));
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, dp(52), 1);
        if (inGame || studyPage) titleParams.setMargins(dp(10), 0, dp(8), 0);
        bar.addView(titles, titleParams);
        if (inGame) {
            Button more = subtleButton("更多");
            more.setOnClickListener(v -> showMoreActionsDialog());
            bar.addView(more, new LinearLayout.LayoutParams(dp(compact ? 72 : 88), dp(44)));
        } else if (!studyPage) {
            passportButton = subtleButton(passportUser == null ? "登录" : playerName);
            passportButton.setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_myplaces, 0, 0, 0);
            passportButton.setCompoundDrawablePadding(dp(4));
            passportButton.setOnClickListener(v -> showPassportLoginDialog());
            bar.addView(passportButton, new LinearLayout.LayoutParams(dp(compact ? 104 : 142), dp(44)));
        }
        return bar;
    }

    private LinearLayout sessionActions(boolean compact) {
        roomField = edit("");
        roomField.setText(getPreferences(MODE_PRIVATE).getString("room", ""));
        LinearLayout actions = row();
        actions.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView room = label((localAiMode ? "本地练习" : "房间 " + roomField.getText())
                        + " · " + playersForGame(selectedGameTypeValue),
                compact ? 12 : 13, COLOR_MUTED, true);
        actions.addView(room, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        if (supportsBoardStudy()) {
            Button study = subtleButton(boardEditorMode ? "结束摆盘" : "研习");
            study.setOnClickListener(v -> showBoardStudyDialog());
            actions.addView(study, new LinearLayout.LayoutParams(dp(compact ? 78 : 90), dp(compact ? 42 : 46)));
        }
        Button voice = subtleButton(voiceJoined ? "退出语音" : "加入语音");
        voice.setOnClickListener(v -> toggleVoiceRoom());
        actions.addView(voice, new LinearLayout.LayoutParams(dp(compact ? 94 : 110), dp(compact ? 42 : 46)));
        Button restart = subtleButton("重开");
        restart.setOnClickListener(v -> requestReset());
        actions.addView(restart, new LinearLayout.LayoutParams(dp(compact ? 72 : 84), dp(compact ? 42 : 46)));
        return actions;
    }

    private LinearLayout homePage(boolean compact, boolean wide) {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);

        TextView heading = label(passportUser == null ? "一起开一局" : playerName + "，一起开一局",
                compact ? 21 : 24, COLOR_TEXT, true);
        page.addView(heading, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));
        TextView intro = label("好友房、快速匹配和本地练习，都从这里开始。",
                compact ? 12 : 13, COLOR_MUTED, false);
        page.addView(intro, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));

        LinearLayout joinCard = panel();
        LinearLayout joinHead = row();
        joinHead.addView(label("加入好友对局", compact ? 16 : 18, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(0, dp(30), 1));
        TextView selected = label(titleForGameType(selectedGameTypeValue) + " · " + playersForGame(selectedGameTypeValue),
                compact ? 12 : 13, COLOR_ACCENT, true);
        selected.setGravity(android.view.Gravity.END | android.view.Gravity.CENTER_VERTICAL);
        joinHead.addView(selected, new LinearLayout.LayoutParams(dp(compact ? 138 : 180), dp(30)));
        joinCard.addView(joinHead);
        TextView joinHint = label("输入六位房间号，所有端都会进入同一局。",
                12, COLOR_MUTED, false);
        joinCard.addView(joinHint, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));
        LinearLayout roomRow = row();
        roomField = edit("六位房间号");
        roomField.setInputType(InputType.TYPE_CLASS_NUMBER);
        roomField.setText(getPreferences(MODE_PRIVATE).getString("room", ""));
        roomRow.addView(roomField, new LinearLayout.LayoutParams(0, dp(compact ? 48 : 52), 1));
        Button join = accentButton("加入");
        join.setOnClickListener(v -> connectCloud());
        roomRow.addView(join, new LinearLayout.LayoutParams(dp(compact ? 92 : 108), dp(compact ? 48 : 52)));
        joinCard.addView(roomRow);
        LinearLayout playActions = row();
        Button match = subtleButton("快速匹配");
        match.setOnClickListener(v -> quickMatch());
        playActions.addView(match, new LinearLayout.LayoutParams(0, dp(46), 1));
        Button publicRooms = subtleButton("公开房间");
        publicRooms.setOnClickListener(v -> showPublicRooms());
        playActions.addView(publicRooms, new LinearLayout.LayoutParams(0, dp(46), 1));
        Button local = subtleButton("本地练习");
        local.setOnClickListener(v -> startLocalAiMode());
        playActions.addView(local, new LinearLayout.LayoutParams(0, dp(46), 1));
        joinCard.addView(playActions);
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.setMargins(0, dp(8), 0, dp(18));
        page.addView(joinCard, cardParams);

        LinearLayout studyBand = row();
        studyBand.setGravity(android.view.Gravity.CENTER_VERTICAL);
        studyBand.setPadding(dp(16), dp(12), dp(12), dp(12));
        studyBand.setBackground(roundedBg(COLOR_SURFACE_SOFT, COLOR_CYAN, 8));
        LinearLayout studyCopy = new LinearLayout(this);
        studyCopy.setOrientation(LinearLayout.VERTICAL);
        studyCopy.addView(label("棋局研习", 18, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));
        studyCopy.addView(label("五子棋、围棋、象棋 · 残局与分析", 12, COLOR_MUTED, false),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)));
        studyBand.addView(studyCopy, new LinearLayout.LayoutParams(0, dp(54), 1));
        Button enterStudy = subtleButton("进入研习");
        enterStudy.setOnClickListener(v -> {
            if (!supportsBoardStudy()) selectedGameTypeValue = "native-gobang";
            studyModeSelection = "puzzle";
            currentPage = "study";
            buildLayout();
        });
        studyBand.addView(enterStudy, new LinearLayout.LayoutParams(dp(compact ? 108 : 126), dp(44)));
        LinearLayout.LayoutParams studyBandParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        studyBandParams.setMargins(0, 0, 0, dp(18));
        page.addView(studyBand, studyBandParams);

        page.addView(sectionHeader("常玩游戏", "查看全部", () -> {
            currentPage = "games";
            buildLayout();
        }), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));
        page.addView(gameRail(compact), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(compact ? 98 : 108)));

        LinearLayout discovery = row();
        LinearLayout.LayoutParams discoveryLeft = new LinearLayout.LayoutParams(0, dp(compact ? 82 : 90), 1);
        discoveryLeft.setMargins(0, 0, dp(5), 0);
        discovery.addView(discoveryCard("排行榜", "看看本周高手", this::showLeaderboard), discoveryLeft);
        LinearLayout.LayoutParams discoveryRight = new LinearLayout.LayoutParams(0, dp(compact ? 82 : 90), 1);
        discoveryRight.setMargins(dp(5), 0, 0, 0);
        discovery.addView(discoveryCard("闯关练习", "按难度练一局", this::startChallengeMode), discoveryRight);
        page.addView(sectionHeader("发现", "", null),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)));
        page.addView(discovery);
        return page;
    }

    private LinearLayout studyPage(boolean compact, boolean wide) {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(label("棋局研习", compact ? 22 : 25, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));
        page.addView(label("先选棋种，再选残局、自建局面、AI 对弈或分析。",
                        13, COLOR_MUTED, false),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)));

        LinearLayout games = row();
        String[][] studyGames = {{"五子棋", "native-gobang"}, {"围棋", "go"}, {"中国象棋", "chinese-chess"}};
        for (String[] game : studyGames) {
            Button choice = button(game[0]);
            boolean selected = game[1].equals(selectedGameTypeValue);
            choice.setTextColor(selected ? Color.WHITE : COLOR_TEXT);
            choice.setBackground(roundedBg(selected ? COLOR_ACCENT : COLOR_SURFACE,
                    selected ? COLOR_CYAN : COLOR_LINE, 8));
            choice.setOnClickListener(v -> {
                selectedGameTypeValue = game[1];
                studyModeSelection = "puzzle";
                resetRound();
                buildLayout();
            });
            LinearLayout.LayoutParams choiceParams = new LinearLayout.LayoutParams(0, dp(compact ? 52 : 58), 1);
            choiceParams.setMargins(dp(3), 0, dp(3), 0);
            games.addView(choice, choiceParams);
        }
        page.addView(games, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(compact ? 58 : 64)));

        LinearLayout settings = panel();
        settings.addView(label(titleForGameType(selectedGameTypeValue) + "研习方式", 18, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)));
        LinearLayout modes = row();
        String[][] modeItems = studyModeItems();
        for (String[] mode : modeItems) {
            Button modeButton = button(mode[1]);
            boolean selected = mode[0].equals(studyModeSelection);
            modeButton.setTextSize(compact ? 11 : 12);
            modeButton.setTextColor(selected ? Color.WHITE : COLOR_TEXT);
            modeButton.setBackground(roundedBg(selected ? COLOR_ACCENT : COLOR_SURFACE_RAISED,
                    selected ? COLOR_CYAN : COLOR_LINE, 8));
            modeButton.setOnClickListener(v -> {
                studyModeSelection = mode[0];
                buildLayout();
            });
            LinearLayout.LayoutParams modeParams = new LinearLayout.LayoutParams(0, dp(46), 1);
            modeParams.setMargins(dp(2), 0, dp(2), 0);
            modes.addView(modeButton, modeParams);
        }
        settings.addView(modes, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        if ("puzzle".equals(studyModeSelection)) {
            settings.addView(label("残局题会按题面指定执棋方和先后手。", 12, COLOR_MUTED, false),
                    new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)));
        } else {
            settings.addView(label("执棋顺序", 15, COLOR_TEXT, true),
                    new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));
            LinearLayout sides = row();
            String first = "chinese-chess".equals(selectedGameTypeValue) ? "我执红先手" : "我执黑先手";
            String second = "chinese-chess".equals(selectedGameTypeValue) ? "我执黑后手" : "我执白后手";
            for (String[] side : new String[][]{{"first", first}, {"second", second}}) {
                Button sideButton = button(side[1]);
                boolean selected = side[0].equals(studySideSelection);
                sideButton.setTextColor(selected ? Color.WHITE : COLOR_TEXT);
                sideButton.setBackground(roundedBg(selected ? COLOR_ACCENT : COLOR_SURFACE_RAISED,
                        selected ? COLOR_CYAN : COLOR_LINE, 8));
                sideButton.setOnClickListener(v -> {
                    studySideSelection = side[0];
                    buildLayout();
                });
                LinearLayout.LayoutParams sideParams = new LinearLayout.LayoutParams(0, dp(44), 1);
                sideParams.setMargins(dp(3), 0, dp(3), 0);
                sides.addView(sideButton, sideParams);
            }
            settings.addView(sides, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        }

        settings.addView(label("AI 难度 · " + aiDifficultyName(), 15, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(32)));
        Button difficulty = subtleButton("调整 AI 难度");
        difficulty.setOnClickListener(v -> showAiDifficultyDialog());
        settings.addView(difficulty, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));
        Button start = accentButton("开始研习");
        start.setOnClickListener(v -> startStudySelection());
        LinearLayout.LayoutParams startParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        startParams.setMargins(0, dp(12), 0, 0);
        settings.addView(start, startParams);
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        settingsParams.setMargins(0, dp(14), 0, 0);
        page.addView(settings, settingsParams);
        return page;
    }

    private String[][] studyModeItems() {
        if ("go".equals(selectedGameTypeValue)) {
            return new String[][]{{"puzzle", "死活题"}, {"editor", "自建局面"},
                    {"play", "AI 对弈"}, {"analysis", "形势分析"}};
        }
        if ("chinese-chess".equals(selectedGameTypeValue)) {
            return new String[][]{{"puzzle", "残局闯关"}, {"editor", "自建残局"},
                    {"play", "AI 对弈"}, {"analysis", "局面分析"}};
        }
        return new String[][]{{"puzzle", "残局闯关"}, {"editor", "自建局面"},
                {"play", "AI 对弈"}, {"analysis", "胜率分析"}};
    }

    private void startStudySelection() {
        String mode = studyModeSelection;
        startLocalAiMode();
        if ("puzzle".equals(mode)) {
            loadBuiltInPuzzle();
            return;
        }
        if ("editor".equals(mode)) {
            toggleBoardEditor();
            return;
        }
        if ("analysis".equals(mode)) {
            analyzeCurrentBoard();
            return;
        }
        localStone = "second".equals(studySideSelection) ? "white" : "black";
        currentStone = "black";
        myTurn = localStone.equals(currentStone);
        if (!myTurn) main.postDelayed(this::playAiMove, 280);
    }

    private LinearLayout sectionHeader(String title, String action, Runnable onAction) {
        LinearLayout row = row();
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.addView(label(title, 17, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        if (action != null && !action.isEmpty()) {
            TextView link = label(action, 12, COLOR_ACCENT, true);
            link.setGravity(android.view.Gravity.END | android.view.Gravity.CENTER_VERTICAL);
            link.setPadding(dp(12), 0, 0, 0);
            link.setOnClickListener(v -> onAction.run());
            row.addView(link, new LinearLayout.LayoutParams(dp(90), ViewGroup.LayoutParams.MATCH_PARENT));
        }
        return row;
    }

    private HorizontalScrollView gameRail(boolean compact) {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout rail = row();
        int shown = 0;
        for (Map.Entry<String, String> entry : gameTypes.entrySet()) {
            if (shown++ >= 6) break;
            LinearLayout card = quickGameCard(entry.getKey(), entry.getValue(), compact);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(compact ? 126 : 142), ViewGroup.LayoutParams.MATCH_PARENT);
            params.setMargins(0, 0, dp(10), 0);
            rail.addView(card, params);
        }
        scroll.addView(rail);
        return scroll;
    }

    private LinearLayout quickGameCard(String title, String gameType, boolean compact) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(9), dp(12), dp(10));
        card.setBackground(roundedBg(COLOR_SURFACE, COLOR_LINE, 8));
        View marker = new View(this);
        marker.setBackground(roundedBg(gameAccent(gameType), Color.TRANSPARENT, 3));
        card.addView(marker, new LinearLayout.LayoutParams(dp(34), dp(5)));
        card.addView(new View(this), new LinearLayout.LayoutParams(1, 0, 1));
        TextView name = label(title, compact ? 15 : 16, COLOR_TEXT, true);
        TextView meta = label(playersForGame(gameType) + " · " + categoryForGame(gameType), 11,
                COLOR_MUTED, false);
        card.addView(name, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(26)));
        card.addView(meta, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(20)));
        card.setOnClickListener(v -> {
            selectedGameTypeValue = gameType;
            resetRound();
            buildLayout();
        });
        return card;
    }

    private LinearLayout discoveryCard(String title, String subtitle, Runnable action) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(android.view.Gravity.CENTER_VERTICAL);
        card.setPadding(dp(14), dp(10), dp(14), dp(10));
        card.setBackground(roundedBg(COLOR_SURFACE_SOFT, Color.TRANSPARENT, 8));
        card.addView(label(title, 15, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(26)));
        card.addView(label(subtitle, 12, COLOR_MUTED, false),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)));
        card.setOnClickListener(v -> action.run());
        return card;
    }

    private LinearLayout gamesPage(boolean compact, boolean wide, boolean streamline) {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(label("游戏库", compact ? 21 : 24, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)));
        page.addView(label("选择一款游戏，再决定联机、匹配或本地练习。",
                        compact ? 12 : 13, COLOR_MUTED, false),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));

        gameSearchInput = new EditText(this);
        gameSearchInput.setSingleLine(true);
        gameSearchInput.setHint("搜索桌游");
        gameSearchInput.setTextColor(COLOR_TEXT);
        gameSearchInput.setHintTextColor(COLOR_SOFT);
        gameSearchInput.setTextSize(14);
        gameSearchInput.setPadding(dp(14), 0, dp(14), 0);
        gameSearchInput.setBackground(roundedBg(COLOR_SURFACE_SOFT, COLOR_LINE, 8));
        gameSearchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                filterGameLibrary();
            }
            @Override public void afterTextChanged(Editable s) {}
        });
        page.addView(gameSearchInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(46)));

        HorizontalScrollView categoryScroll = new HorizontalScrollView(this);
        categoryScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout categories = row();
        for (String category : new String[]{"全部", "棋类", "牌类", "聚会", "休闲"}) {
            Button chip = categoryButton(category);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(category.equals("全部") ? 64 : 72), dp(38));
            params.setMargins(0, 0, dp(8), 0);
            categories.addView(chip, params);
        }
        categoryScroll.addView(categories);
        page.addView(categoryScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));

        gameLibraryCount = label("", 12, COLOR_MUTED, false);
        page.addView(gameLibraryCount, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));
        gameLibraryCompact = compact;
        gameLibraryGrid = gameGrid(compact, wide, streamline);
        page.addView(gameLibraryGrid,
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        updateGameLibraryCount(gameLibraryGrid.getChildCount());

        return page;
    }

    private Button categoryButton(String category) {
        Button button = subtleButton(category);
        boolean selected = category.equals(selectedGameCategory);
        button.setTextSize(12);
        button.setTextColor(selected ? Color.WHITE : COLOR_MUTED);
        button.setBackground(roundedBg(selected ? COLOR_ACCENT_DARK : COLOR_SURFACE_SOFT,
                selected ? Color.TRANSPARENT : COLOR_LINE, 8));
        button.setOnClickListener(v -> {
            selectedGameCategory = category;
            View parent = (View) button.getParent();
            if (parent instanceof ViewGroup) updateCategoryButtons((ViewGroup) parent);
            filterGameLibrary();
        });
        return button;
    }

    private void updateCategoryButtons(ViewGroup group) {
        for (int index = 0; index < group.getChildCount(); index++) {
            View child = group.getChildAt(index);
            if (!(child instanceof Button)) continue;
            Button button = (Button) child;
            boolean selected = button.getText().toString().equals(selectedGameCategory);
            button.setTextColor(selected ? Color.WHITE : COLOR_MUTED);
            button.setBackground(roundedBg(selected ? COLOR_ACCENT_DARK : COLOR_SURFACE_SOFT,
                    selected ? Color.TRANSPARENT : COLOR_LINE, 8));
        }
    }

    private LinearLayout profilePage(boolean compact, boolean wide) {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.addView(label("我的", compact ? 21 : 24, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));

        LinearLayout account = panel();
        LinearLayout accountRow = row();
        LinearLayout accountText = new LinearLayout(this);
        accountText.setOrientation(LinearLayout.VERTICAL);
        accountText.addView(label(passportUser == null ? "铮铮通行证" : playerName,
                        17, COLOR_TEXT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));
        accountText.addView(label(passportUser == null ? "登录后同步昵称、战绩和房间身份" : "已登录 · 跨端身份同步",
                        12, COLOR_MUTED, false),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)));
        accountRow.addView(accountText, new LinearLayout.LayoutParams(0, dp(54), 1));
        Button accountAction = accentButton(passportUser == null ? "登录 / 注册" : "账号");
        accountAction.setOnClickListener(v -> showPassportLoginDialog());
        accountRow.addView(accountAction, new LinearLayout.LayoutParams(dp(compact ? 108 : 126), dp(46)));
        account.addView(accountRow);
        page.addView(account, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        page.addView(profileGroup("联机与社交",
                        profileRow("公开房间", "查看正在等待玩家的房间", this::showPublicRooms),
                        profileRow("排行榜", "查看本周积分与对局排名", this::showLeaderboard),
                        profileRow(voiceJoined ? "退出语音房" : "语音房", "在对局内与同房玩家交流", this::toggleVoiceRoom)),
                profileGroupParams());
        page.addView(profileGroup("玩法",
                        profileRow("AI 难度", aiDifficultyName(), this::showAiDifficultyDialog),
                        profileRow("落子确认", doubleTapToPlace ? "双击确认，防止误碰" : "单击直接落子", this::togglePlacementMode),
                        profileRow("跨设备继续", "生成网页续玩入口", this::continueOnWeb)),
                profileGroupParams());
        page.addView(profileGroup("应用设置",
                        profileRow("外观", themeModeName(), this::showAppearanceDialog),
                        profileRow("检查更新", "当前 " + BuildConfig.VERSION_NAME + " · build " + BuildConfig.VERSION_CODE,
                                () -> {
                                    if (BuildConfig.DIRECT_UPDATES) checkAppUpdates(true);
                                    else showMessage("检查更新", "商店版由应用商店负责更新。");
                                }),
                        profileRow("反馈问题", "提交后可在网站后台跟进", this::showFeedbackDialog),
                        profileRow("隐私与权限", "查看联网、语音和房间数据说明",
                                () -> showMessage("隐私与权限",
                                        "房间消息和棋局操作会发送到铮铮实验室实时服务，用于多人同步。\n\n"
                                                + "麦克风仅在你主动加入语音房后使用。"))),
                profileGroupParams());
        return page;
    }

    private LinearLayout profileGroup(String title, Button... rows) {
        LinearLayout group = panel();
        group.addView(label(title, 13, COLOR_ACCENT, true),
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));
        for (Button row : rows) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
            params.setMargins(0, dp(2), 0, dp(2));
            group.addView(row, params);
        }
        return group;
    }

    private LinearLayout.LayoutParams profileGroupParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(12), 0, 0);
        return params;
    }

    private Button profileRow(String title, String detail, Runnable action) {
        Button row = subtleButton(title + "\n" + detail);
        row.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
        row.setTextSize(13);
        row.setPadding(dp(14), 0, dp(12), 0);
        row.setOnClickListener(v -> action.run());
        return row;
    }

    private void togglePlacementMode() {
        doubleTapToPlace = !doubleTapToPlace;
        getPreferences(MODE_PRIVATE).edit().putBoolean("double_tap_to_place", doubleTapToPlace).apply();
        if (boardView != null) boardView.setDoubleTapToPlace(doubleTapToPlace);
        buildLayout();
    }

    private String themeModeName() {
        if ("light".equals(themeMode)) return "浅色";
        if ("dark".equals(themeMode)) return "深色";
        return "跟随系统";
    }

    private LinearLayout morePage(boolean compact) {
        LinearLayout page = panel();
        TextView heading = label("我的", compact ? 19 : 22, COLOR_TEXT, true);
        page.addView(heading, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));
        addActionSection(page, "联机与战绩",
                actionButton("公开房间", this::showPublicRooms),
                actionButton("排行榜", this::showLeaderboard),
                actionButton("快速匹配", this::quickMatch));
        addActionSection(page, "社交",
                actionButton(voiceJoined ? "退出语音房" : "语音房状态", this::toggleVoiceRoom),
                actionButton("聊天说明", () -> showMessage("局内聊天", "加入联机房间后，文字聊天会通过主站实时同步到所有设备。")));
        addActionSection(page, "练习",
                actionButton("AI 难度：" + aiDifficultyName(), this::showAiDifficultyDialog),
                actionButton("闯关", this::startChallengeMode),
                actionButton("训练 AI", this::showModelTrainingDialog));
        addActionSection(page, "跨设备",
                actionButton("在网页中继续", this::continueOnWeb));
        return page;
    }

    private LinearLayout settingsPage(boolean compact) {
        LinearLayout page = panel();
        TextView heading = label("设置", compact ? 19 : 22, COLOR_TEXT, true);
        page.addView(heading, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)));
        String account = passportUser == null ? "未登录" : playerName;
        TextView info = label("版本：" + BuildConfig.VERSION_NAME + "（" + BuildConfig.VERSION_CODE + "）\n通行证：" + account,
                compact ? 12 : 13, COLOR_MUTED, false);
        info.setPadding(0, 0, 0, dp(8));
        page.addView(info, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        Button passport = subtleButton(passportUser == null ? "通行证登录 / 注册" : "通行证：" + playerName);
        passport.setOnClickListener(v -> showPassportLoginDialog());
        page.addView(passport, settingsActionParams());
        Button appearance = subtleButton("外观：" + ("system".equals(themeMode) ? "跟随系统" : ("light".equals(themeMode) ? "浅色" : "深色")));
        appearance.setOnClickListener(v -> showAppearanceDialog());
        page.addView(appearance, settingsActionParams());
        Button touchMode = subtleButton(doubleTapToPlace ? "防误碰：双击确认落子" : "防误碰：单击直接落子");
        touchMode.setOnClickListener(v -> {
            doubleTapToPlace = !doubleTapToPlace;
            getPreferences(MODE_PRIVATE).edit().putBoolean("double_tap_to_place", doubleTapToPlace).apply();
            if (boardView != null) boardView.setDoubleTapToPlace(doubleTapToPlace);
            buildLayout();
        });
        page.addView(touchMode, settingsActionParams());
        Button update = subtleButton("检查软件更新");
        update.setOnClickListener(v -> {
            if (BuildConfig.DIRECT_UPDATES) checkAppUpdates(true);
            else showMessage("检查更新", "商店版由应用商店负责更新。");
        });
        page.addView(update, settingsActionParams());
        Button feedback = subtleButton("反馈问题");
        feedback.setOnClickListener(v -> showFeedbackDialog());
        page.addView(feedback, settingsActionParams());
        Button privacy = subtleButton("隐私与权限");
        privacy.setOnClickListener(v -> showMessage("隐私与权限",
                "房间消息和棋局操作会发送到铮铮实验室实时服务，用于多人同步。\n\n"
                        + "原生端语音目前只同步语音房成员状态；网页端已支持真实 WebRTC 麦克风语音。"));
        page.addView(privacy, settingsActionParams());
        return page;
    }

    private void showAppearanceDialog() {
        String[] labels = {"跟随系统", "浅色", "深色"};
        String[] values = {"system", "light", "dark"};
        int selected = "light".equals(themeMode) ? 1 : ("dark".equals(themeMode) ? 2 : 0);
        new AlertDialog.Builder(this)
                .setTitle("外观")
                .setSingleChoiceItems(labels, selected, (dialog, which) -> {
                    themeMode = values[which];
                    getPreferences(MODE_PRIVATE).edit().putString("theme_mode", themeMode).apply();
                    applyThemePalette();
                    dialog.dismiss();
                    buildLayout();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        final String savedRoom = roomField == null ? "" : roomField.getText().toString();
        final String savedStatus = statusText == null ? "" : statusText.getText().toString();
        final String savedChat = chatLog == null ? "" : chatLog.getText().toString();
        final BoardView savedBoard = boardView;
        applyThemePalette();
        buildLayout();
        main.post(() -> {
            roomField.setText(savedRoom);
            statusText.setText(savedStatus);
            if (chatLog != null) chatLog.setText(savedChat);
            if (savedBoard != null) boardView.copyStateFrom(savedBoard);
        });
    }

    private void connectCloud() {
        closeTransport();
        String room = roomCode();
        String gameType = selectedGameType();
        sessionStarted = true;
        resetRound();
        fallbackMode = false;
        localAiMode = false;
        buildLayout();
        roomField.setText(room);
        setGameSelection(gameType);
        CloudSocketTransport cloud = new CloudSocketTransport(room, gameType);
        transport = cloud;
        status("正在连接主站房间 " + room + "...");
        cloud.start();
    }

    private void startLocalAiMode() {
        closeTransport();
        String gameType = selectedGameType();
        sessionStarted = true;
        fallbackMode = true;
        localAiMode = true;
        boardEditorMode = false;
        buildLayout();
        setGameSelection(gameType);
        resetRound();
        String title = titleForGameType(gameType);
        status("单机 AI：" + title);
        append("系统：已进入单机 + AI 模式。");
        if (!boardView.isPlayableBoard()) {
            append("系统：" + title + " 已切换为本地练习桌面，不再等待联机房间。");
        }
    }

    private void startFallbackServer(String reason) {
        main.post(() -> {
            if (localServer != null) localServer.stop();
            localServer = new LocalRoomServer(8787);
            localServer.start();
            String host = localIp();
            fallbackMode = true;
            connectToLocal("http://" + host + ":8787");
            status("实时连接暂不可用 · 临时联机自动接管");
            append("系统：主站暂时不可用，已静默切换到临时联机；主站恢复后下一局自动迁回。");
        });
    }

    private String boardApiBase() {
        return "https://zhengzhengstudio.cn";
    }

    private void quickMatch() {
        String gameType = selectedGameType();
        status("正在匹配 " + titleForGameType(gameType) + "...");
        new Thread(() -> {
            try {
                String url = boardApiBase() + "/api/boardgames/matchmaking?gameType=" + enc(gameType);
                JSONObject response = new JSONObject(httpGet(url));
                    String room = response.optString("roomId", "");
                    if (room.isEmpty()) throw new IllegalStateException("主站没有返回房间号");
                    main.post(() -> {
                    if (roomField != null) roomField.setText(room);
                    getPreferences(MODE_PRIVATE).edit().putString("room", room).apply();
                    append("系统：匹配到房间 " + room);
                    connectCloud();
                });
            } catch (Exception error) {
                main.post(() -> {
                    status("匹配失败");
                    append("系统：匹配失败：" + error.getMessage());
                });
            }
        }).start();
    }

    private void showPublicRooms() {
        String gameType = selectedGameType();
        status("正在读取公开房间...");
        new Thread(() -> {
            try {
                String url = boardApiBase() + "/api/boardgames/public-rooms?gameType=" + enc(gameType);
                JSONObject response = new JSONObject(httpGet(url));
                JSONArray rooms = response.optJSONArray("rooms");
                if (rooms == null || rooms.length() == 0) {
                    main.post(() -> showMessage("公开房间", "这个游戏暂时没有公开房间，点“快速匹配”会自动创建。"));
                    return;
                }
                String[] labels = new String[rooms.length()];
                String[] ids = new String[rooms.length()];
                for (int i = 0; i < rooms.length(); i++) {
                    JSONObject room = rooms.optJSONObject(i);
                    if (room == null) continue;
                    ids[i] = room.optString("roomId", room.optString("id"));
                    labels[i] = room.optString("gameTitle", "桌游") + " · 房间 " + ids[i] + " · " +
                            room.optInt("playerCount") + "/" + room.optInt("maxPlayers", 2);
                }
                main.post(() -> new AlertDialog.Builder(this)
                        .setTitle("公开房间")
                        .setItems(labels, (dialog, which) -> {
                            roomField.setText(ids[which]);
                            connectCloud();
                        })
                        .setNegativeButton("关闭", null)
                        .show());
            } catch (Exception error) {
                main.post(() -> showMessage("公开房间", "读取失败：" + error.getMessage()));
            }
        }).start();
    }

    private void showLeaderboard() {
        String gameType = selectedGameType();
        status("正在读取排行榜...");
        new Thread(() -> {
            try {
                String url = boardApiBase() + "/api/boardgames/leaderboard?gameType=" + enc(gameType);
                String raw = httpGet(url).trim();
                JSONArray rows;
                if (raw.startsWith("[")) {
                    rows = new JSONArray(raw);
                } else {
                    JSONObject response = new JSONObject(raw);
                    rows = response.optJSONArray("leaderboard");
                    if (rows == null) rows = response.optJSONArray("data");
                    if (rows == null) rows = response.optJSONArray("rows");
                }
                if (rows == null || rows.length() == 0) {
                    main.post(() -> showMessage("排行榜", "这个游戏还没有胜场记录。"));
                    return;
                }
                StringBuilder text = new StringBuilder();
                for (int i = 0; i < Math.min(12, rows.length()); i++) {
                    JSONObject row = rows.optJSONObject(i);
                    if (row == null) continue;
                    text.append(row.optInt("rank", i + 1))
                            .append(". ")
                            .append(row.optString("name", row.optString("username", "玩家")))
                            .append("  ")
                            .append(row.has("rating") ? row.optInt("rating", 1000) : row.optInt("score", 0))
                            .append(" 分 / ")
                            .append(row.optInt("wins"))
                            .append(" 胜\n");
                }
                main.post(() -> showMessage("排行榜", text.toString()));
            } catch (Exception error) {
                main.post(() -> showMessage("排行榜", "读取失败：排行榜数据格式异常。请稍后重试或更新到最新补丁版。"));
            }
        }).start();
    }

    private void showMoreActionsDialog() {
        AlertDialog dialog = new AlertDialog.Builder(this).create();
        LinearLayout card = dialogCard("更多操作", "房间、社交、玩法和设置都放在这里；常用操作不会再挤在一个列表里。");
        addActionSection(card, "联机房间",
                actionButton("公开房间", () -> { dialog.dismiss(); showPublicRooms(); }),
                actionButton("排行榜", () -> { dialog.dismiss(); showLeaderboard(); }),
                actionButton("快速匹配", () -> { dialog.dismiss(); quickMatch(); }));
        addActionSection(card, "局内社交",
                actionButton(voiceJoined ? "退出语音" : "加入语音", () -> { dialog.dismiss(); toggleVoiceRoom(); }),
                actionButton("发送系统提示", () -> {
                    dialog.dismiss();
                    append("系统：请在下方输入框聊天；联机房间会同步到所有设备。");
                }));
        addActionSection(card, "玩法",
                actionButton("AI 难度：" + aiDifficultyName(), () -> { dialog.dismiss(); showAiDifficultyDialog(); }),
                actionButton("闯关", () -> { dialog.dismiss(); startChallengeMode(); }),
                actionButton("训练 AI", () -> { dialog.dismiss(); showModelTrainingDialog(); }));
        addActionSection(card, "局内控制",
                actionButton("局内重开", () -> { dialog.dismiss(); requestReset(); }),
                actionButton("本地练习", () -> { dialog.dismiss(); startLocalAiMode(); }));
        addActionSection(card, "跨设备",
                actionButton("在网页中继续", () -> { dialog.dismiss(); continueOnWeb(); }));
        addActionSection(card, "应用",
                actionButton("通行证", () -> { dialog.dismiss(); showPassportLoginDialog(); }),
                actionButton("设置", () -> { dialog.dismiss(); showSettingsDialog(); }),
                actionButton("检查更新", () -> {
                    dialog.dismiss();
                    if (BuildConfig.DIRECT_UPDATES) checkAppUpdates(true);
                    else showMessage("检查更新", "商店版由应用商店负责更新。");
                }));
        Button close = subtleButton("关闭");
        close.setOnClickListener(v -> dialog.dismiss());
        card.addView(close, settingsActionParams());
        dialog.setView(card);
        dialog.show();
        android.view.Window window = dialog.getWindow();
        if (window != null) window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    }

    private void addActionSection(LinearLayout parent, String title, Button... buttons) {
        TextView label = label(title, 13, COLOR_CYAN, true);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24));
        labelParams.setMargins(0, dp(12), 0, dp(4));
        parent.addView(label, labelParams);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setBaselineAligned(false);
        for (int i = 0; i < buttons.length; i++) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(42), 1);
            if (i > 0) params.leftMargin = dp(8);
            row.addView(buttons[i], params);
        }
        parent.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)));
    }

    private Button actionButton(String text, Runnable action) {
        Button button = subtleButton(text);
        button.setTextSize(13);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    private String aiDifficultyName() {
        if (aiDifficulty <= 1) return "轻松";
        if (aiDifficulty >= 3) return "高手";
        return "标准";
    }

    private void showAiDifficultyDialog() {
        String[] levels = {"轻松：会随机犯错", "标准：攻防兼顾", "高手：优先抢胜和封堵"};
        new AlertDialog.Builder(this)
                .setTitle("AI 难度")
                .setSingleChoiceItems(levels, Math.max(0, Math.min(2, aiDifficulty - 1)), (dialog, which) -> {
                    aiDifficulty = which + 1;
                    append("系统：AI 难度已切换为 " + aiDifficultyName() + "。");
                    dialog.dismiss();
                    if ("study".equals(currentPage)) buildLayout();
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private boolean supportsBoardStudy() {
        String game = selectedGameType();
        return "native-gobang".equals(game) || "gobang".equals(game)
                || "go".equals(game) || "chinese-chess".equals(game) || "xiangqi".equals(game);
    }

    private int playerForStone(String stone) {
        return "white".equals(stone) ? 2 : 1;
    }

    private String moveDescription(BoardAnalysis.Move move) {
        if (move == null) return "无合法着";
        if (move.index >= 0) {
            int size = boardView.analysisBoardSize();
            return "落子 " + (move.index / size + 1) + "," + (move.index % size + 1);
        }
        return "走子 " + (move.from / 9 + 1) + "," + (move.from % 9 + 1)
                + " → " + (move.to / 9 + 1) + "," + (move.to % 9 + 1);
    }

    private void showBoardStudyDialog() {
        if (!supportsBoardStudy()) return;
        if (boardEditorMode) {
            new AlertDialog.Builder(this)
                    .setTitle("自建棋盘")
                    .setMessage("选择棋子后直接点击棋盘摆放；同一棋子再次点击即可删除。")
                    .setItems(new String[]{"选择棋子", "撤销", "清空", "标准局面", "切换执棋方", "保存局面", "载入局面", "检查局面", "开始对局"}, (dialog, which) -> {
                        if (which == 0) showEditorPieceDialog();
                        else if (which == 1) undoEditedBoard();
                        else if (which == 2) replaceEditedBoard(false);
                        else if (which == 3) replaceEditedBoard(true);
                        else if (which == 4) switchEditedPlayer();
                        else if (which == 5) saveEditedBoard();
                        else if (which == 6) loadEditedBoard();
                        else if (which == 7) validateEditedBoard();
                        else finishBoardEditor();
                    })
                    .setNegativeButton("继续摆盘", null)
                    .setNeutralButton("取消摆盘", (dialog, which) -> cancelBoardEditor())
                    .show();
            return;
        }
        if (activePuzzle != null) {
            new AlertDialog.Builder(this)
                    .setTitle("残局训练 · " + activePuzzle.title)
                    .setMessage("题面已摆好，只需要走下一步。\n\n目标：" + activePuzzle.goal)
                    .setItems(new String[]{"查看提示", "重新开始本题", "下一题", "退出残局"}, (dialog, which) -> {
                        if (which == 0) showPuzzleHint();
                        else if (which == 1) resetActivePuzzle();
                        else if (which == 2) loadBuiltInPuzzle();
                        else exitPuzzleMode();
                    })
                    .setNegativeButton("继续下棋", null)
                    .show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("棋局研习")
                .setMessage("残局：题面由系统摆好，你只需走下一步。\n自建棋盘：选择棋子后自行摆放，再校验并开始。")
                .setItems(new String[]{"分析当前局面", "开始残局训练", "自建棋盘", "AI 难度 · " + aiDifficultyName()},
                        (dialog, which) -> {
                            if (which == 0) analyzeCurrentBoard();
                            else if (which == 1) loadBuiltInPuzzle();
                            else if (which == 2) toggleBoardEditor();
                            else showAiDifficultyDialog();
                        })
                .setNegativeButton("关闭", null)
                .show();
    }

    private void analyzeCurrentBoard() {
        BoardAnalysis.Position position = boardView.toAnalysisPosition(playerForStone(currentStone));
        BoardAnalysis.Analysis result = BoardAnalysis.analyze(position, BoardAnalysis.Difficulty.fromLevel(aiDifficulty));
        StringBuilder message = new StringBuilder(result.explanation);
        if (result.recommended != null) message.append("\n\n推荐：").append(moveDescription(result.recommended));
        message.append("\n战术：").append(result.tactical)
                .append(" · 置信度 ").append(Math.round(result.confidence * 100)).append("%")
                .append(" · 主线 ").append(result.principalVariation.size()).append(" 手")
                .append(" · 搜索 ").append(result.nodes).append(" 节点");
        for (int index = 0; index < result.candidates.size(); index++) {
            BoardAnalysis.Move candidate = result.candidates.get(index);
            message.append("\n").append(index + 1).append(". ").append(moveDescription(candidate))
                    .append(" · ").append(candidate.score);
        }
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("局面分析")
                .setMessage(message.toString())
                .setNegativeButton("关闭", null);
        if ((localAiMode || fallbackMode) && result.recommended != null) {
            builder.setPositiveButton("采用推荐着", (dialog, which) -> {
                BoardAnalysis.ApplyResult applied = BoardAnalysis.applyMove(position, result.recommended);
                if (applied.ok) {
                    boardView.applyAnalysisPosition(applied.position);
                    currentStone = "black".equals(currentStone) ? "white" : "black";
                    append("分析：已采用 " + moveDescription(result.recommended));
                }
            });
        }
        builder.show();
    }

    private void loadBuiltInPuzzle() {
        List<BoardAnalysis.Puzzle> puzzles = BoardAnalysis.builtInPuzzles(boardView.analysisGame());
        if (puzzles.isEmpty()) {
            showMessage("残局训练", "当前棋种还没有内置残局。");
            return;
        }
        puzzleIndex = (puzzleIndex + 1) % puzzles.size();
        BoardAnalysis.Puzzle puzzle = puzzles.get(puzzleIndex);
        activePuzzle = puzzle;
        puzzleStartPosition = puzzle.position;
        closeTransport();
        localAiMode = true;
        fallbackMode = true;
        challengeMode = true;
        boardEditorMode = false;
        currentStone = puzzle.position.currentPlayer == 1 ? "black" : "white";
        boardView.applyAnalysisPosition(puzzle.position);
        status("残局 " + (puzzleIndex + 1) + "/" + puzzles.size() + " · " + puzzle.title + " · 走下一步");
        append("残局：题面已摆好，只需要走下一步 · " + puzzle.difficulty + " · " + puzzle.goal);
    }

    private void showPuzzleHint() {
        if (activePuzzle == null || activePuzzle.solution.isEmpty()) return;
        showMessage("残局提示", moveDescription(activePuzzle.solution.get(0)));
    }

    private void resetActivePuzzle() {
        if (activePuzzle == null || puzzleStartPosition == null) return;
        boardView.applyAnalysisPosition(puzzleStartPosition);
        currentStone = puzzleStartPosition.currentPlayer == 1 ? "black" : "white";
        status("残局 · " + activePuzzle.title + " · 重新开始本题");
        append("残局：已恢复题面，请走下一步。");
    }

    private void exitPuzzleMode() {
        activePuzzle = null;
        puzzleStartPosition = null;
        challengeMode = false;
        resetRound();
        status("已退出残局训练");
        append("系统：已退出残局，可开始普通练习。");
    }

    private void toggleBoardEditor() {
        if (boardEditorMode) {
            showBoardStudyDialog();
            return;
        }
        closeTransport();
        localAiMode = true;
        fallbackMode = true;
        boardEditorMode = true;
        boardEditorPiece = boardView.isChineseChess() ? "rR" : "1";
        boardEditorOrigin = boardView.toAnalysisPosition(playerForStone(currentStone));
        boardEditorHistory.clear();
        append("摆盘：点击棋盘放置棋子，可在研习菜单切换棋子或删除。");
        showEditorPieceDialog();
    }

    private void finishBoardEditor() {
        BoardAnalysis.Position position = boardView.toAnalysisPosition(playerForStone(currentStone));
        BoardAnalysis.Validation validation = BoardAnalysis.validateEditor(position);
        if (!validation.ok) {
            showMessage("局面还不能使用", validation.message);
            return;
        }
        boardEditorMode = false;
        boardEditorOrigin = null;
        boardEditorHistory.clear();
        gameFinished = false;
        append("摆盘：局面已应用，开始对局。");
        status("自建局面 · 轮到" + (position.currentPlayer == 1 ? "先手" : "后手"));
    }

    private void cancelBoardEditor() {
        if (boardEditorOrigin != null) boardView.applyAnalysisPosition(boardEditorOrigin);
        boardEditorMode = false;
        boardEditorOrigin = null;
        boardEditorHistory.clear();
        append("摆盘：已取消并恢复原局面。");
    }

    private void undoEditedBoard() {
        if (boardEditorHistory.isEmpty()) {
            append("摆盘：没有可以撤销的操作。");
            return;
        }
        BoardAnalysis.Position previous = boardEditorHistory.removeLast();
        boardView.applyAnalysisPosition(previous);
        currentStone = previous.currentPlayer == 1 ? "black" : "white";
        append("摆盘：已撤销一步。");
    }

    private void replaceEditedBoard(boolean standard) {
        BoardAnalysis.Position current = boardView.toAnalysisPosition(playerForStone(currentStone));
        boardEditorHistory.addLast(current);
        BoardAnalysis.Position replacement = standard
                ? BoardAnalysis.standardPosition(current.game, current.size)
                : new BoardAnalysis.Position(current.game, current.size, new String[current.board.length], current.currentPlayer);
        boardView.applyAnalysisPosition(replacement);
        currentStone = replacement.currentPlayer == 1 ? "black" : "white";
        append("摆盘：已" + (standard ? "恢复标准局面" : "清空棋盘") + "。");
    }

    private void switchEditedPlayer() {
        currentStone = "black".equals(currentStone) ? "white" : "black";
        append("摆盘：已切换执棋方。");
    }

    private void saveEditedBoard() {
        BoardAnalysis.Position position = boardView.toAnalysisPosition(playerForStone(currentStone));
        JSONArray cells = new JSONArray();
        for (String piece : position.board) cells.put(piece);
        getSharedPreferences("boardgames", MODE_PRIVATE).edit()
                .putString("editor_game", position.game)
                .putInt("editor_size", position.size)
                .putInt("editor_player", position.currentPlayer)
                .putString("editor_board", cells.toString())
                .apply();
        append("摆盘：保存局面完成。");
    }

    private void loadEditedBoard() {
        android.content.SharedPreferences preferences = getSharedPreferences("boardgames", MODE_PRIVATE);
        String encoded = preferences.getString("editor_board", "");
        if (encoded.isEmpty()) {
            append("摆盘：还没有保存的局面。");
            return;
        }
        try {
            JSONArray cells = new JSONArray(encoded);
            String[] board = new String[cells.length()];
            for (int index = 0; index < board.length; index++) board[index] = cells.optString(index, "");
            BoardAnalysis.Position position = new BoardAnalysis.Position(
                    preferences.getString("editor_game", boardView.analysisGame()),
                    preferences.getInt("editor_size", boardView.analysisBoardSize()), board,
                    preferences.getInt("editor_player", 1));
            boardEditorHistory.addLast(boardView.toAnalysisPosition(playerForStone(currentStone)));
            boardView.applyAnalysisPosition(position);
            currentStone = position.currentPlayer == 1 ? "black" : "white";
            append("摆盘：载入局面完成。");
        } catch (Exception error) {
            showMessage("载入失败", "保存的局面已经损坏。");
        }
    }

    private void showEditorPieceDialog() {
        final String[] labels;
        final String[] values;
        if (boardView.isChineseChess()) {
            labels = new String[]{"删除", "红帅", "红车", "红马", "红炮", "红兵", "红仕", "红相",
                    "黑将", "黑车", "黑马", "黑炮", "黑卒", "黑士", "黑象"};
            values = new String[]{"", "rK", "rR", "rN", "rC", "rP", "rA", "rB",
                    "bK", "bR", "bN", "bC", "bP", "bA", "bB"};
        } else {
            labels = new String[]{"删除", "黑棋", "白棋"};
            values = new String[]{"", "1", "2"};
        }
        new AlertDialog.Builder(this)
                .setTitle("选择摆放棋子")
                .setItems(labels, (dialog, which) -> {
                    boardEditorPiece = values[which];
                    append("摆盘：当前工具为“" + labels[which] + "”。");
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private void validateEditedBoard() {
        BoardAnalysis.Validation validation = BoardAnalysis.validateEditor(
                boardView.toAnalysisPosition(playerForStone(currentStone)));
        showMessage("摆盘校验", validation.message);
    }

    private void startChallengeMode() {
        String gameType = selectedGameType();
        challengeMode = true;
        activeChallengeId = challengeIdForGame(gameType);
        startLocalAiMode();
        append("系统：已进入闯关练习：" + challengeTitleForGame(gameType));
        append("系统：本局胜利或完成关键操作后会记录训练样本。");
    }

    private String challengeIdForGame(String gameType) {
        if ("native-reversi".equals(gameType)) return "reversi-corner";
        if ("rummy".equals(gameType)) return "rummy-first-meld";
        if ("ludo".equals(gameType)) return "ludo-safe-run";
        if ("minesweeper".equals(gameType)) return "minesweeper-safe-start";
        if ("spy".equals(gameType) || "werewolf".equals(gameType)) return "party-speech";
        return "gobang-open-three";
    }

    private String challengeTitleForGame(String gameType) {
        if ("native-reversi".equals(gameType)) return "黑白棋边角控制";
        if ("rummy".equals(gameType)) return "拉密首次组合";
        if ("ludo".equals(gameType)) return "飞行棋安全起飞";
        if ("minesweeper".equals(gameType)) return "扫雷无猜开局";
        if ("spy".equals(gameType) || "werewolf".equals(gameType)) return "聚会发言识别";
        return "五子棋活三攻防";
    }

    private void showModelTrainingDialog() {
        String gameType = selectedGameType();
        String title = titleForGameType(gameType);
        String message = "当前游戏：" + title + "\n"
                + "本机样本：" + localTrainingSamples + "\n\n"
                + "训练会把本机练习结果记到主站模型统计里，用来后续改进 AI 提示。";
        AlertDialog dialog = new AlertDialog.Builder(this).create();
        LinearLayout card = dialogCard("训练 AI", message);
        Button sample = accentButton("记录 5 个训练样本");
        sample.setOnClickListener(v -> {
            dialog.dismiss();
            submitTrainingSamples(gameType, 5);
        });
        card.addView(sample, settingsActionParams());
        Button practice = subtleButton("先进入本地练习");
        practice.setOnClickListener(v -> {
            dialog.dismiss();
            startLocalAiMode();
        });
        card.addView(practice, settingsActionParams());
        Button close = subtleButton("关闭");
        close.setOnClickListener(v -> dialog.dismiss());
        card.addView(close, settingsActionParams());
        dialog.setView(card);
        dialog.show();
        android.view.Window window = dialog.getWindow();
        if (window != null) window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    }

    private void submitTrainingSamples(String gameType, int samples) {
        localTrainingSamples += samples;
        status("正在记录 AI 训练样本...");
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                put(payload, "gameType", gameType);
                put(payload, "samples", samples);
                put(payload, "username", playerName);
                JSONObject response = new JSONObject(httpPostJson(boardApiBase() + "/api/boardgames/model/train", payload.toString()));
                JSONObject model = response.optJSONObject("model");
                String modelStatus = model == null ? "已记录" : model.optString("status", "已记录");
                main.post(() -> {
                    status("AI 训练样本已记录");
                    append("系统：AI 训练样本 +" + samples + "；" + modelStatus + "。");
                });
            } catch (Exception error) {
                main.post(() -> {
                    status("AI 训练暂不可用");
                    append("系统：训练样本已先保存在本机，主站稍后再试。");
                });
            }
        }).start();
    }

    private void toggleVoiceRoom() {
        if (transport == null) {
            append("系统：请先加入联机房间再开语音。");
            return;
        }
        if (voiceJoined) {
            stopVoiceRoom();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, VOICE_PERMISSION_REQUEST);
            return;
        }
        if (!voiceEngine.start()) {
            append("系统：无法启动麦克风，请检查系统录音权限或其他正在通话的应用。");
            return;
        }
        voiceJoined = true;
        JSONObject data = new JSONObject();
        put(data, "type", "voice-join");
        put(data, "roomId", roomCode());
        put(data, "muted", false);
        transport.send(data);
        append("系统：房间语音已接通。");
        buildLayout();
    }

    private void stopVoiceRoom() {
        voiceEngine.stop();
        if (voiceJoined && transport != null) {
            JSONObject data = new JSONObject();
            put(data, "type", "voice-leave");
            put(data, "roomId", roomCode());
            transport.send(data);
        }
        voiceJoined = false;
        append("系统：已退出房间语音。");
        buildLayout();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != VOICE_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            toggleVoiceRoom();
        } else {
            append("系统：未获得麦克风权限，无法加入房间语音。");
        }
    }

    private void showMessage(String title, String message) {
        AlertDialog dialog = new AlertDialog.Builder(this).create();
        LinearLayout card = dialogCard(title, message);
        Button ok = accentButton("好");
        ok.setOnClickListener(v -> dialog.dismiss());
        LinearLayout.LayoutParams okParams = new LinearLayout.LayoutParams(dp(112), dp(44));
        okParams.setMargins(0, dp(14), 0, 0);
        card.addView(ok, okParams);
        dialog.setView(card);
        dialog.show();
        android.view.Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        }
    }

    private void showSettingsDialog() {
        AlertDialog dialog = new AlertDialog.Builder(this).create();
        String message = "当前版本：" + BuildConfig.VERSION_NAME + "（" + BuildConfig.VERSION_CODE + "）\n\n"
                + "通行证：" + (passportUser == null ? "未登录" : playerName) + "\n\n"
                + (BuildConfig.DIRECT_UPDATES
                ? "直装版会在启动时检查铮铮实验室发布的新版本。"
                : "商店版由应用商店负责更新，不会下载站外安装包。");
        LinearLayout card = dialogCard("设置", message);
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        actions.setPadding(0, dp(8), 0, 0);
        Button touchMode = subtleButton(doubleTapToPlace ? "防误碰：双击确认落子" : "防误碰：单击直接落子");
        touchMode.setOnClickListener(v -> {
            doubleTapToPlace = !doubleTapToPlace;
            getPreferences(MODE_PRIVATE).edit().putBoolean("double_tap_to_place", doubleTapToPlace).apply();
            if (boardView != null) boardView.setDoubleTapToPlace(doubleTapToPlace);
            append("系统：落子方式已切换为" + (doubleTapToPlace ? "双击确认。" : "单击直接落子。"));
            dialog.dismiss();
            showSettingsDialog();
        });
        actions.addView(touchMode, settingsActionParams());
        Button passport = subtleButton(passportUser == null ? "通行证登录 / 注册" : "通行证：" + playerName);
        passport.setOnClickListener(v -> {
            dialog.dismiss();
            showPassportLoginDialog();
        });
        actions.addView(passport, settingsActionParams());
        Button update = subtleButton("检查软件更新");
        update.setOnClickListener(v -> {
            dialog.dismiss();
            if (BuildConfig.DIRECT_UPDATES) checkAppUpdates(true);
            else showMessage("检查更新", "商店版由应用商店负责更新。");
        });
        actions.addView(update, settingsActionParams());
        Button privacy = subtleButton("隐私说明");
        privacy.setOnClickListener(v -> showMessage("隐私说明",
                "房间消息和棋局操作会发送到铮铮实验室实时服务，用于多人同步。"
                        + "\n\n通行证凭据仅用于登录；应用不会读取通讯录、位置或相册。"
                        + "\n\n麦克风只会在你主动加入房间语音时使用。"));
        actions.addView(privacy, settingsActionParams());
        if (passportUser != null) {
            Button logout = subtleButton("退出账号");
            logout.setOnClickListener(v -> {
                getPreferences(MODE_PRIVATE).edit().remove("passport_user").apply();
                passportUser = null;
                playerName = displayName(null);
                passportButton.setText("通行证登录");
                dialog.dismiss();
                status("已退出通行证");
            });
            actions.addView(logout, settingsActionParams());
        }
        Button close = subtleButton("关闭");
        close.setOnClickListener(v -> dialog.dismiss());
        actions.addView(close, settingsActionParams());
        card.addView(actions);
        dialog.setView(card);
        dialog.show();
        android.view.Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        }
    }

    private void showFeedbackDialog() {
        LinearLayout card = dialogCard("反馈问题", "说明发生了什么，铮铮实验室会在网站后台查看并处理。");
        EditText message = styledDialogEdit("问题描述");
        message.setSingleLine(false);
        message.setMinLines(4);
        message.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        card.addView(message, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(120)));
        TextView state = label("", 12, COLOR_MUTED, false);
        card.addView(state, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(32)));
        LinearLayout actions = row();
        Button cancel = subtleButton("取消");
        Button submit = accentButton("提交");
        actions.addView(cancel, new LinearLayout.LayoutParams(0, dp(44), 1));
        actions.addView(submit, new LinearLayout.LayoutParams(0, dp(44), 1));
        card.addView(actions);
        AlertDialog dialog = new AlertDialog.Builder(this).setView(card).create();
        cancel.setOnClickListener(v -> dialog.dismiss());
        submit.setOnClickListener(v -> {
            String text = message.getText().toString().trim();
            if (text.isEmpty()) {
                state.setText("请先写下遇到的问题。");
                return;
            }
            submit.setEnabled(false);
            state.setText("正在提交…");
            new Thread(() -> {
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("product", "铮铮桌游中心");
                    payload.put("platform", "android");
                    payload.put("version", BuildConfig.VERSION_NAME);
                    payload.put("account", passportUser == null ? "" : playerName);
                    payload.put("category", "桌游体验");
                    payload.put("message", text);
                    httpPostJson(boardApiBase() + "/api/feedback", payload.toString());
                    main.post(() -> {
                        state.setText("已提交。");
                        main.postDelayed(dialog::dismiss, 650);
                    });
                } catch (Exception error) {
                    main.post(() -> {
                        submit.setEnabled(true);
                        state.setText("提交失败：" + error.getMessage());
                    });
                }
            }).start();
        });
        dialog.setOnShowListener(ignored -> {
            if (dialog.getWindow() != null) dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        });
        dialog.show();
    }

    private void checkAppUpdates(boolean userInitiated) {
        if (userInitiated) status("正在检查更新...");
        new Thread(() -> {
            try {
                JSONObject manifest = new JSONObject(httpGet(boardApiBase() + "/api/apps/client-downloads.json?t=" + System.currentTimeMillis()));
                JSONArray apps = manifest.optJSONArray("apps");
                JSONObject androidApp = null;
                for (int i = 0; apps != null && i < apps.length(); i++) {
                    JSONObject app = apps.optJSONObject(i);
                    if (app != null
                            && BuildConfig.APPLICATION_ID.equals(app.optString("id"))
                            && "android".equals(app.optString("platform"))) {
                        androidApp = app;
                        break;
                    }
                }
                if (androidApp == null) throw new IllegalStateException("没有安卓安装包信息");
                String latest = androidApp.optString("version", "0");
                String current = BuildConfig.VERSION_NAME;
                int latestBuild = androidApp.optInt("build", androidApp.optInt("versionCode", 0));
                int currentBuild = BuildConfig.VERSION_CODE;
                int versionComparison = compareVersions(latest, current);
                boolean hasUpdate = versionComparison > 0 || (versionComparison == 0 && latestBuild > currentBuild);
                JSONObject selected = androidApp;
                main.post(() -> {
                    if (!hasUpdate) {
                        if (userInitiated) {
                            boolean sameBuild = versionComparison == 0 && latestBuild == currentBuild;
                            String title = sameBuild ? "已是最新版本" : "本机版本更高";
                            String message = "当前版本：" + current + "（" + currentBuild + "）\n"
                                    + "主站版本：" + latest + "（" + latestBuild + "）\n\n"
                                    + (sameBuild
                                    ? "你现在安装的就是主站发布版本。"
                                    : "本机版本高于主站版本，不需要更新。");
                            new AlertDialog.Builder(this)
                                    .setTitle(title)
                                    .setMessage(message)
                                    .setPositiveButton("好", null)
                                    .setNeutralButton("打开下载中心", (dialog, which) -> openDownloadCenter())
                                    .show();
                        }
                        return;
                    }
                    StringBuilder message = new StringBuilder()
                            .append("当前版本：").append(current).append("（").append(currentBuild).append("）\n")
                            .append("更新版本：").append(latest).append("（").append(latestBuild).append("）\n\n");
                    JSONArray notes = selected.optJSONArray("notes");
                    if (notes != null) {
                        for (int i = 0; i < notes.length(); i++) {
                            message.append("· ").append(notes.optString(i)).append("\n");
                        }
                    } else {
                        message.append("更新包已放在铮铮实验室站内下载中心。");
                    }
                    new AlertDialog.Builder(this)
                            .setTitle("发现新版本")
                            .setMessage(message.toString())
                            .setPositiveButton("下载更新", (dialog, which) -> downloadAppUpdate(selected))
                            .setNeutralButton("打开下载中心", (dialog, which) -> openDownloadCenter())
                            .setNegativeButton("稍后", null)
                            .show();
                });
            } catch (Exception error) {
                if (userInitiated) main.post(() -> showMessage("更新检查失败", error.getMessage()));
            }
        }).start();
    }

    private void downloadAppUpdate(JSONObject app) {
        try {
            String path = app.optString("url", "/downloads.html");
            Uri uri = Uri.parse(path.startsWith("http") ? path : boardApiBase() + path);
            String fileName = app.optString("fileName", "ZhengzhengBoardGames-Android-v" + app.optString("version", "latest") + ".apk");
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("铮铮桌游中心 " + app.optString("version", ""));
            request.setDescription("正在从 zhengzhengstudio.cn 下载安卓安装包");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File existing = new File(downloads, fileName);
            if (existing.exists() && !existing.delete()) {
                append("系统：下载目录已有同名安装包，将交给系统下载器处理。");
            }
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("系统下载服务不可用");
            updateDownloadId = manager.enqueue(request);
            status("已加入下载任务：" + fileName);
            append("系统：安装包正在下载，完成后会自动打开安装。");
        } catch (Exception error) {
            showMessage("下载失败", error.getMessage());
        }
    }

    private void openDownloadedApk(long downloadId) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("系统下载服务不可用");
            DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
            try (Cursor cursor = manager.query(query)) {
                if (cursor == null || !cursor.moveToFirst()) throw new IllegalStateException("找不到下载任务");
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (status != DownloadManager.STATUS_SUCCESSFUL) {
                    if (status == DownloadManager.STATUS_FAILED) {
                        int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        showMessage("下载失败", downloadFailureReason(reason));
                    } else {
                        append("系统：安装包下载未完成，请从通知栏查看进度。");
                    }
                    return;
                }
            }
            Uri uri = manager.getUriForDownloadedFile(downloadId);
            if (uri == null) throw new IllegalStateException("系统没有返回安装包位置");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                openUnknownAppSourcesSettings();
                showMessage("需要安装授权", "系统需要先允许铮铮桌游中心安装站内 APK。授权后请回到下载通知或下载中心再次打开安装包。");
                return;
            }
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (install.resolveActivity(getPackageManager()) == null) {
                install = new Intent(Intent.ACTION_INSTALL_PACKAGE);
                install.setData(uri);
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                install.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            }
            if (install.resolveActivity(getPackageManager()) == null) {
                showMessage("无法打开安装器", "安装包已经下载到系统下载目录。请从通知栏、文件管理器或下载中心手动打开 APK。");
                openDownloadCenter();
                return;
            }
            if (safeStartActivity(install, "打开安装器失败")) {
                status("正在打开安装器");
                append("系统：安装器已打开。");
            } else {
                openDownloadCenter();
            }
        } catch (Exception error) {
            showMessage("打开安装包失败", (error.getMessage() == null ? "系统没有返回可安装的 APK 地址。" : error.getMessage())
                    + "\n\n安装包如果已下载完成，可以从通知栏或下载中心手动打开。");
            openDownloadCenter();
        }
    }

    private void openDownloadCenter() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(boardApiBase() + "/downloads.html"));
        safeStartActivity(intent, "打开下载中心失败");
    }

    private void openUnknownAppSourcesSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
        if (intent.resolveActivity(getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        safeStartActivity(intent, "打开安装授权失败");
    }

    private boolean safeStartActivity(Intent intent, String title) {
        try {
            startActivity(intent);
            return true;
        } catch (Exception error) {
            showMessage(title, error.getMessage() == null ? "系统没有可用应用处理这个操作。" : error.getMessage());
            return false;
        }
    }

    private String downloadFailureReason(int reason) {
        switch (reason) {
            case DownloadManager.ERROR_CANNOT_RESUME:
                return "下载中断且无法续传。请重新点“下载更新”。";
            case DownloadManager.ERROR_DEVICE_NOT_FOUND:
                return "下载目录不可用，请检查存储空间或下载目录权限。";
            case DownloadManager.ERROR_FILE_ALREADY_EXISTS:
                return "下载目录里已有同名文件。请删除旧文件后重试，或在下载中心重新下载。";
            case DownloadManager.ERROR_FILE_ERROR:
                return "写入下载文件失败，请检查存储空间。";
            case DownloadManager.ERROR_HTTP_DATA_ERROR:
                return "主站传输中断，请稍后重试。";
            case DownloadManager.ERROR_INSUFFICIENT_SPACE:
                return "存储空间不足，无法保存安装包。";
            case DownloadManager.ERROR_TOO_MANY_REDIRECTS:
                return "下载链接重定向异常。";
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE:
                return "主站返回了无法处理的下载状态码。";
            case DownloadManager.ERROR_UNKNOWN:
            default:
                return "系统下载器返回未知错误：" + reason;
        }
    }

    private int compareVersions(String left, String right) {
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        int count = Math.max(a.length, b.length);
        for (int i = 0; i < count; i++) {
            int av = i < a.length ? parseVersionPart(a[i]) : 0;
            int bv = i < b.length ? parseVersionPart(b[i]) : 0;
            if (av != bv) return av - bv;
        }
        return 0;
    }

    private int parseVersionPart(String text) {
        try {
            String digits = text.replaceAll("[^0-9]", "");
            return digits.isEmpty() ? 0 : Integer.parseInt(digits);
        } catch (Exception ignored) {
            return 0;
        }
    }

    private void connectToLocal(String baseUrl) {
        closeTransport();
        resetRound();
        LocalPollingTransport local = new LocalPollingTransport(baseUrl, roomCode(), selectedGameType());
        transport = local;
        localAiMode = false;
        local.start();
        status("临时联机已启动：房间 " + roomCode());
    }

    private void sendChat() {
        String text = chatInput.getText().toString().trim();
        if (text.isEmpty()) return;
        chatInput.setText("");
        JSONObject data = new JSONObject();
        put(data, "type", "chat");
        put(data, "room", roomCode());
        put(data, "player", playerName);
        put(data, "message", text);
        sendEvent(data);
        append("我：" + text);
    }

    private void sendMove(int row, int col) {
        if (boardEditorMode) {
            BoardAnalysis.Position before = boardView.toAnalysisPosition(playerForStone(currentStone));
            boardEditorHistory.addLast(before);
            int columns = boardView.isChineseChess() ? 9 : boardView.analysisBoardSize();
            BoardAnalysis.Position edited = BoardAnalysis.editPosition(before, row * columns + col, boardEditorPiece);
            boardView.applyAnalysisPosition(edited);
            append("摆盘：已更新 " + (row + 1) + "," + (col + 1));
            return;
        }
        if (gameFinished) {
            append("系统：本局已结束，请重开。");
            return;
        }
        if (boardView.isRummy()) {
            if (transport == null || localAiMode) {
                String result = boardView.playLocalRummyTurn();
                append("系统：" + result);
                if (result.contains("获胜") || result.contains("结束")) gameFinished = true;
                return;
            }
            if (!boardView.isRummyMyTurn()) {
                append("系统：还没轮到你。");
                return;
            }
            JSONObject data = new JSONObject();
            put(data, "type", boardView.hasRummyDrawnThisTurn() ? "finish-turn" : "draw");
            put(data, "room", roomCode());
            put(data, "player", playerName);
            sendEvent(data);
            append(boardView.hasRummyDrawnThisTurn() ? "我：结束回合" : "我：摸牌");
            return;
        }
        if (boardView.isLudo()) {
            String result = boardView.playLudoTurn();
            append("系统：" + result);
            if (result.contains("获胜")) gameFinished = true;
            return;
        }
        if (boardView.isJunqi()) {
            if (!fallbackMode && transport != null && !localAiMode) {
                append("系统：陆战棋暗棋仅支持本地对局（暗子信息无法同步）。");
                return;
            }
            String result = boardView.playJunqiTap(row);
            if (!result.isEmpty()) append("系统：" + result);
            if (result.contains("获胜")) gameFinished = true;
            else if (result.contains("轮到蓝方")) main.postDelayed(this::playAiMove, 480);
            return;
        }
        if (boardView.isCheckers()) {
            if (!fallbackMode && transport != null && !localAiMode) {
                append("系统：中国跳棋当前仅支持本地对局。");
                return;
            }
            String result = boardView.playJumpTap(row);
            if (!result.isEmpty()) append("系统：" + result);
            if (result.contains("获胜")) gameFinished = true;
            else if (result.contains("轮到")) main.postDelayed(this::playAiMove, 520);
            return;
        }
        if (boardView.isChineseChess()) {
            String result = boardView.playChineseChessTap(row, col, currentStone);
            if (!result.isEmpty()) append("系统：" + result);
            if (result.contains("获胜")) {
                gameFinished = true;
            } else if (result.startsWith("已走")) {
                currentStone = "black".equals(currentStone) ? "white" : "black";
                if (localAiMode) main.postDelayed(this::playAiMove, 420);
            }
            return;
        }
        if (boardView.isPartyGame()) {
            append("系统：" + boardView.partyActionHint());
            return;
        }
        if (boardView.isMinesweeper()) {
            String result = boardView.playMinesweeperTap(row, col);
            append("系统：" + result);
            if (result.contains("完成") || result.contains("踩雷")) gameFinished = true;
            return;
        }
        if (!boardView.isPlayableBoard()) {
            append("系统：这个游戏的房间正在同步规则，不能用五子棋落子。");
            return;
        }
        if (!fallbackMode && transport != null && !myTurn) {
            append("系统：等待对方落子。");
            return;
        }
        String stone = fallbackMode ? currentStone : localStone;
        if (!boardView.canPlace(row, col, stone)) {
            append("系统：这里不能落子。");
            return;
        }
        if (supportsBoardStudy() && !boardView.isChineseChess()) {
            BoardAnalysis.Position position = boardView.toAnalysisPosition(playerForStone(stone));
            BoardAnalysis.ApplyResult applied = BoardAnalysis.applyMove(position,
                    new BoardAnalysis.Move(row * boardView.analysisBoardSize() + col));
            if (!applied.ok) {
                append("系统：" + applied.reason);
                return;
            }
            boardView.applyAnalysisPosition(applied.position);
        } else {
            boardView.place(row, col, stone);
        }
        String nextStone = "black".equals(stone) ? "white" : "black";
        String result = boardView.finishedResult();
        if (result != null) {
            append("系统：" + result);
            gameFinished = true;
        } else if (boardView.hasWinner(row, col, stone)) {
            append("系统：" + ("black".equals(stone) ? "黑棋" : "白棋") + "获胜。");
            gameFinished = true;
        } else if (boardView.isReversi() && !boardView.hasAnyMove(nextStone)) {
            append("系统：" + ("black".equals(nextStone) ? "黑棋" : "白棋") + "无可落子，自动跳过。");
            nextStone = stone;
        }
        currentStone = nextStone;
        myTurn = fallbackMode || transport == null;
        if (localAiMode) {
            main.postDelayed(this::playAiMove, 420);
            return;
        }
        JSONObject data = new JSONObject();
        put(data, "type", "move");
        put(data, "room", roomCode());
        put(data, "player", playerName);
        put(data, "row", row);
        put(data, "col", col);
        put(data, "r", row);
        put(data, "c", col);
        put(data, "stone", stone);
        sendEvent(data);
    }

    private void playAiMove() {
        if (!localAiMode || gameFinished) return;
        if (boardView.isJunqi()) {
            String result = boardView.playJunqiAi();
            if (!result.isEmpty()) append("AI：" + result);
            if (result.contains("获胜")) gameFinished = true;
            return;
        }
        if (boardView.isCheckers()) {
            // 黄方、蓝方依次自动走完，再交回玩家
            String result = boardView.playJumpAi();
            if (!result.isEmpty()) append("AI：" + result);
            if (result.contains("获胜")) {
                gameFinished = true;
                return;
            }
            if (!boardView.jump.finished && boardView.jump.turn != 1) {
                main.postDelayed(this::playAiMove, 420);
            }
            return;
        }
        if (boardView.isLudo()) {
            String result = boardView.playLudoTurn();
            append("AI：" + result);
            if (result.contains("获胜")) gameFinished = true;
            return;
        }
        if (supportsBoardStudy()) {
            BoardAnalysis.Position position = boardView.toAnalysisPosition(playerForStone(currentStone));
            BoardAnalysis.Analysis analysis = BoardAnalysis.analyze(position, BoardAnalysis.Difficulty.fromLevel(aiDifficulty));
            if (!analysis.ok || analysis.recommended == null) {
                append("AI：" + analysis.explanation);
                myTurn = true;
                return;
            }
            BoardAnalysis.ApplyResult applied = BoardAnalysis.applyMove(position, analysis.recommended);
            if (!applied.ok) {
                append("AI：" + applied.reason);
                myTurn = true;
                return;
            }
            boardView.applyAnalysisPosition(applied.position);
            append("AI：" + moveDescription(analysis.recommended) + " · " + analysis.explanation);
            currentStone = "black".equals(currentStone) ? "white" : "black";
            myTurn = true;
            return;
        }
        if (boardView.isPartyGame()) {
            append("AI：" + boardView.partyAiHint());
            myTurn = true;
            return;
        }
        if (!boardView.isPlayableBoard()) return;
        String aiStone = currentStone;
        int[] move = boardView.firstLegalMove(aiStone);
        if (move == null) {
            append("AI：没有可走位置。");
            return;
        }
        boardView.place(move[0], move[1], aiStone);
        append("AI：" + ("black".equals(aiStone) ? "黑" : "白") + " " + (move[0] + 1) + "," + (move[1] + 1));
        if (boardView.hasWinner(move[0], move[1], aiStone)) {
            append("系统：" + ("black".equals(aiStone) ? "黑棋" : "白棋") + "获胜。");
            gameFinished = true;
            return;
        }
        String result = boardView.finishedResult();
        if (result != null) {
            append("系统：" + result);
            gameFinished = true;
            return;
        }
        currentStone = "black".equals(aiStone) ? "white" : "black";
        myTurn = true;
    }

    private void requestReset() {
        if (transport == null) {
            resetRound();
            append("系统：已本地重开。");
            return;
        }
        JSONObject data = new JSONObject();
        put(data, "type", "reset-request");
        put(data, "room", roomCode());
        put(data, "player", playerName);
        sendEvent(data);
        append("系统：已提交重开申请。");
    }

    private void showResetVoteDialog(String requester, Runnable approve, Runnable reject) {
        main.post(() -> {
            if (resetVoteDialog != null && resetVoteDialog.isShowing()) resetVoteDialog.dismiss();
            resetVoteDialog = new AlertDialog.Builder(this)
                    .setTitle("重开申请")
                    .setMessage(requester + " 请求重开本局。是否同意？")
                    .setNegativeButton("拒绝", (dialog, which) -> reject.run())
                    .setPositiveButton("同意", (dialog, which) -> approve.run())
                    .setOnCancelListener(dialog -> reject.run())
                    .create();
            resetVoteDialog.setOnDismissListener(dialog -> resetVoteDialog = null);
            resetVoteDialog.show();
        });
    }

    private void dismissResetVoteDialog() {
        main.post(() -> {
            if (resetVoteDialog != null && resetVoteDialog.isShowing()) resetVoteDialog.dismiss();
            resetVoteDialog = null;
        });
    }

    private void sendResetVote(boolean approve) {
        JSONObject vote = new JSONObject();
        put(vote, "type", "reset-vote");
        put(vote, "roomId", roomCode());
        put(vote, "approve", approve);
        sendEvent(vote);
        append(approve ? "系统：已同意重开。" : "系统：已拒绝重开。");
    }

    private void sendEvent(JSONObject data) {
        if (transport == null) {
            append("系统：还没有连接房间。");
            return;
        }
        transport.send(data);
    }

    private void handleEvent(JSONObject event) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(() -> handleEvent(event));
            return;
        }
        String type = event.optString("type");
        String player = event.optString("player", "玩家");
        if ("chat".equals(type)) {
            if (!playerName.equals(player)) append(player + "：" + event.optString("message"));
        } else if ("move".equals(type)) {
            if (playerName.equals(player) || socketId.equals(event.optString("sender"))) return;
            String stone = normalizeStone(event, "white");
            boardView.place(event.optInt("row", event.optInt("r")), event.optInt("col", event.optInt("c")), stone);
            currentStone = "black".equals(stone) ? "white" : "black";
            myTurn = true;
        } else if ("place".equals(type)) {
            if (playerName.equals(player) || socketId.equals(event.optString("sender"))) return;
            String stone = normalizeStone(event, "white");
            boardView.place(event.optInt("row", event.optInt("r")), event.optInt("col", event.optInt("c")), stone);
            currentStone = "black".equals(stone) ? "white" : "black";
            myTurn = true;
        } else if ("reset".equals(type)) {
            resetRound();
            append("系统：全员同意，已重开。");
        } else if ("player-left".equals(type)) {
            append("系统：" + event.optString("player", "对方") + " 离线，60 秒内可回来。");
        } else if ("player-forfeit".equals(type)) {
            append("系统：" + event.optString("player", "对方") + " 超时未返回。");
        } else if ("game-over".equals(type)) {
            append("系统：" + event.optString("winner", "玩家") + " 胜利。");
        } else if ("system".equals(type)) {
            append("系统：" + event.optString("message"));
        }
    }

    private String normalizeStone(JSONObject event, String fallback) {
        Object raw = event.opt("stone");
        if (raw == null || JSONObject.NULL.equals(raw)) raw = event.opt("side");
        if (raw == null || JSONObject.NULL.equals(raw)) raw = event.opt("piece");
        if (raw instanceof Number) {
            int value = ((Number) raw).intValue();
            if (value == 1) return "black";
            if (value == -1 || value == 2) return "white";
        }
        String text = String.valueOf(raw == null || JSONObject.NULL.equals(raw) ? fallback : raw).trim().toLowerCase(Locale.ROOT);
        if ("1".equals(text) || "black".equals(text) || "b".equals(text) || "黑".equals(text)) return "black";
        if ("-1".equals(text) || "2".equals(text) || "white".equals(text) || "w".equals(text) || "白".equals(text)) return "white";
        return fallback;
    }

    private void assignRole(JSONArray players) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(() -> assignRole(players));
            return;
        }
        if (players == null) return;
        int index = -1;
        for (int i = 0; i < players.length(); i++) {
            JSONObject item = players.optJSONObject(i);
            String name = item == null ? players.optString(i) : item.optString("username", item.optString("name"));
            String displayName = item == null ? name : item.optString("displayName", item.optString("name"));
            String id = item == null ? "" : item.optString("id", item.optString("socketId"));
            if (playerName.equals(name) || playerName.equals(displayName) || socketId.equals(id)) {
                index = i;
                break;
            }
        }
        if (index < 0) return;
        localStone = index == 0 ? "black" : "white";
        myTurn = "black".equals(localStone) && "black".equals(currentStone);
        status("主站房间在线：" + roomCode() + "；你执" + ("black".equals(localStone) ? "黑" : "白"));
    }

    private void closeTransport() {
        if (voiceJoined) {
            voiceEngine.stop();
            JSONObject data = new JSONObject();
            put(data, "type", "voice-leave");
            put(data, "roomId", roomCode());
            if (transport != null) transport.send(data);
            voiceJoined = false;
        }
        if (transport != null) transport.stop();
        transport = null;
    }

    private void resetRound() {
        boardView.reset();
        currentStone = "black";
        localStone = "black";
        gameFinished = false;
        myTurn = true;
    }

    private String roomCode() {
        String source = roomField == null ? getPreferences(MODE_PRIVATE).getString("room", "") : roomField.getText().toString();
        String clean = source.replaceAll("[^A-Za-z0-9_-]", "");
        if (clean.isEmpty()) clean = String.valueOf(100000 + (int) (Math.random() * 900000));
        if (clean.length() > 12) clean = clean.substring(0, 12);
        if (roomField != null) roomField.setText(clean);
        getPreferences(MODE_PRIVATE).edit().putString("room", clean).apply();
        return clean;
    }

    private String normalizedGameType(String value) {
        String game = value == null ? "native-gobang" : value.toLowerCase(Locale.ROOT);
        if ("gobang".equals(game)) return "native-gobang";
        if ("reversi".equals(game)) return "native-reversi";
        if ("tictactoe".equals(game)) return "native-tictactoe";
        if ("chess".equals(game) || "xiangqi".equals(game)) return "chinese-chess";
        for (String supported : gameTypes.values()) {
            if (supported.equals(game)) return game;
        }
        return "native-gobang";
    }

    private String webGameType(String value) {
        if ("native-gobang".equals(value)) return "gobang";
        if ("native-reversi".equals(value)) return "reversi";
        if ("native-tictactoe".equals(value)) return "tictactoe";
        return value;
    }

    private String webGamePage(String gameType) {
        String game = webGameType(gameType);
        if ("chinese-chess".equals(game)) return "chess.html";
        return game.replaceAll("[^a-z0-9-]", "") + ".html";
    }

    private void continueOnWeb() {
        if (!sessionStarted || fallbackMode) {
            showMessage("在网页中继续", "请先加入一个主站联机房间。");
            return;
        }
        String game = selectedGameType();
        String room = roomCode();
        long expires = System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(10);
        String invite = UUID.randomUUID().toString().replace("-", "");
        Uri url = Uri.parse(boardApiBase() + "/boardgames/" + webGamePage(game)).buildUpon()
                .appendQueryParameter("v", "1")
                .appendQueryParameter("purpose", "continue")
                .appendQueryParameter("game", webGameType(game))
                .appendQueryParameter("room", room)
                .appendQueryParameter("autojoin", "1")
                .appendQueryParameter("invite", invite)
                .appendQueryParameter("expires", String.valueOf(expires))
                .build();
        startActivity(new Intent(Intent.ACTION_VIEW, url));
    }

    private void handleAppLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"zhengzhengboardgames".equals(data.getScheme()) || !"join".equals(data.getHost())) return;
        BoardAnalysis.InviteResult parsed = parseRoomInvite(data);
        if (!parsed.ok || parsed.invite == null) {
            showMessage("房间邀请", parsed.reason);
            return;
        }
        BoardAnalysis.RoomInvite invite = parsed.invite;
        String game = normalizedGameType(invite.game);
        String title = "continue".equals(invite.purpose) ? "继续对局" : "接受挑战";
        String message = "棋种：" + titleForGameType(game) + "\n房间：" + invite.room
                + "\n用途：" + ("continue".equals(invite.purpose) ? "接续当前对局" : "对弈申请");
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setNegativeButton("取消", null)
                .setPositiveButton("确认加入", (dialog, which) -> {
                    selectedGameTypeValue = game;
                    getPreferences(MODE_PRIVATE).edit().putString("room", invite.room).apply();
                    if (roomField != null) roomField.setText(invite.room);
                    connectCloud();
                })
                .show();
    }

    private BoardAnalysis.InviteResult parseRoomInvite(Uri data) {
        return BoardAnalysis.tryParseRoomInvite(data.toString(), System.currentTimeMillis());
    }

    private String selectedGameType() {
        return selectedGameTypeValue == null ? "native-gobang" : selectedGameTypeValue;
    }

    private void setGameSelection(String gameType) {
        selectedGameTypeValue = gameType == null ? "native-gobang" : gameType;
        if (boardView != null) boardView.setGame(gameType);
    }

    private String titleForGameType(String gameType) {
        for (Map.Entry<String, String> entry : gameTypes.entrySet()) {
            if (entry.getValue().equals(gameType)) return entry.getKey();
        }
        return "五子棋";
    }

    private int maxPlayersForGame(String gameType) {
        if ("werewolf".equals(gameType)) return 12;
        if ("spy".equals(gameType)) return 10;
        if ("poker".equals(gameType)) return 6;
        if ("landlord".equals(gameType)) return 3;
        if ("checkers".equals(gameType)) return 3;
        if ("junqi".equals(gameType)) return 2;
        if ("ludo".equals(gameType) || "rummy".equals(gameType)
                || "mahjong".equals(gameType) || "monopoly".equals(gameType)) return 4;
        return 2;
    }

    private void append(String line) {
        main.post(() -> {
            if (chatLog != null) {
                chatLog.append(line + "\n");
            }
        });
    }

    private void status(String text) {
        connectionStatus = text;
        main.post(() -> {
            if (statusText != null) statusText.setText(text);
        });
    }

    private void loadPassportUser() {
        String raw = getPreferences(MODE_PRIVATE).getString("passport_user", "");
        if (!raw.isEmpty()) {
            try { passportUser = new JSONObject(raw); } catch (Exception ignored) { passportUser = null; }
        }
        playerName = displayName(passportUser);
    }

    private String displayName(JSONObject user) {
        if (user != null) {
            String nickname = user.optString("nickname", "").trim();
            if (!nickname.isEmpty()) return nickname;
            String username = user.optString("username", "").trim();
            if (!username.isEmpty()) return username;
            String display = user.optString("displayName", "").trim();
            if (!display.isEmpty()) return display;
        }
        return "铮铮玩家" + (100 + (int) (Math.random() * 900));
    }

    private String clientDeviceId() {
        String existing = getPreferences(MODE_PRIVATE).getString("device_id", "");
        if (!existing.isEmpty()) return existing;
        String generated = UUID.randomUUID().toString();
        getPreferences(MODE_PRIVATE).edit().putString("device_id", generated).apply();
        return generated;
    }

    private void showPassportLoginDialog() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(22), dp(20), dp(22), dp(18));
        box.setBackground(roundedBg(COLOR_SURFACE, COLOR_LINE, 8));

        TextView title = label("铮铮通行证", 20, Color.WHITE, true);
        box.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)));

        TextView subtitle = label("登录后同步到联机房间身份。", 12, COLOR_MUTED, false);
        box.addView(subtitle, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));

        EditText account = styledDialogEdit("通行证账号");
        account.setText(getPreferences(MODE_PRIVATE).getString("passport_account", ""));
        EditText password = styledDialogEdit("密码");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(account, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));
        addSpacer(box, 10);
        box.addView(password, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));

        TextView dialogStatus = label("", 12, COLOR_MUTED, false);
        dialogStatus.setPadding(0, dp(8), 0, 0);
        box.addView(dialogStatus, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)));

        LinearLayout actions = row();
        actions.setPadding(0, 0, 0, 0);
        Button register = button("注册");
        register.setTextColor(COLOR_ACCENT);
        register.setBackground(roundedBg(Color.argb(18, 255, 255, 255), Color.argb(110, 34, 211, 238), 10));
        Button login = button("登录");
        login.setBackground(roundedBg(COLOR_ACCENT, Color.TRANSPARENT, 8));
        actions.addView(register, new LinearLayout.LayoutParams(0, dp(42), 1));
        LinearLayout.LayoutParams loginParams = new LinearLayout.LayoutParams(0, dp(42), 1);
        loginParams.leftMargin = dp(12);
        actions.addView(login, loginParams);
        box.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)));

        AlertDialog dialog = new AlertDialog.Builder(this).setView(box).create();
        register.setOnClickListener(v -> registerPassport(
                account.getText().toString().trim(),
                password.getText().toString(),
                dialogStatus,
                () -> loginPassport(account.getText().toString().trim(), password.getText().toString(), dialogStatus, dialog::dismiss)
        ));
        login.setOnClickListener(v -> loginPassport(account.getText().toString().trim(), password.getText().toString(), dialogStatus, dialog::dismiss));
        dialog.setOnShowListener(d -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            }
        });
        dialog.show();
    }

    private void loginPassport(String account, String password) {
        loginPassport(account, password, null, null);
    }

    private void loginPassport(String account, String password, TextView dialogStatus, Runnable onSuccess) {
        if (account.isEmpty() || password.isEmpty()) {
            setLoginStatus(dialogStatus, "请填写通行证账号和密码");
            return;
        }
        setLoginStatus(dialogStatus, "通行证登录中...");
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("username", account);
                payload.put("account", account);
                payload.put("password", password);
                JSONObject response = new JSONObject(httpPostJson("https://zhengzhengstudio.cn/api/auth/login", payload.toString()));
                if (!response.optBoolean("success")) throw new Exception(response.optString("error", "登录失败"));
                passportUser = response.optJSONObject("user");
                playerName = displayName(passportUser);
                getPreferences(MODE_PRIVATE).edit()
                        .putString("passport_account", account)
                        .putString("passport_user", passportUser == null ? "" : passportUser.toString())
                        .apply();
                status("已登录：" + playerName);
                main.post(() -> {
                    passportButton.setText(playerName);
                    setLoginStatus(dialogStatus, "已登录：" + playerName);
                    if (onSuccess != null) main.postDelayed(onSuccess, 550);
                });
                append("系统：通行证已登录为 " + playerName);
            } catch (Exception error) {
                setLoginStatus(dialogStatus, "通行证登录失败：" + error.getMessage());
            }
        }).start();
    }

    private void registerPassport(String account, String password, TextView dialogStatus, Runnable onSuccess) {
        // 与服务端原生端规则保持一致：8 位起，否则会被接口拒绝。
        if (account.length() < 3 || password.length() < 8) {
            setLoginStatus(dialogStatus, "账号至少 3 位，密码至少 8 位");
            return;
        }
        setLoginStatus(dialogStatus, "注册中...");
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("username", account);
                payload.put("nickname", account);
                payload.put("password", password);
                payload.put("email", "");
                payload.put("phone", "");
                // 不再发送 bypassValidation：服务端已明确不信任该字段，
                // 原生端凭 X-Passport-Client 标识走受控通道，可只填账号密码。
                JSONObject response = new JSONObject(httpPostJson("https://zhengzhengstudio.cn/api/auth/register", payload.toString()));
                if (!response.optBoolean("success")) throw new Exception(response.optString("error", "注册失败"));
                main.post(() -> {
                    setLoginStatus(dialogStatus, "注册成功，正在登录...");
                    if (onSuccess != null) onSuccess.run();
                });
            } catch (Exception error) {
                setLoginStatus(dialogStatus, "注册失败：" + error.getMessage());
            }
        }).start();
    }

    private void setLoginStatus(TextView view, String text) {
        if (view == null) {
            status(text);
            return;
        }
        main.post(() -> view.setText(text));
    }

    private void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (Exception ignored) {}
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(4), 0, dp(4));
        return row;
    }

    private LinearLayout.LayoutParams settingsActionParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(44));
        params.setMargins(0, dp(4), 0, dp(4));
        return params;
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(sp);
        label.setTextColor(color);
        if (bold) label.setTypeface(Typeface.DEFAULT_BOLD);
        return label;
    }

    private LinearLayout dialogCard(String title, String message) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(22), dp(20), dp(22), dp(18));
        card.setBackground(roundedBg(COLOR_SURFACE, COLOR_LINE, 8));
        TextView titleView = label(title, 21, COLOR_TEXT, true);
        card.addView(titleView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)));
        ScrollView scroll = new ScrollView(this);
        TextView body = label(message, 15, COLOR_MUTED, false);
        body.setLineSpacing(dp(2), 1f);
        body.setPadding(0, dp(8), 0, dp(4));
        scroll.addView(body);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bodyParams.setMargins(0, dp(6), 0, 0);
        card.addView(scroll, bodyParams);
        return card;
    }

    private EditText edit(String hint) {
        EditText edit = new EditText(this);
        edit.setHint(hint);
        edit.setTextColor(COLOR_TEXT);
        edit.setHintTextColor(COLOR_SOFT);
        edit.setSingleLine(true);
        edit.setInputType(InputType.TYPE_CLASS_TEXT);
        edit.setTextSize(14);
        edit.setPadding(dp(12), 0, dp(12), 0);
        edit.setBackground(roundedBg(COLOR_SURFACE_RAISED, COLOR_LINE, 8));
        return edit;
    }

    private EditText styledDialogEdit(String hint) {
        EditText edit = edit(hint);
        edit.setBackground(roundedBg(COLOR_SURFACE_SOFT, COLOR_LINE, 8));
        return edit;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(14);
        button.setTextColor(COLOR_TEXT);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setBackground(roundedBg(COLOR_SURFACE_RAISED, COLOR_LINE, 8));
        return button;
    }

    private Button accentButton(String text) {
        Button button = button(text);
        button.setTextColor(Color.WHITE);
        button.setBackground(roundedBg(COLOR_ACCENT_DARK, Color.TRANSPARENT, 8));
        return button;
    }

    private Button subtleButton(String text) {
        Button button = button(text);
        button.setTextColor(COLOR_MUTED);
        button.setBackground(roundedBg(COLOR_SURFACE_SOFT, COLOR_LINE, 8));
        return button;
    }

    private static final class TabletopBackdrop extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int top;
        private final int bottom;
        private final int line;

        TabletopBackdrop(int top, int bottom, int line) {
            this.top = top;
            this.bottom = bottom;
            this.line = line;
        }

        @Override
        public void draw(Canvas canvas) {
            Rect bounds = getBounds();
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(top);
            canvas.drawRect(bounds, paint);
            paint.setColor(bottom);
            canvas.drawRect(bounds.left, bounds.top + bounds.height() * 0.58f,
                    bounds.right, bounds.bottom, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f);
            paint.setColor(Color.argb(30, Color.red(line), Color.green(line), Color.blue(line)));
            for (float x = bounds.left - bounds.height(); x < bounds.right; x += 72f) {
                canvas.drawLine(x, bounds.top, x + bounds.height(), bounds.bottom, paint);
            }
            paint.setColor(Color.argb(18, Color.red(COLOR_GOLD), Color.green(COLOR_GOLD), Color.blue(COLOR_GOLD)));
            for (float y = bounds.top + 54f; y < bounds.bottom; y += 108f) {
                canvas.drawLine(bounds.left, y, bounds.right, y, paint);
            }
        }

        @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
        @Override public void setColorFilter(android.graphics.ColorFilter colorFilter) { paint.setColorFilter(colorFilter); }
        @Override public int getOpacity() { return android.graphics.PixelFormat.OPAQUE; }
    }

    private LinearLayout panel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(14), dp(12), dp(14), dp(12));
        panel.setBackground(roundedBg(COLOR_SURFACE, COLOR_LINE, 8));
        return panel;
    }

    private GridLayout gameGrid(boolean compact, boolean wide, boolean streamline) {
        GridLayout grid = new GridLayout(this);
        int columns = streamline ? 5 : (wide ? 4 : 2);
        grid.setColumnCount(columns);
        grid.setPadding(0, dp(4), 0, 0);
        for (Map.Entry<String, String> entry : gameTypes.entrySet()) {
            if (!"全部".equals(selectedGameCategory)
                    && !selectedGameCategory.equals(categoryForGame(entry.getValue()))) continue;
            Button chip = gameChip(entry.getKey(), entry.getValue(), compact);
            GridLayout.LayoutParams params = new GridLayout.LayoutParams(
                    GridLayout.spec(GridLayout.UNDEFINED),
                    GridLayout.spec(GridLayout.UNDEFINED, 1f));
            params.width = 0;
            params.height = dp(compact ? 72 : 78);
            params.setMargins(dp(4), dp(4), dp(4), dp(4));
            grid.addView(chip, params);
        }
        return grid;
    }

    private void filterGameLibrary() {
        if (gameLibraryGrid == null) return;
        String term = gameSearchInput == null ? "" : gameSearchInput.getText().toString().trim().toLowerCase();
        gameLibraryGrid.removeAllViews();
        for (Map.Entry<String, String> entry : gameTypes.entrySet()) {
            String category = categoryForGame(entry.getValue());
            boolean categoryMatches = "全部".equals(selectedGameCategory) || selectedGameCategory.equals(category);
            String searchable = (entry.getKey() + " " + category + " " + playersForGame(entry.getValue())).toLowerCase();
            if (!categoryMatches || (!term.isEmpty() && !searchable.contains(term))) continue;
            Button chip = gameChip(entry.getKey(), entry.getValue(), gameLibraryCompact);
            GridLayout.LayoutParams params = new GridLayout.LayoutParams(
                    GridLayout.spec(GridLayout.UNDEFINED), GridLayout.spec(GridLayout.UNDEFINED, 1f));
            params.width = 0;
            params.height = dp(gameLibraryCompact ? 72 : 78);
            params.setMargins(dp(4), dp(4), dp(4), dp(4));
            gameLibraryGrid.addView(chip, params);
        }
        updateGameLibraryCount(gameLibraryGrid.getChildCount());
    }

    private void updateGameLibraryCount(int count) {
        if (gameLibraryCount != null) gameLibraryCount.setText("找到 " + count + " 款桌游");
    }

    private Button gameChip(String title, String gameType, boolean compact) {
        Button chip = button(title + "\n" + categoryForGame(gameType) + " · " + playersForGame(gameType));
        boolean selected = gameType.equals(selectedGameTypeValue);
        chip.setTextSize(compact ? 12 : 13);
        chip.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
        chip.setPadding(dp(12), 0, dp(10), 0);
        chip.setTextColor(selected ? Color.WHITE : COLOR_MUTED);
        chip.setBackground(roundedBg(selected ? gameAccent(gameType) : COLOR_SURFACE,
                selected ? Color.TRANSPARENT : COLOR_LINE, 8));
        chip.setOnClickListener(v -> {
            selectedGameTypeValue = gameType;
            resetRound();
            currentPage = "lobby";
            buildLayout();
        });
        return chip;
    }

    private String categoryForGame(String gameType) {
        if ("rummy".equals(gameType) || "poker".equals(gameType)
                || "landlord".equals(gameType) || "mahjong".equals(gameType)) return "牌类";
        if ("spy".equals(gameType) || "werewolf".equals(gameType)) return "聚会";
        if ("ludo".equals(gameType) || "monopoly".equals(gameType)
                || "minesweeper".equals(gameType) || "checkers".equals(gameType)) return "休闲";
        return "棋类";
    }

    private int gameAccent(String gameType) {
        String category = categoryForGame(gameType);
        if ("牌类".equals(category)) return Color.rgb(154, 78, 48);
        if ("聚会".equals(category)) return Color.rgb(104, 75, 146);
        if ("休闲".equals(category)) return Color.rgb(42, 105, 144);
        if ("native-reversi".equals(gameType) || "go".equals(gameType)) return Color.rgb(38, 105, 76);
        return Color.rgb(31, 116, 82);
    }

    private String playersForGame(String gameType) {
        if ("werewolf".equals(gameType)) return "6-12 人";
        if ("spy".equals(gameType)) return "4-10 人";
        if ("poker".equals(gameType)) return "2-6 人";
        if ("landlord".equals(gameType)) return "3 人";
        if ("ludo".equals(gameType) || "rummy".equals(gameType)
                || "mahjong".equals(gameType) || "monopoly".equals(gameType)) return "2-4 人";
        if ("checkers".equals(gameType)) return "2-3 人";
        return "2 人";
    }

    private void addSpacer(LinearLayout parent, int dpValue) {
        View spacer = new View(this);
        parent.addView(spacer, new LinearLayout.LayoutParams(1, dp(dpValue)));
    }

    private GradientDrawable roundedBg(int fill, int stroke, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int screenWidthDp() {
        return Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
    }

    private int screenHeightDp() {
        return Math.round(getResources().getDisplayMetrics().heightPixels / getResources().getDisplayMetrics().density);
    }

    private String localIp() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface item : Collections.list(interfaces)) {
                for (InetAddress address : Collections.list(item.getInetAddresses())) {
                    if (!address.isLoopbackAddress() && address instanceof Inet4Address) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    final class NativeVoiceEngine {
        private static final int SAMPLE_RATE = 16000;
        private final AtomicBoolean running = new AtomicBoolean(false);
        private final LinkedBlockingQueue<byte[]> playbackQueue = new LinkedBlockingQueue<>(10);
        private AudioRecord recorder;
        private AudioTrack player;
        private Thread captureThread;
        private Thread playbackThread;
        private long sequence;

        boolean start() {
            if (running.get()) return true;
            try {
                int inputMinimum = AudioRecord.getMinBufferSize(
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT);
                int outputMinimum = AudioTrack.getMinBufferSize(
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_OUT_MONO,
                        AudioFormat.ENCODING_PCM_16BIT);
                if (inputMinimum <= 0 || outputMinimum <= 0) return false;
                recorder = new AudioRecord(
                        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(inputMinimum * 2, 6400));
                player = new AudioTrack(
                        AudioManager.STREAM_VOICE_CALL,
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_OUT_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(outputMinimum * 2, 6400),
                        AudioTrack.MODE_STREAM);
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED || player.getState() != AudioTrack.STATE_INITIALIZED) {
                    stop();
                    return false;
                }
                running.set(true);
                recorder.startRecording();
                player.play();
                captureThread = new Thread(this::captureLoop, "boardgame-voice-capture");
                playbackThread = new Thread(this::playbackLoop, "boardgame-voice-playback");
                captureThread.start();
                playbackThread.start();
                return true;
            } catch (Exception error) {
                stop();
                return false;
            }
        }

        private void captureLoop() {
            byte[] frame = new byte[3200];
            while (running.get()) {
                int read = recorder == null ? -1 : recorder.read(frame, 0, frame.length);
                if (read <= 0 || transport == null) continue;
                JSONObject payload = new JSONObject();
                put(payload, "type", "voice-frame");
                put(payload, "roomId", roomCode());
                put(payload, "codec", "pcm16");
                put(payload, "sampleRate", SAMPLE_RATE);
                put(payload, "sequence", sequence++);
                put(payload, "data", Base64.encodeToString(frame, 0, read, Base64.NO_WRAP));
                transport.send(payload);
            }
        }

        void enqueue(String encoded) {
            if (!running.get() || encoded == null || encoded.length() == 0 || encoded.length() > 24576) return;
            try {
                byte[] frame = Base64.decode(encoded, Base64.DEFAULT);
                if (!playbackQueue.offer(frame)) {
                    playbackQueue.poll();
                    playbackQueue.offer(frame);
                }
            } catch (IllegalArgumentException ignored) {}
        }

        private void playbackLoop() {
            while (running.get()) {
                try {
                    byte[] frame = playbackQueue.poll(300, TimeUnit.MILLISECONDS);
                    if (frame != null && player != null) player.write(frame, 0, frame.length);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        void stop() {
            running.set(false);
            playbackQueue.clear();
            if (recorder != null) {
                try { recorder.stop(); } catch (Exception ignored) {}
                recorder.release();
                recorder = null;
            }
            if (player != null) {
                try { player.stop(); } catch (Exception ignored) {}
                player.release();
                player = null;
            }
            if (captureThread != null) captureThread.interrupt();
            if (playbackThread != null) playbackThread.interrupt();
            captureThread = null;
            playbackThread = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (downloadReceiverRegistered) {
            try { unregisterReceiver(apkDownloadReceiver); } catch (Exception ignored) {}
            downloadReceiverRegistered = false;
        }
        voiceEngine.stop();
        closeTransport();
        if (localServer != null) localServer.stop();
        super.onDestroy();
    }

    interface RealtimeTransport {
        void start();
        void send(JSONObject event);
        void stop();
    }

    final class CloudSocketTransport implements RealtimeTransport {
        private final String room;
        private final String gameType;
        private volatile boolean running;
        private final OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(8, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(8, TimeUnit.SECONDS)
                .pingInterval(20, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
        private WebSocket webSocket;
        private int reconnectAttempts = 0;
        private boolean joinedRoom = false;
        private boolean joinSent = false;
        private static final int MAX_RECONNECT_ATTEMPTS = 8;

        CloudSocketTransport(String room, String gameType) {
            this.room = room;
            this.gameType = gameType;
        }

        public void start() {
            running = true;
            reconnectAttempts = 0;
            joinedRoom = false;
            joinSent = false;
            openSocket();
        }

        private void openSocket() {
            if (!running) return;
            Request request = new Request.Builder().url(BOARDGAMES_WS).build();
            webSocket = client.newWebSocket(request, new WebSocketListener() {
                @Override
                public void onOpen(WebSocket ws, Response response) {
                    reconnectAttempts = 0;
                    status("主站实时握手中：房间 " + room);
                }

                @Override
                public void onMessage(WebSocket ws, String text) {
                    handleWsMessage(text);
                }

                @Override
                public void onFailure(WebSocket ws, Throwable t, Response response) {
                    if (!running) return;
                    scheduleReconnect(t == null ? "连接失败" : t.getMessage());
                }

                @Override
                public void onClosed(WebSocket ws, int code, String reason) {
                    if (!running) return;
                    scheduleReconnect(reason == null || reason.isEmpty() ? "连接关闭" : reason);
                }
            });
        }

        private void scheduleReconnect(String reason) {
            joinedRoom = false;
            joinSent = false;
            reconnectAttempts += 1;
            if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                status("主站连接暂不可用，临时联机自动接管");
                startFallbackServer(reason);
                return;
            }
            long delayMs = Math.min(8000L, 450L * (1L << Math.min(reconnectAttempts - 1, 4)));
            main.post(() -> status("主站实时恢复中 " + reconnectAttempts + "/" + MAX_RECONNECT_ATTEMPTS));
            main.postDelayed(() -> {
                if (!running || fallbackMode) return;
                openSocket();
            }, delayMs);
        }

        private void joinCloudRoom() throws Exception {
            if (joinSent) return;
            joinSent = true;
            JSONObject payload = new JSONObject();
            payload.put("type", "join-room");
            payload.put("roomId", room);
            payload.put("username", playerName);
            payload.put("clientDeviceId", clientDeviceId());
            payload.put("user", passportUser == null ? new JSONObject().put("username", playerName) : passportUser);
            payload.put("gameType", gameType);
            payload.put("maxPlayers", maxPlayersForGame(gameType));
            sendRaw(payload);
            JSONObject system = new JSONObject();
            system.put("type", "system");
            system.put("message", "已加入主站房间 " + room);
            handleEvent(system);
        }

        public void send(JSONObject event) {
            if ("voice-frame".equals(event.optString("type"))) {
                try {
                    JSONObject payload = new JSONObject(event.toString());
                    if (!payload.has("roomId")) payload.put("roomId", room);
                    sendRaw(payload);
                } catch (Exception ignored) {}
                return;
            }
            new Thread(() -> {
                try {
                    if ("chat".equals(event.optString("type"))) {
                        JSONObject payload = new JSONObject();
                        payload.put("type", "chat-message");
                        payload.put("roomId", room);
                        payload.put("username", playerName);
                        payload.put("message", event.optString("message"));
                        sendRaw(payload);
                    } else if ("reset-request".equals(event.optString("type"))) {
                        JSONObject payload = new JSONObject();
                        payload.put("type", "reset-request");
                        payload.put("roomId", room);
                        sendRaw(payload);
                    } else if ("reset-vote".equals(event.optString("type"))) {
                        JSONObject payload = new JSONObject();
                        payload.put("type", "reset-vote");
                        payload.put("roomId", room);
                        payload.put("approve", event.optBoolean("approve"));
                        sendRaw(payload);
                    } else if (event.optString("type").startsWith("voice-")) {
                        JSONObject payload = new JSONObject(event.toString());
                        if (!payload.has("roomId")) payload.put("roomId", room);
                        sendRaw(payload);
                    } else {
                        JSONObject payload = new JSONObject();
                        payload.put("type", "sync-action");
                        payload.put("roomId", room);
                        payload.put("action", event.optString("type"));
                        payload.put("data", event);
                        sendRaw(payload);
                    }
                } catch (Exception error) {
                    append("系统：发送失败 " + error.getMessage());
                }
            }).start();
        }

        private void sendRaw(JSONObject payload) {
            WebSocket ws = webSocket;
            if (ws != null && joinedRoom) {
                ws.send(payload.toString());
            } else if (ws != null && "join-room".equals(payload.optString("type"))) {
                ws.send(payload.toString());
            } else {
                scheduleReconnect("发送时连接未就绪");
            }
        }

        private void handleWsMessage(String text) {
            try {
                JSONObject body = new JSONObject(text);
                String name = body.optString("type", "");
                if ("connected".equals(name)) {
                    socketId = body.optString("id", socketId);
                    joinedRoom = true;
                    try {
                        joinCloudRoom();
                        status("主站实时已连接：房间 " + room);
                    } catch (Exception error) {
                        append("系统：加入房间失败 " + error.getMessage());
                    }
                } else if ("chat-message".equals(name)) {
                        JSONObject event = new JSONObject();
                        event.put("type", "chat");
                        event.put("player", body.optString("username", "玩家"));
                        event.put("message", body.optString("message"));
                        handleEvent(event);
                } else if ("game-state".equals(name)) {
                        JSONObject snapshot = body;
                        main.post(() -> {
                            boardView.applyBoardState(snapshot);
                            String next = snapshot.optInt("currentPlayer", 1) == -1 ? "white" : "black";
                            currentStone = next;
                            myTurn = localStone.equals(currentStone);
                            status("主站对局同步 · 房间 " + room);
                        });
                } else if ("rummy-state".equals(name)) {
                        JSONObject snapshot = body;
                        main.post(() -> {
                            boardView.applyRummyState(snapshot);
                            status(boardView.isRummyMyTurn() ? "拉密：你的回合" : "拉密：等待对手");
                        });
                } else if ("game-started".equals(name) || "game-start".equals(name)) {
                        JSONObject snapshot = body;
                        main.post(() -> {
                            gameFinished = false;
                            boardView.applyBoardState(snapshot);
                            String next = snapshot.optInt("currentPlayer", 1) == -1 ? "white" : "black";
                            currentStone = next;
                            myTurn = localStone.equals(currentStone);
                            status(myTurn ? "主站对局中 · 你的回合" : "主站对局中 · 等待对方");
                        });
                } else if ("game-event".equals(name) || "sync-action".equals(name)) {
                        JSONObject data = body.optJSONObject("data");
                        if (data != null) {
                            data.put("type", body.optString("action", data.optString("type")));
                            data.put("sender", body.optString("sender"));
                            handleEvent(data);
                        }
                } else if ("room-info".equals(name) || "room-update".equals(name) || "room-joined".equals(name)) {
                        JSONObject roomBody = "room-joined".equals(name) ? body.optJSONObject("room") : body;
                        if (roomBody == null) roomBody = body;
                        JSONArray players = body.optJSONArray("players");
                        if (players == null) players = roomBody.optJSONArray("players");
                        String roomStatus = body.optString("status", "waiting");
                        if (!body.has("status")) roomStatus = roomBody.optString("status", "waiting");
                        assignRole(players);
                        if ("waiting".equals(roomStatus) && isOwner(players) && players != null && players.length() >= 2) {
                            JSONObject start = new JSONObject();
                            start.put("type", "start-game");
                            start.put("roomId", room);
                            if ("rummy".equals(gameType)) {
                                JSONObject initial = new JSONObject();
                                initial.put("gameType", "rummy");
                                start.put("initialGameState", initial);
                            }
                            sendRaw(start);
                            append("系统：人数已到，房主自动开始对局。");
                        }
                        status("playing".equals(roomStatus) ? "主站对局中：" + room : "等待房主开始：" + room);
                } else if ("reset-requested".equals(name)) {
                        String requester = body.optString("requester", "房主");
                        append("系统：" + requester + " 请求重开。");
                        if (requester.equals(playerName)) {
                            append("系统：等待其他玩家确认。");
                        } else {
                            showResetVoteDialog(
                                    requester,
                                    () -> sendResetVote(true),
                                    () -> sendResetVote(false)
                            );
                        }
                } else if ("reset-vote-update".equals(name)) {
                        append("系统：重开确认 " + body.optInt("approvals", 0) + "/" + body.optInt("required", 0));
                } else if ("reset-rejected".equals(name)) {
                        dismissResetVoteDialog();
                        append("系统：" + body.optString("username", "玩家") + " 拒绝了重开申请。");
                } else if ("reset-approved".equals(name)) {
                        dismissResetVoteDialog();
                        JSONObject event = new JSONObject();
                        event.put("type", "reset");
                        handleEvent(event);
                } else if ("player-left".equals(name)) {
                        JSONObject event = new JSONObject();
                        event.put("type", "player-left");
                        event.put("player", body.optString("username", "对方"));
                        handleEvent(event);
                } else if ("player-forfeit".equals(name)) {
                        JSONObject event = new JSONObject();
                        event.put("type", "player-forfeit");
                        event.put("player", body.optString("username", "对方"));
                        handleEvent(event);
                } else if ("game-over".equals(name) || "game-finished".equals(name)) {
                        JSONObject event = new JSONObject();
                        event.put("type", "game-over");
                        event.put("winner", body.optString("winner", "玩家"));
                        handleEvent(event);
                } else if ("voice-members".equals(name)) {
                    JSONArray members = body.optJSONArray("members");
                    append("系统：语音成员 " + (members == null ? 0 : members.length()) + " 人");
                } else if ("voice-frame".equals(name)) {
                    if (!socketId.equals(body.optString("from"))) {
                        voiceEngine.enqueue(body.optString("data"));
                    }
                    } else if ("error".equals(name)) {
                    append("系统：" + body.optString("message", "服务器拒绝了这次操作"));
                    }
            } catch (Exception error) {
                append("系统：WS 消息解析失败 " + error.getMessage());
            }
        }

        private boolean isOwner(JSONArray players) {
            if (players == null) return false;
            for (int i = 0; i < players.length(); i++) {
                JSONObject item = players.optJSONObject(i);
                if (item == null) continue;
                String name = item.optString("username", item.optString("name"));
                String displayName = item.optString("displayName", item.optString("name"));
                String id = item.optString("id", item.optString("socketId"));
                if ((playerName.equals(name) || playerName.equals(displayName) || socketId.equals(id)) && item.optBoolean("isOwner")) return true;
            }
            return false;
        }

        public void stop() {
            running = false;
            if (webSocket != null) webSocket.close(1000, "leave");
            client.dispatcher().executorService().shutdown();
        }
    }

    final class LocalPollingTransport implements RealtimeTransport {
        private final String baseUrl;
        private final String room;
        private final String gameType;
        private volatile boolean running;
        private int since;

        LocalPollingTransport(String baseUrl, String room, String gameType) {
            this.baseUrl = baseUrl;
            this.room = room;
            this.gameType = gameType;
        }

        public void start() {
            running = true;
            JSONObject join = new JSONObject();
            put(join, "type", "system");
            put(join, "room", room);
            put(join, "game", gameType);
            put(join, "player", playerName);
            put(join, "message", playerName + " 加入临时联机。");
            send(join);
            new Thread(() -> {
                while (running) {
                    try {
                        JSONArray events = new JSONArray(httpGet(baseUrl + "/events?room=" + enc(room) + "&since=" + since));
                        for (int index = 0; index < events.length(); index++) {
                            JSONObject event = events.getJSONObject(index);
                            since = Math.max(since, event.optInt("id"));
                            handleEvent(event);
                        }
                        Thread.sleep(650);
                    } catch (Exception error) {
                        status("临时联机连接失败：" + error.getMessage());
                        try { Thread.sleep(1200); } catch (Exception ignored) {}
                    }
                }
            }).start();
        }

        public void send(JSONObject event) {
            new Thread(() -> {
                try {
                    event.put("room", room);
                    httpPost(baseUrl + "/event", event.toString());
                } catch (Exception error) {
                    append("系统：临时联机发送失败 " + error.getMessage());
                }
            }).start();
        }

        public void stop() { running = false; }
    }

    final class LocalRoomServer {
        private final int port;
        private final CopyOnWriteArrayList<JSONObject> events = new CopyOnWriteArrayList<>();
        private volatile boolean running;
        private ServerSocket socket;
        private int nextId;

        LocalRoomServer(int port) { this.port = port; }

        void start() {
            running = true;
            new Thread(() -> {
                try {
                    socket = new ServerSocket(port);
                    while (running) new Thread(() -> handleClient(accept())).start();
                } catch (Exception error) {
                    status("临时联机启动失败：" + error.getMessage());
                }
            }).start();
        }

        private Socket accept() {
            try { return socket.accept(); } catch (Exception error) { return null; }
        }

        private void handleClient(Socket client) {
            if (client == null) return;
            try {
                BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = reader.readLine();
                if (request == null) return;
                int length = 0;
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) {
                        length = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                    }
                }
                String body = "";
                if (length > 0) {
                    char[] data = new char[length];
                    int read = reader.read(data);
                    body = new String(data, 0, Math.max(0, read));
                }
                if (request.startsWith("OPTIONS")) {
                    respond(client, "200 OK", "text/plain", "ok");
                } else if (request.startsWith("POST /event")) {
                    JSONObject event = new JSONObject(body);
                    event.put("id", ++nextId);
                    events.add(event);
                    respond(client, "200 OK", "application/json", "{\"ok\":true}");
                } else if (request.startsWith("GET /events")) {
                    Map<String, String> query = parseQuery(request);
                    String room = query.get("room");
                    int since = Integer.parseInt(query.containsKey("since") ? query.get("since") : "0");
                    JSONArray array = new JSONArray();
                    for (JSONObject event : events) {
                        if (event.optInt("id") > since && event.optString("room").equals(room)) array.put(event);
                    }
                    respond(client, "200 OK", "application/json", array.toString());
                } else {
                    respond(client, "200 OK", "text/html", staticClientHtml());
                }
            } catch (Exception ignored) {
            } finally {
                try { client.close(); } catch (Exception ignored) {}
            }
        }

        private Map<String, String> parseQuery(String request) throws Exception {
            Map<String, String> map = new LinkedHashMap<>();
            int start = request.indexOf('?');
            int end = request.indexOf(' ', start);
            if (start < 0 || end < 0) return map;
            for (String pair : request.substring(start + 1, end).split("&")) {
                String[] parts = pair.split("=", 2);
                if (parts.length == 2) map.put(parts[0], URLDecoder.decode(parts[1], "UTF-8"));
            }
            return map;
        }

        private void respond(Socket client, String status, String type, String body) throws Exception {
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            PrintWriter writer = new PrintWriter(new BufferedWriter(new OutputStreamWriter(client.getOutputStream(), StandardCharsets.UTF_8)));
            writer.print("HTTP/1.1 " + status + "\r\n");
            writer.print("Content-Type: " + type + "; charset=utf-8\r\n");
            writer.print("Access-Control-Allow-Origin: *\r\n");
            writer.print("Access-Control-Allow-Headers: content-type\r\n");
            writer.print("Content-Length: " + data.length + "\r\n\r\n");
            writer.flush();
            client.getOutputStream().write(data);
        }

        private String staticClientHtml() {
            return "<!doctype html><meta charset=utf-8><title>铮铮实验室临时联机</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f172a;color:white;padding:20px}</style><h1>铮铮实验室临时联机</h1><p>这是原生客户端的自动临时中转状态页，主站恢复后请继续使用 macOS 或 Android 客户端。</p>";
        }

        void stop() {
            running = false;
            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        }
    }

    private String httpGet(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(8000);
        return readChecked(connection);
    }

    private String httpGetLongPoll(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(5000);
        // Socket.IO can hold an idle poll until its 25s heartbeat. A shorter
        // timeout falsely reports a healthy main server as disconnected.
        connection.setReadTimeout(45000);
        return readChecked(connection);
    }

    private String httpPost(String url, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(8000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "text/plain;charset=UTF-8");
        connection.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        return readChecked(connection);
    }

    private String httpPostJson(String url, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(8000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json;charset=UTF-8");
        // 通行证接口用这个头识别原生客户端：App 里没有 Turnstile 小组件，
        // 不带该头会被判成「安全验证无效」而返回 400。
        connection.setRequestProperty("X-Passport-Client", "boardgames-android");
        connection.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        return readChecked(connection);
    }

    private String readChecked(HttpURLConnection connection) throws Exception {
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) throw new IllegalStateException("HTTP " + code);
        String body = read(stream);
        if (code >= 400) throw new IllegalStateException("HTTP " + code + (body.isEmpty() ? "" : "：" + body));
        return body;
    }

    private String read(InputStream stream) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) builder.append(line);
        return builder.toString();
    }

    private String enc(String text) throws Exception {
        return java.net.URLEncoder.encode(text, "UTF-8");
    }

    public static final class BoardView extends View {
        interface Listener { void onTap(int row, int col); }
        Listener listener;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final String[][] board = new String[19][19];
        private final List<String[]> analysisHistory = new ArrayList<>();
        private String gameType = "native-gobang";
        private int boardSize = 15;
        private int lastRow = -1;
        private int lastCol = -1;
        private int selectedRow = -1;
        private int selectedCol = -1;
        private int pendingTapRow = -1;
        private int pendingTapCol = -1;
        private long pendingTapAt = 0L;
        private boolean doubleTapToPlace = true;
        // 国内版飞行棋：4 家 × 每家 4 架。进度：-1 基地 / 0-50 主跑道 / 51-55 终点通道 / 56 终点
        private final int[][] ludoPieces = new int[4][4];
        private int ludoTurn = 0;
        private int ludoDice = 0;
        private int rummyDeckCount = 106;
        private int rummyHandCount = 0;
        private int rummyPlayerIndex = 0;
        private int rummyCurrentPlayerIndex = 0;
        private boolean rummyHasDrawnThisTurn = false;
        private String rummyDiscard = "弃牌";
        private JSONArray rummyHand = new JSONArray();
        private final boolean[][] mineBoard = new boolean[9][9];
        private final boolean[][] mineRevealed = new boolean[9][9];
        private final int[][] mineCounts = new int[9][9];
        private boolean mineFirstTap = true;
        private boolean mineFinished = false;
        // 陆战棋（暗棋）与中国跳棋的规则引擎
        final JunqiLogic junqi = new JunqiLogic();
        final JumpLogic jump = new JumpLogic();
        int junqiSelected = -1;
        int jumpSelected = -1;
        List<Integer> jumpTargets = new ArrayList<>();

        public BoardView(Activity activity) {
            super(activity);
            setBackgroundColor(Color.rgb(237, 214, 168));
            for (int pl = 0; pl < 4; pl++) for (int pc = 0; pc < 4; pc++) ludoPieces[pl][pc] = -1;
        }

        public void setDoubleTapToPlace(boolean enabled) {
            doubleTapToPlace = enabled;
            clearPendingTap();
        }

        private void clearPendingTap() {
            pendingTapRow = -1;
            pendingTapCol = -1;
            pendingTapAt = 0L;
            invalidate();
        }

        public void copyStateFrom(BoardView source) {
            gameType = source.gameType;
            boardSize = source.boardSize;
            lastRow = source.lastRow;
            lastCol = source.lastCol;
            selectedRow = source.selectedRow;
            selectedCol = source.selectedCol;
            doubleTapToPlace = source.doubleTapToPlace;
            pendingTapRow = source.pendingTapRow;
            pendingTapCol = source.pendingTapCol;
            pendingTapAt = source.pendingTapAt;
            for (int row = 0; row < board.length; row++) {
                System.arraycopy(source.board[row], 0, board[row], 0, board[row].length);
            }
            analysisHistory.clear();
            for (String[] previous : source.analysisHistory) analysisHistory.add(previous.clone());
            for (int pl = 0; pl < 4; pl++) System.arraycopy(source.ludoPieces[pl], 0, ludoPieces[pl], 0, 4);
            ludoTurn = source.ludoTurn;
            ludoDice = source.ludoDice;
            rummyDeckCount = source.rummyDeckCount;
            rummyHandCount = source.rummyHandCount;
            rummyPlayerIndex = source.rummyPlayerIndex;
            rummyCurrentPlayerIndex = source.rummyCurrentPlayerIndex;
            rummyHasDrawnThisTurn = source.rummyHasDrawnThisTurn;
            rummyDiscard = source.rummyDiscard;
            rummyHand = source.rummyHand;
            for (int row = 0; row < 9; row++) {
                System.arraycopy(source.mineBoard[row], 0, mineBoard[row], 0, 9);
                System.arraycopy(source.mineRevealed[row], 0, mineRevealed[row], 0, 9);
                System.arraycopy(source.mineCounts[row], 0, mineCounts[row], 0, 9);
            }
            mineFirstTap = source.mineFirstTap;
            mineFinished = source.mineFinished;
            invalidate();
        }

        public void reset() {
            for (int row = 0; row < 19; row++) for (int col = 0; col < 19; col++) board[row][col] = null;
            analysisHistory.clear();
            lastRow = -1;
            lastCol = -1;
            selectedRow = -1;
            selectedCol = -1;
            for (int pl = 0; pl < 4; pl++) for (int pc = 0; pc < 4; pc++) ludoPieces[pl][pc] = -1;
            ludoTurn = 0;
            ludoDice = 0;
            if (isReversi()) {
                board[3][3] = "white";
                board[3][4] = "black";
                board[4][3] = "black";
                board[4][4] = "white";
            } else if (isChineseChess()) {
                setupChineseChess();
            } else if (isRummy()) {
                setupLocalRummy();
            } else if (isMinesweeper()) {
                setupMinesweeper();
            } else if (isJunqi()) {
                junqi.reset();
                junqiSelected = -1;
            } else if (isCheckers()) {
                jump.reset();
                jumpSelected = -1;
                jumpTargets.clear();
            }
            invalidate();
        }

        public void setGame(String gameType) {
            this.gameType = gameType == null ? "native-gobang" : gameType;
            if ("native-tictactoe".equals(this.gameType)) {
                boardSize = 3;
            } else if (isReversi()) {
                boardSize = 8;
            } else if (isGo()) {
                boardSize = 19;
            } else if (isCheckers()) {
                boardSize = 17;
            } else if (isJunqi()) {
                boardSize = 12;
            } else if (isChineseChess()) {
                boardSize = 10;
            } else if (isPartyGame()) {
                boardSize = 4;
            } else if (isMinesweeper()) {
                boardSize = 9;
            } else {
                boardSize = 15;
            }
            setBackgroundColor(isRummy() || isPartyGame() ? Color.rgb(15, 23, 42) : isMinesweeper() ? Color.rgb(238, 241, 235) : isLudo() ? Color.rgb(226, 232, 240) : isReversi() ? Color.rgb(34, 111, 78) : Color.rgb(237, 214, 168));
            reset();
        }

        public String stoneAt(int row, int col) { return board[row][col]; }

        public boolean isGobang() { return "native-gobang".equals(gameType) || "gobang".equals(gameType); }
        public boolean isTicTacToe() { return "native-tictactoe".equals(gameType) || "tictactoe".equals(gameType); }
        public boolean isReversi() { return "native-reversi".equals(gameType); }
        public boolean isGo() { return "go".equals(gameType); }
        public boolean isRummy() { return "rummy".equals(gameType); }
        public boolean isRummyMyTurn() { return isRummy() && rummyPlayerIndex == rummyCurrentPlayerIndex; }
        public boolean hasRummyDrawnThisTurn() { return rummyHasDrawnThisTurn; }
        public boolean isLudo() { return "ludo".equals(gameType); }
        public boolean isMonopoly() { return "monopoly".equals(gameType); }
        public boolean isCheckers() { return "checkers".equals(gameType); }
        public boolean isJunqi() { return "junqi".equals(gameType); }
        public boolean isChineseChess() { return "chinese-chess".equals(gameType) || "chess".equals(gameType); }
        public boolean isSpy() { return "spy".equals(gameType); }
        public boolean isWerewolf() { return "werewolf".equals(gameType); }
        public boolean isPoker() { return "poker".equals(gameType); }
        public boolean isMinesweeper() { return "minesweeper".equals(gameType); }
        public boolean isPartyGame() { return isSpy() || isWerewolf() || isPoker(); }
        public boolean isPlayableBoard() { return !(isRummy() || isLudo() || isMonopoly() || isCheckers() || isJunqi() || isChineseChess() || isPartyGame() || isMinesweeper()); }

        // ---------------------------------------------------------- 陆战棋（暗棋）

        public String playJunqiTap(int index) {
            if (index < 0 || index >= JunqiLogic.N) return "";
            if (junqi.finished) return "本局已结束，请重开。";
            if (junqi.turn != 'r') return "还没轮到你。";
            String cell = junqi.board[index];
            if (junqiSelected >= 0) {
                if (index == junqiSelected) {
                    junqiSelected = -1;
                    return "已取消选择";
                }
                if (junqi.movesFrom(junqiSelected).contains(index)) {
                    int from = junqiSelected;
                    junqiSelected = -1;
                    return junqi.applyMove(from, index);
                }
            }
            if (cell.length() > 0 && JunqiLogic.movable(cell) && JunqiLogic.sideOf(cell) == 'r') {
                if (junqi.movesFrom(index).isEmpty()) return "这枚棋子暂无合法走法，换一枚试试";
                junqiSelected = index;
                return "已选" + JunqiLogic.nameOf(cell) + "，金色高亮为可走点";
            }
            return "";
        }

        public String playJunqiAi() {
            if (junqi.finished || junqi.turn != 'b') return "";
            JunqiLogic.Move move = junqi.pickMove();
            if (move == null) {
                junqi.turn = 'r';
                return "蓝方无子可动，跳过";
            }
            return junqi.applyMove(move.from, move.to);
        }

        public String junqiHint() {
            if (junqi.turn != 'r') return "还没轮到你";
            int index = junqi.hintIndex();
            if (index < 0) return "红方没有可动的棋子";
            junqiSelected = index;
            invalidate();
            return "已选中" + JunqiLogic.nameOf(junqi.board[index]) + "，金色高亮为可走点";
        }

        private void drawJunqiBoard(Canvas canvas) {
            float w = getWidth();
            float h = getHeight();
            float density = getResources().getDisplayMetrics().density;
            // 军棋底图为窄长条（高/宽 ≈ 2.496）。宽度按「可用高度能容纳多宽」反推，
            // 再用可用宽度封顶即可。旧式写法额外乘了 0.62 系数人为压矮棋盘，
            // 导致手机上棋盘只占屏幕约 44% 宽、左右留出大片空白（真机截图证实）。
            // 参照 drawJumpBoard 的正确写法：直接用可用高度换算，不再二次打折。
            // 注意：drawJunqiBoard 与 coordinateForJunqi 必须用同一套公式，
            // 否则点击命中会整体偏移。
            float boardWidth = Math.min(w - 24f * density, (h - 24f * density) / 2.496f);
            float boardHeight = boardWidth * 2.496f;
            if (boardHeight > h - 24f * density) {
                boardHeight = h - 24f * density;
                boardWidth = boardHeight / 2.496f;
            }
            float left = (w - boardWidth) / 2f;
            float top = (h - boardHeight) / 2f;

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(238, 232, 214));
            canvas.drawRoundRect(new RectF(left - 10f * density, top - 10f * density,
                    left + boardWidth + 10f * density, top + boardHeight + 10f * density), 14f * density, 14f * density, paint);

            // 山界（第 5 排与第 6 排之间的空白带）
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(206, 194, 166));
            canvas.drawRect(left, top + boardHeight * 0.474f, left + boardWidth, top + boardHeight * 0.534f, paint);

            for (int i = 0; i < JunqiLogic.N; i++) {
                float cx = left + junqiX(i) * boardWidth;
                float cy = top + junqiY(i) * boardHeight;
                int row = i / JunqiLogic.COLS;
                boolean isBase = isIn(JunqiLogic.BASE, i);
                boolean isCamp = isIn(JunqiLogic.CAMP, i);
                paint.setStyle(Paint.Style.FILL);
                if (isBase) paint.setColor(row <= 5 ? Color.rgb(120, 150, 118) : Color.rgb(176, 132, 118));
                else if (isCamp) paint.setColor(Color.rgb(226, 214, 180));
                else paint.setColor(row <= 5 ? Color.rgb(196, 214, 200) : Color.rgb(232, 205, 186));
                float r = Math.max(9f, boardWidth * 0.072f);
                canvas.drawCircle(cx, cy, r, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.4f);
                paint.setColor(Color.argb(120, 60, 52, 40));
                canvas.drawCircle(cx, cy, r, paint);

                String cell = junqi.board[i];
                if (cell.length() == 0) continue;
                boolean mine = JunqiLogic.sideOf(cell) == 'r';
                boolean reveal = junqi.known[i];
                paint.setStyle(Paint.Style.FILL);
                if (junqiSelected == i) paint.setColor(Color.rgb(245, 182, 55));
                else if (!reveal) paint.setColor(Color.rgb(108, 117, 125));
                else if (mine) paint.setColor(Color.rgb(200, 60, 60));
                else paint.setColor(Color.rgb(48, 92, 166));
                canvas.drawCircle(cx, cy, r * 0.82f, paint);
                paint.setColor(Color.WHITE);
                paint.setTextAlign(Paint.Align.CENTER);
                paint.setTextSize(r * 0.86f);
                String text = reveal ? (junqi.board[i].length() > 0 ? JunqiLogic.shortName(cell) : "") : "?";
                canvas.drawText(text, cx, cy - (paint.descent() + paint.ascent()) / 2f, paint);
            }

            if (junqiSelected >= 0) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.argb(150, 245, 182, 55));
                for (Integer t : junqi.movesFrom(junqiSelected)) {
                    canvas.drawCircle(left + junqiX(t) * boardWidth, top + junqiY(t) * boardHeight,
                            Math.max(4f, boardWidth * 0.026f), paint);
                }
            }
            paint.setTextAlign(Paint.Align.LEFT);
        }

        private static boolean isIn(int[] array, int value) {
            for (int v : array) if (v == value) return true;
            return false;
        }

        /** 兵站横向百分比（0..1） */
        private static float junqiX(int index) {
            return (11.54f + (index % JunqiLogic.COLS) * 19.23f) / 100f;
        }

        /** 兵站纵向百分比（0..1），中间留出山界 */
        private static float junqiY(int index) {
            int row = index / JunqiLogic.COLS;
            float y = row <= 5 ? 4.62f + row * 7.71f : 56.86f + (row - 6) * 7.71f;
            return y / 100f;
        }

        private Integer coordinateForJunqi(float x, float y) {
            float w = getWidth();
            float h = getHeight();
            float density = getResources().getDisplayMetrics().density;
            // 军棋底图为窄长条（高/宽 ≈ 2.496）。宽度按「可用高度能容纳多宽」反推，
            // 再用可用宽度封顶即可。旧式写法额外乘了 0.62 系数人为压矮棋盘，
            // 导致手机上棋盘只占屏幕约 44% 宽、左右留出大片空白（真机截图证实）。
            // 参照 drawJumpBoard 的正确写法：直接用可用高度换算，不再二次打折。
            // 注意：drawJunqiBoard 与 coordinateForJunqi 必须用同一套公式，
            // 否则点击命中会整体偏移。
            float boardWidth = Math.min(w - 24f * density, (h - 24f * density) / 2.496f);
            float boardHeight = boardWidth * 2.496f;
            if (boardHeight > h - 24f * density) {
                boardHeight = h - 24f * density;
                boardWidth = boardHeight / 2.496f;
            }
            float left = (w - boardWidth) / 2f;
            float top = (h - boardHeight) / 2f;
            int best = -1;
            float bestDist = Float.MAX_VALUE;
            float limit = boardWidth * 0.16f;
            for (int i = 0; i < JunqiLogic.N; i++) {
                float cx = left + junqiX(i) * boardWidth;
                float cy = top + junqiY(i) * boardHeight;
                float d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            }
            return bestDist <= limit * limit ? best : null;
        }

        // ------------------------------------------------------------ 中国跳棋

        public String playJumpTap(int index) {
            if (index < 0 || index >= JumpLogic.N) return "";
            if (jump.finished) return "本局已结束，请重开。";
            if (jump.turn != 1) return "还没轮到红方。";
            if (jumpSelected >= 0) {
                if (index == jumpSelected) {
                    jumpSelected = -1;
                    jumpTargets.clear();
                    invalidate();
                    return "已取消选择";
                }
                if (jump.board[index] == 1) {
                    jumpSelected = index;
                    jumpTargets = jump.reachable(index, 1);
                    invalidate();
                    return jumpTargets.isEmpty() ? "这枚棋子暂无合法走法，换一枚试试" : "已换选棋子";
                }
                if (jumpTargets.contains(index)) {
                    int from = jumpSelected;
                    jumpSelected = -1;
                    jumpTargets.clear();
                    String result = jump.applyMove(from, index);
                    invalidate();
                    return result;
                }
                return "只能走到高亮位置；点另一枚己方棋子可换选择";
            }
            if (jump.board[index] == 1) {
                jumpSelected = index;
                jumpTargets = jump.reachable(index, 1);
                invalidate();
                return jumpTargets.isEmpty() ? "这枚棋子暂无合法走法，换一枚试试" : "已选棋子，高亮位置可直达（含连跳）";
            }
            return "";
        }

        public String playJumpAi() {
            if (jump.finished || jump.turn == 1) return "";
            JumpLogic.Move move = jump.pickMove();
            if (move == null) {
                jump.turn = jump.turn == 3 ? 1 : jump.turn + 1;
                return JumpLogic.SIDE_NAMES[jump.turn - 1] + "无子可动，跳过";
            }
            String result = jump.applyMove(move.from, move.to);
            invalidate();
            return result;
        }

        public String jumpHint() {
            if (jump.turn != 1) return "还没轮到红方";
            int index = jump.hintIndex();
            if (index < 0) return "红方没有可动的棋子";
            jumpSelected = index;
            jumpTargets = jump.reachable(index, 1);
            invalidate();
            return "已选中一枚棋子，高亮位置可直达";
        }

        private void drawJumpBoard(Canvas canvas) {
            float w = getWidth();
            float h = getHeight();
            float density = getResources().getDisplayMetrics().density;
            float boardWidth = Math.min(w - 20f * density, (h - 20f * density) * 0.8803f);
            float boardHeight = boardWidth / 0.8803f;
            float left = (w - boardWidth) / 2f;
            float top = (h - boardHeight) / 2f;

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(243, 238, 226));
            canvas.drawRoundRect(new RectF(left - 8f * density, top - 8f * density,
                    left + boardWidth + 8f * density, top + boardHeight + 8f * density), 16f * density, 16f * density, paint);

            float radius = Math.max(8f, boardWidth * 0.028f);
            int[] holeTint = {0, Color.rgb(226, 74, 74), Color.rgb(232, 168, 46), Color.rgb(58, 116, 200)};
            int[] holeDark = {0, Color.rgb(150, 40, 40), Color.rgb(158, 108, 22), Color.rgb(30, 72, 140)};

            for (int i = 0; i < JumpLogic.N; i++) {
                float cx = left + JumpLogic.posX(i) / 100f * boardWidth;
                float cy = top + JumpLogic.posY(i) / 100f * boardHeight;
                int piece = jump.board[i];
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.argb(40, 60, 50, 35));
                canvas.drawCircle(cx, cy, radius * 0.62f, paint);
                if (piece == 0) continue;
                paint.setColor(holeDark[piece]);
                canvas.drawCircle(cx, cy + radius * 0.12f, radius, paint);
                paint.setColor(holeTint[piece]);
                canvas.drawCircle(cx, cy, radius, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.2f);
                paint.setColor(Color.argb(120, 255, 255, 255));
                canvas.drawCircle(cx, cy, radius, paint);
            }

            if (jumpSelected >= 0) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(Math.max(2f, radius * 0.24f));
                paint.setColor(Color.rgb(245, 182, 55));
                canvas.drawCircle(left + JumpLogic.posX(jumpSelected) / 100f * boardWidth,
                        top + JumpLogic.posY(jumpSelected) / 100f * boardHeight, radius * 1.25f, paint);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.argb(170, 245, 182, 55));
                for (Integer t : jumpTargets) {
                    canvas.drawCircle(left + JumpLogic.posX(t) / 100f * boardWidth,
                            top + JumpLogic.posY(t) / 100f * boardHeight, radius * 0.42f, paint);
                }
            }
        }

        private Integer coordinateForJump(float x, float y) {
            float w = getWidth();
            float h = getHeight();
            float density = getResources().getDisplayMetrics().density;
            float boardWidth = Math.min(w - 20f * density, (h - 20f * density) * 0.8803f);
            float boardHeight = boardWidth / 0.8803f;
            float left = (w - boardWidth) / 2f;
            float top = (h - boardHeight) / 2f;
            int best = -1;
            float bestDist = Float.MAX_VALUE;
            float limit = boardWidth * 0.055f;
            for (int i = 0; i < JumpLogic.N; i++) {
                float cx = left + JumpLogic.posX(i) / 100f * boardWidth;
                float cy = top + JumpLogic.posY(i) / 100f * boardHeight;
                float d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            }
            return bestDist <= limit * limit ? best : null;
        }

        public String partyActionHint() {
            if (isSpy()) return "房主发词后按发言顺序描述，投票淘汰可疑玩家；卧底撑到最后获胜。";
            if (isWerewolf()) return "主持节奏：狼人杀人、预言家查验、女巫用药、白天发言并投票。";
            return "扑克桌会支持发牌、弃牌、叫分/下注等动作；当前先进入房间聊天和等待发牌。";
        }

        public String partyAiHint() {
            if (isSpy()) return "卧底 AI 会根据词语相似度生成描述和投票。";
            if (isWerewolf()) return "狼人杀 AI 会按身份和发言记录投票。";
            return "扑克 AI 会按手牌强度和桌面动作选择跟注、弃牌或出牌。";
        }

        private void setupLocalRummy() {
            rummyDeckCount = 106;
            rummyHand = new JSONArray();
            for (int i = 0; i < 14; i++) {
                rummyHand.put(randomRummyTile());
                rummyDeckCount--;
            }
            rummyHandCount = rummyHand.length();
            rummyPlayerIndex = 0;
            rummyCurrentPlayerIndex = 0;
            rummyHasDrawnThisTurn = false;
            rummyDiscard = "弃牌";
        }

        public String playLocalRummyTurn() {
            if (!isRummy()) return "当前不是拉密牌桌。";
            if (rummyCurrentPlayerIndex != rummyPlayerIndex) return "还没轮到你。";
            if (!rummyHasDrawnThisTurn) {
                if (rummyDeckCount <= 0) return "牌堆已空，本局结束。";
                rummyDeckCount--;
                rummyHand.put(randomRummyTile());
                rummyHandCount = rummyHand.length();
                rummyHasDrawnThisTurn = true;
                invalidate();
                return "摸牌成功。现在可以点牌桌结束回合。";
            }
            JSONObject discarded = rummyHand.length() > 0 ? rummyHand.optJSONObject(rummyHand.length() - 1) : null;
            if (rummyHand.length() > 0) rummyHand.remove(rummyHand.length() - 1);
            rummyHandCount = rummyHand.length();
            rummyDiscard = labelForRummyTile(discarded);
            if (rummyHandCount <= 0) {
                invalidate();
                return "你已出完手牌，获胜。";
            }
            if (rummyDeckCount > 0) rummyDeckCount--;
            rummyHasDrawnThisTurn = false;
            invalidate();
            return "结束回合，AI 已完成摸牌和弃牌。";
        }

        private JSONObject randomRummyTile() {
            JSONObject tile = new JSONObject();
            try {
                int pick = (int) (Math.random() * 106);
                if (pick >= 104) {
                    tile.put("color", "joker");
                    tile.put("num", 0);
                } else {
                    String[] colors = {"red", "blue", "black", "yellow"};
                    tile.put("color", colors[pick % colors.length]);
                    tile.put("num", (pick / colors.length) % 13 + 1);
                }
            } catch (Exception ignored) {}
            return tile;
        }

        private String labelForRummyTile(JSONObject tile) {
            if (tile == null) return "弃牌";
            int num = tile.optInt("num", 0);
            return num == 0 ? "★" : String.valueOf(num);
        }

        private void setupChineseChess() {
            String[] top = {"br", "bn", "bb", "ba", "bk", "ba", "bb", "bn", "br"};
            String[] bottom = {"rr", "rn", "rb", "ra", "rk", "ra", "rb", "rn", "rr"};
            for (int c = 0; c < 9; c++) {
                board[0][c] = top[c];
                board[9][c] = bottom[c];
            }
            board[2][1] = "bc"; board[2][7] = "bc";
            board[7][1] = "rc"; board[7][7] = "rc";
            for (int c = 0; c < 9; c += 2) {
                board[3][c] = "bp";
                board[6][c] = "rp";
            }
        }

        public void applyRummyState(JSONObject state) {
            rummyDeckCount = state.optInt("deckCount", rummyDeckCount);
            rummyPlayerIndex = state.optInt("playerIndex", rummyPlayerIndex);
            rummyCurrentPlayerIndex = state.optInt("currentPlayerIndex", rummyCurrentPlayerIndex);
            rummyHasDrawnThisTurn = state.optBoolean("hasDrawnThisTurn", false);
            JSONArray hand = state.optJSONArray("hand");
            rummyHandCount = hand == null ? rummyHandCount : hand.length();
            rummyHand = hand == null ? new JSONArray() : hand;
            JSONObject discard = state.optJSONObject("discardTop");
            if (discard == null) {
                rummyDiscard = "弃牌";
            } else {
                int num = discard.optInt("num", 0);
                rummyDiscard = num == 0 ? "★" : String.valueOf(num);
            }
            invalidate();
        }

        public void applyBoardState(JSONObject state) {
            JSONArray rows = state.optJSONArray("board");
            JSONArray flat = state.optJSONArray("boardFlat");
            int size = state.optInt("boardSize", state.optInt("size", boardSize));
            if (size > 0 && size <= board.length) boardSize = size;
            for (int row = 0; row < board.length; row++) {
                for (int col = 0; col < board[row].length; col++) board[row][col] = null;
            }
            if (rows != null && rows.length() > 0) {
                if (rows.optJSONArray(0) != null) {
                    for (int row = 0; row < Math.min(boardSize, rows.length()); row++) {
                        JSONArray values = rows.optJSONArray(row);
                        if (values == null) continue;
                        for (int col = 0; col < Math.min(boardSize, values.length()); col++) {
                            board[row][col] = stoneValue(values.opt(col));
                        }
                    }
                } else {
                    for (int index = 0; index < Math.min(rows.length(), boardSize * boardSize); index++) {
                        board[index / boardSize][index % boardSize] = stoneValue(rows.opt(index));
                    }
                }
            } else if (flat != null) {
                for (int index = 0; index < Math.min(flat.length(), boardSize * boardSize); index++) {
                    board[index / boardSize][index % boardSize] = stoneValue(flat.opt(index));
                }
            }
            JSONObject last = state.optJSONObject("lastMove");
            if (last != null) {
                lastRow = last.optInt("row", -1);
                lastCol = last.optInt("col", -1);
            }
            invalidate();
        }

        private String stoneValue(Object raw) {
            if (raw == null || JSONObject.NULL.equals(raw)) return null;
            if (raw instanceof Number) {
                int value = ((Number) raw).intValue();
                if (value == 1) return "black";
                if (value == -1 || value == 2) return "white";
                return null;
            }
            String text = String.valueOf(raw).trim().toLowerCase(Locale.ROOT);
            if ("1".equals(text) || "black".equals(text) || "b".equals(text) || "黑".equals(text)) return "black";
            if ("-1".equals(text) || "2".equals(text) || "white".equals(text) || "w".equals(text) || "白".equals(text)) return "white";
            return null;
        }

        public String analysisGame() {
            if (isChineseChess()) return "xiangqi";
            if (isGo()) return "go";
            return "gobang";
        }

        public int analysisBoardSize() {
            return isChineseChess() ? 9 : boardSize;
        }

        public BoardAnalysis.Position toAnalysisPosition(int currentPlayer) {
            if (isChineseChess()) {
                String[] flat = new String[90];
                for (int row = 0; row < 10; row++) {
                    for (int col = 0; col < 9; col++) flat[row * 9 + col] = canonicalChinesePiece(board[row][col]);
                }
                return new BoardAnalysis.Position("xiangqi", 0, flat, currentPlayer, analysisHistory);
            }
            String[] flat = new String[boardSize * boardSize];
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    String value = board[row][col];
                    flat[row * boardSize + col] = "black".equals(value) ? "1" : "white".equals(value) ? "2" : "";
                }
            }
            return new BoardAnalysis.Position(analysisGame(), boardSize, flat, currentPlayer, analysisHistory);
        }

        public void applyAnalysisPosition(BoardAnalysis.Position position) {
            for (int row = 0; row < board.length; row++) Arrays.fill(board[row], null);
            analysisHistory.clear();
            for (String[] previous : position.history) analysisHistory.add(previous.clone());
            if ("xiangqi".equals(position.game)) {
                gameType = "chinese-chess";
                boardSize = 10;
                for (int index = 0; index < Math.min(90, position.board.length); index++) {
                    board[index / 9][index % 9] = viewChinesePiece(position.board[index]);
                }
            } else {
                gameType = "go".equals(position.game) ? "go" : "native-gobang";
                boardSize = position.size;
                for (int index = 0; index < Math.min(position.board.length, boardSize * boardSize); index++) {
                    board[index / boardSize][index % boardSize] = "1".equals(position.board[index]) ? "black"
                            : "2".equals(position.board[index]) ? "white" : null;
                }
            }
            selectedRow = -1;
            selectedCol = -1;
            lastRow = -1;
            lastCol = -1;
            clearPendingTap();
            invalidate();
        }

        public void editCell(int row, int col, String piece) {
            if (isChineseChess()) {
                if (row < 0 || row >= 10 || col < 0 || col >= 9) return;
                board[row][col] = viewChinesePiece(piece);
            } else {
                if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return;
                board[row][col] = "1".equals(piece) ? "black" : "2".equals(piece) ? "white" : null;
            }
            lastRow = row;
            lastCol = col;
            invalidate();
        }

        private String canonicalChinesePiece(String piece) {
            if (piece == null || piece.length() < 2) return "";
            return "" + piece.charAt(0) + Character.toUpperCase(piece.charAt(1));
        }

        private String viewChinesePiece(String piece) {
            if (piece == null || piece.length() < 2) return null;
            return "" + piece.charAt(0) + Character.toLowerCase(piece.charAt(1));
        }

        public boolean canPlace(int row, int col, String stone) {
            if (row < 0 || row >= boardSize || col < 0 || col >= boardSize || board[row][col] != null) return false;
            if (isGo()) return canPlaceGo(row, col, stone);
            if (!isReversi()) return true;
            return flipsFor(row, col, stone, false) > 0;
        }

        public int[] firstLegalMove(String stone) {
            if ("native-tictactoe".equals(gameType)) return bestTicTacToeMove(stone);
            if (isReversi()) return bestReversiMove(stone);
            if (isGo()) return bestGoMove(stone);
            return bestLineGameMove(stone);
        }

        public int[] randomLegalMove(String stone) {
            List<int[]> moves = new ArrayList<>();
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (canPlace(row, col, stone)) moves.add(new int[] { row, col });
                }
            }
            if (moves.isEmpty()) return null;
            return moves.get(new Random().nextInt(moves.size()));
        }

        private int[] bestLineGameMove(String stone) {
            int[] win = tacticalMove(stone, true);
            if (win != null) return win;
            String opponent = opponentOf(stone);
            int[] block = tacticalMove(opponent, true);
            if (block != null) return block;
            int bestRow = -1;
            int bestCol = -1;
            int bestScore = Integer.MIN_VALUE;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (!canPlace(row, col, stone)) continue;
                    board[row][col] = stone;
                    int attack = linePotentialScore(row, col, stone);
                    board[row][col] = null;
                    board[row][col] = opponent;
                    int defense = linePotentialScore(row, col, opponent);
                    board[row][col] = null;
                    int score = attack + defense * 9 / 10 + centerBias(row, col) + neighborBias(row, col);
                    if (score > bestScore) {
                        bestScore = score;
                        bestRow = row;
                        bestCol = col;
                    }
                }
            }
            return bestRow < 0 ? null : new int[] { bestRow, bestCol };
        }

        private int[] bestTicTacToeMove(String stone) {
            int[] win = tacticalMove(stone, true);
            if (win != null) return win;
            String opponent = opponentOf(stone);
            int[] block = tacticalMove(opponent, true);
            if (block != null) return block;
            int bestScore = Integer.MIN_VALUE;
            int[] best = null;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (!canPlace(row, col, stone)) continue;
                    board[row][col] = stone;
                    int score = minimaxTicTacToe(opponent, stone, 0);
                    board[row][col] = null;
                    if (score > bestScore) {
                        bestScore = score;
                        best = new int[]{row, col};
                    }
                }
            }
            return best;
        }

        private int minimaxTicTacToe(String turn, String aiStone, int depth) {
            String winner = ticTacToeWinner();
            if (winner != null) return winner.equals(aiStone) ? 10 - depth : depth - 10;
            if (boardFull()) return 0;
            String opponent = opponentOf(turn);
            int best = turn.equals(aiStone) ? Integer.MIN_VALUE : Integer.MAX_VALUE;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (board[row][col] != null) continue;
                    board[row][col] = turn;
                    int score = minimaxTicTacToe(opponent, aiStone, depth + 1);
                    board[row][col] = null;
                    if (turn.equals(aiStone)) best = Math.max(best, score);
                    else best = Math.min(best, score);
                }
            }
            return best;
        }

        private int[] bestReversiMove(String stone) {
            int[][] weights = {
                    {120, -28, 22, 12, 12, 22, -28, 120},
                    {-28, -42, -6, -4, -4, -6, -42, -28},
                    {22, -6, 12, 5, 5, 12, -6, 22},
                    {12, -4, 5, 4, 4, 5, -4, 12},
                    {12, -4, 5, 4, 4, 5, -4, 12},
                    {22, -6, 12, 5, 5, 12, -6, 22},
                    {-28, -42, -6, -4, -4, -6, -42, -28},
                    {120, -28, 22, 12, 12, 22, -28, 120}
            };
            int bestScore = Integer.MIN_VALUE;
            int[] best = null;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (!canPlace(row, col, stone)) continue;
                    int flips = flipsFor(row, col, stone, false);
                    int score = flips * 8 + weights[row][col];
                    if (isCorner(row, col)) score += 160;
                    if (isBadCornerNeighbor(row, col)) score -= 80;
                    score -= legalMoveCount(opponentOf(stone), row, col, stone) * 3;
                    if (score > bestScore) {
                        bestScore = score;
                        best = new int[]{row, col};
                    }
                }
            }
            return best;
        }

        private int[] bestGoMove(String stone) {
            String opponent = opponentOf(stone);
            int bestScore = Integer.MIN_VALUE;
            int[] best = null;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (!canPlace(row, col, stone)) continue;
                    board[row][col] = stone;
                    int score = captureScoreAround(row, col, opponent) * 95 + goLiberties(row, col) * 8 + centerBias(row, col);
                    board[row][col] = null;
                    if (score > bestScore) {
                        bestScore = score;
                        best = new int[]{row, col};
                    }
                }
            }
            return best;
        }

        public void place(int row, int col, String stone) {
            if (!canPlace(row, col, stone)) return;
            if (isReversi()) flipsFor(row, col, stone, true);
            board[row][col] = stone;
            if (isGo()) captureGoNeighbors(row, col, stone);
            lastRow = row;
            lastCol = col;
            performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK);
            invalidate();
        }

        public boolean hasAnyMove(String stone) {
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (canPlace(row, col, stone)) return true;
                }
            }
            return false;
        }

        public String finishedResult() {
            if (!isReversi()) return null;
            if (hasAnyMove("black") || hasAnyMove("white")) return null;
            int black = 0;
            int white = 0;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if ("black".equals(board[row][col])) black++;
                    if ("white".equals(board[row][col])) white++;
                }
            }
            if (black == white) return "黑白棋结束，" + black + ":" + white + " 平局。";
            return "黑白棋结束，" + black + ":" + white + "，" + (black > white ? "黑棋" : "白棋") + "获胜。";
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (isRummy()) {
                drawRummyTable(canvas);
                return;
            }
            if (isLudo()) {
                drawLudoBoard(canvas);
                return;
            }
            if (isMonopoly()) {
                drawChinesePropertyBoard(canvas);
                return;
            }
            if (isCheckers()) {
                drawJumpBoard(canvas);
                return;
            }
            if (isJunqi()) {
                drawJunqiBoard(canvas);
                return;
            }
            if (isChineseChess()) {
                drawChineseChessBoard(canvas);
                return;
            }
            if (isPartyGame()) {
                drawPartyTable(canvas);
                return;
            }
            if (isMinesweeper()) {
                drawMinesweeper(canvas);
                return;
            }
            BoardMetrics metrics = metrics();
            paint.setStyle(Paint.Style.FILL);
            RectF inner = new RectF(metrics.grid.left - 12f, metrics.grid.top - 12f, metrics.grid.right + 12f, metrics.grid.bottom + 12f);
            paint.setColor(isReversi() ? Color.rgb(35, 112, 75) : isTicTacToe() ? Color.rgb(28, 47, 42) : Color.rgb(226, 186, 112));
            canvas.drawRoundRect(metrics.outer, 22f, 22f, paint);
            paint.setColor(isReversi() ? Color.rgb(45, 132, 88) : isTicTacToe() ? Color.rgb(38, 61, 54) : Color.rgb(246, 213, 148));
            canvas.drawRoundRect(inner, 10f, 10f, paint);

            paint.setStrokeWidth(2f);
            paint.setStyle(Paint.Style.STROKE);
            paint.setColor(isReversi() ? Color.argb(120, 7, 30, 21) : Color.rgb(70, 50, 26));
            int lineCount = isCellBased() ? boardSize + 1 : boardSize;
            for (int i = 0; i < lineCount; i++) {
                float offset = i * metrics.gap;
                canvas.drawLine(metrics.grid.left, metrics.grid.top + offset, metrics.grid.right, metrics.grid.top + offset, paint);
                canvas.drawLine(metrics.grid.left + offset, metrics.grid.top, metrics.grid.left + offset, metrics.grid.bottom, paint);
            }
            drawStarPoints(canvas, metrics);
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    String stone = board[row][col];
                    if (stone == null) continue;
                    drawStone(canvas, metrics, row, col, stone);
                }
            }
            drawLastMoveMarker(canvas, metrics);
            drawPendingTapMarker(canvas, metrics);
        }

        private void drawLastMoveMarker(Canvas canvas, BoardMetrics metrics) {
            if (lastRow < 0 || lastCol < 0 || lastRow >= boardSize || lastCol >= boardSize) return;
            float x = isCellBased() ? metrics.grid.left + (lastCol + 0.5f) * metrics.gap : metrics.grid.left + lastCol * metrics.gap;
            float y = isCellBased() ? metrics.grid.top + (lastRow + 0.5f) * metrics.gap : metrics.grid.top + lastRow * metrics.gap;
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(2f, metrics.gap * 0.08f));
            paint.setColor(Color.rgb(239, 68, 68));
            canvas.drawCircle(x, y, Math.max(4f, metrics.gap * 0.14f), paint);
            paint.setStyle(Paint.Style.FILL);
        }

        private void drawPendingTapMarker(Canvas canvas, BoardMetrics metrics) {
            if (pendingTapRow < 0 || pendingTapCol < 0 || pendingTapRow >= boardSize || pendingTapCol >= boardSize) return;
            float x = isCellBased() ? metrics.grid.left + (pendingTapCol + 0.5f) * metrics.gap : metrics.grid.left + pendingTapCol * metrics.gap;
            float y = isCellBased() ? metrics.grid.top + (pendingTapRow + 0.5f) * metrics.gap : metrics.grid.top + pendingTapRow * metrics.gap;
            float radius = Math.max(9f, metrics.gap * 0.34f);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(2f, metrics.gap * 0.07f));
            paint.setColor(Color.rgb(45, 212, 235));
            canvas.drawCircle(x, y, radius, paint);
            paint.setColor(Color.argb(175, 245, 178, 57));
            canvas.drawLine(x - radius * 0.62f, y, x + radius * 0.62f, y, paint);
            canvas.drawLine(x, y - radius * 0.62f, x, y + radius * 0.62f, paint);
            paint.setStyle(Paint.Style.FILL);
        }

        private boolean confirmPlacement(int row, int col) {
            if (!doubleTapToPlace) return true;
            long now = System.currentTimeMillis();
            boolean confirmed = pendingTapRow == row && pendingTapCol == col && now - pendingTapAt <= 1200L;
            if (confirmed) {
                pendingTapRow = -1;
                pendingTapCol = -1;
                pendingTapAt = 0L;
                invalidate();
                return true;
            }
            pendingTapRow = row;
            pendingTapCol = col;
            pendingTapAt = now;
            invalidate();
            return false;
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (event.getAction() != MotionEvent.ACTION_UP) return true;
            if (isRummy() || isLudo()) {
                if (listener != null) listener.onTap(-1, -1);
                return true;
            }
            if (isJunqi()) {
                Integer index = coordinateForJunqi(event.getX(), event.getY());
                if (listener != null && index != null) listener.onTap(index, 0);
                return true;
            }
            if (isCheckers()) {
                Integer index = coordinateForJump(event.getX(), event.getY());
                if (listener != null && index != null) listener.onTap(index, 0);
                return true;
            }
            if (isChineseChess()) {
                int[] rc = coordinateForChinese(event.getX(), event.getY());
                if (listener != null && rc != null && confirmPlacement(rc[0], rc[1])) listener.onTap(rc[0], rc[1]);
                return true;
            }
            if (isMinesweeper()) {
                int[] rc = coordinateFor(event.getX(), event.getY());
                if (listener != null && rc != null) listener.onTap(rc[0], rc[1]);
                return true;
            }
            if (!isPlayableBoard()) return true;
            int[] rc = coordinateFor(event.getX(), event.getY());
            if (listener != null && rc != null && confirmPlacement(rc[0], rc[1])) listener.onTap(rc[0], rc[1]);
            return true;
        }

        private boolean isCellBased() {
            return isReversi() || isMinesweeper() || "native-tictactoe".equals(gameType);
        }

        private void drawRummyTable(Canvas canvas) {
            float density = getResources().getDisplayMetrics().density;
            float fontScale = getResources().getDisplayMetrics().scaledDensity;
            float margin = Math.max(10f * density, Math.min(18f * density, getWidth() * 0.035f));
            float scale = Math.max(0.72f, Math.min(1.15f, Math.min(getWidth() / (430f * density), getHeight() / (660f * density))));
            RectF frame = new RectF(margin, margin, getWidth() - margin, getHeight() - margin);
            float inner = Math.max(12f * density, 20f * density * scale);
            float titleBand = Math.max(48f * density, 64f * density * scale);
            float hintHeight = Math.max(30f * density, 34f * density * scale);
            float rackHeight = Math.max(126f * density, Math.min(190f * density, frame.height() * 0.29f));
            float gap = Math.max(10f * density, 14f * density * scale);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(82, 14, 82, 70));
            canvas.drawRoundRect(frame, 18f * density, 18f * density, paint);
            paint.setColor(Color.WHITE);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(25f * fontScale * scale);
            paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            canvas.drawText("拉密牌桌", frame.centerX(), frame.top + Math.min(42f * density * scale, titleBand - 14f * density), paint);

            RectF rack = new RectF(frame.left + inner, frame.bottom - inner - rackHeight, frame.right - inner, frame.bottom - inner);
            RectF hintFrame = new RectF(frame.left + inner, rack.top - gap - hintHeight, frame.right - inner, rack.top - gap);
            RectF table = new RectF(frame.left + inner, frame.top + titleBand, frame.right - inner, hintFrame.top - gap);
            if (table.height() < 120f * density) {
                float compressedRack = Math.max(104f * density, frame.height() * 0.24f);
                rack = new RectF(frame.left + inner, frame.bottom - inner - compressedRack, frame.right - inner, frame.bottom - inner);
                hintFrame = new RectF(frame.left + inner, rack.top - 8f * density - hintHeight, frame.right - inner, rack.top - 8f * density);
                table = new RectF(frame.left + inner, frame.top + titleBand * 0.84f, frame.right - inner, hintFrame.top - 8f * density);
            }
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(6, 78, 66));
            canvas.drawRoundRect(table, 14f * density, 14f * density, paint);
            paint.setColor(Color.rgb(226, 232, 240));
            paint.setTextSize(15f * fontScale * scale);
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText("公共组合区", table.left + 16f * density, table.top + 28f * density * scale, paint);

            float pileW = Math.max(34f * density, Math.min(48f * density, table.width() * 0.11f));
            float pileH = pileW * 1.42f;
            RectF drawPile = new RectF(table.left + 18f * density, table.centerY() - pileH / 2f, table.left + 18f * density + pileW, table.centerY() + pileH / 2f);
            drawRummyBack(canvas, drawPile, density);
            paint.setColor(Color.rgb(34, 211, 238));
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(16f * fontScale * scale);
            canvas.drawText(String.valueOf(rummyDeckCount), drawPile.centerX(), drawPile.centerY() - 4f * density, paint);
            paint.setTextSize(10f * fontScale * scale);
            canvas.drawText("牌堆", drawPile.centerX(), drawPile.centerY() + 15f * density * scale, paint);

            RectF discard = new RectF(drawPile.right + 14f * density, drawPile.top, drawPile.right + 14f * density + pileW, drawPile.bottom);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.5f * density);
            paint.setColor(Color.argb(80, 255, 255, 255));
            canvas.drawRoundRect(discard, 9f * density, 9f * density, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(148, 163, 184));
            paint.setTextSize(16f * fontScale * scale);
            canvas.drawText(rummyDiscard, discard.centerX(), discard.centerY() + 6f * density, paint);

            float slotW = Math.max(26f * density, Math.min(36f * density, pileW * 0.82f));
            float slotGap = Math.max(6f * density, 10f * density * scale);
            int slotCount = Math.max(2, Math.min(6, (int) ((table.right - discard.right - 22f * density) / (slotW + slotGap))));
            for (int i = 0; i < slotCount; i++) {
                RectF slot = new RectF(discard.right + 18f * density + i * (slotW + slotGap), drawPile.top + 7f * density, discard.right + 18f * density + i * (slotW + slotGap) + slotW, drawPile.bottom - 7f * density);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.3f * density);
                paint.setColor(Color.argb(58, 255, 255, 255));
                canvas.drawRoundRect(slot, 7f * density, 7f * density, paint);
            }

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(92, 2, 6, 23));
            canvas.drawRoundRect(hintFrame, 10f * density, 10f * density, paint);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(11f * fontScale * scale);
            paint.setColor(Color.rgb(148, 163, 184));
            String hint = isRummyMyTurn() ? (rummyHasDrawnThisTurn ? "点击牌桌结束回合" : "点击牌桌摸牌") : "等待玩家 " + (rummyCurrentPlayerIndex + 1);
            canvas.drawText(hint + " · 标准 106 张：2×4×13 + 2 鬼牌", hintFrame.centerX(), hintFrame.centerY() + 4f * density, paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(6, 39, 63));
            canvas.drawRoundRect(rack, 14f * density, 14f * density, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.2f * density);
            paint.setColor(Color.argb(75, 255, 255, 255));
            canvas.drawLine(rack.left + 12f * density, rack.centerY(), rack.right - 12f * density, rack.centerY(), paint);
            paint.setColor(Color.rgb(226, 232, 240));
            paint.setStyle(Paint.Style.FILL);
            paint.setTextAlign(Paint.Align.LEFT);
            paint.setTextSize(15f * fontScale * scale);
            canvas.drawText("你的牌架 · " + rummyHandCount + " 张", rack.left + 16f * density, rack.top + 28f * density * scale, paint);
            float tileGap = Math.max(4f * density, 8f * density * scale);
            float tileW = Math.max(24f * density, Math.min(34f * density, (rack.width() - 32f * density - tileGap * 9f) / 10f));
            float tileH = Math.min(50f * density, tileW * 1.52f);
            int perRow = Math.max(6, Math.min(13, (int) ((rack.width() - 32f * density) / (tileW + tileGap))));
            int visible = Math.min(rummyHand.length(), perRow * 2);
            for (int i = 0; i < Math.max(visible, Math.min(perRow * 2, 10)); i++) {
                int row = i / perRow;
                int col = i % perRow;
                float firstRowY = rack.top + Math.max(38f * density, 42f * density * scale);
                float secondRowY = Math.min(rack.bottom - tileH - 10f * density, firstRowY + tileH + Math.max(6f * density, 8f * density * scale));
                RectF slot = new RectF(rack.left + 16f * density + col * (tileW + tileGap), row == 0 ? firstRowY : secondRowY, rack.left + 16f * density + col * (tileW + tileGap) + tileW, (row == 0 ? firstRowY : secondRowY) + tileH);
                JSONObject tile = i < rummyHand.length() ? rummyHand.optJSONObject(i) : null;
                if (tile == null) {
                    paint.setStyle(Paint.Style.STROKE);
                    paint.setStrokeWidth(1.2f * density);
                    paint.setColor(Color.argb(52, 255, 255, 255));
                    canvas.drawRoundRect(slot, 7f * density, 7f * density, paint);
                } else {
                    drawRummyTile(canvas, slot, tile, density, fontScale, scale);
                }
            }
        }

        private void drawRummyBack(Canvas canvas, RectF rect, float density) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(15, 23, 42));
            canvas.drawRoundRect(rect, 9f * density, 9f * density, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * density);
            paint.setColor(Color.argb(135, 34, 211, 238));
            canvas.drawRoundRect(new RectF(rect.left + 5f * density, rect.top + 5f * density, rect.right - 5f * density, rect.bottom - 5f * density), 6f * density, 6f * density, paint);
        }

        private void drawRummyTile(Canvas canvas, RectF rect, JSONObject tile, float density, float fontScale, float scale) {
            int num = tile.optInt("num", 0);
            String color = tile.optString("color", "black");
            int ink;
            if ("red".equals(color)) ink = Color.rgb(239, 68, 68);
            else if ("blue".equals(color)) ink = Color.rgb(37, 99, 235);
            else if ("yellow".equals(color)) ink = Color.rgb(217, 119, 6);
            else ink = Color.rgb(17, 24, 39);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(248, 250, 252));
            canvas.drawRoundRect(rect, 7f * density, 7f * density, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.3f * density);
            paint.setColor(ink);
            canvas.drawRoundRect(rect, 7f * density, 7f * density, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(ink);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(17f * fontScale * scale);
            canvas.drawText(num == 0 ? "★" : String.valueOf(num), rect.centerX(), rect.centerY() + 6f * density, paint);
        }

        private void setupMinesweeper() {
            for (int row = 0; row < 9; row++) {
                for (int col = 0; col < 9; col++) {
                    mineBoard[row][col] = false;
                    mineRevealed[row][col] = false;
                    mineCounts[row][col] = 0;
                }
            }
            mineFirstTap = true;
            mineFinished = false;
        }

        public String playMinesweeperTap(int row, int col) {
            if (!isMinesweeper()) return "";
            if (mineFinished) return "本局已结束，点重开再来。";
            if (row < 0 || row >= 9 || col < 0 || col >= 9) return "";
            if (mineFirstTap) {
                placeMines(row, col);
                mineFirstTap = false;
            }
            if (mineBoard[row][col]) {
                mineFinished = true;
                for (int r = 0; r < 9; r++) for (int c = 0; c < 9; c++) if (mineBoard[r][c]) mineRevealed[r][c] = true;
                invalidate();
                return "踩雷，本局结束。";
            }
            revealMineCell(row, col);
            invalidate();
            return revealedMineSafeCount() == 71 ? "扫雷完成。" : "已展开。";
        }

        private void placeMines(int safeRow, int safeCol) {
            Random random = new Random();
            int placed = 0;
            while (placed < 10) {
                int row = random.nextInt(9);
                int col = random.nextInt(9);
                if (mineBoard[row][col]) continue;
                if (Math.abs(row - safeRow) <= 1 && Math.abs(col - safeCol) <= 1) continue;
                mineBoard[row][col] = true;
                placed++;
            }
            for (int row = 0; row < 9; row++) {
                for (int col = 0; col < 9; col++) {
                    int count = 0;
                    for (int dr = -1; dr <= 1; dr++) {
                        for (int dc = -1; dc <= 1; dc++) {
                            if (dr == 0 && dc == 0) continue;
                            int nr = row + dr;
                            int nc = col + dc;
                            if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && mineBoard[nr][nc]) count++;
                        }
                    }
                    mineCounts[row][col] = count;
                }
            }
        }

        private void revealMineCell(int row, int col) {
            if (row < 0 || row >= 9 || col < 0 || col >= 9 || mineRevealed[row][col] || mineBoard[row][col]) return;
            mineRevealed[row][col] = true;
            if (mineCounts[row][col] != 0) return;
            for (int dr = -1; dr <= 1; dr++) {
                for (int dc = -1; dc <= 1; dc++) {
                    if (dr != 0 || dc != 0) revealMineCell(row + dr, col + dc);
                }
            }
        }

        private int revealedMineSafeCount() {
            int count = 0;
            for (int row = 0; row < 9; row++) for (int col = 0; col < 9; col++) if (mineRevealed[row][col] && !mineBoard[row][col]) count++;
            return count;
        }

        private void drawMinesweeper(Canvas canvas) {
            BoardMetrics metrics = metrics();
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(214, 218, 211));
            canvas.drawRoundRect(metrics.outer, 18f, 18f, paint);
            paint.setColor(Color.rgb(188, 193, 185));
            canvas.drawRoundRect(metrics.grid, 8f, 8f, paint);
            float cell = metrics.cell;
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(Math.max(14f, cell * 0.48f));
            for (int row = 0; row < 9; row++) {
                for (int col = 0; col < 9; col++) {
                    RectF rect = new RectF(metrics.grid.left + col * cell + 2f, metrics.grid.top + row * cell + 2f,
                            metrics.grid.left + (col + 1) * cell - 2f, metrics.grid.top + (row + 1) * cell - 2f);
                    boolean revealed = mineRevealed[row][col];
                    paint.setStyle(Paint.Style.FILL);
                    paint.setColor(revealed ? Color.rgb(235, 235, 226) : Color.rgb(156, 164, 154));
                    canvas.drawRoundRect(rect, 5f, 5f, paint);
                    paint.setStyle(Paint.Style.STROKE);
                    paint.setStrokeWidth(1.1f);
                    paint.setColor(Color.argb(90, 66, 73, 64));
                    canvas.drawRoundRect(rect, 5f, 5f, paint);
                    paint.setStyle(Paint.Style.FILL);
                    if (revealed && mineBoard[row][col]) {
                        paint.setColor(Color.rgb(20, 20, 20));
                        canvas.drawCircle(rect.centerX(), rect.centerY(), cell * 0.22f, paint);
                    } else if (revealed && mineCounts[row][col] > 0) {
                        paint.setColor(mineNumberColor(mineCounts[row][col]));
                        canvas.drawText(String.valueOf(mineCounts[row][col]), rect.centerX(), rect.centerY() + cell * 0.17f, paint);
                    }
                }
            }
        }

        private int mineNumberColor(int number) {
            int[] colors = {Color.rgb(37, 99, 235), Color.rgb(22, 101, 52), Color.rgb(185, 28, 28), Color.rgb(88, 28, 135), Color.rgb(146, 64, 14), Color.rgb(14, 116, 144), Color.BLACK, Color.DKGRAY};
            return colors[Math.max(0, Math.min(colors.length - 1, number - 1))];
        }

        private void drawPartyTable(Canvas canvas) {
            float density = getResources().getDisplayMetrics().density;
            float width = getWidth();
            float height = getHeight();
            float pad = Math.max(18f * density, width * 0.045f);
            RectF frame = new RectF(pad, pad, width - pad, height - pad);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(isPoker() ? Color.argb(54, 24, 79, 63) : Color.argb(84, 15, 35, 58));
            canvas.drawRoundRect(frame, 24f, 24f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f * density);
            paint.setColor(Color.argb(70, 45, 212, 235));
            canvas.drawRoundRect(frame, 24f, 24f, paint);

            String title = isSpy() ? "谁是卧底" : isWerewolf() ? "狼人杀" : "扑克桌";
            String flow = isSpy() ? "发词 · 描述 · 投票 · 结算" : isWerewolf() ? "夜晚行动 · 白天发言 · 投票放逐" : "洗牌 · 发牌 · 出牌/下注 · 结算";
            paint.setStyle(Paint.Style.FILL);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(Math.min(30f * density, width * 0.075f));
            paint.setColor(Color.WHITE);
            canvas.drawText(title, frame.centerX(), frame.top + 48f * density, paint);
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextSize(Math.min(14f * density, width * 0.036f));
            paint.setColor(Color.rgb(186, 198, 215));
            canvas.drawText(flow, frame.centerX(), frame.top + 76f * density, paint);

            if (isPoker()) drawPokerSlots(canvas, frame, density);
            else {
                drawPartySeats(canvas, frame, density);
                drawPartyPhases(canvas, frame, density);
            }

            RectF hint = new RectF(frame.left + 18f * density, frame.bottom - 62f * density, frame.right - 18f * density, frame.bottom - 18f * density);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(105, 2, 6, 23));
            canvas.drawRoundRect(hint, 14f * density, 14f * density, paint);
            paint.setColor(Color.rgb(203, 213, 225));
            paint.setTextSize(13f * density);
            paint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(partyActionHint(), hint.centerX(), hint.centerY() + 5f * density, paint);
        }

        private void drawPartySeats(Canvas canvas, RectF frame, float density) {
            int seats = isWerewolf() ? 8 : 6;
            float cx = frame.centerX();
            float cy = frame.centerY() + 10f * density;
            float radiusX = frame.width() * 0.36f;
            float radiusY = frame.height() * 0.26f;
            for (int i = 0; i < seats; i++) {
                double angle = -Math.PI / 2 + i * Math.PI * 2 / seats;
                float x = cx + (float) Math.cos(angle) * radiusX;
                float y = cy + (float) Math.sin(angle) * radiusY;
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(i == 0 ? Color.rgb(25, 153, 107) : Color.rgb(30, 49, 76));
                canvas.drawRoundRect(new RectF(x - 42f * density, y - 22f * density, x + 42f * density, y + 22f * density), 12f * density, 12f * density, paint);
                paint.setColor(Color.WHITE);
                paint.setTextAlign(Paint.Align.CENTER);
                paint.setTypeface(Typeface.DEFAULT_BOLD);
                paint.setTextSize(12f * density);
                canvas.drawText(i == 0 ? "你" : "玩家 " + (i + 1), x, y + 5f * density, paint);
            }
            RectF center = new RectF(cx - 78f * density, cy - 48f * density, cx + 78f * density, cy + 48f * density);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(7, 13, 25));
            canvas.drawRoundRect(center, 16f * density, 16f * density, paint);
            paint.setColor(Color.rgb(245, 178, 57));
            paint.setTextSize(14f * density);
            canvas.drawText(isSpy() ? "词语保密" : "身份保密", center.centerX(), center.centerY() - 5f * density, paint);
            paint.setColor(Color.rgb(203, 213, 225));
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextSize(11f * density);
            canvas.drawText(isSpy() ? "发言后投票" : "夜晚后白天", center.centerX(), center.centerY() + 18f * density, paint);
        }

        private void drawPartyPhases(Canvas canvas, RectF frame, float density) {
            String[] phases = isSpy()
                    ? new String[]{"发词", "查看", "描述", "投票", "结算"}
                    : new String[]{"狼人", "预言家", "女巫", "发言", "放逐"};
            float chipGap = 7f * density;
            float chipW = Math.min(76f * density, (frame.width() - 46f * density - chipGap * (phases.length - 1)) / phases.length);
            float chipH = 30f * density;
            float startX = frame.centerX() - (chipW * phases.length + chipGap * (phases.length - 1)) / 2f;
            float y = frame.top + 98f * density;
            for (int i = 0; i < phases.length; i++) {
                RectF chip = new RectF(startX + i * (chipW + chipGap), y, startX + i * (chipW + chipGap) + chipW, y + chipH);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(i == 0 ? Color.argb(150, 45, 212, 235) : Color.argb(88, 15, 23, 42));
                canvas.drawRoundRect(chip, 10f * density, 10f * density, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.1f * density);
                paint.setColor(Color.argb(70, 255, 255, 255));
                canvas.drawRoundRect(chip, 10f * density, 10f * density, paint);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.WHITE);
                paint.setTextAlign(Paint.Align.CENTER);
                paint.setTypeface(Typeface.DEFAULT_BOLD);
                paint.setTextSize(Math.max(10f * density, Math.min(12f * density, chipW / 5f)));
                canvas.drawText(phases[i], chip.centerX(), chip.centerY() + 4f * density, paint);
            }
        }

        private void drawPokerSlots(Canvas canvas, RectF frame, float density) {
            String[] ranks = {"A", "K", "Q", "J", "10"};
            String[] suits = {"♠", "♥", "♣", "♦", "♠"};
            float cardW = Math.min(48f * density, frame.width() / 9f);
            float cardH = cardW * 1.38f;
            float gap = cardW * 0.22f;
            float startX = frame.centerX() - (cardW * 5 + gap * 4) / 2f;
            float y = frame.centerY() - cardH / 2f;
            for (int i = 0; i < 5; i++) {
                RectF card = new RectF(startX + i * (cardW + gap), y, startX + i * (cardW + gap) + cardW, y + cardH);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.rgb(248, 250, 252));
                canvas.drawRoundRect(card, 8f * density, 8f * density, paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.4f * density);
                paint.setColor(Color.rgb(15, 23, 42));
                canvas.drawRoundRect(card, 8f * density, 8f * density, paint);
                int ink = ("♥".equals(suits[i]) || "♦".equals(suits[i]))
                        ? Color.rgb(190, 45, 45) : Color.rgb(15, 23, 42);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(ink);
                paint.setTextAlign(Paint.Align.CENTER);
                paint.setTypeface(Typeface.DEFAULT_BOLD);
                paint.setTextSize(Math.max(13f * density, cardW * 0.34f));
                canvas.drawText(ranks[i], card.centerX(), card.top + cardH * 0.38f, paint);
                paint.setTextSize(Math.max(16f * density, cardW * 0.42f));
                canvas.drawText(suits[i], card.centerX(), card.top + cardH * 0.72f, paint);
            }
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(245, 178, 57));
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(14f * density);
            canvas.drawText("公共牌区", frame.centerX(), y - 16f * density, paint);
        }

        private void drawChinesePropertyBoard(Canvas canvas) {
            float side = Math.min(getWidth(), getHeight()) - 36f;
            RectF frame = new RectF((getWidth() - side) / 2f, (getHeight() - side) / 2f,
                    (getWidth() + side) / 2f, (getHeight() + side) / 2f);

            String[] names = {"起点", "北京", "机会", "上海", "所得税", "广州",
                    "监狱", "深圳", "命运", "杭州", "火车站", "南京",
                    "免费停车", "成都", "机会", "重庆", "奢侈税", "武汉",
                    "去监狱", "西安", "命运", "天津", "火车站", "青岛"};
            float corner = side * 0.124f;
            float cell = (side - corner * 2f) / 5f;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(50, 43, 34));
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(Math.max(10f, side * 0.022f));
            for (int index = 0; index < names.length; index++) {
                float x;
                float y;
                if (index == 0) {
                    x = frame.right - corner / 2f; y = frame.bottom - corner / 2f;
                } else if (index <= 5) {
                    x = frame.right - corner - (index - 0.5f) * cell; y = frame.bottom - corner / 2f;
                } else if (index == 6) {
                    x = frame.left + corner / 2f; y = frame.bottom - corner / 2f;
                } else if (index <= 11) {
                    x = frame.left + corner / 2f; y = frame.bottom - corner - (index - 6.5f) * cell;
                } else if (index == 12) {
                    x = frame.left + corner / 2f; y = frame.top + corner / 2f;
                } else if (index <= 17) {
                    x = frame.left + corner + (index - 12.5f) * cell; y = frame.top + corner / 2f;
                } else if (index == 18) {
                    x = frame.right - corner / 2f; y = frame.top + corner / 2f;
                } else {
                    x = frame.right - corner / 2f; y = frame.top + corner + (index - 18.5f) * cell;
                }
                canvas.drawText(names[index], x, y + paint.getTextSize() * 0.35f, paint);
            }

            paint.setTextSize(Math.max(20f, side * 0.052f));
            paint.setColor(Color.rgb(137, 83, 37));
            canvas.drawText("中国城市环游", frame.centerX(), frame.centerY() + paint.getTextSize() * 0.35f, paint);
        }

        // ===== 国内版飞行棋（与鸿蒙版同源）：经典棋盘底图 + 百分比坐标 =====
        // 玩家：0红(左上) 1黄(右上) 2蓝(右下) 3绿(左下)；四角机场色与坐标同序；起飞点 0/13/26/39；
        // 主跑道 52 格，终点通道 5 格；相对进度 0..50 跑道 / 51..55 通道 / 56 终点
        private static final float[] LUDO_ROUTE_X = {11.80f, 18.17f, 24.53f, 30.90f, 37.27f, 43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 50.00f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 62.73f, 69.10f, 75.47f, 81.83f, 88.20f, 94.57f, 94.57f, 94.57f, 88.20f, 81.83f, 75.47f, 69.10f, 62.73f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 50.00f, 43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 37.27f, 30.90f, 24.53f, 18.17f, 11.80f, 5.43f, 5.43f, 5.43f};
        private static final float[] LUDO_ROUTE_Y = {43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 37.27f, 30.90f, 24.53f, 18.17f, 11.80f, 5.43f, 5.43f, 5.43f, 11.80f, 18.17f, 24.53f, 30.90f, 37.27f, 43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 43.63f, 50.00f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 62.73f, 69.10f, 75.47f, 81.83f, 88.20f, 94.57f, 94.57f, 94.57f, 88.20f, 81.83f, 75.47f, 69.10f, 62.73f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 56.37f, 50.00f, 43.63f};
        private static final String[] LUDO_ROUTE_COLOR = {"#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54", "#E94B3C", "#F5A623", "#3B7DD8", "#229B54"};
        private static final float[][] LUDO_HOME_X = {{11.80f, 18.17f, 24.53f, 30.90f, 37.27f}, {50.00f, 50.00f, 50.00f, 50.00f, 50.00f}, {88.20f, 81.83f, 75.47f, 69.10f, 62.73f}, {50.00f, 50.00f, 50.00f, 50.00f, 50.00f}};
        private static final float[][] LUDO_HOME_Y = {{50.00f, 50.00f, 50.00f, 50.00f, 50.00f}, {11.80f, 18.17f, 24.53f, 30.90f, 37.27f}, {50.00f, 50.00f, 50.00f, 50.00f, 50.00f}, {88.20f, 81.83f, 75.47f, 69.10f, 62.73f}};
        private static final int[] LUDO_START_OFFSET = {0, 13, 26, 39};
        // 四角停机坪 16 个机位（顺序 player*4+piece）：0红左上 / 1黄右上 / 2蓝右下 / 3绿左下
        private static final float[] LUDO_BASE_X = {14.98f, 27.72f, 14.98f, 27.72f, 72.28f, 85.02f, 72.28f, 85.02f, 72.28f, 85.02f, 72.28f, 85.02f, 14.98f, 27.72f, 14.98f, 27.72f};
        private static final float[] LUDO_BASE_Y = {14.98f, 14.98f, 27.72f, 27.72f, 14.98f, 14.98f, 27.72f, 27.72f, 72.28f, 72.28f, 85.02f, 85.02f, 72.28f, 72.28f, 85.02f, 85.02f};
        private static final float[] LUDO_FINISH_X = {48.09f, 51.53f, 51.53f, 48.09f};
        private static final float[] LUDO_FINISH_Y = {48.09f, 48.09f, 51.53f, 51.53f};

        private Bitmap ludoBoardBitmap;

        private String ludoColorName(int player) {
            return new String[]{"红", "黄", "蓝", "绿"}[Math.max(0, Math.min(3, player))];
        }

        private String ludoPlayerColorHex(int player) {
            return new String[]{"#E94B3C", "#F5A623", "#3B7DD8", "#229B54"}[Math.max(0, Math.min(3, player))];
        }

        private int ludoPlayerColorInt(int player) {
            return new int[]{Color.rgb(233, 75, 60), Color.rgb(245, 166, 35), Color.rgb(59, 125, 216), Color.rgb(34, 155, 84)}[Math.max(0, Math.min(3, player))];
        }

        private void drawLudoBoard(Canvas canvas) {
            RectF frame = new RectF(22f, 24f, getWidth() - 22f, getHeight() - 24f);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(22, 226, 232, 240));
            canvas.drawRoundRect(frame, 24f, 24f, paint);
            if (ludoBoardBitmap == null) {
                ludoBoardBitmap = BitmapFactory.decodeResource(getResources(), R.drawable.ludo_board);
            }
            float side = Math.min(frame.width(), frame.height());
            float left = frame.centerX() - side / 2f;
            float top = frame.centerY() - side / 2f;
            if (ludoBoardBitmap != null) {
                canvas.drawBitmap(ludoBoardBitmap, null, new RectF(left, top, left + side, top + side), paint);
            }

            paint.setTextSize(Math.max(13f, side * 0.034f));
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setColor(Color.rgb(15, 23, 42));
            canvas.drawText("骰子 " + (ludoDice == 0 ? "-" : ludoDice) + " · 当前 " + ludoColorName(ludoTurn),
                    frame.centerX(), frame.top + Math.max(20f, side * 0.026f), paint);

            for (int player = 0; player < 4; player++) {
                for (int piece = 0; piece < 4; piece++) {
                    PointF point = ludoPlanePoint(left, top, side, player, piece, ludoPieces[player][piece]);
                    drawLudoPlane(canvas, point.x, point.y, side * 0.027f, ludoPlayerColorInt(player));
                }
            }
        }

        // 飞机落点：-1 基地机位 / 0..50 主跑道（同格叠子横向错开）/ 51..55 终点通道 / 56 终点
        private PointF ludoPlanePoint(float left, float top, float side, int player, int piece, int p) {
            if (p < 0) {
                int idx = player * 4 + piece;
                return new PointF(left + LUDO_BASE_X[idx] / 100f * side, top + LUDO_BASE_Y[idx] / 100f * side);
            }
            if (p <= 50) {
                int cell = (p + LUDO_START_OFFSET[player]) % 52;
                float stack = 0f;
                for (int k = 0; k < piece; k++) {
                    int q = ludoPieces[player][k];
                    if (q >= 0 && q <= 50 && (q + LUDO_START_OFFSET[player]) % 52 == cell) stack += 1f;
                }
                return new PointF(left + (LUDO_ROUTE_X[cell] + stack * 2.4f) / 100f * side,
                        top + LUDO_ROUTE_Y[cell] / 100f * side);
            }
            if (p < 56) {
                return new PointF(left + LUDO_HOME_X[player][p - 51] / 100f * side,
                        top + LUDO_HOME_Y[player][p - 51] / 100f * side);
            }
            return new PointF(left + LUDO_FINISH_X[player] / 100f * side,
                    top + LUDO_FINISH_Y[player] / 100f * side);
        }

        private void drawLudoPlane(Canvas canvas, float x, float y, float radius, int color) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            Path plane = new Path();
            plane.moveTo(x + radius, y);
            plane.lineTo(x + radius * 0.12f, y - radius * 0.24f);
            plane.lineTo(x - radius * 0.22f, y - radius * 0.86f);
            plane.lineTo(x - radius * 0.5f, y - radius * 0.86f);
            plane.lineTo(x - radius * 0.32f, y - radius * 0.18f);
            plane.lineTo(x - radius, y - radius * 0.42f);
            plane.lineTo(x - radius, y + radius * 0.16f);
            plane.lineTo(x - radius * 0.28f, y + radius * 0.18f);
            plane.lineTo(x - radius * 0.48f, y + radius * 0.72f);
            plane.lineTo(x - radius * 0.1f, y + radius * 0.72f);
            plane.close();
            canvas.drawPath(plane, paint);
            paint.setColor(Color.argb(230, 255, 255, 255));
            canvas.drawCircle(x + radius * 0.36f, y - radius * 0.02f, radius * 0.2f, paint);
        }

        private void drawChineseChessBoard(Canvas canvas) {
            BoardMetrics metrics = metrics();
            paint.setStyle(Paint.Style.FILL);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f);
            paint.setColor(Color.rgb(78, 52, 25));
            float gapX = metrics.grid.width() / 8f;
            float gapY = metrics.grid.height() / 9f;
            for (int c = 0; c < 9; c++) canvas.drawLine(metrics.grid.left + c * gapX, metrics.grid.top, metrics.grid.left + c * gapX, metrics.grid.bottom, paint);
            for (int r = 0; r < 10; r++) canvas.drawLine(metrics.grid.left, metrics.grid.top + r * gapY, metrics.grid.right, metrics.grid.top + r * gapY, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(32f);
            paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            canvas.drawText("楚河   汉界", metrics.grid.centerX(), metrics.grid.centerY() + 12f, paint);
            for (int row = 0; row < 10; row++) {
                for (int col = 0; col < 9; col++) {
                    String piece = board[row][col];
                    if (piece == null) continue;
                    drawChinesePiece(canvas, metrics.grid.left + col * gapX, metrics.grid.top + row * gapY, Math.min(gapX, gapY) * 0.36f, piece, row == selectedRow && col == selectedCol);
                }
            }
        }

        private void drawChinesePiece(Canvas canvas, float x, float y, float radius, String piece, boolean selected) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(selected ? Color.rgb(254, 243, 199) : Color.rgb(250, 231, 193));
            canvas.drawCircle(x, y, radius, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(selected ? 4f : 2.2f);
            boolean red = piece.startsWith("r");
            paint.setColor(red ? Color.rgb(185, 28, 28) : Color.rgb(30, 41, 59));
            canvas.drawCircle(x, y, radius, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTypeface(Typeface.DEFAULT_BOLD);
            paint.setTextSize(radius * 1.02f);
            canvas.drawText(chinesePieceText(piece), x, y + radius * 0.34f, paint);
        }

        private BoardMetrics metrics() {
            int side = Math.max(1, Math.min(getWidth(), getHeight()) - Math.max(16, (int) (Math.min(getWidth(), getHeight()) * 0.035f)));
            float left = (getWidth() - side) / 2f;
            float top = (getHeight() - side) / 2f;
            RectF outer = new RectF(left, top, left + side, top + side);
            float inset = isCellBased() ? Math.max(14f, side * 0.035f) : Math.max(22f, side * 0.045f);
            RectF grid = new RectF(outer.left + inset, outer.top + inset, outer.right - inset, outer.bottom - inset);
            float cell = isCellBased() ? grid.width() / boardSize : 0f;
            float gap = isCellBased() ? cell : grid.width() / Math.max(1, boardSize - 1);
            return new BoardMetrics(outer, grid, gap, cell);
        }

        private void drawStarPoints(Canvas canvas, BoardMetrics metrics) {
            if (isCellBased()) return;
            int[] stars = boardSize == 15 ? new int[]{3, 7, 11} : new int[]{3, 9, 15};
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(49, 34, 18));
            float radius = Math.max(4f, metrics.gap * 0.09f);
            for (int row : stars) {
                if (row >= boardSize) continue;
                for (int col : stars) {
                    if (col >= boardSize) continue;
                    canvas.drawCircle(xFor(metrics, col), yFor(metrics, row), radius, paint);
                }
            }
        }

        private void drawStone(Canvas canvas, BoardMetrics metrics, int row, int col, String stone) {
            float cx = xFor(metrics, col);
            float cy = yFor(metrics, row);
            float radius = Math.max(9f, (isCellBased() ? metrics.cell : metrics.gap) * 0.39f);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb("black".equals(stone) ? 88 : 54, 0, 0, 0));
            canvas.drawCircle(cx + 2f, cy + 3f, radius, paint);
            paint.setColor("white".equals(stone) ? Color.rgb(244, 240, 229) : Color.rgb(10, 12, 15));
            canvas.drawCircle(cx, cy, radius, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f);
            paint.setColor("white".equals(stone) ? Color.rgb(167, 158, 139) : Color.rgb(2, 4, 7));
            canvas.drawCircle(cx, cy, radius, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor("white".equals(stone) ? Color.argb(190, 255, 255, 255) : Color.argb(45, 255, 255, 255));
            canvas.drawCircle(cx - radius * 0.28f, cy - radius * 0.32f, radius * 0.22f, paint);
            if (lastRow == row && lastCol == col) {
                paint.setColor("white".equals(stone) ? Color.rgb(39, 48, 64) : Color.rgb(245, 182, 55));
                canvas.drawCircle(cx, cy, Math.max(4f, radius * 0.16f), paint);
            }
        }

        private float xFor(BoardMetrics metrics, int col) {
            return isCellBased() ? metrics.grid.left + (col + 0.5f) * metrics.cell : metrics.grid.left + col * metrics.gap;
        }

        private float yFor(BoardMetrics metrics, int row) {
            return isCellBased() ? metrics.grid.top + (row + 0.5f) * metrics.cell : metrics.grid.top + row * metrics.gap;
        }

        private int[] coordinateFor(float x, float y) {
            BoardMetrics metrics = metrics();
            if (isCellBased()) {
                if (!metrics.grid.contains(x, y)) return null;
                int col = Math.min(boardSize - 1, Math.max(0, (int) ((x - metrics.grid.left) / metrics.cell)));
                int row = Math.min(boardSize - 1, Math.max(0, (int) ((y - metrics.grid.top) / metrics.cell)));
                return new int[]{row, col};
            }
            RectF tap = new RectF(metrics.grid.left - metrics.gap / 2f, metrics.grid.top - metrics.gap / 2f,
                    metrics.grid.right + metrics.gap / 2f, metrics.grid.bottom + metrics.gap / 2f);
            if (!tap.contains(x, y)) return null;
            int col = Math.min(boardSize - 1, Math.max(0, Math.round((x - metrics.grid.left) / metrics.gap)));
            int row = Math.min(boardSize - 1, Math.max(0, Math.round((y - metrics.grid.top) / metrics.gap)));
            return new int[]{row, col};
        }

        private static final class BoardMetrics {
            final RectF outer;
            final RectF grid;
            final float gap;
            final float cell;

            BoardMetrics(RectF outer, RectF grid, float gap, float cell) {
                this.outer = outer;
                this.grid = grid;
                this.gap = gap;
                this.cell = cell;
            }
        }

        private int[] tacticalMove(String stone, boolean winningOnly) {
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (!canPlace(row, col, stone)) continue;
                    board[row][col] = stone;
                    boolean wins = hasWinner(row, col, stone);
                    board[row][col] = null;
                    if (wins || !winningOnly) return new int[]{row, col};
                }
            }
            return null;
        }

        private String opponentOf(String stone) {
            return "black".equals(stone) ? "white" : "black";
        }

        private int centerBias(int row, int col) {
            int center = boardSize / 2;
            int distance = Math.abs(row - center) + Math.abs(col - center);
            return Math.max(0, boardSize * 2 - distance * 2);
        }

        private int neighborBias(int row, int col) {
            int score = 0;
            for (int dr = -2; dr <= 2; dr++) {
                for (int dc = -2; dc <= 2; dc++) {
                    if (dr == 0 && dc == 0) continue;
                    int r = row + dr;
                    int c = col + dc;
                    if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                    if (board[r][c] != null) score += (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) ? 8 : 3;
                }
            }
            return score;
        }

        private int linePotentialScore(int row, int col, String stone) {
            int score = 0;
            int[][] dirs = {{1, 0}, {0, 1}, {1, 1}, {1, -1}};
            for (int[] dir : dirs) {
                int forward = count(row, col, dir[0], dir[1], stone);
                int backward = count(row, col, -dir[0], -dir[1], stone);
                int total = 1 + forward + backward;
                int open = 0;
                if (isOpenEnd(row + dir[0] * (forward + 1), col + dir[1] * (forward + 1))) open++;
                if (isOpenEnd(row - dir[0] * (backward + 1), col - dir[1] * (backward + 1))) open++;
                score += lineShapeScore(total, open);
            }
            return score;
        }

        private int lineShapeScore(int total, int open) {
            if (total >= 5) return 1_000_000;
            if (total == 4 && open == 2) return 120_000;
            if (total == 4 && open == 1) return 35_000;
            if (total == 3 && open == 2) return 8_000;
            if (total == 3 && open == 1) return 1_500;
            if (total == 2 && open == 2) return 450;
            if (total == 2 && open == 1) return 90;
            if (total == 1 && open == 2) return 16;
            return 2;
        }

        private boolean isOpenEnd(int row, int col) {
            return row >= 0 && row < boardSize && col >= 0 && col < boardSize && board[row][col] == null;
        }

        private String ticTacToeWinner() {
            for (int row = 0; row < 3; row++) {
                if (board[row][0] != null && board[row][0].equals(board[row][1]) && board[row][0].equals(board[row][2])) return board[row][0];
            }
            for (int col = 0; col < 3; col++) {
                if (board[0][col] != null && board[0][col].equals(board[1][col]) && board[0][col].equals(board[2][col])) return board[0][col];
            }
            if (board[0][0] != null && board[0][0].equals(board[1][1]) && board[0][0].equals(board[2][2])) return board[0][0];
            if (board[0][2] != null && board[0][2].equals(board[1][1]) && board[0][2].equals(board[2][0])) return board[0][2];
            return null;
        }

        private boolean boardFull() {
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (board[row][col] == null) return false;
                }
            }
            return true;
        }

        private boolean isCorner(int row, int col) {
            return (row == 0 || row == boardSize - 1) && (col == 0 || col == boardSize - 1);
        }

        private boolean isBadCornerNeighbor(int row, int col) {
            if (!isReversi()) return false;
            int[][] bad = {{0, 1}, {1, 0}, {1, 1}, {0, 6}, {1, 6}, {1, 7}, {6, 0}, {6, 1}, {7, 1}, {6, 6}, {6, 7}, {7, 6}};
            for (int[] cell : bad) {
                if (row == cell[0] && col == cell[1]) return true;
            }
            return false;
        }

        private int legalMoveCount(String stone, int simRow, int simCol, String simStone) {
            String previous = board[simRow][simCol];
            board[simRow][simCol] = simStone;
            int count = 0;
            for (int row = 0; row < boardSize; row++) {
                for (int col = 0; col < boardSize; col++) {
                    if (canPlace(row, col, stone)) count++;
                }
            }
            board[simRow][simCol] = previous;
            return count;
        }

        private int captureScoreAround(int row, int col, String opponent) {
            int score = 0;
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (int[] dir : dirs) {
                int r = row + dir[0];
                int c = col + dir[1];
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (opponent.equals(board[r][c]) && !groupHasLiberty(r, c, new boolean[19][19])) {
                    score += groupSize(r, c, opponent, new boolean[19][19]);
                }
            }
            return score;
        }

        private int goLiberties(int row, int col) {
            int score = 0;
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (int[] dir : dirs) {
                int r = row + dir[0];
                int c = col + dir[1];
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (board[r][c] == null) score += 3;
                else if (board[row][col].equals(board[r][c])) score += 1;
            }
            return score;
        }

        private int groupSize(int row, int col, String stone, boolean[][] seen) {
            if (row < 0 || row >= boardSize || col < 0 || col >= boardSize || seen[row][col] || !stone.equals(board[row][col])) return 0;
            seen[row][col] = true;
            return 1
                    + groupSize(row + 1, col, stone, seen)
                    + groupSize(row - 1, col, stone, seen)
                    + groupSize(row, col + 1, stone, seen)
                    + groupSize(row, col - 1, stone, seen);
        }

        private boolean canPlaceGo(int row, int col, String stone) {
            board[row][col] = stone;
            boolean ok = groupHasLiberty(row, col, new boolean[19][19]) || wouldCaptureGo(row, col, stone);
            board[row][col] = null;
            return ok;
        }

        private boolean wouldCaptureGo(int row, int col, String stone) {
            String opponent = "black".equals(stone) ? "white" : "black";
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (int[] dir : dirs) {
                int r = row + dir[0];
                int c = col + dir[1];
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (opponent.equals(board[r][c]) && !groupHasLiberty(r, c, new boolean[19][19])) return true;
            }
            return false;
        }

        private void captureGoNeighbors(int row, int col, String stone) {
            String opponent = "black".equals(stone) ? "white" : "black";
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (int[] dir : dirs) {
                int r = row + dir[0];
                int c = col + dir[1];
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (opponent.equals(board[r][c]) && !groupHasLiberty(r, c, new boolean[19][19])) {
                    removeGoGroup(r, c, opponent, new boolean[19][19]);
                }
            }
        }

        private boolean groupHasLiberty(int row, int col, boolean[][] seen) {
            String stone = board[row][col];
            if (stone == null) return true;
            seen[row][col] = true;
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
            for (int[] dir : dirs) {
                int r = row + dir[0];
                int c = col + dir[1];
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
                if (board[r][c] == null) return true;
                if (stone.equals(board[r][c]) && !seen[r][c] && groupHasLiberty(r, c, seen)) return true;
            }
            return false;
        }

        private void removeGoGroup(int row, int col, String stone, boolean[][] seen) {
            if (row < 0 || row >= boardSize || col < 0 || col >= boardSize || seen[row][col] || !stone.equals(board[row][col])) return;
            seen[row][col] = true;
            board[row][col] = null;
            removeGoGroup(row + 1, col, stone, seen);
            removeGoGroup(row - 1, col, stone, seen);
            removeGoGroup(row, col + 1, stone, seen);
            removeGoGroup(row, col - 1, stone, seen);
        }

        private int[] coordinateForChinese(float x, float y) {
            BoardMetrics metrics = metrics();
            float gapX = metrics.grid.width() / 8f;
            float gapY = metrics.grid.height() / 9f;
            RectF tap = new RectF(metrics.grid.left - gapX / 2f, metrics.grid.top - gapY / 2f, metrics.grid.right + gapX / 2f, metrics.grid.bottom + gapY / 2f);
            if (!tap.contains(x, y)) return null;
            int col = Math.min(8, Math.max(0, Math.round((x - metrics.grid.left) / gapX)));
            int row = Math.min(9, Math.max(0, Math.round((y - metrics.grid.top) / gapY)));
            return new int[]{row, col};
        }

        public String playLudoTurn() {
            ludoDice = 1 + (int) (Math.random() * 6);
            int player = ludoTurn;
            int dice = ludoDice;
            String name = ludoColorName(player);
            // 中国规则自动选最佳：能撞子 > 到终点 > 起飞 > 落同色格 > 前进
            int best = -1;
            int bestScore = -1;
            for (int i = 0; i < 4; i++) {
                int p = ludoPieces[player][i];
                if (p == 56) continue;
                if (p < 0 && dice != 6) continue;
                int score;
                if (p < 0) {
                    score = 1;
                } else {
                    int np = p + dice;
                    if (np > 56) np = 112 - np;
                    score = 2;
                    if (np < 51) {
                        int abs = (np + LUDO_START_OFFSET[player]) % 52;
                        for (int opp = 0; opp < 4; opp++) {
                            if (opp == player) continue;
                            for (int j = 0; j < 4; j++) {
                                int op = ludoPieces[opp][j];
                                if (op >= 0 && op < 51 && (op + LUDO_START_OFFSET[opp]) % 52 == abs) score = 10;
                            }
                        }
                        if (LUDO_ROUTE_COLOR[abs].equals(ludoPlayerColorHex(player))) score = Math.max(score, 5);
                    }
                    if (np == 56) score = 20;
                }
                if (score > bestScore) { bestScore = score; best = i; }
            }
            if (best < 0) {
                ludoTurn = (ludoTurn + 1) % 4;
                invalidate();
                return name + "掷出 " + dice + "，无可动飞机。";
            }
            int old = ludoPieces[player][best];
            int np;
            StringBuilder result = new StringBuilder(name).append("家第 ").append(best + 1).append(" 架");
            if (old < 0) {
                np = 0;
                result.append("起飞（掷 6）");
            } else {
                np = old + dice;
                if (np > 56) {
                    np = 112 - np;
                    result.append("超程反弹");
                } else {
                    result.append("前进 ").append(dice).append(" 格");
                }
            }
            if (np >= 0 && np < 51) {
                int abs = (np + LUDO_START_OFFSET[player]) % 52;
                result.append(ludoCaptureAt(abs, player));
                if (LUDO_ROUTE_COLOR[abs].equals(ludoPlayerColorHex(player)) && np + 4 <= 50) {
                    np += 4;
                    result.append("，同色连跳 4 格！");
                    if (np < 51) result.append(ludoCaptureAt((np + LUDO_START_OFFSET[player]) % 52, player));
                }
            }
            if (np == 56) result.append("，到达终点！");
            ludoPieces[player][best] = np;
            boolean allDone = true;
            for (int v : ludoPieces[player]) if (v != 56) allDone = false;
            if (allDone) {
                invalidate();
                return result.append("，").append(name).append("家 4 架全部到达终点，获胜！🏆").toString();
            }
            if (dice != 6) ludoTurn = (ludoTurn + 1) % 4;
            invalidate();
            return result.toString();
        }

        private String ludoCaptureAt(int abs, int player) {
            StringBuilder msg = new StringBuilder();
            for (int opp = 0; opp < 4; opp++) {
                if (opp == player) continue;
                for (int j = 0; j < 4; j++) {
                    int op = ludoPieces[opp][j];
                    if (op >= 0 && op < 51 && (op + LUDO_START_OFFSET[opp]) % 52 == abs) {
                        ludoPieces[opp][j] = -1;
                        msg.append("，撞回").append(ludoColorName(opp)).append("家");
                    }
                }
            }
            return msg.toString();
        }

        public String playChineseChessTap(int row, int col, String stone) {
            String side = "black".equals(stone) ? "r" : "b";
            String piece = board[row][col];
            if (selectedRow < 0) {
                if (piece != null && piece.startsWith(side)) {
                    selectedRow = row;
                    selectedCol = col;
                    invalidate();
                    return "已选中" + chinesePieceText(piece);
                }
                return "";
            }
            String selected = board[selectedRow][selectedCol];
            if (selected == null) {
                selectedRow = -1;
                selectedCol = -1;
                return "";
            }
            if (piece != null && piece.startsWith(side)) {
                selectedRow = row;
                selectedCol = col;
                invalidate();
                return "已选中" + chinesePieceText(piece);
            }
                boolean capturedKing = "rk".equals(piece) || "bk".equals(piece);
                int player = "r".equals(side) ? 1 : 2;
                BoardAnalysis.Position position = toAnalysisPosition(player);
                BoardAnalysis.ApplyResult applied = BoardAnalysis.applyMove(position,
                        new BoardAnalysis.Move(selectedRow * 9 + selectedCol, row * 9 + col));
                if (!applied.ok) return applied.reason;
                applyAnalysisPosition(applied.position);
                return capturedKing ? "已走，" + ("r".equals(side) ? "红方" : "黑方") + "获胜。" : "已走";
            }

        public String playChineseChessAi(String stone) {
            String side = "black".equals(stone) ? "r" : "b";
            int[] fallback = null;
            for (int sr = 0; sr < 10; sr++) {
                for (int sc = 0; sc < 9; sc++) {
                    String piece = board[sr][sc];
                    if (piece == null || !piece.startsWith(side)) continue;
                    for (int tr = 0; tr < 10; tr++) {
                        for (int tc = 0; tc < 9; tc++) {
                            if (!isLegalChineseMove(sr, sc, tr, tc)) continue;
                            if (fallback == null) fallback = new int[]{sr, sc, tr, tc};
                            if (board[tr][tc] != null) {
                                selectedRow = sr;
                                selectedCol = sc;
                                return playChineseChessTap(tr, tc, stone);
                            }
                        }
                    }
                }
            }
            if (fallback == null) return "无棋可走";
            selectedRow = fallback[0];
            selectedCol = fallback[1];
            return playChineseChessTap(fallback[2], fallback[3], stone);
        }

        private boolean isLegalChineseMove(int sr, int sc, int tr, int tc) {
            if (sr == tr && sc == tc) return false;
            String piece = board[sr][sc];
            if (piece == null) return false;
            String target = board[tr][tc];
            if (target != null && target.charAt(0) == piece.charAt(0)) return false;
            int dr = tr - sr;
            int dc = tc - sc;
            char type = piece.charAt(1);
            if (type == 'r') return (sr == tr || sc == tc) && piecesBetween(sr, sc, tr, tc) == 0;
            if (type == 'c') return (sr == tr || sc == tc) && piecesBetween(sr, sc, tr, tc) == (target == null ? 0 : 1);
            if (type == 'n') {
                if (!((Math.abs(dr) == 2 && Math.abs(dc) == 1) || (Math.abs(dr) == 1 && Math.abs(dc) == 2))) return false;
                int legR = sr + (Math.abs(dr) == 2 ? dr / 2 : 0);
                int legC = sc + (Math.abs(dc) == 2 ? dc / 2 : 0);
                return board[legR][legC] == null;
            }
            if (type == 'b') return Math.abs(dr) == 2 && Math.abs(dc) == 2 && board[sr + dr / 2][sc + dc / 2] == null && (piece.startsWith("r") ? tr >= 5 : tr <= 4);
            if (type == 'a') return Math.abs(dr) == 1 && Math.abs(dc) == 1 && inPalace(tr, tc, piece.startsWith("r"));
            if (type == 'k') {
                if (sc == tc && target != null && target.endsWith("k")) return piecesBetween(sr, sc, tr, tc) == 0;
                return Math.abs(dr) + Math.abs(dc) == 1 && inPalace(tr, tc, piece.startsWith("r"));
            }
            if (type == 'p') {
                int forward = piece.startsWith("r") ? -1 : 1;
                boolean crossed = piece.startsWith("r") ? sr <= 4 : sr >= 5;
                return (dr == forward && dc == 0) || (crossed && dr == 0 && Math.abs(dc) == 1);
            }
            return false;
        }

        private boolean inPalace(int row, int col, boolean red) {
            return col >= 3 && col <= 5 && (red ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
        }

        private int piecesBetween(int sr, int sc, int tr, int tc) {
            int total = 0;
            int dr = Integer.compare(tr, sr);
            int dc = Integer.compare(tc, sc);
            int r = sr + dr;
            int c = sc + dc;
            while (r != tr || c != tc) {
                if (board[r][c] != null) total++;
                r += dr;
                c += dc;
            }
            return total;
        }

        private String chinesePieceText(String piece) {
            if (piece == null || piece.length() < 2) return "";
            boolean red = piece.startsWith("r");
            switch (piece.charAt(1)) {
                case 'k': return red ? "帅" : "将";
                case 'a': return red ? "仕" : "士";
                case 'b': return red ? "相" : "象";
                case 'n': return "马";
                case 'r': return "车";
                case 'c': return "炮";
                case 'p': return red ? "兵" : "卒";
                default: return "";
            }
        }

        public boolean hasWinner(int row, int col, String stone) {
            if (!(isGobang() || isTicTacToe())) return false;
            int target = isTicTacToe() ? 3 : 5;
            int[][] dirs = {{1, 0}, {0, 1}, {1, 1}, {1, -1}};
            for (int[] dir : dirs) {
                int total = 1 + count(row, col, dir[0], dir[1], stone) + count(row, col, -dir[0], -dir[1], stone);
                if (total >= target) return true;
            }
            return false;
        }

        private int count(int row, int col, int dr, int dc, String stone) {
            int total = 0;
            for (int step = 1; step < 5; step++) {
                int r = row + dr * step;
                int c = col + dc * step;
                if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) break;
                if (!stone.equals(board[r][c])) break;
                total++;
            }
            return total;
        }

        private int flipsFor(int row, int col, String stone, boolean apply) {
            String opponent = "black".equals(stone) ? "white" : "black";
            int total = 0;
            int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
            for (int[] dir : dirs) {
                int r = row + dir[0];
                int c = col + dir[1];
                int found = 0;
                while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && opponent.equals(board[r][c])) {
                    found++;
                    r += dir[0];
                    c += dir[1];
                }
                if (found == 0 || r < 0 || r >= boardSize || c < 0 || c >= boardSize || !stone.equals(board[r][c])) continue;
                total += found;
                if (apply) {
                    for (int step = 1; step <= found; step++) {
                        board[row + dir[0] * step][col + dir[1] * step] = stone;
                    }
                }
            }
            return total;
        }
    }
}
