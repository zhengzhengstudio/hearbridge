import SwiftUI

struct LedgerView: View {
    let api: LifeAPIClient

    @State private var entries: [MacLedgerEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        PaperPage {
            VStack(alignment: .leading, spacing: 20) {
                Text("账本").font(.system(size: 30, weight: .semibold))
                Text("账本记录只在本地与你的账户之间同步，不会随日记正文公开。")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if isLoading {
                    ProgressView("正在读取账本…")
                } else if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                    Button("重试") { Task { await load() } }
                        .buttonStyle(.bordered)
                } else if entries.isEmpty {
                    NativeEmptyState(
                        title: "还没有账本记录",
                        icon: "book.pages",
                        detail: "账本用于记录与日记相关的收支或待办，所有内容仅在本机与你的账户之间同步。"
                    )
                } else {
                    List {
                        ForEach(entries) { entry in
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(entry.category.isEmpty ? "未分类" : entry.category)
                                        .fontWeight(.medium)
                                    if !entry.note.isEmpty {
                                        Text(entry.note)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                }
                                Spacer()
                                Text(entry.amount, format: .currency(code: "CNY"))
                                    .foregroundStyle(LifeDiaryDesignTokens.moss)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .frame(maxHeight: .infinity)
                }
            }
        }
        .navigationTitle("账本")
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            entries = try await api.syncLedger(entries)
        } catch {
            errorMessage = "无法读取账本：\(error.localizedDescription)"
        }
    }
}
