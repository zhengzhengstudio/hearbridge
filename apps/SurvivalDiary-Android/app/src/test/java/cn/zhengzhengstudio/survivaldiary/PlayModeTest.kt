package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.PlayMode
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayModeTest {
    @Test fun switchingModePreservesIsland() {
        val before = cn.zhengzhengstudio.survivaldiary.domain.SurvivalSimulation.create("mode-test")
        val after = cn.zhengzhengstudio.survivaldiary.domain.Simulation.step(
            before,
            cn.zhengzhengstudio.survivaldiary.domain.GameCommand.SetPlayMode(PlayMode.FREE),
        )
        assertEquals(before.entities, after.entities)
        assertEquals(before.regions, after.regions)
        assertEquals(PlayMode.FREE, after.playMode)
    }
}
