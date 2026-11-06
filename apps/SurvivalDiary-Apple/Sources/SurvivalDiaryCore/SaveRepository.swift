import Foundation

public actor SaveRepository {
    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(directory: URL) { self.directory = directory }

    public func load(slot: String) throws -> GameSave? {
        let candidates = [currentURL(slot), directory.appendingPathComponent("\(safe(slot)).previous.json")]
        var lastError: Error?
        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            do { return try decoder.decode(GameSave.self, from: Data(contentsOf: url)) }
            catch { lastError = error }
        }
        if let lastError { throw lastError }
        return nil
    }

    public func save(slot: String, state: GameSave) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let current = currentURL(slot); let previous = directory.appendingPathComponent("\(safe(slot)).previous.json")
        let pending = directory.appendingPathComponent("\(safe(slot)).pending.json")
        try encoder.encode(state).write(to: pending, options: [.atomic, .completeFileProtection])
        if FileManager.default.fileExists(atPath: previous.path) { try FileManager.default.removeItem(at: previous) }
        if FileManager.default.fileExists(atPath: current.path) { try FileManager.default.moveItem(at: current, to: previous) }
        try FileManager.default.moveItem(at: pending, to: current)
    }

    public func importLegacy(from selectedFile: URL, slot: String) throws -> GameSave {
        let imported = try decoder.decode(GameSave.self, from: Data(contentsOf: selectedFile))
        try save(slot: slot, state: imported)
        return imported
    }

    public func reset(slot: String) throws {
        for url in [currentURL(slot), directory.appendingPathComponent("\(safe(slot)).previous.json"), directory.appendingPathComponent("\(safe(slot)).pending.json")] {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        }
    }

    private func currentURL(_ slot: String) -> URL { directory.appendingPathComponent("\(safe(slot)).current.json") }
    private func safe(_ slot: String) -> String { String(slot.filter { $0.isLetter || $0.isNumber || $0 == "-" }.prefix(48)) }
}
