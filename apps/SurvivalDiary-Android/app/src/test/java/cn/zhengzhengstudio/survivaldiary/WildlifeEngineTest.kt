package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WildlifeEngineTest {
    private val nearContext = WildlifeContext(
        player = WildlifePlayer("local", WildlifePosition(0.0, 0.0)),
        activeRadius = 16.0,
    )

    @Test fun `rabbit flees and boar threatens under identical proximity`() {
        val rabbit = fixture("wild-rabbit", health = 16.0)
        val boar = fixture("wild-boar", health = 68.0)

        assertEquals(
            AnimalBehavior.FLEE,
            WildlifeEngine.step(rabbit, nearContext, 0.1).animals.getValue("a").behavior,
        )
        assertEquals(
            AnimalBehavior.THREATEN,
            WildlifeEngine.step(boar, nearContext, 0.1).animals.getValue("a").behavior,
        )
    }

    @Test fun `warning duration is identical for one step or segmented steps`() {
        val initial = fixture("wild-boar", health = 68.0)
        val single = WildlifeEngine.step(initial, nearContext, 1.0)
        val segmented = (1..10).fold(initial) { state, _ ->
            WildlifeEngine.step(state, nearContext, 0.1)
        }

        assertEquals(AnimalBehavior.RETALIATE, single.animals.getValue("a").behavior)
        assertEquals(single, segmented)
    }

    @Test fun `warning deadline is absolute for one step or segmented steps`() {
        val initial = fixture("wild-boar", health = 68.0).copy(elapsedMinutes = 720.0)
        val single = WildlifeEngine.step(initial, nearContext, 0.9)
        val segmented = (1..9).fold(initial) { state, _ ->
            WildlifeEngine.step(state, nearContext, 0.1)
        }

        assertEquals(720.9, single.elapsedMinutes, 0.0)
        assertEquals(721.0, single.animals.getValue("a").threatenUntilMinute ?: -1.0, 0.0)
        assertEquals(single, segmented)
    }

    @Test fun `population recovery is identical for one day or four six hour steps`() {
        val key = "0,0:wild-boar"
        val initial = WildlifeState(
            populations = mapOf(
                key to PopulationState(
                    adults = 1,
                    young = 0,
                    capacity = 10,
                    huntingPressure = 0.0,
                    lastUpdatedMinute = 0.0,
                ),
            ),
        )
        val single = WildlifeEngine.step(initial, nearContext, 1_440.0)
        val segmented = (1..4).fold(initial) { state, _ ->
            WildlifeEngine.step(state, nearContext, 360.0)
        }

        assertEquals(2, single.populations.getValue(key).adults)
        assertEquals(single.populations.getValue(key), segmented.populations.getValue(key))
    }

    @Test fun `damage rounds to four decimals and lethal action updates population once`() {
        val initial = fixture("wild-rabbit", health = 16.0)
        val wounded = WildlifeEngine.act(
            initial,
            WildlifeAction(id = "hit-1", type = "damage", animalId = "a", amount = 1.23456),
            nearContext,
        )
        val killed = WildlifeEngine.act(
            wounded.state,
            WildlifeAction(id = "hit-2", type = "damage", animalId = "a", amount = 99.0),
            nearContext,
        )
        val retried = WildlifeEngine.act(
            killed.state,
            WildlifeAction(id = "hit-2", type = "damage", animalId = "a", amount = 99.0),
            nearContext,
        )

        assertTrue(wounded.ok)
        assertEquals(14.7654, wounded.state.animals.getValue("a").health, 0.0)
        assertTrue(killed.ok)
        assertFalse("a" in killed.state.animals)
        assertEquals(0, killed.state.populations.getValue("0,0:wild-rabbit").adults)
        assertEquals(setOf("wildlife-killed|a|hit-2"), killed.state.processedEventIds)
        assertTrue(retried.ok)
        assertEquals(killed.state, retried.state)
        assertTrue(retried.events.isEmpty())
    }

    @Test fun `nonlethal action id retry returns first state without applying damage twice`() {
        val initial = fixture("wild-rabbit", health = 16.0)
        val action = WildlifeAction(id = "nonlethal-1", type = "damage", animalId = "a", amount = 1.0)

        val first = WildlifeEngine.act(initial, action, nearContext)
        val retried = WildlifeEngine.act(first.state, action, nearContext)

        assertEquals(15.0, first.state.animals.getValue("a").health, 0.0)
        assertEquals(setOf("nonlethal-1"), first.state.processedActions)
        assertTrue(retried.duplicate)
        assertEquals(first.state, retried.state)
    }

    @Test fun `nonlethal attack at nonzero time uses absolute warning deadline across segmented steps`() {
        val initial = fixture("wild-boar", health = 68.0).copy(elapsedMinutes = 720.0)
        val attacked = WildlifeEngine.act(
            initial,
            WildlifeAction(id = "late-hit", type = "damage", animalId = "a", amount = 1.0),
            nearContext,
        ).state
        val short = WildlifeEngine.step(attacked, nearContext, 0.4)
        val segmented = (1..4).fold(attacked) { state, _ ->
            WildlifeEngine.step(state, nearContext, 0.1)
        }
        val expired = WildlifeEngine.step(short, nearContext, 0.6)

        assertEquals(721.0, attacked.animals.getValue("a").threatenUntilMinute ?: -1.0, 0.0)
        assertEquals(AnimalBehavior.THREATEN, short.animals.getValue("a").behavior)
        assertEquals(short, segmented)
        assertEquals(AnimalBehavior.RETALIATE, expired.animals.getValue("a").behavior)
    }

    @Test fun `four decimal rounding matches JavaScript positive and negative ties`() {
        assertEquals(0.0001, WildlifeEngine.round4(0.00005), 0.0)
        assertEquals(0.0, WildlifeEngine.round4(-0.00005), 0.0)
    }

    @Test fun `create accepts every frozen species id without resetting stored ecology`() {
        val speciesIds = listOf(
            "seabird", "land-crab", "reef-fish", "island-lizard", "sea-turtle", "wild-rabbit",
            "wild-boar", "mangrove-snake", "fruit-bat", "mountain-goat", "waterfowl", "reef-shark",
        )
        val wildlife = WildlifeState(
            animals = speciesIds.mapIndexed { index, speciesId ->
                "animal-$index" to AnimalState(
                    id = "animal-$index",
                    speciesId = speciesId,
                    regionId = "0,0",
                    position = WildlifePosition(index.toDouble(), 20.0),
                    health = 10.0,
                )
            }.toMap(),
        )
        val save = GameSave(seed = "all-species", wildlife = wildlife)

        assertEquals(wildlife, WildlifeEngine.create(save))
        assertEquals(speciesIds.toSet(), WildlifeEngine.supportedSpeciesIds)
    }

    private fun fixture(speciesId: String, health: Double): WildlifeState = WildlifeState(
        animals = mapOf(
            "a" to AnimalState(
                id = "a",
                speciesId = speciesId,
                regionId = "0,0",
                position = WildlifePosition(2.0, 0.0),
                health = health,
            ),
        ),
        populations = mapOf(
            "0,0:$speciesId" to PopulationState(
                adults = 1,
                young = 0,
                capacity = 10,
                huntingPressure = 0.0,
                lastUpdatedMinute = 0.0,
            ),
        ),
    )
}
