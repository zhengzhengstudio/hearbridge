import SwiftUI
import LifeDiaryCore

struct TodayView: View {
    @ObservedObject var repository: LifeAppState
    @State private var editor: TodaySheet?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(Date.now.formatted(.dateTime.month(.wide).day().weekday(.wide)))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text("今天，慢慢写")
                        .font(LifeTheme.pageTitle)
                    Text("留下一件真实发生的小事，就已经足够。")
                        .font(.body)
                        .foregroundStyle(LifeTheme.charcoal.opacity(0.72))
                }

                Button {
                    editor = .new
                } label: {
                    Label("写下此刻", systemImage: "square.and.pencil")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityHint("打开一篇只保存在个人日记中的新记录")

                DailyToolsView()

                Divider().overlay(LifeTheme.hairline)

                VStack(alignment: .leading, spacing: 14) {
                    Text("最近一页")
                        .font(LifeTheme.sectionTitle)
                    if let entry = repository.entries.first {
                        Button {
                            editor = .edit(entry)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(entry.title.isEmpty ? "无标题" : entry.title)
                                    .font(.headline)
                                Text(entry.body.isEmpty ? "这页还没有正文。" : entry.body)
                                    .font(.body)
                                    .lineLimit(3)
                                    .foregroundStyle(LifeTheme.charcoal.opacity(0.72))
                                Text(entry.updatedAt.formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("打开并编辑这篇个人日记")
                    } else {
                        LifeEmptyState(
                            symbol: "book.closed",
                            title: "第一页还在等你",
                            message: "你的个人日记只会在明确操作后生成社区副本。"
                        )
                    }
                }

                syncLine
            }
            .padding(LifeTheme.pageInset)
        }
        .lifePaperBackground()
        .navigationTitle("今天")
        .sheet(item: $editor) { destination in
            DiaryEditorView(
                entry: destination.entry,
                onSave: repository.save,
                onPublish: repository.publish
            )
        }
    }

    private var syncLine: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if repository.isSyncing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: syncSymbol)
                        .accessibilityHidden(true)
                }
                Text(syncText)
            }
            if case .pending = repository.syncState {
                Button("立即重试同步") {
                    Task { await repository.retryPendingSync() }
                }
                .buttonStyle(.bordered)
                .disabled(repository.isSyncing)
            }
            if let notice = repository.syncNotice {
                Text(notice)
                    .accessibilityLabel("同步结果：\(notice)")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    private var syncSymbol: String {
        switch repository.syncState {
        case .idle: return "checkmark.circle"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .pending: return "clock"
        case .failed: return "exclamationmark.circle"
        }
    }

    private var syncText: String {
        switch repository.syncState {
        case .idle: return "本地记录已保存"
        case .syncing: return "正在同步已保存在本机的更改"
        case .pending(let count): return "\(count) 项更改已在本地保存，等待联网同步"
        case .failed: return "同步暂停，本地记录不受影响"
        }
    }
}

private enum TodaySheet: Identifiable {
    case new
    case edit(DiaryEntry)

    var id: String {
        switch self {
        case .new: return "new"
        case .edit(let entry): return entry.id.uuidString
        }
    }

    var entry: DiaryEntry? {
        switch self {
        case .new: return nil
        case .edit(let entry): return entry
        }
    }
}
