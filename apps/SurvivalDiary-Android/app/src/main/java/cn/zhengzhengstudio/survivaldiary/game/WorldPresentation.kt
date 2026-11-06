package cn.zhengzhengstudio.survivaldiary.game

import cn.zhengzhengstudio.survivaldiary.domain.BuildingAppearance
import cn.zhengzhengstudio.survivaldiary.domain.Coordinates
import cn.zhengzhengstudio.survivaldiary.domain.Entity
import cn.zhengzhengstudio.survivaldiary.domain.GroundItem
import cn.zhengzhengstudio.survivaldiary.domain.ResourceNodeState
import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import kotlin.math.floor
import kotlin.math.max

object ExplorationVisibility {
    fun contains(coordinates: Coordinates, discovered: Set<String>): Boolean =
        chunkId(coordinates.x.toDouble(), coordinates.y.toDouble()) in discovered

    fun resources(nodes: List<ResourceNodeState>, discovered: Set<String>): List<ResourceNodeState> =
        nodes.filter { chunkId(it.x, it.y) in discovered }

    fun entities(values: Collection<Entity>, discovered: Set<String>): List<Entity> =
        values.filter { contains(it.coordinates, discovered) }

    fun groundItems(values: Collection<GroundItem>, discovered: Set<String>): List<GroundItem> =
        values.filter { chunkId(it.x, it.y) in discovered }

    private fun chunkId(x: Double, y: Double): String {
        val chunkX = floor(x / WorldGenerator.CHUNK_SIZE).toInt()
        val chunkY = floor(y / WorldGenerator.CHUNK_SIZE).toInt()
        return "$chunkX,$chunkY"
    }
}

object BuildingMetrics {
    fun renderSize(appearance: BuildingAppearance?): Pair<Float, Float> {
        val width = max(64f, (appearance?.collisionWidth ?: 1) * ChunkRenderer.WORLD_UNIT)
        val height = max(72f, (appearance?.collisionHeight ?: 1) * ChunkRenderer.WORLD_UNIT)
        return width to height
    }
}
