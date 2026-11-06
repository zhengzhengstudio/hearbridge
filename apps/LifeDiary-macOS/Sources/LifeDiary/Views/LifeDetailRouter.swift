import AppKit
import SwiftUI

struct LifeDetailRouter: View {
    let section: LifeSection
    let entryID: UUID?
    @ObservedObject var repository: LifeRepository
    let api: LifeAPIClient
    @ObservedObject var passport: PassportSession
    @ObservedObject var health: HealthSettingsStore
    let communityOutbox: CommunityOutbox?

    private var entry: DiaryEntry? { repository.entries.first { $0.id == entryID } }

    @ViewBuilder
    var body: some View {
        switch section {
        case .today:
            TodayView(entries: repository.entries)
        case .diary:
            if let entry { EntryDetailView(entry: entry, repository: repository) }
            else { EmptyDetail(title: "选择一页日记", icon: "book.pages") }
        case .health:
            HealthView(store: health)
        case .ledger:
            LedgerView(api: api)
        case .community, .friends, .messages:
            ConnectionsView(section: section, selectedEntry: entry, api: api, passport: passport, outbox: communityOutbox)
        case .companion:
            CompanionView(entries: repository.entries, api: api, passport: passport)
        case .passport:
            PassportView(passport: passport)
        }
    }
}

private struct TodayView: View {
    let entries: [DiaryEntry]
    var body: some View {
        PaperPage {
            VStack(alignment: .leading, spacing: 20) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).month().day())).font(.title3).foregroundStyle(.secondary)
                Text("给今天留一点位置").font(.system(size: 34, weight: .semibold))
                Text("这里首先是一间安静的本地书房。日记写入磁盘后才会尝试同步；公开到社区永远需要另行确认。")
                    .font(.title3).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Divider()
                Label("本机已有 \(entries.count) 篇记录", systemImage: "internaldrive")
                MacDailyToolsView()
                if let latest = entries.sorted(by: { $0.updatedAt > $1.updatedAt }).first {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("最近书写").font(.caption).foregroundStyle(.secondary)
                        Text(latest.title).font(.headline)
                        Text(latest.body).lineLimit(4).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct MacDailyToolsView: View {
    @AppStorage("lifediary.today.plans") private var plans = ""
    @AppStorage("lifediary.today.schedule") private var schedule = ""
    @AppStorage("lifediary.today.meals") private var meals = ""
    @State private var tool = 0
    @State private var input = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("今天的工具").font(.headline)
            Picker("工具", selection: $tool) { Text("计划").tag(0); Text("课程表").tag(1); Text("饮食").tag(2) }.pickerStyle(.segmented)
            HStack { TextField(placeholder, text: $input); Button("添加", action: add).disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            if items.isEmpty { Text("今天还没有这类记录。").foregroundStyle(.secondary) }
            ForEach(Array(items.enumerated()), id: \.offset) { index, value in
                HStack { Text(value); Spacer(); Button("删除") { remove(index) }.buttonStyle(.borderless) }
            }
            if tool == 2 { Text("饮食记录用于观察规律，不替代医疗或营养建议。").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(14).background(.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
    private var placeholder: String { tool == 0 ? "添加要做的事" : tool == 1 ? "例如：08:00 数学" : "这一餐吃了什么" }
    private var current: String { get { tool == 0 ? plans : tool == 1 ? schedule : meals } nonmutating set { if tool == 0 { plans = newValue } else if tool == 1 { schedule = newValue } else { meals = newValue } } }
    private var items: [String] { current.split(separator: "\n").map(String.init).filter { !$0.isEmpty } }
    private func add() { var next = items; next.append(input.trimmingCharacters(in: .whitespacesAndNewlines)); current = next.joined(separator: "\n"); input = "" }
    private func remove(_ index: Int) { var next = items; next.remove(at: index); current = next.joined(separator: "\n") }
}

struct EmptyDetail: View {
    let title: String
    let icon: String
    var body: some View {
        NativeEmptyState(title: title, icon: icon, detail: "从中间一栏选择内容，或用 ⌘N 新建记录。")
    }
}

private struct HealthView: View {
    @ObservedObject var store: HealthSettingsStore
    var body: some View {
        PaperPage {
            VStack(alignment: .leading, spacing: 20) {
                Text("健康记录").font(.system(size: 30, weight: .semibold))
                Text("这些设置只保存在本机，不会随日记正文公开。").foregroundStyle(.secondary)
                Toggle("启用生理周期工具", isOn: binding(\.periodEnabled))
                if store.settings.periodEnabled {
                    DatePicker("最近开始日期", selection: optionalDate(\.latestPeriodStart), displayedComponents: .date)
                    Stepper("周期长度：\(store.settings.cycleLength) 天", value: binding(\.cycleLength), in: 1...90)
                    if let date = PeriodPrediction.nextStart(latest: store.settings.latestPeriodStart, cycleLength: store.settings.cycleLength) {
                        Label("预计下次：\(date.formatted(date: .abbreviated, time: .omitted))", systemImage: "calendar")
                    }
                }
                Divider()
                Toggle("启用戒烟记录", isOn: binding(\.smokingEnabled))
                if store.settings.smokingEnabled {
                    DatePicker("开始日期", selection: optionalDate(\.smokeFreeStartedAt), displayedComponents: .date)
                    Stepper("此前每天：\(store.settings.cigarettesPerDay) 支", value: binding(\.cigarettesPerDay), in: 0...100)
                    Stepper("每包价格：¥\(store.settings.pricePerPack)", value: binding(\.pricePerPack), in: 0...500)
                    if let start = store.settings.smokeFreeStartedAt {
                        let stats = SmokingStatistics.make(startedAt: start, asOf: .now, cigarettesPerDay: store.settings.cigarettesPerDay, pricePerPack: store.settings.pricePerPack)
                        Text("已坚持 \(stats.daysSmokeFree) 天 · 少吸 \(stats.cigarettesAvoided) 支 · 节省 ¥\(stats.moneySaved)")
                    }
                }
            }
        }
    }

    private func binding<Value>(_ path: WritableKeyPath<HealthToolSettings, Value>) -> Binding<Value> {
        Binding(get: { store.settings[keyPath: path] }, set: { store.settings[keyPath: path] = $0 })
    }

    private func optionalDate(_ path: WritableKeyPath<HealthToolSettings, Date?>) -> Binding<Date> {
        Binding(get: { store.settings[keyPath: path] ?? .now }, set: { store.settings[keyPath: path] = $0 })
    }
}

private struct PassportView: View {
    @ObservedObject var passport: PassportSession
    @State private var signOutError: String?
    var body: some View {
        PaperPage {
            VStack(alignment: .leading, spacing: 18) {
                Text("铮铮通行证").font(.system(size: 30, weight: .semibold))
                Text("社区、好友、消息和陪伴功能需要登录。授权会在系统浏览器会话中完成，应用不会嵌入网页。")
                    .foregroundStyle(.secondary)
                if let account = passport.accountID {
                    Label("已登录：\(account)", systemImage: "checkmark.seal.fill").foregroundStyle(LifeDiaryDesignTokens.moss)
                    Button("退出登录", role: .destructive) {
                        do { try passport.signOut(); signOutError = nil }
                        catch { signOutError = "无法清除本机凭据：\(error.localizedDescription)" }
                    }
                } else {
                    Button("登录铮铮通行证") { passport.beginAuthorization(anchor: NSApp.keyWindow) }
                        .disabled(passport.authorizationStatus == .authorizing)
                        .buttonStyle(.borderedProminent)
                }
                if case .authorizing = passport.authorizationStatus {
                    ProgressView("等待浏览器授权…")
                    Button("取消登录", role: .cancel) { passport.cancelAuthorization() }
                }
                if passport.authorizationError != nil { Text("登录未完成，请检查网络或重试。").foregroundStyle(.red) }
                if let signOutError { Text(signOutError).foregroundStyle(.red) }
                Button("在浏览器打开生活日记网站") {
                    NSWorkspace.shared.open(URL(string: "https://life.zhengzhengstudio.cn")!)
                }
            }
        }
    }
}
