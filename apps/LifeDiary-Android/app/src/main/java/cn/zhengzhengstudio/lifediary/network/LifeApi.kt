package cn.zhengzhengstudio.lifediary.network

import cn.zhengzhengstudio.lifediary.BuildConfig
import cn.zhengzhengstudio.lifediary.data.CommunityPost
import cn.zhengzhengstudio.lifediary.data.DiaryEntry
import cn.zhengzhengstudio.lifediary.data.Friend
import cn.zhengzhengstudio.lifediary.data.LifeSyncApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL

interface LifeApi : LifeSyncApi {
    suspend fun posts(): List<CommunityPost>
    suspend fun publish(body: String, sourceEntryId: String, minorConfirmed: Boolean): CommunityPost
    suspend fun friends(token: String): List<Friend>
    suspend fun searchFriends(token: String, query: String): List<Friend>
    suspend fun requestFriend(token: String, uid: String)
    suspend fun companion(token: String, message: String): String
    suspend fun syncLedger(entries: JSONArray): JSONArray
}

class HttpLifeApi(private val token: () -> String?) : LifeApi {
    override suspend fun sync(operations: List<DiaryEntry>): List<DiaryEntry> = withContext(Dispatchers.IO) {
        val items = JSONArray().also { array -> operations.forEach { entry ->
            array.put(JSONObject().put("id", "android-${entry.id}-${entry.updatedAt}").put("domain", "diary")
                .put("type", "upsert").put("baseRevision", entry.syncRevision)
                .put("payload", entry.toJson().put("revision", entry.syncRevision + 1)))
        } }
        request("POST", "/api/life/sync", JSONObject().put("baseRevision", 0).put("operations", items), true)
        operations
    }

    override suspend fun posts() = withContext(Dispatchers.IO) {
        val values = request("GET", "/api/life/community/posts").optJSONArray("posts") ?: JSONArray()
        List(values.length()) { index -> values.getJSONObject(index).let {
            val author = it.optJSONObject("author")
            CommunityPost(it.optString("id"), author?.optString("nickname", "生活记录者") ?: "生活记录者",
                it.optString("body"), it.optInt("likeCount"), System.currentTimeMillis())
        } }
    }

    override suspend fun publish(body: String, sourceEntryId: String, minorConfirmed: Boolean) = withContext(Dispatchers.IO) {
        val value = request("POST", "/api/life/community/posts", JSONObject().put("id", "android-$sourceEntryId").put("body", body)
            .put("anonymous", false).put("minorConfirmed", minorConfirmed), true).getJSONObject("post")
        CommunityPost(value.optString("id"), value.optJSONObject("author")?.optString("nickname", "我") ?: "我", value.optString("body"), value.optInt("likeCount"))
    }

    override suspend fun friends(token: String) = withContext(Dispatchers.IO) { parseFriends(request("GET", "/api/life/friends", auth = true)) }
    override suspend fun searchFriends(token: String, query: String) = withContext(Dispatchers.IO) {
        parseFriends(request("GET", "/api/life/friends/search?q=${URLEncoder.encode(query, "UTF-8")}", auth = true))
    }
    override suspend fun requestFriend(token: String, uid: String) = withContext(Dispatchers.IO) {
        request("POST", "/api/life/friends/requests", JSONObject().put("targetUid", uid), true); Unit
    }
    override suspend fun companion(token: String, message: String) = withContext(Dispatchers.IO) {
        val value = request("POST", "/api/life/companion/chat", JSONObject().put("message", message), true)
        value.optString("answer", value.optString("message", "我在这里，愿意继续听你说。"))
    }
    override suspend fun syncLedger(entries: JSONArray) = withContext(Dispatchers.IO) {
        val operations = JSONArray().also { target -> repeat(entries.length()) { index ->
            val entry = entries.getJSONObject(index)
            target.put(JSONObject().put("id", "android-ledger-${entry.getString("id")}-${entry.optInt("revision", 1)}")
                .put("domain", "ledger").put("type", "upsert")
                .put("baseRevision", (entry.optInt("revision", 1) - 1).coerceAtLeast(0)).put("payload", entry))
        } }
        val result = request("POST", "/api/life/sync", JSONObject().put("operations", operations), true)
        val values = result.optJSONObject("record")?.optJSONObject("domains")?.optJSONObject("ledger") ?: return@withContext entries
        JSONArray().also { array -> values.keys().forEach { key -> array.put(values.getJSONObject(key)) } }
    }

    private fun parseFriends(json: JSONObject): List<Friend> {
        val values = json.optJSONArray("friends") ?: json.optJSONArray("users") ?: JSONArray()
        return List(values.length()) { values.getJSONObject(it).let { value ->
            Friend(value.optString("uid", value.optString("id")), value.optString("displayName", value.optString("username", "朋友")), value.optString("status", "friend"))
        } }
    }

    private fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = false): JSONObject {
        val connection = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 10_000; readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            if (auth) token()?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) { setRequestProperty("Content-Type", "application/json"); doOutput = true }
        }
        body?.let { connection.outputStream.use { output -> output.write(it.toString().toByteArray()) } }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        check(code in 200..299) { JSONObject(text.ifBlank { "{}" }).optString("error", "请求失败 ($code)") }
        return JSONObject(text.ifBlank { "{}" })
    }
}
