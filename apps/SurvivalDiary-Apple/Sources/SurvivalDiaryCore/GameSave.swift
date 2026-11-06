import Foundation

public enum PlayMode: String, Codable, CaseIterable, Sendable {
    case guided
    case free
}

public struct WorldPoint: Codable, Equatable, Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct GameClock: Codable, Equatable, Sendable {
    public var day: Int
    public var minute: Int

    public init(day: Int = 1, minute: Int = 480) {
        self.day = day
        self.minute = minute
    }
}

public struct PlayerState: Codable, Equatable, Sendable {
    public var position: WorldPoint
    public var health: Int
    public var energy: Double
    public var water: Int
    public var food: Int

    public init(
        position: WorldPoint = .init(x: 278.5, y: 157),
        health: Int = 100,
        energy: Double = 86,
        water: Int = 72,
        food: Int = 64
    ) {
        self.position = position
        self.health = health
        self.energy = energy
        self.water = water
        self.food = food
    }

    enum CodingKeys: String, CodingKey { case position, health, energy, water, food }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        position = try values.decodeIfPresent(WorldPoint.self, forKey: .position) ?? .init(x: 278.5, y: 157)
        health = try values.decodeIfPresent(Int.self, forKey: .health) ?? 100
        energy = try values.decodeIfPresent(Double.self, forKey: .energy) ?? 86
        water = try values.decodeIfPresent(Int.self, forKey: .water) ?? 72
        food = try values.decodeIfPresent(Int.self, forKey: .food) ?? 64
    }
}

public struct GameSave: Codable, Equatable, Sendable {
    public static let schemaVersion = 5

    public var schemaVersion: Int
    public var seed: String
    public var playMode: PlayMode
    public var clock: GameClock
    public var player: PlayerState
    public var inventory: [String: Int]
    public var entities: [PlacedEntity]
    public var containerInventories: [String: [String: Int]]
    public var facilityProcesses: [String: FacilityProcess]
    public var diary: [DiaryEntry]
    public var weather: WeatherState
    public var recoveryBlockers: [String]
    public var discoveries: Set<String>
    public var recruitedVillagers: Set<String>
    public var groundItems: [GroundItem]
    public var plots: [String: CropPlot]

    public init(
        seed: String,
        playMode: PlayMode = .guided,
        clock: GameClock = .init(),
        player: PlayerState = .init(),
        inventory: [String: Int] = [:],
        entities: [PlacedEntity] = [],
        containerInventories: [String: [String: Int]] = [:],
        facilityProcesses: [String: FacilityProcess] = [:],
        diary: [DiaryEntry] = [],
        weather: WeatherState = .init(),
        recoveryBlockers: [String] = [],
        discoveries: Set<String> = [],
        recruitedVillagers: Set<String> = [],
        groundItems: [GroundItem] = [],
        plots: [String: CropPlot] = [:]
    ) {
        self.schemaVersion = Self.schemaVersion
        self.seed = seed
        self.playMode = playMode
        self.clock = clock
        self.player = player
        self.inventory = inventory
        self.entities = entities
        self.containerInventories = containerInventories
        self.facilityProcesses = facilityProcesses
        self.diary = diary
        self.weather = weather
        self.recoveryBlockers = recoveryBlockers
        self.discoveries = discoveries
        self.recruitedVillagers = recruitedVillagers
        self.groundItems = groundItems
        self.plots = plots
    }

    enum CodingKeys: String, CodingKey { case schemaVersion, seed, playMode, clock, player, inventory, entities, containerInventories, facilityProcesses, diary, weather, recoveryBlockers, discoveries, recruitedVillagers, groundItems, plots }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = Self.schemaVersion
        seed = try values.decodeIfPresent(String.self, forKey: .seed) ?? "imported"
        playMode = try values.decodeIfPresent(PlayMode.self, forKey: .playMode) ?? .guided
        clock = try values.decodeIfPresent(GameClock.self, forKey: .clock) ?? .init()
        player = try values.decodeIfPresent(PlayerState.self, forKey: .player) ?? .init()
        inventory = try values.decodeIfPresent([String: Int].self, forKey: .inventory) ?? [:]
        entities = try values.decodeIfPresent([PlacedEntity].self, forKey: .entities) ?? []
        containerInventories = try values.decodeIfPresent([String: [String: Int]].self, forKey: .containerInventories) ?? [:]
        facilityProcesses = try values.decodeIfPresent([String: FacilityProcess].self, forKey: .facilityProcesses) ?? [:]
        diary = try values.decodeIfPresent([DiaryEntry].self, forKey: .diary) ?? []
        weather = try values.decodeIfPresent(WeatherState.self, forKey: .weather) ?? .init()
        recoveryBlockers = try values.decodeIfPresent([String].self, forKey: .recoveryBlockers) ?? []
        discoveries = try values.decodeIfPresent(Set<String>.self, forKey: .discoveries) ?? Set(inventory.keys)
        recruitedVillagers = try values.decodeIfPresent(Set<String>.self, forKey: .recruitedVillagers) ?? []
        groundItems = try values.decodeIfPresent([GroundItem].self, forKey: .groundItems) ?? []
        plots = try values.decodeIfPresent([String: CropPlot].self, forKey: .plots) ?? [:]
    }
}

public struct GroundItem: Codable, Equatable, Sendable, Identifiable {
    public var id: String; public var itemID: String; public var amount: Int; public var position: WorldPoint
    public init(id: String, itemID: String, amount: Int, position: WorldPoint) { self.id = id; self.itemID = itemID; self.amount = amount; self.position = position }
}

public struct CropSlot: Codable, Equatable, Sendable {
    public var cropID: String; public var seedID: String; public var progress: Double; public var duration: Double; public var stage: String
    public init(cropID: String, seedID: String, progress: Double, duration: Double, stage: String) {
        self.cropID = cropID; self.seedID = seedID; self.progress = progress; self.duration = duration; self.stage = stage
    }
}
public struct CropPlot: Codable, Equatable, Sendable {
    public var water: Int = 0; public var waterUsageMinutes: Double = 0
    public var slots: [CropSlot?] = Array(repeating: nil, count: 9)
    public init() {}
}

public enum FacilityStatus: String, Codable, Equatable, Sendable {
    case idle
    case working
    case ready
}

public struct FacilityProcess: Codable, Equatable, Sendable {
    public var recipeID: String?
    public var input: [String: Int]
    public var fuel: [String: Int]
    public var output: [String: Int]
    public var progressMinutes: Double
    public var durationMinutes: Double
    public var outputItemID: String?
    public var outputAmount: Int
    public var status: FacilityStatus

    public init(
        recipeID: String? = nil,
        input: [String: Int] = [:],
        fuel: [String: Int] = [:],
        output: [String: Int] = [:],
        progressMinutes: Double = 0,
        durationMinutes: Double = 0,
        outputItemID: String? = nil,
        outputAmount: Int = 0,
        status: FacilityStatus = .idle
    ) {
        self.recipeID = recipeID
        self.input = input
        self.fuel = fuel
        self.output = output
        self.progressMinutes = progressMinutes
        self.durationMinutes = durationMinutes
        self.outputItemID = outputItemID
        self.outputAmount = outputAmount
        self.status = status
    }
}

public struct PlacedEntity: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var type: String
    public var position: WorldPoint
    public var rotation: Int
    public var level: Int
    public var durability: Int
    public var maxDurability: Int

    public init(id: String, type: String, position: WorldPoint, rotation: Int = 0, level: Int = 1, durability: Int = 100, maxDurability: Int = 100) {
        self.id = id; self.type = type; self.position = position; self.rotation = rotation
        self.level = level; self.durability = durability; self.maxDurability = maxDurability
    }
}

public struct DiaryEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var day: Int
    public var title: String
    public var text: String
    public var facts: [String]

    public init(id: String, day: Int, title: String = "", text: String = "", facts: [String] = []) {
        self.id = id; self.day = day; self.title = title; self.text = text; self.facts = facts
    }
}

public struct WeatherState: Codable, Equatable, Sendable {
    public var kind: String
    public var intensity: Double
    public init(kind: String = "clear", intensity: Double = 0) { self.kind = kind; self.intensity = intensity }
}
