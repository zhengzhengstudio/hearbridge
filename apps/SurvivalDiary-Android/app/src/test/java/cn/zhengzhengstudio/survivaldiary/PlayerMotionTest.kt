package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.game.PlayerMotion
import cn.zhengzhengstudio.survivaldiary.game.WorldPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerMotionTest {
    @Test fun tappingTerrainCreatesVisibleMovementInsteadOfOnlyPanningTheCamera() {
        val motion = PlayerMotion(position = WorldPoint(0f, 0f))
        motion.moveTo(WorldPoint(120f, 0f))

        assertTrue(motion.advance(seconds = 0.5f))
        assertEquals(45f, motion.position.x, 0.001f)
        assertEquals(0f, motion.position.y, 0.001f)
        assertTrue(motion.isMoving)

        motion.advance(seconds = 2f)
        assertEquals(120f, motion.position.x, 0.001f)
        assertFalse(motion.isMoving)
    }

    @Test fun stoppingMovementPreventsDetachedViewFromAdvancing() {
        val motion = PlayerMotion(position = WorldPoint(0f, 0f))
        motion.moveTo(WorldPoint(120f, 0f))
        motion.stop()
        assertFalse(motion.advance(seconds = 1f))
        assertEquals(0f, motion.position.x, 0.001f)
    }

    @Test fun tapToMovePlansASmoothDetourAroundATrunkInsteadOfStopping() {
        val motion = PlayerMotion(position = WorldPoint(0f, 0f), speed = 120f)
        val passable: (WorldPoint) -> Boolean = { point ->
            point.x !in 42f..78f || point.y !in -34f..34f
        }
        assertTrue(motion.moveTo(WorldPoint(120f, 0f), passable))

        var leftStraightLine = false
        repeat(80) {
            motion.advance(.05f)
            if (kotlin.math.abs(motion.position.y) > 34f) leftStraightLine = true
        }

        assertTrue(leftStraightLine)
        assertEquals(120f, motion.position.x, 0.6f)
        assertEquals(0f, motion.position.y, 0.6f)
        assertFalse(motion.isMoving)
    }
}
