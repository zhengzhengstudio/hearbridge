import Foundation

public struct QueuedCommand: Codable, Equatable, Identifiable, Sendable {
    public var id: String { eventID }
    public var eventID: String; public var baseRevision: Int; public var type: String; public var payload: Data
    public init(eventID: String = UUID().uuidString, baseRevision: Int, type: String, payload: Data) {
        self.eventID = eventID; self.baseRevision = baseRevision; self.type = type; self.payload = payload
    }
}

public actor ReconnectQueue {
    private var pending: [QueuedCommand] = []
    public init() {}
    public func enqueue(_ command: QueuedCommand) { if !pending.contains(where: { $0.eventID == command.eventID }) { pending.append(command) } }
    public func acknowledge(eventID: String) { pending.removeAll { $0.eventID == eventID } }
    public func commands(from revision: Int) -> [QueuedCommand] { pending.filter { $0.baseRevision >= revision } }
}
