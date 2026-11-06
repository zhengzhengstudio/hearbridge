package cn.zhengzhengstudio.survivaldiary.data

import android.content.Context
import cn.zhengzhengstudio.survivaldiary.domain.*
import java.io.File
import java.io.FileOutputStream
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class SaveRepository private constructor(private val directory: () -> File) {
    constructor(context: Context) : this({ context.filesDir })
    constructor(directory: File) : this({ directory })

    fun save(slot: String, save: GameSave) {
        validateSlot(slot)
        slotLock(slot).withLock { saveLocked(slot, save) }
    }

    private fun saveLocked(slot: String, save: GameSave) {
        val saveDirectory = directory()
        check(saveDirectory.exists() || saveDirectory.mkdirs()) { "save directory unavailable" }
        val current = file(slot, ".current")
        val previous = file(slot, ".previous")
        val nonce = UUID.randomUUID().toString()
        val pending = file(slot, ".pending-$nonce")
        val previousPending = file(slot, ".previous-$nonce")
        try {
            writeAndSync(pending, Json.encode(encode(save)))
            if (current.exists() && runCatching { decode(current.readText()) }.isSuccess) {
                Files.copy(current.toPath(), previousPending.toPath(), StandardCopyOption.REPLACE_EXISTING)
                syncFile(previousPending)
                atomicReplace(previousPending, previous)
            }
            atomicReplace(pending, current)
            syncDirectory(saveDirectory)
        } finally {
            pending.delete()
            previousPending.delete()
        }
    }

    fun load(slot: String): GameSave? {
        validateSlot(slot)
        return slotLock(slot).withLock {
            sequenceOf(file(slot, ".current"), file(slot, ".previous"))
                .filter(File::exists)
                .mapNotNull { runCatching { decode(it.readText()) }.getOrNull() }
                .firstOrNull()
        }
    }

    fun reset(slot: String) {
        validateSlot(slot)
        slotLock(slot).withLock {
            val prefix = "save-$slot."
            directory().listFiles().orEmpty().filter { it.name.startsWith(prefix) }.forEach(File::delete)
        }
    }

    fun importLegacyExport(exportedJson: String): GameSave = decode(exportedJson)

    private fun file(slot: String, suffix: String): File {
        return File(directory(), "save-$slot$suffix")
    }

    private fun validateSlot(slot: String) {
        require(slot.matches(Regex("[a-zA-Z0-9_-]+")))
    }

    private fun slotLock(slot: String): ReentrantLock {
        val key = "${directory().absoluteFile.normalize().path}:$slot"
        return locks.computeIfAbsent(key) { ReentrantLock() }
    }

    private fun writeAndSync(target: File, text: String) {
        FileOutputStream(target).use { output ->
            output.write(text.toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
    }

    private fun syncFile(target: File) {
        FileOutputStream(target, true).use { it.fd.sync() }
    }

    private fun atomicReplace(source: File, target: File) {
        try {
            Files.move(
                source.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun syncDirectory(target: File) {
        runCatching {
            FileChannel.open(target.toPath(), StandardOpenOption.READ).use { it.force(true) }
        }
    }

    companion object {
        private val locks = ConcurrentHashMap<String, ReentrantLock>()
    }

    private fun encode(save: GameSave): Map<String, Any?> = linkedMapOf(
        "schemaVersion" to 4,
        "productVersion" to save.productVersion,
        "build" to save.build,
        "seed" to save.seed,
        "playMode" to save.playMode.name.lowercase(),
        "day" to save.day,
        "time" to save.time,
        "elapsedGameMinutes" to save.elapsedGameMinutes,
        "phase" to save.phase,
        "weather" to linkedMapOf(
            "kind" to save.weather.kind,
            "intensity" to save.weather.intensity,
            "wetness" to save.weather.wetness,
            "wind" to save.weather.wind,
        ),
        "vitals" to linkedMapOf(
            "health" to save.vitals.health,
            "stamina" to save.vitals.stamina,
            "hunger" to save.vitals.hunger,
            "hydration" to save.vitals.hydration,
            "bodyTemperature" to save.vitals.bodyTemperature,
            "carriedMass" to save.vitals.carriedMass,
            "effects" to save.vitals.effects,
        ),
        "inventory" to sortedMap(save.inventory),
        "toolDurability" to sortedMap(save.toolDurability),
        "containerInventories" to sortedObjectMap(save.containerInventories) { sortedMap(it) },
        "facilityProcesses" to sortedObjectMap(save.facilityProcesses) { process ->
            linkedMapOf(
                "recipeId" to process.recipeId,
                "input" to sortedMap(process.input),
                "fuel" to sortedMap(process.fuel),
                "output" to sortedMap(process.output),
                "progressMinutes" to process.progressMinutes,
                "durationMinutes" to process.durationMinutes,
                "outputItemId" to process.outputItemId,
                "outputAmount" to process.outputAmount,
                "status" to process.status.name.lowercase(),
            )
        },
        "milestones" to sortedMap(save.milestones),
        "players" to sortedObjectMap(save.players) { player ->
            linkedMapOf(
                "id" to player.id,
                "position" to linkedMapOf("x" to player.position.x, "y" to player.position.y),
                "inventory" to sortedMap(player.inventory),
            )
        },
        "entities" to sortedObjectMap(save.entities) { entity ->
            linkedMapOf(
                "id" to entity.id,
                "type" to entity.type,
                "x" to entity.coordinates.x,
                "y" to entity.coordinates.y,
                "durability" to entity.durability,
                "maxDurability" to entity.maxDurability,
                "rotation" to entity.rotation,
            )
        },
        "journals" to sortedObjectMap(save.journals) { entry ->
            linkedMapOf("text" to entry.text, "facts" to entry.facts)
        },
        "discoveredChunks" to sortedObjectMap(save.discoveredChunks) { chunk ->
            linkedMapOf("x" to chunk.x, "y" to chunk.y, "visibility" to chunk.visibility)
        },
        "regions" to sortedObjectMap(save.regions) { region ->
            linkedMapOf(
                "id" to region.id,
                "x" to region.x,
                "y" to region.y,
                "biomeId" to region.biomeId,
                "elevation" to region.elevation,
                "moisture" to region.moisture,
                "temperature" to region.temperature,
                "resources" to region.resources,
            )
        },
        "resourceNodes" to sortedObjectMap(save.resourceNodes) { node ->
            linkedMapOf(
                "id" to node.id,
                "resourceId" to node.resourceId,
                "itemId" to node.itemId,
                "x" to node.x,
                "y" to node.y,
                "remaining" to node.remaining,
                "state" to node.state,
                "hardness" to node.hardness,
                "toolTags" to node.toolTags,
                "recoveryMinutes" to node.recoveryMinutes,
                "category" to node.category,
                "displayName" to node.displayName,
                "maxRemaining" to node.maxRemaining,
                "recoveryElapsedMinutes" to node.recoveryElapsedMinutes,
            )
        },
        "groundItems" to sortedObjectMap(save.groundItems) { item -> linkedMapOf(
            "id" to item.id, "itemId" to item.itemId, "amount" to item.amount,
            "x" to item.x, "y" to item.y, "droppedAt" to item.droppedAt,
        ) },
        "plots" to sortedObjectMap(save.plots) { plot -> linkedMapOf(
            "id" to plot.id, "water" to plot.water, "waterUsageMinutes" to plot.waterUsageMinutes,
            "slots" to plot.slots.map { slot -> slot?.let { linkedMapOf(
                "cropId" to it.cropId, "seedId" to it.seedId, "progressMinutes" to it.progressMinutes,
                "durationMinutes" to it.durationMinutes, "stage" to it.stage,
            ) } },
        ) },
        "recoveryBlockers" to save.recoveryBlockers,
        "lastModifiers" to save.lastModifiers.map {
            linkedMapOf("code" to it.code, "value" to it.value)
        },
        "elapsedMinutes" to save.wildlife.elapsedMinutes,
        "animals" to sortedObjectMap(save.wildlife.animals) { animal ->
            linkedMapOf<String, Any?>(
                "id" to animal.id,
                "speciesId" to animal.speciesId,
                "regionId" to animal.regionId,
                "position" to linkedMapOf("x" to animal.position.x, "y" to animal.position.y),
                "health" to animal.health,
                "state" to animal.behavior.name.lowercase(),
            ).apply {
                animal.threatenUntilMinute?.let { put("threatenUntilMinute", it) }
            }
        },
        "populations" to sortedObjectMap(save.wildlife.populations) { population ->
            linkedMapOf(
                "adults" to population.adults,
                "young" to population.young,
                "capacity" to population.capacity,
                "huntingPressure" to population.huntingPressure,
                "lastUpdatedMinute" to population.lastUpdatedMinute,
                "recoveryMinutes" to population.recoveryMinutes,
            )
        },
        "nests" to sortedObjectMap(save.wildlife.nests) { nest ->
            linkedMapOf("speciesId" to nest.speciesId, "eggs" to nest.eggs)
        },
        "traps" to sortedObjectMap(save.wildlife.traps) { trap ->
            linkedMapOf("state" to trap.state)
        },
        "domestication" to sortedObjectMap(save.wildlife.domestication) { domestication ->
            linkedMapOf("trust" to domestication.trust)
        },
        "wildlifeTraces" to sortedObjectMap(save.wildlife.traces) { trace ->
            linkedMapOf("kind" to trace.kind, "minute" to trace.minute)
        },
        "processedActions" to save.wildlife.processedActions.sorted().associateWithTo(linkedMapOf()) { true },
        "processedEventIds" to save.wildlife.processedEventIds.toList(),
    )

    private fun decode(text: String): GameSave {
        val parsed = Json.parse(text)
        require(parsed is Map<*, *>) { "save-object-required" }
        val value = parsed.entries.associate { (key, item) -> key.toString() to item }
        val version = value.requiredInt("schemaVersion")
        require(version == 2 || version == 3 || version == 4) { "unsupported-version" }
        val seed = value.requiredString("seed")
        val day = value.requiredInt("day")
        val time = value.requiredInt("time")
        require(day >= 1) { "invalid-day" }
        require(time in 0..1_439) { "invalid-time" }
        validateTopLevelTypes(value)
        if (version == 4) validateCanonicalWildlife(value)
        val weather = value.objectOrEmpty("weather")
        val vitals = value.objectOrEmpty("vitals")
        val journals = decodeObjectMap(value.objectOrNull("journals")) { _, item ->
            DiaryEntry(item.string("text"), item.stringList("facts"))
        }.ifEmpty {
            value.stringOrNull("journal")?.let { mapOf("legacy" to DiaryEntry(it)) }.orEmpty()
        }
        return GameSave(
            schemaVersion = 4,
            productVersion = value.string("productVersion", "0.5.0"),
            build = value.int("build", 14),
            seed = seed,
            playMode = if (value.string("playMode") == "free") PlayMode.FREE else PlayMode.GUIDED,
            day = day,
            time = time,
            weather = Weather(
                weather.string("kind", "clear"),
                weather.double("intensity", 0.0),
                weather.double("wetness", 0.0),
                weather.double("wind", 0.15),
            ),
            regions = decodeObjectMap(value.objectOrNull("regions")) { key, item ->
                Region(
                    item.string("id", key),
                    item.int("x"),
                    item.int("y"),
                    item.string("biomeId"),
                    item.double("elevation"),
                    item.double("moisture"),
                    item.double("temperature"),
                    item.stringList("resources"),
                )
            },
            entities = decodeObjectMap(value.objectOrNull("entities")) { key, item ->
                Entity(
                    item.string("id", key),
                    item.string("type"),
                    Coordinates(item.int("x"), item.int("y")),
                    item.int("durability", 10),
                    item.int("maxDurability", 10),
                    item.int("rotation"),
                )
            },
            players = decodeObjectMap(value.objectOrNull("players")) { key, item ->
                val position = item.objectOrNull("position") ?: item
                PlayerRecord(
                    id = item.string("id", key),
                    position = PlayerPosition(position.double("x"), position.double("y")),
                    inventory = item.intMap("inventory"),
                )
            },
            journals = journals,
            milestones = value.booleanMap("milestones"),
            inventory = value.intMap("inventory"),
            toolDurability = value.intMap("toolDurability"),
            containerInventories = decodeObjectMap(value.objectOrNull("containerInventories")) { _, item ->
                item.mapValues { (_, amount) -> amount.asInt() }
            },
            facilityProcesses = decodeObjectMap(value.objectOrNull("facilityProcesses")) { _, item ->
                FacilityProcess(
                    recipeId = item.stringOrNull("recipeId"),
                    input = item.intMap("input"),
                    fuel = item.intMap("fuel"),
                    output = item.intMap("output"),
                    progressMinutes = item.double("progressMinutes", 0.0),
                    durationMinutes = item.double("durationMinutes", 0.0),
                    outputItemId = item.stringOrNull("outputItemId"),
                    outputAmount = item.int("outputAmount", 0),
                    status = runCatching { FurnaceStatus.valueOf(item.string("status", "idle").uppercase()) }.getOrDefault(FurnaceStatus.IDLE),
                )
            },
            elapsedGameMinutes = value.double("elapsedGameMinutes", 0.0),
            phase = value.string("phase", "day"),
            vitals = Vitals(
                vitals.double("health", 100.0),
                vitals.double("stamina", 100.0),
                vitals.double("hunger", 100.0),
                vitals.double("hydration", 100.0),
                vitals.double("bodyTemperature", 37.0),
                vitals.double("carriedMass", 0.0),
                vitals.stringList("effects"),
            ),
            discoveredChunks = decodeObjectMap(value.objectOrNull("discoveredChunks")) { _, item ->
                DiscoveredChunk(item.int("x"), item.int("y"), item.string("visibility", "discovered"))
            },
            resourceNodes = decodeObjectMap(value.objectOrNull("resourceNodes")) { key, item ->
                ResourceNodeState(
                    item.string("id", key),
                    item.string("resourceId"),
                    item.string("itemId"),
                    item.double("x"),
                    item.double("y"),
                    item.int("remaining"),
                    item.string("state", "full"),
                    item.int("hardness"),
                    item.stringList("toolTags"),
                    item.int("recoveryMinutes"),
                    item.string("category", "material"),
                    item.string("displayName", item.string("itemId")),
                    item.int("maxRemaining", item.int("remaining").coerceAtLeast(1)),
                    item.double("recoveryElapsedMinutes", 0.0),
                )
            },
            groundItems = decodeObjectMap(value.objectOrNull("groundItems")) { key, item -> GroundItem(
                item.string("id", key), item.string("itemId"), item.int("amount"), item.double("x"), item.double("y"), item.double("droppedAt"),
            ) },
            plots = decodeObjectMap(value.objectOrNull("plots")) { key, item -> CropPlot(
                item.string("id", key), item.int("water"), item.double("waterUsageMinutes", 0.0), item.array("slots").map { raw ->
                    if (raw == null) null else raw.asObject().let { slot -> CropSlot(
                        slot.string("cropId"), slot.string("seedId"), slot.double("progressMinutes"),
                        slot.double("durationMinutes"), slot.string("stage", "seeded"),
                    ) }
                }.let { slots -> List(9) { slots.getOrNull(it) } },
            ) },
            recoveryBlockers = value.stringList("recoveryBlockers"),
            lastModifiers = value.array("lastModifiers").map { item ->
                val modifier = item.asObject()
                SurvivalModifier(modifier.string("code"), modifier.double("value"))
            },
            wildlife = decodeWildlife(value),
        )
    }

    private fun validateTopLevelTypes(value: Map<String, Any?>) {
        val objectFields = listOf(
            "weather", "vitals", "regions", "entities", "players", "journals", "milestones",
            "inventory", "toolDurability", "containerInventories", "facilityProcesses", "discoveredChunks", "resourceNodes", "groundItems", "plots",
            "animals", "populations", "nests", "traps", "domestication", "wildlifeTraces",
            "processedActions",
        )
        val arrayFields = listOf("recoveryBlockers", "lastModifiers", "processedEventIds")
        val stringFields = listOf("productVersion", "playMode", "phase")
        val numberFields = listOf("build", "elapsedGameMinutes", "elapsedMinutes")
        objectFields.forEach { key ->
            if (key in value) require(value[key] is Map<*, *>) { "invalid-$key" }
        }
        arrayFields.forEach { key ->
            if (key in value) require(value[key] is List<*>) { "invalid-$key" }
        }
        stringFields.forEach { key ->
            if (key in value) require(value[key] is String) { "invalid-$key" }
        }
        numberFields.forEach { key ->
            if (key in value) require(value[key] is Number) { "invalid-$key" }
        }
        val objectEntryFields = listOf(
            "regions", "entities", "players", "journals", "containerInventories", "facilityProcesses", "discoveredChunks",
            "resourceNodes", "animals", "populations", "nests", "traps", "domestication", "wildlifeTraces",
        )
        objectEntryFields.forEach { key ->
            value.objectOrNull(key).orEmpty().forEach { (_, item) ->
                require(item is Map<*, *>) { "invalid-$key-entry" }
            }
        }
        listOf("inventory", "toolDurability").forEach { key ->
            validateIntegerMap(value.objectOrNull(key), key)
        }
        value.objectOrNull("containerInventories").orEmpty().forEach { (_, inventory) ->
            validateIntegerMap(inventory.asObject(), "containerInventories")
        }
        value.objectOrNull("milestones").orEmpty().forEach { (_, milestone) ->
            require(milestone is Boolean) { "invalid-milestones" }
        }
        value.objectOrNull("processedActions").orEmpty().forEach { (_, processed) ->
            require(processed is Boolean) { "invalid-processedActions" }
        }
        value.objectOrNull("weather")?.let { weather ->
            if ("kind" in weather) require(weather["kind"] is String) { "invalid-weather-kind" }
            listOf("intensity", "wetness", "wind").forEach { field ->
                if (field in weather) requireFiniteNumber(weather[field], "weather-$field")
            }
        }
        value.objectOrNull("players").orEmpty().forEach { (key, rawPlayer) ->
            val player = rawPlayer.asObject()
            if ("id" in player) require(player["id"] is String) { "invalid-player-id" }
            val position = player.objectOrNull("position") ?: player
            requireFiniteNumber(position["x"], "player-$key-x")
            requireFiniteNumber(position["y"], "player-$key-y")
            validateIntegerMap(player.objectOrNull("inventory"), "player-$key-inventory")
        }
    }

    private fun validateIntegerMap(value: Map<String, Any?>?, field: String) {
        value.orEmpty().forEach { (_, item) ->
            val number = item as? Number
            require(number != null && number.toDouble().isFinite() && number.toDouble() % 1.0 == 0.0) {
                "invalid-$field"
            }
        }
    }

    private fun requireFiniteNumber(value: Any?, field: String) {
        val number = value as? Number
        require(number != null && number.toDouble().isFinite()) { "invalid-$field" }
    }

    private fun validateCanonicalWildlife(value: Map<String, Any?>) {
        val canonicalFields = listOf(
            "elapsedMinutes", "animals", "populations", "nests", "traps", "domestication",
            "wildlifeTraces", "processedActions", "processedEventIds",
        )
        canonicalFields.forEach { field ->
            require(field in value) { "missing-$field" }
        }
        requireNonNegativeFinite(value["elapsedMinutes"], "elapsedMinutes")

        value.objectOrEmpty("animals").forEach { (key, raw) ->
            val animal = raw.asObject()
            val id = animal.requiredNonBlankString("id", "animal-$key-id")
            require(id == key) { "invalid-animal-$key-id" }
            val speciesId = animal.requiredNonBlankString("speciesId", "animal-$key-speciesId")
            require(speciesId in WildlifeEngine.supportedSpeciesIds) { "invalid-animal-$key-speciesId" }
            animal.requiredNonBlankString("regionId", "animal-$key-regionId")
            val position = animal.requiredObject("position", "animal-$key-position")
            requireFiniteNumber(position["x"], "animal-$key-x")
            requireFiniteNumber(position["y"], "animal-$key-y")
            requirePositiveFinite(animal["health"], "animal-$key-health")
            val state = animal.requiredNonBlankString("state", "animal-$key-state")
            require(state in AnimalBehavior.entries.map { it.name.lowercase() }) { "invalid-animal-$key-state" }
            animal["threatenUntilMinute"]?.let {
                requireNonNegativeFinite(it, "animal-$key-threatenUntilMinute")
            }
            if (state == "threaten") {
                require("threatenUntilMinute" in animal) { "missing-animal-$key-threatenUntilMinute" }
            }
        }

        value.objectOrEmpty("populations").forEach { (key, raw) ->
            val population = raw.asObject()
            requireNonNegativeInt(population["adults"], "population-$key-adults")
            requireNonNegativeInt(population["young"], "population-$key-young")
            requireNonNegativeInt(population["capacity"], "population-$key-capacity")
            requireNonNegativeFinite(population["huntingPressure"], "population-$key-huntingPressure")
            requireNonNegativeFinite(population["lastUpdatedMinute"], "population-$key-lastUpdatedMinute")
            requireNonNegativeFinite(population["recoveryMinutes"], "population-$key-recoveryMinutes")
        }
        value.objectOrEmpty("nests").forEach { (key, raw) ->
            val nest = raw.asObject()
            val speciesId = nest.requiredNonBlankString("speciesId", "nest-$key-speciesId")
            require(speciesId in WildlifeEngine.supportedSpeciesIds) { "invalid-nest-$key-speciesId" }
            requireNonNegativeInt(nest["eggs"], "nest-$key-eggs")
        }
        value.objectOrEmpty("traps").forEach { (key, raw) ->
            val state = raw.asObject().requiredNonBlankString("state", "trap-$key-state")
            require(state in setOf("empty", "set", "triggered", "sprung", "broken")) { "invalid-trap-$key-state" }
        }
        value.objectOrEmpty("domestication").forEach { (key, raw) ->
            val trust = requireNonNegativeFinite(raw.asObject()["trust"], "domestication-$key-trust")
            require(trust <= 1.0) { "invalid-domestication-$key-trust" }
        }
        value.objectOrEmpty("wildlifeTraces").forEach { (key, raw) ->
            val trace = raw.asObject()
            trace.requiredNonBlankString("kind", "trace-$key-kind")
            requireNonNegativeFinite(trace["minute"], "trace-$key-minute")
        }
        value.objectOrEmpty("processedActions").forEach { (key, processed) ->
            require(key.isNotBlank() && processed == true) { "invalid-processedActions" }
        }
        value.array("processedEventIds").forEach { eventId ->
            require(eventId is String && eventId.isNotBlank()) { "invalid-processedEventIds" }
        }
    }

    private fun requireNonNegativeInt(value: Any?, field: String): Int {
        val number = value as? Number
        require(number != null && number.toDouble().isFinite() && number.toDouble() % 1.0 == 0.0) { "invalid-$field" }
        val result = number.toDouble()
        require(result in 0.0..Int.MAX_VALUE.toDouble()) { "invalid-$field" }
        return result.toInt()
    }

    private fun requireNonNegativeFinite(value: Any?, field: String): Double {
        val number = value as? Number
        val result = number?.toDouble()
        require(result != null && result.isFinite() && result >= 0.0) { "invalid-$field" }
        return result
    }

    private fun requirePositiveFinite(value: Any?, field: String): Double {
        val result = requireNonNegativeFinite(value, field)
        require(result > 0.0) { "invalid-$field" }
        return result
    }

    private fun decodeWildlife(value: Map<String, Any?>): WildlifeState = WildlifeState(
        elapsedMinutes = value.double("elapsedMinutes"),
        animals = decodeObjectMap(value.objectOrNull("animals")) { key, item ->
            val position = item.objectOrEmpty("position")
            AnimalState(
                id = item.string("id", key),
                speciesId = item.string("speciesId"),
                regionId = item.string("regionId"),
                position = WildlifePosition(position.double("x"), position.double("y")),
                health = item.double("health"),
                behavior = runCatching {
                    AnimalBehavior.valueOf(item.string("state", item.string("behavior", "foraging")).uppercase())
                }.getOrDefault(AnimalBehavior.FORAGING),
                threatenUntilMinute = item.doubleOrNull("threatenUntilMinute"),
            )
        },
        populations = decodeObjectMap(value.objectOrNull("populations")) { _, item ->
            PopulationState(
                adults = item.int("adults"),
                young = item.int("young"),
                capacity = item.int("capacity"),
                huntingPressure = item.double("huntingPressure"),
                lastUpdatedMinute = item.double("lastUpdatedMinute"),
                recoveryMinutes = item.double("recoveryMinutes"),
            )
        },
        nests = decodeObjectMap(value.objectOrNull("nests")) { _, item ->
            NestState(item.string("speciesId"), item.int("eggs"))
        },
        traps = decodeObjectMap(value.objectOrNull("traps")) { _, item ->
            TrapState(item.string("state"))
        },
        domestication = decodeObjectMap(value.objectOrNull("domestication")) { _, item ->
            DomesticationState(item.double("trust"))
        },
        traces = decodeObjectMap(value.objectOrNull("wildlifeTraces")) { _, item ->
            WildlifeTrace(item.string("kind"), item.double("minute"))
        },
        processedActions = value.objectOrEmpty("processedActions")
            .filterValues { it == true }
            .keys
            .toSet(),
        processedEventIds = LinkedHashSet(value.stringList("processedEventIds")),
    )

    private fun <T, R> sortedObjectMap(values: Map<String, T>, transform: (T) -> R): Map<String, R> =
        values.toSortedMap().mapValuesTo(linkedMapOf()) { (_, value) -> transform(value) }

    private fun <T> sortedMap(values: Map<String, T>): Map<String, T> =
        values.toSortedMap().toMap(linkedMapOf())

    private fun <T> decodeObjectMap(
        value: Map<String, Any?>?,
        decode: (String, Map<String, Any?>) -> T,
    ): Map<String, T> = value.orEmpty().toSortedMap().mapValuesTo(linkedMapOf()) { (key, item) ->
        decode(key, item.asObject())
    }
}

private fun Any?.asObject(): Map<String, Any?> = (this as? Map<*, *>)
    ?.entries
    ?.associate { (key, value) -> key.toString() to value }
    .orEmpty()
private fun Any?.asInt(): Int = (this as? Number)?.toInt() ?: 0
private fun Map<String, Any?>.string(key: String, fallback: String = ""): String =
    this[key] as? String ?: fallback
private fun Map<String, Any?>.requiredString(key: String): String {
    val value = this[key]
    require(value is String && value.isNotBlank()) { "invalid-$key" }
    return value
}
private fun Map<String, Any?>.requiredNonBlankString(key: String, field: String): String {
    val value = this[key]
    require(value is String && value.isNotBlank()) { "invalid-$field" }
    return value
}
private fun Map<String, Any?>.requiredObject(key: String, field: String): Map<String, Any?> {
    val value = this[key]
    require(value is Map<*, *>) { "invalid-$field" }
    return value.entries.associate { (nestedKey, nestedValue) -> nestedKey.toString() to nestedValue }
}
private fun Map<String, Any?>.requiredInt(key: String): Int {
    val value = this[key]
    require(value is Number) { "invalid-$key" }
    val number = value.toDouble()
    require(number.isFinite() && number % 1.0 == 0.0 && number in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) {
        "invalid-$key"
    }
    return number.toInt()
}
private fun Map<String, Any?>.stringOrNull(key: String): String? = this[key] as? String
private fun Map<String, Any?>.int(key: String, fallback: Int = 0): Int =
    (this[key] as? Number)?.toInt() ?: fallback
private fun Map<String, Any?>.double(key: String, fallback: Double = 0.0): Double =
    (this[key] as? Number)?.toDouble() ?: fallback
private fun Map<String, Any?>.doubleOrNull(key: String): Double? =
    (this[key] as? Number)?.toDouble()
private fun Map<String, Any?>.objectOrNull(key: String): Map<String, Any?>? =
    (this[key] as? Map<*, *>)?.entries?.associate { (field, value) -> field.toString() to value }
private fun Map<String, Any?>.objectOrEmpty(key: String): Map<String, Any?> = objectOrNull(key).orEmpty()
private fun Map<String, Any?>.array(key: String): List<Any?> = this[key] as? List<Any?> ?: emptyList()
private fun Map<String, Any?>.stringList(key: String): List<String> = array(key).mapNotNull { it as? String }
private fun Map<String, Any?>.intMap(key: String): Map<String, Int> =
    objectOrEmpty(key).mapValues { (_, value) -> value.asInt() }
private fun Map<String, Any?>.booleanMap(key: String): Map<String, Boolean> =
    objectOrEmpty(key).mapValues { (_, value) -> value as? Boolean ?: false }

private object Json {
    fun parse(text: String): Any? = Parser(text).parse()

    fun encode(value: Any?): String = buildString { appendValue(value) }

    private fun StringBuilder.appendValue(value: Any?) {
        when (value) {
            null -> append("null")
            is String -> appendString(value)
            is Boolean -> append(value)
            is Number -> {
                val number = value.toDouble()
                require(number.isFinite()) { "finite-number-required" }
                append(value.toString())
            }
            is Map<*, *> -> {
                append('{')
                value.entries.forEachIndexed { index, (key, item) ->
                    if (index > 0) append(',')
                    appendString(key.toString())
                    append(':')
                    appendValue(item)
                }
                append('}')
            }
            is Iterable<*> -> {
                append('[')
                value.forEachIndexed { index, item ->
                    if (index > 0) append(',')
                    appendValue(item)
                }
                append(']')
            }
            else -> error("unsupported-json-value")
        }
    }

    private fun StringBuilder.appendString(value: String) {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) {
                    append("\\u")
                    append(character.code.toString(16).padStart(4, '0'))
                } else {
                    append(character)
                }
            }
        }
        append('"')
    }

    private class Parser(private val text: String) {
        private var index = 0

        fun parse(): Any? {
            skipWhitespace()
            val value = parseValue()
            skipWhitespace()
            require(index == text.length) { "trailing-json" }
            return value
        }

        private fun parseValue(): Any? {
            skipWhitespace()
            require(index < text.length) { "unexpected-json-end" }
            return when (text[index]) {
                '{' -> parseObject()
                '[' -> parseArray()
                '"' -> parseString()
                't' -> parseLiteral("true", true)
                'f' -> parseLiteral("false", false)
                'n' -> parseLiteral("null", null)
                else -> parseNumber()
            }
        }

        private fun parseObject(): Map<String, Any?> {
            expect('{')
            val result = linkedMapOf<String, Any?>()
            skipWhitespace()
            if (take('}')) return result
            while (true) {
                skipWhitespace()
                val key = parseString()
                skipWhitespace()
                expect(':')
                result[key] = parseValue()
                skipWhitespace()
                if (take('}')) return result
                expect(',')
            }
        }

        private fun parseArray(): List<Any?> {
            expect('[')
            val result = mutableListOf<Any?>()
            skipWhitespace()
            if (take(']')) return result
            while (true) {
                result += parseValue()
                skipWhitespace()
                if (take(']')) return result
                expect(',')
            }
        }

        private fun parseString(): String {
            expect('"')
            val result = StringBuilder()
            while (index < text.length) {
                val character = text[index++]
                if (character == '"') return result.toString()
                if (character != '\\') {
                    require(character.code >= 0x20) { "unescaped-control-character" }
                    result.append(character)
                    continue
                }
                require(index < text.length) { "invalid-json-escape" }
                when (val escaped = text[index++]) {
                    '"', '\\', '/' -> result.append(escaped)
                    'b' -> result.append('\b')
                    'f' -> result.append('\u000c')
                    'n' -> result.append('\n')
                    'r' -> result.append('\r')
                    't' -> result.append('\t')
                    'u' -> {
                        require(index + 4 <= text.length) { "invalid-unicode-escape" }
                        result.append(text.substring(index, index + 4).toInt(16).toChar())
                        index += 4
                    }
                    else -> error("invalid-json-escape")
                }
            }
            error("unterminated-json-string")
        }

        private fun parseNumber(): Number {
            val start = index
            if (text.getOrNull(index) == '-') index += 1
            while (text.getOrNull(index)?.isDigit() == true) index += 1
            if (text.getOrNull(index) == '.') {
                index += 1
                while (text.getOrNull(index)?.isDigit() == true) index += 1
            }
            if (text.getOrNull(index) == 'e' || text.getOrNull(index) == 'E') {
                index += 1
                if (text.getOrNull(index) == '+' || text.getOrNull(index) == '-') index += 1
                while (text.getOrNull(index)?.isDigit() == true) index += 1
            }
            require(index > start) { "invalid-json-number" }
            val raw = text.substring(start, index)
            return if ('.' in raw || 'e' in raw.lowercase()) raw.toDouble() else raw.toLong()
        }

        private fun <T> parseLiteral(literal: String, value: T): T {
            require(text.startsWith(literal, index)) { "invalid-json-literal" }
            index += literal.length
            return value
        }

        private fun expect(character: Char) {
            require(take(character)) { "expected-$character" }
        }

        private fun take(character: Char): Boolean {
            if (text.getOrNull(index) != character) return false
            index += 1
            return true
        }

        private fun skipWhitespace() {
            while (text.getOrNull(index) in setOf(' ', '\t', '\n', '\r')) index += 1
        }
    }
}
