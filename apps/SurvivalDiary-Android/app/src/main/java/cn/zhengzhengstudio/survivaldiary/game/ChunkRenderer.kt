package cn.zhengzhengstudio.survivaldiary.game

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import cn.zhengzhengstudio.survivaldiary.domain.TerrainSample
import cn.zhengzhengstudio.survivaldiary.domain.WorldChunk
import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import java.util.concurrent.Executors
import kotlin.math.floor

enum class FogEdge { WEST, EAST, NORTH, SOUTH }

object FogBoundaryPolicy {
    fun frontierEdges(discovered: Set<String>, chunkX: Int, chunkY: Int): List<FogEdge> = buildList {
        if ("${chunkX - 1},$chunkY" in discovered) add(FogEdge.WEST)
        if ("${chunkX + 1},$chunkY" in discovered) add(FogEdge.EAST)
        if ("$chunkX,${chunkY - 1}" in discovered) add(FogEdge.NORTH)
        if ("$chunkX,${chunkY + 1}" in discovered) add(FogEdge.SOUTH)
    }
}

data class FogCloudSegment(
    val centerX: Float,
    val centerY: Float,
    val width: Float,
    val height: Float,
    val rotationDegrees: Float,
)

/**
 * Keeps the horizontal fog-bank raster at its authored aspect ratio. A chunk
 * frontier is covered by overlapping cloud segments instead of stretching one
 * bitmap across the complete edge (which produced the long vertical bands seen
 * on phones).
 */
object FogCloudLayout {
    fun segments(
        edge: FogEdge,
        left: Float,
        top: Float,
        size: Float,
        rasterWidth: Int,
        rasterHeight: Int,
    ): List<FogCloudSegment> {
        if (size <= 0f || rasterWidth <= 0 || rasterHeight <= 0) return emptyList()
        val aspect = rasterWidth.toFloat() / rasterHeight.toFloat()
        val baseWidth = ChunkRenderer.WORLD_UNIT * 5.25f
        val baseHeight = baseWidth / aspect
        val step = baseWidth * .64f
        val start = -baseWidth * .18f
        val end = size + baseWidth * .18f
        val result = mutableListOf<FogCloudSegment>()
        var cursor = start
        var index = 0
        while (cursor <= end) {
            val scale = if (index % 2 == 0) 1f else .94f
            val width = baseWidth * scale
            val height = baseHeight * scale
            val normalOffset = when (index % 3) { 0 -> -height * .08f; 1 -> height * .06f; else -> 0f }
            result += when (edge) {
                FogEdge.NORTH -> FogCloudSegment(left + cursor, top + normalOffset, width, height, 0f)
                FogEdge.SOUTH -> FogCloudSegment(left + cursor, top + size - normalOffset, width, height, 0f)
                FogEdge.WEST -> FogCloudSegment(left + normalOffset, top + cursor, width, height, 90f)
                FogEdge.EAST -> FogCloudSegment(left + size - normalOffset, top + cursor, width, height, 90f)
            }
            cursor += step
            index += 1
        }
        return result
    }
}

object TerrainLighting {
    fun factor(height: Double, eastHeight: Double, southHeight: Double): Double {
        val elevation = (height - 0.5) * 0.28
        val directionalSlope = (height - eastHeight) * 0.34 + (height - southHeight) * 0.2
        return (0.92 + elevation + directionalSlope).coerceIn(0.72, 1.14)
    }
}

class ChunkRenderer(
    private val atlas: RasterAtlas,
    private val onChunkReady: () -> Unit = {},
    lowRam: Boolean = false,
) {
    companion object {
        const val WORLD_UNIT = 48f
        private const val RASTER_SIZE = 160
    }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val worker = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "island-chunk-renderer").apply { priority = Thread.MIN_PRIORITY } }
    private val cache = AsyncValueCache<String, Bitmap>(if (lowRam) 16 else 36, worker)

    fun close() {
        cache.close()
        worker.shutdownNow()
    }

    fun draw(canvas: Canvas, seed: String, worldBounds: FloatArray, discovered: Set<String>) {
        val chunks = WorldGenerator.visibleChunks(
            (worldBounds[0] / WORLD_UNIT).toDouble(),
            (worldBounds[1] / WORLD_UNIT).toDouble(),
            (worldBounds[2] / WORLD_UNIT).toDouble(),
            (worldBounds[3] / WORLD_UNIT).toDouble(),
            margin = 2.0,
        )
        val visible = ArrayList<Triple<Int, Int, RectF>>(chunks.size)
        for ((chunkX, chunkY) in chunks) {
            val id = "$chunkX,$chunkY"
            val left = chunkX * WorldGenerator.CHUNK_SIZE * WORLD_UNIT
            val top = chunkY * WorldGenerator.CHUNK_SIZE * WORLD_UNIT
            val size = WorldGenerator.CHUNK_SIZE * WORLD_UNIT
            val bitmap = cache.getOrSchedule("$seed:$id", onChunkReady) {
                rasterize(WorldGenerator.generate(seed, chunkX, chunkY))
            }
            paint.alpha = 255
            if (bitmap != null) {
                // A one-world-pixel overlap hides filtering seams between two
                // independently cached chunk bitmaps without changing simulation.
                canvas.drawBitmap(bitmap, null, RectF(left - 1f, top - 1f, left + size + 1f, top + size + 1f), paint)
            } else {
                val centerX = chunkX * WorldGenerator.CHUNK_SIZE + WorldGenerator.CHUNK_SIZE / 2.0
                val centerY = chunkY * WorldGenerator.CHUNK_SIZE + WorldGenerator.CHUNK_SIZE / 2.0
                paint.color = fallbackColor(WorldGenerator.sample(seed, centerX, centerY).biome)
                canvas.drawRect(left, top, left + size, top + size, paint)
            }
            visible += Triple(chunkX, chunkY, RectF(left, top, left + size, top + size))
        }
        // Draw every terrain chunk first, then one continuous opaque fog pass. This
        // prevents a later terrain bitmap from cutting a rectangular hole through a
        // neighbouring cloud bank.
        if (discovered.isNotEmpty()) for ((chunkX, chunkY, bounds) in visible) {
            val id = "$chunkX,$chunkY"
            if (id !in discovered) {
                paint.color = Color.rgb(7, 20, 22)
                paint.alpha = 255
                canvas.drawRect(bounds, paint)
                drawFogFrontier(canvas, discovered, chunkX, chunkY, bounds.left, bounds.top, bounds.width())
            }
        }
    }

    private fun drawFogFrontier(canvas: Canvas, discovered: Set<String>, chunkX: Int, chunkY: Int, left: Float, top: Float, size: Float) {
        val fog = atlas.fogBankEdge() ?: atlas.explorationFog() ?: return
        FogBoundaryPolicy.frontierEdges(discovered, chunkX, chunkY).forEach { edge ->
            drawCloudBank(canvas, fog, edge, left, top, size)
        }
    }

    private fun drawCloudBank(
        canvas: Canvas,
        fog: Bitmap,
        edge: FogEdge,
        left: Float,
        top: Float,
        size: Float,
    ) {
        val source = Rect(0, 0, fog.width, fog.height)
        paint.alpha = 210
        paint.shader = null
        paint.xfermode = null
        FogCloudLayout.segments(edge, left, top, size, fog.width, fog.height).forEach { segment ->
            val segmentCheckpoint = canvas.save()
            canvas.translate(segment.centerX, segment.centerY)
            canvas.rotate(segment.rotationDegrees)
            canvas.drawBitmap(
                fog,
                source,
                RectF(-segment.width / 2f, -segment.height / 2f, segment.width / 2f, segment.height / 2f),
                paint,
            )
            canvas.restoreToCount(segmentCheckpoint)
        }
        paint.alpha = 255
    }

    private fun fallbackColor(biome: String): Int = when (biome) {
        "lagoon" -> Color.rgb(40, 112, 128)
        "mangrove" -> Color.rgb(62, 100, 78)
        "cloud-forest" -> Color.rgb(55, 92, 66)
        "basalt-ridge" -> Color.rgb(88, 91, 84)
        "limestone-upland" -> Color.rgb(121, 118, 96)
        "dry-savanna" -> Color.rgb(132, 123, 78)
        "beach", "palm-coast" -> Color.rgb(158, 145, 101)
        else -> Color.rgb(95, 132, 85)
    }

    private fun rasterize(chunk: WorldChunk): Bitmap {
        val pixels = IntArray(RASTER_SIZE * RASTER_SIZE)
        val textures = chunk.samples.flatMap { it.blend }.map { it.biome }.distinct().associateWith(atlas::terrain)
        val materials = textures.keys.mapNotNull(GroundMaterialPolicy::materialFor).distinct().associateWith(atlas::groundMaterial)
        for (pixelY in 0 until RASTER_SIZE) {
            val localY = pixelY.toDouble() / RASTER_SIZE * WorldGenerator.CHUNK_SIZE
            for (pixelX in 0 until RASTER_SIZE) {
                val localX = pixelX.toDouble() / RASTER_SIZE * WorldGenerator.CHUNK_SIZE
                val weights = interpolatedWeights(chunk, localX, localY)
                var red = 0.0; var green = 0.0; var blue = 0.0
                val worldPixelX = chunk.x * RASTER_SIZE + pixelX
                val worldPixelY = chunk.y * RASTER_SIZE + pixelY
                for ((biome, weight) in weights) {
                    val texture = textures.getValue(biome)
                    val color = texture.getPixel(floorMod(worldPixelX, texture.width), floorMod(worldPixelY, texture.height))
                    val material = GroundMaterialPolicy.materialFor(biome)?.let(materials::get)
                    val materialColor = material?.getPixel(
                        floorMod(worldPixelX * 3 + chunk.x * 37, material.width),
                        floorMod(worldPixelY * 3 + chunk.y * 53, material.height),
                    )
                    val materialMix = if (materialColor == null) 0.0 else 0.18
                    red += (Color.red(color) * (1.0 - materialMix) + (materialColor?.let(Color::red) ?: 0) * materialMix) * weight
                    green += (Color.green(color) * (1.0 - materialMix) + (materialColor?.let(Color::green) ?: 0) * materialMix) * weight
                    blue += (Color.blue(color) * (1.0 - materialMix) + (materialColor?.let(Color::blue) ?: 0) * materialMix) * weight
                }
                val sampleX = floor(localX).toInt().coerceIn(0, WorldGenerator.CHUNK_SIZE)
                val sampleY = floor(localY).toInt().coerceIn(0, WorldGenerator.CHUNK_SIZE)
                val height = chunk.sample(sampleX, sampleY).height
                val eastHeight = chunk.sample((sampleX + 1).coerceAtMost(WorldGenerator.CHUNK_SIZE), sampleY).height
                val southHeight = chunk.sample(sampleX, (sampleY + 1).coerceAtMost(WorldGenerator.CHUNK_SIZE)).height
                val light = TerrainLighting.factor(height, eastHeight, southHeight)
                pixels[pixelY * RASTER_SIZE + pixelX] = Color.rgb(
                    (red * light).toInt().coerceIn(0, 255),
                    (green * light).toInt().coerceIn(0, 255),
                    (blue * light).toInt().coerceIn(0, 255),
                )
            }
        }
        return Bitmap.createBitmap(pixels, RASTER_SIZE, RASTER_SIZE, Bitmap.Config.ARGB_8888)
    }

    private fun interpolatedWeights(chunk: WorldChunk, x: Double, y: Double): Map<String, Double> {
        val x0 = floor(x).toInt().coerceIn(0, WorldGenerator.CHUNK_SIZE)
        val y0 = floor(y).toInt().coerceIn(0, WorldGenerator.CHUNK_SIZE)
        val x1 = (x0 + 1).coerceAtMost(WorldGenerator.CHUNK_SIZE)
        val y1 = (y0 + 1).coerceAtMost(WorldGenerator.CHUNK_SIZE)
        val tx = (x - x0).coerceIn(0.0, 1.0)
        val ty = (y - y0).coerceIn(0.0, 1.0)
        val corners = listOf(
            chunk.sample(x0, y0) to (1 - tx) * (1 - ty),
            chunk.sample(x1, y0) to tx * (1 - ty),
            chunk.sample(x0, y1) to (1 - tx) * ty,
            chunk.sample(x1, y1) to tx * ty,
        )
        val result = linkedMapOf<String, Double>()
        for ((sample, cornerWeight) in corners) for (entry in sample.blend) {
            result[entry.biome] = (result[entry.biome] ?: 0.0) + entry.weight * cornerWeight
        }
        return result
    }

    private fun WorldChunk.sample(x: Int, y: Int): TerrainSample = samples[y * (WorldGenerator.CHUNK_SIZE + 1) + x]
    private fun floorMod(value: Int, divisor: Int): Int = ((value % divisor) + divisor) % divisor
}
