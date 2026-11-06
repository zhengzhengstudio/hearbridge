import SpriteKit
import SwiftUI
import SurvivalDiaryCore
import SurvivalDiaryGame

@MainActor
public struct GameContainerView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store: GameStore
    @State private var lastMagnification: CGFloat = 1
    @State private var lastTranslation: CGSize = .zero
    @State private var launchStage = "launcher"
    @State private var confirmingNewWorld = false
    private let scene: IslandScene

    public init() {
        let store = GameStore()
        _store = StateObject(wrappedValue: store)
        scene = IslandScene(size: CGSize(width: 1280, height: 800))
    }

    public init(store: GameStore) {
        _store = StateObject(wrappedValue: store)
        scene = IslandScene(size: CGSize(width: 1280, height: 800))
    }

    public var body: some View {
        GeometryReader { worldProxy in
        ZStack {
            SpriteView(scene: scene)
                .ignoresSafeArea()
                .accessibilityLabel("2.5D 无边海岛世界")
                .gesture(SimultaneousGesture(
                    DragGesture().onChanged { value in
                        let delta = CGPoint(x: value.translation.width - lastTranslation.width, y: value.translation.height - lastTranslation.height)
                        scene.pan(screenDelta: delta); lastTranslation = value.translation
                    }.onEnded { _ in lastTranslation = .zero },
                    MagnificationGesture().onChanged { value in
                        scene.zoom(by: value / lastMagnification); lastMagnification = value
                    }.onEnded { _ in lastMagnification = 1 }
                ))
                .simultaneousGesture(SpatialTapGesture().onEnded { value in
                    let center = CGPoint(x: worldProxy.size.width / 2, y: worldProxy.size.height / 2)
                    store.movePlayer(screenDelta: CGSize(width: value.location.x - center.x, height: value.location.y - center.y))
                })
                .allowsHitTesting(launchStage == "playing")
            GameHUD(store: store)
                .allowsHitTesting(launchStage == "playing")
            if let unlock = store.unlockNotice {
                VStack(spacing: 4) {
                    Text(unlock.title).font(.headline.bold()).foregroundStyle(.yellow)
                    Text(unlock.recipeLine).font(.caption).foregroundStyle(.white)
                }
                .padding(.horizontal, 20).padding(.vertical, 13)
                .background(Color(red: 0.17, green: 0.13, blue: 0.09).opacity(0.95), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.yellow, lineWidth: 2))
            }
            if let type = store.placementType {
                VStack {
                    Spacer()
                    HStack(spacing: 12) {
                        Text("正在放置 \(store.itemName(type))")
                        Button("取消") { store.cancelPlacement() }
                        Button("放置") { store.performContextAction() }
                            .buttonStyle(.borderedProminent)
                    }
                    .padding()
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 90)
                }
            }
            if launchStage != "playing" {
                IslandLauncherView(
                    store: store,
                    loading: launchStage == "loading",
                    onContinue: { beginIsland() },
                    onNewWorld: { confirmingNewWorld = true }
                )
                .transition(.opacity)
            }
        }
        }
        .onAppear {
            scene.apply(state: store.save)
            store.setClockActive(scenePhase == .active && launchStage == "playing")
        }
        .task { await store.checkForUpdates() }
        .onReceive(store.$save) { scene.apply(state: $0) }
        .onChange(of: scenePhase) { phase in
            store.setClockActive(phase == .active && launchStage == "playing")
        }
        .onChange(of: launchStage) { stage in store.setClockActive(scenePhase == .active && stage == "playing") }
        .confirmationDialog("建立新的岛屿？", isPresented: $confirmingNewWorld, titleVisibility: .visible) {
            Button("确认新建", role: .destructive) {
                Task { await store.restartWorld(); beginIsland() }
            }
            Button("保留当前岛屿", role: .cancel) {}
        } message: { Text("当前岛屿、背包、建筑与日记会被替换。") }
        .sheet(isPresented: $store.isDiaryPresented) { DiaryBookView(store: store) }
        .sheet(isPresented: $store.isSettingsPresented) { PlayModeSettingsView(store: store) }
        .sheet(isPresented: $store.isMultiplayerPresented) { MultiplayerPanel(seed: store.save.seed) }
        .sheet(item: $store.activeCampSection) { section in CampPanelView(store: store, section: section) }
    }

    private func beginIsland() {
        withAnimation(.easeOut(duration: 0.2)) { launchStage = "loading" }
        Task {
            try? await Task.sleep(nanoseconds: 760_000_000)
            withAnimation(.easeInOut(duration: 0.24)) { launchStage = "playing" }
        }
    }
}

@MainActor
private struct IslandLauncherView: View {
    @ObservedObject var store: GameStore
    let loading: Bool
    let onContinue: () -> Void
    let onNewWorld: () -> Void
    private let paper = Color(red: 0.95, green: 0.91, blue: 0.79)
    private let amber = Color(red: 0.91, green: 0.66, blue: 0.16)
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.025, green: 0.11, blue: 0.10), Color(red: 0.06, green: 0.17, blue: 0.14)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 13) {
                Text("SURVIVAL DIARY").font(.caption2.bold()).tracking(3).foregroundStyle(amber)
                Text(loading ? "潮声渐近" : "生存日记").font(.system(size: 42, weight: .black, design: .serif)).foregroundStyle(paper)
                Text(loading ? "正在恢复天色、角色与营地状态……" : "岛屿没有写好的结局。先活下来，再决定这里会变成什么。")
                    .font(.subheadline).foregroundStyle(paper.opacity(0.72)).fixedSize(horizontal: false, vertical: true)
                if loading {
                    ProgressView().tint(amber).frame(maxWidth: .infinity)
                    Text("观察潮线、留意天色。你带走的每样东西都会改变下一步。")
                        .font(.caption).foregroundStyle(paper.opacity(0.52))
                } else {
                    Button(store.updateMessage) {
                        Task {
                            if store.hasPendingUpdate { await store.installPendingUpdate() }
                            else { await store.checkForUpdates() }
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.caption.bold())
                    .foregroundStyle(store.hasPendingUpdate ? amber : paper.opacity(0.62))
                    .disabled(store.isCheckingUpdate)
                    if store.hasExistingSave {
                        Text("本机存档 · 第 \(store.save.clock.day) 天 · 自动保存完好").font(.caption.bold()).foregroundStyle(amber.opacity(0.82))
                        launcherButton("继续岛屿", primary: true, action: onContinue)
                    }
                    launcherButton(store.hasExistingSave ? "新建岛屿" : "开始新游戏 · 引导模式 A", primary: false, action: store.hasExistingSave ? onNewWorld : {
                        Task { await store.restartWorld(); onContinue() }
                    })
                    Text("无需登录也能本地游玩；通行证用于联机与好友功能。").font(.caption2).foregroundStyle(paper.opacity(0.5))
                }
            }
            .padding(28).frame(maxWidth: 450, alignment: .leading)
            .background(Color.black.opacity(0.24), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(amber.opacity(0.35)))
            .padding(24)
        }
    }
    private func launcherButton(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.headline.bold()).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 15).frame(minHeight: 50) }
            .buttonStyle(.plain).foregroundStyle(paper)
            .background(primary ? Color(red: 0.13, green: 0.34, blue: 0.27) : Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(primary ? amber.opacity(0.75) : paper.opacity(0.2)))
    }
}

@MainActor
public struct PlayModeSettingsView: View {
    @ObservedObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingRestart = false
    public var body: some View {
        ZStack {
            Color(red: 0.075, green: 0.06, blue: 0.045).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                HStack { Image("time", bundle: .module).resizable().scaledToFit().frame(width: 36, height: 36); Text("暂停").font(.title2.bold()); Spacer(); Button("继续") { dismiss() }.buttonStyle(.borderedProminent).tint(.orange) }
                SettingsField("游玩方式") {
                    Picker("游玩模式", selection: Binding(get: { store.save.playMode }, set: { store.setPlayMode($0) })) {
                    Text("引导模式 A").tag(PlayMode.guided); Text("自由模式 B").tag(PlayMode.free)
                    }.pickerStyle(.segmented)
                    Text("切换不会重置世界、建筑、物品或日记。").font(.caption).foregroundStyle(.secondary)
                }
                SettingsField("版本更新") {
                    Button(store.updateMessage) {
                        Task {
                            if store.hasPendingUpdate { await store.installPendingUpdate() }
                            else { await store.checkForUpdates() }
                        }
                    }
                    .disabled(store.isCheckingUpdate)
                    Text("联网版启动时自动检查；macOS 下载到 Downloads 并交给系统安装器，iOS 使用系统支持的安装入口。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                SettingsField("好友与公共岛") {
                    Button("打开公共岛与聊天") { dismiss(); store.isMultiplayerPresented = true }
                    Text("只有公共岛状态和聊天会联网；私人日记仍保存在本机。").font(.caption).foregroundStyle(.secondary)
                }
                SettingsField("世界存档") {
                    Text("应用会自动继续上次的岛屿。重新开始会永久删除当前背包、建筑和日记。")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("重新开始", role: .destructive) { confirmingRestart = true }
                }
                Spacer()
            }.padding(16).foregroundStyle(Color(red: 0.95, green: 0.91, blue: 0.79))
        }.preferredColorScheme(.dark)
        .confirmationDialog("确认重新开始？", isPresented: $confirmingRestart, titleVisibility: .visible) {
            Button("确认删除并重新开始", role: .destructive) {
                Task { await store.restartWorld(); dismiss() }
            }
            Button("保留当前世界", role: .cancel) {}
        } message: {
            Text("当前岛屿、背包、建筑、任务和日记都会被永久删除。")
        }
    }
}

private struct SettingsField<Content: View>: View {
    let title: String; @ViewBuilder let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View { VStack(alignment: .leading, spacing: 8) { Text(title).font(.headline).foregroundStyle(.yellow.opacity(0.82)); content }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 5)) }
}
