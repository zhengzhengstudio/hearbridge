package cn.zhengzhengstudio.lifediary.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

private class FakeLocalStore : LocalStore {
    var values = emptyList<DiaryEntry>()
    override fun readEntries() = values
    override fun writeEntries(entries: List<DiaryEntry>) { values = entries }
}

private class FailingLifeApi : LifeSyncApi {
    override suspend fun sync(operations: List<DiaryEntry>): List<DiaryEntry> = error("offline")
}

class LifeRepositoryTest {
    @Test fun saveSurvivesOfflineSyncFailure() = runTest {
        val local = FakeLocalStore()
        val repo = DefaultLifeRepository(local, FailingLifeApi())
        repo.save(DiaryEntry(title = "今天", body = "完成了第一篇日记"))
        assertEquals(1, repo.entries.value.size)
        assertEquals(SyncState.Pending(1), repo.syncState.value)
        assertEquals(1, local.values.size)
    }
}
