import Foundation

public struct CommunityDraft: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let privateEntryID: UUID
    public var title: String
    public var body: String

    public init(id: UUID = UUID(), privateEntryID: UUID, title: String, body: String) {
        self.id = id
        self.privateEntryID = privateEntryID
        self.title = title
        self.body = body
    }

    public init(copying privateEntry: DiaryEntry) {
        self.init(
            privateEntryID: privateEntry.id,
            title: privateEntry.title,
            body: privateEntry.body
        )
    }

    public func makePublicPost(id: UUID = UUID(), publishedAt: Date = Date()) -> CommunityPost {
        CommunityPost(id: id, sourceEntryID: privateEntryID, title: title, body: body, publishedAt: publishedAt)
    }
}

public struct CommunityPost: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let sourceEntryID: UUID
    public let title: String
    public let body: String
    public let publishedAt: Date
}
