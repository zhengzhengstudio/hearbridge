package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.painterResource
import cn.zhengzhengstudio.survivaldiary.R
import cn.zhengzhengstudio.survivaldiary.domain.*

private val Night = Color(0xF22B2118)
private val NightSoft = Color(0xF23A2D20)
private val Forest = Color(0xFF3F6D4E)
private val Sun = Color(0xFFE7A928)
private val Paper = Color(0xFFF2E7C9)
private val Danger = Color(0xFFE36E5C)
private val HudShape = RoundedCornerShape(topStart = 9.dp, topEnd = 3.dp, bottomEnd = 8.dp, bottomStart = 4.dp)
private val ObjectiveShape = RoundedCornerShape(topStart = 4.dp, topEnd = 12.dp, bottomEnd = 5.dp, bottomStart = 10.dp)

@Composable
fun GameHud(
    state: GameUiState,
    model: GameViewModel,
    centerPlayer: () -> Unit = {},
) {
    val compact = LocalConfiguration.current.screenWidthDp < 600
    val guide = GuidanceEngine.current(state.save)
    var objectiveExpanded by remember(guide.id, compact) {
        mutableStateOf(!compact && guide.id != "open")
    }
    val selectedId = state.hotbarSlots.getOrNull(state.selectedHotbar)?.takeIf { (state.save.inventory[it] ?: 0) > 0 }
    val selectedAppearance = selectedId?.let(state.items::get)
    val nearby = state.nearbyResource
    val aboardMinecartId = TransportRules.aboardMinecartId(state.save)
    val heldActionLabel = when {
        selectedId != null && ConsumableCatalog.effect(selectedId) != null -> "进食 · ${selectedAppearance?.name ?: state.itemNames[selectedId] ?: selectedId}"
        selectedAppearance?.category == "building" -> when (selectedId) {
            "road-segment" -> "铺路 · 夯土路"
            "rail-segment" -> "铺轨 · 接到相邻轨道"
            else -> "放置 · ${selectedAppearance.name}"
        }
        else -> null
    }
    val actionLabel = when {
        aboardMinecartId != null -> "行驶 · 沿轨道前进"
        state.nearbyEntity?.type == "rowboat" -> if (TransportRules.aboardBoatId(state.save) == state.nearbyEntity.id) "靠岸\n离开木船" else "登船\n划桨木船"
        state.nearbyEntity?.type == "minecart" -> "乘坐\n轨道矿车"
        state.nearbyEntity?.type == "rail-segment" -> "检查\n连续轨道"
        state.nearbyEntity?.type == "storage-crate" -> "打开\n储物箱"
        state.nearbyEntity?.type == "furnace" -> "熔炼\n石砌炉"
        state.nearbyEntity?.type in setOf("farm-plot", "garden-plot") -> "耕作\n九格田"
        state.nearbyEntity?.type == "workbench" -> "制作\n工作台"
        state.nearbyEntity?.let { NativeNpcRules.isVillager(it.type) } == true -> "交谈\n${NativeNpcRules.name(state.nearbyEntity)}"
        state.nearbyEntity?.type in ShelterRules.usableTypes -> "休息\n到清晨"
        state.nearbyGroundItem != null -> "拾取\n${state.itemNames[state.nearbyGroundItem.itemId] ?: "物品"}"
        nearby?.toolTags?.contains("pickaxe") == true -> "开采\n${nearby.displayName}"
        nearby?.toolTags?.any { it == "axe" || it == "machete" } == true -> "砍伐\n${nearby.displayName}"
        nearby != null -> "采集\n${nearby.displayName}"
        else -> null
    }
    val actionIcon = when {
        aboardMinecartId != null -> R.drawable.game_ui_build
        state.nearbyEntity?.type in TransportRules.interactiveTypes -> R.drawable.game_ui_build
        state.nearbyEntity?.type == "storage-crate" -> R.drawable.game_ui_backpack
        state.nearbyEntity?.type == "furnace" -> R.drawable.game_ui_crafting
        state.nearbyEntity?.type in setOf("farm-plot", "garden-plot") -> R.drawable.game_ui_crafting
        state.nearbyEntity?.let { NativeNpcRules.isVillager(it.type) } == true -> R.drawable.game_ui_chat
        state.nearbyEntity?.type in ShelterRules.usableTypes -> R.drawable.game_ui_sleep
        state.nearbyGroundItem != null -> R.drawable.game_ui_gather
        else -> R.drawable.game_ui_gather
    }

    Box(Modifier.fillMaxSize().safeDrawingPadding()) {
        Box(Modifier.align(Alignment.TopCenter).padding(top = 7.dp).width(if (compact) 110.dp else 360.dp)) { StatusCompass(state, compact) }
        MiniMap(state, Modifier.align(Alignment.TopEnd).padding(8.dp).size(if (compact) 76.dp else 112.dp)) {
            model.openPanel(GamePanel.MAP)
        }
        CompassButton(
            Modifier.align(Alignment.TopEnd).padding(top = if (compact) 80.dp else 127.dp, end = 14.dp),
            compact,
            state,
            centerPlayer,
        )
        if (!objectiveExpanded) frontierRumor(state)?.let { rumor ->
            Text(
                "${rumor.direction} · ${rumor.clue}",
                modifier = Modifier.align(Alignment.TopEnd)
                    .padding(top = if (compact) 126.dp else 175.dp, end = 8.dp)
                    .widthIn(max = if (compact) 132.dp else 174.dp)
                    .background(Color(0xD91A2925), RoundedCornerShape(topStart = 9.dp, topEnd = 3.dp, bottomEnd = 9.dp, bottomStart = 5.dp))
                    .border(1.dp, Color(0x887D6A3E), RoundedCornerShape(topStart = 9.dp, topEnd = 3.dp, bottomEnd = 9.dp, bottomStart = 5.dp))
                    .padding(horizontal = 8.dp, vertical = 5.dp),
                color = Color(0xFFD7C99F),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
            )
        }
        Column(
            Modifier.align(Alignment.TopStart).padding(start = 8.dp, top = 8.dp)
                .width(if (compact) 120.dp else 214.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            VitalsPanel(state.save, compact)
            if (state.save.playMode == PlayMode.GUIDED) ObjectiveCard(
                guide,
                compact,
                expanded = objectiveExpanded,
                onToggle = { objectiveExpanded = !objectiveExpanded },
            )
        }

        Row(
            Modifier.align(Alignment.BottomEnd).padding(end = 9.dp, bottom = if (compact) 126.dp else 128.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            if (aboardMinecartId != null) {
                Box(
                    Modifier.heightIn(min = 46.dp).clip(HudShape).background(Color(0xE8352C24))
                        .border(1.dp, Color(0xAA9A815D), HudShape).clickable(onClick = model::leaveMinecart)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("下车", color = Paper, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                }
            }
            if (heldActionLabel != null) {
                Row(
                    Modifier.widthIn(min = 104.dp, max = if (compact) 132.dp else 154.dp).heightIn(min = 46.dp)
                        .clip(HudShape).background(Color(0xF23A5947)).border(1.dp, Color(0xB88C7651), HudShape)
                        .clickable(onClick = model::useHeldItem).padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    if (selectedId != null) ItemIcon(selectedId, selectedAppearance, Modifier.size(27.dp))
                    Text(heldActionLabel, color = Paper, fontWeight = FontWeight.Bold, maxLines = 2, style = MaterialTheme.typography.labelMedium)
                }
            }
            actionLabel?.let { visibleAction ->
                Row(
                    Modifier.widthIn(min = if (compact) 118.dp else 132.dp, max = 164.dp).heightIn(min = 56.dp)
                        .clip(HudShape).background(Color(0xF2265442)).border(2.dp, Sun, HudShape)
                        .clickable(onClick = model::useSelected).padding(horizontal = 11.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Image(painterResource(actionIcon), null, Modifier.size(if (compact) 24.dp else 28.dp), contentScale = ContentScale.Crop)
                    Text(visibleAction.replace("\n", " · "), color = Paper, fontWeight = FontWeight.Black, maxLines = 2, style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            state.notice?.takeIf { state.unlockNotice == null }?.let {
                Text(it, Modifier.background(Night, HudShape).border(1.dp, Color(0x667F6338), HudShape)
                    .padding(horizontal = 12.dp, vertical = 7.dp), color = Paper)
            }
            Hotbar(state, model, compact)
            Row(
                Modifier.padding(horizontal = 4.dp, vertical = 3.dp).fillMaxWidth().clip(RoundedCornerShape(topStart = 7.dp, topEnd = 3.dp, bottomEnd = 0.dp, bottomStart = 0.dp))
                    .background(Color(0xF20C1512)).border(1.dp, Color(0xAA705A35), RoundedCornerShape(topStart = 7.dp, topEnd = 3.dp, bottomEnd = 0.dp, bottomStart = 0.dp))
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                HudDockButton("背包", R.drawable.game_ui_backpack) { model.openPanel(GamePanel.INVENTORY) }
                HudDockButton("制作", R.drawable.game_ui_crafting) { model.openCrafting("hand") }
                HudDockButton("地图", R.drawable.game_ui_map) { model.openPanel(GamePanel.MAP) }
                HudDockButton("日记", R.drawable.game_ui_journal) { model.openPanel(GamePanel.DIARY) }
                HudDockButton("系统", R.drawable.game_ui_time) { model.openPanel(GamePanel.SYSTEM) }
            }
        }
    }
}

@Composable private fun CompassButton(modifier: Modifier, compact: Boolean, state: GameUiState, centerPlayer: () -> Unit) {
    val compass = rememberAssetImageBitmap(listOf("survival-v3/game/ui-v6/island-compass.webp"))
    Box(
        modifier.size(if (compact) 50.dp else 52.dp).clip(CircleShape).background(Night).border(2.dp, Sun, CircleShape)
            .clickable(onClick = centerPlayer),
        contentAlignment = Alignment.Center,
    ) {
        if (compass != null) Image(compass, "指南针，红针指向北方；点击找回角色", Modifier.fillMaxSize().padding(2.dp), contentScale = ContentScale.Fit)
        else Canvas(Modifier.size(28.dp)) { drawCircle(Color(0xFF163F42)); drawLine(Danger, center, androidx.compose.ui.geometry.Offset(center.x, 1.dp.toPx()), strokeWidth = 3.dp.toPx()) }
        state.aiCompassHint?.let { hint ->
            val player = state.save.players["local"]?.position ?: return@let
            val angle = kotlin.math.atan2(hint.coordinates.y - player.y, hint.coordinates.x - player.x)
            Canvas(Modifier.fillMaxSize().padding(4.dp)) {
                val radius = size.minDimension * .4f
                val marker = androidx.compose.ui.geometry.Offset(
                    center.x + kotlin.math.cos(angle).toFloat() * radius,
                    center.y + kotlin.math.sin(angle).toFloat() * radius,
                )
                drawCircle(Color(0xFFFFD253), size.minDimension * .065f, marker)
                drawCircle(Color(0xFF33210E), size.minDimension * .085f, marker, style = Stroke(2.dp.toPx()))
            }
        }
    }
}

@Composable private fun StatusCompass(state: GameUiState, compact: Boolean) {
    val save = state.save
    Row(
        Modifier.fillMaxWidth().background(Night, HudShape).border(1.dp, Color(0xB38B6C39), HudShape)
            .padding(horizontal = if (compact) 7.dp else 12.dp, vertical = if (compact) 6.dp else 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (!compact) Text("第 ${save.day} 天  ", color = Paper, fontWeight = FontWeight.Bold)
        Text("%02d:%02d".format(save.time / 60, save.time % 60), color = Sun, fontWeight = FontWeight.Black)
        Spacer(Modifier.width(if (compact) 5.dp else 9.dp))
        Image(
            painterResource(if (save.weather.kind in listOf("snow", "blizzard")) R.drawable.game_ui_weather_snow else if (save.weather.kind in listOf("rain", "storm")) R.drawable.game_ui_weather_rain else R.drawable.game_ui_weather_clear),
            null,
            Modifier.size(if (compact) 20.dp else 24.dp).clip(RoundedCornerShape(4.dp)),
            contentScale = ContentScale.Crop,
        )
        Text(weatherName(save.weather.kind), color = Paper, style = MaterialTheme.typography.bodySmall)
        if (!compact) {
            Spacer(Modifier.width(8.dp))
            Text(BiomePresentation.name(state.currentBiome), color = Color(0xFFA9C9A8), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable private fun MiniMap(state: GameUiState, modifier: Modifier, open: () -> Unit) {
    Box(
        modifier.clip(CircleShape).background(Color(0xFF174F5C)).border(3.dp, Color(0xFF9B753B), CircleShape).clickable(onClick = open),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize().padding(7.dp)) {
            val center = this.center
            val chunks = state.save.discoveredChunks.values.ifEmpty { listOf(DiscoveredChunk(0, 0)) }
            val player = (state.save.players["local"] ?: state.save.players.values.firstOrNull())
                ?.position ?: PlayerPosition(0.0, 0.0)
            val playerChunkX = kotlin.math.floor(player.x / WorldGenerator.CHUNK_SIZE).toInt()
            val playerChunkY = kotlin.math.floor(player.y / WorldGenerator.CHUNK_SIZE).toInt()
            val furthest = chunks.maxOfOrNull { maxOf(kotlin.math.abs(it.x - playerChunkX), kotlin.math.abs(it.y - playerChunkY)) }?.coerceAtLeast(1) ?: 1
            val stride = size.minDimension * .76f / (furthest * 2 + 1)
            val discoveredIds = chunks.mapTo(mutableSetOf()) { "${it.x},${it.y}" }
            val frontier = chunks.flatMap { chunk -> listOf(
                chunk.x - 1 to chunk.y, chunk.x + 1 to chunk.y,
                chunk.x to chunk.y - 1, chunk.x to chunk.y + 1,
            ) }.distinct().filter { "${it.first},${it.second}" !in discoveredIds }
            frontier.forEach { (x, y) ->
                val fogCenter = androidx.compose.ui.geometry.Offset(
                    center.x + (x - playerChunkX) * stride,
                    center.y + (y - playerChunkY) * stride,
                )
                drawCircle(Color(0xCC102C2B), radius = stride * .58f, center = fogCenter)
                drawCircle(Color(0x551E4A43), radius = stride * .78f, center = fogCenter)
            }
            chunks.forEach { chunk ->
                val terrain = WorldGenerator.sample(
                    state.save.seed,
                    (chunk.x * WorldGenerator.CHUNK_SIZE + WorldGenerator.CHUNK_SIZE / 2).toDouble(),
                    (chunk.y * WorldGenerator.CHUNK_SIZE + WorldGenerator.CHUNK_SIZE / 2).toDouble(),
                )
                val color = when (terrain.biome) {
                    "lagoon" -> Color(0xFF3D8794)
                    "mangrove", "cloud-forest" -> Color(0xFF376F5B)
                    "basalt-ridge", "limestone-upland" -> Color(0xFF646962)
                    "palm-grove" -> Color(0xFF4D824D)
                    "dry-savanna" -> Color(0xFFB69A54)
                    else -> Color(0xFF648158)
                }
                drawRoundRect(
                    color = color,
                    topLeft = androidx.compose.ui.geometry.Offset(
                        center.x + (chunk.x - playerChunkX) * stride - stride * .46f,
                        center.y + (chunk.y - playerChunkY) * stride - stride * .46f,
                    ),
                    size = androidx.compose.ui.geometry.Size(stride * .92f, stride * .92f),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(stride * .18f),
                )
            }
            frontier.minByOrNull { kotlin.math.abs(it.first - playerChunkX) + kotlin.math.abs(it.second - playerChunkY) }?.let { rumor ->
                drawCircle(
                    Color(0xFFD7A63B), radius = size.minDimension * .022f,
                    center = androidx.compose.ui.geometry.Offset(
                        center.x + (rumor.first - playerChunkX) * stride,
                        center.y + (rumor.second - playerChunkY) * stride,
                    ),
                )
            }
            drawCircle(Color(0xFFFFD253), radius = size.minDimension * .055f, center = center)
            drawCircle(Color(0xFF33210E), radius = size.minDimension * .065f, center = center, style = Stroke(width = 2.dp.toPx()))
        }
    }
}

@Composable private fun VitalsPanel(save: GameSave, compact: Boolean) {
    val capacity = InventoryRules.capacity(save.inventory)
    val staminaDelta = save.lastModifiers.firstOrNull { it.code.endsWith("-stamina") }?.value ?: 0.0
    val staminaLabel = when {
        staminaDelta > 0.001 -> "体力 ↗"
        staminaDelta < -0.001 -> "体力 ↘"
        else -> "体力"
    }
    Column(
        Modifier.background(Color(0xE81B231D), HudShape).border(1.dp, Color(0x996D5935), HudShape).padding(horizontal = 6.dp, vertical = 5.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Vital("生命", save.vitals.health, Danger, R.drawable.game_ui_health, Modifier.fillMaxWidth())
        Vital("饮水", save.vitals.hydration, Color(0xFF3193AD), R.drawable.game_ui_water, Modifier.fillMaxWidth())
        Vital("饱腹", save.vitals.hunger, Color(0xFF6F9A4F), R.drawable.game_ui_food, Modifier.fillMaxWidth())
        Vital(staminaLabel, save.vitals.stamina, Sun, R.drawable.game_ui_energy, Modifier.fillMaxWidth())
        if (!compact) Text("负重 ${"%.1f".format(save.vitals.carriedMass)} / ${capacity.toInt()} kg", Modifier.padding(horizontal = 4.dp, vertical = 2.dp), color = if (save.vitals.carriedMass >= capacity * .9) Danger else Color(0xFFBEB293), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable private fun ObjectiveCard(
    step: GuidanceStep,
    compact: Boolean,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val tutorial = step.id != "open"
    Column(
        Modifier.fillMaxWidth().background(if (tutorial) Color(0xF0322A1B) else NightSoft, ObjectiveShape)
            .border(if (tutorial) 2.dp else 1.dp, if (tutorial) Sun else Color(0x887D5D32), ObjectiveShape)
            .clickable(onClick = onToggle).padding(if (compact) 7.dp else 9.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (compact) {
            Text(step.title, color = Paper, fontWeight = FontWeight.Bold, maxLines = if (expanded) 2 else 1, overflow = TextOverflow.Ellipsis)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(step.progress, color = Sun, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1)
                Text(if (expanded) "收起" else "展开", color = Color(0xFFBBAE8C), style = MaterialTheme.typography.labelSmall)
            }
        } else Row(verticalAlignment = Alignment.CenterVertically) {
            Text(step.title, color = Paper, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(step.progress, color = Sun, style = MaterialTheme.typography.labelSmall)
        }
        if (expanded) {
            Text(step.detail, color = Color(0xFFC7B994), style = MaterialTheme.typography.bodySmall, maxLines = if (compact) 5 else 8, overflow = TextOverflow.Ellipsis)
            if (tutorial && !compact) Text("完成动作后自动进入下一步", color = Sun, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable private fun Vital(label: String, value: Double, color: Color, iconRes: Int, modifier: Modifier) {
    Row(modifier.padding(horizontal = 2.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(iconRes), null, Modifier.size(19.dp).clip(RoundedCornerShape(3.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row { Text(label, color = Color(0xFFD9CEB1), style = MaterialTheme.typography.labelSmall); Spacer(Modifier.weight(1f)); Text(value.toInt().toString(), color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
            Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(Color(0x554D605B))) {
                Box(Modifier.fillMaxWidth((value / 100.0).toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(color))
            }
        }
    }
}

@Composable private fun Hotbar(state: GameUiState, model: GameViewModel, compact: Boolean) {
    Row(
        Modifier.wrapContentWidth().widthIn(max = if (compact) 316.dp else 510.dp).horizontalScroll(rememberScrollState())
            .background(Night, HudShape).border(1.dp, Color(0xFF7D5D32), HudShape).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        repeat(6) { index ->
            val itemId = state.hotbarSlots.getOrNull(index)?.takeIf { (state.save.inventory[it] ?: 0) > 0 }
            val count = itemId?.let { state.save.inventory[it] }
            val selected = index == state.selectedHotbar
            Column(
                Modifier.width(if (compact) 48.dp else 52.dp).heightIn(min = if (compact) 54.dp else 52.dp).clip(RoundedCornerShape(topStart = 6.dp, topEnd = 2.dp, bottomEnd = 5.dp, bottomStart = 3.dp))
                    .background(if (selected) Color(0xFF684A24) else Color(0xFF403224))
                    .then(if (selected) Modifier.border(2.dp, Sun, RoundedCornerShape(3.dp)) else Modifier)
                    .clickable { if (selected && itemId != null) model.clearHotbar(index) else model.selectHotbar(index) }.padding(3.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(if (compact) 38.dp else 40.dp), contentAlignment = Alignment.Center) {
                    if (itemId != null) ItemIcon(itemId, state.items[itemId], Modifier.fillMaxSize())
                    else Box(Modifier.size(11.dp).border(1.dp, Color(0x557E6B4A), CircleShape))
                    count?.let { Text(it.toString(), Modifier.align(Alignment.BottomEnd).background(Night, CircleShape).padding(horizontal = 3.dp), color = Sun, style = MaterialTheme.typography.labelSmall) }
                }
                if (!compact) Text(itemId?.let { state.itemNames[it] } ?: "空", color = if (itemId == null) Color(0xFF9D8F70) else Paper, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable fun ItemIcon(itemId: String, appearance: ItemAppearance?, modifier: Modifier = Modifier) {
    val category = appearance?.category ?: "material"
    val conventional = if (category == "building") "survival-v3/game/building/building-$itemId/icon.png" else "survival-v3/game/$category/item-$itemId/icon.png"
    val paths = listOf(
        appearance?.iconAssetPath.orEmpty(),
        if (itemId == "road-segment") "survival-v3/game/ground-v5/worn-path@0.5x.webp" else "",
        conventional,
        "survival-v3/game/resource/item-$itemId/icon.png",
        "survival-v3/game/food/item-$itemId/icon.png",
        "survival-v3/game/material/item-$itemId/icon.png",
    ).filter { it.isNotBlank() }.distinct()
    val bitmap = rememberAssetImageBitmap(paths)
    if (bitmap != null) Image(bitmap, appearance?.name ?: itemId, modifier, contentScale = ContentScale.Fit)
    else Box(modifier.background(Forest, RoundedCornerShape(7.dp)), contentAlignment = Alignment.Center) { Text(appearance?.name?.take(1) ?: "物", color = Paper) }
}

@Composable private fun RowScope.HudDockButton(label: String, iconRes: Int, action: () -> Unit) {
    Box(
        Modifier.weight(1f).heightIn(min = 54.dp).clip(SurvivalTheme.PanelShape)
            .border(1.dp, Color(0xFF5A4F45), SurvivalTheme.PanelShape)
            .background(Color(0xD92A2620))
            .clickable(onClick = action)
            .padding(horizontal = 2.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Image(painterResource(iconRes), null, Modifier.size(30.dp).clip(RoundedCornerShape(5.dp)), contentScale = ContentScale.Crop)
            Text(label, color = Paper, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
    }
}

private fun weatherName(kind: String) = when (kind) {
    "clear" -> "晴"; "cloudy" -> "多云"; "fog" -> "雾"; "rain" -> "雨"; "storm" -> "风暴"; "snow" -> "雪"; "blizzard" -> "暴雪"; else -> kind
}

private data class FrontierRumor(val direction: String, val clue: String)

private fun frontierRumor(state: GameUiState): FrontierRumor? {
    val player = (state.save.players["local"] ?: state.save.players.values.firstOrNull())?.position ?: return null
    val playerChunkX = kotlin.math.floor(player.x / WorldGenerator.CHUNK_SIZE).toInt()
    val playerChunkY = kotlin.math.floor(player.y / WorldGenerator.CHUNK_SIZE).toInt()
    val discovered = state.save.discoveredChunks.values.ifEmpty { listOf(DiscoveredChunk(playerChunkX, playerChunkY)) }
    val discoveredIds = discovered.mapTo(mutableSetOf()) { "${it.x},${it.y}" }
    val candidates = discovered.flatMap { chunk -> listOf(
        Triple(chunk.x, chunk.y - 1, "北方"),
        Triple(chunk.x + 1, chunk.y, "东方"),
        Triple(chunk.x, chunk.y + 1, "南方"),
        Triple(chunk.x - 1, chunk.y, "西方"),
    ) }.distinctBy { "${it.first},${it.second}" }
        .filter { "${it.first},${it.second}" !in discoveredIds }
        .sortedWith(compareBy<Triple<Int, Int, String>>(
            { kotlin.math.abs(it.first - playerChunkX) + kotlin.math.abs(it.second - playerChunkY) },
            { stableRumorHash(state.save.seed, it.first, it.second) },
        ))
    val target = candidates.firstOrNull() ?: return null
    val sample = WorldGenerator.sample(
        state.save.seed,
        (target.first * WorldGenerator.CHUNK_SIZE + WorldGenerator.CHUNK_SIZE / 2).toDouble(),
        (target.second * WorldGenerator.CHUNK_SIZE + WorldGenerator.CHUNK_SIZE / 2).toDouble(),
    )
    val clue = when (sample.biome) {
        "lagoon" -> "听见潮水回响"
        "mangrove", "cloud-forest" -> "林冠间有动静"
        "basalt-ridge", "limestone-upland" -> "风里带着石粉"
        "palm-grove" -> "隐约看见旧营地烟迹"
        "dry-savanna" -> "草间留着新足印"
        else -> "雾后传来陌生声响"
    }
    return FrontierRumor(target.third, clue)
}

private fun stableRumorHash(seed: String, x: Int, y: Int): Long {
    var value = seed.fold(0xCBF29CE484222325UL.toLong()) { hash, char ->
        (hash xor char.code.toLong()) * 0x100000001B3UL.toLong()
    } xor (x.toLong() * 0x45D9F3BL) xor (y.toLong() * 0x119DE1F3L)
    value = value xor (value ushr 16)
    return value and Long.MAX_VALUE
}
