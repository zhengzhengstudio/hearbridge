import Combine
import Foundation

public enum IslandConnectionPhase: String, Sendable { case local, connecting, online, reconnecting, offline }
public struct IslandChatMessage: Identifiable, Sendable {
    public let id: String
    public let uid: String
    public let text: String
    public let createdAt: TimeInterval
}

@MainActor
public final class IslandSocketClient: ObservableObject {
    @Published public private(set) var phase: IslandConnectionPhase = .local
    @Published public private(set) var islandID = ""
    @Published public private(set) var revision = 0
    @Published public private(set) var messages: [IslandChatMessage] = []
    @Published public private(set) var errorMessage: String?
    private var task: URLSessionWebSocketTask?
    private var api: SurvivalAPI?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var generation = UUID()
    private var intentional = true

    public init() {}

    public func join(api: SurvivalAPI, islandID: String) async throws {
        leave()
        self.api = api
        self.islandID = islandID
        intentional = false
        try await open(resume: false)
    }

    public func send(_ text: String) async throws {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...500).contains(normalized.count), let task else { throw URLError(.notConnectedToInternet) }
        try await task.send(.string(json(["type": "chat", "protocolVersion": 2, "requestId": id("chat"), "islandId": islandID, "text": normalized])))
    }

    @discardableResult
    public func sendCommand(_ type: String, payload: [String: Any] = [:]) async throws -> String {
        guard !type.isEmpty, !islandID.isEmpty, let task else { throw URLError(.notConnectedToInternet) }
        let eventID = id("event")
        let command: [String: Any] = [
            "eventId": eventID,
            "baseRevision": revision,
            "type": type,
            "payload": payload,
        ]
        try await task.send(.string(json([
            "type": "command",
            "protocolVersion": 2,
            "requestId": id("command"),
            "islandId": islandID,
            "command": command,
        ])))
        return eventID
    }

    public func leave() {
        intentional = true
        generation = UUID()
        reconnectTask?.cancel(); reconnectTask = nil
        task?.cancel(with: .normalClosure, reason: nil); task = nil
        phase = .local; islandID = ""; revision = 0; reconnectAttempt = 0; messages = []
    }

    private func open(resume: Bool) async throws {
        guard let api else { throw URLError(.userAuthenticationRequired) }
        let socket = URLSession.shared.webSocketTask(with: try await api.webSocketURL())
        let token = UUID(); generation = token; task = socket
        phase = resume ? .reconnecting : .connecting
        socket.resume()
        var join: [String: Any] = ["type": resume ? "resume" : "join", "protocolVersion": 2, "requestId": id(resume ? "resume" : "join"), "islandId": islandID]
        if resume { join["revision"] = revision }
        try await socket.send(.string(json(join)))
        receive(socket: socket, token: token)
    }

    private func receive(socket: URLSessionWebSocketTask, token: UUID) {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.generation == token, self.task === socket, !self.intentional else { return }
                switch result {
                case .success(.string(let text)):
                    self.handle(text); self.receive(socket: socket, token: token)
                case .success(.data(let data)):
                    self.handle(String(decoding: data, as: UTF8.self)); self.receive(socket: socket, token: token)
                case .failure(let error):
                    self.errorMessage = error.localizedDescription; self.scheduleReconnect()
                @unknown default: self.scheduleReconnect()
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any], let type = object["type"] as? String else { return }
        if ["snapshot", "ack", "world_update"].contains(type) {
            revision = object["revision"] as? Int ?? revision; reconnectAttempt = 0; phase = .online; errorMessage = nil
        } else if type == "chat" {
            appendChat(object)
        } else if type == "chat_history", let history = object["messages"] as? [[String: Any]] {
            history.forEach(appendChat)
        } else if type == "error" {
            errorMessage = object["message"] as? String ?? object["code"] as? String ?? "联机请求失败"
        }
    }

    private func appendChat(_ object: [String: Any]) {
        let message = IslandChatMessage(id: object["id"] as? String ?? UUID().uuidString, uid: object["uid"] as? String ?? object["actorUid"] as? String ?? "岛友", text: object["text"] as? String ?? "", createdAt: object["createdAt"] as? TimeInterval ?? Date().timeIntervalSince1970)
        messages = Array((messages + [message]).suffix(80))
    }

    private func scheduleReconnect() {
        guard !intentional, reconnectAttempt < 6, !islandID.isEmpty else { phase = .offline; return }
        reconnectAttempt += 1; phase = .reconnecting
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            let nanoseconds = UInt64(min(20, 0.75 * pow(2, Double((self?.reconnectAttempt ?? 1) - 1))) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard let self, !Task.isCancelled, !self.intentional else { return }
            do { try await self.open(resume: true) } catch { self.errorMessage = error.localizedDescription; self.scheduleReconnect() }
        }
    }

    private func json(_ value: [String: Any]) -> String { String(decoding: (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8), as: UTF8.self) }
    private func id(_ prefix: String) -> String { "\(prefix)-\(UUID().uuidString)" }
}
