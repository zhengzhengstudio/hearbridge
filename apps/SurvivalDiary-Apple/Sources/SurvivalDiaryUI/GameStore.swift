import Combine
import Foundation
import SurvivalDiaryCore
import SurvivalDiaryOnline
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

public enum CampSection: String, Identifiable {
    case inventory
    case crafting
    case handbook
    case compendium
    case villager
    case storage
    case furnace
    case farm
    case transport
    public var id: String { rawValue }
}

public struct AppleUnlockNotice: Equatable, Sendable {
    public let title: String
    public let recipeLine: String
}

@MainActor
public final class GameStore: ObservableObject {
    @Published public private(set) var save: GameSave
    @Published public var isDiaryPresented = false
    @Published public var isSettingsPresented = false
    @Published public var isMultiplayerPresented = false
    @Published public var activeCampSection: CampSection?
    @Published public var activeFacilityID: String?
    @Published public var placementType: String?
    @Published public var selectedHotbarItem: String?
    @Published public var guideText: String?
    @Published public private(set) var notice: String?
    @Published public private(set) var unlockNotice: AppleUnlockNotice?
    @Published public private(set) var updateMessage = "检查更新"
    @Published public private(set) var isCheckingUpdate = false
    @Published public private(set) var hasPendingUpdate = false
    @Published public private(set) var hasExistingSave = false
    @Published public private(set) var villagerReply = "阿拓：先把住处和储物箱安顿好，岛才会真正像个家。"
    @Published public private(set) var villagerReplySource = "岛民本地回应"
    @Published public private(set) var villagerTalking = false
    private var pendingUpdate: UpdateDecision = .current
    private let updateService = UpdateService()
    private let survivalAPI = SurvivalAPI(baseURL: URL(string: "https://survival-diary.zhengzhengstudio.cn")!)
    private var npcSessionReady = false
    private let manifestURL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!
    private let saveRepository: SaveRepository
    private let saveSlot = "main"
    private var clockTask: Task<Void, Never>?
    private var clockTicks = 0
    private var clockActive = false

    public func talkToVillager(villagerID: String, question: String) async {
        let trimmed = String(question.trimmingCharacters(in: .whitespacesAndNewlines).prefix(240))
        guard !trimmed.isEmpty, !villagerTalking else { return }
        villagerReply = localVillagerReply(trimmed)
        villagerReplySource = "岛民先答 · Kimi 快速回话中"
        villagerTalking = true
        defer { villagerTalking = false }
        do {
            if !npcSessionReady {
                let defaults = UserDefaults.standard; let key = "survival-diary-device-id"
                let device = defaults.string(forKey: key) ?? "apple-\(UUID().uuidString)"; defaults.set(device, forKey: key)
                _ = try await survivalAPI.createGuestSession(deviceID: device); npcSessionReady = true
            }
            let names = ["castaway-builder": "阿拓", "castaway-trader": "岚商", "castaway-farmer": "禾姨"]
            let roles = ["castaway-builder": "营地建造者", "castaway-trader": "行商", "castaway-farmer": "农人"]
            let reply = try await survivalAPI.talkToVillager([
                "villagerId": villagerID, "villagerName": names[villagerID] ?? "阿拓", "role": roles[villagerID] ?? "幸存者",
                "relationship": save.recruitedVillagers.contains(villagerID) ? "joined" : "not-recruited", "question": trimmed,
                "biome": "island-camp", "inventory": save.inventory.filter { $0.value > 0 }.prefix(16).map { "\(itemName($0.key))×\($0.value)" },
            ])
            if !reply.reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { villagerReply = reply.reply }
            villagerReplySource = reply.source == "kimi" ? "Kimi 在线回应" : "Kimi 不可用 · 岛民本地回应"
        } catch { villagerReplySource = "Kimi 超时或离线 · 已保留岛民回答" }
    }

    private func localVillagerReply(_ question: String) -> String {
        if question.contains("轨") || question.contains("路") { return "阿拓：轨段只能接在已有轨道的上下左右；道路先从营地出口往外铺。" }
        if question.contains("矿") || question.contains("铁") { return "阿拓：先找岩台和裸露矿脉，带石镐；铁矿不能当海蚀石使用。" }
        if question.contains("种") || question.contains("田") { return "禾姨：播种后要浇水，田里有水才会随岛屿时间生长。" }
        if question.contains("买") || question.contains("卖") || question.contains("交易") { return "岚商：实际货品和价格都要经过背包规则结算。" }
        return "阿拓：看情境按钮，它会按设施、村民、地面物、采集的顺序告诉你现在能做什么。"
    }

    public init(save: GameSave = .init(seed: "20260729", inventory: ["taro-seed": 1], discoveries: ["nativeFarmBootstrapVersion:1"])) {
        self.save = TransportRules.ensureStarter(save)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("cn.zhengzhengstudio.survivaldiary", isDirectory: true)
        saveRepository = SaveRepository(directory: support)
        deriveGuide()
        Task {
            await restoreSavedWorld()
            startClock()
        }
    }

    public func restoreSavedWorld() async {
        if let restored = try? await saveRepository.load(slot: saveSlot) {
            hasExistingSave = true
            save = TransportRules.ensureStarter(restored)
            if !save.discoveries.contains("nativeFarmBootstrapVersion:1") {
                save.inventory["taro-seed", default: 0] += 1
                save.discoveries.insert("nativeFarmBootstrapVersion:1")
                persistWorld()
            }
            deriveGuide()
        }
    }

    public func persistWorld() {
        let snapshot = save
        Task { try? await saveRepository.save(slot: saveSlot, state: snapshot) }
    }

    public func advanceClock(elapsedRealSeconds: TimeInterval = 1.25) {
        let advanced = SurvivalRules.advance(save, elapsedRealSeconds: elapsedRealSeconds, activity: .idle)
        save = advanceFarms(FacilityRules.advance(advanced, elapsedGameMinutes: elapsedRealSeconds * 0.8), minutes: elapsedRealSeconds * 0.8)
        clockTicks += 1
        if clockTicks >= 12 { clockTicks = 0; persistWorld() }
    }

    private func startClock() {
        guard clockTask == nil else { return }
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_250_000_000)
                guard let self else { return }
                if self.clockActive { self.advanceClock() }
            }
        }
    }

    public func setClockActive(_ active: Bool) {
        clockActive = active
        if !active { persistWorld() }
    }

    public func restartWorld() async {
        try? await saveRepository.reset(slot: saveSlot)
        save = TransportRules.ensureStarter(GameSave(seed: "local-\(Int(Date().timeIntervalSince1970))", inventory: ["taro-seed": 1], discoveries: ["nativeFarmBootstrapVersion:1"]))
        hasExistingSave = true
        placementType = nil
        deriveGuide()
        try? await saveRepository.save(slot: saveSlot, state: save)
    }

    public func dropItem(_ itemID: String) {
        guard save.inventory[itemID, default: 0] > 0 else { return }
        consume(itemID, amount: 1)
        save.groundItems.append(.init(id: "ground-\(UUID().uuidString)", itemID: itemID, amount: 1,
                                      position: .init(x: save.player.position.x + 18, y: save.player.position.y + 10)))
        notice = "已将 \(itemName(itemID)) 丢到地面"
        persistWorld()
    }

    public func pickupGroundItem(_ id: String) {
        guard let index = save.groundItems.firstIndex(where: { $0.id == id }) else { return }
        let item = save.groundItems.remove(at: index)
        save.inventory[item.itemID, default: 0] += item.amount
        notice = "已拾取 \(itemName(item.itemID)) ×\(item.amount)"
        persistWorld()
    }

    public func eat(_ itemID: String) {
        guard save.inventory[itemID, default: 0] > 0 else { return }
        let effects: [String: (Int, Int, Double, Int)] = [
            "coconut": (10, 12, 4, 0), "berry": (6, 4, 3, 0),
            "taro": (12, 0, 4, 1), "millet": (8, 0, 3, 1),
        ]
        guard let effect = effects[itemID] else { notice = "这个物品不能直接食用"; return }
        consume(itemID, amount: 1)
        save.player.food = min(100, save.player.food + effect.0)
        save.player.water = min(100, save.player.water + effect.1)
        save.player.energy = min(100, save.player.energy + effect.2)
        save.player.health = min(100, save.player.health + effect.3)
        save.discoveries.insert("consumed:any")
        save.discoveries.insert("consumed:\(itemID)")
        notice = "已食用 \(itemName(itemID))"
        deriveGuide()
        persistWorld()
    }

    public func movePlayer(screenDelta: CGSize) {
        let length = max(1, hypot(screenDelta.width, screenDelta.height))
        let distance = min(78, max(20, length * 0.36))
        save.player.position.x += screenDelta.width / length * distance
        save.player.position.y -= screenDelta.height / length * distance
        save.discoveries.insert("tutorial:moved")
        notice = "脚下的潮线指向内陆"
        deriveGuide()
        persistWorld()
    }

    public func plant(seedID: String, plotID: String, slot: Int) {
        guard (0..<9).contains(slot), save.inventory[seedID, default: 0] > 0 else { return }
        var plot = save.plots[plotID] ?? CropPlot(); guard plot.slots[slot] == nil else { return }
        let crop: (String, Double) = seedID == "taro-seed" ? ("taro", 720) : seedID == "millet-seed" ? ("millet", 960) : ("herb", 480)
        consume(seedID, amount: 1); plot.slots[slot] = .init(cropID: crop.0, seedID: seedID, progress: 0, duration: crop.1, stage: "seeded")
        save.plots[plotID] = plot; notice = "种子已经播下"; persistWorld()
    }

    public func waterPlot(_ plotID: String) {
        guard save.inventory["fresh-water", default: 0] > 0 else { notice = "需要淡水"; return }
        var plot = save.plots[plotID] ?? CropPlot()
        guard plot.slots.contains(where: { $0 != nil && $0?.stage != "ripe" }) else { notice = "先播种再浇水"; return }
        consume("fresh-water", amount: 1); plot.water = min(12, plot.water + 1)
        save.plots[plotID] = plot; notice = "农田已经浇水"; persistWorld()
    }

    public func harvest(plotID: String, slot: Int) {
        guard var plot = save.plots[plotID], plot.slots.indices.contains(slot), let crop = plot.slots[slot], crop.stage == "ripe" else { return }
        save.inventory[crop.cropID, default: 0] += crop.cropID == "millet" ? 3 : 2
        plot.slots[slot] = nil; save.plots[plotID] = plot
        notice = "收获了 \(itemName(crop.cropID))"; persistWorld()
    }

    private func advanceFarms(_ source: GameSave, minutes: Double) -> GameSave {
        guard minutes > 0 else { return source }
        var next = source
        for (id, original) in source.plots where original.water > 0 {
            var plot = original; var active = false
            for index in plot.slots.indices {
                guard var crop = plot.slots[index], crop.stage != "ripe" else { continue }
                active = true; crop.progress = min(crop.duration, crop.progress + minutes)
                crop.stage = crop.progress >= crop.duration ? "ripe" : "growing"; plot.slots[index] = crop
            }
            if active {
                let usage = plot.waterUsageMinutes + minutes
                let spent = min(plot.water, Int(floor(usage / 60)))
                plot.water -= spent; plot.waterUsageMinutes = plot.water == 0 ? 0 : usage - Double(spent * 60)
            }
            next.plots[id] = plot
        }
        return next
    }

    public func setPlayMode(_ mode: PlayMode) {
        save.playMode = mode
        deriveGuide()
        persistWorld()
    }

    public var hotbarItems: [String?] {
        let priority = ["coconut", "berry", "road-segment", "rail-segment", "campfire", "shelter", "stone-axe", "stone-pickaxe", "rope", "fresh-water"]
        let ownedPriority = priority.filter { save.inventory[$0, default: 0] > 0 }
        let remaining = save.inventory.keys.filter { save.inventory[$0, default: 0] > 0 && !priority.contains($0) }.sorted()
        return Array((ownedPriority + remaining).prefix(6)).map(Optional.some) + Array(repeating: nil, count: max(0, 6 - min(6, ownedPriority.count + remaining.count)))
    }

    public var heldActionLabel: String? {
        guard placementType == nil, let item = selectedHotbarItem, save.inventory[item, default: 0] > 0 else { return nil }
        if ["coconut", "berry", "taro", "millet"].contains(item) { return "进食 · \(itemName(item))" }
        if item == "road-segment" { return "铺路 · 夯土路" }
        if item == "rail-segment" { return "铺轨 · 接到相邻轨道" }
        if ["campfire", "shelter", "storage-crate", "furnace", "garden-plot", "workbench"].contains(item) { return "放置 · \(itemName(item))" }
        return nil
    }

    public var contextActionLabel: String {
        if placementType != nil { return "放置" }
        if nearestInteractiveEntity() != nil { return entityActionLabel(nearestInteractiveEntity()!.type) }
        if nearestVillagerIsClose { return "交谈" }
        if nearestGroundItem() != nil { return "拾取" }
        return "采集"
    }

    public var contextActionIcon: String {
        if placementType != nil { return "build" }
        if let entity = nearestInteractiveEntity() {
            if ["storage-crate"].contains(entity.type) { return "backpack" }
            if ["shelter", "straw-mat", "hammock", "simple-bed"].contains(entity.type) { return "sleep" }
            return "crafting"
        }
        if nearestVillagerIsClose { return "chat" }
        return "gather"
    }

    public func selectHotbarItem(_ itemID: String?) {
        guard let itemID, save.inventory[itemID, default: 0] > 0 else { selectedHotbarItem = nil; return }
        selectedHotbarItem = itemID
    }

    public func useSelectedHotbarItem() {
        guard let item = selectedHotbarItem, save.inventory[item, default: 0] > 0 else { notice = "先在快捷栏选择物品"; return }
        if ["coconut", "berry", "taro", "millet"].contains(item) { eat(item) }
        else if item == "road-segment" { placeRoadAhead() }
        else if item == "rail-segment" { placeRailAhead() }
        else if ["campfire", "shelter", "storage-crate", "furnace", "garden-plot", "workbench"].contains(item) { beginPlacement(item) }
        else { notice = "\(itemName(item))需要在合适的目标旁使用" }
        if save.inventory[item, default: 0] <= 0 { selectedHotbarItem = hotbarItems.compactMap { $0 }.first }
    }

    public func performContextAction() {
        if placementType != nil {
            confirmPlacement(at: .init(x: save.player.position.x + 48, y: save.player.position.y))
            return
        }
        if let entity = nearestInteractiveEntity() {
            if ["shelter", "straw-mat", "hammock", "simple-bed"].contains(entity.type) { restUntilMorning(); return }
            activeFacilityID = entity.id
            switch entity.type {
            case "storage-crate": activeCampSection = .storage
            case "furnace": activeCampSection = .furnace
            case "garden-plot", "farm-plot": activeCampSection = .farm
            case "workbench": activeCampSection = .crafting
            case "rowboat":
                let leaving = TransportRules.aboardBoatID(save) == entity.id
                if let next = TransportRules.toggleBoat(save, boatID: entity.id) { save = next; notice = leaving ? "已从木船靠岸" : "已登船，再次使用即可靠岸"; persistWorld() }
            case "minecart":
                if let next = TransportRules.pushMinecart(save, minecartID: entity.id) { save = next; notice = "矿车沿连续轨道前进了一格"; persistWorld() }
                else { notice = "矿车前方没有连续轨道" }
            case "rail-segment": notice = "轨道已连接；将矿车推到相邻轨段"
            case let type where type.hasPrefix("animal-"):
                let species = String(type.dropFirst("animal-".count))
                save.discoveries.insert("animal:\(species)")
                notice = "图鉴记录：\(animalName(species))；动物会在对应地形活动"
                persistWorld()
            default: activeCampSection = .handbook
            }
            return
        }
        if nearestVillagerIsClose { activeCampSection = .villager; return }
        if let ground = nearestGroundItem() { pickupGroundItem(ground.id); return }
        gatherNearby()
    }

    private func nearestInteractiveEntity() -> PlacedEntity? {
        let types = Set(["storage-crate", "furnace", "garden-plot", "farm-plot", "workbench", "shelter", "straw-mat", "hammock", "simple-bed", "rowboat", "minecart", "rail-segment"])
        return save.entities.filter { types.contains($0.type) || $0.type.hasPrefix("animal-") }
            .min { distance($0.position, save.player.position) < distance($1.position, save.player.position) }
            .flatMap { distance($0.position, save.player.position) <= 96 ? $0 : nil }
    }

    private func nearestGroundItem() -> GroundItem? {
        save.groundItems.min { distance($0.position, save.player.position) < distance($1.position, save.player.position) }
            .flatMap { distance($0.position, save.player.position) <= 82 ? $0 : nil }
    }

    private var nearestVillagerIsClose: Bool {
        VillageRules.residents.map { VillageRules.position(of: $0, minute: save.clock.minute) }
            .contains { distance($0, save.player.position) <= 110 }
    }

    private func distance(_ lhs: WorldPoint, _ rhs: WorldPoint) -> Double { hypot(lhs.x - rhs.x, lhs.y - rhs.y) }

    private func entityActionLabel(_ type: String) -> String {
        switch type {
        case "storage-crate": return "打开箱子"
        case "furnace": return "熔炼"
        case "garden-plot", "farm-plot": return "耕作"
        case "workbench": return "制作"
        case "shelter", "straw-mat", "hammock", "simple-bed": return "休息"
        case "rowboat": return TransportRules.aboardBoatID(save) == nearestInteractiveEntity()?.id ? "靠岸" : "登船"
        case "minecart": return "推动矿车"
        case "rail-segment": return "检查轨道"
        case let value where value.hasPrefix("animal-"): return "观察动物"
        default: return "使用"
        }
    }

    private func restUntilMorning() {
        save.clock.day += 1
        save.clock.minute = 360
        save.player.energy = min(100, save.player.energy + 42)
        if save.player.food >= 70 && save.player.water >= 70 { save.player.health = min(100, save.player.health + 8) }
        save.discoveries.insert("slept:any")
        notice = "休息到清晨，体力已经恢复"
        deriveGuide()
        persistWorld()
    }

    private func animalName(_ species: String) -> String {
        ["land-crab": "陆蟹", "sea-turtle": "海龟", "wild-boar": "野猪"][species] ?? "岛上动物"
    }

    public func beginPlacement(_ type: String) { placementType = type }
    public func cancelPlacement() { placementType = nil }
    public func confirmPlacement(at point: WorldPoint) {
        guard let type = placementType, (save.inventory[type] ?? 0) > 0 else { return }
        save.inventory[type, default: 0] -= 1
        save.entities.append(.init(id: "entity-\(save.entities.count + 1)", type: type, position: point))
        placementType = nil; deriveGuide(); persistWorld()
    }

    public func gatherNearby() {
        let resources = ["driftwood", "branch", "stone", "palm-fiber", "fresh-water", "berry", "coconut", "clay", "copper-ore", "charcoal"]
        let index = abs(Int(save.player.position.x + save.player.position.y) + save.clock.minute / 6) % resources.count
        let itemID = resources[index]
        save.inventory[itemID, default: 0] += 1
        let first = !save.discoveries.contains(itemID)
        save.discoveries.insert(itemID)
        notice = "采集到 \(itemName(itemID)) ×1"
        if first { showUnlock(itemID) }
        deriveGuide()
        persistWorld()
    }

    public func craft(_ recipeID: String) {
        let definitions: [String: ([String: Int], String, Int)] = [
            "craft-rope": (["palm-fiber": 4], "rope", 1),
            "craft-stone-axe": (["driftwood": 2, "stone": 2, "palm-fiber": 1], "stone-axe", 1),
            "craft-stone-pickaxe": (["branch": 2, "stone": 3, "rope": 1], "stone-pickaxe", 1),
            "craft-fishing-rod": (["driftwood": 2, "palm-fiber": 3], "fishing-rod", 1),
            "build-campfire": (["driftwood": 3, "stone": 4], "campfire", 1),
            "build-storage-crate": (["driftwood": 6, "rope": 2], "storage-crate", 1),
            "build-furnace": (["stone": 8, "clay": 4], "furnace", 1),
            "build-garden-plot": (["softwood-log": 4, "clay": 6, "dry-grass": 4], "garden-plot", 1),
            "build-road-segment": (["branch": 1, "stone": 1], "road-segment", 4),
        ]
        guard let definition = definitions[recipeID] else { return }
        guard definition.0.allSatisfy({ save.inventory[$0.key, default: 0] >= $0.value }) else {
            notice = "材料不足，配方会保留在制作页"
            return
        }
        for (itemID, amount) in definition.0 { consume(itemID, amount: amount) }
        save.inventory[definition.1, default: 0] += definition.2
        save.discoveries.insert(definition.1)
        notice = "已制作 \(itemName(definition.1))"
        showUnlock(definition.1)
        persistWorld()
    }

    public func placeRoadAhead() {
        guard save.inventory["road-segment", default: 0] > 0 else {
            notice = "先用树枝和海蚀石制作道路"
            return
        }
        let grid: CGFloat = 48
        let roads = save.entities.filter { $0.type == "road-segment" }
        let occupied = Set(roads.map { "\(Int(round($0.position.x / grid))),\(Int(round($0.position.y / grid)))" })
        let origin = roads.min(by: {
            hypot($0.position.x - save.player.position.x, $0.position.y - save.player.position.y) <
            hypot($1.position.x - save.player.position.x, $1.position.y - save.player.position.y)
        })?.position ?? save.player.position
        let gx = Int(round(origin.x / grid)); let gy = Int(round(origin.y / grid))
        let candidates = [(gx + 1, gy), (gx, gy + 1), (gx - 1, gy), (gx, gy - 1)]
        guard let target = candidates.first(where: { !occupied.contains("\($0.0),\($0.1)") }) else {
            notice = "这一小段道路已经铺满，走到道路尽头再继续"
            return
        }
        consume("road-segment", amount: 1)
        save.entities.append(.init(id: "road-\(UUID().uuidString)", type: "road-segment",
                                   position: .init(x: CGFloat(target.0) * grid, y: CGFloat(target.1) * grid)))
        notice = "道路已连接，会自动形成直路、弯道和岔路"
        persistWorld()
    }

    public func placeRailAhead() {
        guard save.inventory["rail-segment", default: 0] > 0 else { notice = "背包里没有轨道组件"; return }
        guard let point = TransportRules.nextRailPlacement(in: save) else { notice = "轨道必须接在已有轨道的上下左右"; return }
        consume("rail-segment", amount: 1)
        save.entities.append(.init(id: "rail-\(UUID().uuidString)", type: "rail-segment", position: point))
        notice = "轨道已与相邻轨道接通"
        persistWorld()
    }

    public func recruitBuilder() {
        guard !save.recruitedVillagers.contains("castaway-builder") else { notice = "阿拓已经加入营地"; return }
        guard save.entities.contains(where: { ["shelter", "straw-mat", "hammock", "simple-bed"].contains($0.type) }) else { notice = "先准备一处床位或庇护所"; return }
        guard save.inventory["fresh-water", default: 0] >= 10, save.inventory["berry", default: 0] + save.inventory["coconut", default: 0] >= 10 else { notice = "招募需要 10 份食物和 10 份淡水"; return }
        consume("fresh-water", amount: 10)
        let berries = min(10, save.inventory["berry", default: 0]); consume("berry", amount: berries)
        if berries < 10 { consume("coconut", amount: 10 - berries) }
        save.recruitedVillagers.insert("castaway-builder")
        notice = "阿拓加入了营地"
        persistWorld()
    }

    public func trade(with residentID: String) {
        guard let resident = VillageRules.residents.first(where: { $0.id == residentID }) else { return }
        guard let next = VillageRules.trade(save, residentID: residentID) else {
            notice = resident.giveItem.map { "还需要 \(resident.giveAmount) 个 \(itemName($0))" } ?? "这位居民暂不交易"
            return
        }
        save = next
        notice = "与\(resident.name)交易：得到 \(resident.receiveAmount) 个 \(itemName(resident.receiveItem ?? ""))"
        persistWorld()
    }

    private func showUnlock(_ itemID: String) {
        let recipes: [String: String] = [
            "palm-fiber": "绳索、小背包、绷带", "stone": "石斧、石镐、营火",
            "driftwood": "石斧、营火、钓竿", "rope": "石镐、石砍刀、庇护所",
            "fresh-water": "煮沸水、炖汤", "berry": "水果碗、温补剂",
        ]
        unlockNotice = .init(title: "解锁了 \(itemName(itemID))", recipeLine: "配方是 \(recipes[itemID] ?? "已记录到图鉴")")
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            if self?.unlockNotice?.title == "解锁了 \(self?.itemName(itemID) ?? itemID)" { self?.unlockNotice = nil }
        }
    }

    public func transferStorage(entityID: String, itemID: String, amount: Int, direction: StorageTransferDirection) {
        let result = FacilityRules.transferStorage(save, entityID: entityID, itemID: itemID, amount: amount, direction: direction)
        guard result.failure == nil else { notice = "没有足够的物品可移动"; return }
        save = result.save
        persistWorld()
    }

    public func startFurnace(entityID: String, recipe: FurnaceRecipe) {
        let result = FacilityRules.startFurnace(save, entityID: entityID, recipe: recipe)
        if let failure = result.failure {
            notice = failure == .missingFuel ? "燃料不足" : failure == .missingInput ? "矿料不足" : "请先领取上一炉产物"
            return
        }
        save = result.save
        notice = "熔炉已点燃，离开面板后仍会工作"
        persistWorld()
    }

    public func claimFurnace(entityID: String) {
        let result = FacilityRules.claimFurnace(save, entityID: entityID)
        guard result.failure == nil else { notice = "熔炉还没有可领取的产物"; return }
        save = result.save
        notice = "产物已放入背包"
        persistWorld()
    }

    public func writeDiary(title: String, text: String) {
        let id = "day-\(save.clock.day)"
        if let index = save.diary.firstIndex(where: { $0.id == id }) {
            save.diary[index].title = title; save.diary[index].text = text
        } else { save.diary.append(.init(id: id, day: save.clock.day, title: title, text: text)) }
        deriveGuide(); persistWorld()
    }

    public func checkForUpdates() async {
        guard !isCheckingUpdate else { return }
        isCheckingUpdate = true
        updateMessage = "正在检查更新…"
        defer { isCheckingUpdate = false }
        #if os(iOS)
        let appID = "survival-diary-ios"
        let platform = "ios"
        #else
        let appID = "survival-diary-macos"
        let platform = "macos"
        #endif
        do {
            guard let release = try await updateService.fetchRelease(manifestURL: manifestURL, appID: appID) else {
                pendingUpdate = .current; hasPendingUpdate = false; updateMessage = "当前暂无可用安装包"; return
            }
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.5.0"
            let build = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "15") ?? 15
            pendingUpdate = updateService.check(currentVersion: version, currentBuild: build, release: release, platform: platform)
            hasPendingUpdate = pendingUpdate != .current
            updateMessage = hasPendingUpdate ? "发现新版本 \(release.version)（\(release.build)）" : "已是最新版本"
        } catch {
            pendingUpdate = .current; hasPendingUpdate = false; updateMessage = "检查失败，请稍后重试"
        }
    }

    public func installPendingUpdate() async {
        switch pendingUpdate {
        case .current:
            await checkForUpdates()
        case let .store(url):
            #if os(iOS)
            await UIApplication.shared.open(url)
            #elseif os(macOS)
            NSWorkspace.shared.open(url)
            #endif
        case let .direct(url, checksum):
            do {
                updateMessage = "正在下载更新…"
                let (temporaryURL, response) = try await URLSession.shared.download(from: url)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    updateMessage = "下载失败，请稍后重试"; return
                }
                try await Task.detached {
                    try UpdateService().verify(fileAt: temporaryURL, expectedSHA256: checksum)
                }.value
                let downloads = try FileManager.default.url(for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let destination = downloads.appendingPathComponent(url.lastPathComponent)
                if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
                try FileManager.default.moveItem(at: temporaryURL, to: destination)
                updateMessage = "更新已下载，正在打开系统安装器"
                #if os(macOS)
                NSWorkspace.shared.open(destination)
                #endif
            } catch {
                updateMessage = "更新校验或安装失败"
            }
        }
    }

    private func deriveGuide() {
        guard save.playMode == .guided else { guideText = nil; return }
        let count: (String) -> Int = { self.save.inventory[$0, default: 0] }
        let owns: (String) -> Bool = { type in self.save.entities.contains { $0.type == type } }
        let firstTool = ["stone-machete", "stone-axe", "stone-pickaxe"].contains { count($0) > 0 || save.discoveries.contains($0) }
        let starter = count("branch") >= 1 && count("stone") >= 2 && count("palm-fiber") >= 4
        let water = ["fresh-water", "coconut-water", "boiled-water"].contains { count($0) > 0 || save.discoveries.contains($0) }
        let shelter = ["shelter", "straw-mat", "hammock", "simple-bed", "camp-bed", "wooden-bed"].contains(where: owns)
        if !save.discoveries.contains("tutorial:moved") { guideText = "第一章 1/8 · 潮退之后｜轻点岛上空地，先走几步确认方向" }
        else if !starter && !firstTool { guideText = "第一章 2/8 · 眼下能用的东西｜树枝 1、海蚀石 2、棕榈纤维 4" }
        else if !water { guideText = "第一章 3/8 · 先解决口渴｜寻找并采集出生海湾的淡水" }
        else if !firstTool { guideText = "第一章 4/8 · 第一把工具｜制作砍刀、石斧或石镐中的任意一种" }
        else if !save.discoveries.contains("consumed:any") { guideText = "第一章 5/8 · 给黑夜留些体力｜采集并吃下一份食物" }
        else if !owns("campfire") { guideText = "第一章 6/8 · 天黑前点起火｜制作并放置一座营火" }
        else if !shelter { guideText = "第一章 7/8 · 搭好住处｜放置庇护所或床铺" }
        else if !save.discoveries.contains("slept:any") { guideText = "第一章 8/8 · 熬过第一夜｜靠近住处休息到清晨" }
        else { guideText = "岛屿传闻｜清晨雾后出现炊烟，去寻找村落、动物与矿脉" }
    }

    private func consume(_ itemID: String, amount: Int) {
        let remaining = save.inventory[itemID, default: 0] - amount
        if remaining > 0 { save.inventory[itemID] = remaining }
        else { save.inventory.removeValue(forKey: itemID) }
    }

    public func itemName(_ itemID: String) -> String {
        [
            "driftwood": "漂流木", "branch": "树枝", "stone": "海蚀石", "palm-fiber": "棕榈纤维", "clay": "黏土",
            "fresh-water": "淡水", "berry": "浆果", "coconut": "椰子",
            "taro-seed": "芋种", "millet-seed": "粟种", "herb-seed": "药草种子",
            "taro": "海岛芋", "millet": "粟米", "herb": "药草",
            "rope": "绳索", "road-segment": "道路组件", "storage-crate": "储物箱", "furnace": "石砌熔炉", "copper-ore": "铜矿石",
            "stone-axe": "石斧", "stone-pickaxe": "石镐", "fishing-rod": "钓竿", "campfire": "营火", "shelter": "庇护所", "garden-plot": "九格耕作田", "workbench": "工作台",
            "charcoal": "木炭", "coal": "煤", "iron-ore": "铁矿石", "copper-ingot": "铜锭", "iron-ingot": "铁锭",
        ][itemID] ?? itemID
    }
}
