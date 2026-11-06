import Combine
import Foundation

struct MinorPromptState: Codable, Equatable, Sendable {
    var identityKey: String?
    var eligible = false
    var dismissedUntilNextEvent = false
    var suppressedUntil: Date?
    var permanentlySuppressed = false
}

protocol MinorPromptStoreProtocol: AnyObject {
    func load() throws -> MinorPromptState
    func save(_ state: MinorPromptState) throws
}

final class UserDefaultsMinorPromptStore: MinorPromptStoreProtocol {
    private let defaults: UserDefaults
    private let key = "life.minor.prompt.state"
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    func load() throws -> MinorPromptState {
        guard let data = defaults.data(forKey: key) else { return MinorPromptState() }
        return try JSONDecoder().decode(MinorPromptState.self, from: data)
    }
    func save(_ state: MinorPromptState) throws { defaults.set(try JSONEncoder().encode(state), forKey: key) }
}

final class MinorPromptCoordinator: ObservableObject {
    @Published private(set) var state: MinorPromptState
    private let store: MinorPromptStoreProtocol
    init(store: MinorPromptStoreProtocol) throws { self.store = store; state = try store.load() }

    func handleMinorLoginResult(accountID: String, isMinor: Bool) throws {
        try apply(identity: "passport:\(accountID)", isMinor: isMinor)
    }
    func completeOfflineAgeProfile(isMinor: Bool) throws { try apply(identity: "offline-profile", isMinor: isMinor) }
    func shouldPresent(at date: Date = .now) -> Bool {
        state.eligible && !state.permanentlySuppressed && !state.dismissedUntilNextEvent && (state.suppressedUntil.map { date >= $0 } ?? true)
    }
    func remindLater() throws { state.dismissedUntilNextEvent = true; try persist() }
    func suppressForSevenDays(from date: Date = .now, calendar: Calendar = .current) throws {
        state.suppressedUntil = calendar.date(byAdding: .day, value: 7, to: date)
        state.dismissedUntilNextEvent = false
        try persist()
    }
    func suppressPermanently() throws { state.permanentlySuppressed = true; try persist() }
    func restorePrompts() throws {
        state.permanentlySuppressed = false; state.suppressedUntil = nil; state.dismissedUntilNextEvent = false; try persist()
    }
    private func apply(identity: String, isMinor: Bool) throws {
        if state.identityKey != identity || !isMinor { state = MinorPromptState(identityKey: identity) }
        if isMinor { state.eligible = true; state.dismissedUntilNextEvent = false }
        try persist()
    }
    private func persist() throws { try store.save(state) }
}
