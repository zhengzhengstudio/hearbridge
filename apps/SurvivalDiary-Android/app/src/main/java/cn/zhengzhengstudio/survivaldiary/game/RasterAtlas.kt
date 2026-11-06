package cn.zhengzhengstudio.survivaldiary.game

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.util.LinkedHashMap
import java.util.concurrent.Executors

class RasterAtlas(
    context: Context,
    private val onAssetReady: () -> Unit = {},
) {
    private val applicationContext = context.applicationContext
    val lowRam: Boolean = (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.isLowRamDevice == true
    private val cacheLimit = if (lowRam) 48 else 128
    private val worker = Executors.newFixedThreadPool(if (lowRam) 1 else 2) { runnable ->
        Thread(runnable, "island-raster-loader").apply { priority = Thread.MIN_PRIORITY }
    }
    private val cache = object : LinkedHashMap<String, Bitmap>(cacheLimit, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?): Boolean = size > cacheLimit
    }
    private val pending = mutableSetOf<String>()
    private val failed = mutableSetOf<String>()
    @Volatile private var closed = false

    /** Terrain rasterization already runs on ChunkRenderer's worker. */
    fun terrain(biome: String, state: String = "base"): Bitmap = loadBlocking(
        "terrain:$biome:$state",
        "survival-v3/game/terrain/terrain-$biome/$state.png",
        192,
    )

    fun groundMaterial(material: String): Bitmap = loadBlocking(
        "ground-material:$material",
        GroundMaterialPolicy.assetPath(material),
        384,
    )

    fun building(type: String, state: String = "world"): Bitmap? = loadAsync(
        "building:$type:$state", "survival-v3/game/building/building-$type/$state.png", 256,
    )

    fun item(family: String, id: String, state: String = "world"): Bitmap? = loadAsync(
        "item:$family:$id:$state", "survival-v3/game/$family/item-$id/$state.png", 128,
    )

    fun resource(id: String, state: String = "full"): Bitmap? = loadAsync(
        "resource:$id:$state", "survival-v3/game/resource/resource-$id/$state.png", 256,
    )

    fun worldResource(id: String): Bitmap? {
        val filename = mapOf(
            "driftwood-pile" to "driftwood-pile-large", "softwood-tree" to "softwood-tree-medium",
            "hardwood-tree" to "hardwood-tree-large", "bamboo-grove" to "bamboo-grove-small",
            "broadleaf-bush" to "broadleaf-bush-large", "stone-outcrop" to "stone-outcrop-small",
            "coconut-palm" to "coconut-palm-small",
        )[id] ?: id
        return loadAsync(
            "world-resource:$filename", "survival-v3/game/world-resources/$filename-full@0.5x.webp", 256,
        )
    }

    fun villager(state: String = "idle-south-01"): Bitmap? = loadAsync(
        "villager:castaway-builder:$state", "survival-v3/game/villagers/castaway-builder/$state.png", 192,
    )

    fun survivor(character: String, state: String = "idle"): Bitmap? = loadAsync(
        "villager-v8:$character:$state", "survival-v3/game/villager-v8/$character-$state.png", 256,
    )

    fun animal(species: String, state: String = "idle"): Bitmap? = loadAsync(
        "animal:$species:$state", "survival-v3/game/animal/animal-$species/$state.png", 160,
    )

    fun groundDetail(id: String): Bitmap? = loadAsync(
        "ground-detail:$id", "survival-v3/game/ground-v5/$id@0.5x.webp", 128,
    )

    fun transport(id: String): Bitmap? = loadAsync(
        "transport-v6:$id", "survival-v3/game/transport-v6/$id.webp", 256,
    )

    fun transportV7(id: String): Bitmap? = loadAsync(
        "transport-v7:$id", "survival-v3/game/transport-v7/$id.webp", 256,
    )

    fun rowboat(aboard: Boolean): Bitmap? {
        val state = if (aboard) "aboard" else "empty"
        return loadAsync(
            "world-v4:rowboat:$state", "survival-v3/game/world-v4/transport/rowboat-$state@0.5x.webp", 256,
        )
    }

    fun explorationFog(): Bitmap? = loadAsync(
        "fog-v8:unknown", "survival-v3/game/fog-v8/unknown-island-fog@0.5x.webp", 512,
    )

    fun fogBankEdge(): Bitmap? = loadAsync(
        "fog-v9:edge", "survival-v3/game/fog-v9/fog-bank-edge-v9@0.5x.webp", 512,
    )

    private fun loadAsync(key: String, path: String, maxSide: Int): Bitmap? {
        synchronized(cache) {
            if (closed || key in failed) return null
            cache[key]?.let { return it }
            if (!pending.add(key)) return null
        }
        val accepted = runCatching {
            worker.execute {
                val result = runCatching { loadBlocking(key, path, maxSide) }
                synchronized(cache) {
                    pending.remove(key)
                    if (result.isFailure) failed.add(key)
                }
                if (!closed && result.isSuccess) onAssetReady()
            }
        }.isSuccess
        if (!accepted) synchronized(cache) {
            pending.remove(key)
        }
        return null
    }

    private fun loadBlocking(key: String, path: String, maxSide: Int): Bitmap {
        synchronized(cache) { cache[key]?.let { return it } }
        val effectiveMaxSide = if (lowRam) minOf(maxSide, 192) else maxSide
        val sample = when { effectiveMaxSide <= 128 -> 4; effectiveMaxSide <= 256 -> 2; else -> 1 }
        val decoded = applicationContext.assets.open(path).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: error("Unreadable formal raster: $path")
        val scale = minOf(1f, effectiveMaxSide.toFloat() / maxOf(decoded.width, decoded.height))
        val bitmap = if (scale < 1f) {
            Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true).also {
                if (it !== decoded) decoded.recycle()
            }
        } else decoded
        synchronized(cache) { if (!closed) cache[key] = bitmap }
        return bitmap
    }

    fun close() {
        closed = true
        synchronized(cache) {
            cache.clear()
            pending.clear()
            failed.clear()
        }
        worker.shutdownNow()
    }
}
