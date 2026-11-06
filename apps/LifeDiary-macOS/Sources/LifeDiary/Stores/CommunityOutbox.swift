import Foundation

protocol CommunityOutboxStoreProtocol: AnyObject {
    func load() throws -> [CommunityDraft]
    func save(_ drafts: [CommunityDraft]) throws
}

final class ApplicationSupportCommunityOutboxStore: CommunityOutboxStoreProtocol {
    private let url: URL
    convenience init(fileManager: FileManager = .default) throws {
        let root = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("LifeDiary", isDirectory: true)
        try self.init(directory: root, fileManager: fileManager)
    }
    init(directory: URL, fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("community-outbox.json")
    }
    func load() throws -> [CommunityDraft] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([CommunityDraft].self, from: Data(contentsOf: url))
    }
    func save(_ drafts: [CommunityDraft]) throws { try JSONEncoder().encode(drafts).write(to: url, options: .atomic) }
}

final class CommunityOutbox {
    private let store: CommunityOutboxStoreProtocol
    private var drafts: [CommunityDraft]
    init(store: CommunityOutboxStoreProtocol) throws { self.store = store; drafts = try store.load() }

    func draft(for entry: DiaryEntry) throws -> CommunityDraft {
        if let existing = drafts.first(where: { $0.privateEntryID == entry.id }) { return existing }
        let draft = CommunityDraft(copying: entry)
        drafts.append(draft)
        try store.save(drafts)
        return draft
    }

    func complete(_ draft: CommunityDraft) throws {
        drafts.removeAll { $0.id == draft.id }
        try store.save(drafts)
    }
}
