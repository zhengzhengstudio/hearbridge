package cn.zhengzhengstudio.survivaldiary.domain

import kotlin.math.hypot
import kotlin.math.floor

data class WildlifePosition(val x: Double, val y: Double)

enum class AnimalBehavior { FORAGING, FLEE, THREATEN, RETALIATE }

data class AnimalState(
    val id: String,
    val speciesId: String,
    val regionId: String,
    val position: WildlifePosition,
    val health: Double,
    val behavior: AnimalBehavior = AnimalBehavior.FORAGING,
    val threatenUntilMinute: Double? = null,
)

data class PopulationState(
    val adults: Int,
    val young: Int,
    val capacity: Int,
    val huntingPressure: Double,
    val lastUpdatedMinute: Double,
    val recoveryMinutes: Double = 0.0,
)

data class NestState(val speciesId: String, val eggs: Int)
data class TrapState(val state: String)
data class DomesticationState(val trust: Double)
data class WildlifeTrace(val kind: String, val minute: Double)

data class WildlifeState(
    val elapsedMinutes: Double = 0.0,
    val animals: Map<String, AnimalState> = emptyMap(),
    val populations: Map<String, PopulationState> = emptyMap(),
    val nests: Map<String, NestState> = emptyMap(),
    val traps: Map<String, TrapState> = emptyMap(),
    val domestication: Map<String, DomesticationState> = emptyMap(),
    val traces: Map<String, WildlifeTrace> = emptyMap(),
    val processedActions: Set<String> = emptySet(),
    val processedEventIds: Set<String> = emptySet(),
)

data class WildlifePlayer(val id: String, val position: WildlifePosition)
data class WildlifeContext(val player: WildlifePlayer? = null, val activeRadius: Double = 32.0)
data class WildlifeAction(val id: String, val type: String, val animalId: String, val amount: Double)
data class WildlifeEvent(
    val id: String,
    val type: String,
    val animalId: String,
    val speciesId: String,
    val playerId: String? = null,
)
data class WildlifeActionResult(
    val ok: Boolean,
    val state: WildlifeState,
    val events: List<WildlifeEvent> = emptyList(),
    val error: String? = null,
    val duplicate: Boolean = false,
)

object WildlifeEngine {
    val supportedSpeciesIds: Set<String> = linkedSetOf(
        "seabird", "land-crab", "reef-fish", "island-lizard", "sea-turtle", "wild-rabbit",
        "wild-boar", "mangrove-snake", "fruit-bat", "mountain-goat", "waterfowl", "reef-shark",
    )

    private val awarenessRadius = mapOf(
        "seabird" to 7.0,
        "land-crab" to 4.0,
        "reef-fish" to 5.0,
        "island-lizard" to 5.0,
        "sea-turtle" to 6.0,
        "wild-rabbit" to 8.0,
        "wild-boar" to 8.0,
        "mangrove-snake" to 5.0,
        "fruit-bat" to 7.0,
        "mountain-goat" to 9.0,
        "waterfowl" to 7.0,
        "reef-shark" to 10.0,
    )
    private val proximityRetaliators = setOf(
        "wild-boar", "mangrove-snake", "mountain-goat", "reef-shark",
    )
    private val attackedRetaliators = setOf(
        "wild-boar", "mangrove-snake", "mountain-goat", "reef-shark",
    )

    fun create(save: GameSave): WildlifeState = save.wildlife

    fun step(state: WildlifeState, context: WildlifeContext, elapsedMinutes: Double): WildlifeState {
        require(elapsedMinutes.isFinite() && elapsedMinutes >= 0.0) { "invalid-elapsed" }
        if (elapsedMinutes == 0.0) return state
        val simulatedMinutes = elapsedMinutes.coerceAtMost(360.0)
        val activeEndMinute = round4(state.elapsedMinutes + simulatedMinutes)
        val animals = linkedMapOf<String, AnimalState>()
        state.animals.toSortedMap().forEach { (id, animal) ->
            val player = context.player
            val awareness = awarenessRadius[animal.speciesId]
            val distance = player?.let {
                hypot(animal.position.x - it.position.x, animal.position.y - it.position.y)
            }
            val isActive = awareness != null && distance != null &&
                distance <= awareness && distance <= context.activeRadius.coerceAtLeast(10.0)
            animals[id] = if (!isActive) animal else transition(animal, state.elapsedMinutes, activeEndMinute)
        }
        val populations = state.populations.toSortedMap().mapValuesTo(linkedMapOf()) { (_, population) ->
            updatePopulation(population, elapsedMinutes.coerceAtMost(10_080.0))
        }
        return state.copy(
            elapsedMinutes = round4(state.elapsedMinutes + elapsedMinutes.coerceAtMost(10_080.0)),
            animals = animals,
            populations = populations,
        )
    }

    fun act(
        state: WildlifeState,
        action: WildlifeAction,
        context: WildlifeContext,
    ): WildlifeActionResult {
        if (action.type != "damage") return failure(state, "unsupported-action")
        if (!action.amount.isFinite() || action.amount <= 0.0) return failure(state, "invalid-damage")
        val token = if (action.id.isNotBlank()) {
            action.id
        } else {
            "${action.type}:${action.animalId}:${action.amount}:${round4(state.elapsedMinutes)}"
        }
        if (token in state.processedActions) {
            return WildlifeActionResult(ok = true, state = state, duplicate = true)
        }
        val animal = state.animals[action.animalId] ?: return failure(state, "animal-not-found")
        val processedActions = state.processedActions + token
        val health = round4((animal.health - action.amount).coerceAtLeast(0.0))
        if (health > 0.0) {
            val behavior = if (animal.speciesId in attackedRetaliators) {
                AnimalBehavior.THREATEN
            } else {
                AnimalBehavior.FLEE
            }
            val updated = animal.copy(
                health = health,
                behavior = behavior,
                threatenUntilMinute = if (behavior == AnimalBehavior.THREATEN) {
                    round4(state.elapsedMinutes + 1.0)
                } else {
                    null
                },
            )
            return WildlifeActionResult(
                ok = true,
                state = state.copy(
                    animals = state.animals + (animal.id to updated),
                    processedActions = processedActions,
                ),
            )
        }

        val eventId = "wildlife-killed|${action.animalId}|$token"
        val populationKey = "${animal.regionId}:${animal.speciesId}"
        val populations = state.populations.toMutableMap()
        populations[populationKey]?.let { population ->
            populations[populationKey] = population.copy(
                adults = (population.adults - 1).coerceAtLeast(0),
                huntingPressure = round4(population.huntingPressure + 1.0),
            )
        }
        val event = WildlifeEvent(
            id = eventId,
            type = "wildlife-killed",
            animalId = animal.id,
            speciesId = animal.speciesId,
            playerId = context.player?.id,
        )
        return WildlifeActionResult(
            ok = true,
            state = state.copy(
                animals = state.animals - animal.id,
                populations = populations,
                processedActions = processedActions,
                processedEventIds = state.processedEventIds + eventId,
            ),
            events = listOf(event),
        )
    }

    private fun transition(
        animal: AnimalState,
        startMinute: Double,
        endMinute: Double,
    ): AnimalState {
        if (animal.speciesId !in proximityRetaliators) {
            return animal.copy(behavior = AnimalBehavior.FLEE, threatenUntilMinute = null)
        }
        if (animal.behavior == AnimalBehavior.RETALIATE) return animal
        val deadline = when (animal.behavior) {
            AnimalBehavior.THREATEN -> animal.threatenUntilMinute ?: round4(startMinute + 1.0)
            else -> round4(startMinute + 1.0)
        }
        return if (endMinute >= deadline) {
            animal.copy(behavior = AnimalBehavior.RETALIATE, threatenUntilMinute = null)
        } else {
            animal.copy(
                behavior = AnimalBehavior.THREATEN,
                threatenUntilMinute = deadline,
            )
        }
    }

    private fun updatePopulation(population: PopulationState, elapsedMinutes: Double): PopulationState {
        val previousMinute = population.lastUpdatedMinute
        val nextMinute = round4(previousMinute + elapsedMinutes)
        val previousInterval = floor(previousMinute / 360.0).toInt()
        val nextInterval = floor(nextMinute / 360.0).toInt()
        var adults = population.adults
        var pressure = population.huntingPressure.coerceAtLeast(0.0)
        var recoveryMinutes = population.recoveryMinutes
        repeat((nextInterval - previousInterval).coerceAtLeast(0)) {
            val effectiveCapacity = floor(population.capacity / (1.0 + pressure))
                .toInt()
                .coerceAtLeast(0)
            recoveryMinutes += 360.0
            if (recoveryMinutes >= 1_440.0) {
                if (adults > 0 && adults < effectiveCapacity) {
                    adults = (adults + maxOf(1, floor(adults * 0.25).toInt()))
                        .coerceAtMost(effectiveCapacity)
                }
                recoveryMinutes -= 1_440.0
            }
            pressure = round4((pressure - 360.0 / 14_400.0).coerceAtLeast(0.0))
        }
        return population.copy(
            adults = adults,
            huntingPressure = pressure,
            lastUpdatedMinute = nextMinute,
            recoveryMinutes = round4(recoveryMinutes),
        )
    }

    private fun failure(state: WildlifeState, error: String) = WildlifeActionResult(
        ok = false,
        state = state,
        error = error,
    )

    internal fun round4(value: Double): Double = floor(value * 10_000.0 + 0.5) / 10_000.0
}
