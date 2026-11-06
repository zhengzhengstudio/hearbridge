import Foundation

public struct DiaryDraft: Equatable, Sendable {
    public private(set) var id: UUID
    public private(set) var createdAt: Date
    public var title: String
    public var body: String

    public init(entry: DiaryEntry? = nil) {
        id = entry?.id ?? UUID()
        createdAt = entry?.createdAt ?? Date()
        title = entry?.title ?? ""
        body = entry?.body ?? ""
    }

    public func makeEntry(at date: Date = Date()) -> DiaryEntry {
        DiaryEntry(
            id: id,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            body: body.trimmingCharacters(in: .whitespacesAndNewlines),
            createdAt: createdAt,
            updatedAt: date
        )
    }

    public mutating func markPersisted(_ entry: DiaryEntry) {
        id = entry.id
        createdAt = entry.createdAt
    }
}
