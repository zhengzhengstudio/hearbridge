package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.WorldGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenWorldParityTest {
    @Test fun terrainSampleMatchesTheSharedReferenceGenerator() {
        val sample = WorldGenerator.sample("smooth-transition", 0.0, 17.0)

        assertEquals(0.4162, sample.height, 0.00001)
        assertEquals(0.4891, sample.moisture, 0.00001)
        assertEquals(0.4645, sample.temperature, 0.00001)
        assertEquals("palm-grove", sample.biome)
        assertEquals(listOf("palm-grove", "cloud-forest", "lagoon"), sample.blend.map { it.biome })
        assertEquals(1.0, sample.blend.sumOf { it.weight }, 0.0002)
    }

    @Test fun neighbouringChunksShareTheExactSameTerrainEdge() {
        val west = WorldGenerator.generate("edge-parity", 0, 0)
        val east = WorldGenerator.generate("edge-parity", 1, 0)

        assertEquals(west.east, east.west)
        assertEquals(289, west.samples.size)
        assertTrue(west.samples.flatMap { it.blend }.all { it.weight in 0.0..1.0 })
    }
}
