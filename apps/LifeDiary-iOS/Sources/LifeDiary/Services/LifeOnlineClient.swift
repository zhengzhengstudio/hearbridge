import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public protocol HTTPTransportProtocol: AnyObject {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public final class URLSessionHTTPTransport: HTTPTransportProtocol {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw LifeOnlineError.invalidResponse
        }
        return (data, response)
    }
}

public protocol CommunityClientProtocol: AnyObject {
    func createPost(_ payload: PublicCommunityPayload) async throws -> RemoteCommunityPost
}

public enum LifeOnlineError: LocalizedError, Equatable {
    case passportRequired
    case invalidResponse
    case server(status: Int, code: String?)

    public var errorDescription: String? {
        switch self {
        case .passportRequired: return "请先登录铮铮通行证。"
        case .invalidResponse: return "服务器返回了无法识别的数据。"
        case .server(let status, _): return "服务器请求失败（\(status)）。"
        }
    }
}

public final class LifeOnlineClient: CommunityClientProtocol {
    private let baseURL: URL
    private let accessToken: () throws -> String?
    private let transport: HTTPTransportProtocol
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(
        baseURL: URL,
        accessToken: @escaping () throws -> String?,
        transport: HTTPTransportProtocol = URLSessionHTTPTransport()
    ) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.transport = transport
    }

    public func createPost(_ payload: PublicCommunityPayload) async throws -> RemoteCommunityPost {
        struct Response: Decodable { let post: RemoteCommunityPost }
        do {
            return try await send(
                path: "api/life/community/posts",
                method: "POST",
                body: payload,
                requiresPassport: true,
                as: Response.self
            ).post
        } catch let error as LifeOnlineError {
            guard case .server(status: 409, code: "post_id_exists") = error,
                  let publicID = payload.id?.uuidString,
                  let existing = try await listCommunityPosts().first(where: { $0.id == publicID }) else {
                throw error
            }
            return existing
        }
    }

    public func listCommunityPosts() async throws -> [RemoteCommunityPost] {
        struct Response: Decodable { let posts: [RemoteCommunityPost] }
        return try await send(path: "api/life/community/posts", as: Response.self).posts
    }

    public func listFriends() async throws -> FriendsOverview {
        try await send(path: "api/life/friends", requiresPassport: true, as: FriendsOverview.self)
    }

    public func searchFriends(query: String) async throws -> [FriendUser] {
        struct Response: Decodable { let users: [FriendUser] }
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return try await send(
            path: "api/life/friends/search",
            query: components.queryItems,
            requiresPassport: true,
            as: Response.self
        ).users
    }

    public func requestFriend(uid: String) async throws -> FriendRequestRecord {
        struct Body: Encodable { let targetUid: String }
        struct Response: Decodable { let request: FriendRequestRecord }
        return try await send(
            path: "api/life/friends/requests",
            method: "POST",
            body: Body(targetUid: uid),
            requiresPassport: true,
            as: Response.self
        ).request
    }

    public func respondToRequest(id: String, action: String) async throws -> FriendRequestRecord {
        struct Body: Encodable { let action: String }
        struct Response: Decodable { let request: FriendRequestRecord }
        return try await send(
            path: "api/life/friends/requests/\(id)/respond",
            method: "POST",
            body: Body(action: action),
            requiresPassport: true,
            as: Response.self
        ).request
    }

    public func issueTapToken() async throws -> TapToken {
        try await send(
            path: "api/life/friends/tap-tokens",
            method: "POST",
            body: EmptyBody(),
            requiresPassport: true,
            as: TapToken.self
        )
    }

    public func consumeTapToken(_ token: String) async throws -> FriendRequestRecord {
        struct Body: Encodable { let token: String }
        struct Response: Decodable { let request: FriendRequestRecord }
        return try await send(
            path: "api/life/friends/tap-tokens/consume",
            method: "POST",
            body: Body(token: token),
            requiresPassport: true,
            as: Response.self
        ).request
    }

    public func listMessages(with uid: String) async throws -> [ChatMessage] {
        struct Response: Decodable { let messages: [ChatMessage] }
        return try await send(
            path: "api/life/friends/\(uid)/messages",
            requiresPassport: true,
            as: Response.self
        ).messages
    }

    public func sendMessage(to uid: String, body: String, clientMessageID: String) async throws -> ChatMessage {
        struct Body: Encodable { let body: String; let clientMessageId: String }
        struct Response: Decodable { let message: ChatMessage; let created: Bool }
        return try await send(
            path: "api/life/friends/\(uid)/messages",
            method: "POST",
            body: Body(body: body, clientMessageId: clientMessageID),
            requiresPassport: true,
            as: Response.self
        ).message
    }

    public func sendCompanionMessage(
        _ message: String,
        selectedEntryIDs: [String],
        style: String
    ) async throws -> CompanionReply {
        struct Body: Encodable {
            let message: String
            let style: String
            let selectedEntryIds: [String]
            let remember = false
        }
        return try await send(
            path: "api/life/companion/chat",
            method: "POST",
            body: Body(message: message, style: style, selectedEntryIds: selectedEntryIDs),
            requiresPassport: true,
            as: CompanionReply.self
        )
    }

    public func syncLedger(_ entries: [LedgerEntry]) async throws -> [LedgerEntry] {
        struct Operation: Encodable { let id: String; let domain = "ledger"; let type = "upsert"; let baseRevision: Int; let payload: LedgerEntry }
        struct Body: Encodable { let operations: [Operation] }
        struct Domains: Decodable { let ledger: [String: LedgerEntry] }
        struct Record: Decodable { let domains: Domains }
        struct Response: Decodable { let record: Record }
        let operations = entries.map { Operation(id: "ios-ledger-\($0.id.uuidString)-\($0.revision)", baseRevision: max(0, $0.revision - 1), payload: $0) }
        return Array(try await send(path: "api/life/sync", method: "POST", body: Body(operations: operations), requiresPassport: true, as: Response.self).record.domains.ledger.values)
    }

    private func send<Response: Decodable>(
        path: String,
        query: [URLQueryItem]? = nil,
        requiresPassport: Bool = false,
        as type: Response.Type
    ) async throws -> Response {
        try await send(path: path, query: query, method: "GET", bodyData: nil, requiresPassport: requiresPassport, as: type)
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        query: [URLQueryItem]? = nil,
        method: String,
        body: Body,
        requiresPassport: Bool,
        as type: Response.Type
    ) async throws -> Response {
        try await send(
            path: path,
            query: query,
            method: method,
            bodyData: try encoder.encode(body),
            requiresPassport: requiresPassport,
            as: type
        )
    }

    private func send<Response: Decodable>(
        path: String,
        query: [URLQueryItem]?,
        method: String,
        bodyData: Data?,
        requiresPassport: Bool,
        as type: Response.Type
    ) async throws -> Response {
        var url = baseURL.appendingPathComponent(path)
        if let query {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = query
            if let value = components?.url { url = value }
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if bodyData != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let token = try accessToken()
        if requiresPassport && (token?.isEmpty != false) {
            throw LifeOnlineError.passportRequired
        }
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await transport.data(for: request)
        guard 200..<300 ~= response.statusCode else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw LifeOnlineError.server(status: response.statusCode, code: object?["error"] as? String)
        }
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw LifeOnlineError.invalidResponse
        }
    }
}

private struct EmptyBody: Encodable {}
