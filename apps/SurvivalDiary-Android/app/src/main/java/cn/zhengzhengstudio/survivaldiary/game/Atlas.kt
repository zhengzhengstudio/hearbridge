package cn.zhengzhengstudio.survivaldiary.game

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import cn.zhengzhengstudio.survivaldiary.R
import java.util.concurrent.Executors

class Atlas(
    context: Context,
    private val onAssetReady: () -> Unit = {},
) {
    private val resources = context.applicationContext.resources
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "island-drawable-loader").apply { priority = Thread.MIN_PRIORITY }
    }
    private val cache = AsyncValueCache<Int, Bitmap>(12, worker)
    private val entityResources = mapOf(
        "campfire" to R.drawable.campfire_v1,
        "fish-rack" to R.drawable.fish_rack_v1,
        "garden-plot" to R.drawable.garden_plot_v1,
        "palisade" to R.drawable.palisade_v1,
        "rain-collector" to R.drawable.rain_collector_v1,
        "shelter" to R.drawable.shelter_v1,
        "storage-crate" to R.drawable.storage_crate_v1,
        "workbench" to R.drawable.workbench_v1,
    )
    fun player(): Bitmap? = cache.getOrSchedule(R.drawable.survivor_directions_v1, onAssetReady) {
        BitmapFactory.decodeResource(resources, R.drawable.survivor_directions_v1)
    }

    fun entity(type: String): Bitmap? {
        val resource = entityResources[type] ?: return null
        return cache.getOrSchedule(resource, onAssetReady) { BitmapFactory.decodeResource(resources, resource) }
    }
    fun vegetationStride(zoom: Float): Int = when { zoom < 0.55f -> 4; zoom < 0.9f -> 2; else -> 1 }
    fun animationStride(zoom: Float): Int = if (zoom < 0.6f) 3 else 1
    fun clear() {
        cache.close()
        worker.shutdownNow()
    }
}
