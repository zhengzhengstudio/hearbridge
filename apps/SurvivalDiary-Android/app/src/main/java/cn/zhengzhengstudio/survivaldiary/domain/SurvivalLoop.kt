package cn.zhengzhengstudio.survivaldiary.domain

data class ConsumableEffect(
    val hunger: Double = 0.0,
    val hydration: Double = 0.0,
    val stamina: Double = 0.0,
    val health: Double = 0.0,
)

object ConsumptionEngine {
    fun consume(save: GameSave, itemId: String, effect: ConsumableEffect): GameSave {
        require((save.inventory[itemId] ?: 0) > 0) { "背包里没有这份食物" }
        require(listOf(effect.hunger, effect.hydration, effect.stamina, effect.health).any { it != 0.0 }) { "这个物品不能食用" }
        val inventory = save.inventory.toMutableMap().apply {
            val next = getValue(itemId) - 1
            if (next == 0) remove(itemId) else this[itemId] = next
        }
        val hunger = (save.vitals.hunger + effect.hunger).coerceIn(0.0, 100.0)
        val hydration = (save.vitals.hydration + effect.hydration).coerceIn(0.0, 100.0)
        val effects = save.vitals.effects.toMutableSet().apply {
            if (hunger > 8) remove("starving")
            if (hydration > 8) remove("dehydrated")
        }
        return save.copy(
            inventory = inventory,
            vitals = save.vitals.copy(
                health = (save.vitals.health + effect.health).coerceIn(0.0, 100.0),
                stamina = (save.vitals.stamina + effect.stamina).coerceIn(0.0, 100.0),
                hunger = hunger,
                hydration = hydration,
                effects = effects.sorted(),
            ),
            milestones = save.milestones + ("consumed:any" to true) + ("consumed:$itemId" to true),
        )
    }
}

object InventoryRules {
    const val BASE_CAPACITY = 18.0
    fun capacity(inventory: Map<String, Int>): Double = BASE_CAPACITY +
        (inventory["small-backpack"] ?: 0).coerceAtLeast(0) * 10.0 +
        (inventory["frame-backpack"] ?: 0).coerceAtLeast(0) * 22.0
    fun mass(inventory: Map<String, Int>, masses: Map<String, Double>): Double =
        inventory.entries.sumOf { (id, count) -> (masses[id] ?: 0.0) * count }
    fun canAdd(inventory: Map<String, Int>, itemId: String, amount: Int, masses: Map<String, Double>): Boolean =
        mass(inventory, masses) + (masses[itemId] ?: 0.0) * amount <= capacity(inventory) + 0.0001
}

object ToolCompatibility {
    private val capabilities = mapOf(
        "stone-axe" to setOf("axe"),
        "stone-pickaxe" to setOf("pickaxe"),
        "stone-machete" to setOf("machete", "axe"),
        "copper-pickaxe" to setOf("pickaxe"),
        "iron-pickaxe" to setOf("pickaxe"),
        "machete" to setOf("machete", "axe"),
        "shovel" to setOf("shovel"),
        "fishing-rod" to setOf("fishing"),
        "waterskin" to setOf("container"),
    )
    fun canHarvest(required: List<String>, tools: Set<String>): Boolean =
        required.isEmpty() || tools.any { tool -> capabilities[tool].orEmpty().any(required::contains) }
    fun requiredLabel(required: List<String>): String = required.joinToString("/") {
        mapOf("axe" to "斧", "pickaxe" to "镐", "machete" to "砍刀", "shovel" to "铲", "fishing" to "钓竿", "container" to "容器")[it] ?: "工具"
    }
}

object ToolDurabilityEngine {
    private val maximums = mapOf(
        "stone-axe" to 60,
        "stone-pickaxe" to 70,
        "stone-machete" to 55,
        "copper-pickaxe" to 140,
        "iron-pickaxe" to 240,
        "machete" to 180,
        "shovel" to 170,
        "fishing-rod" to 90,
    )

    fun maximum(itemId: String): Int? = maximums[itemId]

    fun registerCraft(save: GameSave, itemId: String): GameSave {
        val maximum = maximum(itemId) ?: return save
        return save.copy(toolDurability = save.toolDurability + (itemId to maximum))
    }

    fun use(save: GameSave, itemId: String, wear: Int = 1): GameSave {
        val maximum = maximum(itemId) ?: return save
        require((save.inventory[itemId] ?: 0) > 0) { "背包里没有这件工具" }
        val remaining = (save.toolDurability[itemId] ?: maximum) - wear.coerceAtLeast(1)
        if (remaining > 0) return save.copy(toolDurability = save.toolDurability + (itemId to remaining))
        val inventory = save.inventory.toMutableMap().apply {
            val count = (get(itemId) ?: 1) - 1
            if (count <= 0) remove(itemId) else this[itemId] = count
        }
        return save.copy(
            inventory = inventory,
            toolDurability = save.toolDurability - itemId,
            milestones = save.milestones + ("broken:$itemId" to true),
        )
    }
}

data class GuidanceStep(val id: String, val title: String, val detail: String, val progress: String)

object GuidanceEngine {
    fun isOpeningChapterComplete(save: GameSave): Boolean = currentStepId(save) == "open"

    private fun currentStepId(save: GameSave): String {
        if (save.milestones["tutorial:moved"] != true) return "tutorial-move"
        if (save.milestones["talked:castaway-builder"] != true && save.milestones["meet_atuo"] != true) return "tutorial-atuo"
        if (!hasStarterSupplies(save) && !hasFirstTool(save)) return "tutorial-gather"
        if (!hasFirstTool(save)) return "tools"
        if (!hasWater(save) || !hasFood(save)) return "water-food"
        if (acquired(save, "palm-fiber") < 5) return "fiber"
        if (save.entities.values.none { NativeNpcRules.isPlayerOwned(it) && it.type == "campfire" }) return "fire"
        if (!hasShelter(save)) return "shelter"
        if (save.milestones["consumed:any"] != true) return "meal"
        if (save.milestones["slept:any"] != true) return "rest"
        if (save.discoveredChunks.size < 2) return "explore"
        return "open"
    }

    fun current(save: GameSave): GuidanceStep {
        if (save.milestones["tutorial:moved"] != true) return GuidanceStep(
            "tutorial-move", "醒在潮线旁", "潮水正在回涨。轻点附近空地走几步，先确认自己还能行动。", "站起来",
        )
        if (save.milestones["talked:castaway-builder"] != true && save.milestones["meet_atuo"] != true) return GuidanceStep(
            "tutorial-atuo", "有人在呼喊", "阿拓受了伤，就在残骸另一侧。沿脚印靠近并和他交谈。", "找到阿拓",
        )
        if (!hasStarterSupplies(save) && !hasFirstTool(save)) return GuidanceStep(
            "tutorial-gather", "天黑前要有火", "阿拓需要 1 根树枝、2 块海蚀石和 4 份散落纤维。出生海湾会保证这些材料存在。", starterProgress(save),
        )
        if (!hasFirstTool(save)) return GuidanceStep(
            "tools", "做一把能用的工具", "先把纤维搓成绳，再制作石片砍刀。提前做出的工具会直接追认。", "石片工具 0 / 1",
        )
        if (!hasWater(save) || !hasFood(save)) return GuidanceStep(
            "water-food", "阿拓需要缓一缓", "带回一份淡水和一份椰子或浆果。发现、采集或饮用淡水都算进展。", "水 ${if (hasWater(save)) 1 else 0}/1 · 食物 ${if (hasFood(save)) 1 else 0}/1",
        )
        if (acquired(save, "palm-fiber") < 5) return GuidanceStep(
            "fiber", "割下结实的纤维", "拿着刚做好的工具靠近纤维丛，让工具命中和资源产出真实发生。", "纤维 ${minOf(acquired(save, "palm-fiber"), 5)}/5",
        )
        if (save.entities.values.none { NativeNpcRules.isPlayerOwned(it) && it.type == "campfire" }) return GuidanceStep(
            "fire", "风里已经有雨味", "制作并放置营火，然后真正把它点亮。未点燃的营火不算完成。", "营火 0 / 1",
        )
        if (!hasShelter(save)) return GuidanceStep(
            "shelter", "给暴雨留一道屋顶", "和阿拓搭起简易庇护所或床铺。放置后必须能真正使用。", "住处 0 / 1",
        )
        if (save.milestones["consumed:any"] != true) return GuidanceStep(
            "meal", "先把力气找回来", "吃下一份食物。只有生命或体力发生真实恢复，才算这一步完成。", "进食恢复 0 / 1",
        )
        if (save.milestones["slept:any"] != true) return GuidanceStep(
            "rest", "守住第一夜", "两个人都靠近住处后休息到清晨。营火、饱腹和饮水会影响恢复。", "休息 0 / 1",
        )
        if (save.discoveredChunks.size < 2) return GuidanceStep("explore", "雾后有一缕烟", "旧路尽头升起陌生烟柱。踏上旧路，第一章就会结束。", "看向远方")
        val rumors = listOf(
            "迷雾后的高地可能藏着新矿脉，带上石镐沿指南针前进。",
            "远方出现了炊烟，那里可能有村落、商人或流浪幸存者。",
            "草间留下陌生足迹，继续探索可能遇见动物与新的食物来源。",
            "旧路延伸进未探索区，铺路、架桥或修铁路能把新据点连回营地。",
        )
        return GuidanceStep(
            "open", "岛屿传闻 · ${save.discoveredChunks.size} 个区块", rumors[save.discoveredChunks.size.mod(rumors.size)],
            "向迷雾前进",
        )
    }

    private fun acquired(save: GameSave, itemId: String): Int = when {
        save.milestones["collected:$itemId"] == true || save.milestones["consumed:$itemId"] == true -> maxOf(1, save.inventory[itemId] ?: 0)
        else -> save.inventory[itemId] ?: 0
    }

    private fun hasStarterSupplies(save: GameSave): Boolean = acquired(save, "branch") >= 1 && acquired(save, "stone") >= 2 && acquired(save, "palm-fiber") >= 4
    private fun starterProgress(save: GameSave): String = "树枝 ${minOf(acquired(save, "branch"), 1)}/1 · 海蚀石 ${minOf(acquired(save, "stone"), 2)}/2 · 纤维 ${minOf(acquired(save, "palm-fiber"), 4)}/4"
    private fun hasWater(save: GameSave): Boolean = listOf("fresh-water", "coconut-water", "boiled-water").any { acquired(save, it) > 0 }
    private fun hasFood(save: GameSave): Boolean = listOf("coconut", "berry", "taro", "millet").any { acquired(save, it) > 0 }
    private fun hasFirstTool(save: GameSave): Boolean = listOf("stone-machete", "stone-axe", "stone-pickaxe", "stone-knife").any { (save.inventory[it] ?: 0) > 0 || save.milestones["item:$it"] == true }
    private fun hasShelter(save: GameSave): Boolean = save.entities.values.any { NativeNpcRules.isPlayerOwned(it) && it.type in setOf("shelter", "straw-mat", "hammock", "simple-bed", "camp-bed", "wooden-bed") }
}

object ConsumableCatalog {
    private val effects = mapOf(
        "fresh-water" to ConsumableEffect(hydration = 28.0),
        "boiled-water" to ConsumableEffect(hydration = 36.0, health = 1.0),
        "grilled-fish" to ConsumableEffect(hunger = 38.0, stamina = 8.0, health = 2.0),
        "crab-meal" to ConsumableEffect(hunger = 45.0, stamina = 10.0, health = 3.0),
        "fruit-bowl" to ConsumableEffect(hunger = 32.0, hydration = 18.0, stamina = 8.0, health = 4.0),
        "dried-fish" to ConsumableEffect(hunger = 24.0, hydration = -4.0),
        "salted-fish" to ConsumableEffect(hunger = 30.0, hydration = -10.0),
        "mushroom-stew" to ConsumableEffect(hunger = 34.0, hydration = 10.0, stamina = 18.0, health = 3.0),
        "coconut-water" to ConsumableEffect(hunger = 5.0, hydration = 30.0),
        "clam-broth" to ConsumableEffect(hunger = 22.0, hydration = 22.0, health = 2.0),
        "herb-tea" to ConsumableEffect(hydration = 24.0, stamina = 6.0, health = 4.0),
        "dried-seaweed" to ConsumableEffect(hunger = 12.0, hydration = -2.0),
        "smoked-crab" to ConsumableEffect(hunger = 34.0, hydration = -5.0),
        "cured-clam" to ConsumableEffect(hunger = 20.0, hydration = -6.0),
        "coconut" to ConsumableEffect(hunger = 12.0, hydration = 16.0, stamina = 4.0, health = 1.0),
        "berry" to ConsumableEffect(hunger = 5.0, hydration = 4.0, stamina = 3.0, health = 1.0),
        "taro" to ConsumableEffect(hunger = 12.0, stamina = 4.0, health = 1.0),
        "millet" to ConsumableEffect(hunger = 8.0, stamina = 3.0, health = 1.0),
    )
    fun effect(itemId: String): ConsumableEffect? = effects[itemId]
}
