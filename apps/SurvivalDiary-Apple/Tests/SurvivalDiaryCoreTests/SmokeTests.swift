import XCTest
@testable import SurvivalDiaryCore

final class SmokeTests: XCTestCase {
    func testNewGameUsesV4GuidedSave() {
        let save = GameSave(seed: "native")
        XCTAssertEqual(save.schemaVersion, 5)
        XCTAssertEqual(save.playMode, .guided)
    }

    func testGoldenFixtureDigestMatchesCanonicalWorld() throws {
        var world = Simulation.create(seed: "20260729", playMode: .guided)
        let commands: [WorldCommand] = [
            .discoverRegion(x: 0, y: 0), .advanceTime(180), .discoverRegion(x: 11, y: -8),
            .gather(itemID: "driftwood", amount: 2), .gather(itemID: "palm-fiber", amount: 3),
            .craft(recipeID: "craft-fishing-rod"), .setPlayMode(.free),
            .writeDiary(entryID: "day-1", text: "Gathered supplies and crossed the shore."),
        ]
        for command in commands { world = try Simulation.step(world, command: command) }
        XCTAssertEqual(try Simulation.stableJSON(world), #"{"build":15,"day":1,"entities":{},"inventory":{"fishing-rod":1},"journals":{"day-1":{"text":"Gathered supplies and crossed the shore."}},"milestones":{},"playMode":"free","players":{},"productVersion":"0.5.0","regions":{"0,0":{"biomeId":"mangrove","elevation":0.5135,"id":"0,0","moisture":0.8891,"resources":["branch","coconut","driftwood","fresh-water","palm-fiber","reef-fish","stone"],"temperature":0.303,"x":0,"y":0},"11,-8":{"biomeId":"palm-grove","elevation":0.2146,"id":"11,-8","moisture":0.1961,"resources":["driftwood","palm-fiber","fresh-water"],"temperature":0.5745,"x":11,"y":-8}},"schemaVersion":2,"seed":"20260729","time":540,"weather":{"intensity":0.4087,"kind":"cloudy","wetness":0.0204,"wind":0.1761}}"#)
        XCTAssertEqual(try Simulation.stableDigest(world), "097b8dcab5e03538c55536a1e80159d58f570538f7080b8020581d73d9b843b8")
    }

    func testModeSwitchKeepsIslandState() {
        var save = GameSave(seed: "same", inventory: ["fiber": 4], entities: [.init(id: "e1", type: "campfire", position: .init(x: 1, y: 2))])
        let entities = save.entities; let inventory = save.inventory
        save.playMode = .free
        XCTAssertEqual(save.entities, entities); XCTAssertEqual(save.inventory, inventory)
    }

    func testTransportStarterDoesNotPutHeavyRailInBackpack() {
        let save = TransportRules.ensureStarter(GameSave(seed: "transport-starter"))
        XCTAssertEqual(save.entities.filter { $0.type == "rail-segment" }.count, 2)
        XCTAssertEqual(save.inventory["rail-segment", default: 0], 0)
    }

    func testRoadRecipeCreatesFourPlaceableSegments() throws {
        var world = Simulation.create(seed: "native-road", playMode: .guided)
        world.inventory = ["branch": 1, "stone": 1]
        world = try Simulation.step(world, command: .craft(recipeID: "build-road-segment"))
        XCTAssertEqual(world.inventory?["road-segment"], 4)
        world = try Simulation.step(world, command: .place(entityID: "road-1", itemID: "road-segment", x: 2, y: 3))
        XCTAssertEqual(world.entities["road-1"]?.coordinates, Coordinates(x: 2, y: 3))
        XCTAssertEqual(world.inventory?["road-segment"], 3)
    }

    func testThirtyMinuteClockAndNutritionGatedRecovery() {
        var fed = GameSave(seed: "native-clock")
        fed.player = PlayerState(health: 60, energy: 35, water: 78, food: 86)
        let recovered = SurvivalRules.advance(fed, elapsedRealSeconds: 75, activity: .idle)

        var hungry = fed
        hungry.player.food = 79
        let blocked = SurvivalRules.advance(hungry, elapsedRealSeconds: 75, activity: .idle)

        XCTAssertEqual(recovered.clock.minute, fed.clock.minute + 60)
        XCTAssertGreaterThan(recovered.player.health, fed.player.health)
        XCTAssertEqual(blocked.player.health, hungry.player.health)
        XCTAssertGreaterThan(recovered.player.energy, blocked.player.energy)
        XCTAssertTrue(blocked.recoveryBlockers.contains("needs-food"))
    }

    func testShortClockTicksAccumulateStaminaInsteadOfRoundingRecoveryAway() {
        var save = GameSave(seed: "fractional-stamina")
        save.player = PlayerState(health: 80, energy: 35, water: 90, food: 90)

        for _ in 0..<4 {
            save = SurvivalRules.advance(save, elapsedRealSeconds: 1.25, activity: .idle)
        }

        XCTAssertGreaterThan(Double(save.player.energy), 35.5)
        XCTAssertLessThan(Double(save.player.energy), 37)
    }

    func testSaveRepositoryFallsBackToPreviousSnapshotWhenCurrentIsCorrupt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = SaveRepository(directory: directory)
        try await repository.save(slot: "main", state: GameSave(seed: "first", inventory: ["stone": 3]))
        try await repository.save(slot: "main", state: GameSave(seed: "second", inventory: ["stone": 9]))
        try Data("{broken".utf8).write(to: directory.appendingPathComponent("main.current.json"))

        let restored = try await repository.load(slot: "main")
        XCTAssertEqual(restored?.seed, "first")
        XCTAssertEqual(restored?.inventory["stone"], 3)
    }
}
