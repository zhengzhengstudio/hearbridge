package cn.zhengzhengstudio.survivaldiary.game

import cn.zhengzhengstudio.survivaldiary.domain.Entity
import cn.zhengzhengstudio.survivaldiary.domain.ResourceNodeState
import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import kotlin.math.abs

object WorldNavigation {
    fun isWalkable(seed: String, point: WorldPoint, entities: Collection<Entity>, resources: Collection<ResourceNodeState> = emptyList()): Boolean {
        val tileX = point.x / ChunkRenderer.WORLD_UNIT
        val tileY = point.y / ChunkRenderer.WORLD_UNIT
        val biome = WorldGenerator.sample(seed, tileX.toDouble(), tileY.toDouble()).biome
        val waterPassage = entities.any { entity ->
            entity.type in setOf("dock", "rope-bridge") &&
                abs(entity.coordinates.x - tileX) <= (if (entity.type == "dock") 3.0f else 2.0f) &&
                abs(entity.coordinates.y - tileY) <= (if (entity.type == "dock") 2.0f else 1.5f)
        }
        if (biome in setOf("lagoon", "deep-water") && !waterPassage) return false
        val blockingSizes = mapOf(
            // Only the grounded base blocks. The art is deliberately much taller
            // so the player can pass behind it instead of hitting an invisible box.
            "shelter" to (1.55f to .72f), "workbench" to (.72f to .34f), "storage-crate" to (.46f to .32f),
            "drying-shed" to (.72f to .38f), "furnace" to (.54f to .38f), "palisade" to (.44f to .42f),
        )
        if (entities.any { entity ->
            val footprint = blockingSizes[entity.type] ?: return@any false
            abs(entity.coordinates.x - tileX) < footprint.first / 2f && abs(entity.coordinates.y - tileY) < footprint.second / 2f
        }) return false
        // Loose stones, branches, grass, springs and low bushes are ground
        // clutter: walking over them is intentional. Trees keep a compact trunk
        // collision and are routed around by PlayerMotion.
        if (resources.any { node ->
            val isTree = node.resourceId.contains("tree") || node.resourceId.contains("palm")
            isTree && abs(node.x - tileX) < .34 && abs(node.y - tileY) < .28
        }) return false
        return true
    }

    fun nearestWalkable(seed: String, around: WorldPoint, entities: Collection<Entity>, radius: Int = 24): WorldPoint {
        if (isWalkable(seed, around, entities)) return around
        val originX = kotlin.math.round(around.x / ChunkRenderer.WORLD_UNIT).toInt()
        val originY = kotlin.math.round(around.y / ChunkRenderer.WORLD_UNIT).toInt()
        for (distance in 1..radius) {
            for (y in originY - distance..originY + distance) {
                for (x in originX - distance..originX + distance) {
                    if (kotlin.math.abs(x - originX) != distance && kotlin.math.abs(y - originY) != distance) continue
                    val candidate = WorldPoint(x * ChunkRenderer.WORLD_UNIT, y * ChunkRenderer.WORLD_UNIT)
                    if (isWalkable(seed, candidate, entities)) return candidate
                }
            }
        }
        error("附近没有可站立的陆地")
    }
}

class CameraFollowController(var enabled: Boolean = true) {
    fun onManualPan() { enabled = false }
    fun onCenterPlayer() { enabled = true }
}
