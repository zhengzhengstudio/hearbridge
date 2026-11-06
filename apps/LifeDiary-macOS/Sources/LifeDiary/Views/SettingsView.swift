import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: LifeAppModel
    @AppStorage("analytics") private var analytics = false
    @State private var reminderStatus = ""

    var body: some View {
        TabView {
            Form {
                Toggle("允许匿名崩溃诊断（不含日记内容）", isOn: $analytics)
                Text("个人日记默认先保存在本机；发布到社区必须另行确认。")
                    .foregroundStyle(.secondary)
            }.padding(24).tabItem { Label("通用", systemImage: "gearshape") }

            Form {
                Picker("离线年龄资料", selection: ageProfile) {
                    Text("未设置").tag("unset")
                    Text("未成年人").tag("minor")
                    Text("成年人").tag("adult")
                }
                Button("恢复未成年人提醒") {
                    do {
                        try model.minor?.restorePrompts()
                        model.showMinorPrompt = model.minor?.shouldPresent() ?? false
                        reminderStatus = "提醒已恢复。"
                    } catch { reminderStatus = "恢复失败：\(error.localizedDescription)" }
                }
                if !reminderStatus.isEmpty { Text(reminderStatus).foregroundStyle(.secondary) }
                Text("年龄资料只保存在本机设置中，不进入通行证凭据。")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding(24).tabItem { Label("隐私", systemImage: "hand.raised") }
        }
        .frame(width: 520, height: 290)
    }

    private var ageProfile: Binding<String> {
        Binding(
            get: {
                guard let state = model.minor?.state, state.identityKey == "offline-profile" else { return "unset" }
                return state.eligible ? "minor" : "adult"
            },
            set: { value in
                guard value != "unset" else { return }
                do {
                    try model.minor?.completeOfflineAgeProfile(isMinor: value == "minor")
                    model.showMinorPrompt = model.minor?.shouldPresent() ?? false
                    reminderStatus = value == "minor" ? "将在需要时显示保护提醒。" : "已清除未成年人提醒资格。"
                } catch { reminderStatus = "保存失败：\(error.localizedDescription)" }
            }
        )
    }
}
