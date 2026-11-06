package cn.zhengzhengstudio.survivaldiary.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

enum class IslandConnectionStatus { LOCAL, CONNECTING, ONLINE, RECONNECTING, OFFLINE }

data class IslandChatMessage(val uid: String, val text: String, val createdAt: Long)

interface IslandSocketListener {
    fun onStatus(status: IslandConnectionStatus, message: String? = null) {}
    fun onSnapshot(islandId: String, revision: Long, world: JSONObject) {}
    fun onChat(message: IslandChatMessage) {}
}

class IslandSocketClient(
    private val client: OkHttpClient = OkHttpClient(),
    private val wsBase: String = "wss://survival-diary.zhengzhengstudio.cn",
    private val listener: IslandSocketListener,
) {
    private val reconnectExecutor = Executors.newSingleThreadScheduledExecutor()
    private var reconnectFuture: ScheduledFuture<*>? = null
    private var socket: WebSocket? = null
    private var token = ""
    private var islandId = ""
    private var revision = 0L
    private var reconnectAttempt = 0
    private var intentionallyClosed = true
    private var generation = 0L

    fun join(sessionToken: String, requestedIslandId: String) {
        leave(notify = false)
        token = sessionToken
        islandId = requestedIslandId
        revision = 0
        intentionallyClosed = false
        open(resume = false)
    }

    fun sendChat(text: String) {
        val normalized = text.trim()
        require(normalized.isNotEmpty() && normalized.length <= 500) { "消息需要 1 到 500 个字" }
        check(send(JSONObject().put("type", "chat").put("protocolVersion", 2).put("requestId", id("chat")).put("islandId", islandId).put("text", normalized))) {
            "岛屿聊天尚未连接"
        }
    }

    fun sendCommand(type: String, payload: JSONObject = JSONObject()): String {
        val eventId = id("event")
        val command = JSONObject().put("eventId", eventId).put("baseRevision", revision).put("type", type).put("payload", payload)
        check(send(JSONObject().put("type", "command").put("protocolVersion", 2).put("requestId", id("command")).put("islandId", islandId).put("command", command))) {
            "公共岛尚未连接"
        }
        return eventId
    }

    fun leave(notify: Boolean = true) {
        intentionallyClosed = true
        generation += 1
        reconnectFuture?.cancel(false)
        reconnectFuture = null
        socket?.close(1000, "leave island")
        socket = null
        islandId = ""
        revision = 0
        reconnectAttempt = 0
        if (notify) listener.onStatus(IslandConnectionStatus.LOCAL)
    }

    fun close() {
        leave()
        reconnectExecutor.shutdownNow()
        client.dispatcher.executorService.shutdown()
    }

    private fun open(resume: Boolean) {
        val myGeneration = ++generation
        val myIsland = islandId
        listener.onStatus(if (resume) IslandConnectionStatus.RECONNECTING else IslandConnectionStatus.CONNECTING)
        val request = Request.Builder().url("$wsBase/ws?session=${URLEncoder.encode(token, "UTF-8")}").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            private fun current(webSocket: WebSocket) = !intentionallyClosed && generation == myGeneration && socket === webSocket && islandId == myIsland

            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (!current(webSocket)) return
                val message = JSONObject().put("type", if (resume) "resume" else "join")
                    .put("protocolVersion", 2).put("requestId", id(if (resume) "resume" else "join")).put("islandId", islandId)
                if (resume) message.put("revision", revision)
                webSocket.send(message.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!current(webSocket)) return
                handle(JSONObject(text))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!current(webSocket)) return
                listener.onStatus(IslandConnectionStatus.OFFLINE, t.message)
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!current(webSocket)) return
                listener.onStatus(IslandConnectionStatus.OFFLINE, reason)
                scheduleReconnect()
            }
        })
    }

    private fun handle(message: JSONObject) {
        when (message.optString("type")) {
            "snapshot", "ack", "world_update" -> {
                revision = message.optLong("revision", revision)
                reconnectAttempt = 0
                listener.onSnapshot(islandId, revision, message.optJSONObject("world") ?: JSONObject())
                listener.onStatus(IslandConnectionStatus.ONLINE)
            }
            "chat" -> emitChat(message)
            "chat_history" -> message.optJSONArray("messages")?.let { messages ->
                for (index in 0 until messages.length()) emitChat(messages.optJSONObject(index) ?: continue)
            }
            // A rejected command or chat message does not close the WebSocket. Keep the
            // island online so one bad action cannot strand the player in a fake offline state.
            "error" -> listener.onStatus(IslandConnectionStatus.ONLINE, message.optString("message", message.optString("code", "联机请求失败")))
        }
    }

    private fun emitChat(message: JSONObject) {
        listener.onChat(IslandChatMessage(message.optString("uid", message.optString("actorUid", "岛友")), message.optString("text"), message.optLong("createdAt", System.currentTimeMillis())))
    }

    private fun send(message: JSONObject): Boolean = socket?.send(message.toString()) == true

    private fun scheduleReconnect() {
        if (intentionallyClosed || islandId.isBlank() || reconnectAttempt >= 6 || reconnectFuture?.isDone == false) return
        reconnectAttempt += 1
        listener.onStatus(IslandConnectionStatus.RECONNECTING, "第 $reconnectAttempt 次重连")
        val delay = minOf(20_000L, 750L * (1L shl (reconnectAttempt - 1)))
        reconnectFuture = reconnectExecutor.schedule({ if (!intentionallyClosed && islandId.isNotBlank()) open(resume = true) }, delay, TimeUnit.MILLISECONDS)
    }

    private fun id(prefix: String) = "$prefix-${UUID.randomUUID()}"
}
