import Foundation

public struct HealthToolSettings: Codable, Equatable, Sendable {
    public var periodEnabled = false
    public var latestPeriodStart: Date?
    public var cycleLength = 28
    public var smokingEnabled = false
    public var smokeFreeStartedAt: Date?
    public var cigarettesPerDay = 10
    public var pricePerPack = 20

    public init() {}
}

public protocol HealthSettingsStoreProtocol: AnyObject {
    func load() throws -> HealthToolSettings
    func save(_ settings: HealthToolSettings) throws
}

public final class UserDefaultsHealthSettingsStore: HealthSettingsStoreProtocol {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "life.health.settings") {
        self.defaults = defaults
        self.key = key
    }

    public func load() throws -> HealthToolSettings {
        guard let data = defaults.data(forKey: key) else { return HealthToolSettings() }
        return try JSONDecoder().decode(HealthToolSettings.self, from: data)
    }

    public func save(_ settings: HealthToolSettings) throws {
        defaults.set(try JSONEncoder().encode(settings), forKey: key)
    }
}
