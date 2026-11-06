import Foundation
import XCTest
@testable import LifeDiaryCore

@MainActor
final class LifeRepositoryTests: XCTestCase {
    func testSaveCommitsLocallyBeforeRemoteSync() async throws {
        let store = MemoryDiaryStore()
        let api = APIStub(result: .failure(TestError.offline))
        let repository = try LifeRepository(store: store, api: api)

        try await repository.save(entry: .fixture(title: "今天"))

        XCTAssertEqual(repository.entries.count, 1)
        XCTAssertEqual(try store.load().entries.count, 1)
        XCTAssertEqual(repository.syncState, .pending(count: 1))
    }

    func testSavePersistsCandidateBeforeCallingRemoteAPI() async throws {
        let events = EventLog()
        let store = MemoryDiaryStore(events: events)
        let api = APIStub(result: .failure(TestError.offline), events: events)
        let repository = try LifeRepository(store: store, api: api)

        try await repository.save(entry: .fixture(title: "先落盘"))

        XCTAssertEqual(events.values, ["store.save", "api.sync"])
    }

    func testSaveFailureDoesNotCommitMemoryOrCallRemoteAPI() async throws {
        let existing = DiaryEntry.fixture(title: "原记录")
        let store = ScriptedDiaryStore(
            snapshot: DiaryStoreSnapshot(entries: [existing]),
            failingSaveCalls: [1]
        )
        let api = APIStub(result: .success(()))
        let repository = try LifeRepository(store: store, api: api)

        await XCTAssertThrowsErrorAsync {
            try await repository.save(entry: .fixture(title: "未落盘"))
        }

        XCTAssertEqual(repository.entries, [existing])
        XCTAssertEqual(repository.syncState, .idle)
        XCTAssertEqual(try store.load(), DiaryStoreSnapshot(entries: [existing]))
        XCTAssertTrue(api.batches.isEmpty)
    }

    func testDeleteFailureDoesNotCommitMemoryOrCallRemoteAPI() async throws {
        let existing = DiaryEntry.fixture(title: "不能丢")
        let store = ScriptedDiaryStore(
            snapshot: DiaryStoreSnapshot(entries: [existing]),
            failingSaveCalls: [1]
        )
        let api = APIStub(result: .success(()))
        let repository = try LifeRepository(store: store, api: api)

        await XCTAssertThrowsErrorAsync {
            try await repository.deleteEntry(id: existing.id)
        }

        XCTAssertEqual(repository.entries, [existing])
        XCTAssertEqual(repository.syncState, .idle)
        XCTAssertEqual(try store.load(), DiaryStoreSnapshot(entries: [existing]))
        XCTAssertTrue(api.batches.isEmpty)
    }

    func testSuccessfulAPIAcknowledgementPersistenceFailureKeepsPendingBatch() async throws {
        let entry = DiaryEntry.fixture(title: "待确认")
        let store = ScriptedDiaryStore(failingSaveCalls: [2])
        let api = APIStub(result: .success(()))
        let repository = try LifeRepository(store: store, api: api)

        try await repository.save(entry: entry)

        XCTAssertEqual(api.batches, [[.upsert(entry)]])
        XCTAssertEqual(repository.entries, [entry])
        XCTAssertEqual(repository.syncState, .pending(count: 1))
        XCTAssertEqual(
            try store.load(),
            DiaryStoreSnapshot(entries: [entry], pendingMutations: [.upsert(entry)])
        )
    }

    func testLoadFailureIsExplicitAndCannotCreateAnEmptyWritableRepository() {
        let store = ScriptedDiaryStore(loadError: TestError.unreadable)
        let api = APIStub(result: .success(()))

        XCTAssertThrowsError(try LifeRepository(store: store, api: api)) { error in
            XCTAssertEqual(error as? TestError, .unreadable)
        }
        XCTAssertEqual(store.saveAttempts, 0)
        XCTAssertTrue(api.batches.isEmpty)
    }

    func testPendingMutationsCanBeRetriedImmediatelyAfterStartup() async throws {
        let entry = DiaryEntry.fixture(title: "离线记录")
        let store = MemoryDiaryStore(
            snapshot: DiaryStoreSnapshot(entries: [entry], pendingMutations: [.upsert(entry)])
        )
        let api = APIStub(result: .success(()))
        let repository = try LifeRepository(store: store, api: api)

        await repository.resumePendingSync()

        XCTAssertEqual(api.batches, [[.upsert(entry)]])
        XCTAssertEqual(repository.syncState, .idle)
        XCTAssertTrue(try store.load().pendingMutations.isEmpty)
    }

    func testSyncPumpSerializesImmutableBatchesAndKeepsMutationSavedAcrossAwait() async throws {
        let first = DiaryEntry.fixture(title: "A")
        let second = DiaryEntry.fixture(title: "B")
        let store = MemoryDiaryStore()
        let api = PausingAPI()
        let repository = try LifeRepository(store: store, api: api)

        let firstSave = Task { try await repository.save(entry: first) }
        await fulfillment(of: [api.firstCallStarted], timeout: 2)

        try await repository.save(entry: second)

        XCTAssertEqual(api.batches, [[.upsert(first)]])
        XCTAssertEqual(
            try store.load().pendingMutations,
            [.upsert(first), .upsert(second)]
        )

        api.resumeFirstCall()
        try await firstSave.value

        XCTAssertEqual(api.batches, [[.upsert(first)], [.upsert(second)]])
        XCTAssertEqual(repository.entries, [first, second])
        XCTAssertEqual(repository.syncState, .idle)
        XCTAssertTrue(try store.load().pendingMutations.isEmpty)
    }

    func testApplicationSupportStoreAtomicallyReplacesAndReloadsSnapshot() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let firstEntry = DiaryEntry.fixture(title: "第一版")
        let secondEntry = DiaryEntry.fixture(title: "第二版")
        let firstSnapshot = DiaryStoreSnapshot(
            entries: [firstEntry],
            pendingMutations: [.upsert(firstEntry)]
        )
        let secondSnapshot = DiaryStoreSnapshot(
            entries: [firstEntry, secondEntry],
            pendingMutations: [.upsert(secondEntry)]
        )

        let store = try ApplicationSupportDiaryStore(directoryURL: directory)
        try store.save(firstSnapshot)
        XCTAssertEqual(
            try ApplicationSupportDiaryStore(directoryURL: directory).load(),
            firstSnapshot
        )

        try store.save(secondSnapshot)

        XCTAssertEqual(
            try ApplicationSupportDiaryStore(directoryURL: directory).load(),
            secondSnapshot
        )
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: directory.path),
            ["diary-store.json"]
        )
    }

    func testApplicationSupportStorePropagatesCorruptFileLoadError() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not-json".utf8).write(to: directory.appendingPathComponent("diary-store.json"))

        let store = try ApplicationSupportDiaryStore(directoryURL: directory)

        XCTAssertThrowsError(try store.load())
    }

    func testPrivateDiaryAndCommunityPostAreSeparateObjects() {
        let entry = DiaryEntry.fixture(title: "只给自己看的记录", body: "private body")
        let draft = CommunityDraft(privateEntryID: entry.id, title: "公开标题", body: "public body")
        let post = draft.makePublicPost()

        XCTAssertNotEqual(post.id, entry.id)
        XCTAssertEqual(post.sourceEntryID, entry.id)
        XCTAssertEqual(entry.body, "private body")
        XCTAssertEqual(post.body, "public body")
    }

    func testPeriodPredictionIsPureAndUsesLatestRecord() {
        let calendar = Calendar(identifier: .gregorian)
        let latest = date("2026-07-01", calendar: calendar)
        let earlier = date("2026-06-03", calendar: calendar)

        let prediction = PeriodPrediction.nextStart(
            records: [PeriodRecord(startDate: earlier), PeriodRecord(startDate: latest)],
            cycleLength: 28,
            calendar: calendar
        )

        XCTAssertEqual(prediction, date("2026-07-29", calendar: calendar))
    }

    func testSmokingStatisticsIsPure() {
        let calendar = Calendar(identifier: .gregorian)
        let statistics = SmokingStatistics.make(
            startedAt: date("2026-07-01", calendar: calendar),
            asOf: date("2026-07-11", calendar: calendar),
            cigarettesPerDay: 12,
            pricePerPack: 24,
            cigarettesPerPack: 20,
            calendar: calendar
        )

        XCTAssertEqual(statistics.daysSmokeFree, 10)
        XCTAssertEqual(statistics.cigarettesAvoided, 120)
        XCTAssertEqual(statistics.moneySaved, 144)
    }

    func testAuthTokenStorePersistsOnlyAccessTokenAndAccountIDThroughKeychain() throws {
        let keychain = RecordingKeychain()
        let store = AuthTokenStore(keychain: keychain)

        try store.save(accessToken: "access-token", accountID: "account-7")

        XCTAssertEqual(try store.load(), AuthCredentials(accessToken: "access-token", accountID: "account-7"))
        XCTAssertEqual(Set(keychain.values.keys), ["credentials"])
        let encoded = try XCTUnwrap(keychain.values["credentials"])
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: String]
        )
        XCTAssertEqual(
            object,
            ["accessToken": "access-token", "accountID": "account-7"]
        )
    }

    func testAuthTokenStoreWriteFailurePreservesPreviouslyCommittedCredentials() throws {
        let keychain = RecordingKeychain()
        let store = AuthTokenStore(keychain: keychain)
        let original = AuthCredentials(accessToken: "old-token", accountID: "old-account")
        try store.save(accessToken: original.accessToken, accountID: original.accountID)
        keychain.failingAccounts = ["accountID", "credentials"]

        XCTAssertThrowsError(
            try store.save(accessToken: "new-token", accountID: "new-account")
        )

        keychain.failingAccounts = []
        XCTAssertEqual(try store.load(), original)
    }

    func testPassportAuthorizationURLCarriesFreshStateAndNonce() {
        let tokenStore = AuthTokenStore(keychain: RecordingKeychain())
        let challenges = ChallengeSequence(["state-123", "nonce-456", String(repeating: "v", count: 43)])
        let session = PassportSession(
            tokenStore: tokenStore,
            challengeGenerator: challenges.next
        )

        session.beginAuthorization()

        XCTAssertEqual(queryValue("state", in: session.authorizationURL), "state-123")
        XCTAssertEqual(queryValue("nonce", in: session.authorizationURL), "nonce-456")
        XCTAssertEqual(queryValue("code_challenge_method", in: session.authorizationURL), "S256")
        XCTAssertNotNil(queryValue("code_challenge", in: session.authorizationURL))
    }

    func testPassportDefaultChallengeGeneratorDoesNotReuseStateOrNonce() {
        let session = PassportSession(tokenStore: AuthTokenStore(keychain: RecordingKeychain()))

        session.beginAuthorization()
        let firstState = queryValue("state", in: session.authorizationURL)
        let firstNonce = queryValue("nonce", in: session.authorizationURL)
        session.beginAuthorization()
        let secondState = queryValue("state", in: session.authorizationURL)
        let secondNonce = queryValue("nonce", in: session.authorizationURL)

        XCTAssertGreaterThanOrEqual(firstState?.count ?? 0, 32)
        XCTAssertGreaterThanOrEqual(firstNonce?.count ?? 0, 32)
        XCTAssertNotEqual(firstState, firstNonce)
        XCTAssertNotEqual(firstState, secondState)
        XCTAssertNotEqual(firstNonce, secondNonce)
    }

    func testPassportCallbackStoresCredentialsForMatchingOneTimeChallenge() async throws {
        let keychain = RecordingKeychain()
        let tokenStore = AuthTokenStore(keychain: keychain)
        let challenges = ChallengeSequence(["state-123", "nonce-456", String(repeating: "v", count: 43)])
        let exchange = PassportExchangeStub(
            response: .init(accessToken: "token-1", accountID: "user-9", isMinor: false, nonce: "nonce-456")
        )
        let session = PassportSession(
            tokenStore: tokenStore,
            challengeGenerator: challenges.next,
            exchangeClient: exchange
        )
        session.beginAuthorization()

        await session.handleCallback(
            passportCallback(state: "state-123")
        )

        XCTAssertEqual(try tokenStore.load(), AuthCredentials(accessToken: "token-1", accountID: "user-9"))
        XCTAssertEqual(session.accountID, "user-9")
        XCTAssertNil(session.authorizationError)
        XCTAssertEqual(exchange.codes, ["authorization-code"])
        XCTAssertEqual(exchange.verifiers, [String(repeating: "v", count: 43)])
    }

    func testPassportRejectsCallbackWithoutActiveAuthorization() async throws {
        let keychain = RecordingKeychain()
        let session = PassportSession(tokenStore: AuthTokenStore(keychain: keychain))

        await session.handleCallback(
            passportCallback(state: "state-123")
        )

        XCTAssertTrue(keychain.values.isEmpty)
        XCTAssertEqual(session.authorizationError, .invalidCallback)
    }

    func testPassportRejectsCallbackSourceAndChallengeMismatchMatrix() async throws {
        let cases: [(name: String, url: URL)] = [
            (
                "scheme",
                URL(string: "https://passport/callback?code=authorization-code&state=state-123")!
            ),
            (
                "host",
                URL(string: "lifediary://attacker/callback?code=authorization-code&state=state-123")!
            ),
            (
                "path",
                URL(string: "lifediary://passport/not-callback?code=authorization-code&state=state-123")!
            ),
            (
                "missing state",
                URL(string: "lifediary://passport/callback?code=authorization-code")!
            ),
            (
                "wrong state",
                passportCallback(state: "wrong-state")
            ),
            (
                "missing code",
                URL(string: "lifediary://passport/callback?state=state-123")!
            )
        ]

        for callbackCase in cases {
            let keychain = RecordingKeychain()
            let challenges = ChallengeSequence(["state-123", "nonce-456", String(repeating: "v", count: 43)])
            let session = PassportSession(
                tokenStore: AuthTokenStore(keychain: keychain),
                challengeGenerator: challenges.next
            )
            session.beginAuthorization()

            await session.handleCallback(callbackCase.url)

            XCTAssertTrue(keychain.values.isEmpty, callbackCase.name)
            XCTAssertEqual(session.authorizationError, .invalidCallback, callbackCase.name)
        }
    }

    func testPassportRejectsNonceMismatchFromCodeExchange() async throws {
        let keychain = RecordingKeychain()
        let challenges = ChallengeSequence(["state-123", "nonce-456", String(repeating: "v", count: 43)])
        let exchange = PassportExchangeStub(
            response: .init(accessToken: "token-1", accountID: "user-9", isMinor: false, nonce: "attacker-nonce")
        )
        let session = PassportSession(
            tokenStore: AuthTokenStore(keychain: keychain),
            challengeGenerator: challenges.next,
            exchangeClient: exchange
        )
        session.beginAuthorization()

        await session.handleCallback(passportCallback(state: "state-123"))

        XCTAssertTrue(keychain.values.isEmpty)
        XCTAssertEqual(session.authorizationError, .invalidCallback)
    }

    func testPassportConsumesChallengeAndRejectsReplay() async throws {
        let keychain = RecordingKeychain()
        let tokenStore = AuthTokenStore(keychain: keychain)
        let challenges = ChallengeSequence(["state-123", "nonce-456", String(repeating: "v", count: 43)])
        let exchange = PassportExchangeStub(
            response: .init(accessToken: "token-1", accountID: "user-9", isMinor: false, nonce: "nonce-456")
        )
        let session = PassportSession(
            tokenStore: tokenStore,
            challengeGenerator: challenges.next,
            exchangeClient: exchange
        )
        let callback = passportCallback(state: "state-123")
        session.beginAuthorization()

        await session.handleCallback(callback)
        let writesAfterSuccess = keychain.writeAttempts
        await session.handleCallback(callback)

        XCTAssertEqual(try tokenStore.load(), AuthCredentials(accessToken: "token-1", accountID: "user-9"))
        XCTAssertEqual(keychain.writeAttempts, writesAfterSuccess)
        XCTAssertEqual(session.authorizationError, .invalidCallback)
        XCTAssertEqual(exchange.codes, ["authorization-code"])
    }

    private func date(_ string: String, calendar: Calendar) -> Date {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: string)!
    }

    private func passportCallback(state: String) -> URL {
        URL(
            string: "lifediary://passport/callback?code=authorization-code&state=\(state)"
        )!
    }

    private func queryValue(_ name: String, in url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == name })?
            .value
    }
}

private enum TestError: Error, Equatable {
    case offline
    case unreadable
    case persistence
}

final class EventLog {
    private(set) var values: [String] = []

    func append(_ value: String) {
        values.append(value)
    }
}

final class MemoryDiaryStore: DiaryStoreProtocol {
    private var snapshot = DiaryStoreSnapshot()
    private let events: EventLog?

    init(snapshot: DiaryStoreSnapshot = DiaryStoreSnapshot(), events: EventLog? = nil) {
        self.snapshot = snapshot
        self.events = events
    }

    func load() throws -> DiaryStoreSnapshot { snapshot }
    func save(_ snapshot: DiaryStoreSnapshot) throws {
        events?.append("store.save")
        self.snapshot = snapshot
    }
}

final class ScriptedDiaryStore: DiaryStoreProtocol {
    private var snapshot: DiaryStoreSnapshot
    private let loadError: Error?
    private let failingSaveCalls: Set<Int>
    private(set) var saveAttempts = 0

    init(
        snapshot: DiaryStoreSnapshot = DiaryStoreSnapshot(),
        loadError: Error? = nil,
        failingSaveCalls: Set<Int> = []
    ) {
        self.snapshot = snapshot
        self.loadError = loadError
        self.failingSaveCalls = failingSaveCalls
    }

    func load() throws -> DiaryStoreSnapshot {
        if let loadError {
            throw loadError
        }
        return snapshot
    }

    func save(_ snapshot: DiaryStoreSnapshot) throws {
        saveAttempts += 1
        if failingSaveCalls.contains(saveAttempts) {
            throw TestError.persistence
        }
        self.snapshot = snapshot
    }
}

final class APIStub: LifeAPIClientProtocol {
    let result: Result<Void, Error>
    private let events: EventLog?
    private(set) var batches: [[PendingMutation]] = []

    init(result: Result<Void, Error>, events: EventLog? = nil) {
        self.result = result
        self.events = events
    }

    func sync(_ mutations: [PendingMutation]) async throws {
        batches.append(mutations)
        events?.append("api.sync")
        try result.get()
    }
}

final class PausingAPI: LifeAPIClientProtocol {
    let firstCallStarted = XCTestExpectation(description: "first API call started")
    private(set) var batches: [[PendingMutation]] = []
    private var firstCallContinuation: CheckedContinuation<Void, Never>?

    func sync(_ mutations: [PendingMutation]) async throws {
        batches.append(mutations)
        guard batches.count == 1 else { return }
        firstCallStarted.fulfill()
        await withCheckedContinuation { continuation in
            firstCallContinuation = continuation
        }
    }

    func resumeFirstCall() {
        firstCallContinuation?.resume()
        firstCallContinuation = nil
    }
}

final class RecordingKeychain: KeychainClientProtocol {
    var values: [String: String] = [:]
    var failingAccounts: Set<String> = []
    private(set) var writeAttempts = 0

    func read(service: String, account: String) throws -> String? { values[account] }
    func write(_ value: String, service: String, account: String) throws {
        writeAttempts += 1
        if failingAccounts.contains(account) {
            throw TestError.persistence
        }
        values[account] = value
    }
    func remove(service: String, account: String) throws { values.removeValue(forKey: account) }
}

final class ChallengeSequence {
    private var values: [String]

    init(_ values: [String]) {
        self.values = values
    }

    func next() -> String {
        values.removeFirst()
    }
}

extension DiaryEntry {
    static func fixture(title: String = "", body: String = "") -> DiaryEntry {
        DiaryEntry(title: title, body: body, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0))
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {
        // Expected.
    }
}
