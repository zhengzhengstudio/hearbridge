package cn.zhengzhengstudio.lifediary

import cn.zhengzhengstudio.lifediary.navigation.LifeDestination
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class BuildIsolationTest {
    @Test fun destinationsAreLifeDiaryOnly() {
        assertEquals(listOf("today", "diary", "community", "ledger", "companion", "profile"), LifeDestination.entries.map { it.route })
        assertFalse(BuildConfig::class.java.declaredFields.any { it.name == "LOCAL_URL" })
    }
}
