import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public protocol LifeAPIClientProtocol: AnyObject {
    func sync(_ mutations: [PendingMutation]) async throws
}

public final class LifeAPIClient: LifeAPIClientProtocol {
    private let baseURL: URL
    private let accessToken: () throws -> String?
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared, accessToken: @escaping () throws -> String?) {
        self.baseURL = baseURL
        self.session = session
        self.accessToken = accessToken
    }

    public func sync(_ mutations: [PendingMutation]) async throws {
        let endpoint = baseURL.appendingPathComponent("api/life/private/sync")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = try accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(mutations)
        let (_, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, 200..<300 ~= response.statusCode else {
            throw LifeAPIClientError.unsuccessfulResponse
        }
    }
}

public enum LifeAPIClientError: Error { case unsuccessfulResponse }
