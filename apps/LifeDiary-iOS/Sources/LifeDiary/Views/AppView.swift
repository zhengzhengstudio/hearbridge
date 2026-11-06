import SwiftUI
import LifeDiaryCore

@MainActor
final class LifeAppState: ObservableObject {
    @Published private(set) var repository: LifeRepository?
    @Published private(set) var loadFailure: RepositoryLoadFailure?
    @Published private(set) var revision = 0
    @Published private(set) var isSyncing = false
    @Published private(set) var syncNotice: String?
    @Published var minorPromptPresented = false
    @Published private(set) var minorPromptError: String?

    let passport: PassportSession
    let onlineClient: LifeOnlineClient
    let communityPublisher: CommunityPublisher?
    let minorPrompt: MinorPromptCoordinator?
    private let tokenStore: AuthTokenStore

    init() {
        let tokenStore = AuthTokenStore()
        self.tokenStore = tokenStore
        passport = PassportSession(tokenStore: tokenStore)
        onlineClient = LifeOnlineClient(
            baseURL: URL(string: "https://life.zhengzhengstudio.cn")!,
            accessToken: { [tokenStore] in try tokenStore.load()?.accessToken }
        )
        communityPublisher = try? CommunityPublisher(
            store: ApplicationSupportCommunityPublicationStore(),
            client: onlineClient
        )
        minorPrompt = try? MinorPromptCoordinator(store: UserDefaultsMinorPromptStore())
        passport.onMinorLoginResult = { [weak self] accountID, isMinor in
            self?.handleMinorLoginEvent(accountID: accountID, isMinor: isMinor)
        }
        loadRepository()
    }

    var entries: [DiaryEntry] {
        _ = revision
        return repository?.entries.sorted { $0.updatedAt > $1.updatedAt } ?? []
    }

    var syncState: SyncState {
        _ = revision
        return repository?.syncState ?? .failed
    }

    func loadRepository() {
        do {
            let store = try ApplicationSupportDiaryStore()
            let api = LifeAPIClient(
                baseURL: URL(string: "https://life.zhengzhengstudio.cn")!,
                accessToken: { [tokenStore] in try tokenStore.load()?.accessToken }
            )
            repository = try LifeRepository(store: store, api: api)
            loadFailure = nil
            revision += 1
            Task { await retryPendingSync(showCompletion: false) }
        } catch {
            repository = nil
            loadFailure = RepositoryLoadFailure(underlying: error)
        }
    }

    func save(_ entry: DiaryEntry) async throws {
        guard let repository else { throw LifeAppStateError.readOnly }
        isSyncing = true
        defer { isSyncing = false }
        revision += 1
        try await repository.save(entry: entry)
        revision += 1
    }

    func delete(_ entry: DiaryEntry) async throws {
        guard let repository else { throw LifeAppStateError.readOnly }
        isSyncing = true
        defer { isSyncing = false }
        revision += 1
        try await repository.deleteEntry(id: entry.id)
        revision += 1
    }

    @discardableResult
    func publish(_ draft: CommunityDraft) async throws -> CommunityPublication {
        guard let communityPublisher else { throw LifeAppStateError.communityStoreUnavailable }
        return try await communityPublisher.publish(draft)
    }

    func retryCommunityPublications() async {
        try? await communityPublisher?.retryPending()
        revision += 1
    }

    func retryPendingSync(showCompletion: Bool = true) async {
        guard let repository, !isSyncing else { return }
        isSyncing = true
        syncNotice = nil
        revision += 1
        await repository.resumePendingSync()
        revision += 1
        isSyncing = false
        if showCompletion {
            switch repository.syncState {
            case .idle: syncNotice = "同步已完成。"
            case .pending: syncNotice = "仍有更改等待联网同步。"
            case .failed: syncNotice = "同步暂停，本地记录仍然安全。"
            case .syncing: syncNotice = nil
            }
        }
    }

    func completeOfflineAgeProfile(isMinor: Bool) {
        applyMinorAction(presentAfter: true) {
            try $0.completeOfflineAgeProfile(isMinor: isMinor)
        }
    }

    func remindMinorLater() { applyMinorAction { try $0.remindLater() } }
    func suppressMinorForSevenDays() { applyMinorAction { try $0.suppressForSevenDays() } }
    func suppressMinorPermanently() { applyMinorAction { try $0.suppressPermanently() } }
    func restoreMinorPrompts() { applyMinorAction(presentAfter: false) { try $0.restorePrompts() } }

    private func handleMinorLoginEvent(accountID: String, isMinor: Bool) {
        applyMinorAction(presentAfter: true) {
            try $0.handleMinorLoginResult(accountID: accountID, isMinor: isMinor)
        }
    }

    private func applyMinorAction(
        presentAfter: Bool = false,
        _ action: (MinorPromptCoordinator) throws -> Void
    ) {
        guard let minorPrompt else {
            minorPromptError = "未能读取提示设置。"
            return
        }
        do {
            try action(minorPrompt)
            minorPromptError = nil
            minorPromptPresented = presentAfter && minorPrompt.shouldPresent()
        } catch {
            minorPromptError = error.localizedDescription
        }
    }
}

struct RepositoryLoadFailure: Identifiable {
    let id = UUID()
    let detail: String

    init(underlying error: Error) {
        detail = error.localizedDescription
    }
}

enum LifeAppStateError: LocalizedError {
    case readOnly
    case communityStoreUnavailable

    var errorDescription: String? {
        switch self {
        case .readOnly: return "本地日记尚未恢复，当前不能写入。"
        case .communityStoreUnavailable: return "社区发布队列无法读取；为避免丢失记录，当前不能发布。"
        }
    }
}

@MainActor
struct AppView: View {
    @EnvironmentObject private var updates: UpdateService
    @StateObject private var appState = LifeAppState()
    @State private var selectedTab: AppTab = .today
    @State private var todayPath = NavigationPath()
    @State private var diaryPath = NavigationPath()
    @State private var communityPath = NavigationPath()
    @State private var ledgerPath = NavigationPath()
    @State private var companionPath = NavigationPath()
    @State private var profilePath = NavigationPath()
    @State private var recoverySheet: RecoverySheet?

    var body: some View {
        Group {
            if appState.repository != nil {
                nativeTabs
            } else {
                repositoryFailure
            }
        }
        .tint(LifeDiaryDesignTokens.moss)
        .alert(item: $updates.availableUpdate) { update in
            Alert(
                title: Text("生活日记 \(update.version) 可更新"),
                message: Text(update.notes.isEmpty ? "将前往官方安装页面，由系统完成更新。" : update.notes),
                primaryButton: .default(Text("前往更新")) { updates.open(update) },
                secondaryButton: .cancel(Text("稍后"))
            )
        }
        .sheet(isPresented: $appState.minorPromptPresented) {
            MinorSafetyPromptView(
                remindLater: {
                    appState.remindMinorLater()
                    appState.minorPromptPresented = false
                },
                suppressForSevenDays: {
                    appState.suppressMinorForSevenDays()
                    appState.minorPromptPresented = false
                },
                suppressPermanently: {
                    appState.suppressMinorPermanently()
                    appState.minorPromptPresented = false
                }
            )
        }
    }

    private var nativeTabs: some View {
        VStack(spacing: 0) {
            selectedContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            LifeTabRail(selection: $selectedTab)
        }
        .background(LifeDiaryDesignTokens.paper)
    }

    @ViewBuilder
    private var selectedContent: some View {
        switch selectedTab {
        case .today:
            NavigationStack(path: $todayPath) {
                TodayView(repository: appState)
            }
            .accessibilityLabel(AppTab.today.accessibilityTitle)
        case .diary:
            NavigationStack(path: $diaryPath) {
                DiaryTimelineView(repository: appState)
            }
            .privacySensitive()
            .accessibilityLabel(AppTab.diary.accessibilityTitle)
        case .community:
            NavigationStack(path: $communityPath) {
                ConnectionsView(repository: appState)
            }
            .accessibilityLabel(AppTab.community.accessibilityTitle)
        case .ledger:
            NavigationStack(path: $ledgerPath) {
                LedgerView(repository: appState)
            }
            .privacySensitive()
            .accessibilityLabel(AppTab.ledger.accessibilityTitle)
        case .companion:
            NavigationStack(path: $companionPath) {
                CompanionView(repository: appState)
            }
            .accessibilityLabel(AppTab.companion.accessibilityTitle)
        case .profile:
            NavigationStack(path: $profilePath) {
                ProfileView(repository: appState)
            }
            .privacySensitive()
            .accessibilityLabel(AppTab.profile.accessibilityTitle)
        }
    }

    private var repositoryFailure: some View {
        NavigationStack {
            VStack(spacing: 20) {
                LifeEmptyState(
                    symbol: "exclamationmark.triangle",
                    title: "无法打开本地日记",
                    message: "为避免覆盖原有记录，生活日记没有创建新的空仓库。恢复前保持只读。"
                )
                Button("重新尝试读取") {
                    appState.loadRepository()
                }
                .buttonStyle(.borderedProminent)
                Button("查看恢复与只读说明") {
                    recoverySheet = .help
                }
                .buttonStyle(.bordered)
                if let detail = appState.loadFailure?.detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .padding(.horizontal)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .lifePaperBackground()
            .navigationTitle("日记恢复")
            .sheet(item: $recoverySheet) { _ in
                NavigationStack {
                    List {
                        Section("当前状态") {
                            Label("只读保护已开启", systemImage: "lock")
                            Text("应用不会清空、迁移或覆盖无法读取的本地文件。")
                        }
                        Section("建议") {
                            Text("请先保留设备备份，再重新打开应用或联系支持。")
                            Link(
                                "访问生活日记网站",
                                destination: URL(string: "https://life.zhengzhengstudio.cn")!
                            )
                        }
                    }
                    .lifePaperBackground()
                    .navigationTitle("恢复说明")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
    }
}

private struct LifeTabRail: View {
    @Binding var selection: AppTab

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(AppTab.allCases) { tab in
                    Button {
                        withAnimation(.easeOut(duration: 0.18)) { selection = tab }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: tab.icon).font(.system(size: 16, weight: .semibold))
                            Text(tab.title).font(.caption2.weight(.medium)).lineLimit(1)
                        }
                        .foregroundStyle(selection == tab ? Color.white : LifeDiaryDesignTokens.charcoal)
                        .frame(minWidth: 54)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 5)
                        .background(selection == tab ? LifeDiaryDesignTokens.moss : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tab.accessibilityTitle)
                    .accessibilityAddTraits(selection == tab ? .isSelected : [])
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(LifeDiaryDesignTokens.paper)
        .overlay(alignment: .top) { Rectangle().fill(LifeDiaryDesignTokens.moss.opacity(0.12)).frame(height: 1) }
    }
}

private struct MinorSafetyPromptView: View {
    let remindLater: () -> Void
    let suppressForSevenDays: () -> Void
    let suppressPermanently: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("保护好真实姓名、学校、住址与实时位置。", systemImage: "hand.raised")
                    Label("遇到让你不安的内容，可以离开、举报并告诉可信任的成年人。", systemImage: "person.2")
                    Label("AI 陪伴不能替代家人、老师或专业支持。", systemImage: "sparkles")
                } header: {
                    Text("给未成年使用者的安全提醒")
                }
                Section {
                    Button("稍后提醒") { remindLater() }
                    Button("7 天内不再提示") { suppressForSevenDays() }
                    Button("永久不再提示", role: .destructive) { suppressPermanently() }
                }
            }
            .lifePaperBackground()
            .navigationTitle("安全提醒")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private enum RecoverySheet: String, Identifiable {
    case help
    var id: String { rawValue }
}
