package cn.zhengzhengstudio.survivaldiary.game

import android.graphics.Canvas
import android.graphics.Matrix
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

data class WorldPoint(val x: Float, val y: Float)

class Camera2D(
    var centerX: Float = 0f,
    var centerY: Float = 0f,
    var zoom: Float = 2f,
    var quarterTurns: Int = 0,
) {
    private var viewportWidth = 1f
    private var viewportHeight = 1f

    fun resize(width: Int, height: Int) { viewportWidth = width.toFloat(); viewportHeight = height.toFloat() }
    fun zoomBy(factor: Float) { zoom = (zoom * factor).coerceIn(0.35f, 3.0f) }
    fun panBy(screenDx: Float, screenDy: Float) { centerX -= screenDx / zoom; centerY -= screenDy / zoom }
    fun rotateQuarterTurn() { quarterTurns = (quarterTurns + 1) % 4 }
    fun centerOn(point: WorldPoint) { centerX = point.x; centerY = point.y }

    fun visibleWorldBounds(): FloatArray {
        val corners = listOf(
            screenToWorld(WorldPoint(0f, 0f)),
            screenToWorld(WorldPoint(viewportWidth, 0f)),
            screenToWorld(WorldPoint(0f, viewportHeight)),
            screenToWorld(WorldPoint(viewportWidth, viewportHeight)),
        )
        return floatArrayOf(
            corners.minOf { it.x },
            corners.minOf { it.y },
            corners.maxOf { it.x },
            corners.maxOf { it.y },
        )
    }

    fun worldToScreen(point: WorldPoint): WorldPoint {
        val angle = Math.toRadians((quarterTurns * 90).toDouble())
        val dx = point.x - centerX
        val dy = point.y - centerY
        val rx = (dx * cos(angle) - dy * sin(angle)).toFloat()
        val ry = (dx * sin(angle) + dy * cos(angle)).toFloat()
        return WorldPoint(viewportWidth / 2 + rx * zoom, viewportHeight / 2 + ry * zoom)
    }

    fun screenToWorld(point: WorldPoint): WorldPoint {
        val angle = Math.toRadians((-quarterTurns * 90).toDouble())
        val dx = (point.x - viewportWidth / 2) / zoom
        val dy = (point.y - viewportHeight / 2) / zoom
        return WorldPoint(centerX + (dx * cos(angle) - dy * sin(angle)).toFloat(), centerY + (dx * sin(angle) + dy * cos(angle)).toFloat())
    }

    fun applyTo(canvas: Canvas) {
        val matrix = Matrix().apply {
            postTranslate(-centerX, -centerY)
            postRotate((quarterTurns * 90).toFloat())
            postScale(zoom, zoom)
            postTranslate(viewportWidth / 2, viewportHeight / 2)
        }
        canvas.concat(matrix)
    }
}
