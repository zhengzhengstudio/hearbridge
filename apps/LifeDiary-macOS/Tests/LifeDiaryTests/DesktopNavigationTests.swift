import AppKit
import Foundation
import XCTest
@testable import LifeDiary

final class DesktopNavigationTests: XCTestCase {
    func testSidebarGroupsUseDesktopInformationArchitecture() {
        XCTAssertEqual(LifeSection.record.map(\.title), ["今天", "个人日记", "健康记录", "记账"])
        XCTAssertEqual(LifeSection.connection.map(\.title), ["公共日记", "好友", "消息"])
        XCTAssertEqual(LifeSection.support.map(\.title), ["陪伴", "铮铮通行证"])
    }

    func testDesktopCommandsExposeExpectedKeyboardPaths() {
        XCTAssertEqual(LifeCommand.newEntry.shortcut, "⌘N")
        XCTAssertEqual(LifeCommand.focusSearch.shortcut, "⌘F")
        XCTAssertEqual(LifeCommand.export.shortcut, "⇧⌘E")
        XCTAssertEqual(LifeCommand.lock.shortcut, "⇧⌘L")
        XCTAssertEqual(LifeCommand.checkForUpdates.shortcut, "⌘U")
    }
}

@MainActor
final class LocalFirstRepositoryTests: XCTestCase {
    func testSaveCommitsLocallyBeforeFailedNetworkSyncAndSurvivesRestart() async throws {
        let store = MemoryDiaryStore()
        let api = FailingDiaryAPI()
        let repository = try LifeRepository(store: store, api: api)
        let entry = DiaryEntry(title: "纸页", body: "一阵晚风")

        try await repository.save(entry: entry)

        XCTAssertEqual(repository.entries, [entry])
        XCTAssertEqual(repository.syncState, .pending(count: 1))
        let restored = try LifeRepository(store: store, api: api)
        XCTAssertEqual(restored.entries, [entry])
        XCTAssertEqual(restored.syncState, .pending(count: 1))
    }

    func testFailedDiskCommitDoesNotClaimEntryWasSaved() async throws {
        let store = MemoryDiaryStore()
        store.shouldFailWrites = true
        let repository = try LifeRepository(store: store, api: FailingDiaryAPI())

        await XCTAssertThrowsAsyncError {
            try await repository.save(entry: DiaryEntry(title: "不能丢", body: "正文"))
        }

        XCTAssertTrue(repository.entries.isEmpty)
    }
}

final class SecurityAndServiceTests: XCTestCase {
    func testPublicPayloadUsesStableIDAndNeverEncodesPrivateSourceID() throws {
        let source = DiaryEntry(title: "私密标题", body: "可公开正文")
        let draft = CommunityDraft(copying: source)
        let first = draft.publicPayload(minorConfirmed: true)
        let second = draft.publicPayload(minorConfirmed: true)
        let encoded = try JSONEncoder().encode(first)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(Set(object.keys), ["id", "topic", "body", "minorConfirmed"])
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains(source.id.uuidString))
    }

    func testCredentialsUseOneAtomicKeychainValue() throws {
        let keychain = MemoryKeychain()
        let store = AuthTokenStore(keychain: keychain)

        try store.save(accessToken: "token", accountID: "account")

        XCTAssertEqual(try store.load(), AuthCredentials(accessToken: "token", accountID: "account"))
        XCTAssertEqual(Set(keychain.values.keys), ["credentials"])
    }

    func testAuthenticatedServiceRejectsRequestBeforeTransportWithoutPassport() async throws {
        let transport = RecordingTransport()
        let client = LifeAPIClient(
            baseURL: URL(string: "https://life.example")!,
            accessToken: { nil },
            transport: transport
        )

        await XCTAssertThrowsAsyncError {
            _ = try await client.listFriends()
        }

        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testHealthCalculationsMatchLocalPrivacySemantics() {
        let calendar = Calendar(identifier: .gregorian)
        let start = Date(timeIntervalSince1970: 1_767_225_600)
        let prediction = PeriodPrediction.nextStart(latest: start, cycleLength: 28, calendar: calendar)
        XCTAssertEqual(prediction, calendar.date(byAdding: .day, value: 28, to: start))

        let stats = SmokingStatistics.make(
            startedAt: start,
            asOf: calendar.date(byAdding: .day, value: 10, to: start)!,
            cigarettesPerDay: 12,
            pricePerPack: 24,
            calendar: calendar
        )
        XCTAssertEqual(stats, SmokingStatistics(daysSmokeFree: 10, cigarettesAvoided: 120, moneySaved: 144))
    }

    func testMinorReminderRequiresRealMinorEventAndSevenDaySuppressionExpires() throws {
        let store = MemoryMinorStore()
        let coordinator = try MinorPromptCoordinator(store: store)
        let start = Date(timeIntervalSince1970: 100)
        try coordinator.handleMinorLoginResult(accountID: "adult", isMinor: false)
        XCTAssertFalse(coordinator.shouldPresent(at: start))
        try coordinator.completeOfflineAgeProfile(isMinor: true)
        XCTAssertTrue(coordinator.shouldPresent(at: start))
        try coordinator.suppressForSevenDays(from: start, calendar: Calendar(identifier: .gregorian))
        XCTAssertFalse(coordinator.shouldPresent(at: start.addingTimeInterval(7 * 86_400 - 1)))
        XCTAssertTrue(coordinator.shouldPresent(at: start.addingTimeInterval(7 * 86_400)))
    }

    @MainActor
    func testPassportUsesAuthorizationCodePKCEAndForwardsMinorLoginEvent() async throws {
        let credentials = AuthTokenStore(keychain: MemoryKeychain())
        let starter = PassportStarterStub()
        let exchange = PassportExchangeStub()
        var challenges = ["state-1234567890", "nonce-1234567890", String(repeating: "v", count: 64)]
        let session = PassportSession(
            tokenStore: credentials,
            challengeGenerator: { challenges.removeFirst() },
            starter: starter,
            exchangeClient: exchange
        )
        var event: (String, Bool)?
        session.onMinorLoginResult = { event = ($0, $1) }

        session.beginAuthorization(anchor: nil)
        XCTAssertEqual(session.authorizationStatus, .authorizing)
        XCTAssertEqual(starter.callbackScheme, "lifediary")
        XCTAssertEqual(starter.url?.path, "/api/zz-pass/native/authorize")
        XCTAssertEqual(URLComponents(url: starter.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code_challenge_method" })?.value, "S256")
        await session.handleCallback(URL(string: "lifediary://passport/callback?code=one-time-code&state=state-1234567890")!)

        XCTAssertEqual(session.authorizationStatus, .authenticated)
        XCTAssertEqual(exchange.verifier, String(repeating: "v", count: 64))
        XCTAssertEqual(event?.0, "child")
        XCTAssertEqual(event?.1, true)
    }

    @MainActor
    func testPassportIgnoresDuplicateBeginAndCancellationConsumesChallenge() async {
        let starter = PassportStarterStub()
        var challenges = ["state-1234567890", "nonce-1234567890", String(repeating: "v", count: 64)]
        let session = PassportSession(
            tokenStore: AuthTokenStore(keychain: MemoryKeychain()),
            challengeGenerator: { challenges.removeFirst() },
            starter: starter,
            exchangeClient: PassportExchangeStub()
        )
        session.beginAuthorization(anchor: nil)
        session.beginAuthorization(anchor: nil)
        XCTAssertEqual(starter.startCount, 1)
        session.cancelAuthorization()
        await session.handleCallback(URL(string: "lifediary://passport/callback?code=late&state=state-1234567890")!)
        XCTAssertEqual(session.authorizationStatus, .failed(.invalidCallback))
    }
}

private final class MemoryDiaryStore: DiaryStoreProtocol {
    var snapshot = DiaryStoreSnapshot()
    var shouldFailWrites = false
    func load() throws -> DiaryStoreSnapshot { snapshot }
    func save(_ snapshot: DiaryStoreSnapshot) throws {
        if shouldFailWrites { throw TestError.expected }
        self.snapshot = snapshot
    }
}

private final class FailingDiaryAPI: LifeAPIClientProtocol {
    func sync(_ mutations: [PendingMutation]) async throws -> SyncResponse { throw TestError.expected }
}

private final class MemoryKeychain: KeychainClientProtocol {
    var values: [String: String] = [:]
    func read(service: String, account: String) throws -> String? { values[account] }
    func write(_ value: String, service: String, account: String) throws { values[account] = value }
    func remove(service: String, account: String) throws { values.removeValue(forKey: account) }
}

private final class RecordingTransport: HTTPTransportProtocol {
    var requests: [URLRequest] = []
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        throw TestError.expected
    }
}

private final class MemoryMinorStore: MinorPromptStoreProtocol {
    var state = MinorPromptState()
    func load() throws -> MinorPromptState { state }
    func save(_ state: MinorPromptState) throws { self.state = state }
}

@MainActor
private final class PassportStarterStub: PassportAuthorizationStarting {
    var callbackScheme: String?
    var url: URL?
    var startCount = 0
    func start(url: URL, callbackScheme: String, anchor: NSWindow?, completion: @escaping (URL?, Error?) -> Void) -> Bool {
        self.callbackScheme = callbackScheme
        self.url = url
        startCount += 1
        return true
    }
    func cancel() {}
}

@MainActor
private final class PassportExchangeStub: PassportCodeExchanging {
    var verifier: String?
    func exchange(code: String, verifier: String) async throws -> PassportExchangeResponse {
        self.verifier = verifier
        return PassportExchangeResponse(accessToken: "token", accountID: "child", isMinor: true, nonce: "nonce-1234567890")
    }
}

private enum TestError: Error { case expected }

private func XCTAssertThrowsAsyncError(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected error", file: file, line: line)
    } catch {}
}
