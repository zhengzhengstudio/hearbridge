import Foundation

@MainActor
public protocol LifeRepositoryProtocol: AnyObject {
    var entries: [DiaryEntry] { get }
    var syncState: SyncState { get }
    func save(entry: DiaryEntry) async throws
    func deleteEntry(id: UUID) async throws
    func sync() async
}

public protocol DiaryStoreProtocol: AnyObject {
    func load() throws -> DiaryStoreSnapshot
    func save(_ snapshot: DiaryStoreSnapshot) throws
}

public final class ApplicationSupportDiaryStore: DiaryStoreProtocol {
    private let fileURL: URL
    private let fileManager: FileManager
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

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
        self.fileManager = fileManager
        let directory = directoryURL
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("diary-store.json")
    }

    public func load() throws -> DiaryStoreSnapshot {
        guard fileManager.fileExists(atPath: fileURL.path) else { return DiaryStoreSnapshot() }
        return try decoder.decode(DiaryStoreSnapshot.self, from: Data(contentsOf: fileURL))
    }

    public func save(_ snapshot: DiaryStoreSnapshot) throws {
        let data = try encoder.encode(snapshot)
        try data.write(to: fileURL, options: .atomic)
    }
}

@MainActor
public final class LifeRepository: LifeRepositoryProtocol {
    public private(set) var entries: [DiaryEntry]
    public private(set) var syncState: SyncState

    private let store: DiaryStoreProtocol
    private let api: LifeAPIClientProtocol
    private var pendingMutations: [PendingMutation]
    private var isSyncPumpRunning = false

    public init(store: DiaryStoreProtocol, api: LifeAPIClientProtocol) throws {
        let snapshot = try store.load()
        self.store = store
        self.api = api
        entries = snapshot.entries
        pendingMutations = snapshot.pendingMutations
        syncState = snapshot.pendingMutations.isEmpty ? .idle : .pending(count: snapshot.pendingMutations.count)
    }

    public func save(entry: DiaryEntry) async throws {
        var candidateEntries = entries
        if let index = candidateEntries.firstIndex(where: { $0.id == entry.id }) {
            candidateEntries[index] = entry
        } else {
            candidateEntries.append(entry)
        }
        let candidatePendingMutations = pendingMutations + [.upsert(entry)]
        try commit(
            DiaryStoreSnapshot(
                entries: candidateEntries,
                pendingMutations: candidatePendingMutations
            )
        )
        await sync()
    }

    public func deleteEntry(id: UUID) async throws {
        let candidateEntries = entries.filter { $0.id != id }
        let candidatePendingMutations = pendingMutations + [.delete(id)]
        try commit(
            DiaryStoreSnapshot(
                entries: candidateEntries,
                pendingMutations: candidatePendingMutations
            )
        )
        await sync()
    }

    public func sync() async {
        guard !isSyncPumpRunning else { return }
        guard !pendingMutations.isEmpty else {
            syncState = .idle
            return
        }

        isSyncPumpRunning = true
        defer { isSyncPumpRunning = false }

        while !pendingMutations.isEmpty {
            let batch = pendingMutations
            syncState = .syncing

            do {
                try await api.sync(batch)
            } catch {
                syncState = .pending(count: pendingMutations.count)
                return
            }

            guard pendingMutations.starts(with: batch) else {
                syncState = .failed
                return
            }

            let acknowledgedSnapshot = DiaryStoreSnapshot(
                entries: entries,
                pendingMutations: Array(pendingMutations.dropFirst(batch.count))
            )
            do {
                try commit(acknowledgedSnapshot)
            } catch {
                syncState = .pending(count: pendingMutations.count)
                return
            }
        }

        syncState = .idle
    }

    public func resumePendingSync() async {
        await sync()
    }

    private func commit(_ snapshot: DiaryStoreSnapshot) throws {
        try store.save(snapshot)
        entries = snapshot.entries
        pendingMutations = snapshot.pendingMutations
        if pendingMutations.isEmpty {
            syncState = .idle
        } else if isSyncPumpRunning {
            syncState = .syncing
        } else {
            syncState = .pending(count: pendingMutations.count)
        }
    }
}
