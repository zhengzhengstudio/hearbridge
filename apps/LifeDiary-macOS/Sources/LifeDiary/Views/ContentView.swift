import AppKit
import SwiftUI

@MainActor
final class LifeAppModel: ObservableObject {
    let tokenStore: AuthTokenStore
    let api: LifeAPIClient
    let passport: PassportSession
    let health = HealthSettingsStore()
    let minor: MinorPromptCoordinator?
    let repository: LifeRepository?
    let communityOutbox: CommunityOutbox?
    private let authenticator: DeviceAuthenticating
    @Published var startupError: String?
    @Published var isLocked = false
    @Published var lockError: String?
    @Published var showMinorPrompt = false

    init(repository injectedRepository: LifeRepository? = nil, authenticator: DeviceAuthenticating = DeviceOwnerAuthenticator()) {
        self.authenticator = authenticator
        let tokens = AuthTokenStore()
        tokenStore = tokens
        api = LifeAPIClient(accessToken: { try tokens.load()?.accessToken })
        passport = PassportSession(tokenStore: tokens)
        minor = try? MinorPromptCoordinator(store: UserDefaultsMinorPromptStore())
        if let injectedRepository { repository = injectedRepository }
        else {
            do { repository = try LifeRepository(store: ApplicationSupportDiaryStore(), api: api) }
            catch { repository = nil; startupError = "无法打开本地日记：\(error.localizedDescription)" }
        }
        do { communityOutbox = try CommunityOutbox(store: ApplicationSupportCommunityOutboxStore()) }
        catch { communityOutbox = nil; startupError = startupError ?? "无法打开社区发布队列：\(error.localizedDescription)" }
        passport.onMinorLoginResult = { [weak self] accountID, isMinor in
            guard let self, let minor = self.minor else { return }
            try? minor.handleMinorLoginResult(accountID: accountID, isMinor: isMinor)
            self.showMinorPrompt = minor.shouldPresent()
            Task { await self.repository?.sync() }
        }
        passport.onAuthenticated = { [weak self] in Task { await self?.repository?.sync() } }
        showMinorPrompt = minor?.shouldPresent() ?? false
        if let repository { Task { await repository.sync() } }
    }

    func lock() {
        lockError = nil
        isLocked = true
    }

    func unlock() async {
        do {
            guard try await authenticator.authenticate(reason: "解锁生活日记") else {
                lockError = "未能验证设备所有者，日记仍保持锁定。"
                return
            }
            lockError = nil
            isLocked = false
        } catch {
            lockError = "无法解锁：\(error.localizedDescription)"
        }
    }

    func dismissMinorPrompt(_ choice: MinorPromptChoice) {
        guard let minor else { showMinorPrompt = false; return }
        switch choice {
        case .later: try? minor.remindLater()
        case .sevenDays: try? minor.suppressForSevenDays()
        case .never: try? minor.suppressPermanently()
        }
        showMinorPrompt = false
    }
}

enum MinorPromptChoice { case later, sevenDays, never }

struct ContentView: View {
    @EnvironmentObject private var updates: UpdateService
    @ObservedObject var model: LifeAppModel
    @SceneStorage("life.section") private var sectionID = LifeSection.today.rawValue
    @SceneStorage("life.entry") private var entryID = ""
    @State private var query = ""
    @State private var exportError: String?
    @State private var actionError: String?

    private var section: LifeSection {
        get { LifeSection(rawValue: sectionID) ?? .today }
        nonmutating set { sectionID = newValue.rawValue }
    }
    private var sectionBinding: Binding<LifeSection?> {
        Binding(get: { section }, set: { if let value = $0 { section = value } })
    }
    private var entryBinding: Binding<UUID?> {
        Binding(get: { UUID(uuidString: entryID) }, set: { entryID = $0?.uuidString ?? "" })
    }

    var body: some View {
        Group {
            if model.isLocked {
                LockedView(errorText: model.lockError) { await model.unlock() }
            } else if let repository = model.repository {
                MacLifeWorkspace {
                    SidebarView(selection: sectionBinding)
                } list: {
                    VStack(spacing: 0) {
                        MacSearchField(text: $query)
                        EntryListView(section: section, repository: repository, selection: entryBinding, query: query)
                    }
                } detail: {
                    LifeDetailRouter(
                        section: section,
                        entryID: entryBinding.wrappedValue,
                        repository: repository,
                        api: model.api,
                        passport: model.passport,
                        health: model.health,
                        communityOutbox: model.communityOutbox
                    )
                } actions: {
                    Button(action: newEntry) { Label("新建记录", systemImage: "square.and.pencil") }
                    Button(action: openWebsite) { Label("打开网站", systemImage: "safari") }
                }
                .privacySensitive(section == .diary || section == .health || section == .ledger || section == .passport)
                .tint(LifeDiaryDesignTokens.moss)
            } else {
                NativeEmptyState(title: "无法打开本地日记", icon: "exclamationmark.triangle", detail: model.startupError ?? "请检查磁盘权限。")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .newDiaryEntry)) { _ in newEntry() }
        .onReceive(NotificationCenter.default.publisher(for: .focusDiarySearch)) { _ in
            section = .diary
            DispatchQueue.main.async { _ = SearchFieldFocuser.focus(in: NSApp.keyWindow) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .exportDiary)) { _ in exportDiary() }
        .onReceive(NotificationCenter.default.publisher(for: .lockDiary)) { _ in model.lock() }
        .onReceive(NotificationCenter.default.publisher(for: .checkLifeDiaryUpdates)) { _ in Task { await updates.check(userInitiated: true) } }
        .overlay(alignment: .top) {
            if let progress = updates.downloadProgress { MacUpdateProgress(progress: progress) }
        }
        .alert(item: $updates.availableUpdate) { update in
            Alert(
                title: Text("生活日记 \(update.version) 可更新"),
                message: Text(update.notes.isEmpty ? "将下载到 Downloads，校验后打开系统安装器。" : update.notes),
                primaryButton: .default(Text("下载并安装")) { Task { await updates.downloadAndOpen(update) } },
                secondaryButton: .cancel(Text("稍后"))
            )
        }
        .alert("导出失败", isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })) {
            Button("好", role: .cancel) {}
        } message: { Text(exportError ?? "") }
        .alert("操作未完成", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("好", role: .cancel) {}
        } message: { Text(actionError ?? "") }
        .alert("更新", isPresented: Binding(
            get: { updates.lastError != nil || updates.statusMessage != nil },
            set: { if !$0 { updates.lastError = nil; updates.statusMessage = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: { Text(updates.lastError ?? updates.statusMessage ?? "") }
        .alert("未成年人保护设置", isPresented: $model.showMinorPrompt) {
            Button("稍后") { model.dismissMinorPrompt(.later) }
            Button("7 天内不再提示") { model.dismissMinorPrompt(.sevenDays) }
            Button("不再提示") { model.dismissMinorPrompt(.never) }
        } message: {
            Text("你可以在设置中管理提醒。日记内容不会因此自动公开。")
        }
    }

    private func newEntry() {
        guard let repository = model.repository else { return }
        let entry = DiaryEntry(title: "未命名记录", body: "")
        Task {
            do {
                try await repository.save(entry: entry)
                section = .diary
                entryBinding.wrappedValue = entry.id
            } catch {
                actionError = "新建记录未写入磁盘：\(error.localizedDescription)"
            }
        }
    }

    private func exportDiary() {
        guard let repository = model.repository else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "生活日记备份.json"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try repository.exportData().write(to: url, options: .atomic) }
        catch { exportError = error.localizedDescription }
    }

    private func openWebsite() {
        NSWorkspace.shared.open(URL(string: "https://life.zhengzhengstudio.cn")!)
    }
}

private struct MacUpdateProgress: View {
    let progress: Double
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("正在并发下载更新").font(.caption.weight(.semibold))
                Spacer()
                Text("\(Int(progress * 100))%").font(.caption.monospacedDigit()).foregroundStyle(LifeDiaryDesignTokens.moss)
            }.padding(.horizontal, 14).padding(.vertical, 8)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Color(nsColor: .separatorColor).opacity(0.35)
                    LifeDiaryDesignTokens.moss.frame(width: proxy.size.width * progress)
                }
            }.frame(height: 3)
        }
        .background(LifeDiaryDesignTokens.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, 12).padding(.top, 8)
        .shadow(color: LifeDiaryDesignTokens.moss.opacity(0.12), radius: 14, y: 5)
    }
}

private struct MacLifeWorkspace<Sidebar: View, ListPane: View, Detail: View, Actions: View>: View {
    @ViewBuilder let sidebar: Sidebar
    @ViewBuilder let list: ListPane
    @ViewBuilder let detail: Detail
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("生活日记").font(.headline.weight(.bold)).foregroundStyle(LifeDiaryDesignTokens.moss)
                Spacer()
                HStack(spacing: 8) { actions }
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 16).frame(height: 48)
            .background(LifeDiaryDesignTokens.paper)
            Rectangle().fill(LifeDiaryDesignTokens.moss.opacity(0.12)).frame(height: 1)
            HStack(spacing: 0) {
                sidebar.frame(width: 190)
                Rectangle().fill(LifeDiaryDesignTokens.moss.opacity(0.10)).frame(width: 1)
                list.frame(minWidth: 260, idealWidth: 320, maxWidth: 380)
                Rectangle().fill(LifeDiaryDesignTokens.moss.opacity(0.10)).frame(width: 1)
                detail.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

private struct MacSearchField: View {
    @Binding var text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(LifeDiaryDesignTokens.moss)
            TextField("搜索个人日记", text: $text).textFieldStyle(.plain)
            if !text.isEmpty { Button { text = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain) }
        }
        .padding(.horizontal, 11).frame(height: 36)
        .background(LifeDiaryDesignTokens.moss.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(10)
    }
}

struct NativeEmptyState: View {
    let title: String
    let icon: String
    let detail: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 34)).foregroundStyle(.secondary)
            Text(title).font(.title3.weight(.semibold))
            Text(detail).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

private struct LockedView: View {
    let errorText: String?
    let unlock: () async -> Void
    @State private var isAuthenticating = false
    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "lock.fill").font(.system(size: 42)).foregroundStyle(LifeDiaryDesignTokens.moss)
            Text("生活日记已锁定").font(.title2.weight(.semibold))
            Text("本地内容仍安全保存在这台 Mac。解锁需要 Mac 登录密码或生物识别。")
                .foregroundStyle(.secondary)
            if let errorText { Text(errorText).foregroundStyle(.red).multilineTextAlignment(.center) }
            Button(isAuthenticating ? "正在验证…" : "验证并解锁") {
                isAuthenticating = true
                Task { await unlock(); isAuthenticating = false }
            }
            .disabled(isAuthenticating)
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
