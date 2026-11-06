package cn.zhengzhengstudio.survivaldiary.domain

data class FurnaceMutation(
    val ok: Boolean,
    val save: GameSave,
    val reason: String? = null,
    val reasonId: String? = null,
)

object FurnaceRules {
    fun start(save: GameSave, entityId: String, recipe: RecipeDefinition): FurnaceMutation {
        val entity = save.entities[entityId]
            ?: return failed(save, "熔炉不存在", "invalid-facility")
        if (entity.type != "furnace" || recipe.station != "furnace") {
            return failed(save, "这个设施不能执行该配方", "invalid-facility")
        }
        val process = save.facilityProcesses[entityId] ?: FacilityProcess()
        if (process.status == FurnaceStatus.WORKING) return failed(save, "熔炉正在工作", "already-working")
        if (process.output.values.any { it > 0 }) return failed(save, "请先领取产物", "output-full")
        if (recipe.ingredients.any { (id, amount) -> (save.inventory[id] ?: 0) < amount }) {
            return failed(save, "矿料不足", "missing-input")
        }
        val fuelId = recipe.fuelItemId
        val inputFuelAmount = fuelId?.let { recipe.ingredients[it] } ?: 0
        if (fuelId == null || recipe.fuelAmount <= 0 || (save.inventory[fuelId] ?: 0) < recipe.fuelAmount + inputFuelAmount) {
            return failed(save, "燃料不足", "missing-fuel")
        }
        val inventory = save.inventory.toMutableMap()
        recipe.ingredients.forEach { (id, amount) ->
            val next = inventory.getValue(id) - amount
            if (next == 0) inventory.remove(id) else inventory[id] = next
        }
        val fuelRemaining = inventory.getValue(fuelId) - recipe.fuelAmount
        if (fuelRemaining == 0) inventory.remove(fuelId) else inventory[fuelId] = fuelRemaining
        val duration = maxOf(1.0, recipe.durationSeconds / 3.0)
        val next = FacilityProcess(
            recipeId = recipe.id,
            input = recipe.ingredients,
            fuel = mapOf(fuelId to recipe.fuelAmount),
            durationMinutes = duration,
            outputItemId = recipe.outputItemId,
            outputAmount = recipe.outputAmount,
            status = FurnaceStatus.WORKING,
        )
        return FurnaceMutation(true, save.copy(inventory = inventory, facilityProcesses = save.facilityProcesses + (entityId to next)))
    }

    fun advance(save: GameSave, elapsedMinutes: Double): GameSave {
        if (elapsedMinutes <= 0.0) return save
        var changed = false
        val processes = save.facilityProcesses.mapValues { (_, process) ->
            if (process.status != FurnaceStatus.WORKING) return@mapValues process
            changed = true
            val progress = minOf(process.durationMinutes, process.progressMinutes + elapsedMinutes)
            if (progress < process.durationMinutes) process.copy(progressMinutes = progress)
            else process.copy(
                input = emptyMap(),
                fuel = emptyMap(),
                output = mapOfNotNull(process.outputItemId, process.outputAmount),
                progressMinutes = process.durationMinutes,
                status = FurnaceStatus.READY,
            )
        }
        return if (changed) save.copy(facilityProcesses = processes) else save
    }

    fun claim(save: GameSave, entityId: String): FurnaceMutation {
        val process = save.facilityProcesses[entityId]
            ?: return failed(save, "熔炉还没有产物", "no-output")
        if (process.status != FurnaceStatus.READY || process.output.values.none { it > 0 }) {
            return failed(save, "熔炉还没有产物", "no-output")
        }
        val inventory = save.inventory.toMutableMap()
        process.output.forEach { (id, amount) -> inventory[id] = (inventory[id] ?: 0) + amount }
        return FurnaceMutation(
            true,
            save.copy(
                inventory = inventory,
                facilityProcesses = save.facilityProcesses + (entityId to FacilityProcess()),
                milestones = save.milestones + ("recipe:${process.recipeId}" to true) + ("item:${process.outputItemId}" to true),
            ),
        )
    }

    private fun failed(save: GameSave, reason: String, reasonId: String) = FurnaceMutation(false, save, reason, reasonId)

    private fun mapOfNotNull(itemId: String?, amount: Int): Map<String, Int> =
        if (itemId.isNullOrBlank() || amount <= 0) emptyMap() else mapOf(itemId to amount)
}
