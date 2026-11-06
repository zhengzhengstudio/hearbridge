import XCTest
@testable import SurvivalDiaryCore

final class FacilityRulesTests: XCTestCase {
    private let copperRecipe = FurnaceRecipe(
        id: "smelt-copper",
        inputItemID: "copper-ore",
        inputAmount: 3,
        fuelItemID: "charcoal",
        fuelAmount: 2,
        outputItemID: "copper-ingot",
        outputAmount: 1,
        durationMinutes: 30
    )

    private func world(inventory: [String: Int]) -> GameSave {
        GameSave(
            seed: "apple-facility-test",
            inventory: inventory,
            entities: [.init(id: "furnace-1", type: "furnace", position: .init(x: 10, y: 10))]
        )
    }

    func testFurnaceValidatesFuelSeparately() {
        let result = FacilityRules.startFurnace(
            world(inventory: ["copper-ore": 3]),
            entityID: "furnace-1",
            recipe: copperRecipe
        )

        XCTAssertEqual(result.failure, .missingFuel)
        XCTAssertEqual(result.save.inventory["copper-ore"], 3)
    }

    func testFurnaceProgressPersistsUntilOutputIsClaimed() {
        let started = FacilityRules.startFurnace(
            world(inventory: ["copper-ore": 3, "charcoal": 2]),
            entityID: "furnace-1",
            recipe: copperRecipe
        )
        XCTAssertNil(started.failure)
        XCTAssertEqual(started.save.inventory["copper-ore", default: 0], 0)
        XCTAssertEqual(started.save.inventory["charcoal", default: 0], 0)

        let working = FacilityRules.advance(started.save, elapsedGameMinutes: 15)
        XCTAssertEqual(working.facilityProcesses["furnace-1"]?.status, .working)
        let ready = FacilityRules.advance(working, elapsedGameMinutes: 15)
        XCTAssertEqual(ready.facilityProcesses["furnace-1"]?.status, .ready)
        XCTAssertEqual(ready.facilityProcesses["furnace-1"]?.output["copper-ingot"], 1)

        let claimed = FacilityRules.claimFurnace(ready, entityID: "furnace-1")
        XCTAssertNil(claimed.failure)
        XCTAssertEqual(claimed.save.inventory["copper-ingot"], 1)
        XCTAssertEqual(claimed.save.facilityProcesses["furnace-1"]?.status, .idle)
    }

    func testStorageMovesStacksBothDirections() {
        var save = GameSave(seed: "apple-storage", inventory: ["stone": 7])
        save.entities = [.init(id: "crate-1", type: "storage-crate", position: .init(x: 10, y: 10))]

        let deposited = FacilityRules.transferStorage(save, entityID: "crate-1", itemID: "stone", amount: 4, direction: .deposit)
        XCTAssertNil(deposited.failure)
        XCTAssertEqual(deposited.save.inventory["stone"], 3)
        XCTAssertEqual(deposited.save.containerInventories["crate-1"]?["stone"], 4)

        let withdrawn = FacilityRules.transferStorage(deposited.save, entityID: "crate-1", itemID: "stone", amount: 2, direction: .withdraw)
        XCTAssertNil(withdrawn.failure)
        XCTAssertEqual(withdrawn.save.inventory["stone"], 5)
        XCTAssertEqual(withdrawn.save.containerInventories["crate-1"]?["stone"], 2)
    }
}
