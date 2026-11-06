import SwiftUI
import SurvivalDiaryOnline

@MainActor
private final class MultiplayerPanelModel: ObservableObject {
    @Published var islands: [PublicIsland] = []
    @Published var loading = false
    @Published var errorMessage: String?
    let socket = IslandSocketClient()
    private let api = SurvivalAPI(baseURL: URL(string: "https://survival-diary.zhengzhengstudio.cn")!)
    private var ready = false

    func prepare() async {
        guard !ready else { return }
        loading = true
        do {
            let defaults = UserDefaults.standard
            let key = "survival-diary-device-id"
            let deviceID = defaults.string(forKey: key) ?? "apple-\(UUID().uuidString)"
            defaults.set(deviceID, forKey: key)
            _ = try await api.createGuestSession(deviceID: deviceID)
            ready = true
            try await refresh()
        } catch { errorMessage = error.localizedDescription }
        loading = false
    }

    func refresh() async throws { islands = try await api.listPublicIslands() }
    func create(seed: String) async {
        do { let island = try await api.ensurePublicIsland(seed: seed); try await join(island) }
        catch { errorMessage = error.localizedDescription }
    }
    func join(_ island: PublicIsland) async throws {
        try await api.visitIsland(island.id)
        try await socket.join(api: api, islandID: island.id)
    }
}

public struct MultiplayerPanel: View {
    public let seed: String
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = MultiplayerPanelModel()
    @State private var draft = ""

    public init(seed: String) { self.seed = seed }

    public var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text(statusText).font(.subheadline).foregroundStyle(model.socket.phase == .online ? .green : .secondary)
                if let error = model.errorMessage ?? model.socket.errorMessage { Text(error).font(.caption).foregroundStyle(.red) }
                if model.socket.phase == .online {
                    Text("岛屿聊天").font(.headline)
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 7) {
                            ForEach(model.socket.messages) { message in Text("\(String(message.uid.prefix(12)))：\(message.text)").frame(maxWidth: .infinity, alignment: .leading) }
                        }
                    }
                    HStack {
                        TextField("输入岛屿消息", text: $draft).textFieldStyle(.roundedBorder)
                        Button("发送") { let value = draft; draft = ""; Task { try? await model.socket.send(value) } }.disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Button("退出联机", role: .destructive) { model.socket.leave() }
                } else {
                    Button("创建公共岛") { Task { await model.create(seed: seed) } }.buttonStyle(.borderedProminent)
                    Button("刷新公共岛") { Task { try? await model.refresh() } }.disabled(model.loading)
                    List(model.islands) { island in
                        HStack {
                            VStack(alignment: .leading) { Text(island.displayName); Text("\(island.members.count) / 4").font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button("加入") { Task { try? await model.join(island) } }.disabled(island.members.count >= 4)
                        }
                    }
                }
            }
            .padding()
            .navigationTitle("公共岛")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("返回岛上") { dismiss() } } }
            .task { await model.prepare() }
            .onDisappear { model.socket.leave() }
        }
    }

    private var statusText: String {
        switch model.socket.phase {
        case .local: return "当前为本地游玩 · 私人日记不会上传"
        case .connecting: return "正在加入公共岛"
        case .online: return "已连接 \(model.socket.islandID) · 世界版本 \(model.socket.revision)"
        case .reconnecting: return "连接中断，正在恢复公共岛"
        case .offline: return "公共岛暂时离线"
        }
    }
}
