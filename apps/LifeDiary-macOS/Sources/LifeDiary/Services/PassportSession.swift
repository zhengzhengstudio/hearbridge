import AppKit
import AuthenticationServices
import Combine
import CryptoKit
import Foundation

enum PassportAuthorizationError: Error, Equatable {
    case invalidCallback, unavailable, cancelled, exchangeFailed, credentialClearFailed
}
enum PassportAuthorizationStatus: Equatable { case idle, authorizing, authenticated, failed(PassportAuthorizationError) }

struct PassportExchangeResponse: Codable, Equatable {
    let accessToken: String
    let accountID: String
    let isMinor: Bool
    let nonce: String
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token", accountID = "account_id", isMinor = "is_minor", nonce
    }
}

@MainActor
protocol PassportAuthorizationStarting: AnyObject {
    func start(url: URL, callbackScheme: String, anchor: NSWindow?, completion: @escaping (URL?, Error?) -> Void) -> Bool
    func cancel()
}

@MainActor
protocol PassportCodeExchanging: AnyObject {
    func exchange(code: String, verifier: String) async throws -> PassportExchangeResponse
}

@MainActor
final class PassportExchangeClient: PassportCodeExchanging {
    private let endpoint: URL
    init(endpoint: URL = URL(string: "https://zhengzhengstudio.cn/api/zz-pass/native/exchange")!) { self.endpoint = endpoint }
    func exchange(code: String, verifier: String) async throws -> PassportExchangeResponse {
        struct Body: Encodable {
            let code: String
            let code_verifier: String
            let app_id = "lifediary-macos"
            let redirect_uri = "lifediary://passport/callback"
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(code: code, code_verifier: verifier))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else { throw PassportAuthorizationError.exchangeFailed }
        return try JSONDecoder().decode(PassportExchangeResponse.self, from: data)
    }
}

@MainActor
final class PassportSession: ObservableObject {
    @Published private(set) var accountID: String?
    @Published private(set) var authorizationURL: URL?
    @Published private(set) var authorizationStatus: PassportAuthorizationStatus = .idle
    @Published private(set) var authorizationError: PassportAuthorizationError?
    var onMinorLoginResult: ((String, Bool) -> Void)?
    var onAuthenticated: (() -> Void)?

    private let tokenStore: AuthTokenStoreProtocol
    private let authorizeEndpoint: URL
    private let challengeGenerator: () -> String
    private let starter: PassportAuthorizationStarting
    private let exchangeClient: PassportCodeExchanging
    private var challenge: (state: String, nonce: String, verifier: String)?

    init(
        tokenStore: AuthTokenStoreProtocol,
        authorizeEndpoint: URL = URL(string: "https://zhengzhengstudio.cn/api/zz-pass/native/authorize")!,
        challengeGenerator: (() -> String)? = nil,
        starter: PassportAuthorizationStarting? = nil,
        exchangeClient: PassportCodeExchanging? = nil
    ) {
        self.tokenStore = tokenStore
        self.authorizeEndpoint = authorizeEndpoint
        self.challengeGenerator = challengeGenerator ?? Self.generateChallenge
        self.starter = starter ?? SystemPassportStarter()
        self.exchangeClient = exchangeClient ?? PassportExchangeClient()
        if let credentials = try? tokenStore.load() {
            accountID = credentials.accountID
            authorizationStatus = .authenticated
        }
    }

    func beginAuthorization(anchor: NSWindow?) {
        guard authorizationStatus != .authorizing else { return }
        let state = challengeGenerator(), nonce = challengeGenerator(), verifier = challengeGenerator()
        guard !state.isEmpty, !nonce.isEmpty, verifier.count >= 43,
              var parts = URLComponents(url: authorizeEndpoint, resolvingAgainstBaseURL: false) else { fail(.unavailable); return }
        let digest = SHA256.hash(data: Data(verifier.utf8))
        let pkce = Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        parts.queryItems = [
            .init(name: "app_id", value: "lifediary-macos"),
            .init(name: "redirect_uri", value: "lifediary://passport/callback"),
            .init(name: "state", value: state), .init(name: "nonce", value: nonce),
            .init(name: "code_challenge", value: pkce), .init(name: "code_challenge_method", value: "S256")
        ]
        guard let url = parts.url else { fail(.unavailable); return }
        challenge = (state, nonce, verifier)
        authorizationURL = url; authorizationError = nil; authorizationStatus = .authorizing
        let started = starter.start(url: url, callbackScheme: "lifediary", anchor: anchor) { [weak self] callback, error in
            Task { @MainActor in
                guard let self else { return }
                if error != nil { self.consumeChallenge(); self.fail(.cancelled) }
                else if let callback { await self.handleCallback(callback) }
                else { self.consumeChallenge(); self.fail(.invalidCallback) }
            }
        }
        if !started { consumeChallenge(); fail(.unavailable) }
    }

    func cancelAuthorization() {
        guard authorizationStatus == .authorizing else { return }
        starter.cancel(); consumeChallenge(); fail(.cancelled)
    }

    func handleCallback(_ url: URL) async {
        guard let active = challenge,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "lifediary", parts.host?.lowercased() == "passport", parts.path == "/callback",
              single("state", parts) == active.state,
              let code = single("code", parts), !code.isEmpty else { consumeChallenge(); fail(.invalidCallback); return }
        consumeChallenge()
        do {
            let result = try await exchangeClient.exchange(code: code, verifier: active.verifier)
            guard result.nonce == active.nonce else { fail(.invalidCallback); return }
            try tokenStore.save(accessToken: result.accessToken, accountID: result.accountID)
            accountID = result.accountID; authorizationStatus = .authenticated; authorizationError = nil
            onMinorLoginResult?(result.accountID, result.isMinor)
            onAuthenticated?()
        } catch { fail(.exchangeFailed) }
    }

    func signOut() throws {
        do {
            try tokenStore.clear()
            accountID = nil; authorizationStatus = .idle; authorizationError = nil
        } catch {
            fail(.credentialClearFailed)
            throw error
        }
    }

    private func single(_ name: String, _ parts: URLComponents) -> String? {
        let values = (parts.queryItems ?? []).filter { $0.name == name }
        return values.count == 1 ? values[0].value : nil
    }
    private func consumeChallenge() { challenge = nil; authorizationURL = nil }
    private func fail(_ error: PassportAuthorizationError) { authorizationError = error; authorizationStatus = .failed(error) }
    private static func generateChallenge() -> String {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<48).map { _ in UInt8.random(in: .min ... .max, using: &generator) }).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

private final class SystemPassportStarter: NSObject, PassportAuthorizationStarting, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var anchor: NSWindow?
    @MainActor func start(url: URL, callbackScheme: String, anchor: NSWindow?, completion: @escaping (URL?, Error?) -> Void) -> Bool {
        guard let anchor else { return false }
        self.anchor = anchor
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme, completionHandler: completion)
        session.presentationContextProvider = self; session.prefersEphemeralWebBrowserSession = false
        self.session = session
        return session.start()
    }
    @MainActor func cancel() { session?.cancel(); session = nil }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor! }
}
