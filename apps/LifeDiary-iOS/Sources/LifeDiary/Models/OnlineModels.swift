import Foundation

public struct PublicCommunityPayload: Codable, Equatable, Sendable {
    public var id: UUID?
    public var topic: String
    public var body: String
    public var minorConfirmed: Bool

    public init(id: UUID, topic: String, body: String, minorConfirmed: Bool) {
        self.id = id
        self.topic = topic
        self.body = body
        self.minorConfirmed = minorConfirmed
    }
}

public struct CommunityAuthor: Codable, Equatable, Sendable {
    public let uid: String
    public let nickname: String
    public let avatar: String

    public init(uid: String, nickname: String, avatar: String) {
        self.uid = uid
        self.nickname = nickname
        self.avatar = avatar
    }
}

public struct RemoteCommunityPost: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let body: String
    public let topic: String
    public let author: CommunityAuthor
    public let createdAt: String
    public let updatedAt: String
    public let likeCount: Int

    public init(
        id: String,
        body: String,
        topic: String,
        author: CommunityAuthor,
        createdAt: String,
        updatedAt: String,
        likeCount: Int
    ) {
        self.id = id
        self.body = body
        self.topic = topic
        self.author = author
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.likeCount = likeCount
    }
}

public struct FriendUser: Codable, Equatable, Identifiable, Sendable {
    public let uid: String
    public let nickname: String
    public var id: String { uid }
}

public struct FriendConnection: Codable, Equatable, Identifiable, Sendable {
    public let uid: String
    public let since: String
    public var id: String { uid }
}

public struct FriendRequestRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let fromUid: String
    public let toUid: String
    public let source: String
    public let status: String
    public let createdAt: String
    public let respondedAt: String?
}

public struct FriendsOverview: Codable, Equatable, Sendable {
    public let friends: [FriendConnection]
    public let requests: [FriendRequestRecord]
}

public struct TapToken: Codable, Equatable, Sendable {
    public let token: String
    public let expiresAt: String
}

public struct ChatMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let conversationId: String
    public let senderUid: String
    public let targetUid: String
    public let body: String
    public let clientMessageId: String
    public let createdAt: String
}

public struct CompanionReply: Codable, Equatable, Sendable {
    public struct Safety: Codable, Equatable, Sendable {
        public let level: String
        public let message: String?
    }
    public let answer: String
    public let usedEntryIds: [String]
    public let safety: Safety

    public var usedEntryIDs: [String] { usedEntryIds }
}
