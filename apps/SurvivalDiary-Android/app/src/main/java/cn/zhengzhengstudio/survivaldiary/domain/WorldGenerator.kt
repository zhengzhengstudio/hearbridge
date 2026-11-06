package cn.zhengzhengstudio.survivaldiary.domain

import java.math.BigDecimal
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.round
import kotlin.math.sin

data class BiomeWeight(val biome: String, val weight: Double)
data class TerrainSample(
    val height: Double,
    val moisture: Double,
    val temperature: Double,
    val biome: String,
    val blend: List<BiomeWeight>,
)
data class TerrainEdgeSample(
    val height: Double,
    val moisture: Double,
    val temperature: Double,
    val biome: String,
    val blend: List<BiomeWeight>,
)
data class WorldChunk(
    val id: String,
    val x: Int,
    val y: Int,
    val samples: List<TerrainSample>,
    val north: List<TerrainEdgeSample>,
    val east: List<TerrainEdgeSample>,
    val south: List<TerrainEdgeSample>,
    val west: List<TerrainEdgeSample>,
)

object WorldGenerator {
    const val CHUNK_SIZE = 16
    private const val SAMPLE_WIDTH = CHUNK_SIZE + 1

    fun sample(seed: String, worldX: Double, worldY: Double): TerrainSample {
        require(seed.isNotBlank())
        require(worldX.isFinite() && worldY.isFinite())
        val broadHeight = octaveNoise(seed, worldX, worldY, "height-broad", 84.0, 4)
        val detailHeight = octaveNoise(seed, worldX, worldY, "height-detail", 23.0, 3)
        val moisture = clamp01(
            octaveNoise(seed, worldX, worldY, "moisture", 68.0, 4) +
                (octaveNoise(seed, worldX, worldY, "moisture-detail", 17.0, 2) - 0.5) * 0.22,
        )
        val latitude = sin(worldY / 57.0) * 0.13
        val temperature = clamp01(
            octaveNoise(seed, worldX, worldY, "temperature", 96.0, 4) - broadHeight * 0.18 + 0.1 + latitude,
        )
        val height = clamp01(broadHeight * 0.78 + detailHeight * 0.22)
        val roundedHeight = rounded(height)
        val roundedMoisture = rounded(moisture)
        val roundedTemperature = rounded(temperature)
        val biome = biomeFor(roundedHeight, roundedMoisture, roundedTemperature)
        return TerrainSample(
            roundedHeight,
            roundedMoisture,
            roundedTemperature,
            biome,
            biomeBlendFor(roundedHeight, roundedMoisture, roundedTemperature, biome),
        )
    }

    fun generate(seed: String, chunkX: Int, chunkY: Int): WorldChunk {
        val samples = ArrayList<TerrainSample>(SAMPLE_WIDTH * SAMPLE_WIDTH)
        val originX = chunkX * CHUNK_SIZE
        val originY = chunkY * CHUNK_SIZE
        for (localY in 0..CHUNK_SIZE) {
            for (localX in 0..CHUNK_SIZE) {
                samples += sample(seed, (originX + localX).toDouble(), (originY + localY).toDouble())
            }
        }
        fun edge(index: Int): TerrainEdgeSample = samples[index].let {
            TerrainEdgeSample(it.height, it.moisture, it.temperature, it.biome, it.blend)
        }
        return WorldChunk(
            id = "$chunkX,$chunkY",
            x = chunkX,
            y = chunkY,
            samples = samples,
            north = (0..CHUNK_SIZE).map(::edge),
            east = (0..CHUNK_SIZE).map { edge(it * SAMPLE_WIDTH + CHUNK_SIZE) },
            south = (0..CHUNK_SIZE).map { edge(CHUNK_SIZE * SAMPLE_WIDTH + it) },
            west = (0..CHUNK_SIZE).map { edge(it * SAMPLE_WIDTH) },
        )
    }

    fun visibleChunks(minX: Double, minY: Double, maxX: Double, maxY: Double, margin: Double = 0.0): List<Pair<Int, Int>> {
        require(maxX >= minX && maxY >= minY && margin >= 0)
        val left = floor((minX - margin) / CHUNK_SIZE).toInt()
        val right = floor((maxX + margin) / CHUNK_SIZE).toInt()
        val top = floor((minY - margin) / CHUNK_SIZE).toInt()
        val bottom = floor((maxY + margin) / CHUNK_SIZE).toInt()
        return (top..bottom).flatMap { y -> (left..right).map { x -> x to y } }
    }

    private fun biomeFor(height: Double, moisture: Double, temperature: Double): String = when {
        height < 0.3 -> "lagoon"
        height > 0.76 -> "basalt-ridge"
        temperature < 0.34 && moisture > 0.48 -> "cloud-forest"
        moisture > 0.68 -> "mangrove"
        moisture < 0.3 && temperature > 0.58 -> "dry-savanna"
        height > 0.62 && moisture < 0.52 -> "limestone-upland"
        else -> "palm-grove"
    }

    private fun biomeBlendFor(height: Double, moisture: Double, temperature: Double, selected: String): List<BiomeWeight> {
        val scores = linkedMapOf(
            "lagoon" to (0.36 - height) * 7 + moisture * 0.4,
            "palm-grove" to 0.35 - abs(height - 0.5) * 1.2 - abs(moisture - 0.5) * 0.7,
            "basalt-ridge" to (height - 0.67) * 7 - moisture * 0.25,
            "mangrove" to (moisture - 0.58) * 5 - abs(height - 0.42) * 1.2,
            "cloud-forest" to (0.42 - temperature) * 3.8 + (moisture - 0.48) * 2.7,
            "dry-savanna" to (0.4 - moisture) * 4 + (temperature - 0.52) * 2.2,
            "limestone-upland" to (height - 0.56) * 3.5 + (0.56 - moisture) * 1.8,
        )
        scores[selected] = scores.getValue(selected) + 0.42
        val ranked = scores.map { (biome, score) -> biome to exp(score * 1.15) }
            .sortedByDescending { it.second }
            .take(3)
        val total = ranked.sumOf { it.second }
        val result = ranked.map { BiomeWeight(it.first, rounded(it.second / total)) }.toMutableList()
        result[result.lastIndex] = result.last().copy(weight = rounded(1.0 - result.dropLast(1).sumOf { it.weight }))
        return result
    }

    private fun octaveNoise(seed: String, worldX: Double, worldY: Double, channel: String, scale: Double, octaves: Int): Double {
        var amplitude = 1.0
        var frequency = 1.0
        var total = 0.0
        var weight = 0.0
        repeat(octaves) { octave ->
            total += latticeNoise(seed, worldX / scale * frequency, worldY / scale * frequency, "$channel:$octave") * amplitude
            weight += amplitude
            amplitude *= 0.5
            frequency *= 2.0
        }
        return total / weight
    }

    private fun latticeNoise(seed: String, x: Double, y: Double, channel: String): Double {
        val minX = floor(x).toInt()
        val minY = floor(y).toInt()
        val offsetX = fade(x - minX)
        val offsetY = fade(y - minY)
        val north = lerp(hashUnit(seed, minX, minY, channel), hashUnit(seed, minX + 1, minY, channel), offsetX)
        val south = lerp(hashUnit(seed, minX, minY + 1, channel), hashUnit(seed, minX + 1, minY + 1, channel), offsetX)
        return lerp(north, south, offsetY)
    }

    internal fun hashUnit(vararg parts: Any): Double {
        val input = parts.joinToString("\u001f") { stablePart(it) }
        var hash = 0x811c9dc5u.toInt()
        input.forEach { character -> hash = (hash xor character.code) * 0x01000193 }
        hash = hash xor (hash ushr 16)
        hash *= 0x7feb352du.toInt()
        hash = hash xor (hash ushr 15)
        hash *= 0x846ca68bu.toInt()
        hash = hash xor (hash ushr 16)
        return (hash.toLong() and 0xffffffffL).toDouble() / 0xffffffffL.toDouble()
    }

    private fun stablePart(value: Any): String = when (value) {
        is Double -> BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
        is Float -> BigDecimal.valueOf(value.toDouble()).stripTrailingZeros().toPlainString()
        else -> value.toString()
    }
    private fun fade(value: Double) = value * value * (3 - 2 * value)
    private fun lerp(a: Double, b: Double, amount: Double) = a + (b - a) * amount
    private fun clamp01(value: Double) = value.coerceIn(0.0, 1.0)
    private fun rounded(value: Double) = round(value * 10_000.0) / 10_000.0
}
