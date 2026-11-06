import Foundation

public struct IslandResident: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let role: String
    public let home: WorldPoint
    public let giveItem: String?
    public let giveAmount: Int
    public let receiveItem: String?
    public let receiveAmount: Int
}

public enum VillageRules {
    public static let name = "潮生村"
    public static let center = WorldPoint(x: 410, y: 250)
    public static let residents: [IslandResident] = [
        .init(id: "castaway-builder", name: "阿拓", role: "建造者", home: .init(x: 368, y: 248), giveItem: nil, giveAmount: 0, receiveItem: nil, receiveAmount: 0),
        .init(id: "castaway-trader", name: "岚商", role: "行商", home: .init(x: 424, y: 224), giveItem: "coconut", giveAmount: 2, receiveItem: "rope", receiveAmount: 1),
        .init(id: "castaway-farmer", name: "禾姨", role: "农人", home: .init(x: 454, y: 278), giveItem: "berry", giveAmount: 3, receiveItem: "taro-seed", receiveAmount: 1),
    ]

    public static func position(of resident: IslandResident, minute: Int) -> WorldPoint {
        let index = residents.firstIndex(of: resident) ?? 0
        let phase = Double(minute) / 45 + Double(index) * 2.1
        return .init(x: resident.home.x + cos(phase) * 26, y: resident.home.y + sin(phase * 0.83) * 14)
    }

    public static func trade(_ save: GameSave, residentID: String) -> GameSave? {
        guard let resident = residents.first(where: { $0.id == residentID }),
              let give = resident.giveItem, let receive = resident.receiveItem,
              save.inventory[give, default: 0] >= resident.giveAmount else { return nil }
        var next = save
        next.inventory[give, default: 0] -= resident.giveAmount
        if next.inventory[give] == 0 { next.inventory.removeValue(forKey: give) }
        next.inventory[receive, default: 0] += resident.receiveAmount
        return next
    }
}
