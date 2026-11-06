import Combine
import Foundation

protocol DiaryStoreProtocol: AnyObject {
    func load() throws -> DiaryStoreSnapshot
    func save(_ snapshot: DiaryStoreSnapshot) throws
}

final class ApplicationSupportDiaryStore: DiaryStoreProtocol {
    private let fileURL: URL
    private let fileManager: FileManager
    convenience init(fileManager: FileManager = .default) throws {
        let root = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        try self.init(directoryURL: root.appendingPathComponent("LifeDiary", isDirectory: true), fileManager: fileManager)
    }
    init(directoryURL: URL, fileManager: FileManager = .default) throws {
        self.fileManager = fileManager
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        fileURL = directoryURL.appendingPathComponent("diary-store.json")
    }
    func load() throws -> DiaryStoreSnapshot {
        guard fileManager.fileExists(atPath: fileURL.path) else { return DiaryStoreSnapshot() }
        return try JSONDecoder().decode(DiaryStoreSnapshot.self, from: Data(contentsOf: fileURL))
    }
    func save(_ snapshot: DiaryStoreSnapshot) throws { try JSONEncoder().encode(snapshot).write(to: fileURL, options: .atomic) }
}

@MainActor
final class LifeRepository: ObservableObject {
    @Published private(set) var entries: [DiaryEntry]
    @Published private(set) var syncState: SyncState
    @Published private(set) var conflicts: [SyncConflict] = []
    private let store: DiaryStoreProtocol
    private let api: LifeAPIClientProtocol
    private var pendingMutations: [PendingMutation]
    private var isSyncing = false

    init(store: DiaryStoreProtocol, api: LifeAPIClientProtocol) throws {
        let snapshot = try store.load()
        self.store = store; self.api = api
        entries = snapshot.entries; pendingMutations = snapshot.pendingMutations
        syncState = pendingMutations.isEmpty ? .idle : .pending(count: pendingMutations.count)
    }

    func save(entry: DiaryEntry) async throws {
        var candidate = entries
        if let index = candidate.firstIndex(where: { $0.id == entry.id }) { candidate[index] = entry }
        else { candidate.append(entry) }
        try commit(.init(entries: candidate, pendingMutations: pendingMutations + [.upsert(entry)]))
        await sync()
    }

    func deleteEntry(id: UUID) async throws {
        guard let entry = entries.first(where: { $0.id == id }) else { return }
        try commit(.init(entries: entries.filter { $0.id != id }, pendingMutations: pendingMutations + [.delete(entry)]))
        await sync()
    }

    func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        while !pendingMutations.isEmpty {
            let batch = Array(pendingMutations.prefix(50))
            syncState = .syncing
            do {
                let response = try await api.sync(batch)
                let acknowledged = Set(response.applied).union(response.record.appliedOperationIds)
                var revised = entries
                if let remote = response.record.domains["diary"] {
                    for index in revised.indices {
                        if let item = remote[revised[index].id.uuidString] { revised[index].revision = item.revision }
                    }
                }
                let remaining = pendingMutations.filter { !acknowledged.contains($0.id.uuidString) }
                try commit(.init(entries: revised, pendingMutations: remaining))
                conflicts = response.conflicts
                if !response.conflicts.isEmpty || acknowledged.isEmpty { syncState = .failed; return }
            } catch {
                syncState = .pending(count: pendingMutations.count)
                return
            }
        }
        syncState = .idle
    }

    func exportData() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(DiaryStoreSnapshot(entries: entries, pendingMutations: []))
    }

    private func commit(_ snapshot: DiaryStoreSnapshot) throws {
        try store.save(snapshot)
        entries = snapshot.entries.sorted { $0.updatedAt > $1.updatedAt }
        pendingMutations = snapshot.pendingMutations
        syncState = pendingMutations.isEmpty ? .idle : .pending(count: pendingMutations.count)
    }
}

final class HealthSettingsStore: ObservableObject {
    @Published var settings: HealthToolSettings { didSet { persist() } }
    private let defaults: UserDefaults
    private let key = "life.health.settings"
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        settings = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(HealthToolSettings.self, from: $0) } ?? HealthToolSettings()
    }
    private func persist() { defaults.set(try? JSONEncoder().encode(settings), forKey: key) }
}
