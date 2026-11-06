package cn.zhengzhengstudio.survivaldiary.domain

object NativeInventoryRules {
    fun drop(save: GameSave, itemId: String, amount: Int, commandId: String): GameSave {
        require(amount > 0 && commandId.isNotBlank()) { "丢弃数量无效" }
        val id = "ground-$commandId"
        // A tap can be delivered again after a recomposition or process restore.
        // Replaying the same command must not consume the carried item twice.
        if (id in save.groundItems) return save
        val carried = save.inventory[itemId] ?: 0
        require(carried >= amount) { "背包里没有足够物品" }
        val player = save.players["local"]?.position ?: PlayerPosition(8.0, 8.0)
        val inventory = save.inventory.toMutableMap()
        if (carried == amount) inventory.remove(itemId) else inventory[itemId] = carried - amount
        val item = GroundItem(id, itemId, amount, player.x + 0.4, player.y + 0.25, save.elapsedGameMinutes)
        return save.copy(inventory = inventory, groundItems = save.groundItems + (id to item))
    }

    fun pickup(save: GameSave, groundItemId: String): GameSave {
        // Picking the same object twice is also a replay, not a reason to crash
        // the whole game screen.
        val item = save.groundItems[groundItemId] ?: return save
        return save.copy(
            inventory = save.inventory + (item.itemId to ((save.inventory[item.itemId] ?: 0) + item.amount)),
            groundItems = save.groundItems - groundItemId,
        )
    }
}

object NativeFarmRules {
    private data class Crop(val cropId: String, val duration: Double, val produce: Int)
    private val crops = mapOf(
        "taro-seed" to Crop("taro", 720.0, 2),
        "millet-seed" to Crop("millet", 960.0, 3),
        "herb-seed" to Crop("herb", 480.0, 2),
    )

    fun ensurePlot(save: GameSave, entityId: String): GameSave =
        if (entityId in save.plots) save else save.copy(plots = save.plots + (entityId to CropPlot(entityId)))

    fun plant(save: GameSave, entityId: String, slotIndex: Int, seedId: String): GameSave {
        val crop = crops[seedId] ?: error("这种物品不能播种")
        require(slotIndex in 0..8) { "种植格无效" }
        require((save.inventory[seedId] ?: 0) > 0) { "背包里没有种子" }
        val plot = save.plots[entityId] ?: CropPlot(entityId)
        require(plot.slots[slotIndex] == null) { "这一格已经种了作物" }
        val inventory = save.inventory.toMutableMap()
        val remaining = inventory.getValue(seedId) - 1
        if (remaining == 0) inventory.remove(seedId) else inventory[seedId] = remaining
        val slots = plot.slots.toMutableList().apply { set(slotIndex, CropSlot(crop.cropId, seedId, durationMinutes = crop.duration)) }
        return save.copy(inventory = inventory, plots = save.plots + (entityId to plot.copy(slots = slots)))
    }

    fun water(save: GameSave, entityId: String): GameSave {
        require((save.inventory["fresh-water"] ?: 0) > 0) { "需要淡水" }
        val plot = save.plots[entityId] ?: error("农田不存在")
        require(plot.slots.any { it != null && it.stage != "ripe" }) { "先播种再浇水" }
        val inventory = save.inventory.toMutableMap()
        val remaining = inventory.getValue("fresh-water") - 1
        if (remaining == 0) inventory.remove("fresh-water") else inventory["fresh-water"] = remaining
        return save.copy(inventory = inventory, plots = save.plots + (entityId to plot.copy(water = (plot.water + 1).coerceAtMost(12))))
    }

    fun harvest(save: GameSave, entityId: String, slotIndex: Int): GameSave {
        val plot = save.plots[entityId] ?: error("农田不存在")
        val slot = plot.slots.getOrNull(slotIndex) ?: error("这一格没有作物")
        require(slot.stage == "ripe") { "作物还没成熟" }
        val crop = crops.getValue(slot.seedId)
        val inventory = save.inventory + (slot.cropId to ((save.inventory[slot.cropId] ?: 0) + crop.produce))
        val slots = plot.slots.toMutableList().apply { set(slotIndex, null) }
        return save.copy(inventory = inventory, plots = save.plots + (entityId to plot.copy(slots = slots)))
    }

    fun advance(save: GameSave, minutes: Double): GameSave {
        if (minutes <= 0) return save
        val plots = save.plots.mapValues { (_, plot) ->
            if (plot.water <= 0) plot else {
                var active = false
                val slots = plot.slots.map { slot ->
                    if (slot == null || slot.stage == "ripe") slot else {
                        active = true
                        val progress = (slot.progressMinutes + minutes).coerceAtMost(slot.durationMinutes)
                        slot.copy(progressMinutes = progress, stage = if (progress >= slot.durationMinutes) "ripe" else "growing")
                    }
                }
                if (!active) plot.copy(slots = slots) else {
                    val usage = plot.waterUsageMinutes + minutes
                    val spent = kotlin.math.floor(usage / 60.0).toInt().coerceAtMost(plot.water)
                    val water = (plot.water - spent).coerceAtLeast(0)
                    plot.copy(
                        water = water,
                        waterUsageMinutes = if (water == 0) 0.0 else usage - spent * 60.0,
                        slots = slots,
                    )
                }
            }
        }
        return save.copy(plots = plots)
    }
}
