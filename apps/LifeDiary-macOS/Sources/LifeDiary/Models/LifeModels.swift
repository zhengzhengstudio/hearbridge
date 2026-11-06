import Foundation

struct DiaryEntry: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    var title: String
    var body: String
    let createdAt: Date
    var updatedAt: Date
    var revision: Int

    init(id: UUID = UUID(), title: String, body: String, createdAt: Date = Date(), updatedAt: Date = Date(), revision: Int = 0) {
        self.id = id
        self.title = title
        self.body = body
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.revision = revision
    }
}

struct MacLedgerEntry: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    var revision: Int
    var category: String
    var amount: Double
    var note: String
    var occurredAt: Date

    init(id: UUID = UUID(), revision: Int = 0, category: String = "", amount: Double = 0, note: String = "", occurredAt: Date = Date()) {
        self.id = id
        self.revision = revision
        self.category = category
        self.amount = amount
        self.note = note
        self.occurredAt = occurredAt
    }
}

enum SyncState: Equatable, Sendable {
    case idle
    case pending(count: Int)
    case syncing
    case failed
}

enum SyncOperationType: String, Codable, Equatable, Sendable { case upsert, delete }

struct SyncPayload: Codable, Equatable, Sendable {
    let id: String
    var title: String?
    var body: String?
    var createdAt: Date?
    var updatedAt: Date?

    init(id: String, title: String? = nil, body: String? = nil, createdAt: Date? = nil, updatedAt: Date? = nil) {
        self.id = id; self.title = title; self.body = body; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}

struct PendingMutation: Codable, Equatable, Sendable {
    let id: UUID
    let domain: String
    let type: SyncOperationType
    let baseRevision: Int
    let payload: SyncPayload

    static func upsert(_ entry: DiaryEntry, id: UUID = UUID()) -> Self {
        Self(
            id: id,
            domain: "diary",
            type: .upsert,
            baseRevision: entry.revision,
            payload: .init(
                id: entry.id.uuidString,
                title: entry.title,
                body: entry.body,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt
            )
        )
    }

    static func delete(_ entry: DiaryEntry, id: UUID = UUID()) -> Self {
        Self(id: id, domain: "diary", type: .delete, baseRevision: entry.revision, payload: .init(id: entry.id.uuidString))
    }
}

struct DiaryStoreSnapshot: Codable, Equatable, Sendable {
    var entries: [DiaryEntry] = []
    var pendingMutations: [PendingMutation] = []
}

struct SyncRemoteItem: Codable, Equatable, Sendable {
    let id: String
    let title: String?
    let body: String?
    let revision: Int
}

struct SyncServerRecord: Codable, Equatable, Sendable {
    let revision: Int
    let domains: [String: [String: SyncRemoteItem]]
    var appliedOperationIds: [String] = []
}

struct SyncConflict: Codable, Equatable, Sendable {
    let operationId: String
    let domain: String
    let id: String
}

struct SyncResponse: Codable, Equatable, Sendable {
    let record: SyncServerRecord
    let applied: [String]
    let conflicts: [SyncConflict]
}

struct CommunityDraft: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let privateEntryID: UUID
    var title: String
    var body: String

    init(id: UUID = UUID(), privateEntryID: UUID, title: String, body: String) {
        self.id = id
        self.privateEntryID = privateEntryID
        self.title = title
        self.body = body
    }

    init(copying entry: DiaryEntry) {
        self.init(privateEntryID: entry.id, title: entry.title, body: entry.body)
    }

    func publicPayload(minorConfirmed: Bool) -> PublicCommunityPayload {
        PublicCommunityPayload(id: id, topic: title, body: body, minorConfirmed: minorConfirmed)
    }
}

struct PublicCommunityPayload: Codable, Equatable, Sendable {
    let id: UUID
    let topic: String
    let body: String
    let minorConfirmed: Bool
}

struct CommunityAuthor: Codable, Equatable, Sendable {
    let uid: String
    let nickname: String
    let avatar: String
}

struct RemoteCommunityPost: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let body: String
    let topic: String
    let author: CommunityAuthor
    let createdAt: String
    let updatedAt: String
    let likeCount: Int
}

struct FriendUser: Codable, Equatable, Identifiable, Sendable {
    let uid: String
    let nickname: String
    var id: String { uid }
}

struct FriendConnection: Codable, Equatable, Identifiable, Sendable {
    let uid: String
    let since: String
    var id: String { uid }
}

struct FriendRequestRecord: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let fromUid: String
    let toUid: String
    let source: String
    let status: String
    let createdAt: String
    let respondedAt: String?
}

struct FriendsOverview: Codable, Equatable, Sendable {
    let friends: [FriendConnection]
    let requests: [FriendRequestRecord]
}

struct ChatMessage: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let conversationId: String
    let senderUid: String
    let targetUid: String
    let body: String
    let clientMessageId: String
    let createdAt: String
}

struct PendingChatSend: Equatable, Sendable {
    let body: String
    let clientMessageID: String
    var isSending = false
    var errorMessage: String?

    init(body: String, clientMessageID: String = UUID().uuidString) {
        self.body = body
        self.clientMessageID = clientMessageID
    }

    mutating func markSending() { isSending = true; errorMessage = nil }
    mutating func markFailed(_ message: String) { isSending = false; errorMessage = message }
}

struct CompanionReply: Codable, Equatable, Sendable {
    struct Safety: Codable, Equatable, Sendable {
        let level: String
        let message: String?
    }
    let answer: String
    let usedEntryIds: [String]
    let safety: Safety
}

struct HealthToolSettings: Codable, Equatable, Sendable {
    var periodEnabled = false
    var latestPeriodStart: Date?
    var cycleLength = 28
    var smokingEnabled = false
    var smokeFreeStartedAt: Date?
    var cigarettesPerDay = 10
    var pricePerPack = 20
}

enum PeriodPrediction {
    static func nextStart(latest: Date?, cycleLength: Int, calendar: Calendar = .current) -> Date? {
        guard let latest else { return nil }
        return calendar.date(byAdding: .day, value: max(1, cycleLength), to: latest)
    }
}

struct SmokingStatistics: Equatable, Sendable {
    let daysSmokeFree: Int
    let cigarettesAvoided: Int
    let moneySaved: Int

    static func make(startedAt: Date, asOf: Date, cigarettesPerDay: Int, pricePerPack: Int, calendar: Calendar = .current) -> Self {
        let days = max(0, calendar.dateComponents([.day], from: startedAt, to: asOf).day ?? 0)
        let avoided = days * max(0, cigarettesPerDay)
        return Self(daysSmokeFree: days, cigarettesAvoided: avoided, moneySaved: avoided * max(0, pricePerPack) / 20)
    }
}
