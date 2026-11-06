import SwiftUI
import SurvivalDiaryCore

@MainActor
struct CampPanelView: View {
    @ObservedObject var store: GameStore
    let section: CampSection
    @Environment(\.dismiss) private var dismiss
    @State private var villagerID = "castaway-builder"
    @State private var villagerQuestion = ""

    var body: some View {
        ZStack {
            Color(red: 0.055, green: 0.09, blue: 0.075).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Image(sectionIcon, bundle: .module).resizable().scaledToFit().frame(width: 34, height: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.title2.bold()).foregroundStyle(Color(red: 0.95, green: 0.91, blue: 0.79))
                        Text(sectionSubtitle).font(.caption).foregroundStyle(Color(red: 0.68, green: 0.63, blue: 0.52))
                    }
                    Spacer()
                    Button("返回岛上") { dismiss() }.buttonStyle(.bordered).tint(Color(red: 0.91, green: 0.66, blue: 0.16))
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                Rectangle().fill(Color(red: 0.46, green: 0.34, blue: 0.18)).frame(height: 1)
                Group {
                switch section {
                case .inventory: inventory
                case .crafting: crafting
                case .handbook: handbook
                case .compendium: compendium
                case .villager: villager
                case .storage: storage
                case .furnace: furnace
                case .farm: farm
                case .transport: transport
                }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .frame(minWidth: 340, minHeight: 440)
        .preferredColorScheme(.dark)
    }

    private var title: String {
        switch section { case .inventory: return "背包"; case .crafting: return "制作"; case .handbook: return "营地手册"; case .compendium: return "海岛图鉴"; case .villager: return "伙伴"; case .storage: return "储物箱"; case .furnace: return "石砌熔炉"; case .farm: return "九格耕作田"; case .transport: return "海岛交通" }
    }

    private var sectionIcon: String {
        switch section { case .inventory: return "backpack"; case .crafting: return "crafting"; case .handbook: return "map"; case .compendium: return "journal"; case .villager: return "chat"; case .storage: return "backpack"; case .furnace: return "crafting"; case .farm: return "gather"; case .transport: return "map" }
    }

    private var sectionSubtitle: String {
        switch section { case .inventory: return "随身物资与快捷栏"; case .crafting: return "配方与设施"; case .handbook: return "营地、地图与记录"; case .compendium: return "岛上发现关系"; case .villager: return "营地伙伴"; case .storage: return "只操作角色身边的箱子"; case .furnace: return "矿料、燃料与产物分槽"; case .farm: return "播种、浇水、等待与收获"; case .transport: return "木船、连续轨道与矿车" }
    }

    private var inventory: some View {
        List {
            if store.save.inventory.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack { Image("backpack", bundle: .module).resizable().scaledToFit().frame(width: 28, height: 28); Text("背包还是空的") }
                    Text("返回岛上，使用情境动作采集附近资源。").font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 12)
            }
            ForEach(store.save.inventory.keys.sorted(), id: \.self) { itemID in
                VStack(alignment: .leading, spacing: 8) {
                    HStack { itemIcon(itemID); Text(store.itemName(itemID)); Spacer(); Text("×\(store.save.inventory[itemID, default: 0])").monospacedDigit() }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Button(store.selectedHotbarItem == itemID ? "已在快捷栏" : "放入快捷栏") { store.selectHotbarItem(itemID) }
                                .buttonStyle(.bordered).disabled(store.selectedHotbarItem == itemID)
                            if ["coconut", "berry", "taro", "millet"].contains(itemID) { Button("食用") { store.eat(itemID) }.buttonStyle(.borderedProminent) }
                            if itemID == "road-segment" { Button("铺路") { store.placeRoadAhead() }.buttonStyle(.borderedProminent) }
                            if itemID == "rail-segment" { Button("铺轨") { store.placeRailAhead() }.buttonStyle(.borderedProminent) }
                            Button("丢弃 1 个") { store.dropItem(itemID) }.buttonStyle(.bordered)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            if !store.save.groundItems.isEmpty {
                Section("脚边物品") {
                    ForEach(store.save.groundItems) { item in
                        HStack { Text("\(store.itemName(item.itemID)) ×\(item.amount)"); Spacer(); Button("拾取") { store.pickupGroundItem(item.id) } }
                    }
                }
            }
        }
    }

    private var crafting: some View {
        List {
            Section {
                Button { store.activeCampSection = .compendium } label: {
                    Label("打开海岛图鉴", systemImage: "book.pages.fill")
                }
            } footer: {
                Text("直接资源先显示；取得材料或发现设施后，关联配方会继续展开。")
            }
            Section("可制作") {
                recipeRow("绳索", detail: "棕榈纤维×4", id: "craft-rope", icon: "rope")
                recipeRow("石斧", detail: "漂流木×2 · 海蚀石×2 · 棕榈纤维×1", id: "craft-stone-axe", icon: "stone-axe")
                recipeRow("石镐", detail: "树枝×2 · 海蚀石×3 · 绳索×1", id: "craft-stone-pickaxe", icon: "stone-axe")
                recipeRow("钓竿", detail: "漂流木×2 · 棕榈纤维×3", id: "craft-fishing-rod", icon: "stone-axe")
                recipeRow("营火", detail: "漂流木×3 · 海蚀石×4", id: "build-campfire", icon: "campfire")
                recipeRow("道路组件 ×4", detail: "树枝×1 · 海蚀石×1", id: "build-road-segment", icon: "stone")
                recipeRow("储物箱", detail: "漂流木×6 · 绳索×2", id: "build-storage-crate", icon: "stone")
                recipeRow("石砌熔炉", detail: "海蚀石×8 · 黏土×4", id: "build-furnace", icon: "campfire")
                recipeRow("种植地", detail: "软木原木×4 · 黏土×6 · 干草×4", id: "build-garden-plot", icon: "palm-fiber")
            }
            Section("设施必须放置后使用") {
                Text("制作完成后回到快捷栏选择建筑并放置。普通制作不会瞬间产出铜锭或铁锭。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func recipeRow(_ name: String, detail: String, id: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(icon, bundle: .module).resizable().scaledToFit().frame(width: 34, height: 34)
            VStack(alignment: .leading) { Text(name).bold(); Text(detail).font(.caption).foregroundStyle(.secondary) }
            Spacer()
            Button("制作") { store.craft(id) }
        }.padding(.vertical, 4)
    }

    private var handbook: some View {
        List {
            Section("岛屿") {
                Button { store.activeCampSection = .compendium } label: { Label("海岛图鉴与发现关系", systemImage: "book.pages.fill") }
                Button { dismiss(); store.isDiaryPresented = true } label: { Label("生存日记与往日记录", systemImage: "book.closed.fill") }
                Button { dismiss(); store.isSettingsPresented = true } label: { Label("设置、更新与重新开始", systemImage: "gearshape.fill") }
            }
            Section("储物箱") {
                let crates = store.save.entities.filter { $0.type == "storage-crate" }
                if crates.isEmpty { Text("尚未放置储物箱").foregroundStyle(.secondary) }
                ForEach(crates) { crate in StorageFacilityView(store: store, entityID: crate.id) }
            }
            Section("熔炉") {
                let furnaces = store.save.entities.filter { $0.type == "furnace" }
                if furnaces.isEmpty { Text("尚未放置熔炉").foregroundStyle(.secondary) }
                ForEach(furnaces) { furnace in FurnaceFacilityView(store: store, entityID: furnace.id) }
            }
            Section("耕作田") {
                let farms = store.save.entities.filter { ["farm-plot", "garden-plot"].contains($0.type) }
                if farms.isEmpty { Text("尚未放置耕作田").foregroundStyle(.secondary) }
                ForEach(farms) { farm in FarmFacilityView(store: store, entityID: farm.id) }
            }
        }
    }

    private var storage: some View {
        List {
            if let id = store.activeFacilityID, store.save.entities.contains(where: { $0.id == id && $0.type == "storage-crate" }) {
                StorageFacilityView(store: store, entityID: id)
            } else { Text("请先靠近一个储物箱").foregroundStyle(.secondary) }
        }
    }

    private var furnace: some View {
        List {
            if let id = store.activeFacilityID, store.save.entities.contains(where: { $0.id == id && $0.type == "furnace" }) {
                FurnaceFacilityView(store: store, entityID: id)
            } else { Text("请先靠近一座石砌熔炉").foregroundStyle(.secondary) }
        }
    }

    private var farm: some View {
        List {
            if let id = store.activeFacilityID, store.save.entities.contains(where: { $0.id == id && ["farm-plot", "garden-plot"].contains($0.type) }) {
                FarmFacilityView(store: store, entityID: id)
            } else { Text("请先靠近一块耕作田").foregroundStyle(.secondary) }
        }
    }

    private var transport: some View {
        List {
            Section("使用方法") {
                Label("轨段只能接在已有轨道的上下左右", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                Label("矿车只会沿连续轨段移动一格", systemImage: "shippingbox.fill")
                Label("靠近木船登船，再次使用即可靠岸", systemImage: "ferry.fill")
            }
            Section("当前状态") {
                Text("轨段 \(store.save.entities.filter { $0.type == "rail-segment" }.count) · 矿车 \(store.save.entities.filter { $0.type == "minecart" }.count) · 木船 \(store.save.entities.filter { $0.type == "rowboat" }.count)")
            }
        }
    }

    private var compendium: some View {
        let direct = ["driftwood", "stone", "palm-fiber", "fresh-water", "berry", "clay", "copper-ore", "charcoal"]
        return List {
            Section("可直接采集") {
                ForEach(direct, id: \.self) { itemID in
                    HStack {
                        Image(systemName: itemSymbol(itemID)).foregroundStyle(.green)
                        Text(store.itemName(itemID)); Spacer()
                        Text(store.save.discoveries.contains(itemID) ? "已取得" : "岛上可见").foregroundStyle(.secondary)
                    }
                }
            }
            Section("发现关系") {
                if store.save.discoveries.contains("palm-fiber") { Label("绳索 · 小背包 · 绷带", systemImage: "sparkles").foregroundStyle(.red) }
                if store.save.discoveries.contains("stone") { Label("石斧 · 石镐 · 营火", systemImage: "sparkles").foregroundStyle(.red) }
                if store.save.discoveries.contains("rope") { Label("石镐 · 石砍刀 · 庇护所", systemImage: "sparkles").foregroundStyle(.red) }
            }
            Section("岛上动物") {
                ForEach([("land-crab", "陆蟹"), ("sea-turtle", "海龟"), ("wild-boar", "野猪")], id: \.0) { species, name in
                    HStack { Label(name, systemImage: "pawprint.fill"); Spacer(); Text(store.save.discoveries.contains("animal:\(species)") ? "已观察" : "尚未记录").foregroundStyle(.secondary) }
                }
            }
        }
    }

    private var villager: some View {
        List {
            Section("潮生村 · 阿拓") {
                Text(store.save.recruitedVillagers.contains("castaway-builder") ? "营地建造者 · 已加入营地" : "需要一处床位、10 份食物和 10 份淡水。")
                if !store.save.recruitedVillagers.contains("castaway-builder") {
                    Button("邀请加入营地") { store.recruitBuilder() }
                }
                Text("阿拓：先把住处和储物箱安顿好，岛才会真正像个家。").font(.callout).foregroundStyle(.secondary)
            }
            Section("潮生村 · 岚商") {
                Text("行商 · 在码头与营地之间走动")
                Text("椰子×2 → 绳索×1").font(.caption).foregroundStyle(.secondary)
                Button("交易") { store.trade(with: "castaway-trader") }
            }
            Section("潮生村 · 禾姨") {
                Text("农人 · 会在耕作田附近巡视")
                Text("浆果×3 → 芋种×1").font(.caption).foregroundStyle(.secondary)
                Button("交易") { store.trade(with: "castaway-farmer") }
            }
            Section("自由交谈") {
                Picker("交谈对象", selection: $villagerID) {
                    Text("阿拓").tag("castaway-builder"); Text("岚商").tag("castaway-trader"); Text("禾姨").tag("castaway-farmer")
                }.pickerStyle(.segmented)
                Text(store.villagerReplySource).font(.caption).foregroundStyle(.secondary)
                Text(store.villagerReply)
                TextField("问路线、矿物、种植或交易", text: $villagerQuestion)
                Button(store.villagerTalking ? "岛民已经先回答，正在连接 Kimi…" : "询问岛民") {
                    Task { await store.talkToVillager(villagerID: villagerID, question: villagerQuestion) }
                }.disabled(store.villagerTalking || villagerQuestion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func itemSymbol(_ itemID: String) -> String {
        if itemID.contains("ore") || itemID == "stone" || itemID == "clay" { return "mountain.2.fill" }
        if itemID.contains("ingot") { return "cube.fill" }
        if itemID == "rope" { return "link" }
        if itemID == "furnace" { return "flame.fill" }
        if itemID == "storage-crate" { return "shippingbox.fill" }
        return "leaf.fill"
    }


    @ViewBuilder private func itemIcon(_ itemID: String) -> some View {
        let exact = ["stone-axe", "stone", "palm-fiber", "rope", "campfire", "shelter"]
        if exact.contains(itemID) { Image(itemID, bundle: .module).resizable().scaledToFit().frame(width: 32, height: 32) }
        else if ["coconut", "berry", "taro", "millet"].contains(itemID) { Image("food", bundle: .module).resizable().scaledToFit().frame(width: 32, height: 32) }
        else if itemID.contains("seed") || itemID == "herb" { Image("gather", bundle: .module).resizable().scaledToFit().frame(width: 32, height: 32).background(.green.opacity(0.16), in: RoundedRectangle(cornerRadius: 7)) }
        else if itemID == "compass" { Image("map", bundle: .module).resizable().scaledToFit().frame(width: 32, height: 32) }
        else { Image("gather", bundle: .module).resizable().scaledToFit().frame(width: 32, height: 32) }
    }
}

@MainActor
private struct FarmFacilityView: View {
    @ObservedObject var store: GameStore
    let entityID: String
    var body: some View {
        let plot = store.save.plots[entityID] ?? CropPlot()
        DisclosureGroup("九格耕作田 · 水量 \(plot.water)/12") {
            Button("浇入 1 份淡水") { store.waterPlot(entityID) }
            ForEach(0..<9, id: \.self) { index in
                let crop = plot.slots[index]
                HStack {
                    Text("\(index + 1). \(cropName(crop))")
                    Spacer()
                    if let crop, crop.stage == "ripe" { Button("收获") { store.harvest(plotID: entityID, slot: index) } }
                    else if crop == nil {
                        ForEach(["taro-seed", "millet-seed", "herb-seed"], id: \.self) { seed in
                            if store.save.inventory[seed, default: 0] > 0 { Button(store.itemName(seed)) { store.plant(seedID: seed, plotID: entityID, slot: index) } }
                        }
                    }
                }
            }
        }
    }
    private func cropName(_ crop: CropSlot?) -> String {
        guard let crop else { return "空地" }
        let name = store.itemName(crop.cropID); let stage = crop.stage == "ripe" ? "成熟" : crop.stage == "growing" ? "生长中" : "已播种"
        return "\(name) · \(stage) \(Int(crop.progress))/\(Int(crop.duration))"
    }
}

@MainActor
private struct StorageFacilityView: View {
    @ObservedObject var store: GameStore
    let entityID: String
    var body: some View {
        DisclosureGroup("储物箱 · \(String(entityID.suffix(4)))") {
            ForEach(Array(Set(store.save.inventory.keys).union(Set(store.save.containerInventories[entityID]?.keys ?? Dictionary<String, Int>().keys))).sorted(), id: \.self) { itemID in
                HStack {
                    Text(store.itemName(itemID)); Spacer()
                    Button("存 1") { store.transferStorage(entityID: entityID, itemID: itemID, amount: 1, direction: .deposit) }
                    Button("取 1") { store.transferStorage(entityID: entityID, itemID: itemID, amount: 1, direction: .withdraw) }
                }
            }
        }
    }
}

@MainActor
private struct FurnaceFacilityView: View {
    @ObservedObject var store: GameStore
    let entityID: String
    var body: some View {
        let process = store.save.facilityProcesses[entityID] ?? FacilityProcess()
        DisclosureGroup("石砌熔炉 · \(String(entityID.suffix(4)))") {
            ProgressView(value: process.progressMinutes, total: max(1, process.durationMinutes))
            Text(statusText(process)).font(.caption).foregroundStyle(.secondary)
            if process.status == .ready {
                Button("领取产物") { store.claimFurnace(entityID: entityID) }
            } else {
                ForEach(FacilityRules.recipes) { recipe in
                    Button("\(store.itemName(recipe.outputItemID))：\(store.itemName(recipe.inputItemID))×\(recipe.inputAmount) + \(store.itemName(recipe.fuelItemID))×\(recipe.fuelAmount)") {
                        store.startFurnace(entityID: entityID, recipe: recipe)
                    }.disabled(process.status == .working)
                }
            }
        }
    }

    private func statusText(_ process: FacilityProcess) -> String {
        switch process.status {
        case .idle: return "矿料、燃料和产物分槽处理"
        case .working: return "熔炼中 \(Int(process.progressMinutes))/\(Int(process.durationMinutes)) 岛屿分钟"
        case .ready: return "完成，领取后才能开始下一炉"
        }
    }
}
