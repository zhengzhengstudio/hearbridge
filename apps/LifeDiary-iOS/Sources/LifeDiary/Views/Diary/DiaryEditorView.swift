import SwiftUI
import LifeDiaryCore

struct DiaryEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let onSave: (DiaryEntry) async throws -> Void
    let onPublish: @MainActor (CommunityDraft) async throws -> CommunityPublication
    let isNew: Bool

    @State private var draft: DiaryDraft
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var communityCopy: CommunityCopySheet?
    @State private var publicationNotice = false

    init(
        entry: DiaryEntry?,
        onSave: @escaping (DiaryEntry) async throws -> Void,
        onPublish: @escaping @MainActor (CommunityDraft) async throws -> CommunityPublication
    ) {
        self.onSave = onSave
        self.onPublish = onPublish
        isNew = entry == nil
        _draft = State(initialValue: DiaryDraft(entry: entry))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("个人日记") {
                    TextField("标题", text: $draft.title)
                        .font(.headline)
                    TextEditor(text: $draft.body)
                        .frame(minHeight: 230)
                        .accessibilityLabel("日记正文")
                }

                Section {
                    Button {
                        prepareCommunityCopy()
                    } label: {
                        Label("创建社区副本", systemImage: "doc.on.doc")
                    }
                    .disabled(isSaving || draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } footer: {
                    Text("个人日记不会直接公开。此操作会先保存本地原文，再生成一份可单独编辑的社区副本，并在发布前再次确认。")
                }

                if !draft.body.isEmpty {
                    Section {
                        ShareLink(item: shareText) {
                            Label("通过系统分享文本", systemImage: "square.and.arrow.up")
                        }
                    } footer: {
                        Text("系统分享与发布到社区是两件独立的操作。")
                    }
                }
            }
            .lifePaperBackground()
            .navigationTitle(entryTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        saveAndDismiss()
                    }
                    .disabled(isSaving || !hasContent)
                }
            }
            .sheet(item: $communityCopy) { destination in
                CommunityCopyConfirmationView(draft: destination.draft) { draft in
                    _ = try await onPublish(draft)
                    communityCopy = nil
                    if reduceMotion {
                        publicationNotice = true
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            publicationNotice = true
                        }
                    }
                }
            }
            .alert("社区副本已发布", isPresented: $publicationNotice) {
                Button("完成", role: .cancel) {}
            } message: {
                Text("个人日记原文仍只保留在你的私人记录中。")
            }
            .alert("保存失败", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("知道了", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private var hasContent: Bool {
        !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var shareText: String {
        [draft.title, draft.body].filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    private var entryTitle: String {
        isNew ? "新日记" : "编辑日记"
    }

    private func saveAndDismiss() {
        isSaving = true
        Task {
            do {
                let entry = draft.makeEntry()
                try await onSave(entry)
                draft.markPersisted(entry)
                isSaving = false
                dismiss()
            } catch {
                isSaving = false
                errorMessage = error.localizedDescription
            }
        }
    }

    private func prepareCommunityCopy() {
        isSaving = true
        let entry = draft.makeEntry()
        Task {
            do {
                try await onSave(entry)
                draft.markPersisted(entry)
                isSaving = false
                communityCopy = CommunityCopySheet(draft: CommunityDraft(copying: entry))
            } catch {
                isSaving = false
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct CommunityCopySheet: Identifiable {
    let draft: CommunityDraft
    var id: UUID { draft.id }
}

private struct CommunityCopyConfirmationView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: CommunityDraft
    @State private var isPublishing = false
    @State private var errorMessage: String?
    @State private var failedAttemptNeedsQueueRetry = false
    @State private var failedAttemptButtonTitle = "已加入待重试"
    let onConfirm: @MainActor (CommunityDraft) async throws -> Void

    init(draft: CommunityDraft, onConfirm: @escaping @MainActor (CommunityDraft) async throws -> Void) {
        _draft = State(initialValue: draft)
        self.onConfirm = onConfirm
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("将要公开的独立副本") {
                    TextField("公开标题", text: $draft.title)
                    TextEditor(text: $draft.body)
                        .frame(minHeight: 210)
                        .accessibilityLabel("社区副本正文")
                }
                Section {
                    Label("副本有独立编号，修改不会回写个人日记。", systemImage: "lock.doc")
                    Label("社区内容可能被其他人看到、评论或举报。", systemImage: "person.2")
                    if isPublishing {
                        HStack {
                            ProgressView()
                            Text("正在等待服务器确认")
                        }
                    }
                    if let errorMessage {
                        Label("尚未发布：\(errorMessage)", systemImage: "exclamationmark.circle")
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("发布前确认")
                }
            }
            .lifePaperBackground()
            .navigationTitle("确认社区副本")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isPublishing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(failedAttemptNeedsQueueRetry ? failedAttemptButtonTitle : "确认发布") {
                        isPublishing = true
                        errorMessage = nil
                        Task {
                            do {
                                try await onConfirm(draft)
                                isPublishing = false
                                dismiss()
                            } catch {
                                isPublishing = false
                                if let persistenceError = error as? CommunityPublicationError {
                                    failedAttemptNeedsQueueRetry = persistenceError != .initialQueuePersistenceFailed
                                    switch persistenceError {
                                    case .initialQueuePersistenceFailed:
                                        errorMessage = "保存失败，未加入发布队列。请确认存储空间后重试。"
                                    case .failedStatePersistenceFailed:
                                        failedAttemptButtonTitle = "队列保存失败"
                                        errorMessage = "发布失败，队列状态保存失败；无法确认已加入待重试。"
                                    case .publishedStatePersistenceFailed:
                                        failedAttemptButtonTitle = "状态保存失败"
                                        errorMessage = "服务器已确认公开，但本地状态保存失败。相同公开编号不会重复发帖。"
                                    }
                                } else {
                                    failedAttemptNeedsQueueRetry = true
                                    failedAttemptButtonTitle = "已加入待重试"
                                    errorMessage = "未收到服务器确认；已可靠加入待重试队列。"
                                }
                            }
                        }
                    }
                    .disabled(
                        isPublishing ||
                        failedAttemptNeedsQueueRetry ||
                        draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                }
            }
        }
    }
}
