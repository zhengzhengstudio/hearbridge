package cn.zhengzhengstudio.survivaldiary.game

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.SoundEffectConstants
import android.view.View
import android.view.ViewConfiguration
import cn.zhengzhengstudio.survivaldiary.domain.Entity
import cn.zhengzhengstudio.survivaldiary.domain.BuildingAppearance
import cn.zhengzhengstudio.survivaldiary.domain.ItemAppearance
import cn.zhengzhengstudio.survivaldiary.domain.ResourceDefinition
import cn.zhengzhengstudio.survivaldiary.domain.SpawnRule
import cn.zhengzhengstudio.survivaldiary.domain.ResourceNodeState
import cn.zhengzhengstudio.survivaldiary.domain.ResourceWorld
import cn.zhengzhengstudio.survivaldiary.domain.PlayerPosition
import cn.zhengzhengstudio.survivaldiary.domain.GroundItem
import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import cn.zhengzhengstudio.survivaldiary.domain.NativeNpcRules
import cn.zhengzhengstudio.survivaldiary.domain.InteractionTargetRules
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.atan2

class NativeGameView(context: Context) : View(context) {
    val camera = Camera2D()
    private val atlas = Atlas(context) { postInvalidateOnAnimation() }
    private val rasterAtlas = RasterAtlas(context) { postInvalidateOnAnimation() }
    private val chunkRenderer = ChunkRenderer(rasterAtlas, { postInvalidateOnAnimation() }, rasterAtlas.lowRam)
    private val lightWeatherRenderer = LightWeatherRenderer()
    private var buildingAppearances: Map<String, BuildingAppearance> = emptyMap()
    private var itemAppearances: Map<String, ItemAppearance> = emptyMap()
    private var resourceDefinitions: Map<String, ResourceDefinition> = emptyMap()
    private var biomeSpawnRules: Map<String, List<SpawnRule>> = emptyMap()
    private var resourceWorld = ResourceWorld(emptyMap(), emptyMap(), emptyMap())
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var lastX = 0f
    private var lastY = 0f
    private var downX = 0f
    private var downY = 0f
    private var dragged = false
    private var lastFrameNanos = System.nanoTime()
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private val player = PlayerMotion()
    private val cameraFollow = CameraFollowController()
    var worldSeed: String = "local-island"
    private val revealingChunks = mutableMapOf<String, Long>()
    var discoveredChunks: Set<String> = setOf("0,0")
        set(value) {
            if (value == field) return
            val now = System.nanoTime()
            value.filterNot { it in field }.forEach { revealingChunks[it] = now }
            if (field.isNotEmpty() && value.any { it !in field }) playSoundEffect(SoundEffectConstants.NAVIGATION_DOWN)
            field = value
            invalidate()
        }
    var resourceNodeChanges: Map<String, ResourceNodeState> = emptyMap()
    private var visibleResourceNodes: List<ResourceNodeState> = emptyList()
    private var visibleResourceKey = ""
    private val resourceHitAnimations = mutableMapOf<String, Long>()
    var entities: Collection<Entity> = emptyList()
        set(value) {
            if (value == field) return
            val previous = field.associateBy(Entity::id)
            val now = System.nanoTime()
            value.filter { NativeNpcRules.isVillager(it.type) || it.type == "minecart" }.forEach { next ->
                val old = previous[next.id] ?: return@forEach
                if (old.coordinates != next.coordinates) {
                    npcTransitions[next.id] = NpcTransition(
                        old.coordinates.x * ChunkRenderer.WORLD_UNIT,
                        old.coordinates.y * ChunkRenderer.WORLD_UNIT,
                        next.coordinates.x * ChunkRenderer.WORLD_UNIT,
                        next.coordinates.y * ChunkRenderer.WORLD_UNIT,
                        now,
                    )
                }
            }
            field = value
            railCells = value.filter { it.type == "rail-segment" }.mapTo(mutableSetOf()) { it.coordinates.x to it.coordinates.y }
            roadCells = value.filter { it.type == "road-segment" }.mapTo(mutableSetOf()) { it.coordinates.x to it.coordinates.y }
            invalidate()
        }
    var groundItems: Collection<GroundItem> = emptyList()
        set(value) {
            if (value == field) return
            field = value
            invalidate()
        }
    var aboardBoatId: String? = null
    var aboardMinecartId: String? = null
    var weatherKind: String = "clear"
    var weatherIntensity: Double = 0.0
    var minute: Int = 480
    var placementType: String? = null
    var placementValid: Boolean = false
    var placementCoordinates: cn.zhengzhengstudio.survivaldiary.domain.Coordinates? = null
    var onPlayerChunkChanged: ((Int, Int) -> Unit)? = null
    var onPlayerPositionChanged: ((PlayerPosition) -> Unit)? = null
    var onMovementChanged: ((Boolean) -> Unit)? = null
    var onMovementBlocked: (() -> Unit)? = null
    var onNearbyResourceChanged: ((ResourceNodeState?) -> Unit)? = null
    var onNearbyEntityChanged: ((Entity?) -> Unit)? = null
    var onNearbyGroundItemChanged: ((GroundItem?) -> Unit)? = null
    var onEntityTapped: ((Entity) -> Unit)? = null
    var onBiomeChanged: ((String) -> Unit)? = null
    var onPlacementRequested: ((cn.zhengzhengstudio.survivaldiary.domain.Coordinates) -> Unit)? = null
    private var reportedChunk: Pair<Int, Int>? = null
    private var reportedPosition: PlayerPosition? = null
    private var lastPositionReportNanos = 0L
    private var reportedResourceId: String? = null
    private var reportedEntityId: String? = null
    private var reportedGroundItemId: String? = null
    private var reportedMoving = false
    private var reportedBiome: String? = null
    private var railCells: Set<Pair<Int, Int>> = emptySet()
    private var roadCells: Set<Pair<Int, Int>> = emptySet()
    private data class NpcTransition(
        val fromX: Float,
        val fromY: Float,
        val toX: Float,
        val toY: Float,
        val startedNanos: Long,
    )
    private val npcTransitions = mutableMapOf<String, NpcTransition>()

    private fun reportMovement(moving: Boolean = player.isMoving) {
        if (reportedMoving == moving) return
        reportedMoving = moving
        onMovementChanged?.invoke(moving)
    }

    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean { camera.zoomBy(detector.scaleFactor); invalidate(); return true }
    })

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) = camera.resize(w, h)

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = System.nanoTime()
        val elapsedSeconds = ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(0f, 0.05f)
        lastFrameNanos = now
        val wasMoving = player.isMoving
        val moved = player.advance(elapsedSeconds)
        if (moved || (wasMoving && !player.isMoving)) {
            if (cameraFollow.enabled) camera.centerOn(player.position)
            val chunkX = floor(player.position.x / ChunkRenderer.WORLD_UNIT / 16f).toInt()
            val chunkY = floor(player.position.y / ChunkRenderer.WORLD_UNIT / 16f).toInt()
            if (reportedChunk != chunkX to chunkY) {
                reportedChunk = chunkX to chunkY
                onPlayerChunkChanged?.invoke(chunkX, chunkY)
            }
            reportPlayerPosition(now, force = !player.isMoving)
            postInvalidateOnAnimation()
        }
        reportMovement()
        val biome = WorldGenerator.sample(
            worldSeed,
            (player.position.x / ChunkRenderer.WORLD_UNIT).toDouble(),
            (player.position.y / ChunkRenderer.WORLD_UNIT).toDouble(),
        ).biome
        if (biome != reportedBiome) { reportedBiome = biome; onBiomeChanged?.invoke(biome) }
        canvas.drawColor(Color.rgb(38, 113, 130))
        canvas.save()
        camera.applyTo(canvas)
        drawTerrain(canvas)
        drawWandererOutposts(canvas)
        drawVillageClearing(canvas)
        drawScene(canvas)
        drawWeather(canvas)
        drawRevealFog(canvas, now)
        canvas.restore()
        drawAtmosphere(canvas)
        reportNearbyResource()
        reportNearbyEntity()
        reportNearbyGroundItem()
    }

    private fun updateVisibleResources() {
        val bounds = camera.visibleWorldBounds()
        val chunks = WorldGenerator.visibleChunks(
            (bounds[0] / ChunkRenderer.WORLD_UNIT).toDouble(),
            (bounds[1] / ChunkRenderer.WORLD_UNIT).toDouble(),
            (bounds[2] / ChunkRenderer.WORLD_UNIT).toDouble(),
            (bounds[3] / ChunkRenderer.WORLD_UNIT).toDouble(),
            1.5,
        )
        val key = "$worldSeed:${chunks.joinToString()}:${resourceNodeChanges.hashCode()}:${discoveredChunks.hashCode()}"
        if (key == visibleResourceKey) return
        visibleResourceKey = key
        visibleResourceNodes = ExplorationVisibility.resources(chunks.flatMap { (x, y) -> resourceWorld.nodes(worldSeed, x, y) }, discoveredChunks)
            .map { resourceNodeChanges[it.id] ?: it }
            .filter { it.state != "depleted" && it.remaining > 0 }
            .filterNot { node ->
                val village = NativeNpcRules.villageCenter(worldSeed)
                hypot(node.x - village.x, node.y - village.y) < 5.25
            }
            .sortedBy { it.y }
    }

    private fun drawScene(canvas: Canvas) {
        updateVisibleResources()
        data class Layer(val y: Float, val kind: Int, val value: Any?)
        val bounds = camera.visibleWorldBounds()
        fun visible(x: Float, y: Float) = x >= bounds[0] - 128f && x <= bounds[2] + 128f && y >= bounds[1] - 128f && y <= bounds[3] + 128f
        val visibleEntities = ExplorationVisibility.entities(entities, discoveredChunks).filter {
            visible(it.coordinates.x * ChunkRenderer.WORLD_UNIT, it.coordinates.y * ChunkRenderer.WORLD_UNIT)
        }
        val groundEntities = visibleEntities.filter { it.type in setOf("road-segment", "rail-segment") }
        groundEntities.sortedWith(compareBy({ it.coordinates.y }, { it.coordinates.x })).forEach { drawEntity(canvas, it) }
        val raisedEntities = visibleEntities.filterNot { it.type in setOf("road-segment", "rail-segment") }
        val visibleGroundItems = ExplorationVisibility.groundItems(groundItems, discoveredChunks)
            .filter { visible((it.x * ChunkRenderer.WORLD_UNIT).toFloat(), (it.y * ChunkRenderer.WORLD_UNIT).toFloat()) }
        val wildlife = ambientWildlife()
        // Keep ambient life moving without scheduling one redraw per creature.
        // Android coalesces most invalidations, but dense visible chunks could still
        // generate unnecessary UI-thread work on lower-end phones.
        if (wildlife.isNotEmpty() && !player.isMoving) postInvalidateDelayed(80)
        val layers = ArrayList<Layer>(visibleResourceNodes.size + raisedEntities.size + visibleGroundItems.size + wildlife.size + 1)
        visibleResourceNodes.forEach { layers += Layer((it.y * ChunkRenderer.WORLD_UNIT).toFloat(), 0, it) }
        visibleGroundItems.forEach { layers += Layer((it.y * ChunkRenderer.WORLD_UNIT).toFloat(), 1, it) }
        wildlife.forEach { layers += Layer(it.y * ChunkRenderer.WORLD_UNIT, 2, it) }
        raisedEntities.forEach { layers += Layer(it.coordinates.y * ChunkRenderer.WORLD_UNIT, 3, it) }
        layers += Layer(player.position.y, 4, null)
        layers.sortWith(compareBy<Layer> { it.y }.thenBy { it.kind })
        layers.forEach { layer -> when (layer.kind) {
            0 -> drawResource(canvas, layer.value as ResourceNodeState)
            1 -> drawGroundItem(canvas, layer.value as GroundItem)
            2 -> drawWildlife(canvas, layer.value as AmbientAnimal)
            3 -> drawEntity(canvas, layer.value as Entity)
            else -> drawActors(canvas)
        } }
        drawPlacement(canvas)
    }

    private fun drawRevealFog(canvas: Canvas, nowNanos: Long) {
        if (revealingChunks.isEmpty()) return
        val size = WorldGenerator.CHUNK_SIZE * ChunkRenderer.WORLD_UNIT
        val fog = rasterAtlas.explorationFog()
        val iterator = revealingChunks.iterator()
        while (iterator.hasNext()) {
            val (id, startedAt) = iterator.next()
            val progress = ((nowNanos - startedAt) / 1_000_000_000f).coerceIn(0f, 1f)
            if (progress >= 1f) { iterator.remove(); continue }
            val alpha = ((1f - progress) * (1f - progress) * 255).toInt().coerceIn(0, 255)
            val parts = id.split(',')
            val chunkX = parts.getOrNull(0)?.toIntOrNull() ?: continue
            val chunkY = parts.getOrNull(1)?.toIntOrNull() ?: continue
            val left = chunkX * size; val top = chunkY * size
            paint.color = Color.rgb(7, 20, 22); paint.alpha = alpha
            canvas.drawRect(left, top, left + size, top + size, paint)
            if (fog != null) canvas.drawBitmap(fog, null, RectF(left, top, left + size, top + size), paint)
        }
        paint.alpha = 255
        if (revealingChunks.isNotEmpty()) postInvalidateOnAnimation()
    }

    private data class AmbientAnimal(val species: String, val x: Float, val y: Float, val scale: Float, val phase: Float)

    private fun ambientWildlife(): List<AmbientAnimal> {
        val bounds = camera.visibleWorldBounds()
        return WorldGenerator.visibleChunks(
            (bounds[0] / ChunkRenderer.WORLD_UNIT).toDouble(), (bounds[1] / ChunkRenderer.WORLD_UNIT).toDouble(),
            (bounds[2] / ChunkRenderer.WORLD_UNIT).toDouble(), (bounds[3] / ChunkRenderer.WORLD_UNIT).toDouble(), 0.5,
        ).filter { "${it.first},${it.second}" in discoveredChunks }.flatMap { (chunkX, chunkY) ->
            val hash = ("$worldSeed:$chunkX:$chunkY:wildlife".hashCode().toLong() and 0x7fffffff).toDouble() / Int.MAX_VALUE
            if (hash < .34) return@flatMap emptyList()
            val x = chunkX * WorldGenerator.CHUNK_SIZE + 2.5 + ((hash * 37) % 1.0) * 11.0
            val y = chunkY * WorldGenerator.CHUNK_SIZE + 2.5 + ((hash * 73) % 1.0) * 11.0
            val biome = WorldGenerator.sample(worldSeed, x, y).biome
            val species = when (biome) {
                "lagoon" -> listOf("reef-fish", "land-crab", "sea-turtle", "waterfowl", "reef-shark")
                "mangrove" -> listOf("mangrove-snake", "waterfowl", "land-crab")
                "cloud-forest" -> listOf("fruit-bat", "wild-boar", "island-lizard")
                "basalt-ridge", "limestone-upland" -> listOf("mountain-goat", "island-lizard", "seabird")
                "dry-savanna" -> listOf("wild-rabbit", "island-lizard", "wild-boar")
                else -> listOf("seabird", "wild-rabbit", "land-crab")
            }
            val firstIndex = (hash * species.size * 9).toInt().mod(species.size)
            buildList {
                add(AmbientAnimal(species[firstIndex], x.toFloat(), y.toFloat(), (.72 + hash * .35).toFloat(), (hash * 6.28).toFloat()))
                if (hash > .86) add(AmbientAnimal(
                    species[(firstIndex + 1).mod(species.size)],
                    (x + 1.7).toFloat(), (y - 1.2).toFloat(), (.62 + hash * .22).toFloat(), (hash * 11.3).toFloat(),
                ))
            }
        }
    }

    private fun drawWildlife(canvas: Canvas, animal: AmbientAnimal) {
        val texture = rasterAtlas.animal(animal.species, if ((minute / 10 + animal.x.toInt()).mod(4) == 0) "walk" else "idle") ?: return
        val clock = System.nanoTime() / 1_000_000_000.0
        val roaming = animal.species !in setOf("sea-turtle", "reef-shark")
        val x = animal.x * ChunkRenderer.WORLD_UNIT + if (roaming) sin(clock * .65 + animal.phase).toFloat() * 9f else 0f
        val y = animal.y * ChunkRenderer.WORLD_UNIT + sin(clock * .9 + animal.phase).toFloat() * 3f
        val size = (if (animal.species in setOf("wild-boar", "mountain-goat", "sea-turtle")) 82f else 58f) * animal.scale
        paint.color = Color.argb(28, 0, 0, 0)
        canvas.drawOval(x - size * .27f, y + size * .2f, x + size * .27f, y + size * .29f, paint)
        paint.alpha = 255
        canvas.drawBitmap(texture, null, RectF(x - size / 2, y - size * .72f, x + size / 2, y + size * .25f), paint)
    }

    private fun drawGroundItem(canvas: Canvas, item: GroundItem) {
        val family = itemAppearances[item.itemId]?.category ?: "resource"
        val texture = rasterAtlas.item(family, item.itemId)
            ?: rasterAtlas.item("resource", item.itemId)
            ?: rasterAtlas.item("material", item.itemId)
            ?: return
        val x = item.x.toFloat() * ChunkRenderer.WORLD_UNIT
        val y = item.y.toFloat() * ChunkRenderer.WORLD_UNIT
        paint.color = Color.argb(18, 0, 0, 0)
        canvas.drawOval(x - 14f, y + 13f, x + 14f, y + 19f, paint)
        paint.alpha = 255
        canvas.drawBitmap(texture, null, RectF(x - 27f, y - 34f, x + 27f, y + 20f), paint)
    }

    private fun drawResource(canvas: Canvas, node: ResourceNodeState) {
            val texture = (
                rasterAtlas.worldResource(node.resourceId)
                    ?: rasterAtlas.resource(node.resourceId, node.state)
                    ?: rasterAtlas.resource(node.resourceId)
                    ?: (if (node.resourceId == "magnetite-outcrop") rasterAtlas.item("material", "iron-ore") else null)
                    ?: rasterAtlas.item(node.category, node.itemId)
                    ?: rasterAtlas.item("resource", node.itemId)
                ) ?: return
            val x = node.x.toFloat() * ChunkRenderer.WORLD_UNIT
            val y = node.y.toFloat() * ChunkRenderer.WORLD_UNIT
            val size = when {
                node.resourceId.contains("tree") || node.resourceId.contains("palm") -> 148f
                node.resourceId.contains("grove") || node.resourceId.contains("thicket") || node.resourceId.contains("bush") -> 94f
                node.resourceId.contains("vein") || node.resourceId.contains("outcrop") -> 68f
                node.resourceId.contains("spring") -> 76f
                else -> 56f
            }
            val rooted = node.resourceId.contains("tree") || node.resourceId.contains("palm")
            paint.color = Color.argb(if (rooted) 38 else 16, 0, 0, 0)
            val shadowWidth = if (rooted) size * .24f else size * .2f
            canvas.drawOval(x - shadowWidth, y + size * .25f, x + shadowWidth, y + size * .32f, paint)
            paint.alpha = 255
            val hitProgress = resourceHitAnimations[node.id]?.let { started ->
                ((System.nanoTime() - started) / 360_000_000f).coerceIn(0f, 1f)
            }
            val kick = hitProgress?.let { sin(it * Math.PI).toFloat() } ?: 0f
            val bounds = RectF(x - size / 2, y - size * 0.72f, x + size / 2, y + size * 0.28f)
            canvas.save()
            canvas.rotate(kick * 3.4f, x, y)
            canvas.scale(1f + kick * .025f, 1f - kick * .018f, x, y)
            canvas.drawBitmap(texture, null, bounds, paint)
            canvas.restore()
            if (hitProgress != null) {
                if (hitProgress < 1f) postInvalidateOnAnimation() else resourceHitAnimations.remove(node.id)
            }
    }

    private fun reportNearbyResource() {
        val playerX = player.position.x / ChunkRenderer.WORLD_UNIT
        val playerY = player.position.y / ChunkRenderer.WORLD_UNIT
        val nearest = visibleResourceNodes.minByOrNull { hypot(it.x - playerX, it.y - playerY) }
            ?.takeIf { hypot(it.x - playerX, it.y - playerY) <= 2.5 }
        if (nearest?.id != reportedResourceId) {
            reportedResourceId = nearest?.id
            onNearbyResourceChanged?.invoke(nearest)
        }
    }

    private fun reportNearbyEntity() {
        val playerX = player.position.x / ChunkRenderer.WORLD_UNIT
        val playerY = player.position.y / ChunkRenderer.WORLD_UNIT
        val nearest = ExplorationVisibility.entities(entities, discoveredChunks)
            .mapNotNull { entity ->
                val distance = hypot((entity.coordinates.x - playerX).toDouble(), (entity.coordinates.y - playerY).toDouble())
                if (distance <= 3.2) entity to distance else null
            }
            .minWithOrNull(compareBy<Pair<Entity, Double>> { InteractionTargetRules.priority(it.first.type) }.thenBy { it.second })
            ?.first
        if (nearest?.id != reportedEntityId) {
            reportedEntityId = nearest?.id
            onNearbyEntityChanged?.invoke(nearest)
        }
    }

    private fun reportNearbyGroundItem() {
        val playerX = player.position.x / ChunkRenderer.WORLD_UNIT
        val playerY = player.position.y / ChunkRenderer.WORLD_UNIT
        val nearest = ExplorationVisibility.groundItems(groundItems, discoveredChunks)
            .minByOrNull { hypot(it.x - playerX, it.y - playerY) }
            ?.takeIf { hypot(it.x - playerX, it.y - playerY) <= 2.2 }
        if (nearest?.id != reportedGroundItemId) {
            reportedGroundItemId = nearest?.id
            onNearbyGroundItemChanged?.invoke(nearest)
        }
    }

    private fun drawTerrain(canvas: Canvas) {
        val bounds = camera.visibleWorldBounds()
        chunkRenderer.draw(canvas, worldSeed, bounds, discoveredChunks)
    }

    private fun withDiscoveredClip(canvas: Canvas): Int {
        val checkpoint = canvas.save()
        val discoveredPath = Path()
        discoveredChunks.forEach { key ->
            val parts = key.split(',')
            val chunkX = parts.getOrNull(0)?.toIntOrNull() ?: return@forEach
            val chunkY = parts.getOrNull(1)?.toIntOrNull() ?: return@forEach
            val left = chunkX * WorldGenerator.CHUNK_SIZE * ChunkRenderer.WORLD_UNIT
            val top = chunkY * WorldGenerator.CHUNK_SIZE * ChunkRenderer.WORLD_UNIT
            discoveredPath.addRect(
                left,
                top,
                left + WorldGenerator.CHUNK_SIZE * ChunkRenderer.WORLD_UNIT,
                top + WorldGenerator.CHUNK_SIZE * ChunkRenderer.WORLD_UNIT,
                Path.Direction.CW,
            )
        }
        canvas.clipPath(discoveredPath)
        return checkpoint
    }

    private fun drawVillageClearing(canvas: Canvas) {
        val center = NativeNpcRules.villageCenter(worldSeed)
        val villageChunk = "${floor(center.x.toDouble() / WorldGenerator.CHUNK_SIZE).toInt()},${floor(center.y.toDouble() / WorldGenerator.CHUNK_SIZE).toInt()}"
        if (villageChunk !in discoveredChunks) return
        val clipCheckpoint = withDiscoveredClip(canvas)
        val x = center.x * ChunkRenderer.WORLD_UNIT
        val y = center.y * ChunkRenderer.WORLD_UNIT
        paint.color = Color.argb(34, 121, 91, 57)
        canvas.drawOval(x - 228f, y - 166f, x + 216f, y + 158f, paint)
        paint.color = Color.argb(24, 158, 123, 76)
        canvas.drawOval(x - 172f, y - 118f, x + 196f, y + 132f, paint)
        paint.color = Color.argb(115, 88, 68, 45)
        repeat(28) { index ->
            val seed = ("$worldSeed:village-road:$index".hashCode() and 0x7fffffff)
            val px = x + (seed % 420 - 210)
            val py = y + ((seed / 431) % 286 - 143)
            canvas.drawOval(px - 2.5f, py - 1.5f, px + 3.5f, py + 2.5f, paint)
        }
        canvas.restoreToCount(clipCheckpoint)
    }

    private fun drawWandererOutposts(canvas: Canvas) {
        NativeNpcRules.outpostCenters(worldSeed).forEach { center ->
            val chunk = "${floor(center.x.toDouble() / WorldGenerator.CHUNK_SIZE).toInt()},${floor(center.y.toDouble() / WorldGenerator.CHUNK_SIZE).toInt()}"
            if (chunk !in discoveredChunks) return@forEach
            val x = center.x * ChunkRenderer.WORLD_UNIT
            val y = center.y * ChunkRenderer.WORLD_UNIT
            paint.color = Color.argb(42, 155, 119, 70)
            canvas.drawOval(x - 150f, y - 104f, x + 148f, y + 105f, paint)
            paint.color = Color.argb(40, 69, 52, 35)
            repeat(13) { index ->
                val hash = ("$worldSeed:${center.x}:${center.y}:outpost:$index".hashCode() and 0x7fffffff)
                val px = x + (hash % 240 - 120); val py = y + ((hash / 241) % 154 - 77)
                canvas.drawOval(px - 3f, py - 2f, px + 4f, py + 3f, paint)
            }
        }
    }

    private fun drawEntity(canvas: Canvas, entity: Entity) {
            var x = entity.coordinates.x * ChunkRenderer.WORLD_UNIT
            var y = entity.coordinates.y * ChunkRenderer.WORLD_UNIT
            var npcWalking = false
            if (NativeNpcRules.isVillager(entity.type) || entity.type == "minecart") {
                npcTransitions[entity.id]?.let { transition ->
                    val duration = if (entity.type == "minecart") 520_000_000f else 1_100_000_000f
                    val raw = ((System.nanoTime() - transition.startedNanos) / duration).coerceIn(0f, 1f)
                    val eased = raw * raw * (3f - 2f * raw)
                    x = transition.fromX + (transition.toX - transition.fromX) * eased
                    y = transition.fromY + (transition.toY - transition.fromY) * eased
                    npcWalking = raw < 1f
                    if (npcWalking) postInvalidateOnAnimation() else npcTransitions.remove(entity.id)
                }
            }
            if (entity.type == "road-segment") {
                val road = roadVisual(entity)
                val bounds = RectF(x - 24f, y - 24f, x + 24f, y + 24f)
                val texture = if (road.texture == "road-crossing") null else rasterAtlas.transportV7(road.texture)
                val crossing = if (road.texture == "road-crossing") listOfNotNull(
                    rasterAtlas.transportV7("road-straight-ew"), rasterAtlas.transportV7("road-straight-ns"),
                ) else emptyList()
                if (texture != null || crossing.size == 2) {
                    canvas.save(); canvas.rotate(entity.rotation.toFloat() + road.rotation, x, y)
                    if (crossing.size == 2) crossing.forEach { canvas.drawBitmap(it, null, bounds, paint) }
                    else canvas.drawBitmap(texture!!, null, bounds, paint)
                    canvas.restore()
                } else {
                    val fallback = rasterAtlas.transport("road-worn") ?: rasterAtlas.groundDetail("worn-path")
                    if (fallback != null) canvas.drawBitmap(fallback, null, bounds, paint)
                    else { paint.color = Color.argb(170, 143, 106, 63); canvas.drawOval(bounds, paint) }
                }
                return
            }
            if (entity.type == "rail-segment" || entity.type == "minecart") {
                val rail = if (entity.type == "rail-segment") railVisual(entity) else RailVisual("minecart-empty", 0f)
                val texture = rasterAtlas.transportV7(rail.texture) ?: rasterAtlas.transport(rail.texture)
                // Rail art includes a transparent rim. An 8 px overlap hides hairline
                // seams without changing the 48 px logical grid used by movement.
                val bounds = if (entity.type == "minecart") RectF(x - 23f, y - 15f, x + 23f, y + 15f) else RectF(x - 28f, y - 28f, x + 28f, y + 28f)
                if (texture != null) {
                    canvas.save(); canvas.rotate(entity.rotation.toFloat() + rail.rotation, x, y); canvas.drawBitmap(texture, null, bounds, paint); canvas.restore()
                }
                if (entity.type == "minecart" && npcWalking) postInvalidateOnAnimation()
                return
            }
            if (entity.type == "rowboat") {
                val aboard = aboardBoatId == entity.id
                val texture = rasterAtlas.rowboat(aboard)
                val bounds = RectF(x - 64f, y - 33f, x + 64f, y + 33f)
                paint.color = Color.argb(26, 0, 0, 0)
                canvas.drawOval(x - 43f, y + 20f, x + 43f, y + 27f, paint)
                if (texture != null) canvas.drawBitmap(texture, null, bounds, paint)
                return
            }
            if (NativeNpcRules.isVillager(entity.type)) {
                val injuredAtuo = entity.id == NativeNpcRules.BUILDER_ID && entity.durability < entity.maxDurability
                val character = when (entity.type) {
                    NativeNpcRules.TRADER_TYPE -> "lanshang"
                    NativeNpcRules.FARMER_TYPE -> "heyi"
                    NativeNpcRules.WANDERER_TYPE -> "wanderer"
                    else -> "atuo"
                }
                val animationTick = ((System.nanoTime() / 180_000_000L) + entity.id.hashCode()).mod(2)
                val state = when {
                    npcWalking -> if (animationTick == 0) "walk-01" else "walk-02"
                    reportedEntityId == entity.id -> "talk"
                    else -> "idle"
                }
                val texture = rasterAtlas.survivor(character, state) ?: rasterAtlas.villager("idle-south-01")
                val profile = when (entity.type) {
                    NativeNpcRules.TRADER_TYPE -> 1.05f to 1.04f
                    NativeNpcRules.FARMER_TYPE -> .98f to 1.0f
                    NativeNpcRules.WANDERER_TYPE -> 1.08f to 1.06f
                    else -> if (injuredAtuo) .91f to .88f else .96f to .98f
                }
                val idlePhase = (System.nanoTime() / 1_000_000_000.0 + (entity.id.hashCode() and 31) * .17)
                val bob = if (npcWalking) sin(idlePhase * 8.0).toFloat() * 2.2f else sin(idlePhase * 1.8).toFloat() * .8f
                paint.color = Color.argb(30, 0, 0, 0)
                canvas.drawOval(x - 19f, y + 25f, x + 19f, y + 32f, paint)
                if (texture != null) {
                    paint.alpha = 255
                    paint.colorFilter = null
                    val halfWidth = 50f * profile.first
                    val height = 150f * profile.second
                    canvas.save()
                    val injuryLean = if (injuredAtuo && !npcWalking) -7f else 0f
                    canvas.rotate(injuryLean + if (npcWalking) sin(idlePhase * 5.0).toFloat() * 1.3f else 0f, x, y)
                    canvas.drawBitmap(texture, null, RectF(x - halfWidth, y - height + 28f + bob, x + halfWidth, y + 28f + bob), paint)
                    canvas.restore()
                }
                val badgeColor = when (entity.type) {
                    NativeNpcRules.TRADER_TYPE -> Color.rgb(55, 118, 143)
                    NativeNpcRules.FARMER_TYPE -> Color.rgb(82, 126, 69)
                    NativeNpcRules.WANDERER_TYPE -> Color.rgb(75, 85, 96)
                    else -> Color.rgb(151, 91, 47)
                }
                paint.color = Color.argb(220, Color.red(badgeColor), Color.green(badgeColor), Color.blue(badgeColor))
                val badgeHalfWidth = if (injuredAtuo) 57f else 44f
                canvas.drawRoundRect(x - badgeHalfWidth, y - 143f, x + badgeHalfWidth, y - 117f, 9f, 9f, paint)
                paint.color = Color.WHITE
                paint.textAlign = Paint.Align.CENTER
                paint.textSize = 17f
                paint.isFakeBoldText = true
                canvas.drawText(if (injuredAtuo) "阿拓 · 受伤" else NativeNpcRules.name(entity), x, y - 124f, paint)
                paint.isFakeBoldText = false
                paint.textAlign = Paint.Align.LEFT
                return
            }
            val bounds = buildingBounds(entity.type, x, y)
            paint.color = Color.argb(28, 0, 0, 0)
            canvas.drawOval(bounds.left + bounds.width() * 0.25f, y + bounds.height() * 0.17f, bounds.right - bounds.width() * 0.25f, y + bounds.height() * 0.23f, paint)
            val texture = rasterAtlas.building(entity.type) ?: atlas.entity(entity.type)
            if (texture != null) {
                paint.alpha = 255
                canvas.save()
                canvas.rotate(entity.rotation.toFloat(), x, y)
                canvas.drawBitmap(texture, null, bounds, paint)
                canvas.restore()
            } else {
                paint.color = Color.rgb(117, 80, 46)
                canvas.drawRoundRect(x - 22, y - 20, x + 22, y + 20, 6f, 6f, paint)
            }
    }

    private data class RailVisual(val texture: String, val rotation: Float)

    private fun directions(entity: Entity, cells: Set<Pair<Int, Int>>): List<String> {
        val x = entity.coordinates.x; val y = entity.coordinates.y
        return listOf("e" to (x + 1 to y), "s" to (x to y + 1), "w" to (x - 1 to y), "n" to (x to y - 1))
            .filter { it.second in cells }.map { it.first }
    }

    private fun railVisual(entity: Entity): RailVisual {
        val neighbors = directions(entity, railCells)
        return when {
            neighbors.size == 4 -> RailVisual("rail-crossing", 0f)
            neighbors.size == 3 -> {
                val missing = listOf("n", "e", "s", "w").first { it !in neighbors }
                RailVisual("rail-junction-t", mapOf("n" to 0f, "e" to 90f, "s" to 180f, "w" to 270f).getValue(missing))
            }
            neighbors.size == 2 && neighbors.containsAll(listOf("e", "w")) -> RailVisual("rail-straight-ew", 0f)
            neighbors.size == 2 && neighbors.containsAll(listOf("n", "s")) -> RailVisual("rail-straight-ns", 0f)
            neighbors.size == 2 -> {
                val key = neighbors.sorted().joinToString("")
                RailVisual("rail-curve-ne", mapOf("es" to 0f, "sw" to 90f, "nw" to 180f, "en" to 270f)[key] ?: 0f)
            }
            else -> {
                val vertical = neighbors.firstOrNull() in setOf("n", "s")
                RailVisual(if (vertical) "rail-straight-ns" else "rail-straight-ew", 0f)
            }
        }
    }

    private fun roadVisual(entity: Entity): RailVisual {
        val visibleCells = roadCells.filterTo(mutableSetOf()) { (x, y) -> ExplorationVisibility.contains(cn.zhengzhengstudio.survivaldiary.domain.Coordinates(x, y), discoveredChunks) }
        val neighbors = directions(entity, visibleCells)
        if (neighbors.size == 4) return RailVisual("road-crossing", 0f)
        if (neighbors.size >= 3) {
            val missing = listOf("n", "e", "s", "w").firstOrNull { it !in neighbors } ?: "n"
            return RailVisual("road-junction-t", mapOf("n" to 0f, "e" to 90f, "s" to 180f, "w" to 270f).getValue(missing))
        }
        if (neighbors.size == 2 && !(neighbors.containsAll(listOf("e", "w")) || neighbors.containsAll(listOf("n", "s")))) {
            val key = neighbors.sorted().joinToString("")
            return RailVisual("road-curve-es", mapOf("es" to 0f, "sw" to 90f, "nw" to 180f, "en" to 270f)[key] ?: 0f)
        }
        val vertical = neighbors.any { it == "n" || it == "s" } && neighbors.none { it == "e" || it == "w" }
        return RailVisual(if (vertical) "road-straight-ns" else "road-straight-ew", 0f)
    }

    private fun drawPlacement(canvas: Canvas) {
        placementType?.let { type ->
            val coordinates = placementCoordinates ?: return@let
            val x = coordinates.x * ChunkRenderer.WORLD_UNIT
            val y = coordinates.y * ChunkRenderer.WORLD_UNIT
            val texture = when (type) {
                "road-segment" -> rasterAtlas.transportV7("road-straight-ew") ?: rasterAtlas.transport("road-worn") ?: rasterAtlas.groundDetail("worn-path")
                "rail-segment" -> rasterAtlas.transportV7("rail-straight-ew") ?: rasterAtlas.transport("rail-straight-ew")
                else -> rasterAtlas.building(type) ?: atlas.entity(type)
            }
            paint.alpha = 150
            val bounds = buildingBounds(type, x, y)
            if (texture != null) canvas.drawBitmap(texture, null, bounds, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 4f
            paint.color = if (placementValid) Color.rgb(83, 220, 133) else Color.rgb(225, 75, 63)
            canvas.drawRoundRect(bounds, 10f, 10f, paint)
            paint.style = Paint.Style.FILL
            paint.alpha = 255
        }
    }

    private fun buildingBounds(type: String, x: Float, y: Float): RectF {
        val (width, height) = BuildingMetrics.renderSize(buildingAppearances[type])
        return RectF(x - width / 2f, y - height * 0.78f, x + width / 2f, y + height * 0.22f)
    }

    private fun drawActors(canvas: Canvas) {
        val playerTexture = atlas.player()
        val x = player.position.x
        val walkPhase = (System.nanoTime() / 75_000_000L % 12).toFloat() / 12f * (Math.PI * 2).toFloat()
        val ridingMinecart = aboardMinecartId != null
        val bob = if (ridingMinecart) 0f else if (player.isMoving) sin(walkPhase) * 5f else sin(walkPhase * .25f) * 1.2f
        val y = player.position.y + bob
        if (!ridingMinecart) {
            paint.color = Color.argb(38, 0, 0, 0)
            canvas.drawOval(x - 25f, y + 28f, x + 25f, y + 36f, paint)
        }
        if (playerTexture == null) {
            // The player must remain locatable while the sprite sheet is decoded.
            paint.color = Color.rgb(220, 174, 95)
            canvas.drawCircle(x, y - 54f, 18f, paint)
            paint.color = Color.rgb(121, 66, 38)
            canvas.drawRoundRect(x - 24f, y - 36f, x + 24f, y + 25f, 10f, 10f, paint)
            return
        }
        val columns = 8
        val rows = 2
        val cellWidth = playerTexture.width / columns
        val cellHeight = playerTexture.height / rows
        val row = if (player.isMoving) 1 else 0
        val sourceLeft = player.direction.coerceIn(0, columns - 1) * cellWidth
        val sourceTop = row * cellHeight
        val lean = if (player.isMoving) sin(walkPhase) * 2.6f else 0f
        paint.alpha = 255
        canvas.save()
        canvas.rotate(lean, x, y)
        canvas.drawBitmap(
            playerTexture,
            Rect(sourceLeft, sourceTop, sourceLeft + cellWidth, sourceTop + cellHeight),
            if (ridingMinecart) RectF(x - 34f, y - 73f, x + 34f, y + 21f) else RectF(x - 48f, y - 108f, x + 48f, y + 38f),
            paint,
        )
        canvas.restore()
        if (player.isMoving) postInvalidateOnAnimation()
    }

    private fun drawWeather(canvas: Canvas) {
        lightWeatherRenderer.drawWorldWeather(canvas, weatherKind, weatherIntensity, camera.zoom)
    }

    private fun drawAtmosphere(canvas: Canvas) {
        lightWeatherRenderer.drawAtmosphere(canvas, minute, width, height)
    }

    fun updateWorld(
        newSeed: String,
        newDiscoveredChunks: Set<String>,
        newResourceNodeChanges: Map<String, ResourceNodeState>,
        newEntities: Collection<Entity>,
        newGroundItems: Collection<GroundItem>,
        newWeatherKind: String,
        newWeatherIntensity: Double,
        newMinute: Int,
        newPlacementType: String?,
        newPlacementValid: Boolean,
        newPlacementCoordinates: cn.zhengzhengstudio.survivaldiary.domain.Coordinates?,
        savedPlayerPosition: PlayerPosition?,
        newAboardBoatId: String?,
        newAboardMinecartId: String?,
    ) {
        var needsRedraw = false
        if (newSeed != worldSeed) {
            val restored = savedPlayerPosition?.let {
                WorldPoint(
                    (it.x * ChunkRenderer.WORLD_UNIT).toFloat(),
                    (it.y * ChunkRenderer.WORLD_UNIT).toFloat(),
                )
            } ?: WorldPoint(8f * ChunkRenderer.WORLD_UNIT, 8f * ChunkRenderer.WORLD_UNIT)
            player.position = WorldNavigation.nearestWalkable(newSeed, restored, newEntities)
            camera.centerOn(player.position)
            val chunkX = floor(player.position.x / ChunkRenderer.WORLD_UNIT / WorldGenerator.CHUNK_SIZE).toInt()
            val chunkY = floor(player.position.y / ChunkRenderer.WORLD_UNIT / WorldGenerator.CHUNK_SIZE).toInt()
            reportedChunk = chunkX to chunkY
            reportedPosition = savedPlayerPosition
            onPlayerChunkChanged?.invoke(chunkX, chunkY)
            needsRedraw = true
        }
        if (worldSeed != newSeed) worldSeed = newSeed
        if (discoveredChunks != newDiscoveredChunks) discoveredChunks = newDiscoveredChunks
        if (resourceNodeChanges != newResourceNodeChanges) {
            newResourceNodeChanges.forEach { (id, next) ->
                val previous = resourceNodeChanges[id] ?: visibleResourceNodes.firstOrNull { it.id == id }
                if (previous != null && next.remaining < previous.remaining) {
                    resourceHitAnimations[id] = System.nanoTime()
                    playSoundEffect(SoundEffectConstants.CLICK)
                }
            }
            resourceNodeChanges = newResourceNodeChanges
            visibleResourceKey = ""
            needsRedraw = true
        }
        if (entities != newEntities) entities = newEntities
        if (groundItems != newGroundItems) groundItems = newGroundItems
        if (weatherKind != newWeatherKind) { weatherKind = newWeatherKind; needsRedraw = true }
        if (weatherIntensity != newWeatherIntensity) { weatherIntensity = newWeatherIntensity; needsRedraw = true }
        if (minute != newMinute) {
            // The clock text is Compose UI and can update every tick. Repainting
            // the complete native island for sub-visible daylight changes caused
            // avoidable allocations and frame drops on low-end GPUs.
            val lightingChanged = minute / 5 != newMinute / 5
            minute = newMinute
            if (lightingChanged) needsRedraw = true
        }
        if (placementType != newPlacementType) { placementType = newPlacementType; needsRedraw = true }
        if (placementValid != newPlacementValid) { placementValid = newPlacementValid; needsRedraw = true }
        if (placementCoordinates != newPlacementCoordinates) { placementCoordinates = newPlacementCoordinates; needsRedraw = true }
        if (aboardBoatId != newAboardBoatId) { aboardBoatId = newAboardBoatId; needsRedraw = true }
        val minecartOccupancyChanged = aboardMinecartId != newAboardMinecartId
        if (minecartOccupancyChanged) aboardMinecartId = newAboardMinecartId
        val transportTarget = if (newAboardMinecartId != null) {
            newEntities.firstOrNull { it.id == newAboardMinecartId }?.coordinates?.let {
                WorldPoint(it.x * ChunkRenderer.WORLD_UNIT, it.y * ChunkRenderer.WORLD_UNIT)
            }
        } else if (minecartOccupancyChanged) {
            savedPlayerPosition?.let { WorldPoint((it.x * ChunkRenderer.WORLD_UNIT).toFloat(), (it.y * ChunkRenderer.WORLD_UNIT).toFloat()) }
        } else null
        if (transportTarget != null && hypot(transportTarget.x - player.position.x, transportTarget.y - player.position.y) > 0.5f) {
            player.moveTo(transportTarget)
            reportMovement(true)
            if (newAboardMinecartId != null) playSoundEffect(SoundEffectConstants.NAVIGATION_RIGHT)
            needsRedraw = true
        }
        if (needsRedraw) invalidate()
    }

    fun updateContent(
        buildings: Map<String, BuildingAppearance>,
        items: Map<String, ItemAppearance>,
        resources: Map<String, ResourceDefinition>,
        spawns: Map<String, List<SpawnRule>>,
    ) {
        if (buildings === buildingAppearances && items === itemAppearances &&
            resources === resourceDefinitions && spawns === biomeSpawnRules
        ) return
        buildingAppearances = buildings
        itemAppearances = items
        resourceDefinitions = resources
        biomeSpawnRules = spawns
        resourceWorld = ResourceWorld(resources, spawns, items)
        visibleResourceKey = ""
        invalidate()
    }

    fun centerOnPlayer() { cameraFollow.onCenterPlayer(); camera.centerOn(player.position); invalidate() }

    private fun reportPlayerPosition(nowNanos: Long, force: Boolean = false) {
        // Persisting and feeding Compose on every rendered frame made walking
        // noticeably stutter on low-end phones. Keep the final position exact,
        // but limit intermediate UI/save updates to four times per second.
        if (!force && nowNanos - lastPositionReportNanos < 250_000_000L) return
        val x = (player.position.x / ChunkRenderer.WORLD_UNIT).toDouble()
        val y = (player.position.y / ChunkRenderer.WORLD_UNIT).toDouble()
        val previous = reportedPosition
        if (previous?.x == x && previous.y == y) return
        val position = PlayerPosition(x, y)
        reportedPosition = position
        lastPositionReportNanos = nowNanos
        onPlayerPositionChanged?.invoke(position)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    override fun onDetachedFromWindow() {
        player.stop()
        reportMovement(false)
        chunkRenderer.close()
        rasterAtlas.close()
        atlas.clear()
        super.onDetachedFromWindow()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = event.x; lastY = event.y; downX = event.x; downY = event.y; dragged = false
                return true
            }
            MotionEvent.ACTION_MOVE -> if (!scaleDetector.isInProgress && event.pointerCount == 1) {
                if (kotlin.math.hypot(event.x - downX, event.y - downY) > touchSlop) dragged = true
                if (dragged) cameraFollow.onManualPan()
                camera.panBy(event.x - lastX, event.y - lastY); lastX = event.x; lastY = event.y; invalidate()
            }
            MotionEvent.ACTION_UP -> if (!dragged && !scaleDetector.isInProgress) {
                performClick()
                val world = camera.screenToWorld(WorldPoint(event.x, event.y))
                if (placementType != null) {
                    playSoundEffect(SoundEffectConstants.CLICK)
                    onPlacementRequested?.invoke(cn.zhengzhengstudio.survivaldiary.domain.Coordinates(
                        kotlin.math.round(world.x / ChunkRenderer.WORLD_UNIT).toInt(),
                        kotlin.math.round(world.y / ChunkRenderer.WORLD_UNIT).toInt(),
                    ))
                } else {
                    // NPC art is much taller than its foot point. Hit-test the
                    // visible body, so tapping a face or torso opens dialogue
                    // instead of sending the player walking behind the NPC.
                    val tappedEntity = ExplorationVisibility.entities(entities, discoveredChunks)
                        .filter { NativeNpcRules.isVillager(it.type) }
                        .filter {
                            val footX = it.coordinates.x * ChunkRenderer.WORLD_UNIT
                            val footY = it.coordinates.y * ChunkRenderer.WORLD_UNIT
                            world.x >= footX - ChunkRenderer.WORLD_UNIT * 1.15f &&
                                world.x <= footX + ChunkRenderer.WORLD_UNIT * 1.15f &&
                                world.y >= footY - ChunkRenderer.WORLD_UNIT * 3.25f &&
                                world.y <= footY + ChunkRenderer.WORLD_UNIT * .8f
                        }
                        .minByOrNull {
                            hypot(
                                (it.coordinates.x * ChunkRenderer.WORLD_UNIT - world.x).toDouble(),
                                (it.coordinates.y * ChunkRenderer.WORLD_UNIT - world.y).toDouble(),
                            )
                        }
                    if (tappedEntity != null) {
                        playSoundEffect(SoundEffectConstants.CLICK)
                        onEntityTapped?.invoke(tappedEntity)
                    } else if (aboardMinecartId != null) {
                        // A boarded player moves with the cart. Free walking here
                        // would visually detach the actor while the save still
                        // records them as riding; use the drive/disembark HUD actions.
                        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    } else if (player.moveTo(world) { point ->
                        WorldNavigation.isWalkable(
                            worldSeed,
                            point,
                            ExplorationVisibility.entities(entities, discoveredChunks),
                            visibleResourceNodes,
                        )
                    }) {
                        playSoundEffect(SoundEffectConstants.NAVIGATION_RIGHT)
                        reportMovement(true)
                        postInvalidateOnAnimation()
                    } else {
                        onMovementBlocked?.invoke()
                    }
                }
            }
        }
        return true
    }
}
