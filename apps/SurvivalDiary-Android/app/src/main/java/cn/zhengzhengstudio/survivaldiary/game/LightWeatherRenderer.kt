package cn.zhengzhengstudio.survivaldiary.game

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.math.abs

class LightWeatherRenderer {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    fun drawWorldWeather(canvas: Canvas, kind: String, intensity: Double, zoom: Float) {
        if (kind !in setOf("rain", "storm", "snow", "blizzard") || zoom < 0.45f) return
        paint.color = Color.argb((45 + intensity * 120).toInt().coerceIn(45, 175), 224, 239, 244)
        if (kind == "snow" || kind == "blizzard") {
            for (i in -18..18) canvas.drawCircle(i * 59f, ((i * 97) % 740 - 370).toFloat(), 4f, paint)
        } else {
            for (i in -18..18) canvas.drawLine(i * 57f, -440f, i * 57f - 42f, 440f, paint)
        }
    }

    fun drawAtmosphere(canvas: Canvas, minute: Int, width: Int, height: Int) {
        val hour = minute / 60f
        val darkness = (abs(hour - 12f) / 12f * 0.72f - 0.12f).coerceIn(0f, 0.58f)
        if (darkness <= 0f) return
        paint.color = Color.argb((darkness * 255).toInt(), 4, 13, 42)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    }
}
