import Combine
import Foundation

public struct MinorPromptState: Codable, Equatable, Sendable {
    public var identityKey: String?
    public var eligible: Bool
    public var dismissedUntilNextEvent: Bool
    public var suppressedUntil: Date?
    public var permanentlySuppressed: Bool

    public init(
        identityKey: String? = nil,
        eligible: Bool = false,
        dismissedUntilNextEvent: Bool = false,
        suppressedUntil: Date? = nil,
        permanentlySuppressed: Bool = false
    ) {
        self.identityKey = identityKey
        self.eligible = eligible
        self.dismissedUntilNextEvent = dismissedUntilNextEvent
        self.suppressedUntil = suppressedUntil
        self.permanentlySuppressed = permanentlySuppressed
    }
}

public protocol MinorPromptStoreProtocol: AnyObject {
    func load() throws -> MinorPromptState
    func save(_ state: MinorPromptState) throws
}

public final class UserDefaultsMinorPromptStore: MinorPromptStoreProtocol {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "life.minor.prompt.state") {
        self.defaults = defaults
        self.key = key
    }

    public func load() throws -> MinorPromptState {
        guard let data = defaults.data(forKey: key) else { return MinorPromptState() }
        return try JSONDecoder().decode(MinorPromptState.self, from: data)
    }

    public func save(_ state: MinorPromptState) throws {
        defaults.set(try JSONEncoder().encode(state), forKey: key)
    }
}

public final class MinorPromptCoordinator: ObservableObject {
    @Published public private(set) var state: MinorPromptState
    private let store: MinorPromptStoreProtocol

    public init(store: MinorPromptStoreProtocol) throws {
        self.store = store
        state = try store.load()
    }

    public func handleMinorLoginResult(accountID: String, isMinor: Bool) throws {
        try applyIdentityResult(identityKey: "passport:\(accountID)", isMinor: isMinor)
    }

    public func completeOfflineAgeProfile(isMinor: Bool) throws {
        try applyIdentityResult(identityKey: "offline-profile", isMinor: isMinor)
    }

    public func shouldPresent(at date: Date = Date()) -> Bool {
        guard state.eligible, !state.permanentlySuppressed, !state.dismissedUntilNextEvent else { return false }
        return state.suppressedUntil.map { date >= $0 } ?? true
    }

    public func remindLater() throws {
        state.dismissedUntilNextEvent = true
        try persist()
    }

    public func suppressForSevenDays(from date: Date = Date(), calendar: Calendar = .current) throws {
        state.suppressedUntil = calendar.date(byAdding: .day, value: 7, to: date)
        state.dismissedUntilNextEvent = false
        try persist()
    }

    public func suppressPermanently() throws {
        state.permanentlySuppressed = true
        try persist()
    }

    public func restorePrompts() throws {
        state.permanentlySuppressed = false
        state.suppressedUntil = nil
        state.dismissedUntilNextEvent = false
        try persist()
    }

    private func persist() throws {
        try store.save(state)
    }

    private func applyIdentityResult(identityKey: String, isMinor: Bool) throws {
        if state.identityKey != identityKey || !isMinor {
            state = MinorPromptState(identityKey: identityKey)
        }
        if isMinor {
            state.eligible = true
            state.dismissedUntilNextEvent = false
        }
        try persist()
    }
}
