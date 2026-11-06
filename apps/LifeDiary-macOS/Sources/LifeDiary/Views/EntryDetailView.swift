import SwiftUI

struct EntryDetailView: View {
    let entry: DiaryEntry
    @ObservedObject var repository: LifeRepository
    @State private var title: String
    @State private var bodyText: String
    @State private var saveError: String?

    init(entry: DiaryEntry, repository: LifeRepository) {
        self.entry = entry
        self.repository = repository
        _title = State(initialValue: entry.title)
        _bodyText = State(initialValue: entry.body)
    }

    var body: some View {
        PaperPage {
            VStack(alignment: .leading, spacing: 16) {
                TextField("标题", text: $title).font(.system(size: 28, weight: .semibold, design: .serif)).textFieldStyle(.plain)
                Divider()
                TextEditor(text: $bodyText).font(.system(size: 16, design: .serif)).scrollContentBackground(.hidden)
                HStack {
                    Text("创建于 \(entry.createdAt.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("保存") { save() }.keyboardShortcut("s")
                        .buttonStyle(.borderedProminent)
                }
                if let saveError { Text(saveError).foregroundStyle(.red).font(.caption) }
            }
        }
        .id(entry.id)
    }

    private func save() {
        var updated = entry
        updated.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "未命名记录" : title
        updated.body = bodyText
        updated.updatedAt = Date()
        Task {
            do { try await repository.save(entry: updated); saveError = nil }
            catch { saveError = error.localizedDescription }
        }
    }
}
