package com.zzsys.zhengzhengglasses;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 零依赖的镜框图加载器（2026-10-22 电商风新增）。
 *
 * 为什么不引 Glide/Coil：眼镜工程依赖极少，加库要联网拉 maven 包；
 * 这里用 LruCache + 固定线程池实现商品流所需的图���加载，够用且零风险。
 *
 * 注意：镜框图挂在眼镜站独立域名下（8114 服务），
 * 主站 https://zhengzhengstudio.cn/assets/... 是 404，必须走 GLASSES_ASSET_BASE。
 */
final class FrameImageLoader {
    static final String GLASSES_ASSET_BASE = "https://glasses.zhengzhengstudio.cn/";

    private static final LruCache<String, Bitmap> CACHE = new LruCache<String, Bitmap>(40 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, Bitmap value) {
            return value.getByteCount();
        }
    };

    private static final ExecutorService POOL = Executors.newFixedThreadPool(4);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private FrameImageLoader() {
    }

    /** 把目录里的相对路径（assets/...）补成可访问的绝对地址。 */
    static String resolve(String raw) {
        if (raw == null) return "";
        String value = raw.trim();
        if (value.length() == 0) return "";
        if (value.startsWith("http://") || value.startsWith("https://")) return value;
        if (value.startsWith("/")) return "https://glasses.zhengzhengstudio.cn" + value;
        return GLASSES_ASSET_BASE + value;
    }

    /** 异步加载并绑定到 ImageView；用 tag 防止错位。 */
    static void load(final ImageView view, String raw) {
        if (view == null) return;
        final String url = resolve(raw);
        view.setTag(url);
        if (url.length() == 0) {
            view.setImageDrawable(null);
            return;
        }
        Bitmap cached = CACHE.get(url);
        if (cached != null) {
            view.setImageBitmap(cached);
            return;
        }
        view.setImageDrawable(null);
        POOL.execute(() -> {
            final Bitmap bitmap = download(url);
            if (bitmap == null) return;
            CACHE.put(url, bitmap);
            MAIN.post(() -> {
                if (url.equals(view.getTag())) view.setImageBitmap(bitmap);
            });
        });
    }

    private static Bitmap download(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(20000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "ZhengZhengGlasses/1.0");
            if (conn.getResponseCode() >= 400) return null;
            InputStream input = conn.getInputStream();
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 2; // 商品卡缩略图，1/2 尺寸足够
            Bitmap bitmap = BitmapFactory.decodeStream(input, null, options);
            input.close();
            return bitmap;
        } catch (Exception error) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
