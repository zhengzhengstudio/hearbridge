import Combine
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import LifeDiaryCore

@MainActor
final class CommunityPublisherTests: XCTestCase {
    func testFailedPublicationSurvivesRestartAndSuccessfulRetry() async throws {
        let source = DiaryEntry.fixture(title: "私密标题", body: "公开副本")
        let store = MemoryCommunityPublicationStore()
        let client = CommunityClientStub(results: [
            .failure(OnlineTestError.offline),
            .success(.fixture(id: "server-1", body: "公开副本"))
        ])
        let publisher = try CommunityPublisher(store: store, client: client)

        await XCTAssertThrowsOnlineError {
            _ = try await publisher.publish(CommunityDraft(copying: source))
        }
        XCTAssertEqual(publisher.publications.map(\.state), [.failed])
        XCTAssertEqual(try store.load().publications.map(\.privateSourceEntryID), [source.id])

        let restored = try CommunityPublisher(store: store, client: client)
        try await restored.retryPending()

        XCTAssertEqual(restored.publications.map(\.state), [.published])
        XCTAssertEqual(restored.publications.first?.serverPost?.id, "server-1")
        XCTAssertEqual(try store.load().publications.map(\.state), [.published])
    }

    func testPublicPayloadNeverEncodesPrivateSourceIdentifier() throws {
        let sourceID = UUID()
        let publication = CommunityPublication.queued(
            draft: CommunityDraft(privateEntryID: sourceID, title: "标题", body: "正文")
        )

        let data = try JSONEncoder().encode(publication.payload)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(Set(object.keys), ["id", "body", "minorConfirmed", "topic"])
        XCTAssertEqual(object["id"] as? String, publication.id.uuidString)
        XCTAssertFalse(String(data: data, encoding: .utf8)!.contains(sourceID.uuidString))
    }

    func testLostAcknowledgementRetriesOneStablePublicIDWithoutDuplicatePost() async throws {
        let store = FailingCommunityPublicationStore()
        let client = IdempotentCommunityClient(loseFirstAcknowledgement: true)
        let publisher = try CommunityPublisher(store: store, client: client)
        let draft = CommunityDraft(privateEntryID: UUID(), title: "同一篇", body: "只公开一次")

        await XCTAssertThrowsOnlineError { _ = try await publisher.publish(draft) }
        try await publisher.retryPending()

        XCTAssertEqual(client.receivedIDs, [draft.id, draft.id])
        XCTAssertEqual(client.posts.count, 1)
        XCTAssertEqual(publisher.publications.first?.state, .published)
    }

    func testPublishedStatePersistenceFailureRetriesIdempotentlyAfterRestart() async throws {
        let store = FailingCommunityPublicationStore(failingSaveAttempts: [2])
        let client = IdempotentCommunityClient()
        let publisher = try CommunityPublisher(store: store, client: client)
        let draft = CommunityDraft(privateEntryID: UUID(), title: "已确认", body: "落盘失败")

        do {
            _ = try await publisher.publish(draft)
            XCTFail("Expected published state persistence failure")
        } catch {
            XCTAssertEqual(error as? CommunityPublicationError, .publishedStatePersistenceFailed)
        }
        XCTAssertEqual(client.posts.count, 1)
        XCTAssertEqual(try store.load().publications.first?.state, .queued)

        let restored = try CommunityPublisher(store: store, client: client)
        try await restored.retryPending()

        XCTAssertEqual(client.receivedIDs, [draft.id, draft.id])
        XCTAssertEqual(client.posts.count, 1)
        XCTAssertEqual(try store.load().publications.first?.state, .published)
    }

    func testInitialQueuePersistenceFailureNeverCallsServerOrClaimsQueued() async throws {
        let store = FailingCommunityPublicationStore(failingSaveAttempts: [1])
        let client = IdempotentCommunityClient()
        let publisher = try CommunityPublisher(store: store, client: client)

        do {
            _ = try await publisher.publish(
                CommunityDraft(privateEntryID: UUID(), title: "不能丢", body: "保存失败")
            )
            XCTFail("Expected initial queue persistence failure")
        } catch {
            XCTAssertEqual(error as? CommunityPublicationError, .initialQueuePersistenceFailed)
        }

        XCTAssertTrue(publisher.publications.isEmpty)
        XCTAssertTrue(client.receivedIDs.isEmpty)
        XCTAssertTrue(try store.load().publications.isEmpty)
    }

    func testFailedStatePersistenceFailureIsReportedAsQueueSaveFailure() async throws {
        let store = FailingCommunityPublicationStore(failingSaveAttempts: [2])
        let client = CommunityClientStub(results: [.failure(OnlineTestError.offline)])
        let publisher = try CommunityPublisher(store: store, client: client)

        do {
            _ = try await publisher.publish(
                CommunityDraft(privateEntryID: UUID(), title: "离线", body: "失败状态")
            )
            XCTFail("Expected failed state persistence failure")
        } catch {
            XCTAssertEqual(error as? CommunityPublicationError, .failedStatePersistenceFailed)
        }
    }
}

final class LifeOnlineClientTests: XCTestCase {
    func testCommunityRequestIsAuthenticatedAndPrivateSafe() async throws {
        let transport = RecordingHTTPTransport([
            .json(201, #"{"post":{"id":"post-1","body":"正文","topic":"标题","author":{"uid":"u1","nickname":"青禾","avatar":""},"createdAt":"2026-07-29T00:00:00.000Z","updatedAt":"2026-07-29T00:00:00.000Z","likeCount":0,"likedBy":[],"comments":[]}}"#)
        ])
        let client = makeClient(transport)

        let post = try await client.createPost(
            .init(id: UUID(), topic: "标题", body: "正文", minorConfirmed: true)
        )

        XCTAssertEqual(post.id, "post-1")
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.path, "/api/life/community/posts")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-1")
        XCTAssertFalse(String(data: request.httpBody!, encoding: .utf8)!.contains("private"))
    }

    func testDuplicatePostConflictReconcilesExistingPublicID() async throws {
        let publicID = UUID()
        let transport = RecordingHTTPTransport([
            .json(409, #"{"error":"post_id_exists"}"#),
            .json(200, #"{"posts":[{"id":"\#(publicID.uuidString)","body":"正文","topic":"标题","author":{"uid":"u1","nickname":"青禾","avatar":""},"createdAt":"2026-07-29T00:00:00.000Z","updatedAt":"2026-07-29T00:00:00.000Z","likeCount":0}]}"#)
        ])
        let client = makeClient(transport)

        let post = try await client.createPost(
            .init(id: publicID, topic: "标题", body: "正文", minorConfirmed: true)
        )

        XCTAssertEqual(post.id, publicID.uuidString)
        XCTAssertEqual(transport.requests.map { $0.httpMethod ?? "" }, ["POST", "GET"])
    }

    func testFriendSearchRequestAndMessageSendMatchRoutes() async throws {
        let transport = RecordingHTTPTransport([
            .json(200, #"{"users":[{"uid":"bob-2","nickname":"木舟"}]}"#),
            .json(201, #"{"message":{"id":"message-7","conversationId":"alice:bob","senderUid":"alice","targetUid":"bob-2","body":"今天还好吗","clientMessageId":"client-7","createdAt":"2026-07-29T00:00:00.000Z"},"created":true}"#)
        ])
        let client = makeClient(transport)

        let users = try await client.searchFriends(query: "木舟")
        let message = try await client.sendMessage(to: "bob-2", body: "今天还好吗", clientMessageID: "client-7")

        XCTAssertEqual(users.map(\.uid), ["bob-2"])
        XCTAssertEqual(message.id, "message-7")
        XCTAssertEqual(transport.requests[0].url?.path, "/api/life/friends/search")
        XCTAssertEqual(transport.requests[1].url?.path, "/api/life/friends/bob-2/messages")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: transport.requests[1].httpBody!) as? [String: String])
        XCTAssertEqual(sent, ["body": "今天还好吗", "clientMessageId": "client-7"])
    }

    func testTapTokenConsumptionCreatesServerBackedPendingRequest() async throws {
        let transport = RecordingHTTPTransport([
            .json(201, #"{"request":{"id":"request-1","fromUid":"alice","toUid":"bob","source":"tap","status":"pending","createdAt":"2026-07-29T00:00:00.000Z","respondedAt":null}}"#)
        ])
        let client = makeClient(transport)

        let request = try await client.consumeTapToken("one-time-token")

        XCTAssertEqual(request.id, "request-1")
        XCTAssertEqual(request.status, "pending")
        let recorded = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(recorded.url?.path, "/api/life/friends/tap-tokens/consume")
        XCTAssertEqual(recorded.httpMethod, "POST")
        let body = try XCTUnwrap(recorded.httpBody)
        XCTAssertEqual(
            try JSONSerialization.jsonObject(with: body) as? [String: String],
            ["token": "one-time-token"]
        )
    }

    func testCompanionPayloadAndDisclosureUseSameSelectedIdentifiers() async throws {
        let transport = RecordingHTTPTransport([
            .json(200, #"{"answer":"记住了晚风。","usedEntryIds":["allowed"],"safety":{"level":"none"},"memoryDrafts":[]}"#)
        ])
        let client = makeClient(transport)

        let reply = try await client.sendCompanionMessage(
            "回顾今天",
            selectedEntryIDs: ["allowed"],
            style: "quiet"
        )

        XCTAssertEqual(reply.usedEntryIDs, ["allowed"])
        let body = transport.requests[0].httpBody!
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["selectedEntryIds"] as? [String], ["allowed"])
        XCTAssertNil(object["entries"])
        XCTAssertFalse(String(data: body, encoding: .utf8)!.contains("private"))
    }

    private func makeClient(_ transport: HTTPTransportProtocol) -> LifeOnlineClient {
        LifeOnlineClient(
            baseURL: URL(string: "https://life.example")!,
            accessToken: { "token-1" },
            transport: transport
        )
    }
}

@MainActor
final class PassportObservationTests: XCTestCase {
    func testRestoresAccountAndPublishesAuthorizingState() throws {
        let keychain = RecordingKeychain()
        let tokenStore = AuthTokenStore(keychain: keychain)
        try tokenStore.save(accessToken: "token", accountID: "account-7")
        let starter = PassportStarterStub(startResult: true)
        let session = PassportSession(tokenStore: tokenStore, authorizationStarter: starter)
        var states: [PassportAuthorizationStatus] = []
        let observation = session.$authorizationStatus.sink { states.append($0) }

        session.beginAuthorization()

        XCTAssertEqual(session.accountID, "account-7")
        XCTAssertEqual(session.authorizationStatus, .authorizing)
        XCTAssertTrue(states.contains(.authorizing))
        XCTAssertEqual(starter.callbackScheme, "lifediary")
        withExtendedLifetime(observation) {}
    }

    func testStartFailurePublishesUnavailableError() {
        let session = PassportSession(
            tokenStore: AuthTokenStore(keychain: RecordingKeychain()),
            authorizationStarter: PassportStarterStub(startResult: false)
        )
        session.beginAuthorization()
        XCTAssertEqual(session.authorizationStatus, .failed(.unavailable))
        XCTAssertEqual(session.authorizationError, .unavailable)
    }

    func testMinorCallbackEmitsEventButDoesNotEnterKeychain() async throws {
        let keychain = RecordingKeychain()
        let challenges = ChallengeSequence(["state", "nonce", String(repeating: "v", count: 43)])
        let exchange = PassportExchangeStub(
            response: .init(accessToken: "t", accountID: "u", isMinor: true, nonce: "nonce")
        )
        let session = PassportSession(
            tokenStore: AuthTokenStore(keychain: keychain),
            challengeGenerator: challenges.next,
            authorizationStarter: PassportStarterStub(startResult: true),
            exchangeClient: exchange
        )
        var minorEvents: [(String, Bool)] = []
        session.onMinorLoginResult = { minorEvents.append(($0, $1)) }
        session.beginAuthorization()

        await session.handleCallback(
            URL(string: "lifediary://passport/callback?code=authorization-code&state=state")!
        )

        XCTAssertEqual(minorEvents.map(\.0), ["u"])
        XCTAssertEqual(minorEvents.map(\.1), [true])
        XCTAssertFalse(try XCTUnwrap(keychain.values["credentials"]).contains("minor"))
    }
}

final class MinorAndLocalStateTests: XCTestCase {
    func testMinorPromptRequiresRealEventAndSevenDaySuppressionExpires() throws {
        let store = MemoryMinorPromptStore()
        let start = Date(timeIntervalSince1970: 100)
        let coordinator = try MinorPromptCoordinator(store: store)
        try coordinator.handleMinorLoginResult(accountID: "adult", isMinor: false)
        XCTAssertFalse(coordinator.shouldPresent(at: start))
        try coordinator.completeOfflineAgeProfile(isMinor: true)
        XCTAssertTrue(coordinator.shouldPresent(at: start))
        try coordinator.suppressForSevenDays(from: start, calendar: Calendar(identifier: .gregorian))

        let restored = try MinorPromptCoordinator(store: store)
        XCTAssertFalse(restored.shouldPresent(at: start.addingTimeInterval(7 * 86_400 - 1)))
        XCTAssertTrue(restored.shouldPresent(at: start.addingTimeInterval(7 * 86_400)))
    }

    func testMinorLaterPermanentAndRestoreAreDistinct() throws {
        let coordinator = try MinorPromptCoordinator(store: MemoryMinorPromptStore())
        try coordinator.handleMinorLoginResult(accountID: "minor", isMinor: true)
        try coordinator.remindLater()
        XCTAssertFalse(coordinator.shouldPresent(at: .distantFuture))
        try coordinator.handleMinorLoginResult(accountID: "minor", isMinor: true)
        XCTAssertTrue(coordinator.shouldPresent(at: .distantPast))
        try coordinator.suppressPermanently()
        XCTAssertFalse(coordinator.shouldPresent(at: .distantFuture))
        try coordinator.restorePrompts()
        XCTAssertTrue(coordinator.shouldPresent(at: .distantPast))
    }

    func testAdultOfflineProfileClearsMinorEligibilityAndAllSuppression() throws {
        let coordinator = try MinorPromptCoordinator(store: MemoryMinorPromptStore())
        try coordinator.completeOfflineAgeProfile(isMinor: true)
        try coordinator.suppressPermanently()

        try coordinator.completeOfflineAgeProfile(isMinor: false)

        XCTAssertFalse(coordinator.state.eligible)
        XCTAssertFalse(coordinator.state.dismissedUntilNextEvent)
        XCTAssertNil(coordinator.state.suppressedUntil)
        XCTAssertFalse(coordinator.state.permanentlySuppressed)
        XCTAssertFalse(coordinator.shouldPresent())
    }

    func testAccountSwitchDoesNotCarryMinorSuppressionToAnotherAccount() throws {
        let coordinator = try MinorPromptCoordinator(store: MemoryMinorPromptStore())
        try coordinator.handleMinorLoginResult(accountID: "minor-a", isMinor: true)
        try coordinator.suppressForSevenDays(from: Date(timeIntervalSince1970: 10))

        try coordinator.handleMinorLoginResult(accountID: "minor-b", isMinor: true)

        XCTAssertEqual(coordinator.state.identityKey, "passport:minor-b")
        XCTAssertNil(coordinator.state.suppressedUntil)
        XCTAssertTrue(coordinator.shouldPresent(at: Date(timeIntervalSince1970: 11)))
    }

    func testAdultLoginClearsPreviousMinorAccountAndDoesNotTrigger() throws {
        let coordinator = try MinorPromptCoordinator(store: MemoryMinorPromptStore())
        try coordinator.handleMinorLoginResult(accountID: "minor-a", isMinor: true)
        try coordinator.remindLater()

        try coordinator.handleMinorLoginResult(accountID: "adult-b", isMinor: false)

        XCTAssertEqual(coordinator.state.identityKey, "passport:adult-b")
        XCTAssertEqual(coordinator.state, MinorPromptState(identityKey: "passport:adult-b"))
        XCTAssertFalse(coordinator.shouldPresent())
    }

    func testHealthSettingsPersistAfterExplicitSave() throws {
        let store = MemoryHealthSettingsStore()
        var settings = HealthToolSettings()
        settings.periodEnabled = true
        settings.latestPeriodStart = Date(timeIntervalSince1970: 500)
        settings.cycleLength = 31
        settings.smokingEnabled = true
        settings.smokeFreeStartedAt = Date(timeIntervalSince1970: 700)
        settings.cigarettesPerDay = 8
        settings.pricePerPack = 26
        try store.save(settings)
        XCTAssertEqual(try store.load(), settings)
    }

    func testDiaryDraftKeepsOneIdentifierAcrossSaveAndCopy() {
        var draft = DiaryDraft()
        draft.title = "同一篇"
        draft.body = "不会重复"
        let first = draft.makeEntry(at: Date(timeIntervalSince1970: 10))
        draft.markPersisted(first)
        let second = draft.makeEntry(at: Date(timeIntervalSince1970: 20))
        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(CommunityDraft(copying: second).privateEntryID, first.id)
    }
}

private class MemoryCommunityPublicationStore: CommunityPublicationStoreProtocol {
    var snapshot = CommunityPublicationSnapshot()
    func load() throws -> CommunityPublicationSnapshot { snapshot }
    func save(_ snapshot: CommunityPublicationSnapshot) throws { self.snapshot = snapshot }
}

private final class FailingCommunityPublicationStore: MemoryCommunityPublicationStore {
    private let failingSaveAttempts: Set<Int>
    private var saveAttempt = 0

    init(failingSaveAttempts: Set<Int> = []) {
        self.failingSaveAttempts = failingSaveAttempts
    }

    override func save(_ snapshot: CommunityPublicationSnapshot) throws {
        saveAttempt += 1
        if failingSaveAttempts.contains(saveAttempt) { throw OnlineTestError.persistence }
        try super.save(snapshot)
    }
}

private enum OnlineTestError: Error {
    case offline
    case persistence
}

private func XCTAssertThrowsOnlineError(
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

private final class CommunityClientStub: CommunityClientProtocol {
    var results: [Result<RemoteCommunityPost, Error>]
    init(results: [Result<RemoteCommunityPost, Error>]) { self.results = results }
    func createPost(_ payload: PublicCommunityPayload) async throws -> RemoteCommunityPost {
        try results.removeFirst().get()
    }
}

private final class IdempotentCommunityClient: CommunityClientProtocol {
    private(set) var posts: [UUID: RemoteCommunityPost] = [:]
    private(set) var receivedIDs: [UUID] = []
    private var loseFirstAcknowledgement: Bool

    init(loseFirstAcknowledgement: Bool = false) {
        self.loseFirstAcknowledgement = loseFirstAcknowledgement
    }

    func createPost(_ payload: PublicCommunityPayload) async throws -> RemoteCommunityPost {
        let id = try XCTUnwrap(payload.id)
        receivedIDs.append(id)
        if let existing = posts[id] { return existing }
        let post = RemoteCommunityPost.fixture(id: id.uuidString, body: payload.body)
        posts[id] = post
        if loseFirstAcknowledgement {
            loseFirstAcknowledgement = false
            throw OnlineTestError.offline
        }
        return post
    }
}

private final class RecordingHTTPTransport: HTTPTransportProtocol {
    struct Stub {
        let status: Int
        let data: Data
        static func json(_ status: Int, _ json: String) -> Stub { .init(status: status, data: Data(json.utf8)) }
    }
    var requests: [URLRequest] = []
    private var stubs: [Stub]
    init(_ stubs: [Stub]) { self.stubs = stubs }
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let stub = stubs.removeFirst()
        return (stub.data, HTTPURLResponse(url: request.url!, statusCode: stub.status, httpVersion: nil, headerFields: nil)!)
    }
}

private final class PassportStarterStub: PassportAuthorizationStarting {
    let startResult: Bool
    var callbackScheme: String?
    init(startResult: Bool) { self.startResult = startResult }
    func start(url: URL, callbackScheme: String, completion: @escaping (URL?, Error?) -> Void) -> Bool {
        self.callbackScheme = callbackScheme
        return startResult
    }
    func cancel() {}
}

final class PassportExchangeStub: PassportCodeExchanging {
    let response: PassportExchangeResponse
    private(set) var codes: [String] = []
    private(set) var verifiers: [String] = []

    init(response: PassportExchangeResponse) { self.response = response }

    func exchange(code: String, verifier: String) async throws -> PassportExchangeResponse {
        codes.append(code)
        verifiers.append(verifier)
        return response
    }
}

private final class MemoryMinorPromptStore: MinorPromptStoreProtocol {
    var state = MinorPromptState()
    func load() throws -> MinorPromptState { state }
    func save(_ state: MinorPromptState) throws { self.state = state }
}

private final class MemoryHealthSettingsStore: HealthSettingsStoreProtocol {
    var settings = HealthToolSettings()
    func load() throws -> HealthToolSettings { settings }
    func save(_ settings: HealthToolSettings) throws { self.settings = settings }
}

private extension RemoteCommunityPost {
    static func fixture(id: String, body: String) -> RemoteCommunityPost {
        .init(
            id: id,
            body: body,
            topic: "",
            author: .init(uid: "u", nickname: "青禾", avatar: ""),
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
            likeCount: 0
        )
    }
}
