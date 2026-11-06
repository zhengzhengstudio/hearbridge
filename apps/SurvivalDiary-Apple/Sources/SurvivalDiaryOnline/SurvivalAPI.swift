import Foundation

public struct IslandSession: Codable, Sendable { public let sessionToken: String; public let uid: String? }
public struct PublicIsland: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String?
    public let members: [String]
    public var displayName: String { name ?? id }
}
private struct PublicIslandList: Codable { let islands: [PublicIsland] }
public struct NpcDialogueReply: Sendable {
    public let reply: String
    public let source: String
    public let reason: String?
}

public actor SurvivalAPI {
    private let baseURL: URL
    private let session: URLSession
    private var sessionToken: String?

    public init(baseURL: URL, session: URLSession = .shared) { self.baseURL = baseURL; self.session = session }
    public func setSessionToken(_ token: String?) { sessionToken = token }

    public func createGuestSession(deviceID: String) async throws -> IslandSession {
        let body = try JSONSerialization.data(withJSONObject: ["mode": "local", "deviceId": deviceID])
        let (data, _) = try await request(path: "session", method: "POST", body: body, timeout: 2.6)
        let value = try JSONDecoder().decode(IslandSession.self, from: data)
        sessionToken = value.sessionToken
        return value
    }

    public func listPublicIslands() async throws -> [PublicIsland] {
        let (data, _) = try await request(path: "islands/public")
        return try JSONDecoder().decode(PublicIslandList.self, from: data).islands
    }

    public func ensurePublicIsland(seed: String) async throws -> PublicIsland {
        let body = try JSONSerialization.data(withJSONObject: ["seed": seed])
        let (data, _) = try await request(path: "islands/mine/public", method: "PUT", body: body)
        return try JSONDecoder().decode(PublicIsland.self, from: data)
    }

    public func visitIsland(_ islandID: String) async throws {
        let escaped = islandID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? islandID
        _ = try await request(path: "islands/\(escaped)/visit", method: "POST", body: Data("{}".utf8))
    }

    public func friends() async throws -> Data { try await request(path: "friends").0 }

    public func requestFriend(receiverUid: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["receiverUid": receiverUid])
        _ = try await request(path: "friends/requests", method: "POST", body: body)
    }

    public func talkToVillager(_ payload: [String: Any]) async throws -> NpcDialogueReply {
        let body = try JSONSerialization.data(withJSONObject: payload)
        let (data, _) = try await request(path: "npc-dialogue", method: "POST", body: body, timeout: 2.6)
        let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return NpcDialogueReply(
            reply: value?["reply"] as? String ?? "",
            source: value?["source"] as? String ?? "fallback",
            reason: value?["reason"] as? String
        )
    }

    public func request(path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval = 12) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method; request.httpBody = body; request.timeoutInterval = timeout; request.setValue("application/json", forHTTPHeaderField: "content-type")
        if let sessionToken { request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "authorization") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    public func webSocketURL() throws -> URL {
        guard let sessionToken else { throw URLError(.userAuthenticationRequired) }
        var parts = URLComponents(url: baseURL.appendingPathComponent("ws"), resolvingAgainstBaseURL: false)!
        parts.scheme = baseURL.scheme == "https" ? "wss" : "ws"; parts.queryItems = [.init(name: "session", value: sessionToken)]
        return parts.url!
    }
}
