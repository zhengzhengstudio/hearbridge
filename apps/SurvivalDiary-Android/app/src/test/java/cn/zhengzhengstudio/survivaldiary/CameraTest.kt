package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.game.Camera2D
import cn.zhengzhengstudio.survivaldiary.game.WorldPoint
import org.junit.Assert.assertEquals
import org.junit.Test

class CameraTest {
    @Test fun transformsAreReversibleAcrossFourRotations() {
        val camera = Camera2D(centerX = 8f, centerY = -5f, zoom = 1.7f).apply { resize(1080, 720) }
        repeat(4) {
            val point = WorldPoint(43f, 91f)
            val restored = camera.screenToWorld(camera.worldToScreen(point))
            assertEquals(point.x, restored.x, 0.001f); assertEquals(point.y, restored.y, 0.001f)
            camera.rotateQuarterTurn()
        }
    }

    @Test fun zoomIsClamped() {
        val camera = Camera2D(); camera.zoomBy(0.001f); assertEquals(0.35f, camera.zoom)
        camera.zoomBy(100f); assertEquals(3f, camera.zoom)
    }
}
