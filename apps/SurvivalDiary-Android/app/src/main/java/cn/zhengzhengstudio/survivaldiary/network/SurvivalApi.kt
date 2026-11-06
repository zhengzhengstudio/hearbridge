package cn.zhengzhengstudio.survivaldiary.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SurvivalApiException(val statusCode: Int, message: String) : IllegalStateException(message)

class TokenVault(private val context: Context) {
    private val alias = "survival-diary-passport"
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun key(): SecretKey {
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun write(token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val blob = cipher.iv + cipher.doFinal(token.toByteArray())
        context.filesDir.resolve("passport-token.enc").writeText(Base64.encodeToString(blob, Base64.NO_WRAP))
    }
    fun read(): String? = runCatching {
        val blob = Base64.decode(context.filesDir.resolve("passport-token.enc").readText(), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob.copyOfRange(0, 12))) }
        String(cipher.doFinal(blob.copyOfRange(12, blob.size)))
    }.getOrNull()

    fun deviceId(): String {
        val file = context.filesDir.resolve("survival-device-id.txt")
        file.takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return "android-${UUID.randomUUID()}".also(file::writeText)
    }
}

class SurvivalApi(private val client: OkHttpClient = OkHttpClient(), private val baseUrl: String = "https://survival-diary.zhengzhengstudio.cn") {
    fun passportLogin(code: String, callback: Callback) = post("/session", JSONObject().put("mode", "passport").put("token", code).toString(), callback)
    fun listFriends(token: String, callback: Callback) = get("/friends", token, callback)
    fun requestFriend(token: String, userId: String, callback: Callback) = post("/friends/requests", JSONObject().put("receiverUid", userId).toString(), callback, token)
    fun uploadCloudSave(token: String, revision: Long, saveJson: String, callback: Callback) = put(
        "/saves/main",
        JSONObject().put("baseRevision", revision).put("save", JSONObject(saveJson)).toString(),
        callback,
        token,
    )
    fun downloadCloudSave(token: String, callback: Callback) = get("/saves/main", token, callback)
    fun subscribePush(token: String, fcmToken: String, build: Int, callback: Callback) = post("/push/subscriptions", "{\"token\":\"$fcmToken\",\"build\":$build}", callback, token)
    fun createGuestSession(deviceId: String): String {
        val payload = JSONObject().put("mode", "local").put("deviceId", deviceId)
        val request = Request.Builder().url(baseUrl + "/session")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).also { call -> call.timeout().timeout(2600, TimeUnit.MILLISECONDS) }.execute().use { response ->
            check(response.isSuccessful) { "岛屿会话创建失败：${response.code}" }
            return JSONObject(response.body?.string() ?: error("岛屿会话为空"))
                .optString("sessionToken")
                .takeIf(String::isNotBlank)
                ?: error("岛屿会话没有令牌")
        }
    }
    fun talkToVillager(token: String, payload: JSONObject): JSONObject {
        val request = Request.Builder().url(baseUrl + "/npc-dialogue")
            .header("Authorization", "Bearer $token")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).also { call ->
            // NPC dialogue must never hold the game UI for OkHttp's much longer
            // default deadline. The server already falls back to a local answer.
            call.timeout().timeout(2600, TimeUnit.MILLISECONDS)
        }.execute().use { response ->
            if (!response.isSuccessful) throw SurvivalApiException(response.code, "岛民回应失败：${response.code}")
            return JSONObject(response.body?.string() ?: error("岛民回应为空"))
        }
    }

    fun listPublicIslands(): JSONArray = executeJson("/islands/public").optJSONArray("islands") ?: JSONArray()

    fun ensurePublicIsland(token: String, seed: String): JSONObject = executeJson(
        "/islands/mine/public",
        method = "PUT",
        token = token,
        body = JSONObject().put("seed", seed),
    )

    fun visitIsland(token: String, islandId: String): JSONObject = executeJson(
        "/islands/${java.net.URLEncoder.encode(islandId, "UTF-8")}/visit",
        method = "POST",
        token = token,
        body = JSONObject(),
    )

    private fun executeJson(path: String, method: String = "GET", token: String? = null, body: JSONObject? = null): JSONObject {
        val builder = Request.Builder().url(baseUrl + path).apply {
            token?.let { header("Authorization", "Bearer $it") }
        }
        val requestBody = (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType())
        when (method) {
            "POST" -> builder.post(requestBody)
            "PUT" -> builder.put(requestBody)
            else -> builder.get()
        }
        client.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            check(response.isSuccessful) { JSONObject(raw.ifBlank { "{}" }).optString("error", "请求失败：${response.code}") }
            return JSONObject(raw.ifBlank { "{}" })
        }
    }

    private fun get(path: String, token: String, callback: Callback) = client.newCall(Request.Builder().url(baseUrl + path).header("Authorization", "Bearer $token").build()).also { it.enqueue(callback) }
    private fun post(path: String, body: String, callback: Callback, token: String? = null) = client.newCall(Request.Builder().url(baseUrl + path)
        .apply { if (token != null) header("Authorization", "Bearer $token") }
        .post(body.toRequestBody("application/json".toMediaType())).build()).also { it.enqueue(callback) }
    private fun put(path: String, body: String, callback: Callback, token: String? = null) = client.newCall(Request.Builder().url(baseUrl + path)
        .apply { if (token != null) header("Authorization", "Bearer $token") }
        .put(body.toRequestBody("application/json".toMediaType())).build()).also { it.enqueue(callback) }
}
