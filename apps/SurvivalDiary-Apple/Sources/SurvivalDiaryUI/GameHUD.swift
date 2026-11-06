import SwiftUI
import SurvivalDiaryCore

public struct GameHUD: View {
    @ObservedObject var store: GameStore
    public init(store: GameStore) { self.store = store }

    private let bone = Color(red: 0.95, green: 0.91, blue: 0.79)
    private let wood = Color(red: 0.17, green: 0.13, blue: 0.09).opacity(0.94)
    private let amber = Color(red: 0.91, green: 0.66, blue: 0.16)

    public var body: some View {
        GeometryReader { proxy in
            ZStack {
                VStack {
                    HStack {
                        Spacer()
                        miniMap
                    }
                    Spacer()
                }

                VStack {
                    chronicle
                    Spacer()
                }

                VStack(alignment: .leading, spacing: 8) {
                    vitals
                    if let guide = store.guideText {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("当前目标").font(.caption.bold()).foregroundStyle(amber)
                            Text(guide).font(.subheadline.bold()).foregroundStyle(bone).lineLimit(3)
                        }
                        .padding(10).frame(maxWidth: 250, alignment: .leading).gamePanel(wood: wood, edge: amber.opacity(0.55))
                    }
                    if let notice = store.notice {
                        Text(notice).font(.caption.bold()).foregroundStyle(bone)
                            .padding(8).frame(maxWidth: 250, alignment: .leading).gamePanel(wood: wood, edge: amber.opacity(0.4))
                    }
                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 60)

                VStack(spacing: 7) {
                    Spacer()
                    ZStack(alignment: .bottomTrailing) {
                        hotbar(compact: proxy.size.width < 650)
                            .frame(maxWidth: .infinity)
                        HStack(alignment: .bottom, spacing: 7) {
                            if let held = store.heldActionLabel {
                                Button { store.useSelectedHotbarItem() } label: {
                                    HStack(spacing: 6) { gameIcon(hotbarIcon(store.selectedHotbarItem ?? ""), size: 24); Text(held).font(.caption.bold()).lineLimit(2) }
                                        .padding(.horizontal, 10).frame(minWidth: 104, maxWidth: proxy.size.width < 650 ? 132 : 154, minHeight: 46)
                                }
                                .buttonStyle(.plain).foregroundStyle(bone)
                                .background(Color(red: 0.17, green: 0.27, blue: 0.20).opacity(0.97), in: FieldPanelShape())
                                .overlay(FieldPanelShape().stroke(amber.opacity(0.62), lineWidth: 1.25))
                            }
                            Button { store.performContextAction() } label: {
                                HStack(spacing: 7) { gameIcon(store.contextActionIcon, size: 27); Text(store.contextActionLabel).font(.caption.bold()).lineLimit(2) }
                                    .padding(.horizontal, 11).frame(minWidth: proxy.size.width < 650 ? 118 : 132, maxWidth: 164, minHeight: 56)
                            }
                            .buttonStyle(.plain).foregroundStyle(bone)
                            .background(Color(red: 0.12, green: 0.30, blue: 0.23).opacity(0.98), in: FieldPanelShape())
                            .overlay(FieldPanelShape().stroke(amber.opacity(0.86), lineWidth: 2))
                        }
                        .shadow(color: Color(red: 0.04, green: 0.09, blue: 0.07).opacity(0.72), radius: 6, y: 3)
                        .offset(y: -57)
                    }
                    HStack(spacing: 0) {
                        nav("背包", "backpack") { store.activeCampSection = .inventory }
                        nav("制作", "crafting") { store.activeCampSection = .crafting }
                        nav("地图", "map") { store.activeCampSection = .handbook }
                        nav("日记", "journal") { store.isDiaryPresented = true }
                        nav("系统", "time") { store.isSettingsPresented = true }
                    }
                    .padding(4).gamePanel(wood: wood, edge: amber.opacity(0.45))
                }
            }
            .padding(10)
        }
        .buttonStyle(.plain)
    }

    private var chronicle: some View {
        HStack(spacing: 9) {
            Text("第 \(store.save.clock.day) 天").bold()
            Divider().frame(height: 20).overlay(bone.opacity(0.3))
            gameIcon(weatherIcon, size: 25)
            Text(String(format: "%02d:%02d", store.save.clock.minute / 60, store.save.clock.minute % 60)).bold().foregroundStyle(amber)
            Text(store.save.weather.kind).font(.caption)
        }
        .foregroundStyle(bone).padding(.horizontal, 14).padding(.vertical, 8).gamePanel(wood: wood, edge: amber.opacity(0.65))
    }

    private var vitals: some View {
        VStack(spacing: 5) {
            vital("生命", store.save.player.health, .red, "health")
            vital("饮水", store.save.player.water, .cyan, "water")
            vital("饱腹", store.save.player.food, .orange, "food")
            vital("体力", Int(store.save.player.energy.rounded()), .yellow, "energy")
        }
        .padding(6).frame(width: 154).gamePanel(wood: Color(red: 0.09, green: 0.14, blue: 0.11).opacity(0.94), edge: amber.opacity(0.5))
    }

    private func vital(_ title: String, _ value: Int, _ color: Color, _ icon: String) -> some View {
        HStack(spacing: 6) {
            gameIcon(icon, size: 22)
            VStack(spacing: 1) {
                HStack { Text(title).font(.caption2); Spacer(); Text("\(value)").font(.caption2.bold()) }
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.black.opacity(0.45))
                        Capsule().fill(color).frame(width: geometry.size.width * CGFloat(max(0, min(100, value))) / 100)
                    }
                }.frame(height: 5)
            }
        }
        .foregroundStyle(bone)
        .padding(.horizontal, 4).padding(.vertical, 3)
    }

    private func hotbar(compact: Bool) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(store.hotbarItems.enumerated()), id: \.offset) { index, item in
                Button { store.selectHotbarItem(item) } label: {
                    if let item {
                        VStack(spacing: 1) {
                            gameIcon(hotbarIcon(item), size: compact ? 27 : 31)
                            Text("\(store.save.inventory[item] ?? 0)").font(.caption2.bold()).monospacedDigit()
                        }.frame(width: compact ? 42 : 48, height: compact ? 46 : 50)
                    } else {
                        Text("\(index + 1)").font(.caption2).foregroundStyle(bone.opacity(0.28))
                            .frame(width: compact ? 42 : 48, height: compact ? 46 : 50)
                    }
                }
                .accessibilityLabel(item.map { store.itemName($0) } ?? "空快捷栏")
                .foregroundStyle(bone)
                .background(store.selectedHotbarItem == item && item != nil ? amber.opacity(0.24) : Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 5))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(store.selectedHotbarItem == item && item != nil ? amber : Color.clear, lineWidth: 2))
            }
        }.padding(4).gamePanel(wood: wood, edge: amber.opacity(0.7))
    }

    private var miniMap: some View {
        ZStack {
            Circle().fill(Color(red: 0.09, green: 0.31, blue: 0.36))
            Circle().fill(Color(red: 0.32, green: 0.51, blue: 0.3)).frame(width: 57, height: 43).offset(x: -7, y: 3)
            Circle().fill(Color(red: 0.86, green: 0.73, blue: 0.43)).frame(width: 18, height: 15).offset(x: 18, y: -15)
            Circle().fill(amber).frame(width: 8, height: 8)
            RoundedRectangle(cornerRadius: 2).fill(Color.orange).frame(width: 9, height: 9)
                .offset(x: villageMapOffset.x, y: villageMapOffset.y)
            Circle().stroke(Color(red: 0.59, green: 0.44, blue: 0.22), lineWidth: 4)
            gameIcon("map", size: 20).offset(x: 29, y: 29)
        }.frame(width: 86, height: 86).shadow(radius: 8, y: 4).onTapGesture { store.activeCampSection = .handbook }
    }

    private var villageMapOffset: CGPoint {
        let dx = max(-31, min(31, (VillageRules.center.x - store.save.player.position.x) / 7))
        let dy = max(-31, min(31, (VillageRules.center.y - store.save.player.position.y) / 7))
        return CGPoint(x: dx, y: dy)
    }

    private func nav(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { VStack(spacing: 2) { gameIcon(icon, size: 27); Text(title).font(.caption2) }.frame(maxWidth: .infinity, minHeight: 43) }
            .foregroundStyle(bone)
    }

    private func gameIcon(_ name: String, size: CGFloat) -> some View {
        Image(name, bundle: .module)
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: max(3, size * 0.16)))
    }

    private func hotbarIcon(_ item: String) -> String {
        if ["coconut", "berry", "taro", "millet"].contains(item) { return "food" }
        if ["campfire", "shelter", "storage-crate", "furnace", "garden-plot", "workbench", "road-segment"].contains(item) { return "build" }
        if item == "stone-pickaxe" || item == "fishing-rod" { return "stone-axe" }
        if ["stone-axe", "rope", "stone", "palm-fiber"].contains(item) { return item }
        return "gather"
    }
    private var weatherIcon: String {
        if store.save.weather.kind.contains("snow") || store.save.weather.kind.contains("blizzard") { return "weather_snow" }
        if store.save.weather.kind.contains("rain") || store.save.weather.kind.contains("storm") { return "weather_rain" }
        return "weather_clear"
    }
}

private extension View {
    func gamePanel(wood: Color, edge: Color) -> some View {
        background(LinearGradient(colors: [wood, wood.opacity(0.88)], startPoint: .topLeading, endPoint: .bottomTrailing), in: FieldPanelShape())
            .overlay(FieldPanelShape().stroke(edge, lineWidth: 1)).shadow(radius: 6, y: 3)
    }
    func gameCircle(wood: Color, edge: Color) -> some View {
        frame(width: 42, height: 42).foregroundStyle(Color.white).background(wood, in: Circle()).overlay(Circle().stroke(edge, lineWidth: 1))
    }
}

private struct FieldPanelShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 10, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - 3, y: rect.minY + 2))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + 7), control: CGPoint(x: rect.maxX, y: rect.minY + 2))
        path.addLine(to: CGPoint(x: rect.maxX - 2, y: rect.maxY - 9))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - 9, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + 5, y: rect.maxY - 2))
        path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - 7), control: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + 2, y: rect.minY + 10))
        path.addQuadCurve(to: CGPoint(x: rect.minX + 10, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}
