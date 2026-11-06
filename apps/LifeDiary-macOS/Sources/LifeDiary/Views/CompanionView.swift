import SwiftUI

struct CompanionView: View {
    let entries: [DiaryEntry]
    let api: LifeAPIClient
    @ObservedObject var passport: PassportSession
    @State private var prompt = ""
    @State private var selected = Set<UUID>()
    @State private var reply: CompanionReply?
    @State private var isLoading = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("陪伴").font(.system(size: 30, weight: .semibold))
                Text("只有你明确勾选的记录 ID 会用于这次对话；正文不会由客户端直接附带。")
                    .foregroundStyle(.secondary)
                if passport.accountID == nil { LoginGate(passport: passport) }
                else {
                    Text("允许参考").font(.headline)
                    ForEach(entries) { entry in
                        Toggle(entry.title, isOn: Binding(
                            get: { selected.contains(entry.id) },
                            set: { enabled in
                                if enabled { selected.insert(entry.id) } else { selected.remove(entry.id) }
                            }
                        ))
                    }
                    TextField("想聊些什么？", text: $prompt, axis: .vertical)
                    HStack {
                        Button("发送") { Task { await send() } }.buttonStyle(.borderedProminent).disabled(prompt.isEmpty || isLoading)
                        if isLoading { ProgressView() }
                    }
                }
                if let reply {
                    Divider()
                    Text(reply.answer).font(.system(size: 17, design: .serif))
                    Text("本次使用 \(reply.usedEntryIds.count) 条已授权记录").font(.caption).foregroundStyle(.secondary)
                }
                if let errorText { Text(errorText).foregroundStyle(.red) }
            }
            .frame(maxWidth: 760, alignment: .leading).padding(28)
        }
    }

    private func send() async {
        isLoading = true; errorText = nil
        defer { isLoading = false }
        do {
            reply = try await api.sendCompanionMessage(prompt, selectedEntryIDs: selected.map(\.uuidString), style: "quiet")
            prompt = ""
        } catch { errorText = error.localizedDescription }
    }
}
