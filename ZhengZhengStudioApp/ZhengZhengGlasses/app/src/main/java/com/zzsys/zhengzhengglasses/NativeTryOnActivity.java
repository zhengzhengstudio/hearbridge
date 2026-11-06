package com.zzsys.zhengzhengglasses;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.activity.ComponentActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NativeTryOnActivity extends ComponentActivity {
    private static final int REQ_CAMERA = 801;
    private static final String TAG = "ZhengZhengFace";
    private static final String MODEL_ASSET = "face_landmarker.task";

    private PreviewView previewView;
    private TryOnOverlay overlay;
    private TextView statusLabel;
    private TextView metricLabel;
    private ExecutorService cameraExecutor;   // 只给 ImageAnalysis  Analyzer 用
    private ExecutorService workExecutor;      // 模型加载 / 镜框图下载，避免被帧分析饿死
    private FaceLandmarker faceLandmarker;
    private ProcessCameraProvider cameraProvider;
    private int lensFacing = CameraSelector.LENS_FACING_FRONT;
    private long lastAnalyzeMs = 0;
    private int frameCount = 0;
    private volatile boolean modelLoading = false;
    private boolean cameraBound = false;
    private boolean captureMode = false;
    private int lastFacePointCount = 0;
    private String tryOnImageUrl = "";

    // 真实镜框试戴图由 TryOnOverlay 持有；这里只记录框名用于界面提示。
    private String frameName = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        captureMode = getIntent().getBooleanExtra("captureMode", false);
        frameName = getIntent().getStringExtra("frameName");
        cameraExecutor = Executors.newSingleThreadExecutor();
        workExecutor = Executors.newSingleThreadExecutor();
        buildUi();
        final String tryOnImage = getIntent().getStringExtra("tryOnImage");
        if (!captureMode && tryOnImage != null && !tryOnImage.isEmpty()) {
            tryOnImageUrl = tryOnImage;
            loadTryOnBitmap(tryOnImage);
        }
        if (hasCameraPermission()) {
            startCameraFlow();
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onDestroy() {
        stopCameraFlow();
        if (cameraExecutor != null) cameraExecutor.shutdown();
        if (workExecutor != null) workExecutor.shutdown();
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (cameraProvider != null) cameraProvider.unbindAll();
        cameraBound = false;
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 原来要求 faceLandmarker != null 才重绑：模型加载期间或加载失败后切后台再回来，
        // 相机永远不再绑定，画面停在最后一帧/黑屏。只要有权限就该重绑。
        if (previewView != null && hasCameraPermission() && !cameraBound) bindCamera();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCameraFlow();
        } else {
            statusLabel.setText("未授权摄像头");
            metricLabel.setText("请在系统设置里允许摄像头，才能使用原生试戴。");
            // 永久拒绝后 App 内必须能直达设置，否则用户无法恢复
            new AlertDialog.Builder(this)
                .setTitle("需要摄像头权限")
                .setMessage("没有摄像头权限无法使用实时试戴 / 多角度采集。请到系统设置里开启「相机」权限后返回。")
                .setPositiveButton("去设置", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getPackageName()));
                    try { startActivity(intent); } catch (Exception e) { finish(); }
                })
                .setNegativeButton("返回", (dialog, which) -> finish())
                .show();
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(9, 22, 25));

        previewView = new PreviewView(this);
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        overlay = new TryOnOverlay(this);
        overlay.drawGlasses = !captureMode;
        // 采集模式原来 drawGlasses/drawMesh 都关着，画面什么都不画，与「显示人脸关键点」的文案矛盾
        overlay.drawMesh = captureMode;
        root.addView(overlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        LinearLayout top = panel();
        top.setPadding(dp(14), dp(12), dp(14), dp(12));
        statusLabel = label(captureMode ? "正在启动多角度采集" : ("正在启动实时试戴" + (frameName != null && !frameName.isEmpty() ? "：" + frameName : "")), 17, Color.rgb(235, 250, 246), true);
        metricLabel = label(captureMode
            ? "第 2 步只显示人脸关键点，不叠加镜框；依次保持正脸、左右转头和轻微抬头低头。"
            : "第 3 步使用 Android 原生 CameraX 实时试戴，镜框为真实产品图。", 13, Color.rgb(185, 215, 211), false);
        statusLabel.setSingleLine(true);
        statusLabel.setOnClickListener(v -> retryFaceLandmarker());
        metricLabel.setMaxLines(2);
        metricLabel.setMinHeight(dp(34));
        top.addView(statusLabel);
        top.addView(metricLabel);
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        );
        topParams.setMargins(dp(12), dp(12), dp(12), 0);
        root.addView(top, topParams);

        LinearLayout bottom = panel();
        bottom.setPadding(dp(10), dp(10), dp(10), dp(10));
        bottom.setOrientation(LinearLayout.VERTICAL);

        LinearLayout row1 = new LinearLayout(this);
        row1.setOrientation(LinearLayout.HORIZONTAL);
        row1.addView(button(captureMode ? "采集说明" : "重选镜框", () -> {
            if (captureMode) {
                statusLabel.setText("多角度采集");
                metricLabel.setText("保持动作约 1 秒：正脸、左转、右转、抬头、低头。镜框会在第 3 步恢复。");
            } else {
                finish();
            }
        }), weight());
        row1.addView(button("切换镜头", () -> switchCamera()), weight());
        // 网格默认关闭（试戴只要镜）。这里提供显式开关，且每次都显式设置目标状态，
        // 避免旧逻辑 !drawMesh 造成的「按一下反而打开网格」。
        row1.addView(button("网格", () -> {
            if (captureMode) overlay.drawMesh = !overlay.drawMesh;
            else overlay.drawGlasses = !overlay.drawGlasses;
            overlay.invalidate();
        }), weight());
        row1.addView(button("返回", () -> finish()), weight());
        bottom.addView(row1);

        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);
        row2.addView(button("自动", () -> {
            overlay.autoScale = true;
            overlay.scaleAdjust = 1f;
            overlay.offsetX = 0f;
            overlay.offsetY = 0f;
            overlay.invalidate();
        }), weight());
        row2.addView(button("缩小", () -> {
            overlay.autoScale = false;
            overlay.scaleAdjust = Math.max(0.68f, overlay.scaleAdjust - 0.06f);
            overlay.invalidate();
        }), weight());
        row2.addView(button("放大", () -> {
            overlay.autoScale = false;
            overlay.scaleAdjust = Math.min(1.55f, overlay.scaleAdjust + 0.06f);
            overlay.invalidate();
        }), weight());
        row2.addView(button("重试识别", () -> retryFaceLandmarker()), weight());
        bottom.addView(row2);

        // 采集模式此前没有任何「完成」入口，也不回传结果：第 2 步做完等于白做
        if (captureMode) {
            LinearLayout row3 = new LinearLayout(this);
            row3.setOrientation(LinearLayout.HORIZONTAL);
            row3.addView(button("完成采集并保存", () -> finishCapture()), weight());
            bottom.addView(row3);
        }

        if (!captureMode) {
            LinearLayout fineTune = new LinearLayout(this);
            fineTune.setOrientation(LinearLayout.HORIZONTAL);
            fineTune.addView(button("左移", () -> { overlay.autoScale = false; overlay.offsetX -= dp(4); overlay.invalidate(); }), weight());
            fineTune.addView(button("右移", () -> { overlay.autoScale = false; overlay.offsetX += dp(4); overlay.invalidate(); }), weight());
            fineTune.addView(button("上移", () -> { overlay.autoScale = false; overlay.offsetY -= dp(4); overlay.invalidate(); }), weight());
            fineTune.addView(button("下移", () -> { overlay.autoScale = false; overlay.offsetY += dp(4); overlay.invalidate(); }), weight());
            bottom.addView(fineTune);
        }

        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        bottomParams.setMargins(dp(12), 0, dp(12), dp(12));
        root.addView(bottom, bottomParams);
        setContentView(root);
    }

    /** 后台线程回主线程统一走这里，Activity 已结束就不再碰 UI。 */
    private void ui(final Runnable action) {
        if (isFinishing() || isDestroyed()) return;
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            action.run();
        });
    }

    private void startCameraFlow() {
        statusLabel.setText("正在打开摄像头...");
        metricLabel.setText(captureMode
            ? "摄像头会先显示，识别模型加载后开始记录脸部关键点。"
            : "摄像头会先显示，识别模型加载完成后自动开始试戴。");
        bindCamera();
        if (faceLandmarker != null || modelLoading) return;
        if (workExecutor == null || workExecutor.isShutdown()) return;
        modelLoading = true;
        try {
            // 用独立的 workExecutor：原来下载 / 模型加载 / 帧分析挤在同一个单线程里，
            // 慢网时镜框图下载会把模型加载饿住，状态栏长时间停在「正在打开摄像头」。
            workExecutor.execute(() -> {
                try {
                    verifyModelAsset();
                    BaseOptions baseOptions = BaseOptions.builder()
                        .setModelAssetPath(MODEL_ASSET)
                        .build();
                    FaceLandmarker.FaceLandmarkerOptions options = FaceLandmarker.FaceLandmarkerOptions.builder()
                        .setBaseOptions(baseOptions)
                        .setRunningMode(RunningMode.LIVE_STREAM)
                        .setNumFaces(1)
                        .setMinFaceDetectionConfidence(0.25f)
                        .setMinFacePresenceConfidence(0.25f)
                        .setMinTrackingConfidence(0.25f)
                        .setResultListener((result, input) -> ui(() -> onFaceResult(result, input)))
                        .setErrorListener(error -> ui(() -> {
                            statusLabel.setText("识别出错");
                            metricLabel.setText(String.valueOf(error.getMessage()));
                        }))
                        .build();
                    faceLandmarker = FaceLandmarker.createFromOptions(this, options);
                    ui(() -> {
                        statusLabel.setText(captureMode ? "多角度识别中" : "摄像机实时识别中");
                        metricLabel.setText(captureMode
                            ? "不显示镜框；缓慢完成正脸、左右转头、抬头和低头，完成后点「完成采集并保存」。"
                            : "可切换镜框显示、关键点和前后置摄像头。");
                    });
                } catch (Throwable error) {
                    // OOM 等 Error 也要兜住，否则 modelLoading 永远为 true，重试只会显示「正在加载」
                    Log.e(TAG, "FaceLandmarker initialization failed", error);
                    ui(() -> {
                        statusLabel.setText("模型加载失败 · 点此重试");
                        metricLabel.setText("离线人脸模型未能启动。摄像头仍可用，点击状态栏或「重试识别」。");
                    });
                } finally {
                    modelLoading = false;
                }
            });
        } catch (RuntimeException error) {
            modelLoading = false;
            statusLabel.setText("模型加载失败 · 点此重试");
            metricLabel.setText("后台任务无法启动：" + error.getMessage());
        }
    }

    /** 采集结果回传给五步配镜第 2 步，避免「采完什么都没留下」。 */
    private void finishCapture() {
        Intent data = new Intent();
        data.putExtra("captureFrames", frameCount);
        data.putExtra("capturePoints", lastFacePointCount);
        setResult(RESULT_OK, data);
        finish();
    }

    private void verifyModelAsset() throws Exception {
        try (java.io.InputStream input = getAssets().open(MODEL_ASSET)) {
            if (input.available() < 3_000_000) {
                throw new IllegalStateException("离线模型文件不完整");
            }
        }
    }

    private void retryFaceLandmarker() {
        if (modelLoading) {
            metricLabel.setText("模型正在加载，请稍候；若长时间无变化请再点一次。");
            return;
        }
        if (faceLandmarker != null) {
            try { faceLandmarker.close(); } catch (Exception ignored) {}
            faceLandmarker = null;
        }
        overlay.clear();
        frameCount = 0;
        lastAnalyzeMs = 0;
        if (!hasCameraPermission()) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            return;
        }
        // 镜框图下载失败时原来「重试识别」不会重新下载，镜框永远不出现
        if (!captureMode && tryOnImageUrl != null && !tryOnImageUrl.isEmpty()) {
            loadTryOnBitmap(tryOnImageUrl);
        }
        startCameraFlow();
    }

    /** 下载真实镜框试戴图（去背 PNG/WebP），下载完成后交给 overlay 合成。 */
    private void loadTryOnBitmap(final String rawUrl) {
        String trimmed = rawUrl == null ? "" : rawUrl.trim();
        if (trimmed.isEmpty()) {
            ui(() -> {
                statusLabel.setText("没有试戴图");
                metricLabel.setText("该镜框还没有上传试戴图，请换一副镜框或在镜框库里选择。");
            });
            return;
        }
        final String url = (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))
            ? "https://glasses.zhengzhengstudio.cn/" + (trimmed.startsWith("/") ? trimmed.substring(1) : trimmed)
            : trimmed;
        if (workExecutor == null || workExecutor.isShutdown()) return;
        try {
            workExecutor.execute(() -> {
                Bitmap bitmap = null;
                Bitmap safe = null;
                boolean handedOff = false;
                try {
                    bitmap = downloadBitmap(url);
                    if (bitmap == null) throw new IllegalStateException("无法下载镜框试戴图");
                    safe = cropToContent(bitmap);
                    if (safe == null) throw new IllegalStateException("试戴图内容为空");
                    final Bitmap result = safe;
                    handedOff = true;   // 所有权交给 overlay，由它负责回收
                    ui(() -> {
                        overlay.setTryOnBitmap(result);
                        if (!captureMode) {
                            statusLabel.setText("实时试戴 · " + (frameName != null && !frameName.isEmpty() ? frameName : ""));
                            metricLabel.setText("把脸放到画面中央，镜框会跟随眼睛位置实时叠加。可微调大小与位置。");
                        }
                    });
                } catch (Throwable error) {
                    // 原来 lambda 没有 try/catch：cropToContent 的 OOM 会让成功与失败回调都不执行，
                    // 界面永久停在初始文案、镜框永不出现。
                    Log.e(TAG, "loadTryOnBitmap failed", error);
                    ui(() -> {
                        if (!captureMode) {
                            statusLabel.setText("试戴图加载失败");
                            metricLabel.setText("无法加载该镜框的试戴图，请检查网络或点「重试识别」。");
                        }
                    });
                } finally {
                    if (!handedOff && safe != null && safe != bitmap && !safe.isRecycled()) safe.recycle();
                    if (bitmap != null && bitmap != safe && !bitmap.isRecycled()) bitmap.recycle();
                }
            });
        } catch (RuntimeException ignored) {}
    }

    private byte[] readAllBytes(InputStream input) throws java.io.IOException {
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = input.read(chunk)) > 0) buffer.write(chunk, 0, n);
        return buffer.toByteArray();
    }

    private Bitmap downloadBitmap(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "ZhengZhengGlasses/1.0");
            if (conn.getResponseCode() >= 400) return null;
            InputStream input = conn.getInputStream();
            byte[] bytes = readAllBytes(input);
            input.close();
            // 先只解边界再按最大边 1024 采样：原来 2000×2000 的图会直接分配 16MB 像素数组，
            // 叠加多个 Bitmap 副本很容易 OOM。
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int maxSide = Math.max(bounds.outWidth, bounds.outHeight);
            int sample = 1;
            while (maxSide / sample > 1024) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        } catch (Exception error) {
            Log.e(TAG, "downloadBitmap failed: " + url, error);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * 按内容包围盒裁掉四周透明/近白留白，让镜框填满目标宽度，避免“白边太大”。
     * 输入会被当作只读；若需要转换格式会生成副本，返回的新 Bitmap 由调用方负责回收原始。
     */
    private Bitmap cropToContent(Bitmap src) {
        if (src == null) return null;
        Bitmap work = src;
        if (src.getConfig() != Bitmap.Config.ARGB_8888) {
            work = src.copy(Bitmap.Config.ARGB_8888, false);
            if (work == null) work = src;
        }
        int w = work.getWidth();
        int h = work.getHeight();
        int[] pixels = new int[w * h];
        work.getPixels(pixels, 0, w, 0, 0, w, h);
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = pixels[y * w + x];
                int a = (p >>> 24) & 0xff;
                if (a < 12) continue;                       // 透明留白
                int r = (p >> 16) & 0xff;
                int g = (p >> 8) & 0xff;
                int b = p & 0xff;
                if (r > 244 && g > 244 && b > 244) continue; // 近白留白
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX || maxY < minY) {                   // 无内容，不裁
            if (work != src) work.recycle();
            return src;
        }
        int padX = Math.max(2, (int) (w * 0.02f));          // 留 2% 安全边，避免裁掉描边
        int padY = Math.max(2, (int) (h * 0.02f));
        minX = Math.max(0, minX - padX);
        maxX = Math.min(w - 1, maxX + padX);
        minY = Math.max(0, minY - padY);
        maxY = Math.min(h - 1, maxY + padY);
        int cw = maxX - minX + 1;
        int ch = maxY - minY + 1;
        if (cw <= 0 || ch <= 0) {
            if (work != src) work.recycle();
            return src;
        }
        Bitmap cropped = Bitmap.createBitmap(work, minX, minY, cw, ch);
        if (work != src) work.recycle();
        return cropped;
    }

    private void bindCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                cameraProvider.unbindAll();

                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .setTargetResolution(new android.util.Size(360, 270))
                    .build();
                analysis.setAnalyzer(cameraExecutor, this::analyzeFrame);

                CameraSelector selector = new CameraSelector.Builder()
                    .requireLensFacing(lensFacing)
                    .build();
                cameraProvider.bindToLifecycle(this, selector, preview, analysis);
                cameraBound = true;
                // 前置摄像头预览做镜像（自拍视角）；overlay 的坐标也按镜像换算，
                // 镜框图本身不再额外翻转，否则非对称镜框会被二次镜像而“左右反”。
                previewView.setScaleX(lensFacing == CameraSelector.LENS_FACING_FRONT ? -1f : 1f);
                overlay.mirror = lensFacing == CameraSelector.LENS_FACING_FRONT;
                if (faceLandmarker == null) {
                    statusLabel.setText("摄像头已打开");
                    metricLabel.setText("人脸模型加载中，先把脸放到画面中央。");
                } else {
                    statusLabel.setText(captureMode ? "多角度识别中" : "摄像机实时识别中");
                    metricLabel.setText(captureMode
                        ? "不显示镜框；缓慢完成正脸、左右转头、抬头和低头。"
                        : "可切换镜框显示、关键点和前后置摄像头。");
                }
            } catch (Exception error) {
                cameraBound = false;
                statusLabel.setText("摄像头启动失败");
                metricLabel.setText(error.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void analyzeFrame(ImageProxy imageProxy) {
        try {
            long now = SystemClock.uptimeMillis();
            if (faceLandmarker == null || now - lastAnalyzeMs < 180) return;
            lastAnalyzeMs = now;
            Bitmap bitmap = imageProxyToBitmap(imageProxy);
            int rotation = imageProxy.getImageInfo().getRotationDegrees();
            Bitmap rotated = rotate(bitmap, rotation);
            MPImage mpImage = new BitmapImageBuilder(rotated).build();
            overlay.setSourceSize(rotated.getWidth(), rotated.getHeight());
            if (faceLandmarker != null) faceLandmarker.detectAsync(mpImage, now);
        } catch (Exception error) {
            runOnUiThread(() -> metricLabel.setText("分析帧失败：" + error.getMessage()));
        } finally {
            imageProxy.close();
        }
    }

    private Bitmap imageProxyToBitmap(ImageProxy imageProxy) {
        ImageProxy.PlaneProxy plane = imageProxy.getPlanes()[0];
        ByteBuffer buffer = plane.getBuffer();
        buffer.rewind();
        int width = imageProxy.getWidth();
        int height = imageProxy.getHeight();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int paddedWidth = width + Math.max(0, rowStride - pixelStride * width) / Math.max(1, pixelStride);
        Bitmap padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
        padded.copyPixelsFromBuffer(buffer);
        if (paddedWidth == width) return padded;
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, width, height);
        padded.recycle();
        return cropped;
    }

    private Bitmap rotate(Bitmap bitmap, int degrees) {
        if (degrees == 0) return bitmap;
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
    }

    private void onFaceResult(FaceLandmarkerResult result, MPImage input) {
        if (isFinishing() || isDestroyed()) return;
        frameCount++;
        overlay.setResult(result);
        if (result.faceLandmarks().isEmpty()) {
            statusLabel.setText("未识别人脸");
            metricLabel.setText("把脸放到画面中间，光线保持均匀。");
            return;
        }
        List<NormalizedLandmark> face = result.faceLandmarks().get(0);
        lastFacePointCount = face.size();
        PointF left = overlay.point(face.get(33));
        PointF right = overlay.point(face.get(263));
        float eyeDistance = distance(left, right);
        float confidence = Math.min(99f, 45f + eyeDistance / Math.max(1f, overlay.getWidth()) * 220f);
        statusLabel.setText("识别稳定 · " + Math.round(confidence) + "%");
        metricLabel.setText("关键点 " + face.size() + " 个 · 第 " + frameCount + " 帧 · 眼距像素 " + Math.round(eyeDistance));
    }

    private void switchCamera() {
        lensFacing = lensFacing == CameraSelector.LENS_FACING_FRONT
            ? CameraSelector.LENS_FACING_BACK
            : CameraSelector.LENS_FACING_FRONT;
        overlay.clear();
        bindCamera();
    }

    private void stopCameraFlow() {
        if (cameraProvider != null) cameraProvider.unbindAll();
        cameraBound = false;
        if (faceLandmarker != null) {
            faceLandmarker.close();
            faceLandmarker = null;
        }
    }

    private float distance(PointF a, PointF b) {
        float dx = a.x - b.x;
        float dy = a.y - b.y;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    private LinearLayout panel() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(224, 8, 28, 31));
        background.setCornerRadius(dp(14));
        background.setStroke(dp(1), Color.argb(70, 210, 241, 234));
        view.setBackground(background);
        return view;
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.12f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button button(String text, final Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(isCompactWidth() ? 11 : 13);
        button.setSingleLine(true);
        button.setMaxLines(1);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setTextColor(Color.rgb(232, 250, 246));
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(21, 112, 100));
        background.setCornerRadius(dp(9));
        button.setBackground(background);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(isCompactWidth() ? 40 : 44), 1);
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        return params;
    }

    private boolean isCompactWidth() {
        return getResources().getConfiguration().screenWidthDp < 600;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    public static class TryOnOverlay extends View {
        private final Paint meshPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint facePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private FaceLandmarkerResult result;
        private int sourceWidth = 1;
        private int sourceHeight = 1;
        boolean drawMesh = false;   // 试戴默认「只要镜」：不画人脸网格/关键点
        boolean drawGlasses = true;
        boolean mirror = true;
        boolean autoScale = true;
        float scaleAdjust = 1f;
        float offsetX = 0f;
        float offsetY = 0f;
        Bitmap tryOnBitmap = null;
        final Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        public TryOnOverlay(Activity activity) {
            super(activity);
            meshPaint.setColor(Color.rgb(61, 188, 174));
            meshPaint.setStrokeWidth(2f);
            facePaint.setColor(Color.argb(210, 61, 188, 174));
            facePaint.setStyle(Paint.Style.STROKE);
            facePaint.setStrokeWidth(4f);
        }

        public void setSourceSize(int width, int height) {
            sourceWidth = Math.max(1, width);
            sourceHeight = Math.max(1, height);
        }

        public void setResult(FaceLandmarkerResult result) {
            this.result = result;
            invalidate();
        }

        public void clear() {
            result = null;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (result == null || result.faceLandmarks().isEmpty()) return;
            List<NormalizedLandmark> face = result.faceLandmarks().get(0);
            if (drawMesh) drawFaceMesh(canvas, face);
            if (drawGlasses && tryOnBitmap != null) drawGlasses(canvas, face);
        }

        private void drawFaceMesh(Canvas canvas, List<NormalizedLandmark> face) {
            for (int i = 0; i < face.size(); i += 6) {
                PointF p = point(face.get(i));
                canvas.drawCircle(p.x, p.y, 2.2f, meshPaint);
            }
            PointF top = point(face.get(10));
            PointF chin = point(face.get(152));
            PointF left = point(face.get(234));
            PointF right = point(face.get(454));
            // 前置镜像会把 234/454 的左右顺序反过来，直接构造 RectF 会得到负宽矩形、轮廓不显示
            RectF oval = new RectF(Math.min(left.x, right.x), Math.min(top.y, chin.y),
                Math.max(left.x, right.x), Math.max(top.y, chin.y));
            canvas.drawOval(oval, facePaint);
        }

        /** 把真实镜框试戴图合成到脸上：以双眼外角为基准定位，按眼距缩放，跟随头部旋转。 */
        private void drawGlasses(Canvas canvas, List<NormalizedLandmark> face) {
            if (tryOnBitmap == null) return;
            PointF p1 = point(face.get(33));
            PointF p2 = point(face.get(263));
            // 前置镜像翻转了 x，固定用 33→263 会让 dx 为负，atan2 得到约 ±180°，
            // 镜框图被整体旋转 180° 倒挂。按屏幕坐标左右排序后再算倾角。
            PointF leftOuter = p1.x <= p2.x ? p1 : p2;
            PointF rightOuter = p1.x <= p2.x ? p2 : p1;
            float dx = rightOuter.x - leftOuter.x;
            float dy = rightOuter.y - leftOuter.y;
            float angle = (float) Math.toDegrees(Math.atan2(dy, dx));
            float eyeDistance = distance(leftOuter, rightOuter);
            float cx = (leftOuter.x + rightOuter.x) / 2f + offsetX;
            float cy = (leftOuter.y + rightOuter.y) / 2f + offsetY;

            float bmpW = tryOnBitmap.getWidth();
            float bmpH = tryOnBitmap.getHeight();
            // 镜框目标宽度 ≈ 双眼外角间距 × 2.5（约等于镜框总宽），跟随用户缩放微调。
            float targetW = eyeDistance * (autoScale ? 2.5f : 2.5f * scaleAdjust);
            float scale = targetW / bmpW;

            Matrix matrix = new Matrix();
            matrix.postTranslate(-bmpW / 2f, -bmpH / 2f);
            matrix.postScale(scale, scale);
            matrix.postRotate(angle);
            // 注意：预览已做镜像、overlay 坐标也已镜像换算，这里不再翻转镜框图，
            // 否则非对称镜框（如单边装饰/猫眼）会被二次镜像而左右反。
            matrix.postTranslate(cx, cy);
            bitmapPaint.setFilterBitmap(true);
            canvas.drawBitmap(tryOnBitmap, matrix, bitmapPaint);
        }

        public void setTryOnBitmap(Bitmap bitmap) {
            if (tryOnBitmap != null && tryOnBitmap != bitmap) tryOnBitmap.recycle();
            tryOnBitmap = bitmap;
            invalidate();
        }

        public PointF point(NormalizedLandmark landmark) {
            float x = mirror ? 1f - landmark.x() : landmark.x();
            float y = landmark.y();
            float scale = Math.max(getWidth() / (float) sourceWidth, getHeight() / (float) sourceHeight);
            float drawnWidth = sourceWidth * scale;
            float drawnHeight = sourceHeight * scale;
            float left = (getWidth() - drawnWidth) / 2f;
            float top = (getHeight() - drawnHeight) / 2f;
            return new PointF(left + x * drawnWidth, top + y * drawnHeight);
        }

        private float distance(PointF a, PointF b) {
            float dx = a.x - b.x;
            float dy = a.y - b.y;
            return (float) Math.sqrt(dx * dx + dy * dy);
        }
    }
}
