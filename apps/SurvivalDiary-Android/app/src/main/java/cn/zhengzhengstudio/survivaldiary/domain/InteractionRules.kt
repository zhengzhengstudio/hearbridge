package cn.zhengzhengstudio.survivaldiary.domain

object HotbarRules {
    const val SLOT_COUNT = 8

    fun initial(inventory: Map<String, Int>): List<String?> =
        inventory.filterValues { it > 0 }.keys.take(SLOT_COUNT).map<String, String?> { it }
            .let { it + List(SLOT_COUNT - it.size) { null } }

    fun normalize(slots: List<String?>, inventory: Map<String, Int>): List<String?> =
        List(SLOT_COUNT) { index -> slots.getOrNull(index)?.takeIf { (inventory[it] ?: 0) > 0 } }

    fun assign(slots: List<String?>, slot: Int, itemId: String, inventory: Map<String, Int>): List<String?> {
        require(slot in 0 until SLOT_COUNT) { "快捷栏位置无效" }
        require((inventory[itemId] ?: 0) > 0) { "背包里没有这个物品" }
        return normalize(slots, inventory).toMutableList().apply {
            for (index in indices) if (this[index] == itemId) this[index] = null
            this[slot] = itemId
        }
    }

    fun remove(slots: List<String?>, slot: Int): List<String?> =
        List(SLOT_COUNT) { index -> if (index == slot) null else slots.getOrNull(index) }
}

object ShelterRules {
    val usableTypes = setOf("shelter", "straw-mat", "hammock", "simple-bed", "camp-bed", "wooden-bed")

    fun rest(save: GameSave, type: String): GameSave {
        require(type in usableTypes) { "这个建筑不能休息" }
        val minutesToDawn = if (save.time < 360) 360 - save.time else 1_440 - save.time + 360
        val healthy = save.vitals.hunger >= 20.0 && save.vitals.hydration >= 20.0
        return save.copy(
            day = save.day + (save.time + minutesToDawn) / 1_440,
            time = (save.time + minutesToDawn) % 1_440,
            elapsedGameMinutes = save.elapsedGameMinutes + minutesToDawn,
            vitals = save.vitals.copy(
                health = (save.vitals.health + if (healthy) 8.0 else 0.0).coerceAtMost(100.0),
                stamina = (save.vitals.stamina + 55.0).coerceAtMost(100.0),
                hunger = (save.vitals.hunger - 10.0).coerceAtLeast(0.0),
                hydration = (save.vitals.hydration - 12.0).coerceAtLeast(0.0),
            ),
            milestones = save.milestones + ("used:$type" to true) + ("slept:any" to true),
        )
    }
}

/** Native transport rules shared by the Android HUD and world renderer.
 * The save model deliberately stores the current boat occupancy in milestones so
 * existing 0.6.x saves remain readable without a destructive schema migration.
 */
object TransportRules {
    private const val ABOARD_PREFIX = "transport:aboard:"
    private const val MINECART_ABOARD_PREFIX = "transport:minecart-aboard:"
    private const val TRANSPORT_BOOTSTRAP = "nativeTransportBootstrapVersion:2"
    val interactiveTypes = setOf("rowboat", "minecart", "rail-segment")

    fun ensureStarter(save: GameSave): GameSave {
        if (save.milestones[TRANSPORT_BOOTSTRAP] == true) return save

        // Industrial transport belongs to later progression. Earlier builds put a
        // minecart and two rails under A-Tuo at the tutorial spawn, which obscured
        // both characters and taught the production chain in the wrong order.
        val entities = save.entities - setOf("starter-rail-1", "starter-rail-2", "starter-minecart")
        val shore = starterShoreline(save.seed)
        val boat = (entities["starter-rowboat"] ?: Entity("starter-rowboat", "rowboat", shore)).copy(coordinates = shore)
        return save.copy(
            entities = entities + (boat.id to boat),
            milestones = save.milestones +
                ("nativeTransportBootstrapVersion:1" to true) +
                ("nativeRailStarterVersion:1" to true) +
                (TRANSPORT_BOOTSTRAP to true),
        )
    }

    private fun starterShoreline(seed: String): Coordinates {
        val origin = Coordinates(8, 8)
        // Keep the boat discoverable, but outside the first interaction radius so
        // “talk to A-Tuo” is not replaced by an unrelated board-boat button.
        for (radius in 5..24) {
            for (y in origin.y - radius..origin.y + radius) {
                for (x in origin.x - radius..origin.x + radius) {
                    if (kotlin.math.max(kotlin.math.abs(x - origin.x), kotlin.math.abs(y - origin.y)) != radius) continue
                    val sample = WorldGenerator.sample(seed, x.toDouble(), y.toDouble())
                    if (sample.biome != "lagoon") continue
                    val besideLand = listOf(x - 1 to y, x + 1 to y, x to y - 1, x to y + 1).any { (nearX, nearY) ->
                        WorldGenerator.sample(seed, nearX.toDouble(), nearY.toDouble()).height >= 0.3
                    }
                    if (besideLand) return Coordinates(x, y)
                }
            }
        }
        return Coordinates(7, 10)
    }

    fun aboardBoatId(save: GameSave): String? = save.milestones.entries
        .firstOrNull { (key, enabled) -> enabled && key.startsWith(ABOARD_PREFIX) }
        ?.key?.removePrefix(ABOARD_PREFIX)

    fun aboardMinecartId(save: GameSave): String? = save.milestones.entries
        .firstOrNull { (key, enabled) -> enabled && key.startsWith(MINECART_ABOARD_PREFIX) }
        ?.key?.removePrefix(MINECART_ABOARD_PREFIX)

    fun toggleBoat(save: GameSave, boat: Entity): GameSave {
        require(boat.type == "rowboat") { "这不是可乘坐的船" }
        val aboard = aboardBoatId(save)
        val cleared = save.milestones.filterKeys {
            !it.startsWith(ABOARD_PREFIX) && !it.startsWith(MINECART_ABOARD_PREFIX)
        }
        return if (aboard == boat.id) {
            save.copy(
                players = save.players + ("local" to (save.players["local"] ?: PlayerRecord("local", boat.coordinates.toPlayerPosition()))
                    .copy(position = PlayerPosition(boat.coordinates.x + 1.0, boat.coordinates.y.toDouble()))),
                milestones = cleared + ("used:rowboat" to true),
            )
        } else {
            save.copy(
                players = save.players + ("local" to (save.players["local"] ?: PlayerRecord("local", boat.coordinates.toPlayerPosition()))
                    .copy(position = boat.coordinates.toPlayerPosition())),
                milestones = cleared + ("$ABOARD_PREFIX${boat.id}" to true) + ("used:rowboat" to true),
            )
        }
    }

    fun toggleMinecart(save: GameSave, cart: Entity): GameSave {
        require(cart.type == "minecart") { "这不是矿车" }
        val rails = save.entities.values.filter { it.type == "rail-segment" }.mapTo(mutableSetOf()) { it.coordinates }
        require(cart.coordinates in rails) { "矿车没有落在轨道上" }
        val aboard = aboardMinecartId(save)
        val cleared = save.milestones.filterKeys {
            !it.startsWith(ABOARD_PREFIX) && !it.startsWith(MINECART_ABOARD_PREFIX)
        }
        return if (aboard == cart.id) {
            val exit = listOf(
                Coordinates(cart.coordinates.x + 1, cart.coordinates.y),
                Coordinates(cart.coordinates.x - 1, cart.coordinates.y),
                Coordinates(cart.coordinates.x, cart.coordinates.y + 1),
                Coordinates(cart.coordinates.x, cart.coordinates.y - 1),
            ).firstOrNull { candidate ->
                WorldGenerator.sample(save.seed, candidate.x.toDouble(), candidate.y.toDouble()).biome !in setOf("lagoon", "deep-water") &&
                    save.entities.values.none { it.id != cart.id && it.type !in setOf("road-segment", "rail-segment") && it.coordinates == candidate }
            } ?: cart.coordinates
            save.withPlayerPosition("local", exit.toPlayerPosition()).copy(
                milestones = cleared + ("used:minecart" to true),
            )
        } else {
            save.withPlayerPosition("local", cart.coordinates.toPlayerPosition()).copy(
                milestones = cleared + ("$MINECART_ABOARD_PREFIX${cart.id}" to true) + ("used:minecart" to true),
            )
        }
    }

    fun advanceMinecart(save: GameSave, cart: Entity): GameSave {
        require(cart.type == "minecart") { "这不是矿车" }
        require(aboardMinecartId(save) == cart.id) { "请先乘上矿车" }
        val rails = save.entities.values.filter { it.type == "rail-segment" }.mapTo(mutableSetOf()) { it.coordinates }
        require(cart.coordinates in rails) { "矿车没有落在轨道上" }
        val options = listOf(
            Triple(Coordinates(cart.coordinates.x + 1, cart.coordinates.y), 0, 0),
            Triple(Coordinates(cart.coordinates.x, cart.coordinates.y + 1), 90, 1),
            Triple(Coordinates(cart.coordinates.x - 1, cart.coordinates.y), 180, 2),
            Triple(Coordinates(cart.coordinates.x, cart.coordinates.y - 1), 270, 3),
        ).filter { (candidate) ->
            candidate in rails && save.entities.values.none {
                it.type == "minecart" && it.id != cart.id && it.coordinates == candidate
            }
        }
        val reverse = (cart.rotation + 180).mod(360)
        val chosen = options.firstOrNull { it.second == cart.rotation.mod(360) }
            ?: options.firstOrNull { it.second != reverse }
            ?: options.firstOrNull()
            ?: throw IllegalStateException("轨道没有连续到下一格")
        val movedCart = cart.copy(coordinates = chosen.first, rotation = chosen.second)
        return save.copy(
            entities = save.entities + (cart.id to movedCart),
            players = save.players + ("local" to (save.players["local"] ?: PlayerRecord("local", chosen.first.toPlayerPosition()))
                .copy(position = chosen.first.toPlayerPosition())),
            milestones = save.milestones + ("used:minecart" to true),
        )
    }
}

object InteractionTargetRules {
    fun priority(type: String): Int = when {
        NativeNpcRules.isVillager(type) -> 0
        type in ShelterRules.usableTypes || type in setOf("storage-crate", "workbench", "furnace", "farm-plot", "garden-plot") -> 1
        type in setOf("rowboat", "minecart") -> 2
        type == "rail-segment" -> 3
        else -> 4
    }
}

object BiomePresentation {
    private val names = mapOf(
        "lagoon" to "浅海泻湖", "palm-grove" to "棕榈海岸", "basalt-ridge" to "玄武岩脊",
        "mangrove" to "红树林", "cloud-forest" to "云雾林", "dry-savanna" to "风干草原",
        "limestone-upland" to "石灰岩台地", "ruins" to "潮汐遗迹",
    )
    private val colors = mapOf(
        "lagoon" to 0xFF2E8797.toInt(), "palm-grove" to 0xFF7D9A62.toInt(), "basalt-ridge" to 0xFF695F59.toInt(),
        "mangrove" to 0xFF315F4A.toInt(), "cloud-forest" to 0xFF527667.toInt(), "dry-savanna" to 0xFFB49A58.toInt(),
        "limestone-upland" to 0xFFB3AA87.toInt(), "ruins" to 0xFF877C70.toInt(),
    )
    fun name(id: String): String = names[id] ?: id
    fun mapColor(id: String): Int = colors[id] ?: 0xFF6F806E.toInt()
}

object SaveLifecycle {
    fun initial(saved: GameSave?, fresh: () -> GameSave): GameSave = saved ?: fresh()
}

object StarterResourcePolicy {
    val minimumCounts = linkedMapOf(
        "stone" to 3,
        "branch" to 2,
        "palm-fiber" to 4,
        "fresh-water" to 2,
        "coconut" to 1,
    )
    val requiredItems = LinkedHashSet(minimumCounts.keys)

    fun missingAmounts(available: Map<String, Int>): Map<String, Int> = minimumCounts.mapNotNull { (itemId, minimum) ->
        val missing = minimum - (available[itemId] ?: 0).coerceAtLeast(0)
        if (missing > 0) itemId to missing else null
    }.toMap(LinkedHashMap())
}
