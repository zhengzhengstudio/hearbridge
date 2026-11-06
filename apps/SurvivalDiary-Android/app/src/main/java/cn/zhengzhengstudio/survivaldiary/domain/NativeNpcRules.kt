package cn.zhengzhengstudio.survivaldiary.domain

object NativeNpcRules {
    const val BUILDER_ID = "castaway-builder"
    const val BUILDER_TYPE = "castaway-builder"
    const val TRADER_ID = "island-trader"
    const val TRADER_TYPE = "island-trader"
    const val FARMER_ID = "village-farmer"
    const val FARMER_TYPE = "village-farmer"
    const val WANDERER_TYPE = "wanderer-survivor"
    const val VILLAGE_MILESTONE = "nativeVillageBootstrapVersion:4"
    const val ATUO_MET_MILESTONE = "meet_atuo"
    const val ATUO_TALKED_MILESTONE = "talked:castaway-builder"
    private const val ATUO_INJURED_DURABILITY = 38
    val STARTER_GUIDE_POSITION = Coordinates(10, 9)

    fun villageCenter(seed: String): Coordinates {
        val directions = listOf(1 to 1, -1 to 1, 1 to -1, -1 to -1, 2 to 1, -2 to 1, 1 to 2, -1 to -2)
        val offset = (WorldGenerator.hashUnit(seed, "native-village") * directions.size).toInt().coerceIn(0, directions.lastIndex)
        val ordered = directions.drop(offset) + directions.take(offset)
        for ((chunkX, chunkY) in ordered) {
            val x = chunkX * WorldGenerator.CHUNK_SIZE + 8
            val y = chunkY * WorldGenerator.CHUNK_SIZE + 8
            val terrain = WorldGenerator.sample(seed, x.toDouble(), y.toDouble())
            if (terrain.height >= 0.32 && terrain.biome !in setOf("lagoon", "mangrove")) return Coordinates(x, y)
        }
        return Coordinates(24, 24)
    }

    fun outpostCenters(seed: String): List<Coordinates> {
        val candidates = listOf(3 to -1, -3 to 2, 2 to 3, -2 to -3, 4 to 1, -4 to -1)
        val rotation = (WorldGenerator.hashUnit(seed, "native-outposts") * candidates.size).toInt().coerceIn(0, candidates.lastIndex)
        return (candidates.drop(rotation) + candidates.take(rotation)).mapNotNull { (chunkX, chunkY) ->
            val origin = Coordinates(chunkX * WorldGenerator.CHUNK_SIZE + 8, chunkY * WorldGenerator.CHUNK_SIZE + 8)
            val offsets = listOf(0 to 0, -2 to 0, 2 to 0, 0 to -2, 0 to 2, -3 to -3, 3 to 3, -3 to 3, 3 to -3)
            offsets.map { (dx, dy) -> Coordinates(origin.x + dx, origin.y + dy) }.firstOrNull { center ->
                listOf(0 to 0, -2 to 0, 2 to 0, 0 to -2, 0 to 2).all { (dx, dy) ->
                    val sample = WorldGenerator.sample(seed, (center.x + dx).toDouble(), (center.y + dy).toDouble())
                    sample.height >= .28 && sample.biome !in setOf("lagoon", "deep-water")
                }
            }
        }.distinct().take(2)
    }

    private fun cardinalPath(vararg waypoints: Coordinates): List<Coordinates> {
        if (waypoints.isEmpty()) return emptyList()
        val result = linkedSetOf(waypoints.first())
        var current = waypoints.first()
        waypoints.drop(1).forEach { target ->
            while (current.x != target.x) {
                current = Coordinates(current.x + if (target.x > current.x) 1 else -1, current.y)
                result += current
            }
            while (current.y != target.y) {
                current = Coordinates(current.x, current.y + if (target.y > current.y) 1 else -1)
                result += current
            }
        }
        return result.toList()
    }

    fun villageRoadCells(center: Coordinates): Set<Coordinates> = (
        cardinalPath(
            Coordinates(center.x - 7, center.y + 2), Coordinates(center.x - 5, center.y + 2),
            Coordinates(center.x - 5, center.y + 1), Coordinates(center.x - 2, center.y + 1),
            Coordinates(center.x - 2, center.y), Coordinates(center.x + 2, center.y),
            Coordinates(center.x + 2, center.y - 1), Coordinates(center.x + 5, center.y - 1),
            Coordinates(center.x + 5, center.y), Coordinates(center.x + 7, center.y),
        ) + cardinalPath(
            Coordinates(center.x - 1, center.y - 7), Coordinates(center.x - 1, center.y - 4),
            Coordinates(center.x, center.y - 4), Coordinates(center.x, center.y - 1),
            Coordinates(center.x + 1, center.y - 1), Coordinates(center.x + 1, center.y + 2),
            Coordinates(center.x, center.y + 2), Coordinates(center.x, center.y + 6),
        )
    ).toSet()

    fun outpostRoadCells(center: Coordinates): Set<Coordinates> = (
        cardinalPath(Coordinates(center.x - 3, center.y + 1), Coordinates(center.x, center.y + 1), Coordinates(center.x, center.y - 2)) +
            cardinalPath(Coordinates(center.x, center.y), Coordinates(center.x + 3, center.y))
    ).toSet()

    fun isSettlementEntity(entity: Entity): Boolean = entity.id.startsWith("village-") || entity.id.startsWith("outpost-")
    fun isPlayerOwned(entity: Entity): Boolean = !isSettlementEntity(entity)

    fun ensureStarter(save: GameSave): GameSave {
        if (save.milestones[VILLAGE_MILESTONE] == true) return save
        val center = villageCenter(save.seed)
        val entities = save.entities.toMutableMap()
        val builder = entities[BUILDER_ID]
        val awaitingFirstMeeting = save.milestones[ATUO_MET_MILESTONE] != true &&
            save.milestones[ATUO_TALKED_MILESTONE] != true
        if (builder == null) {
            entities[BUILDER_ID] = Entity(
                BUILDER_ID, BUILDER_TYPE, STARTER_GUIDE_POSITION,
                if (awaitingFirstMeeting) ATUO_INJURED_DURABILITY else 100, 100,
            )
        } else if (!isRecruited(save)) {
            entities[BUILDER_ID] = builder.copy(
                coordinates = STARTER_GUIDE_POSITION,
                durability = if (awaitingFirstMeeting) minOf(builder.durability, ATUO_INJURED_DURABILITY) else builder.durability,
            )
        }
        fun villageEntity(id: String, type: String, coordinates: Coordinates, durability: Int, max: Int) {
            entities[id] = entities[id]?.copy(coordinates = coordinates) ?: Entity(id, type, coordinates, durability, max)
        }
        villageEntity(TRADER_ID, TRADER_TYPE, Coordinates(center.x + 2, center.y - 1), 100, 100)
        villageEntity(FARMER_ID, FARMER_TYPE, Coordinates(center.x - 3, center.y + 2), 100, 100)
        // Keep building footprints beside the roads, never centered on them. The
        // asymmetric spacing also makes the village read as a lived-in settlement.
        villageEntity("village-shelter", "shelter", Coordinates(center.x - 5, center.y - 3), 500, 500)
        villageEntity("village-workbench", "workbench", Coordinates(center.x + 4, center.y - 2), 300, 300)
        villageEntity("village-campfire", "campfire", Coordinates(center.x + 2, center.y + 4), 120, 120)
        villageEntity("village-storage", "storage-crate", Coordinates(center.x + 5, center.y + 4), 220, 220)
        villageEntity("village-garden", "garden-plot", Coordinates(center.x - 5, center.y + 4), 180, 180)
        villageEntity("village-drying", "drying-shed", Coordinates(center.x + 5, center.y - 5), 240, 240)
        villageEntity("village-mat", "straw-mat", Coordinates(center.x - 3, center.y - 6), 100, 100)
        villageRoadCells(center).forEach { coordinates ->
            val id = "village-road-${coordinates.x}-${coordinates.y}"
            villageEntity(id, "road-segment", coordinates, 90, 90)
        }
        outpostCenters(save.seed).forEachIndexed { index, outpost ->
            val number = index + 1
            villageEntity("outpost-survivor-$number", WANDERER_TYPE, Coordinates(outpost.x, outpost.y - 1), 100, 100)
            villageEntity("outpost-$number-shelter", "shelter", Coordinates(outpost.x - 3, outpost.y - 2), 420, 500)
            villageEntity("outpost-$number-fire", "campfire", Coordinates(outpost.x + 2, outpost.y + 2), 90, 120)
            villageEntity("outpost-$number-storage", "storage-crate", Coordinates(outpost.x + 3, outpost.y - 2), 170, 220)
            villageEntity("outpost-$number-mat", "straw-mat", Coordinates(outpost.x - 2, outpost.y + 2), 80, 100)
            outpostRoadCells(outpost).forEach { coordinates ->
                villageEntity("outpost-$number-road-${coordinates.x}-${coordinates.y}", "road-segment", coordinates, 72, 90)
            }
        }
        return save.copy(entities = entities, milestones = save.milestones + (VILLAGE_MILESTONE to true))
    }

    fun isRecruited(save: GameSave): Boolean = save.milestones["villager:$BUILDER_ID:recruited"] == true

    fun needsFirstEncounter(save: GameSave): Boolean =
        save.milestones[ATUO_MET_MILESTONE] != true && save.milestones[ATUO_TALKED_MILESTONE] != true

    fun beginFirstEncounter(save: GameSave): GameSave {
        if (!needsFirstEncounter(save)) return save
        val builder = save.entities[BUILDER_ID]
        val entities = if (builder == null) save.entities else save.entities + (
            BUILDER_ID to builder.copy(durability = minOf(builder.durability, ATUO_INJURED_DURABILITY))
        )
        return save.copy(
            entities = entities,
            milestones = save.milestones + mapOf(
                ATUO_MET_MILESTONE to true,
                ATUO_TALKED_MILESTONE to true,
                "tutorial:atuo-first-scene" to true,
            ),
        )
    }

    fun firstEncounterDialogue(): String =
        "阿拓扶着受伤的肋侧，残骸划开的伤口让湿透的袖口还渗着血。\n\n" +
            "“你总算醒了……别急着往林子深处走。潮水在涨，天黑前我们得先点起火。”\n\n" +
            "“海滩附近有树枝和海蚀石，棕榈下能扯到纤维。你去找材料，我守着残骸。”"

    fun isVillager(type: String): Boolean = type in setOf(BUILDER_TYPE, TRADER_TYPE, FARMER_TYPE, WANDERER_TYPE)
    fun name(entity: Entity): String = when (entity.type) {
        TRADER_TYPE -> "岚商"
        FARMER_TYPE -> "禾姨"
        WANDERER_TYPE -> if (entity.id.endsWith("2")) "潮生" else "砾舟"
        else -> "阿拓"
    }
    fun role(entity: Entity): String = when (entity.type) {
        TRADER_TYPE -> "海岛商人"
        FARMER_TYPE -> "村庄种植者"
        WANDERER_TYPE -> "流浪幸存者"
        else -> "营地建造者"
    }

    fun localDialogue(entity: Entity, question: String, recruited: Boolean): String {
        val text = question.trim()
        return when {
            text.contains("路") || text.contains("村") -> when (entity.type) {
                TRADER_TYPE -> "沿着夯土路走，岔路通向农田和旧码头；雾里还可能有别的聚落。"
                FARMER_TYPE -> "路边要留出田埂，别把工作台和大棚压在主路上。"
                else -> "树枝和海蚀石能在工作台做夯土路。路要一段接一段铺，别堵住门口。"
            }
            text.contains("吃") || text.contains("饿") -> "把食物放进快捷栏并选中，点带着食物图标的“进食”按钮；椰子和浆果也能直接吃。"
            text.contains("水") || text.contains("渴") -> "椰子只能应急，长期还是要找淡水、接雨或把水煮过。"
            text.contains("加入") || text.contains("招募") -> when {
                entity.type == WANDERER_TYPE -> "我还没打算搬进营地，但不影响我们交谈、换物资，或互通雾外的路。"
                recruited -> "我已经是营地的一员了，搬运和修理可以交给我。"
                else -> "先准备床位、10份食物和10份淡水；现在也可以随时和我说话。"
            }
            entity.type == TRADER_TYPE -> "岚商掂了掂腰间的贝币：矿石、路线和交易都能谈，但货物必须从岛上真的找到。"
            entity.type == FARMER_TYPE -> "禾姨拨开湿土看了看：作物缺水就会停长，收获时别忘了留下一份种子。"
            entity.type == WANDERER_TYPE -> "他朝旧路尽头望去：这座小基地只够挡一夜风，雾后也许还有别的幸存者。"
            else -> "阿拓把工具靠在一旁：我还没加入也能聊。先说你卡在采集、建造，还是想找一条能走远的路。"
        }
    }

    fun advanceResidents(save: GameSave): GameSave {
        val center = villageCenter(save.seed)
        val phase = (save.day * 144 + save.time / 10)
        val offsets = listOf(0 to 0, 2 to -2, -2 to 2)
        val ids = listOf(BUILDER_ID, TRADER_ID, FARMER_ID) + outpostCenters(save.seed).indices.map { "outpost-survivor-${it + 1}" }
        val entities = save.entities.toMutableMap()
        ids.forEachIndexed { index, id ->
            val entity = entities[id] ?: return@forEachIndexed
            if (id == BUILDER_ID) {
                if (isRecruited(save)) return@forEachIndexed
                if (entity.durability < entity.maxDurability) {
                    entities[id] = entity.copy(coordinates = STARTER_GUIDE_POSITION)
                    return@forEachIndexed
                }
                val step = ((phase + index * 2) % 8 + 8) % 8
                val walk = listOf(0 to 0, 1 to 0, 1 to 1, 0 to 1, 0 to 0, -1 to 0, -1 to -1, 0 to -1)[step]
                entities[id] = entity.copy(coordinates = Coordinates(STARTER_GUIDE_POSITION.x + walk.first, STARTER_GUIDE_POSITION.y + walk.second))
                return@forEachIndexed
            }
            val outpostIndex = id.removePrefix("outpost-survivor-").toIntOrNull()?.minus(1)
            val outpost = outpostIndex?.let { outpostCenters(save.seed).getOrNull(it) }
            val base = if (outpost == null) offsets[index] else (outpost.x - center.x) to (outpost.y - center.y - 1)
            val step = ((phase + index * 2) % 8 + 8) % 8
            val walk = listOf(0 to 0, 1 to 0, 1 to 1, 0 to 1, 0 to 0, -1 to 0, -1 to -1, 0 to -1)[step]
            entities[id] = entity.copy(coordinates = Coordinates(center.x + base.first + walk.first, center.y + base.second + walk.second))
        }
        return if (entities == save.entities) save else save.copy(entities = entities)
    }

    fun trade(save: GameSave, npcType: String, offerId: String): GameSave {
        val offers = when (npcType) {
            TRADER_TYPE -> mapOf(
                "stone-for-millet" to Triple(mapOf("stone" to 3), "millet-seed", 2),
                "iron-for-repair" to Triple(mapOf("iron-ore" to 1), "repair-kit", 1),
                "sell-iron" to Triple(mapOf("iron-ore" to 1), "shell-token", 5),
                "sell-quartz" to Triple(mapOf("quartz" to 2), "shell-token", 4),
                "tokens-for-rope" to Triple(mapOf("shell-token" to 3), "rope", 1),
            )
            FARMER_TYPE -> mapOf(
                "berry-for-herb" to Triple(mapOf("berry" to 3), "herb-seed", 2),
                "coconut-for-taro" to Triple(mapOf("coconut" to 2), "taro-seed", 2),
                "sell-food" to Triple(mapOf("coconut" to 2), "shell-token", 2),
                "sell-herb" to Triple(mapOf("herb" to 3), "shell-token", 3),
                "tokens-for-taro" to Triple(mapOf("shell-token" to 2), "taro-seed", 2),
            )
            WANDERER_TYPE -> mapOf(
                "sell-branches" to Triple(mapOf("branch" to 4), "shell-token", 1),
                "tokens-for-coconut" to Triple(mapOf("shell-token" to 2), "coconut", 1),
            )
            else -> emptyMap()
        }
        val (cost, output, amount) = offers[offerId] ?: error("这位居民没有这项交易")
        cost.forEach { (id, required) -> require((save.inventory[id] ?: 0) >= required) { "材料不足" } }
        val inventory = save.inventory.toMutableMap()
        cost.forEach { (id, required) ->
            val next = inventory.getValue(id) - required
            if (next == 0) inventory.remove(id) else inventory[id] = next
        }
        inventory[output] = (inventory[output] ?: 0) + amount
        return save.copy(inventory = inventory, milestones = save.milestones + ("trade:$offerId" to true))
    }

    fun recruit(save: GameSave, foodIds: Set<String>): GameSave {
        require(!isRecruited(save)) { "阿拓已经加入营地" }
        require(save.entities.values.any { isPlayerOwned(it) && it.type in ShelterRules.usableTypes }) { "先准备一处自己的床位或庇护所" }
        require((save.inventory["fresh-water"] ?: 0) >= 10) { "招募需要 10 份淡水" }
        val availableFood = foodIds.sumOf { save.inventory[it] ?: 0 }
        require(availableFood >= 10) { "招募需要 10 份食物" }
        val inventory = save.inventory.toMutableMap()
        inventory["fresh-water"] = inventory.getValue("fresh-water") - 10
        if (inventory["fresh-water"] == 0) inventory.remove("fresh-water")
        var remaining = 10
        foodIds.sorted().forEach { id ->
            if (remaining <= 0) return@forEach
            val used = minOf(inventory[id] ?: 0, remaining)
            if (used > 0) {
                val next = (inventory[id] ?: 0) - used
                if (next == 0) inventory.remove(id) else inventory[id] = next
                remaining -= used
            }
        }
        return save.copy(
            inventory = inventory,
            milestones = save.milestones + ("villager:$BUILDER_ID:recruited" to true),
        )
    }

    fun haul(save: GameSave, itemMasses: Map<String, Double>): GameSave {
        require(isRecruited(save)) { "先邀请阿拓加入营地" }
        val crate = save.entities.values.firstOrNull { it.type == "storage-crate" }
            ?: error("先放置一个储物箱")
        val itemId = save.inventory.filterValues { it > 0 }.keys
            .filterNot { it == "fresh-water" }
            .maxByOrNull { itemMasses[it] ?: 1.0 }
            ?: error("背包里没有可搬运的材料")
        val amount = minOf(4, save.inventory[itemId] ?: 0)
        val inventory = save.inventory.toMutableMap()
        val next = inventory.getValue(itemId) - amount
        if (next == 0) inventory.remove(itemId) else inventory[itemId] = next
        val stored = save.containerInventories[crate.id].orEmpty().toMutableMap()
        stored[itemId] = (stored[itemId] ?: 0) + amount
        return save.copy(
            inventory = inventory,
            containerInventories = save.containerInventories + (crate.id to stored),
            milestones = save.milestones + ("villager:$BUILDER_ID:haul" to true),
        )
    }

    fun repair(save: GameSave): GameSave {
        require(isRecruited(save)) { "先邀请阿拓加入营地" }
        require((save.inventory["repair-kit"] ?: 0) > 0) { "需要一份修理包" }
        val target = save.entities.values.filterNot { it.type == BUILDER_TYPE }
            .minByOrNull { it.durability.toDouble() / it.maxDurability.coerceAtLeast(1) }
            ?.takeIf { it.durability < it.maxDurability }
            ?: error("营地里没有需要修理的设施")
        val inventory = save.inventory.toMutableMap()
        val next = inventory.getValue("repair-kit") - 1
        if (next == 0) inventory.remove("repair-kit") else inventory["repair-kit"] = next
        return save.copy(
            inventory = inventory,
            entities = save.entities + (target.id to target.copy(durability = minOf(target.maxDurability, target.durability + 20))),
            milestones = save.milestones + ("villager:$BUILDER_ID:repair" to true),
        )
    }
}
