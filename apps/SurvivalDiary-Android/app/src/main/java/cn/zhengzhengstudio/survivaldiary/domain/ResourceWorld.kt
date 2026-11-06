package cn.zhengzhengstudio.survivaldiary.domain

import java.util.LinkedHashMap
import kotlin.math.floor
import kotlin.math.round

class ResourceWorld(
    private val definitions: Map<String, ResourceDefinition>,
    private val biomeSpawns: Map<String, List<SpawnRule>>,
    private val appearances: Map<String, ItemAppearance>,
) {
    private val cache = object : LinkedHashMap<String, List<ResourceNodeState>>(48, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<ResourceNodeState>>?): Boolean = size > 48
    }

    @Synchronized fun nodes(seed: String, chunkX: Int, chunkY: Int): List<ResourceNodeState> =
        cache.getOrPut("$seed:$chunkX,$chunkY") { generate(seed, chunkX, chunkY) }

    private fun generate(seed: String, chunkX: Int, chunkY: Int): List<ResourceNodeState> {
        val result = mutableListOf<ResourceNodeState>()
        val originX = chunkX * WorldGenerator.CHUNK_SIZE
        val originY = chunkY * WorldGenerator.CHUNK_SIZE
        for (localY in 0 until WorldGenerator.CHUNK_SIZE step 2) {
            for (localX in 0 until WorldGenerator.CHUNK_SIZE step 2) {
                val worldX = originX + localX + 1
                val worldY = originY + localY + 1
                val biome = WorldGenerator.sample(seed, worldX.toDouble(), worldY.toDouble()).biome
                for (spawn in biomeSpawns[biome].orEmpty()) {
                    if (WorldGenerator.hashUnit(seed, worldX, worldY, spawn.resourceId, "spawn") >= spawn.chance) continue
                    val definition = definitions[spawn.resourceId] ?: continue
                    val range = definition.yieldMax - definition.yieldMin + 1
                    val remaining = definition.yieldMin + floor(
                        WorldGenerator.hashUnit(seed, worldX, worldY, spawn.resourceId, "yield") * range,
                    ).toInt()
                    val appearance = appearances[definition.itemId]
                    val candidate = ResourceNodeState(
                        id = "${spawn.resourceId}@$worldX,$worldY",
                        resourceId = spawn.resourceId,
                        itemId = definition.itemId,
                        x = rounded(worldX + WorldGenerator.hashUnit(seed, worldX, worldY, spawn.resourceId, "offset-x") * 0.8 - 0.4),
                        y = rounded(worldY + WorldGenerator.hashUnit(seed, worldX, worldY, spawn.resourceId, "offset-y") * 0.8 - 0.4),
                        remaining = remaining,
                        hardness = definition.hardness,
                        toolTags = definition.toolTags,
                        recoveryMinutes = definition.recoveryMinutes,
                        category = appearance?.category ?: "material",
                        displayName = appearance?.name ?: definition.itemId,
                    )
                    val tooClose = result.any { other -> kotlin.math.hypot(other.x - candidate.x, other.y - candidate.y) < 2.15 }
                    if (!tooClose && result.size < MAX_NODES_PER_CHUNK) result += candidate
                    break
                }
            }
        }
        if (chunkX == 0 && chunkY == 0) ensureStarterResources(seed, result)
        return result
    }

    private fun ensureStarterResources(seed: String, result: MutableList<ResourceNodeState>) {
        val handGatherable = result.filter { it.toolTags.isEmpty() }.groupingBy(ResourceNodeState::itemId).fold(0) { total, node -> total + node.remaining }
        StarterResourcePolicy.missingAmounts(handGatherable).entries.forEachIndexed { index, (itemId, missing) ->
            val definition = definitions.values.firstOrNull { it.itemId == itemId && it.toolTags.isEmpty() } ?: return@forEachIndexed
            val coordinate = (2 until WorldGenerator.CHUNK_SIZE - 1).asSequence().flatMap { y ->
                (2 until WorldGenerator.CHUNK_SIZE - 1).asSequence().map { x -> x to y }
            }.drop(index * 11).firstOrNull { (x, y) ->
                WorldGenerator.sample(seed, x.toDouble(), y.toDouble()).biome != "lagoon" &&
                    result.none { kotlin.math.hypot(it.x - x, it.y - y) < 1.4 }
            } ?: return@forEachIndexed
            val appearance = appearances[itemId]
            result += ResourceNodeState(
                id = "starter-${definition.id}@${coordinate.first},${coordinate.second}",
                resourceId = definition.id,
                itemId = itemId,
                x = coordinate.first.toDouble(),
                y = coordinate.second.toDouble(),
                remaining = missing,
                hardness = definition.hardness,
                toolTags = definition.toolTags,
                recoveryMinutes = definition.recoveryMinutes,
                category = appearance?.category ?: "material",
                displayName = appearance?.name ?: itemId,
            )
        }
    }

    private fun rounded(value: Double) = round(value * 10_000.0) / 10_000.0

    companion object { const val MAX_NODES_PER_CHUNK = 13 }
}
