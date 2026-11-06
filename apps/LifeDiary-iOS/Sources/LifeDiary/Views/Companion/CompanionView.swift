import SwiftUI
import LifeDiaryCore

struct CompanionView: View {
    @ObservedObject var repository: LifeAppState

    var body: some View {
        CompanionPassportGate(
            passport: repository.passport,
            client: repository.onlineClient,
            entries: repository.entries
        )
    }
}

private struct CompanionPassportGate: View {
    @ObservedObject var passport: PassportSession
    let client: LifeOnlineClient
    let entries: [DiaryEntry]

    var body: some View {
        Group {
            if passport.accountID == nil {
                VStack(spacing: 18) {
                    LifeEmptyState(
                        symbol: "person.badge.key",
                        title: "登录后使用 AI 陪伴",
                        message: "只有你本次明确选择的日记编号会发送给生活日记服务。"
                    )
                    if passport.authorizationStatus == .authorizing {
                        ProgressView("正在等待系统认证")
                        Button("取消登录", role: .cancel) { passport.cancelAuthorization() }
                    } else {
                        Button("登录铮铮通行证") { passport.beginAuthorization() }
                            .buttonStyle(.borderedProminent)
                    }
                    if let error = passport.authorizationError {
                        Text(passportErrorText(error))
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .lifePaperBackground()
                .navigationTitle("陪伴")
            } else {
                CompanionConversationView(client: client, entries: entries)
            }
        }
    }

    private func passportErrorText(_ error: PassportAuthorizationError) -> String {
        switch error {
        case .invalidCallback: return "登录回调无效，请重新登录。"
        case .unavailable: return "系统认证会话未能启动，请稍后重试。"
        case .cancelled: return "已取消登录。"
        case .exchangeFailed: return "通行证暂时无法完成登录，请稍后重试。"
        }
    }
}

private struct CompanionConversationView: View {
    let client: LifeOnlineClient
    let entries: [DiaryEntry]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedEntryIDs: Set<UUID> = []
    @State private var messages: [CompanionMessage] = []
    @State private var draft = ""
    @State private var style = "quiet"
    @State private var isSending = false
    @State private var errorMessage: String?
    @State private var sendTask: Task<Void, Never>?

    var body: some View {
        List {
            Section {
                Label("只读取你在本次对话中明确选择的日记", systemImage: "checkmark.shield")
                    .font(.subheadline)
                Picker("回应方式", selection: $style) {
                    Text("安静倾听").tag("quiet")
                    Text("温和梳理").tag("gentle")
                }
                if entries.isEmpty {
                    Text("当前没有可选择的个人日记。").foregroundStyle(.secondary)
                } else {
                    ForEach(entries.prefix(8)) { entry in
                        Toggle(
                            entry.title.isEmpty ? "无标题" : entry.title,
                            isOn: sourceBinding(for: entry.id)
                        )
                    }
                }
            } header: {
                Text("本次来源")
            } footer: {
                Text("应用只发送所选记录的编号；服务端从你的私密同步仓库读取，并在回复中返回实际使用的编号。")
            }

            Section("对话") {
                if messages.isEmpty {
                    Text("可以从现在最想被理解的一件事说起。AI 回应不构成医疗诊断。")
                        .foregroundStyle(.secondary)
                }
                ForEach(messages) { message in
                    CompanionMessageRow(message: message)
                }
                if isSending {
                    HStack {
                        ProgressView()
                        Text("陪伴助手正在回应")
                        Spacer()
                        Button("取消", role: .cancel) { cancelSend() }
                    }
                }
                if let errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(errorMessage, systemImage: "exclamationmark.circle")
                            .foregroundStyle(.red)
                        Button("重试上一条") { send() }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
        .lifePaperBackground()
        .navigationTitle("陪伴")
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("说说现在的感受", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .disabled(isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("发送给 AI 陪伴助手")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(LifeTheme.raisedPaper)
        }
        .onDisappear { sendTask?.cancel() }
    }

    private func sourceBinding(for id: UUID) -> Binding<Bool> {
        Binding(
            get: { selectedEntryIDs.contains(id) },
            set: { isSelected in
                if isSelected { selectedEntryIDs.insert(id) }
                else { selectedEntryIDs.remove(id) }
            }
        )
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        isSending = true
        errorMessage = nil
        if messages.last?.role != .person || messages.last?.text != text {
            append(CompanionMessage(role: .person, text: text))
        }
        let selected = selectedEntryIDs.map(\.uuidString)
        sendTask = Task {
            do {
                let reply = try await client.sendCompanionMessage(text, selectedEntryIDs: selected, style: style)
                guard !Task.isCancelled else { return }
                let disclosure = sourceDisclosure(reply.usedEntryIDs)
                let safety = reply.safety.message.map { "\n安全提示：\($0)" } ?? ""
                append(CompanionMessage(
                    role: .assistant,
                    text: "\(reply.answer)\n\(disclosure)\(safety)"
                ))
                draft = ""
                isSending = false
            } catch is CancellationError {
                isSending = false
                errorMessage = "本次请求已取消。"
            } catch {
                isSending = false
                errorMessage = "未收到陪伴助手回应：\(error.localizedDescription)"
            }
        }
    }

    private func cancelSend() {
        sendTask?.cancel()
        sendTask = nil
        isSending = false
        errorMessage = "本次请求已取消。"
    }

    private func sourceDisclosure(_ usedIDs: [String]) -> String {
        guard !usedIDs.isEmpty else { return "本次回复未使用个人日记。" }
        let titles = usedIDs.map { identifier -> String in
            guard let id = UUID(uuidString: identifier),
                  let entry = entries.first(where: { $0.id == id }) else {
                return "记录 \(identifier.prefix(8))"
            }
            return entry.title.isEmpty ? "无标题" : entry.title
        }
        return "本次实际使用的日记：\(titles.joined(separator: "、"))。"
    }

    private func append(_ message: CompanionMessage) {
        if reduceMotion {
            messages.append(message)
        } else {
            withAnimation(.easeOut(duration: 0.2)) { messages.append(message) }
        }
    }
}

private struct CompanionMessage: Identifiable {
    enum Role { case person, assistant }
    let id = UUID()
    let role: Role
    let text: String
}

private struct CompanionMessageRow: View {
    let message: CompanionMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(
                message.role == .assistant ? "AI 陪伴助手" : "你",
                systemImage: message.role == .assistant ? "sparkles" : "person"
            )
            .font(.caption.weight(.semibold))
            .foregroundStyle(message.role == .assistant ? LifeTheme.moss : .secondary)
            Text(message.text).textSelection(.enabled)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }
}
