import Foundation

protocol LifeAPIClientProtocol: AnyObject {
    func sync(_ mutations: [PendingMutation]) async throws -> SyncResponse
}

protocol HTTPTransportProtocol: AnyObject {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

final class URLSessionHTTPTransport: HTTPTransportProtocol {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw LifeAPIError.invalidResponse }
        return (data, response)
    }
}

enum LifeAPIError: LocalizedError, Equatable {
    case passportRequired
    case invalidResponse
    case server(status: Int, code: String?)

    var errorDescription: String? {
        switch self {
        case .passportRequired: return "请先登录铮铮通行证。"
        case .invalidResponse: return "服务器返回了无法识别的数据。"
        case .server(let status, let code):
            switch code {
            case "minor_confirmation_required": return "发布前需要确认未成年人保护提示。"
            case "friendship_required": return "请先成为好友，再发送消息。"
            case "invalid_message": return "消息内容无效，请修改后重试。"
            case "companion_unavailable", "companion_not_configured": return "陪伴服务暂时不可用，请稍后重试。"
            case "passport_required": return "通行证已失效，请重新登录。"
            default: return "请求失败（\(status)，\(code ?? "unknown_error")）。"
            }
        }
    }
}

final class LifeAPIClient: LifeAPIClientProtocol {
    private let baseURL: URL
    private let accessToken: () throws -> String?
    private let transport: HTTPTransportProtocol
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(
        baseURL: URL = URL(string: "https://life.zhengzhengstudio.cn")!,
        accessToken: @escaping () throws -> String?,
        transport: HTTPTransportProtocol = URLSessionHTTPTransport()
    ) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.transport = transport
    }

    func sync(_ mutations: [PendingMutation]) async throws -> SyncResponse {
        struct Body: Encodable { let operations: [PendingMutation] }
        return try await send(path: "api/life/sync", method: "POST", body: Body(operations: mutations), requiresPassport: true, as: SyncResponse.self)
    }

    func syncLedger(_ entries: [MacLedgerEntry]) async throws -> [MacLedgerEntry] {
        struct Operation: Encodable {
            let id: String
            let domain = "ledger"
            let type = "upsert"
            let baseRevision: Int
            let payload: MacLedgerEntry
        }
        struct Body: Encodable { let operations: [Operation] }
        struct Domains: Decodable { let ledger: [String: MacLedgerEntry] }
        struct Record: Decodable { let domains: Domains }
        struct Response: Decodable { let record: Record }
        let operations = entries.map {
            Operation(id: "mac-ledger-\($0.id.uuidString)-\($0.revision)", baseRevision: max(0, $0.revision - 1), payload: $0)
        }
        let response = try await send(
            path: "api/life/sync",
            method: "POST",
            body: Body(operations: operations),
            requiresPassport: true,
            as: Response.self
        )
        return Array(response.record.domains.ledger.values)
    }

    func listCommunityPosts() async throws -> [RemoteCommunityPost] {
        struct Response: Decodable { let posts: [RemoteCommunityPost] }
        return try await send(path: "api/life/community/posts", as: Response.self).posts
    }

    func createPost(_ payload: PublicCommunityPayload) async throws -> RemoteCommunityPost {
        struct Response: Decodable { let post: RemoteCommunityPost }
        do {
            return try await send(path: "api/life/community/posts", method: "POST", body: payload, requiresPassport: true, as: Response.self).post
        } catch let error as LifeAPIError {
            guard case .server(status: 409, code: "post_id_exists") = error,
                  let post = try await listCommunityPosts().first(where: { $0.id.caseInsensitiveCompare(payload.id.uuidString) == .orderedSame }) else { throw error }
            return post
        }
    }

    func listFriends() async throws -> FriendsOverview {
        try await send(path: "api/life/friends", requiresPassport: true, as: FriendsOverview.self)
    }

    func searchFriends(query: String) async throws -> [FriendUser] {
        struct Response: Decodable { let users: [FriendUser] }
        return try await send(
            path: "api/life/friends/search",
            query: [URLQueryItem(name: "q", value: query)],
            requiresPassport: true,
            as: Response.self
        ).users
    }

    func requestFriend(uid: String) async throws -> FriendRequestRecord {
        struct Body: Encodable { let targetUid: String }
        struct Response: Decodable { let request: FriendRequestRecord }
        return try await send(path: "api/life/friends/requests", method: "POST", body: Body(targetUid: uid), requiresPassport: true, as: Response.self).request
    }

    func respondToFriendRequest(id: String, action: String) async throws -> FriendRequestRecord {
        struct Body: Encodable { let action: String }
        struct Response: Decodable { let request: FriendRequestRecord }
        return try await send(path: "api/life/friends/requests/\(id)/respond", method: "POST", body: Body(action: action), requiresPassport: true, as: Response.self).request
    }

    func listMessages(with uid: String) async throws -> [ChatMessage] {
        struct Response: Decodable { let messages: [ChatMessage] }
        return try await send(path: "api/life/friends/\(uid)/messages", requiresPassport: true, as: Response.self).messages
    }

    func sendMessage(to uid: String, body: String, clientMessageID: String) async throws -> ChatMessage {
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

    func sendCompanionMessage(_ message: String, selectedEntryIDs: [String], style: String) async throws -> CompanionReply {
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
        method: String,
        body: Body,
        requiresPassport: Bool,
        as type: Response.Type
    ) async throws -> Response {
        try await send(path: path, query: nil, method: method, bodyData: try encoder.encode(body), requiresPassport: requiresPassport, as: type)
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
        let token = try accessToken()
        if requiresPassport && token?.isEmpty != false { throw LifeAPIError.passportRequired }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if bodyData != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token, !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await transport.data(for: request)
        guard 200..<300 ~= response.statusCode else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw LifeAPIError.server(status: response.statusCode, code: object?["error"] as? String)
        }
        if Response.self == EmptyResponse.self, data.isEmpty { return EmptyResponse() as! Response }
        do { return try decoder.decode(Response.self, from: data) }
        catch { throw LifeAPIError.invalidResponse }
    }
}

private struct EmptyResponse: Codable {}
