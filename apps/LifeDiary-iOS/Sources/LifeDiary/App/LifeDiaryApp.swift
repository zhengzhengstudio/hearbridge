import SwiftUI

@main
@MainActor
struct LifeDiaryApp: App {
    @StateObject private var updates = UpdateService()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            AppView()
                .environmentObject(updates)
                .overlay {
                    if scenePhase != .active {
                        PrivacySnapshotCover()
                    }
                }
                .task { await updates.check() }
        }
    }
}

private struct PrivacySnapshotCover: View {
    var body: some View {
        ZStack {
            Color.background.ignoresSafeArea()
            Label("生活日记已隐藏", systemImage: "lock.fill")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .accessibilityLabel("生活日记已隐藏以保护隐私")
    }
}
