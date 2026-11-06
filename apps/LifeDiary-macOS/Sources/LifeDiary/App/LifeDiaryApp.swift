import AppKit
import SwiftUI

@main
struct LifeDiaryApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var updates = UpdateService()
    @StateObject private var model = LifeAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup("生活日记", id: "main") {
            ContentView(model: model)
                .environmentObject(updates)
                .overlay {
                    if scenePhase != .active {
                        ZStack {
                            Color(nsColor: .windowBackgroundColor)
                            Label("生活日记已隐藏", systemImage: "lock.fill")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityLabel("生活日记已隐藏以保护隐私")
                    }
                }
                .frame(minWidth: 980, minHeight: 660)
                .task { await updates.check() }
        }
        .commands { LifeCommands() }

        Settings { SettingsView(model: model) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct LifeCommands: Commands {
    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("新建记录") { post(.newDiaryEntry) }.keyboardShortcut("n")
            Button("搜索日记") { post(.focusDiarySearch) }.keyboardShortcut("f")
        }
        CommandMenu("生活日记") {
            Button("锁定") { post(.lockDiary) }.keyboardShortcut("l", modifiers: [.command, .shift])
            Button("导出备份…") { post(.exportDiary) }.keyboardShortcut("e", modifiers: [.command, .shift])
            Divider()
            Button("检查更新…") { post(.checkLifeDiaryUpdates) }.keyboardShortcut("u")
        }
    }

    private func post(_ name: Notification.Name) { NotificationCenter.default.post(name: name, object: nil) }
}

extension Notification.Name {
    static let newDiaryEntry = Notification.Name("LifeDiary.newEntry")
    static let focusDiarySearch = Notification.Name("LifeDiary.focusSearch")
    static let exportDiary = Notification.Name("LifeDiary.export")
    static let lockDiary = Notification.Name("LifeDiary.lock")
    static let checkLifeDiaryUpdates = Notification.Name("LifeDiary.checkUpdates")
}
