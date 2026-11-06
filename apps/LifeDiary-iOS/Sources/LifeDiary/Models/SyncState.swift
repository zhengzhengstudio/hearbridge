import Foundation

public enum SyncState: Equatable, Sendable {
    case idle
    case pending(count: Int)
    case syncing
    case failed
}

public enum PendingMutation: Codable, Equatable, Sendable {
    case upsert(DiaryEntry)
    case delete(UUID)
}

public struct DiaryStoreSnapshot: Codable, Equatable, Sendable {
    public var entries: [DiaryEntry]
    public var pendingMutations: [PendingMutation]

    public init(entries: [DiaryEntry] = [], pendingMutations: [PendingMutation] = []) {
        self.entries = entries
        self.pendingMutations = pendingMutations
    }
}
