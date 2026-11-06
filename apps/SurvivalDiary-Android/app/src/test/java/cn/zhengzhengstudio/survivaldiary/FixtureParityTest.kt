package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.*
import org.junit.Assert.assertEquals
import org.junit.Test

class FixtureParityTest {
    @Test fun goldenFixtureMatches() {
        val commands = listOf(
            GameCommand.DiscoverRegion(Coordinates(0, 0)), GameCommand.AdvanceTime(180),
            GameCommand.DiscoverRegion(Coordinates(11, -8)), GameCommand.Gather("driftwood", 2),
            GameCommand.Gather("fiber", 3), GameCommand.Craft("craft-fishing-rod"),
            GameCommand.SetPlayMode(PlayMode.FREE), GameCommand.WriteDiary("day-1", "Gathered supplies and crossed the shore."),
        )
        val result = commands.fold(Simulation.create("20260729", PlayMode.GUIDED), Simulation::step)
        assertEquals("ad91ba5c034487f6aee367d9141ead4026bb6538cb6439d18a0e117f9c3dd2bf", result.stableDigest())
    }

    @Test fun switchingModePreservesIsland() {
        val before = Simulation.step(Simulation.create("island"), GameCommand.DiscoverRegion(Coordinates(2, 3)))
        val after = Simulation.step(before, GameCommand.SetPlayMode(PlayMode.FREE))
        assertEquals(before.regions, after.regions)
        assertEquals(before.entities, after.entities)
        assertEquals(PlayMode.FREE, after.playMode)
    }

    @Test fun buildingsCanBeRepairedAndDismantled() {
        val damaged = Entity("camp-1", "campfire", Coordinates(2, 3), durability = 4)
        val initial = Simulation.create("building").copy(entities = mapOf(damaged.id to damaged))
        val repaired = Simulation.step(initial, GameCommand.Repair(damaged.id, 4))
        assertEquals(8, repaired.entities[damaged.id]?.durability)
        val dismantled = Simulation.step(repaired, GameCommand.Dismantle(damaged.id))
        assertEquals(null, dismantled.entities[damaged.id])
        assertEquals(1, dismantled.inventory["campfire"])
    }
}
