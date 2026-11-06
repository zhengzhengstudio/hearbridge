package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.game.AsyncValueCache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.Executor

class AsyncValueCacheTest {
    @Test fun `cache miss schedules once and never runs expensive loader on caller`() {
        val tasks = mutableListOf<Runnable>()
        val cache = AsyncValueCache<String, String>(2, Executor(tasks::add))
        var loads = 0
        assertNull(cache.getOrSchedule("island") { loads++; "ready" })
        assertNull(cache.getOrSchedule("island") { loads++; "duplicate" })
        assertEquals(0, loads)
        assertEquals(1, tasks.size)
        tasks.single().run()
        assertEquals("ready", cache.getOrSchedule("island") { "unused" })
        assertEquals(1, loads)
    }

    @Test fun `closed cache ignores a loader that finishes after its view is detached`() {
        val tasks = mutableListOf<Runnable>()
        val cache = AsyncValueCache<String, String>(2, Executor(tasks::add))
        var ready = 0
        assertNull(cache.getOrSchedule("island", { ready++ }) { "late" })
        cache.close()
        tasks.single().run()
        assertNull(cache.getOrSchedule("island") { "must-not-run" })
        assertEquals(0, ready)
    }
}
