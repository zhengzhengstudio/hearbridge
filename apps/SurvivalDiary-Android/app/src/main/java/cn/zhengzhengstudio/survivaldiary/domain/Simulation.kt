package cn.zhengzhengstudio.survivaldiary.domain

import java.math.BigDecimal
import java.nio.ByteBuffer
import java.security.MessageDigest
import kotlin.math.floor
import kotlin.math.round

sealed interface GameCommand {
    data class DiscoverRegion(val coordinates: Coordinates) : GameCommand
    data class AdvanceTime(val minutes: Int) : GameCommand
    data class SetPlayMode(val playMode: PlayMode) : GameCommand
    data class Gather(val itemId: String, val amount: Int) : GameCommand
    data class Craft(val recipeId: String) : GameCommand
    data class Place(val entityId: String, val itemId: String, val coordinates: Coordinates, val rotation: Int = 0) : GameCommand
    data class Repair(val entityId: String, val amount: Int) : GameCommand
    data class Dismantle(val entityId: String) : GameCommand
    data class WriteDiary(val entryId: String, val text: String) : GameCommand
}

object Simulation {
    private data class Biome(val id: String, val resources: List<String>)
    private data class WeatherKind(val id: String, val min: Double, val max: Double, val wetness: Double, val wind: Double)
    private val biomes = listOf(
        Biome("lagoon", listOf("shell", "reef-fish", "fresh-water")),
        Biome("palm-grove", listOf("driftwood", "fiber", "fresh-water")),
        Biome("basalt-ridge", listOf("stone", "fiber")),
        Biome("mangrove", listOf("driftwood", "fiber", "reef-fish")),
        Biome("ruins", listOf("stone", "shell")),
    )
    private val weatherKinds = listOf(
        WeatherKind("clear", 0.0, 1.0, 0.0, 0.15), WeatherKind("cloudy", 0.0, 1.0, 0.05, 0.25),
        WeatherKind("fog", 0.2, 0.8, 0.2, 0.08), WeatherKind("rain", 0.25, 1.0, 0.8, 0.45),
        WeatherKind("storm", 0.3, 1.0, 1.0, 0.9), WeatherKind("snow", 0.0, 0.35, 0.5, 0.3),
        WeatherKind("blizzard", 0.0, 0.2, 0.85, 1.0),
    )

    fun create(seed: String, playMode: PlayMode = PlayMode.GUIDED): GameSave {
        require(seed.isNotBlank())
        return GameSave(schemaVersion = 2, seed = seed, playMode = playMode)
    }

    fun step(save: GameSave, command: GameCommand): GameSave = when (command) {
        is GameCommand.DiscoverRegion -> {
            val region = createRegion(save.seed, command.coordinates)
            save.copy(regions = save.regions + (region.id to region), weather = weatherFor(save.seed, save.day, save.time, region))
        }
        is GameCommand.AdvanceTime -> {
            require(command.minutes > 0)
            val elapsed = save.time + command.minutes
            val day = save.day + elapsed / 1440
            val time = elapsed % 1440
            val climate = createRegion(save.seed, Coordinates(0, 0))
            save.copy(day = day, time = time, weather = weatherFor(save.seed, day, time, climate))
        }
        is GameCommand.SetPlayMode -> save.copy(playMode = command.playMode)
        is GameCommand.Gather -> {
            require(command.itemId.isNotBlank() && command.amount > 0)
            save.copy(inventory = add(save.inventory, command.itemId, command.amount))
        }
        is GameCommand.Craft -> {
            val recipe = when (command.recipeId) {
                "craft-fishing-rod" -> mapOf("driftwood" to 2, "fiber" to 3) to ("fishing-rod" to 1)
                "craft-stone-axe" -> mapOf("driftwood" to 2, "stone" to 2, "fiber" to 1) to ("stone-axe" to 1)
                "build-campfire" -> mapOf("driftwood" to 3, "stone" to 4) to ("campfire" to 1)
                else -> error("unknown recipe")
            }
            require(recipe.first.all { (id, count) -> (save.inventory[id] ?: 0) >= count }) { "insufficient ingredients" }
            var inventory = save.inventory
            recipe.first.forEach { (id, count) -> inventory = add(inventory, id, -count) }
            inventory = add(inventory, recipe.second.first, recipe.second.second)
            save.copy(inventory = inventory)
        }
        is GameCommand.Place -> {
            require((save.inventory[command.itemId] ?: 0) > 0 && command.entityId !in save.entities)
            val entity = Entity(command.entityId, command.itemId, command.coordinates, rotation = command.rotation.mod(360))
            save.copy(
                inventory = add(save.inventory, command.itemId, -1),
                entities = save.entities + (entity.id to entity),
                containerInventories = if (command.itemId == "storage-crate") save.containerInventories + (entity.id to emptyMap()) else save.containerInventories,
            )
        }
        is GameCommand.Repair -> {
            require(command.amount > 0)
            val entity = save.entities[command.entityId] ?: error("entity not found")
            save.copy(entities = save.entities + (entity.id to entity.copy(durability = minOf(entity.maxDurability, entity.durability + command.amount))))
        }
        is GameCommand.Dismantle -> {
            val entity = save.entities[command.entityId] ?: error("entity not found")
            require(save.containerInventories[entity.id].orEmpty().values.none { it > 0 }) { "container is not empty" }
            val process = save.facilityProcesses[entity.id]
            require(process == null || (process.status == FurnaceStatus.IDLE && process.output.values.none { it > 0 })) { "facility is not empty" }
            save.copy(
                entities = save.entities - entity.id,
                inventory = add(save.inventory, entity.type, 1),
                containerInventories = save.containerInventories - entity.id,
                facilityProcesses = save.facilityProcesses - entity.id,
            )
        }
        is GameCommand.WriteDiary -> save.copy(journals = save.journals + (command.entryId to DiaryEntry(command.text)))
    }

    private fun add(source: Map<String, Int>, id: String, amount: Int): Map<String, Int> = source.toMutableMap().apply {
        val next = (this[id] ?: 0) + amount
        if (next == 0) remove(id) else this[id] = next
    }

    private fun createRegion(seed: String, c: Coordinates): Region {
        val elevation = rounded(hashNumber(seed, c.x, c.y, "elevation"))
        val moisture = rounded(hashNumber(seed, c.x, c.y, "moisture"))
        val temperature = rounded(hashNumber(seed, c.x, c.y, "temperature"))
        val biome = biomes[floor(hashNumber(seed, c.x, c.y, "biome") * biomes.size).toInt() % biomes.size]
        val resources = biome.resources.filterIndexed { index, item -> hashNumber(seed, c.x, c.y, item) > 0.32 || index == 0 }
        return Region("${c.x},${c.y}", c.x, c.y, biome.id, elevation, moisture, temperature, resources)
    }

    private fun weatherFor(seed: String, day: Int, time: Int, climate: Region): Weather {
        val bucket = time / 120
        val candidates = weatherKinds.filter { climate.temperature in it.min..it.max }.ifEmpty { listOf(weatherKinds.first()) }
        val kindHash = hashNumber(seed, day, bucket, climate.elevation, climate.moisture, climate.temperature, "weather-kind")
        val kind = candidates[floor(kindHash * candidates.size).toInt() % candidates.size]
        val intensity = rounded(hashNumber(seed, day, bucket, climate.elevation, climate.moisture, climate.temperature, "intensity"))
        return Weather(kind.id, intensity, rounded(kind.wetness * intensity), rounded(kind.wind * (0.5 + intensity / 2)))
    }

    private fun hashNumber(vararg parts: Any): Double {
        val digest = MessageDigest.getInstance("SHA-256").digest(parts.joinToString(":") { stableNumber(it) }.toByteArray())
        val unsigned = ByteBuffer.wrap(digest, 0, 4).int.toLong() and 0xffffffffL
        return unsigned.toDouble() / 0xffffffffL.toDouble()
    }
    private fun rounded(value: Double) = round(value * 10_000.0) / 10_000.0
    private fun stableNumber(value: Any) = if (value is Double) number(value) else value.toString()
    private fun number(value: Double): String = BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
}

fun GameSave.stableDigest(): String {
    fun quote(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    fun num(value: Double) = BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
    fun stringMap(map: Map<String, Int>) = map.toSortedMap().entries.joinToString(",", "{", "}") { quote(it.key) + ":" + it.value }
    fun regions(map: Map<String, Region>) = map.toSortedMap().entries.joinToString(",", "{", "}") { (key, r) ->
        quote(key) + ":{" + listOf(
            "\"biomeId\":" + quote(r.biomeId), "\"elevation\":" + num(r.elevation), "\"id\":" + quote(r.id),
            "\"moisture\":" + num(r.moisture), "\"resources\":" + r.resources.joinToString(",", "[", "]") { quote(it) },
            "\"temperature\":" + num(r.temperature), "\"x\":" + r.x, "\"y\":" + r.y,
        ).joinToString(",") + "}"
    }
    fun journals(map: Map<String, DiaryEntry>) = map.toSortedMap().entries.joinToString(",", "{", "}") { quote(it.key) + ":{\"text\":" + quote(it.value.text) + "}" }
    fun entities(map: Map<String, Entity>) = map.toSortedMap().entries.joinToString(",", "{", "}") { (key, entity) ->
        quote(key) + ":{" + listOf(
            "\"coordinates\":{\"x\":${entity.coordinates.x},\"y\":${entity.coordinates.y}}",
            "\"durability\":${entity.durability}",
            "\"id\":" + quote(entity.id),
            "\"maxDurability\":${entity.maxDurability}",
            "\"type\":" + quote(entity.type),
        ).joinToString(",") + "}"
    }
    fun players(map: Map<String, PlayerRecord>) = map.toSortedMap().entries.joinToString(",", "{", "}") { (key, player) ->
        quote(key) + ":{" + listOf(
            "\"id\":" + quote(player.id),
            "\"inventory\":" + stringMap(player.inventory),
            "\"position\":{\"x\":${num(player.position.x)},\"y\":${num(player.position.y)}}",
        ).joinToString(",") + "}"
    }
    fun milestones(map: Map<String, Boolean>) = map.toSortedMap().entries.joinToString(",", "{", "}") { (key, value) ->
        quote(key) + ":" + value
    }
    val fields = sortedMapOf(
        "build" to build.toString(), "day" to day.toString(), "entities" to entities(entities), "inventory" to stringMap(inventory),
        "journals" to journals(journals), "milestones" to milestones(milestones), "playMode" to quote(playMode.name.lowercase()), "players" to players(players),
        "productVersion" to quote(productVersion), "regions" to regions(regions), "schemaVersion" to schemaVersion.toString(),
        "seed" to quote(seed), "time" to time.toString(),
        "weather" to "{\"intensity\":" + num(weather.intensity) + ",\"kind\":" + quote(weather.kind) + ",\"wetness\":" + num(weather.wetness) + ",\"wind\":" + num(weather.wind) + "}",
    )
    val json = fields.entries.joinToString(",", "{", "}") { quote(it.key) + ":" + it.value }
    return MessageDigest.getInstance("SHA-256").digest(json.toByteArray()).joinToString("") { "%02x".format(it) }
}
