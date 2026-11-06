package cn.zhengzhengstudio.survivaldiary.update

import cn.zhengzhengstudio.survivaldiary.BuildConfig
import cn.zhengzhengstudio.survivaldiary.network.SurvivalApi
import okhttp3.*

class ReleasePushService(private val api: SurvivalApi, private val client: OkHttpClient = OkHttpClient()) {
    fun registerOptIn(passportToken: String, devicePushToken: String, callback: Callback) =
        api.subscribePush(passportToken, devicePushToken, BuildConfig.VERSION_CODE, callback) // /push/subscriptions

    fun onReleaseMessage(payload: Map<String, String>, onManifest: (String) -> Unit) {
        if (payload["type"] != "release") return
        // Security boundary: payload URLs are ignored; only the compiled trusted manifest endpoint is read.
        client.newCall(Request.Builder().url(BuildConfig.MANIFEST_URL).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: java.io.IOException) = Unit
            override fun onResponse(call: Call, response: Response) { response.use { if (it.isSuccessful) it.body?.string()?.let(onManifest) } }
        })
    }
}
