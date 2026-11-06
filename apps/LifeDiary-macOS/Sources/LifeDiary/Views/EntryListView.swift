import SwiftUI

struct EntryListView: View {
    let section: LifeSection
    @ObservedObject var repository: LifeRepository
    @Binding var selection: UUID?
    let query: String

    private var entries: [DiaryEntry] {
        repository.entries.filter {
            query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.body.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List(selection: $selection) {
            if entries.isEmpty {
                NativeEmptyState(
                    title: query.isEmpty ? "还没有记录" : "没有匹配的记录",
                    icon: query.isEmpty ? "book.closed" : "magnifyingglass",
                    detail: query.isEmpty ? "用 ⌘N 写下第一篇日记。" : "换一个关键词试试。"
                )
            } else {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.title.isEmpty ? "未命名记录" : entry.title).fontWeight(.medium).lineLimit(1)
                        Text(entry.body.isEmpty ? "空白纸页" : entry.body).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        Text(entry.updatedAt, style: .relative).font(.caption2).foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 4)
                    .tag(entry.id)
                }
            }
        }
        .navigationTitle(section.title)
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: 8) {
                Text(syncLabel).font(.caption).foregroundStyle(.secondary)
                if needsRetry {
                    Button("重试同步") { Task { await repository.sync() } }
                        .font(.caption).buttonStyle(.link)
                }
            }
            .padding(10)
        }
    }

    private var syncLabel: String {
        switch repository.syncState {
        case .idle: return "已保存在本机"
        case .pending(let count): return "本机已保存 · \(count) 项待同步"
        case .syncing: return "正在同步"
        case .failed: return "同步需要处理"
        }
    }

    private var needsRetry: Bool {
        switch repository.syncState {
        case .pending, .failed: return true
        default: return false
        }
    }
}
