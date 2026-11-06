import Combine
import Foundation

public enum CommunityPublicationState: String, Codable, Equatable, Sendable {
    case queued
    case failed
    case published
}

public enum CommunityPublicationError: LocalizedError, Equatable, Sendable {
    case initialQueuePersistenceFailed
    case failedStatePersistenceFailed
    case publishedStatePersistenceFailed

    public var errorDescription: String? {
        switch self {
        case .initialQueuePersistenceFailed:
            return "发布队列保存失败，内容未加入待重试队列。"
        case .failedStatePersistenceFailed:
            return "发布失败，且待重试状态保存失败。"
        case .publishedStatePersistenceFailed:
            return "服务器已确认发布，但本地发布状态保存失败。"
        }
    }
}

public struct CommunityPublication: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let privateSourceEntryID: UUID
    public var payload: PublicCommunityPayload
    public var state: CommunityPublicationState
    public var serverPost: RemoteCommunityPost?
    public var lastError: String?

    public static func queued(draft: CommunityDraft, minorConfirmed: Bool = true) -> CommunityPublication {
        CommunityPublication(
            id: draft.id,
            privateSourceEntryID: draft.privateEntryID,
            payload: PublicCommunityPayload(
                id: draft.id,
                topic: draft.title,
                body: draft.body,
                minorConfirmed: minorConfirmed
            ),
            state: .queued,
            serverPost: nil,
            lastError: nil
        )
    }
}

public struct CommunityPublicationSnapshot: Codable, Equatable, Sendable {
    public var publications: [CommunityPublication]
    public init(publications: [CommunityPublication] = []) {
        self.publications = publications
    }
}

public protocol CommunityPublicationStoreProtocol: AnyObject {
    func load() throws -> CommunityPublicationSnapshot
    func save(_ snapshot: CommunityPublicationSnapshot) throws
}

public final class ApplicationSupportCommunityPublicationStore: CommunityPublicationStoreProtocol {
    private let fileURL: URL

    public convenience init(fileManager: FileManager = .default) throws {
        let directory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("LifeDiary", isDirectory: true)
        try self.init(directoryURL: directory, fileManager: fileManager)
    }

    public init(directoryURL: URL, fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        fileURL = directoryURL.appendingPathComponent("community-publications.json")
    }

    public func load() throws -> CommunityPublicationSnapshot {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return .init() }
        return try JSONDecoder().decode(CommunityPublicationSnapshot.self, from: Data(contentsOf: fileURL))
    }

    public func save(_ snapshot: CommunityPublicationSnapshot) throws {
        try JSONEncoder().encode(snapshot).write(to: fileURL, options: .atomic)
    }
}

@MainActor
public final class CommunityPublisher: ObservableObject {
    @Published public private(set) var publications: [CommunityPublication]
    @Published public private(set) var isWorking = false
    @Published public private(set) var lastError: String?

    private let store: CommunityPublicationStoreProtocol
    private let client: CommunityClientProtocol

    public init(store: CommunityPublicationStoreProtocol, client: CommunityClientProtocol) throws {
        self.store = store
        self.client = client
        let loaded = try store.load().publications
        publications = loaded.map { item in
            var migrated = item
            if migrated.payload.id == nil { migrated.payload.id = migrated.id }
            return migrated
        }
        if publications != loaded { try persist() }
    }

    @discardableResult
    public func publish(_ draft: CommunityDraft) async throws -> CommunityPublication {
        if publications.contains(where: { $0.id == draft.id }) {
            try await retryPublication(id: draft.id)
            guard let existing = publications.first(where: { $0.id == draft.id }) else {
                throw CommunityPublicationError.failedStatePersistenceFailed
            }
            return existing
        }
        var publication = CommunityPublication.queued(draft: draft)
        let previous = publications
        publications.insert(publication, at: 0)
        do {
            try persist()
        } catch {
            publications = previous
            lastError = CommunityPublicationError.initialQueuePersistenceFailed.localizedDescription
            throw CommunityPublicationError.initialQueuePersistenceFailed
        }
        isWorking = true
        lastError = nil
        defer { isWorking = false }
        do {
            publication.serverPost = try await client.createPost(publication.payload)
        } catch {
            publication.state = .failed
            publication.lastError = error.localizedDescription
            replace(publication)
            do {
                try persist()
            } catch {
                lastError = CommunityPublicationError.failedStatePersistenceFailed.localizedDescription
                throw CommunityPublicationError.failedStatePersistenceFailed
            }
            lastError = error.localizedDescription
            throw error
        }
        publication.state = .published
        publication.lastError = nil
        replace(publication)
        do {
            try persist()
        } catch {
            lastError = CommunityPublicationError.publishedStatePersistenceFailed.localizedDescription
            throw CommunityPublicationError.publishedStatePersistenceFailed
        }
        return publication
    }

    public func retryPending() async throws {
        guard !isWorking else { return }
        isWorking = true
        lastError = nil
        defer { isWorking = false }
        let pendingIDs = publications.filter { $0.state != .published }.map(\.id)
        for id in pendingIDs {
            try await retryPublication(id: id)
        }
    }

    private func retryPublication(id: UUID) async throws {
        guard var publication = publications.first(where: { $0.id == id }), publication.state != .published else {
            return
        }
        do {
            publication.serverPost = try await client.createPost(publication.payload)
        } catch {
            publication.state = .failed
            publication.lastError = error.localizedDescription
            replace(publication)
            do {
                try persist()
            } catch {
                lastError = CommunityPublicationError.failedStatePersistenceFailed.localizedDescription
                throw CommunityPublicationError.failedStatePersistenceFailed
            }
            lastError = error.localizedDescription
            return
        }
        publication.state = .published
        publication.lastError = nil
        replace(publication)
        do {
            try persist()
        } catch {
            lastError = CommunityPublicationError.publishedStatePersistenceFailed.localizedDescription
            throw CommunityPublicationError.publishedStatePersistenceFailed
        }
    }

    private func replace(_ publication: CommunityPublication) {
        guard let index = publications.firstIndex(where: { $0.id == publication.id }) else { return }
        publications[index] = publication
    }

    private func persist() throws {
        try store.save(CommunityPublicationSnapshot(publications: publications))
    }
}
