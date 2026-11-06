package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.SurvivalActivity
import cn.zhengzhengstudio.survivaldiary.domain.SurvivalSimulation
import cn.zhengzhengstudio.survivaldiary.domain.Vitals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusClockTest {
    @Test fun `fractional one second ticks accumulate instead of freezing the clock`() {
        val start = SurvivalSimulation.create("fractional-clock")
        val afterOneSecond = SurvivalSimulation.advance(start, 1_000, SurvivalActivity.IDLE)
        val afterTwoSeconds = SurvivalSimulation.advance(afterOneSecond, 1_000, SurvivalActivity.IDLE)

        assertEquals(start.time, afterOneSecond.time)
        assertTrue(afterTwoSeconds.time > start.time)
        assertEquals(1.6, afterTwoSeconds.elapsedGameMinutes, 0.0001)
    }

    @Test fun thirtyRealMinutesAdvanceExactlyOneIslandDay() {
        val start = SurvivalSimulation.create("clock-parity")
        val next = SurvivalSimulation.advance(start, 1_800_000, SurvivalActivity.IDLE)

        assertEquals(2, next.day)
        assertEquals(390, next.time)
        assertEquals("day", next.phase)
    }

    @Test fun miningConsumesStaminaAndUnsafePlayersDoNotRegenerateHealth() {
        val start = SurvivalSimulation.create("vitals-parity").copy(
            vitals = SurvivalSimulation.create("vitals-parity").vitals.copy(health = 70.0),
        )
        val mining = SurvivalSimulation.advance(start, 60_000, SurvivalActivity.MINING)
        val bleeding = SurvivalSimulation.advance(
            start.copy(vitals = start.vitals.copy(effects = listOf("bleeding"))),
            60_000,
            SurvivalActivity.IDLE,
        )

        assertTrue(mining.vitals.stamina < start.vitals.stamina)
        assertEquals(70.0, bleeding.vitals.health, 0.0001)
        assertTrue("untreated-bleeding" in bleeding.recoveryBlockers)
    }

    @Test fun `health regeneration needs strong hunger hydration and normal temperature`() {
        val base = SurvivalSimulation.create("thresholds").copy(
            vitals = Vitals(health = 60.0, stamina = 35.0, hunger = 86.0, hydration = 78.0, bodyTemperature = 37.0),
        )
        val recovered = SurvivalSimulation.advance(base, 75_000, SurvivalActivity.IDLE)
        val hungry = SurvivalSimulation.advance(base.copy(vitals = base.vitals.copy(hunger = 79.0)), 75_000, SurvivalActivity.IDLE)
        val thirsty = SurvivalSimulation.advance(base.copy(vitals = base.vitals.copy(hydration = 69.0)), 75_000, SurvivalActivity.IDLE)

        assertTrue(recovered.vitals.health > base.vitals.health)
        assertEquals(base.vitals.health, hungry.vitals.health, 0.0001)
        assertEquals(base.vitals.health, thirsty.vitals.health, 0.0001)
        assertTrue(recovered.vitals.stamina > hungry.vitals.stamina)
        assertTrue("needs-food" in hungry.recoveryBlockers)
        assertTrue("needs-water" in thirsty.recoveryBlockers)
    }

    @Test fun `stamina recovery is visible during a short idle period and movement interrupts it`() {
        val rested = SurvivalSimulation.create("visible-stamina").copy(
            vitals = Vitals(stamina = 20.0, hunger = 90.0, hydration = 90.0),
        )

        val idle = SurvivalSimulation.advance(rested, 10_000, SurvivalActivity.IDLE)
        val walking = SurvivalSimulation.advance(rested, 10_000, SurvivalActivity.WALKING)
        val sleeping = SurvivalSimulation.advance(rested, 10_000, SurvivalActivity.SLEEPING)
        val exhausted = SurvivalSimulation.advance(
            rested.copy(vitals = rested.vitals.copy(hunger = 8.0, hydration = 8.0)),
            10_000,
            SurvivalActivity.IDLE,
        )

        assertTrue(idle.vitals.stamina >= 21.5)
        assertTrue(walking.vitals.stamina < rested.vitals.stamina)
        assertTrue(sleeping.vitals.stamina > idle.vitals.stamina * 1.05)
        assertEquals(rested.vitals.stamina, exhausted.vitals.stamina, 0.0001)
    }
}
