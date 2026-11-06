package cn.zhengzhengstudio.survivaldiary.game

import java.util.LinkedHashMap
import java.util.concurrent.Executor

class AsyncValueCache<K, V>(private val capacity: Int, private val executor: Executor) {
    private val values = LinkedHashMap<K, V>(capacity, 0.75f, true)
    private val pending = mutableSetOf<K>()
    private var closed = false

    @Synchronized
    fun getOrSchedule(key: K, onReady: () -> Unit = {}, loader: () -> V): V? {
        if (closed) return null
        values[key]?.let { return it }
        if (!pending.add(key)) return null
        executor.execute {
            val loaded = runCatching(loader)
            var notify = false
            synchronized(this) {
                pending.remove(key)
                loaded.getOrNull()?.takeUnless { closed }?.let { value ->
                    values[key] = value
                    while (values.size > capacity) values.remove(values.entries.first().key)
                    notify = true
                }
            }
            if (notify) onReady()
        }
        return null
    }

    @Synchronized
    fun clear() {
        values.clear()
        pending.clear()
    }

    @Synchronized
    fun close() {
        closed = true
        clear()
    }
}
