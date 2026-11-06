package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.update.UpdateRepository
import cn.zhengzhengstudio.survivaldiary.update.downloadPercent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UpdateRepositoryTest {
    @Test fun semanticVersionComparisonUsesEveryComponent() {
        assertEquals(1, UpdateRepository.compareVersions("0.10.0", "0.9.9"))
        assertEquals(0, UpdateRepository.compareVersions("0.3", "0.3.0"))
    }

    @Test fun `download progress reports determinate percentage without exceeding one hundred`() {
        assertEquals(0, downloadPercent(0, 1_000))
        assertEquals(42, downloadPercent(420, 1_000))
        assertEquals(100, downloadPercent(1_200, 1_000))
        assertEquals(null, downloadPercent(100, -1))
    }

    @Test fun `update selection prefers versioned download and rejects unavailable or unsafe entries`() {
        val checksum = "a".repeat(64)
        val selected = UpdateRepository.selectUpdate(
            """{"apps":[{"id":"survival-diary-android","available":true,"version":"0.6.0","build":40,"url":"/latest.apk","downloadURL":"/versioned.apk","sha256":"$checksum"}]}""",
            "0.5.16",
            32,
            "https://zhengzhengstudio.cn/api/apps/manifest.json",
        )
        assertEquals("https://zhengzhengstudio.cn/versioned.apk", selected?.url)

        assertNull(UpdateRepository.selectUpdate(
            """{"apps":[{"id":"survival-diary-android","available":false,"version":"9.0.0","build":99,"url":"https://example.com/app.apk","sha256":"$checksum"}]}""",
            "0.5.16", 32, "https://zhengzhengstudio.cn/api/apps/manifest.json",
        ))
        assertNull(UpdateRepository.selectUpdate(
            """{"apps":[{"id":"survival-diary-android","version":"9.0.0","build":99,"url":"http://example.com/app.apk","sha256":"$checksum"}]}""",
            "0.5.16", 32, "https://zhengzhengstudio.cn/api/apps/manifest.json",
        ))
    }

}
