import Foundation

public enum ConnectionStatus: String, Codable, Equatable, Sendable {
    case pending
    case connected
    case blocked
}

public struct LifeConnection: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let accountID: String
    public var displayName: String
    public var status: ConnectionStatus

    public init(id: UUID = UUID(), accountID: String, displayName: String, status: ConnectionStatus) {
        self.id = id
        self.accountID = accountID
        self.displayName = displayName
        self.status = status
    }
}
