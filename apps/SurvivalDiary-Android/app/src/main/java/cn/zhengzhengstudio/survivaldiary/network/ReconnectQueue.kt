package cn.zhengzhengstudio.survivaldiary.network

import android.content.Context
import java.util.UUID

data class QueuedCommand(val eventId: String = UUID.randomUUID().toString(), val baseRevision: Long, val payload: String)

class ReconnectQueue(context: Context) {
    private val file = context.filesDir.resolve("reconnect-queue.v2")
    @Synchronized fun enqueue(command: QueuedCommand) = file.appendText("${command.eventId}\t${command.baseRevision}\t${command.payload.replace("\n", " ")}\n")
    @Synchronized fun pending(): List<QueuedCommand> = if (!file.exists()) emptyList() else file.readLines().mapNotNull { line ->
        line.split('\t', limit = 3).takeIf { it.size == 3 }?.let { QueuedCommand(it[0], it[1].toLong(), it[2]) }
    }
    @Synchronized fun acknowledge(eventId: String) { file.writeText(pending().filterNot { it.eventId == eventId }.joinToString("\n") { "${it.eventId}\t${it.baseRevision}\t${it.payload}" }) }
}
