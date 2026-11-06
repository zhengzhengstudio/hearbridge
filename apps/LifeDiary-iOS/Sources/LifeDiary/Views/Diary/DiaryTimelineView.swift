import SwiftUI
import LifeDiaryCore

struct DiaryTimelineView: View {
    @ObservedObject var repository: LifeAppState
    @State private var editor: DiaryEditorSheet?
    @State private var errorMessage: String?
    @State private var deleteCandidate: DiaryEntry?

    var body: some View {
        Group {
            if repository.entries.isEmpty {
                LifeEmptyState(
                    symbol: "book.closed",
                    title: "还没有日记",
                    message: "新记录先写入本机；只有你主动确认，才会另建一份社区副本。"
                )
            } else {
                List {
                    Section {
                        ForEach(repository.entries) { entry in
                            Button {
                                editor = .edit(entry)
                            } label: {
                                DiaryRow(entry: entry)
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    deleteCandidate = entry
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                        }
                    } header: {
                        Text("按最近修改排序")
                    }
                }
            }
        }
        .lifePaperBackground()
        .navigationTitle("日记")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    editor = .new
                } label: {
                    Label("新建日记", systemImage: "square.and.pencil")
                }
            }
        }
        .sheet(item: $editor) { destination in
            DiaryEditorView(
                entry: destination.entry,
                onSave: repository.save,
                onPublish: repository.publish
            )
        }
        .alert("未能完成操作", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
        .confirmationDialog(
            "确定删除这篇私人日记吗？",
            isPresented: Binding(
                get: { deleteCandidate != nil },
                set: { if !$0 { deleteCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("删除", role: .destructive) {
                guard let entry = deleteCandidate else { return }
                deleteCandidate = nil
                Task {
                    do {
                        try await repository.delete(entry)
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                }
            }
            Button("取消", role: .cancel) { deleteCandidate = nil }
        } message: {
            Text("删除会先写入本机并在联网时同步，之后无法从本应用撤销。")
        }
    }
}

private struct DiaryRow: View {
    let entry: DiaryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(entry.title.isEmpty ? "无标题" : entry.title)
                .font(.headline)
                .foregroundStyle(LifeTheme.charcoal)
            Text(entry.body.isEmpty ? "这页还没有正文。" : entry.body)
                .font(.body)
                .foregroundStyle(LifeTheme.charcoal.opacity(0.72))
                .lineLimit(2)
            Text(entry.updatedAt.formatted(date: .abbreviated, time: .shortened))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityHint("打开并编辑个人日记")
    }
}

private enum DiaryEditorSheet: Identifiable {
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
