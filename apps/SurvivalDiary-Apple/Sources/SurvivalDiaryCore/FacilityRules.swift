import Foundation

public struct FurnaceRecipe: Equatable, Sendable, Identifiable {
    public let id: String
    public let inputItemID: String
    public let inputAmount: Int
    public let fuelItemID: String
    public let fuelAmount: Int
    public let outputItemID: String
    public let outputAmount: Int
    public let durationMinutes: Double

    public init(
        id: String,
        inputItemID: String,
        inputAmount: Int,
        fuelItemID: String,
        fuelAmount: Int,
        outputItemID: String,
        outputAmount: Int,
        durationMinutes: Double
    ) {
        self.id = id
        self.inputItemID = inputItemID
        self.inputAmount = inputAmount
        self.fuelItemID = fuelItemID
        self.fuelAmount = fuelAmount
        self.outputItemID = outputItemID
        self.outputAmount = outputAmount
        self.durationMinutes = durationMinutes
    }
}

public enum FacilityFailure: String, Error, Equatable, Sendable {
    case invalidFacility
    case facilityBusy
    case outputWaiting
    case missingInput
    case missingFuel
    case noOutput
    case missingItems
}

public enum StorageTransferDirection: Sendable {
    case deposit
    case withdraw
}

public struct FacilityMutation: Equatable, Sendable {
    public let save: GameSave
    public let failure: FacilityFailure?

    public init(save: GameSave, failure: FacilityFailure? = nil) {
        self.save = save
        self.failure = failure
    }
}

public enum FacilityRules {
    public static let recipes = [
        FurnaceRecipe(id: "smelt-copper", inputItemID: "copper-ore", inputAmount: 3, fuelItemID: "charcoal", fuelAmount: 2, outputItemID: "copper-ingot", outputAmount: 1, durationMinutes: 30),
        FurnaceRecipe(id: "smelt-iron", inputItemID: "iron-ore", inputAmount: 3, fuelItemID: "coal", fuelAmount: 2, outputItemID: "iron-ingot", outputAmount: 1, durationMinutes: 45),
    ]

    public static func startFurnace(_ source: GameSave, entityID: String, recipe: FurnaceRecipe) -> FacilityMutation {
        guard source.entities.contains(where: { $0.id == entityID && $0.type == "furnace" }) else {
            return .init(save: source, failure: .invalidFacility)
        }
        let current = source.facilityProcesses[entityID] ?? FacilityProcess()
        guard current.status != .working else { return .init(save: source, failure: .facilityBusy) }
        guard current.output.values.allSatisfy({ $0 <= 0 }) else { return .init(save: source, failure: .outputWaiting) }
        guard source.inventory[recipe.inputItemID, default: 0] >= recipe.inputAmount else {
            return .init(save: source, failure: .missingInput)
        }
        let combinedFuelNeed = recipe.fuelAmount + (recipe.inputItemID == recipe.fuelItemID ? recipe.inputAmount : 0)
        guard source.inventory[recipe.fuelItemID, default: 0] >= combinedFuelNeed else {
            return .init(save: source, failure: .missingFuel)
        }

        var next = source
        consume(recipe.inputItemID, amount: recipe.inputAmount, from: &next.inventory)
        consume(recipe.fuelItemID, amount: recipe.fuelAmount, from: &next.inventory)
        next.facilityProcesses[entityID] = FacilityProcess(
            recipeID: recipe.id,
            input: [recipe.inputItemID: recipe.inputAmount],
            fuel: [recipe.fuelItemID: recipe.fuelAmount],
            durationMinutes: max(1, recipe.durationMinutes),
            outputItemID: recipe.outputItemID,
            outputAmount: recipe.outputAmount,
            status: .working
        )
        return .init(save: next)
    }

    public static func advance(_ source: GameSave, elapsedGameMinutes: Double) -> GameSave {
        guard elapsedGameMinutes > 0 else { return source }
        var next = source
        for (entityID, process) in source.facilityProcesses where process.status == .working {
            var updated = process
            updated.progressMinutes = min(updated.durationMinutes, updated.progressMinutes + elapsedGameMinutes)
            if updated.progressMinutes >= updated.durationMinutes {
                updated.input = [:]
                updated.fuel = [:]
                if let outputItemID = updated.outputItemID, updated.outputAmount > 0 {
                    updated.output = [outputItemID: updated.outputAmount]
                }
                updated.status = .ready
            }
            next.facilityProcesses[entityID] = updated
        }
        return next
    }

    public static func claimFurnace(_ source: GameSave, entityID: String) -> FacilityMutation {
        guard let process = source.facilityProcesses[entityID], process.status == .ready, !process.output.isEmpty else {
            return .init(save: source, failure: .noOutput)
        }
        var next = source
        for (itemID, amount) in process.output where amount > 0 {
            next.inventory[itemID, default: 0] += amount
        }
        next.facilityProcesses[entityID] = FacilityProcess()
        return .init(save: next)
    }

    public static func transferStorage(
        _ source: GameSave,
        entityID: String,
        itemID: String,
        amount: Int,
        direction: StorageTransferDirection
    ) -> FacilityMutation {
        guard amount > 0, source.entities.contains(where: { $0.id == entityID && $0.type == "storage-crate" }) else {
            return .init(save: source, failure: .invalidFacility)
        }
        var next = source
        var container = next.containerInventories[entityID] ?? [:]
        switch direction {
        case .deposit:
            guard next.inventory[itemID, default: 0] >= amount else { return .init(save: source, failure: .missingItems) }
            consume(itemID, amount: amount, from: &next.inventory)
            container[itemID, default: 0] += amount
        case .withdraw:
            guard container[itemID, default: 0] >= amount else { return .init(save: source, failure: .missingItems) }
            consume(itemID, amount: amount, from: &container)
            next.inventory[itemID, default: 0] += amount
        }
        next.containerInventories[entityID] = container
        return .init(save: next)
    }

    private static func consume(_ itemID: String, amount: Int, from inventory: inout [String: Int]) {
        let remaining = inventory[itemID, default: 0] - amount
        if remaining > 0 { inventory[itemID] = remaining }
        else { inventory.removeValue(forKey: itemID) }
    }
}
