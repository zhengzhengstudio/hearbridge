package cn.zhengzhengstudio.survivaldiary.domain

import kotlin.math.floor
import kotlin.math.round

enum class SurvivalActivity(val staminaPerGameMinute: Double) {
    IDLE(0.14), WALKING(-0.08), MINING(-0.18), RUNNING(-0.28), SWIMMING(-0.38), SLEEPING(0.36),
}

object SurvivalSimulation {
    const val REAL_MILLISECONDS_PER_GAME_DAY = 1_800_000L
    private const val GAME_MINUTES_PER_DAY = 1_440.0
    private val blockerCodes = mapOf(
        "bleeding" to "untreated-bleeding",
        "infected" to "untreated-infection",
        "dehydrated" to "dehydration",
        "starving" to "starvation",
        "cold" to "hypothermia",
        "overheated" to "hyperthermia",
    )

    fun create(seed: String, playMode: PlayMode = PlayMode.GUIDED): GameSave {
        require(seed.isNotBlank())
        return GameSave(
            schemaVersion = 4,
            productVersion = "0.6.2",
            build = 46,
            seed = seed,
            playMode = playMode,
            day = 1,
            time = 390,
            phase = "day",
            vitals = Vitals(),
            inventory = mapOf("taro-seed" to 1),
            milestones = mapOf(
                "nativeFarmBootstrapVersion:1" to true,
            ),
            discoveredChunks = mapOf("0,0" to DiscoveredChunk(0, 0)),
            players = mapOf("local" to PlayerRecord("local", PlayerPosition(8.0, 8.0))),
        )
    }

    fun advance(save: GameSave, elapsedRealMs: Long, activity: SurvivalActivity): GameSave {
        require(save.schemaVersion == 3 || save.schemaVersion == 4)
        require(elapsedRealMs >= 0)
        val gameMinutes = elapsedRealMs.toDouble() * GAME_MINUTES_PER_DAY / REAL_MILLISECONDS_PER_GAME_DAY
        val carriedFraction = save.elapsedGameMinutes - floor(save.elapsedGameMinutes)
        val absoluteMinutes = (save.day - 1) * GAME_MINUTES_PER_DAY + save.time + carriedFraction + gameMinutes
        val nextDay = (absoluteMinutes / GAME_MINUTES_PER_DAY).toInt() + 1
        val nextTime = rounded(absoluteMinutes % GAME_MINUTES_PER_DAY).toInt()
        val elapsedHours = gameMinutes / 60.0
        val effects = save.vitals.effects.toMutableSet()
        var hunger = clamp(save.vitals.hunger - elapsedHours * 1.8)
        var hydration = clamp(save.vitals.hydration - elapsedHours * 2.6)
        if (hunger <= 8) effects += "starving" else effects -= "starving"
        if (hydration <= 8) effects += "dehydrated" else effects -= "dehydrated"
        val nutritionFactor = when {
            hunger >= 80 && hydration >= 70 -> 1.6
            hunger >= 45 && hydration >= 45 -> 1.0
            hunger > 8 && hydration > 8 -> 0.35
            else -> 0.0
        }
        val staminaDelta = activity.staminaPerGameMinute * gameMinutes *
            if (activity.staminaPerGameMinute > 0) nutritionFactor else 1.0
        val stamina = clamp(save.vitals.stamina + staminaDelta)
        val weatherExposure = when (save.weather.kind) {
            "storm", "blizzard" -> save.weather.intensity * 1.4
            "rain", "snow" -> save.weather.intensity * 0.55
            else -> 0.0
        }
        val temperatureExposure = if (save.vitals.bodyTemperature !in 36.0..38.0) 1.2 else 0.0
        val crisisDamagePerHour = (if (hunger <= 8) 2.4 else 0.0) +
            (if (hydration <= 8) 4.0 else 0.0) + weatherExposure + temperatureExposure
        val blockers = (effects.mapNotNull(blockerCodes::get) +
            (if (hunger < 80) listOf("needs-food") else emptyList()) +
            (if (hydration < 70) listOf("needs-water") else emptyList()) +
            (if (weatherExposure > 0.0) listOf("weather-exposure") else emptyList()) +
            (if (temperatureExposure > 0.0) listOf("temperature-exposure") else emptyList())).distinct().sorted()
        val safeToRecover = effects.mapNotNull(blockerCodes::get).isEmpty() && hunger >= 80 && hydration >= 70 &&
            weatherExposure == 0.0 && temperatureExposure == 0.0 && save.vitals.bodyTemperature in 36.0..38.0
        val health = clamp(save.vitals.health + if (safeToRecover) elapsedHours * 1.2 else -elapsedHours * crisisDamagePerHour)
        val resourceNodes = save.resourceNodes.mapValues { (_, node) ->
            if (node.remaining > 0 || node.recoveryMinutes <= 0) node
            else {
                val elapsed = node.recoveryElapsedMinutes + gameMinutes
                if (elapsed >= node.recoveryMinutes) node.copy(
                    remaining = node.maxRemaining.coerceAtLeast(1),
                    state = "full",
                    recoveryElapsedMinutes = 0.0,
                ) else node.copy(state = "recovering", recoveryElapsedMinutes = rounded(elapsed))
            }
        }
        return save.copy(
            schemaVersion = 4,
            day = nextDay,
            time = nextTime,
            elapsedGameMinutes = rounded(save.elapsedGameMinutes + gameMinutes),
            phase = dayPhase(nextTime),
            vitals = save.vitals.copy(
                health = rounded(health),
                stamina = rounded(stamina),
                hunger = rounded(hunger),
                hydration = rounded(hydration),
                effects = effects.sorted(),
            ),
            recoveryBlockers = blockers,
            resourceNodes = resourceNodes,
            lastModifiers = listOf(
                SurvivalModifier("activity:${activity.name.lowercase()}-stamina", rounded(staminaDelta)),
                SurvivalModifier("metabolism:hunger", rounded(hunger - save.vitals.hunger)),
                SurvivalModifier("metabolism:hydration", rounded(hydration - save.vitals.hydration)),
                SurvivalModifier("survival:health", rounded(health - save.vitals.health)),
            ),
        )
    }

    fun dayPhase(minute: Int): String {
        val normalized = ((minute % 1440) + 1440) % 1440
        return when (normalized) {
            in 300 until 390 -> "dawn"
            in 390 until 1260 -> "day"
            in 1260 until 1350 -> "dusk"
            else -> "night"
        }
    }

    private fun clamp(value: Double) = value.coerceIn(0.0, 100.0)
    private fun rounded(value: Double) = round(value * 10_000.0) / 10_000.0
}
