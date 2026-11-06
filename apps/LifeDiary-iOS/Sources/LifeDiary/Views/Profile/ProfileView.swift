import SwiftUI
import LifeDiaryCore

struct ProfileView: View {
    @ObservedObject var repository: LifeAppState
    @EnvironmentObject private var updates: UpdateService
    @StateObject private var health = HealthSettingsModel()

    var body: some View {
        Form {
            Section("铮铮通行证") {
                PassportControlsView(passport: repository.passport)
            }

            Section("健康工具") {
                NavigationLink {
                    HealthToolsView(model: health)
                } label: {
                    Label("经期记录与戒烟日记", systemImage: "heart.text.square")
                }
                Text("所有工具都由本人主动开启，不依据性别显示或限制。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("提示与隐私") {
                NavigationLink {
                    MinorNoticeSettingsView(repository: repository)
                } label: {
                    Label("未成年人提示设置", systemImage: "exclamationmark.shield")
                }
            }

            Section("关于与支持") {
                Link(destination: URL(string: "https://life.zhengzhengstudio.cn")!) {
                    Label("生活日记网站", systemImage: "safari")
                }
                Link(destination: URL(string: "https://zhengzhengstudio.cn/privacy.html")!) {
                    Label("隐私说明", systemImage: "hand.raised")
                }
                Button {
                    Task { await updates.check(userInitiated: true) }
                } label: {
                    if updates.isChecking {
                        HStack { ProgressView(); Text("正在检查更新") }
                    } else {
                        Label("检查更新", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
                .disabled(updates.isChecking)
                if let status = updates.statusMessage {
                    Text(status).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityLabel("更新检查结果：\(status)")
                }
                if let error = updates.errorMessage {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(.footnote).foregroundStyle(.red)
                }
            }
        }
        .lifePaperBackground()
        .navigationTitle("我的")
    }
}

private struct PassportControlsView: View {
    @ObservedObject var passport: PassportSession

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let accountID = passport.accountID {
                LabeledContent("当前账号", value: accountID)
                Label("通行证已连接", systemImage: "checkmark.circle")
                    .foregroundStyle(.secondary)
            } else if passport.authorizationStatus == .authorizing {
                HStack { ProgressView(); Text("正在等待系统认证") }
                Button("取消登录", role: .cancel) { passport.cancelAuthorization() }
            } else {
                Button {
                    passport.beginAuthorization()
                } label: {
                    Label("登录或注册铮铮通行证", systemImage: "person.badge.key")
                }
            }
            if let error = passport.authorizationError {
                Label(errorText(error), systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundColor(error == .cancelled ? Color.secondary : Color.red)
                if error != .cancelled {
                    Button("重新登录") { passport.beginAuthorization() }
                }
            }
            Text("登录通过系统认证会话完成，不在应用内嵌网页。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func errorText(_ error: PassportAuthorizationError) -> String {
        switch error {
        case .invalidCallback: return "登录回调验证失败，请重新登录。"
        case .unavailable: return "系统认证会话未能启动。"
        case .cancelled: return "已取消登录。"
        case .exchangeFailed: return "通行证暂时无法完成登录，请稍后重试。"
        }
    }
}

@MainActor
private final class HealthSettingsModel: ObservableObject {
    @Published private(set) var settings = HealthToolSettings()
    @Published private(set) var notice: String?
    @Published private(set) var errorMessage: String?
    private let store: HealthSettingsStoreProtocol

    init(store: HealthSettingsStoreProtocol = UserDefaultsHealthSettingsStore()) {
        self.store = store
        do { settings = try store.load() }
        catch { errorMessage = "无法读取健康工具设置：\(error.localizedDescription)" }
    }

    func setPeriodEnabled(_ enabled: Bool) { mutate { $0.periodEnabled = enabled } }
    func setSmokingEnabled(_ enabled: Bool) { mutate { $0.smokingEnabled = enabled } }

    func savePeriod(start: Date, cycleLength: Int) {
        mutate(success: "经期记录已保存在本机。") {
            $0.latestPeriodStart = start
            $0.cycleLength = cycleLength
        }
    }

    func saveSmoking(start: Date, cigarettesPerDay: Int, pricePerPack: Int) {
        mutate(success: "戒烟记录已保存在本机。") {
            $0.smokeFreeStartedAt = start
            $0.cigarettesPerDay = cigarettesPerDay
            $0.pricePerPack = pricePerPack
        }
    }

    private func mutate(success: String? = nil, _ change: (inout HealthToolSettings) -> Void) {
        var candidate = settings
        change(&candidate)
        do {
            try store.save(candidate)
            settings = candidate
            notice = success
            errorMessage = nil
        } catch {
            errorMessage = "保存失败：\(error.localizedDescription)"
        }
    }
}

private struct HealthToolsView: View {
    @ObservedObject var model: HealthSettingsModel

    var body: some View {
        Form {
            Section {
                Toggle(
                    "主动开启经期记录",
                    isOn: Binding(
                        get: { model.settings.periodEnabled },
                        set: { model.setPeriodEnabled($0) }
                    )
                )
                if model.settings.periodEnabled {
                    NavigationLink("打开经期记录") {
                        PeriodToolView(model: model)
                    }
                }
            } footer: {
                Text("经期记录是可选工具，不会按性别自动开启或隐藏。")
            }

            Section {
                Toggle(
                    "主动开启戒烟日记",
                    isOn: Binding(
                        get: { model.settings.smokingEnabled },
                        set: { model.setSmokingEnabled($0) }
                    )
                )
                if model.settings.smokingEnabled {
                    NavigationLink("打开戒烟日记") {
                        SmokingToolView(model: model)
                    }
                }
            } footer: {
                Text("戒烟日记由本人选择使用，不会根据身份资料判断。")
            }
            if let error = model.errorMessage {
                Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red) }
            }
        }
        .lifePaperBackground()
        .navigationTitle("健康工具")
    }
}

private struct PeriodToolView: View {
    @ObservedObject var model: HealthSettingsModel
    @State private var latestStart: Date
    @State private var cycleLength: Int

    init(model: HealthSettingsModel) {
        self.model = model
        _latestStart = State(initialValue: model.settings.latestPeriodStart ?? Date())
        _cycleLength = State(initialValue: model.settings.cycleLength)
    }

    var body: some View {
        Form {
            Section(model.settings.latestPeriodStart == nil ? "尚未保存记录" : "最近一次记录") {
                DatePicker("开始日期", selection: $latestStart, in: ...Date(), displayedComponents: .date)
                Stepper("周期长度：\(cycleLength) 天", value: $cycleLength, in: 1...90)
                Button("保存经期记录") {
                    model.savePeriod(start: latestStart, cycleLength: cycleLength)
                }
                .buttonStyle(.borderedProminent)
            }
            Section("下一次预估") {
                if let prediction = PeriodPrediction.nextStart(
                    records: [PeriodRecord(startDate: latestStart)],
                    cycleLength: cycleLength,
                    calendar: .current
                ) {
                    Text(prediction.formatted(date: .long, time: .omitted))
                        .font(LifeTheme.sectionTitle)
                }
                Text("预估基于页面中的日期与周期；只有点击保存后才会写入本机，不构成医疗建议。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            feedback
        }
        .lifePaperBackground()
        .navigationTitle("经期记录")
    }

    @ViewBuilder private var feedback: some View {
        if let notice = model.notice {
            Section { Label(notice, systemImage: "checkmark.circle").foregroundStyle(.secondary) }
        }
        if let error = model.errorMessage {
            Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red) }
        }
    }
}

private struct SmokingToolView: View {
    @ObservedObject var model: HealthSettingsModel
    @State private var startedAt: Date
    @State private var cigarettesPerDay: Int
    @State private var pricePerPack: Int

    init(model: HealthSettingsModel) {
        self.model = model
        _startedAt = State(initialValue: model.settings.smokeFreeStartedAt ?? Date())
        _cigarettesPerDay = State(initialValue: model.settings.cigarettesPerDay)
        _pricePerPack = State(initialValue: model.settings.pricePerPack)
    }

    private var statistics: SmokingStatistics {
        SmokingStatistics.make(
            startedAt: startedAt,
            asOf: Date(),
            cigarettesPerDay: cigarettesPerDay,
            pricePerPack: pricePerPack,
            cigarettesPerPack: 20,
            calendar: .current
        )
    }

    var body: some View {
        Form {
            Section(model.settings.smokeFreeStartedAt == nil ? "尚未保存记录" : "开始记录") {
                DatePicker("戒烟开始日", selection: $startedAt, in: ...Date(), displayedComponents: .date)
                Stepper("过去每天约 \(cigarettesPerDay) 支", value: $cigarettesPerDay, in: 0...100)
                Stepper("每包约 \(pricePerPack) 元", value: $pricePerPack, in: 0...200)
                Button("保存戒烟记录") {
                    model.saveSmoking(
                        start: startedAt,
                        cigarettesPerDay: cigarettesPerDay,
                        pricePerPack: pricePerPack
                    )
                }
                .buttonStyle(.borderedProminent)
            }
            Section("截至今天") {
                LabeledContent("已坚持", value: "\(statistics.daysSmokeFree) 天")
                LabeledContent("少吸", value: "\(statistics.cigarettesAvoided) 支")
                LabeledContent("约节省", value: "\(statistics.moneySaved) 元")
                Text("只有点击保存后才会写入本机。").font(.footnote).foregroundStyle(.secondary)
            }
            if let notice = model.notice {
                Section { Label(notice, systemImage: "checkmark.circle").foregroundStyle(.secondary) }
            }
            if let error = model.errorMessage {
                Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red) }
            }
        }
        .lifePaperBackground()
        .navigationTitle("戒烟日记")
    }
}

private struct MinorNoticeSettingsView: View {
    @ObservedObject var repository: LifeAppState
    @State private var offlineProfile = OfflineAgeProfile.unspecified
    @State private var completionNotice: String?

    var body: some View {
        Form {
            Section {
                Picker("离线年龄资料", selection: $offlineProfile) {
                    ForEach(OfflineAgeProfile.allCases) { profile in
                        Text(profile.title).tag(profile)
                    }
                }
                Button("完成离线年龄资料") {
                    guard offlineProfile != .unspecified else { return }
                    repository.completeOfflineAgeProfile(isMinor: offlineProfile == .minor)
                    completionNotice = offlineProfile == .minor
                        ? "资料已完成，安全提醒将按当前设置呈现。"
                        : "资料已完成；成年资料不会触发未成年人提醒。"
                }
                .disabled(offlineProfile == .unspecified)
            } footer: {
                Text("只有通行证明确返回未成年人状态，或你完成未成年离线年龄资料时，才会触发安全提醒。")
            }

            Section("当前提示状态") {
                Text(promptStatus)
                Button("恢复安全提示") {
                    repository.restoreMinorPrompts()
                    completionNotice = "已恢复提示。下一次符合条件的事件会再次显示。"
                }
            }

            if let completionNotice {
                Section { Label(completionNotice, systemImage: "checkmark.circle").foregroundStyle(.secondary) }
            }
            if let error = repository.minorPromptError {
                Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red) }
            }
        }
        .lifePaperBackground()
        .navigationTitle("未成年人提示")
    }

    private var promptStatus: String {
        guard let state = repository.minorPrompt?.state else { return "设置无法读取。" }
        if state.permanentlySuppressed { return "已永久关闭；可在此恢复。" }
        if let date = state.suppressedUntil, date > Date() {
            return "已暂停至 \(date.formatted(date: .abbreviated, time: .shortened))。"
        }
        if state.dismissedUntilNextEvent { return "已选择稍后；下一次符合条件的事件会再次提示。" }
        return state.eligible ? "已启用，符合条件时会提示。" : "尚无未成年人触发事件。"
    }
}

private enum OfflineAgeProfile: String, CaseIterable, Identifiable {
    case unspecified, minor, adult
    var id: String { rawValue }
    var title: String {
        switch self {
        case .unspecified: return "请选择"
        case .minor: return "未满 18 周岁"
        case .adult: return "已满 18 周岁"
        }
    }
}
