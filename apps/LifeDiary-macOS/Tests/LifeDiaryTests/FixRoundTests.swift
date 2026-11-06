import Foundation
import XCTest
@testable import LifeDiary

@MainActor
final class MultiWindowAndSyncTests: XCTestCase {
    func testInterleavedWindowSavesUseOneRepositoryWithoutLosingEitherEntry() async throws {
        let store = FixMemoryDiaryStore()
        let repository = try LifeRepository(store: store, api: OfflineSyncAPI())
        let model = LifeAppModel(repository: repository)
        let firstWindowRepository = model.repository
        let secondWindowRepository = model.repository

        try await firstWindowRepository?.save(entry: DiaryEntry(title: "窗口 A", body: "晨光"))
        try await secondWindowRepository?.save(entry: DiaryEntry(title: "窗口 B", body: "晚风"))

        XCTAssertTrue(firstWindowRepository === secondWindowRepository)
        XCTAssertEqual(Set(store.snapshot.entries.map(\.title)), ["窗口 A", "窗口 B"])
        XCTAssertEqual(store.snapshot.pendingMutations.count, 2)
    }

    func testSyncRequestMatchesWebsiteRouteContractAndRequiresBearer() async throws {
        let operation = PendingMutation(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            domain: "diary",
            type: .upsert,
            baseRevision: 3,
            payload: .init(id: "entry-1", title: "纸页", body: "苔痕", createdAt: nil, updatedAt: nil)
        )
        let transport = FixRecordingTransport(response: #"{"record":{"uid":"reader-1","revision":4,"cursor":4,"domains":{"diary":{"entry-1":{"id":"entry-1","title":"纸页","body":"苔痕","revision":4}},"health":{},"minor-settings":{},"assistant-memory":{}},"appliedOperationIds":["11111111-1111-1111-1111-111111111111"],"updatedAt":"2026-07-29T00:00:00.000Z"},"applied":["11111111-1111-1111-1111-111111111111"],"conflicts":[]}"#)
        let client = LifeAPIClient(baseURL: URL(string: "https://life.example")!, accessToken: { "passport-token" }, transport: transport)

        let response = try await client.sync([operation])

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.url?.path, "/api/life/sync")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer passport-token")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        let operations = try XCTUnwrap(body["operations"] as? [[String: Any]])
        XCTAssertEqual(Set(operations[0].keys), ["id", "domain", "type", "baseRevision", "payload"])
        XCTAssertEqual((operations[0]["payload"] as? [String: Any])?["id"] as? String, "entry-1")
        XCTAssertEqual(response.applied, [operation.id.uuidString])
    }

    func testRepositoryAcknowledgesOnlyAppliedOperationsAndPersistsServerRevision() async throws {
        let store = FixMemoryDiaryStore()
        let api = SequencedSyncAPI()
        let repository = try LifeRepository(store: store, api: api)
        let entry = DiaryEntry(id: UUID(), title: "同步", body: "一次", revision: 0)

        try await repository.save(entry: entry)

        XCTAssertEqual(repository.entries.first?.revision, 1)
        XCTAssertTrue(store.snapshot.pendingMutations.isEmpty)
        XCTAssertEqual(api.batches.count, 1)
    }
}

final class OutboxAndErrorTests: XCTestCase {
    func testParallelDownloadRangesCoverEveryByteExactlyOnce() {
        XCTAssertEqual(ParallelDownloadRange.plan(contentLength: 10, requestedParts: 4), [0...2, 3...5, 6...7, 8...9])
        XCTAssertEqual(ParallelDownloadRange.plan(contentLength: 2, requestedParts: 6), [0...0, 1...1])
    }

    func testCommunityOutboxKeepsStableDraftPerPrivateEntryAcrossRestart() throws {
        let store = MemoryCommunityOutboxStore()
        let first = try CommunityOutbox(store: store)
        let entryA = DiaryEntry(title: "A", body: "正文 A")
        let entryB = DiaryEntry(title: "B", body: "正文 B")
        let draftA = try first.draft(for: entryA)
        let draftB = try first.draft(for: entryB)
        let restored = try CommunityOutbox(store: store)

        XCTAssertNotEqual(draftA.id, draftB.id)
        XCTAssertEqual(try restored.draft(for: entryA).id, draftA.id)
        XCTAssertEqual(try restored.draft(for: entryA).body, "正文 A")
        XCTAssertEqual(try restored.draft(for: entryB).body, "正文 B")
    }

    func testServerErrorCodeProducesActionableMessage() {
        XCTAssertEqual(LifeAPIError.server(status: 403, code: "friendship_required").errorDescription, "请先成为好友，再发送消息。")
        XCTAssertEqual(LifeAPIError.server(status: 400, code: "invalid_message").errorDescription, "消息内容无效，请修改后重试。")
    }

    func testFailedMessageRetryKeepsTheSameClientIdentifier() {
        var send = PendingChatSend(body: "你好")
        let firstID = send.clientMessageID
        send.markFailed("网络中断")
        send.markSending()
        XCTAssertEqual(send.clientMessageID, firstID)
        XCTAssertEqual(send.body, "你好")
    }
}

@MainActor
final class PrivacyAndFocusTests: XCTestCase {
    func testLockRequiresSuccessfulDeviceOwnerAuthentication() async throws {
        let store = FixMemoryDiaryStore()
        let model = LifeAppModel(
            repository: try LifeRepository(store: store, api: OfflineSyncAPI()),
            authenticator: FixDeviceAuthenticator(results: [false, true])
        )

        model.lock()
        await model.unlock()
        XCTAssertTrue(model.isLocked)
        XCTAssertNotNil(model.lockError)

        await model.unlock()
        XCTAssertFalse(model.isLocked)
        XCTAssertNil(model.lockError)
    }

    func testSearchFieldFocuserMakesNativeSearchFieldFirstResponder() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        let container = NSView(frame: window.contentView!.bounds)
        let search = NSSearchField(frame: NSRect(x: 20, y: 20, width: 200, height: 30))
        container.addSubview(search)
        window.contentView = container

        XCTAssertTrue(SearchFieldFocuser.focus(in: window))
        XCTAssertTrue(window.firstResponder === search.currentEditor() || window.firstResponder === search)
    }


    func testUpdateCheckRejectsNonSuccessHTTPStatusWithVisibleFeedback() async {
        let transport = FixUpdateTransport(status: 503, body: Data())
        let updates = UpdateService(manifestURL: URL(string: "https://example.test/manifest.json")!, transport: transport)
        await updates.check(userInitiated: true)
        XCTAssertNotNil(updates.lastError)
        XCTAssertNil(updates.statusMessage)
    }
}

private final class FixMemoryDiaryStore: DiaryStoreProtocol {
    var snapshot = DiaryStoreSnapshot()
    func load() throws -> DiaryStoreSnapshot { snapshot }
    func save(_ snapshot: DiaryStoreSnapshot) throws { self.snapshot = snapshot }
}

private final class OfflineSyncAPI: LifeAPIClientProtocol {
    func sync(_ mutations: [PendingMutation]) async throws -> SyncResponse { throw FixError.offline }
}

private final class SequencedSyncAPI: LifeAPIClientProtocol {
    var batches: [[PendingMutation]] = []
    func sync(_ mutations: [PendingMutation]) async throws -> SyncResponse {
        batches.append(mutations)
        let operation = mutations[0]
        return SyncResponse(
            record: .init(revision: 1, domains: ["diary": [operation.payload.id: .init(
                id: operation.payload.id,
                title: operation.payload.title,
                body: operation.payload.body,
                revision: 1
            )]]),
            applied: [operation.id.uuidString],
            conflicts: []
        )
    }
}

private final class FixRecordingTransport: HTTPTransportProtocol {
    var requests: [URLRequest] = []
    let response: String
    init(response: String) { self.response = response }
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        return (Data(response.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

private final class MemoryCommunityOutboxStore: CommunityOutboxStoreProtocol {
    var drafts: [CommunityDraft] = []
    func load() throws -> [CommunityDraft] { drafts }
    func save(_ drafts: [CommunityDraft]) throws { self.drafts = drafts }
}

private final class FixDeviceAuthenticator: DeviceAuthenticating {
    var results: [Bool]
    init(results: [Bool]) { self.results = results }
    func authenticate(reason: String) async throws -> Bool { results.removeFirst() }
}

private final class FixUpdateTransport: UpdateHTTPTransport {
    let status: Int
    let body: Data
    init(status: Int, body: Data) { self.status = status; self.body = body }
    func data(from url: URL) async throws -> (Data, HTTPURLResponse) {
        (body, HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
    func download(from url: URL) async throws -> (URL, HTTPURLResponse) { throw FixError.offline }
}

private enum FixError: Error { case offline }
