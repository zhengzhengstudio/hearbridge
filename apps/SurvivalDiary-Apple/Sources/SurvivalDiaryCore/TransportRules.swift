import Foundation

public enum TransportRules {
    public static let interactiveTypes: Set<String> = ["rowboat", "minecart", "rail-segment"]
    private static let aboardPrefix = "transport:aboard:"
    private static let railStep = 52.0

    public static func ensureStarter(_ source: GameSave) -> GameSave {
        var next = source
        if !next.discoveries.contains("nativeTransportBootstrapVersion:1") {
            let transport = [
                PlacedEntity(id: "starter-rail-1", type: "rail-segment", position: .init(x: 330.5, y: 157)),
                PlacedEntity(id: "starter-rail-2", type: "rail-segment", position: .init(x: 382.5, y: 157)),
                PlacedEntity(id: "starter-minecart", type: "minecart", position: .init(x: 330.5, y: 157)),
                PlacedEntity(id: "starter-rowboat", type: "rowboat", position: .init(x: 236.5, y: 220)),
            ]
            for entity in transport where !next.entities.contains(where: { $0.id == entity.id }) { next.entities.append(entity) }
            next.discoveries.insert("nativeTransportBootstrapVersion:1")
        }
        if !next.discoveries.contains("nativeRailStarterVersion:1") {
            next.discoveries.insert("nativeRailStarterVersion:1")
        }
        if !next.discoveries.contains("nativeAnimalBootstrapVersion:1") {
            let animals = [
                PlacedEntity(id: "starter-animal-crab", type: "animal-land-crab", position: .init(x: 245, y: 112)),
                PlacedEntity(id: "starter-animal-turtle", type: "animal-sea-turtle", position: .init(x: 188, y: 238)),
                PlacedEntity(id: "starter-animal-boar", type: "animal-wild-boar", position: .init(x: 438, y: 252)),
            ]
            for entity in animals where !next.entities.contains(where: { $0.id == entity.id }) { next.entities.append(entity) }
            next.discoveries.insert("nativeAnimalBootstrapVersion:1")
        }
        return next
    }

    public static func aboardBoatID(_ save: GameSave) -> String? {
        save.discoveries.first(where: { $0.hasPrefix(aboardPrefix) }).map { String($0.dropFirst(aboardPrefix.count)) }
    }

    public static func toggleBoat(_ source: GameSave, boatID: String) -> GameSave? {
        guard let boat = source.entities.first(where: { $0.id == boatID && $0.type == "rowboat" }) else { return nil }
        var next = source
        next.discoveries = Set(next.discoveries.filter { !$0.hasPrefix(aboardPrefix) })
        if aboardBoatID(source) == boatID {
            next.player.position = .init(x: boat.position.x + railStep, y: boat.position.y)
        } else {
            next.player.position = boat.position
            next.discoveries.insert("\(aboardPrefix)\(boatID)")
        }
        next.discoveries.insert("used:rowboat")
        return next
    }

    public static func pushMinecart(_ source: GameSave, minecartID: String) -> GameSave? {
        guard let index = source.entities.firstIndex(where: { $0.id == minecartID && $0.type == "minecart" }) else { return nil }
        let cart = source.entities[index]
        let rails = source.entities.filter { $0.type == "rail-segment" }
        guard rails.contains(where: { sameCell($0.position, cart.position) }) else { return nil }
        let candidates = [
            WorldPoint(x: cart.position.x + railStep, y: cart.position.y),
            WorldPoint(x: cart.position.x, y: cart.position.y + railStep),
            WorldPoint(x: cart.position.x - railStep, y: cart.position.y),
            WorldPoint(x: cart.position.x, y: cart.position.y - railStep),
        ]
        guard let destination = candidates.first(where: { point in
            rails.contains(where: { sameCell($0.position, point) }) &&
                !source.entities.contains(where: { $0.type == "minecart" && $0.id != minecartID && sameCell($0.position, point) })
        }) else { return nil }
        var next = source
        next.entities[index].position = destination
        next.discoveries.insert("used:minecart")
        return next
    }

    public static func nextRailPlacement(in source: GameSave) -> WorldPoint? {
        let origin = source.player.position
        let candidates = [
            WorldPoint(x: origin.x + railStep, y: origin.y),
            WorldPoint(x: origin.x, y: origin.y + railStep),
            WorldPoint(x: origin.x - railStep, y: origin.y),
            WorldPoint(x: origin.x, y: origin.y - railStep),
        ]
        let rails = source.entities.filter { $0.type == "rail-segment" }
        return candidates.first { point in
            !source.entities.contains(where: { $0.type != "minecart" && sameCell($0.position, point) }) &&
                (rails.isEmpty || rails.contains(where: { cardinalNeighbor($0.position, point) }))
        }
    }

    private static func sameCell(_ lhs: WorldPoint, _ rhs: WorldPoint) -> Bool {
        abs(lhs.x - rhs.x) < 1 && abs(lhs.y - rhs.y) < 1
    }

    private static func cardinalNeighbor(_ lhs: WorldPoint, _ rhs: WorldPoint) -> Bool {
        let dx = abs(lhs.x - rhs.x), dy = abs(lhs.y - rhs.y)
        return (abs(dx - railStep) < 1 && dy < 1) || (abs(dy - railStep) < 1 && dx < 1)
    }
}
