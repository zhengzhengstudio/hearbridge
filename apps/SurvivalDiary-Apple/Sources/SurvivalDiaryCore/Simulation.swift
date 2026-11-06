import CryptoKit
import CoreFoundation
import Foundation

public enum WorldCommand: Equatable, Sendable {
    case discoverRegion(x: Int, y: Int)
    case advanceTime(Int)
    case setPlayMode(PlayMode)
    case gather(itemID: String, amount: Int)
    case craft(recipeID: String)
    case place(entityID: String, itemID: String, x: Int, y: Int)
    case repair(entityID: String, amount: Int)
    case dismantle(entityID: String)
    case writeDiary(entryID: String, text: String)
}

public enum SimulationError: Error, Equatable { case invalidCommand, missingMaterials, duplicateEntity, missingEntity }

public struct CanonicalRegion: Codable, Equatable, Sendable {
    public var id: String; public var x: Int; public var y: Int; public var biomeId: String
    public var elevation: Double; public var moisture: Double; public var temperature: Double; public var resources: [String]
}
public struct CanonicalWeather: Codable, Equatable, Sendable { public var kind: String; public var intensity: Double; public var wetness: Double; public var wind: Double }
public struct CanonicalEntity: Codable, Equatable, Sendable {
    public var id: String; public var type: String; public var coordinates: Coordinates; public var durability: Int; public var maxDurability: Int
}
public struct Coordinates: Codable, Equatable, Sendable { public var x: Int; public var y: Int }
public struct CanonicalJournal: Codable, Equatable, Sendable { public var text: String }

public struct CanonicalWorld: Codable, Equatable, Sendable {
    public var schemaVersion = 2
    public var productVersion = "0.5.0"
    public var build = 15
    public var seed: String
    public var playMode: PlayMode
    public var day = 1
    public var time = 360
    public var weather = CanonicalWeather(kind: "clear", intensity: 0, wetness: 0, wind: 0.15)
    public var regions: [String: CanonicalRegion] = [:]
    public var entities: [String: CanonicalEntity] = [:]
    public var players: [String: String] = [:]
    public var journals: [String: CanonicalJournal] = [:]
    public var milestones: [String: Bool] = [:]
    public var inventory: [String: Int]?
}

public enum Simulation {
    private static let starterResources = ["stone", "branch", "palm-fiber", "fresh-water", "coconut"]
    private struct Biome { let id: String; let resources: [String] }
    private struct WeatherKind { let id: String; let minimum: Double; let maximum: Double; let wetness: Double; let wind: Double }
    private static let biomes = [
        Biome(id: "lagoon", resources: ["shell", "reef-fish", "fresh-water"]),
        Biome(id: "palm-grove", resources: ["driftwood", "palm-fiber", "fresh-water"]),
        Biome(id: "basalt-ridge", resources: ["stone", "palm-fiber"]),
        Biome(id: "mangrove", resources: ["driftwood", "palm-fiber", "reef-fish"]),
        Biome(id: "ruins", resources: ["stone", "shell"]),
    ]
    private static let weatherKinds = [
        WeatherKind(id: "clear", minimum: 0, maximum: 1, wetness: 0, wind: 0.15),
        WeatherKind(id: "cloudy", minimum: 0, maximum: 1, wetness: 0.05, wind: 0.25),
        WeatherKind(id: "fog", minimum: 0.2, maximum: 0.8, wetness: 0.2, wind: 0.08),
        WeatherKind(id: "rain", minimum: 0.25, maximum: 1, wetness: 0.8, wind: 0.45),
        WeatherKind(id: "storm", minimum: 0.3, maximum: 1, wetness: 1, wind: 0.9),
        WeatherKind(id: "snow", minimum: 0, maximum: 0.35, wetness: 0.5, wind: 0.3),
        WeatherKind(id: "blizzard", minimum: 0, maximum: 0.2, wetness: 0.85, wind: 1),
    ]

    public static func create(seed: String, playMode: PlayMode = .guided) -> CanonicalWorld { CanonicalWorld(seed: seed, playMode: playMode) }

    public static func step(_ source: CanonicalWorld, command: WorldCommand) throws -> CanonicalWorld {
        var world = source
        switch command {
        case let .discoverRegion(x, y):
            let region = region(seed: world.seed, x: x, y: y); world.regions[region.id] = region
            world.weather = weather(seed: world.seed, day: world.day, time: world.time, climate: region)
        case let .advanceTime(minutes):
            guard minutes > 0 else { throw SimulationError.invalidCommand }
            let elapsed = world.time + minutes; world.day += elapsed / 1440; world.time = elapsed % 1440
            let climate = region(seed: world.seed, x: 0, y: 0)
            world.weather = weather(seed: world.seed, day: world.day, time: world.time, climate: climate)
        case let .setPlayMode(mode): world.playMode = mode
        case let .gather(itemID, amount):
            guard amount > 0, !itemID.isEmpty else { throw SimulationError.invalidCommand }
            world.inventory = world.inventory ?? [:]; world.inventory![itemID, default: 0] += amount
        case let .craft(recipeID): try craft(recipeID, world: &world)
        case let .place(entityID, itemID, x, y):
            guard world.entities[entityID] == nil else { throw SimulationError.duplicateEntity }
            guard (world.inventory?[itemID] ?? 0) > 0 else { throw SimulationError.missingMaterials }
            world.inventory![itemID, default: 0] -= 1; if world.inventory![itemID] == 0 { world.inventory!.removeValue(forKey: itemID) }
            world.entities[entityID] = CanonicalEntity(id: entityID, type: itemID, coordinates: .init(x: x, y: y), durability: 10, maxDurability: 10)
        case let .repair(entityID, amount):
            guard var entity = world.entities[entityID] else { throw SimulationError.missingEntity }
            guard amount > 0 else { throw SimulationError.invalidCommand }
            entity.durability = min(entity.maxDurability, entity.durability + amount); world.entities[entityID] = entity
        case let .dismantle(entityID):
            guard let entity = world.entities.removeValue(forKey: entityID) else { throw SimulationError.missingEntity }
            world.inventory = world.inventory ?? [:]; world.inventory![entity.type, default: 0] += 1
        case let .writeDiary(entryID, text): world.journals[entryID] = .init(text: text)
        }
        return world
    }

    public static func stableDigest(_ world: CanonicalWorld) throws -> String {
        SHA256.hash(data: try stableData(world)).map { String(format: "%02x", $0) }.joined()
    }

    public static func stableJSON(_ world: CanonicalWorld) throws -> String {
        String(decoding: try stableData(world), as: UTF8.self)
    }

    private static func stableData(_ world: CanonicalWorld) throws -> Data {
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(world))
        return Data(try stableJSONString(object).utf8)
    }

    private static func stableJSONString(_ value: Any) throws -> String {
        if let dictionary = value as? [String: Any] {
            return try dictionary.keys.sorted().map {
                "\(try stableJSONString($0)):\(try stableJSONString(dictionary[$0]!))"
            }.joined(separator: ",").wrapped(in: "{", "}")
        }
        if let array = value as? [Any] {
            return try array.map(stableJSONString).joined(separator: ",").wrapped(in: "[", "]")
        }
        if let string = value as? String {
            let data = try JSONSerialization.data(withJSONObject: [string], options: [.withoutEscapingSlashes])
            return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
            let double = number.doubleValue
            if double.rounded() == double { return String(Int64(double)) }
            var text = String(format: "%.4f", locale: Locale(identifier: "en_US_POSIX"), double)
            while text.last == "0" { text.removeLast() }
            if text.last == "." { text.removeLast() }
            return text
        }
        if value is NSNull { return "null" }
        throw SimulationError.invalidCommand
    }

    private static func craft(_ id: String, world: inout CanonicalWorld) throws {
        let recipe: ([String: Int], String, Int)
        switch id {
        case "craft-rope": recipe = (["palm-fiber": 4], "rope", 1)
        case "craft-stone-axe": recipe = (["driftwood": 2, "stone": 2, "palm-fiber": 1], "stone-axe", 1)
        case "craft-stone-pickaxe": recipe = (["branch": 2, "stone": 3, "rope": 1], "stone-pickaxe", 1)
        case "craft-fishing-rod": recipe = (["driftwood": 2, "palm-fiber": 3], "fishing-rod", 1)
        case "build-campfire": recipe = (["driftwood": 3, "stone": 4], "campfire", 1)
        case "build-road-segment": recipe = (["branch": 1, "stone": 1], "road-segment", 4)
        default: throw SimulationError.invalidCommand
        }
        for (item, amount) in recipe.0 where (world.inventory?[item] ?? 0) < amount { throw SimulationError.missingMaterials }
        for (item, amount) in recipe.0 { world.inventory![item, default: 0] -= amount; if world.inventory![item] == 0 { world.inventory!.removeValue(forKey: item) } }
        world.inventory![recipe.1, default: 0] += recipe.2
    }

    private static func region(seed: String, x: Int, y: Int) -> CanonicalRegion {
        let elevation = round4(hashNumber(seed, x, y, "elevation")); let moisture = round4(hashNumber(seed, x, y, "moisture")); let temperature = round4(hashNumber(seed, x, y, "temperature"))
        let biome = biomes[min(biomes.count - 1, Int(hashNumber(seed, x, y, "biome") * Double(biomes.count)))]
        var resources = biome.resources.enumerated().compactMap { index, item in hashNumber(seed, x, y, item) > 0.32 || index == 0 ? item : nil }
        if x == 0 && y == 0 { resources = Array(Set(resources + starterResources)).sorted() }
        return CanonicalRegion(id: "\(x),\(y)", x: x, y: y, biomeId: biome.id, elevation: elevation, moisture: moisture, temperature: temperature, resources: resources)
    }

    private static func weather(seed: String, day: Int, time: Int, climate: CanonicalRegion) -> CanonicalWeather {
        let candidates = weatherKinds.filter { climate.temperature >= $0.minimum && climate.temperature <= $0.maximum }
        let kinds = candidates.isEmpty ? weatherKinds.filter { $0.id == "clear" } : candidates
        let bucket = time / 120
        let index = min(kinds.count - 1, Int(hashNumber(seed, day, bucket, climate.elevation, climate.moisture, climate.temperature, "weather-kind") * Double(kinds.count)))
        let kind = kinds[index]
        let intensity = round4(hashNumber(seed, day, bucket, climate.elevation, climate.moisture, climate.temperature, "intensity"))
        return .init(kind: kind.id, intensity: intensity, wetness: round4(kind.wetness * intensity), wind: round4(kind.wind * (0.5 + intensity / 2)))
    }

    private static func hashNumber(_ parts: Any...) -> Double {
        let data = parts.map { String(describing: $0) }.joined(separator: ":").data(using: .utf8)!
        let digest = SHA256.hash(data: data)
        let value = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        return Double(value) / Double(UInt32.max)
    }
    private static func round4(_ value: Double) -> Double { (value * 10_000).rounded() / 10_000 }
}

private extension String {
    func wrapped(in prefix: Character, _ suffix: Character) -> String { String(prefix) + self + String(suffix) }
}
