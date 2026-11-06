package cn.zhengzhengstudio.survivaldiary.game

import kotlin.math.ceil
import kotlin.math.floor

data class TerrainRegion(
    val regionX: Int,
    val regionY: Int,
    val sourceColumn: Int,
    val sourceRow: Int,
    val worldWidth: Float = TerrainLayout.REGION_WIDTH,
    val worldHeight: Float = TerrainLayout.REGION_HEIGHT,
)

object TerrainLayout {
    const val REGION_WIDTH = 557f
    const val REGION_HEIGHT = 314f

    fun visibleRegions(left: Float, top: Float, right: Float, bottom: Float): List<TerrainRegion> {
        if (right <= left || bottom <= top) return emptyList()
        val minX = floor(left / REGION_WIDTH).toInt()
        val maxX = ceil(right / REGION_WIDTH).toInt() - 1
        val minY = floor(top / REGION_HEIGHT).toInt()
        val maxY = ceil(bottom / REGION_HEIGHT).toInt() - 1
        return (minY..maxY).flatMap { regionY ->
            (minX..maxX).map { regionX ->
                TerrainRegion(
                    regionX = regionX,
                    regionY = regionY,
                    sourceColumn = Math.floorMod(regionX + 1, 3),
                    sourceRow = Math.floorMod(regionY + 1, 3),
                )
            }
        }
    }
}
