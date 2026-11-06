package cn.zhengzhengstudio.lifediary.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

interface LocalStore {
    fun readEntries(): List<DiaryEntry>
    fun writeEntries(entries: List<DiaryEntry>)
}

class JsonLocalStore(context: Context) : LocalStore {
    private val file = File(context.filesDir, "life-diary.json")
    override fun readEntries(): List<DiaryEntry> = runCatching {
        val values = JSONArray(file.readText())
        List(values.length()) { DiaryEntry.fromJson(values.getJSONObject(it)) }
    }.getOrDefault(emptyList())

    override fun writeEntries(entries: List<DiaryEntry>) {
        val array = JSONArray().also { target -> entries.forEach { target.put(it.toJson()) } }
        val temporary = File(file.parentFile, "${file.name}.tmp")
        temporary.writeText(array.toString())
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}

interface LifeSyncApi { suspend fun sync(operations: List<DiaryEntry>): List<DiaryEntry> }

interface LifeRepository {
    val entries: StateFlow<List<DiaryEntry>>
    val syncState: StateFlow<SyncState>
    suspend fun save(entry: DiaryEntry)
    suspend fun delete(id: String)
    suspend fun syncNow()
}

class DefaultLifeRepository(
    private val local: LocalStore,
    private val remote: LifeSyncApi
) : LifeRepository {
    private val mutex = Mutex()
    private val pending = mutableListOf<DiaryEntry>()
    private val _entries = MutableStateFlow(local.readEntries().sortedByDescending { it.updatedAt })
    override val entries: StateFlow<List<DiaryEntry>> = _entries
    private val _syncState = MutableStateFlow<SyncState>(SyncState.Synced)
    override val syncState: StateFlow<SyncState> = _syncState

    override suspend fun save(entry: DiaryEntry) = mutex.withLock {
        val next = (_entries.value.filterNot { it.id == entry.id } + entry)
            .sortedByDescending { it.updatedAt }
        local.writeEntries(next)
        _entries.value = next
        pending.removeAll { it.id == entry.id }
        pending += entry
        _syncState.value = SyncState.Pending(pending.size)
        syncLocked()
    }

    override suspend fun delete(id: String) = mutex.withLock {
        val next = _entries.value.filterNot { it.id == id }
        local.writeEntries(next)
        _entries.value = next
    }

    override suspend fun syncNow() = mutex.withLock { syncLocked() }

    private suspend fun syncLocked() {
        if (pending.isEmpty()) return
        runCatching { remote.sync(pending.toList()) }
            .onSuccess { serverEntries ->
                pending.clear()
                val merged = if (serverEntries.isEmpty()) _entries.value else serverEntries
                local.writeEntries(merged)
                _entries.value = merged.sortedByDescending { it.updatedAt }
                _syncState.value = SyncState.Synced
            }
            .onFailure { _syncState.value = SyncState.Pending(pending.size) }
    }
}
