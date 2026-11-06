package cn.zhengzhengstudio.lifediary.data

import org.json.JSONObject
import java.util.UUID

data class DiaryEntry(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val body: String,
    val mood: Int = 3,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = createdAt,
    val syncRevision: Int = 0
) {
    fun toJson() = JSONObject().put("id", id).put("title", title).put("body", body)
        .put("mood", mood).put("createdAt", createdAt).put("updatedAt", updatedAt)
        .put("syncRevision", syncRevision)

    companion object {
        fun fromJson(value: JSONObject) = DiaryEntry(
            value.getString("id"), value.optString("title"), value.optString("body"),
            value.optInt("mood", 3), value.optLong("createdAt"), value.optLong("updatedAt"),
            value.optInt("syncRevision")
        )
    }
}

data class CommunityPost(
    val id: String,
    val authorName: String,
    val body: String,
    val likes: Int = 0,
    val createdAt: Long = System.currentTimeMillis()
)

data class Friend(val uid: String, val displayName: String, val status: String = "friend")
data class ChatMessage(val id: String, val role: String, val body: String)

enum class HealthMode { None, Period, SmokeFree }
data class HealthSettings(
    val mode: HealthMode = HealthMode.None,
    val lastPeriodStart: Long? = null,
    val averageCycleDays: Int = 28,
    val painToday: Int = 0,
    val smokeFreeSince: Long? = null,
    val cigarettesAvoided: Int = 0
)

sealed interface SyncState {
    data object Synced : SyncState
    data class Pending(val count: Int) : SyncState
    data class Failed(val count: Int, val message: String) : SyncState
}

sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val value: T) : LoadState<T>
    data object Empty : LoadState<Nothing>
    data class Offline(val message: String = "网络不可用，已保留本地内容") : LoadState<Nothing>
    data class Error(val message: String) : LoadState<Nothing>
}
