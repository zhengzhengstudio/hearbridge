package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.GameSave
import cn.zhengzhengstudio.survivaldiary.domain.BiomePresentation
import cn.zhengzhengstudio.survivaldiary.domain.DiscoveredChunk
import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import cn.zhengzhengstudio.survivaldiary.domain.NativeNpcRules
import kotlin.math.floor
import kotlin.math.max

internal data class MapWindow(val radius: Int, val cells: List<DiscoveredChunk>)

internal fun mapWindow(player: DiscoveredChunk, discovered: Collection<DiscoveredChunk>): MapWindow {
    val furthest = discovered.maxOfOrNull { max(kotlin.math.abs(it.x - player.x), kotlin.math.abs(it.y - player.y)) } ?: 1
    val radius = furthest.coerceIn(2, 4)
    return MapWindow(radius, (-radius..radius).flatMap { y ->
        (-radius..radius).map { x -> DiscoveredChunk(player.x + x, player.y + y) }
    })
}

internal fun mapBiomeHint(biome: String): String = when (biome) {
    "lagoon", "deep-water" -> "浅滩、海藻与水生资源"
    "mangrove" -> "红树林、藤蔓与潮间资源"
    "basalt-ridge", "limestone-upland" -> "岩层、矿脉与高地通道"
    "cloud-forest" -> "密林、药草与野生动物"
    "dry-savanna" -> "旱草、动物与开阔营地"
    "palm-grove" -> "椰林、纤维与可食资源"
    else -> "海岸材料与漂流物"
}

@Composable
fun MapScreen(save: GameSave, openCompendium: () -> Unit, close: () -> Unit) {
    GamePanelSurface("岛屿地图", "以当前位置为中心 · 点按已探索区域查看详情", close) {
        val player = (save.players["local"] ?: save.players.values.firstOrNull())?.position
            ?: cn.zhengzhengstudio.survivaldiary.domain.PlayerPosition(8.0, 8.0)
        val playerChunk = cn.zhengzhengstudio.survivaldiary.domain.DiscoveredChunk(
            floor(player.x / WorldGenerator.CHUNK_SIZE).toInt(),
            floor(player.y / WorldGenerator.CHUNK_SIZE).toInt(),
        )
        // Position updates and discovery persistence arrive on separate frames. Always include
        // the live player chunk so opening the map while walking never snaps the marker home.
        val chunks = (save.discoveredChunks.values + playerChunk).distinctBy { it.x to it.y }
        val discoveredIds = chunks.mapTo(linkedSetOf()) { "${it.x},${it.y}" }
        val window = mapWindow(playerChunk, chunks)
        var selected by remember(playerChunk, discoveredIds) { mutableStateOf(playerChunk) }
        val selectedId = "${selected.x},${selected.y}"
        val selectedKnown = selectedId in discoveredIds
        val selectedSample = WorldGenerator.sample(save.seed, selected.x * 16.0 + 8.0, selected.y * 16.0 + 8.0)
        val selectedResources = save.resourceNodes.values.count {
            it.remaining > 0 && floor(it.x / WorldGenerator.CHUNK_SIZE).toInt() == selected.x && floor(it.y / WorldGenerator.CHUNK_SIZE).toInt() == selected.y
        }
        val selectedBuildings = save.entities.values.count {
            it.type !in setOf("road-segment", "rail-segment") &&
            floor(it.coordinates.x.toDouble() / WorldGenerator.CHUNK_SIZE).toInt() == selected.x && floor(it.coordinates.y.toDouble() / WorldGenerator.CHUNK_SIZE).toInt() == selected.y
        }
        val village = NativeNpcRules.villageCenter(save.seed)
        val villageChunk = DiscoveredChunk(floor(village.x.toDouble() / WorldGenerator.CHUNK_SIZE).toInt(), floor(village.y.toDouble() / WorldGenerator.CHUNK_SIZE).toInt())
        val outposts = NativeNpcRules.outpostCenters(save.seed)
        val outpostChunks = outposts.associateWith {
            DiscoveredChunk(floor(it.x.toDouble() / WorldGenerator.CHUNK_SIZE).toInt(), floor(it.y.toDouble() / WorldGenerator.CHUNK_SIZE).toInt())
        }
        val visibleRoads = save.entities.values.filter { entity ->
            entity.type == "road-segment" && "${floor(entity.coordinates.x.toDouble() / WorldGenerator.CHUNK_SIZE).toInt()},${floor(entity.coordinates.y.toDouble() / WorldGenerator.CHUNK_SIZE).toInt()}" in discoveredIds
        }.mapTo(linkedSetOf()) { it.coordinates }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("● 你  ◇ 营地  ◆ 村庄  ▲ 基地", color = Color(0xFFE4C37E), fontWeight = FontWeight.Bold)
            Text("已探索 ${discoveredIds.size}", color = Color(0xFFA9C9A8))
        }

        Canvas(
            Modifier.fillMaxWidth().weight(1f).padding(vertical = 3.dp)
                .background(Color(0xFF0C3035), RoundedCornerShape(14.dp))
                .border(1.dp, Color(0xFF77623E), RoundedCornerShape(14.dp))
                .pointerInput(window, discoveredIds) {
                    detectTapGestures { tap ->
                        val side = window.radius * 2 + 1
                        val cell = minOf(size.width * .90f / side, size.height * .90f / side)
                        val originX = (size.width - side * cell) / 2f
                        val originY = (size.height - side * cell) / 2f
                        val column = floor((tap.x - originX) / cell).toInt()
                        val row = floor((tap.y - originY) / cell).toInt()
                        if (column in 0 until side && row in 0 until side) {
                            selected = DiscoveredChunk(playerChunk.x + column - window.radius, playerChunk.y + row - window.radius)
                        }
                    }
                },
        ) {
            val side = window.radius * 2 + 1
            val cell = minOf(size.width * .90f / side, size.height * .90f / side)
            val mapWidth = side * cell; val mapHeight = side * cell
            val origin = Offset((size.width - mapWidth) / 2, (size.height - mapHeight) / 2)
            repeat(7) { line ->
                val y = size.height * (.12f + line * .125f)
                val inset = if (line % 2 == 0) 18f else 42f
                drawLine(Color(0x223D7780), Offset(inset, y), Offset(size.width - inset * .7f, y + cell * .08f), 1.5f, cap = StrokeCap.Round)
            }
            val frontierIds = chunks.flatMap { chunk -> listOf(
                "${chunk.x - 1},${chunk.y}", "${chunk.x + 1},${chunk.y}",
                "${chunk.x},${chunk.y - 1}", "${chunk.x},${chunk.y + 1}",
            ) }.filterTo(linkedSetOf()) { it !in discoveredIds }

            window.cells.forEach { chunk ->
                val id = "${chunk.x},${chunk.y}"
                val x = origin.x + (chunk.x - playerChunk.x + window.radius) * cell
                val y = origin.y + (chunk.y - playerChunk.y + window.radius) * cell
                if (id in discoveredIds) {
                    val centerSample = WorldGenerator.sample(save.seed, chunk.x * 16.0 + 8.0, chunk.y * 16.0 + 8.0)
                    drawRoundRect(
                        Color(BiomePresentation.mapColor(centerSample.biome)).copy(alpha = .96f),
                        Offset(x - 1.4f, y - 1.4f), Size(cell + 2.8f, cell + 2.8f),
                        androidx.compose.ui.geometry.CornerRadius(cell * .20f),
                    )
                    repeat(6) { blob ->
                        val hash = (id.hashCode() * 31 + blob * 131) and 0x7fffffff
                        val localX = 2.0 + (hash % 1200) / 100.0
                        val localY = 2.0 + ((hash / 1201) % 1200) / 100.0
                        val sample = WorldGenerator.sample(save.seed, chunk.x * 16.0 + localX, chunk.y * 16.0 + localY)
                        drawCircle(
                            Color(BiomePresentation.mapColor(sample.biome)).copy(alpha = .36f),
                            cell * (.22f + (hash % 7) * .015f),
                            Offset(x + cell * (.14f + (hash % 70) / 100f), y + cell * (.14f + ((hash / 71) % 70) / 100f)),
                        )
                    }
                } else if (id in frontierIds) {
                    val cloud = Color(0xFF72A5A0)
                    repeat(8) { puff ->
                        val hash = (id.hashCode() * 31 + puff * 97) and 0x7fffffff
                        drawCircle(
                            cloud.copy(alpha = .15f + (hash % 5) * .055f),
                            cell * (.16f + (hash % 7) * .018f),
                            Offset(x + cell * (.10f + (hash % 80) / 100f), y + cell * (.12f + ((hash / 83) % 76) / 100f)),
                        )
                    }
                }
                if (id == selectedId) drawRoundRect(Color(0xFFFFD253), Offset(x + 1.5f, y + 1.5f), Size(cell - 3f, cell - 3f), androidx.compose.ui.geometry.CornerRadius(cell * .12f), style = Stroke(3f))
            }
            fun marker(worldX: Double, worldY: Double): Offset {
                val chunkX = floor(worldX / WorldGenerator.CHUNK_SIZE).toInt()
                val chunkY = floor(worldY / WorldGenerator.CHUNK_SIZE).toInt()
                val localX = ((worldX / WorldGenerator.CHUNK_SIZE) - chunkX).toFloat()
                val localY = ((worldY / WorldGenerator.CHUNK_SIZE) - chunkY).toFloat()
                return origin + Offset((chunkX - playerChunk.x + window.radius + localX) * cell, (chunkY - playerChunk.y + window.radius + localY) * cell)
            }
            visibleRoads.forEach { road ->
                val from = marker(road.x + .5, road.y + .5)
                listOf(1 to 0, 0 to 1).forEach { (dx, dy) ->
                    val neighbour = cn.zhengzhengstudio.survivaldiary.domain.Coordinates(road.x + dx, road.y + dy)
                    if (neighbour in visibleRoads) drawLine(Color(0xFFB89058), from, marker(neighbour.x + .5, neighbour.y + .5), (cell / 16f).coerceIn(1.5f, 4f), cap = StrokeCap.Round)
                }
            }
            if ("0,0" in discoveredIds) {
                val home = marker(8.0, 8.0)
                drawCircle(Color(0xFFE8E0C6), radius = 6f, center = home, style = Stroke(width = 2.5f))
            }
            if ("${villageChunk.x},${villageChunk.y}" in discoveredIds) {
                val point = marker(village.x.toDouble(), village.y.toDouble())
                val villageScale = (cell / 44f).coerceIn(.65f, 1.25f)
                drawLine(Color(0xFFC89A5D), point - Offset(13f * villageScale, 0f), point + Offset(13f * villageScale, 0f), 4f * villageScale, cap = StrokeCap.Round)
                drawLine(Color(0xFFB98955), point - Offset(2f, 12f * villageScale), point + Offset(2f, 12f * villageScale), 3f * villageScale, cap = StrokeCap.Round)
                drawRect(Color(0xFFE8943A), point - Offset(10f, 10f) * villageScale, Size(7f * villageScale, 7f * villageScale))
                drawRect(Color(0xFFD9B36B), point + Offset(4f, -8f) * villageScale, Size(8f * villageScale, 6f * villageScale))
                drawRect(Color(0xFF638855), point + Offset(-9f, 5f) * villageScale, Size(8f * villageScale, 7f * villageScale))
            }
            outposts.forEach { outpost ->
                val chunk = outpostChunks.getValue(outpost)
                if ("${chunk.x},${chunk.y}" in discoveredIds) {
                    val point = marker(outpost.x.toDouble(), outpost.y.toDouble())
                    val scale = (cell / 48f).coerceIn(.65f, 1.15f)
                    val tent = androidx.compose.ui.graphics.Path().apply {
                        moveTo(point.x, point.y - 8f * scale)
                        lineTo(point.x - 8f * scale, point.y + 6f * scale)
                        lineTo(point.x + 8f * scale, point.y + 6f * scale)
                        close()
                    }
                    drawPath(tent, Color(0xFF6E9C78))
                    drawCircle(Color(0xFFE39B3C), 3.5f * scale, point + Offset(10f * scale, 4f * scale))
                }
            }
            val point = marker(player.x, player.y)
            drawCircle(Color(0xFFFFD253), radius = 7f, center = point)
            drawCircle(Color(0xFF33210E), radius = 9f, center = point, style = Stroke(width = 2f))
            drawLine(Color(0xFFE8E0C6), Offset(size.width - 24f, 32f), Offset(size.width - 24f, 12f), 3f)
            drawCircle(Color(0xFFE8E0C6), 3.5f, Offset(size.width - 24f, 10f))
        }

        Column(
            Modifier.fillMaxWidth().background(Color(0xFF243029), RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                if (selectedKnown) "区块 ${selected.x}, ${selected.y} · ${BiomePresentation.name(selectedSample.biome)}" else "区块 ${selected.x}, ${selected.y} · 云雾未散",
                color = if (selectedKnown) Color(0xFFFFE0A0) else Color(0xFFB7C9C4),
                fontWeight = FontWeight.Bold,
            )
            Text(
                if (selectedKnown) "${mapBiomeHint(selectedSample.biome)} · 可见资源 $selectedResources · 建筑 $selectedBuildings"
                else "走进这片区域才会绘入地图；未知处不会提前泄露资源和村庄。",
                color = Color(0xFFA9B6A6),
            )
            if (selected.x == playerChunk.x && selected.y == playerChunk.y) {
                Text("当前位置坐标 ${"%.1f".format(player.x)}, ${"%.1f".format(player.y)} · 当前区块 ${playerChunk.x}, ${playerChunk.y}", color = Color(0xFFE1AD52))
            } else if (selected.x == villageChunk.x && selected.y == villageChunk.y && selectedKnown) {
                Text("已发现村庄 · ◆ 标记位于此区块", color = Color(0xFFE8943A))
            } else if (outpostChunks.values.any { it == selected } && selectedKnown) {
                Text("已发现幸存者基地 · ▲ 可能有人愿意交谈或交易", color = Color(0xFF8FC69A))
            }
        }
        GameButton(
            label = "打开海岛图鉴",
            variant = GameButtonVariant.GHOST,
            modifier = Modifier.fillMaxWidth(),
            onClick = openCompendium,
        )
    }
}
