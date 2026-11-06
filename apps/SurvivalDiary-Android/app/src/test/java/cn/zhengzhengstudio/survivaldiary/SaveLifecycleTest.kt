package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.data.SaveRepository
import cn.zhengzhengstudio.survivaldiary.domain.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SaveLifecycleTest {
    @Test fun `new survival worlds use runtime schema four`() {
        assertEquals(4, GameSave(seed = "schema-default").schemaVersion)
        assertEquals(4, SurvivalSimulation.create("schema-four").schemaVersion)
    }

    @Test fun `migrated v3 save continues advancing after repository recreation`() = withRepository { directory, repository ->
        val legacyRuntimeSave = SurvivalSimulation.create("v3-runtime").copy(schemaVersion = 3)
        repository.save("runtime", legacyRuntimeSave)

        val restored = SaveRepository(directory).load("runtime")
        val advanced = SurvivalSimulation.advance(
            requireNotNull(restored),
            elapsedRealMs = 1_000,
            activity = SurvivalActivity.IDLE,
        )

        assertEquals(4, restored.schemaVersion)
        assertEquals(4, advanced.schemaVersion)
        assertTrue(advanced.elapsedGameMinutes > restored.elapsedGameMinutes)
    }

    @Test fun `non object current save falls back to previous`() = withRepository { directory, repository ->
        assertInvalidCurrentFallsBack(directory, repository, listOf("null", "[]"))
    }

    @Test fun `empty current save falls back to previous`() = withRepository { directory, repository ->
        assertInvalidCurrentFallsBack(directory, repository, listOf("{}"))
    }

    @Test fun `unsupported save versions fall back to previous`() = withRepository { directory, repository ->
        assertInvalidCurrentFallsBack(
            directory,
            repository,
            listOf(
                """{"schemaVersion":1,"seed":"current","day":2,"time":600}""",
                """{"schemaVersion":5,"seed":"current","day":2,"time":600}""",
            ),
        )
    }

    @Test fun `wrong required field types fall back to previous`() = withRepository { directory, repository ->
        assertInvalidCurrentFallsBack(
            directory,
            repository,
            listOf(
                """{"schemaVersion":"4","seed":"current","day":2,"time":600}""",
                """{"schemaVersion":4,"seed":7,"day":2,"time":600}""",
                """{"schemaVersion":4,"seed":"current","day":"2","time":600}""",
                """{"schemaVersion":4,"seed":"current","day":2,"time":[]}""",
            ),
        )
    }

    @Test fun `wrong nested field types fall back to previous`() = withRepository { directory, repository ->
        assertInvalidCurrentFallsBack(
            directory,
            repository,
            listOf(
                """{"schemaVersion":4,"seed":"current","day":2,"time":600,"players":{"local":[]}}""",
                """{"schemaVersion":4,"seed":"current","day":2,"time":600,"players":{"local":{"id":"local","position":{"x":"12","y":4},"inventory":{}}}}""",
                """{"schemaVersion":4,"seed":"current","day":2,"time":600,"inventory":{"stone":"4"}}""",
                """{"schemaVersion":4,"seed":"current","day":2,"time":600,"weather":{"kind":"rain","intensity":"wet"}}""",
                """{"schemaVersion":4,"seed":"current","day":2,"time":600,"animals":{"rabbit":[]}}""",
            ),
        )
    }

    @Test fun `malformed canonical v4 wildlife falls back to previous`() = withRepository { directory, repository ->
        val canonical = """{"schemaVersion":4,"seed":"current","day":2,"time":600,"elapsedMinutes":720.0,"animals":{"a":{"id":"a","speciesId":"wild-boar","regionId":"0,0","position":{"x":1.5,"y":2.5},"health":68.0,"state":"threaten","threatenUntilMinute":721.0}},"populations":{"p":{"adults":2,"young":1,"capacity":10,"huntingPressure":0.25,"lastUpdatedMinute":720.0,"recoveryMinutes":60.0}},"nests":{"n":{"speciesId":"seabird","eggs":2}},"traps":{"t":{"state":"set"}},"domestication":{"d":{"trust":0.4}},"wildlifeTraces":{"w":{"kind":"hoofprint","minute":710.0}},"processedActions":{"hit":true},"processedEventIds":["event"]}"""
        val malformed = linkedMapOf(
            "missing elapsed" to canonical.replace("\"elapsedMinutes\":720.0,", ""),
            "missing animals" to canonical.replace(Regex(",\"animals\":\\{.*?\\}(?=,\"populations\")"), ""),
            "missing populations" to canonical.replace(Regex(",\"populations\":\\{.*?\\}(?=,\"nests\")"), ""),
            "missing nests" to canonical.replace(Regex(",\"nests\":\\{.*?\\}(?=,\"traps\")"), ""),
            "missing traps" to canonical.replace(Regex(",\"traps\":\\{.*?\\}(?=,\"domestication\")"), ""),
            "missing domestication" to canonical.replace(Regex(",\"domestication\":\\{.*?\\}(?=,\"wildlifeTraces\")"), ""),
            "missing traces" to canonical.replace(Regex(",\"wildlifeTraces\":\\{.*?\\}(?=,\"processedActions\")"), ""),
            "missing actions" to canonical.replace(Regex(",\"processedActions\":\\{.*?\\}(?=,\"processedEventIds\")"), ""),
            "missing events" to canonical.replace(",\"processedEventIds\":[\"event\"]", ""),
            "animal missing id" to canonical.replace("\"id\":\"a\",", ""),
            "animal species enum" to canonical.replace("\"speciesId\":\"wild-boar\"", "\"speciesId\":\"dragon\""),
            "animal missing region" to canonical.replace("\"regionId\":\"0,0\",", ""),
            "animal position type" to canonical.replace("\"x\":1.5", "\"x\":\"1.5\""),
            "animal health range" to canonical.replace("\"health\":68.0", "\"health\":0"),
            "animal state enum" to canonical.replace("\"state\":\"threaten\"", "\"state\":\"sleeping\""),
            "animal deadline finite" to canonical.replace("\"threatenUntilMinute\":721.0", "\"threatenUntilMinute\":1e309"),
            "population missing adults" to canonical.replace("\"adults\":2,", ""),
            "population young range" to canonical.replace("\"young\":1", "\"young\":-1"),
            "population capacity range" to canonical.replace("\"capacity\":10", "\"capacity\":-1"),
            "population pressure range" to canonical.replace("\"huntingPressure\":0.25", "\"huntingPressure\":-0.1"),
            "population update finite" to canonical.replace("\"lastUpdatedMinute\":720.0", "\"lastUpdatedMinute\":1e309"),
            "population recovery range" to canonical.replace("\"recoveryMinutes\":60.0", "\"recoveryMinutes\":-1"),
            "nest species enum" to canonical.replace("\"speciesId\":\"seabird\"", "\"speciesId\":\"dragon\""),
            "nest eggs range" to canonical.replace("\"eggs\":2", "\"eggs\":-1"),
            "trap state enum" to canonical.replace("\"state\":\"set\"", "\"state\":\"unknown\""),
            "domestication trust range" to canonical.replace("\"trust\":0.4", "\"trust\":1.1"),
            "trace missing kind" to canonical.replace("\"kind\":\"hoofprint\",", ""),
            "trace minute range" to canonical.replace("\"minute\":710.0", "\"minute\":-1"),
            "processed action value" to canonical.replace("\"hit\":true", "\"hit\":false"),
            "processed event type" to canonical.replace("[\"event\"]", "[7]"),
        )

        repository.save("fallback", SurvivalSimulation.create("previous"))
        repository.save("fallback", SurvivalSimulation.create("current"))
        val current = directory.resolve("save-fallback.current")
        malformed.forEach { (case, json) ->
            current.writeText(json)
            assertEquals(case, "previous", repository.load("fallback")?.seed)
        }
    }

    @Test fun `canonical v3 player survives migration save and reload`() = withRepository { directory, repository ->
        val sharedV3 = """
            {
              "schemaVersion":3,
              "seed":"shared-player",
              "day":2,
              "time":615,
              "players":{
                "local":{
                  "id":"local",
                  "position":{"x":12.5,"y":-8.25},
                  "inventory":{"rope":1,"water":2}
                }
              }
            }
        """.trimIndent()
        val expected = PlayerRecord(
            id = "local",
            position = PlayerPosition(12.5, -8.25),
            inventory = mapOf("rope" to 1, "water" to 2),
        )

        val migrated = repository.importLegacyExport(sharedV3)
        repository.save("player", migrated)
        val restored = SaveRepository(directory).load("player")

        assertEquals(expected, migrated.players.getValue("local"))
        assertEquals(expected, restored?.players?.get("local"))
    }

    @Test fun `decimal movement preserves custom player identity and inventory after restart`() = withRepository { directory, repository ->
        val initial = SurvivalSimulation.create("moving-player").copy(
            players = mapOf(
                "local" to PlayerRecord(
                    id = "traveler-42",
                    position = PlayerPosition(12.5, -8.25),
                    inventory = mapOf("rope" to 1),
                ),
            ),
        )

        val moved = initial.withPlayerPosition("local", PlayerPosition(12.75, -8.125))
        repository.save("moving-player", moved)
        val restored = requireNotNull(SaveRepository(directory).load("moving-player"))

        assertEquals(
            PlayerRecord("traveler-42", PlayerPosition(12.75, -8.125), mapOf("rope" to 1)),
            restored.players.getValue("local"),
        )
    }

    @Test fun `absolute wildlife warning deadline survives save and restart`() = withRepository { directory, repository ->
        val initial = WildlifeState(
            elapsedMinutes = 720.0,
            animals = mapOf(
                "boar" to AnimalState(
                    "boar", "wild-boar", "0,0", WildlifePosition(2.0, 0.0), 68.0,
                ),
            ),
        )
        val warned = WildlifeEngine.step(
            initial,
            WildlifeContext(WildlifePlayer("local", WildlifePosition(0.0, 0.0))),
            0.1,
        )
        repository.save("warning", SurvivalSimulation.create("warning").copy(wildlife = warned))

        val restored = requireNotNull(SaveRepository(directory).load("warning")).wildlife
        val retaliating = WildlifeEngine.step(
            restored,
            WildlifeContext(WildlifePlayer("local", WildlifePosition(0.0, 0.0))),
            0.9,
        )

        assertEquals(720.1, restored.elapsedMinutes, 0.0)
        assertEquals(721.0, restored.animals.getValue("boar").threatenUntilMinute ?: -1.0, 0.0)
        assertEquals(AnimalBehavior.RETALIATE, retaliating.animals.getValue("boar").behavior)
    }

    @Test fun `nonlethal action retry stays idempotent after save and restart`() = withRepository { directory, repository ->
        val initial = WildlifeState(
            animals = mapOf(
                "rabbit" to AnimalState(
                    "rabbit", "wild-rabbit", "0,0", WildlifePosition(2.0, 0.0), 16.0,
                ),
            ),
        )
        val context = WildlifeContext(WildlifePlayer("local", WildlifePosition(0.0, 0.0)))
        val action = WildlifeAction("persisted-hit", "damage", "rabbit", 1.0)
        val first = WildlifeEngine.act(initial, action, context)
        repository.save("action", SurvivalSimulation.create("action").copy(wildlife = first.state))

        val restored = requireNotNull(SaveRepository(directory).load("action")).wildlife
        val retried = WildlifeEngine.act(restored, action, context)

        assertEquals(setOf("persisted-hit"), restored.processedActions)
        assertTrue(retried.duplicate)
        assertEquals(15.0, retried.state.animals.getValue("rabbit").health, 0.0)
        assertEquals(restored, retried.state)
    }

    @Test fun `concurrent repository instances serialize shared slot without corrupting current or previous`() = withRepository { directory, repository ->
        val secondRepository = SaveRepository(directory)
        val executor = Executors.newFixedThreadPool(8)
        val start = CountDownLatch(1)
        val seeds = (0 until 32).map { "parallel-$it" }.toSet()
        try {
            val futures = seeds.mapIndexed { index, seed ->
                executor.submit {
                    start.await()
                    (if (index % 2 == 0) repository else secondRepository)
                        .save("parallel", SurvivalSimulation.create(seed))
                }
            }
            start.countDown()
            futures.forEach { it.get(20, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }

        val current = requireNotNull(repository.load("parallel"))
        assertTrue(current.seed in seeds)
        directory.resolve("save-parallel.current").writeText("{interrupted")
        val previous = requireNotNull(repository.load("parallel"))
        assertTrue(previous.seed in seeds)
        assertNotEquals(current.seed, previous.seed)
        assertTrue(directory.listFiles().orEmpty().none { it.name.contains("pending") })
    }

    @Test fun `corrupted current save falls back to atomically replaced previous`() = withRepository { directory, repository ->
        repository.save("recovery", SurvivalSimulation.create("first"))
        repository.save("recovery", SurvivalSimulation.create("second"))

        directory.resolve("save-recovery.current").writeText("{\"schemaVersion\":4")

        assertEquals("first", repository.load("recovery")?.seed)
    }

    @Test fun `saving after interrupted current keeps last valid previous`() = withRepository { directory, repository ->
        repository.save("interrupted", SurvivalSimulation.create("first"))
        repository.save("interrupted", SurvivalSimulation.create("second"))
        directory.resolve("save-interrupted.current").writeText("{interrupted")

        repository.save("interrupted", SurvivalSimulation.create("third"))
        directory.resolve("save-interrupted.current").writeText("{interrupted-again")

        assertEquals("first", repository.load("interrupted")?.seed)
    }

    @Test fun `json parser rejects unescaped c0 control characters in strings`() = withRepository { _, repository ->
        val control = 1.toChar()
        val invalid = """{"schemaVersion":4,"seed":"bad${control}seed","day":1,"time":360}"""

        assertThrows(IllegalArgumentException::class.java) {
            repository.importLegacyExport(invalid)
        }
    }

    @Test fun `json parser rejects non-json whitespace between tokens and falls back`() = withRepository { directory, repository ->
        repository.save("whitespace", SurvivalSimulation.create("previous"))
        repository.save("whitespace", SurvivalSimulation.create("current"))
        val current = directory.resolve("save-whitespace.current")
        val canonical = current.readText()

        listOf(0x0b.toChar(), 0x0c.toChar()).forEach { forbidden ->
            current.writeText(canonical.replaceFirst(",", ",${forbidden}"))
            assertEquals("previous", repository.load("whitespace")?.seed)
        }
    }

    @Test fun `saved world wins over the fresh factory on launch`() {
        val saved = SurvivalSimulation.create("kept").copy(
            inventory = mapOf("stone" to 17),
            entities = mapOf("shelter" to Entity("shelter", "shelter", Coordinates(5, 6))),
        )
        val restored = SaveLifecycle.initial(saved) { SurvivalSimulation.create("new") }
        assertEquals("kept", restored.seed)
        assertEquals(17, restored.inventory["stone"])
        assertTrue("shelter" in restored.entities)
    }

    @Test fun `starter world promises visible essential resources`() {
        assertEquals(setOf("stone", "branch", "palm-fiber", "fresh-water", "coconut"), StarterResourcePolicy.requiredItems)
        assertEquals(
            mapOf("stone" to 2, "branch" to 1, "palm-fiber" to 3, "fresh-water" to 2, "coconut" to 1),
            StarterResourcePolicy.missingAmounts(
                mapOf("stone" to 1, "branch" to 1, "palm-fiber" to 1),
            ),
        )
        assertEquals(emptyMap<String, Int>(), StarterResourcePolicy.missingAmounts(StarterResourcePolicy.minimumCounts))
    }

    @Test fun `wildlife fields survive atomic save round trip and restart`() = withRepository { directory, repository ->
        val wildlife = WildlifeState(
            animals = linkedMapOf(
                "z-rabbit" to AnimalState("z-rabbit", "wild-rabbit", "0,0", WildlifePosition(2.25, 3.5), 15.8754, AnimalBehavior.FLEE),
                "a-boar" to AnimalState("a-boar", "wild-boar", "0,0", WildlifePosition(4.0, 9.0), 68.0, AnimalBehavior.THREATEN, 721.0),
            ),
            populations = mapOf("0,0:wild-boar" to PopulationState(2, 1, 10, 0.25, 720.0, 60.0)),
            nests = mapOf("nest-1" to NestState("seabird", 2)),
            traps = mapOf("trap-1" to TrapState("set")),
            domestication = mapOf("goat-1" to DomesticationState(0.4)),
            traces = mapOf("track-1" to WildlifeTrace("hoofprint", 710.0)),
            processedEventIds = linkedSetOf("prior-event", "another-event"),
        )
        val original = SurvivalSimulation.create("wildlife").copy(
            schemaVersion = 4,
            day = 5,
            time = 735,
            inventory = mapOf("stone" to 4, "waterskin" to 1),
            entities = mapOf("camp" to Entity("camp", "shelter", Coordinates(2, -3))),
            players = mapOf("local" to PlayerRecord("local", PlayerPosition(12.0, -8.0))),
            journals = mapOf("day1" to DiaryEntry("Reached the lagoon.")),
            weather = Weather("rain", 0.6, 0.7, 0.4),
            wildlife = wildlife,
        )

        repository.save("wildlife", original)
        val restartedRepository = SaveRepository(directory)
        val restored = restartedRepository.load("wildlife")

        assertNotNull(restored)
        assertEquals(original, restored)
        assertEquals(wildlife, restored?.wildlife)
        val encoded = directory.resolve("save-wildlife.current").readText()
        assertTrue(encoded.indexOf("\"animals\"") < encoded.indexOf("\"populations\""))
        assertTrue(encoded.indexOf("\"populations\"") < encoded.indexOf("\"nests\""))
        assertTrue(encoded.indexOf("\"nests\"") < encoded.indexOf("\"traps\""))
        assertTrue(encoded.indexOf("\"traps\"") < encoded.indexOf("\"domestication\""))
        assertTrue(encoded.indexOf("\"domestication\"") < encoded.indexOf("\"wildlifeTraces\""))
        assertTrue(encoded.indexOf("\"a-boar\"") < encoded.indexOf("\"z-rabbit\""))
    }

    @Test fun `legacy save keeps progress and gains empty wildlife before initialization`() = withRepository { _, repository ->
        val legacy = """
            {
              "schemaVersion":2,
              "productVersion":"0.4.9",
              "build":14,
              "seed":"old-world",
              "day":4,
              "time":710,
              "weather":{"kind":"rain","intensity":0.6,"wetness":0.7,"wind":0.4},
              "inventory":{"stone":4,"waterskin":1},
              "entities":{"camp":{"id":"camp","type":"shelter","x":2,"y":-3,"durability":8,"maxDurability":10,"rotation":90}},
              "players":{"local":{"x":12,"y":-8}},
              "journals":{"day1":{"text":"Reached the lagoon.","facts":["rain"]}}
            }
        """.trimIndent()

        val migrated = repository.importLegacyExport(legacy)

        assertEquals(4, migrated.schemaVersion)
        assertEquals(4, migrated.day)
        assertEquals(710, migrated.time)
        assertEquals("rain", migrated.weather.kind)
        assertEquals(mapOf("stone" to 4, "waterskin" to 1), migrated.inventory)
        assertEquals(Coordinates(2, -3), migrated.entities.getValue("camp").coordinates)
        assertEquals(PlayerPosition(12.0, -8.0), migrated.players.getValue("local").position)
        assertEquals("Reached the lagoon.", migrated.journals.getValue("day1").text)
        assertEquals(WildlifeState(), migrated.wildlife)
        assertEquals(WildlifeState(), WildlifeEngine.create(migrated))
    }

    private fun withRepository(block: (java.io.File, SaveRepository) -> Unit) {
        val directory = Files.createTempDirectory("survival-diary-save-").toFile()
        try {
            block(directory, SaveRepository(directory))
        } finally {
            directory.deleteRecursively()
        }
    }

    private fun assertInvalidCurrentFallsBack(
        directory: java.io.File,
        repository: SaveRepository,
        invalidCurrentValues: List<String>,
    ) {
        repository.save("fallback", SurvivalSimulation.create("previous"))
        repository.save("fallback", SurvivalSimulation.create("current"))
        val current = directory.resolve("save-fallback.current")
        invalidCurrentValues.forEach { invalid ->
            current.writeText(invalid)
            assertEquals("previous", repository.load("fallback")?.seed)
        }
    }
}
