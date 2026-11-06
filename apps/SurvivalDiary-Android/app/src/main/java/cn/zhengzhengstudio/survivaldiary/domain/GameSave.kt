package cn.zhengzhengstudio.survivaldiary.domain

enum class PlayMode { GUIDED, FREE }

data class Coordinates(val x: Int, val y: Int)
data class PlayerPosition(val x: Double, val y: Double)
data class PlayerRecord(
    val id: String,
    val position: PlayerPosition,
    val inventory: Map<String, Int> = emptyMap(),
)
fun Coordinates.toPlayerPosition() = PlayerPosition(x.toDouble(), y.toDouble())
data class Weather(val kind: String, val intensity: Double, val wetness: Double, val wind: Double)
data class Region(
    val id: String,
    val x: Int,
    val y: Int,
    val biomeId: String,
    val elevation: Double,
    val moisture: Double,
    val temperature: Double,
    val resources: List<String>,
)
data class Entity(
    val id: String,
    val type: String,
    val coordinates: Coordinates,
    val durability: Int = 10,
    val maxDurability: Int = 10,
    val rotation: Int = 0,
)
data class DiaryEntry(val text: String, val facts: List<String> = emptyList())
data class Vitals(
    val health: Double = 100.0,
    val stamina: Double = 100.0,
    val hunger: Double = 100.0,
    val hydration: Double = 100.0,
    val bodyTemperature: Double = 37.0,
    val carriedMass: Double = 0.0,
    val effects: List<String> = emptyList(),
)
data class DiscoveredChunk(val x: Int, val y: Int, val visibility: String = "discovered")
data class GroundItem(val id: String, val itemId: String, val amount: Int, val x: Double, val y: Double, val droppedAt: Double)
data class CropSlot(val cropId: String, val seedId: String, val progressMinutes: Double = 0.0, val durationMinutes: Double, val stage: String = "seeded")
data class CropPlot(
    val id: String,
    val water: Int = 0,
    val waterUsageMinutes: Double = 0.0,
    val slots: List<CropSlot?> = List(9) { null },
)

enum class FurnaceStatus { IDLE, WORKING, READY }
data class FacilityProcess(
    val recipeId: String? = null,
    val input: Map<String, Int> = emptyMap(),
    val fuel: Map<String, Int> = emptyMap(),
    val output: Map<String, Int> = emptyMap(),
    val progressMinutes: Double = 0.0,
    val durationMinutes: Double = 0.0,
    val outputItemId: String? = null,
    val outputAmount: Int = 0,
    val status: FurnaceStatus = FurnaceStatus.IDLE,
)

data class GameSave(
    val schemaVersion: Int = 4,
    val productVersion: String = "0.3.1",
    val build: Int = 3,
    val seed: String,
    val playMode: PlayMode = PlayMode.GUIDED,
    val day: Int = 1,
    val time: Int = 360,
    val weather: Weather = Weather("clear", 0.0, 0.0, 0.15),
    val regions: Map<String, Region> = emptyMap(),
    val entities: Map<String, Entity> = emptyMap(),
    val players: Map<String, PlayerRecord> = emptyMap(),
    val journals: Map<String, DiaryEntry> = emptyMap(),
    val milestones: Map<String, Boolean> = emptyMap(),
    val inventory: Map<String, Int> = emptyMap(),
    val toolDurability: Map<String, Int> = emptyMap(),
    val containerInventories: Map<String, Map<String, Int>> = emptyMap(),
    val facilityProcesses: Map<String, FacilityProcess> = emptyMap(),
    val elapsedGameMinutes: Double = 0.0,
    val phase: String = "day",
    val vitals: Vitals = Vitals(),
    val discoveredChunks: Map<String, DiscoveredChunk> = emptyMap(),
    val resourceNodes: Map<String, ResourceNodeState> = emptyMap(),
    val groundItems: Map<String, GroundItem> = emptyMap(),
    val plots: Map<String, CropPlot> = emptyMap(),
    val recoveryBlockers: List<String> = emptyList(),
    val lastModifiers: List<SurvivalModifier> = emptyList(),
    val wildlife: WildlifeState = WildlifeState(),
)

fun GameSave.withPlayerPosition(key: String, position: PlayerPosition): GameSave {
    val current = players[key] ?: PlayerRecord(key, position)
    return copy(players = players + (key to current.copy(position = position)))
}

data class ResourceNodeState(
    val id: String,
    val resourceId: String,
    val itemId: String,
    val x: Double,
    val y: Double,
    val remaining: Int,
    val state: String = "full",
    val hardness: Int = 0,
    val toolTags: List<String> = emptyList(),
    val recoveryMinutes: Int = 0,
    val category: String = "material",
    val displayName: String = itemId,
    val maxRemaining: Int = remaining.coerceAtLeast(1),
    val recoveryElapsedMinutes: Double = 0.0,
)

data class SurvivalModifier(val code: String, val value: Double)
