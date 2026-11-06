import Combine
import CryptoKit
import Foundation
#if os(iOS) && canImport(AuthenticationServices)
import AuthenticationServices
import UIKit
#endif

public enum PassportAuthorizationError: Error, Equatable {
    case invalidCallback
    case unavailable
    case cancelled
    case exchangeFailed
}

public struct PassportExchangeResponse: Codable, Equatable, Sendable {
    public let accessToken: String
    public let accountID: String
    public let isMinor: Bool
    public let nonce: String
    enum CodingKeys: String, CodingKey { case accessToken = "access_token", accountID = "account_id", isMinor = "is_minor", nonce }
}

@MainActor
public protocol PassportCodeExchanging: AnyObject {
    func exchange(code: String, verifier: String) async throws -> PassportExchangeResponse
}

@MainActor
public final class PassportExchangeClient: PassportCodeExchanging {
    private let endpoint: URL
    public init(endpoint: URL = URL(string: "https://zhengzhengstudio.cn/api/zz-pass/native/exchange")!) { self.endpoint = endpoint }
    public func exchange(code: String, verifier: String) async throws -> PassportExchangeResponse {
        struct Body: Encodable {
            let code: String
            let code_verifier: String
            let app_id = "lifediary-ios"
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

public enum PassportAuthorizationStatus: Equatable {
    case idle
    case authorizing
    case authenticated
    case failed(PassportAuthorizationError)
}

@MainActor
public protocol PassportAuthorizationStarting: AnyObject {
    func start(
        url: URL,
        callbackScheme: String,
        completion: @escaping (URL?, Error?) -> Void
    ) -> Bool
    func cancel()
}

@MainActor
public final class PassportSession: ObservableObject {
    @Published public private(set) var accountID: String?
    @Published public private(set) var authorizationError: PassportAuthorizationError?
    @Published public private(set) var authorizationURL: URL?
    @Published public private(set) var authorizationStatus: PassportAuthorizationStatus = .idle

    public var onMinorLoginResult: ((String, Bool) -> Void)?

    private let tokenStore: AuthTokenStoreProtocol
    private let passportURL: URL
    private let challengeGenerator: () -> String
    private let authorizationStarter: PassportAuthorizationStarting
    private let exchangeClient: PassportCodeExchanging
    private var activeChallenge: (state: String, nonce: String, verifier: String)?

    public init(
        tokenStore: AuthTokenStoreProtocol,
        passportURL: URL = URL(string: "https://zhengzhengstudio.cn/api/zz-pass/native/authorize")!,
        authorizationStarter: PassportAuthorizationStarting? = nil,
        exchangeClient: PassportCodeExchanging? = nil
    ) {
        self.tokenStore = tokenStore
        self.passportURL = passportURL
        challengeGenerator = Self.generateChallenge
        self.authorizationStarter = authorizationStarter ?? SystemPassportAuthorizationStarter()
        self.exchangeClient = exchangeClient ?? PassportExchangeClient()
        restoreCredentials()
    }

    init(
        tokenStore: AuthTokenStoreProtocol,
        passportURL: URL = URL(string: "https://zhengzhengstudio.cn/api/zz-pass/native/authorize")!,
        challengeGenerator: @escaping () -> String,
        authorizationStarter: PassportAuthorizationStarting? = nil,
        exchangeClient: PassportCodeExchanging? = nil
    ) {
        self.tokenStore = tokenStore
        self.passportURL = passportURL
        self.challengeGenerator = challengeGenerator
        self.authorizationStarter = authorizationStarter ?? SystemPassportAuthorizationStarter()
        self.exchangeClient = exchangeClient ?? PassportExchangeClient()
        restoreCredentials()
    }

    public func beginAuthorization() {
        let state = challengeGenerator()
        let nonce = challengeGenerator()
        let verifier = challengeGenerator()
        guard !state.isEmpty, !nonce.isEmpty, verifier.count >= 43,
              var components = URLComponents(url: passportURL, resolvingAgainstBaseURL: false) else {
            fail(.unavailable)
            return
        }
        let digest = SHA256.hash(data: Data(verifier.utf8))
        let challenge = Data(digest).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        components.queryItems = [
            .init(name: "app_id", value: "lifediary-ios"), .init(name: "redirect_uri", value: "lifediary://passport/callback"),
            .init(name: "state", value: state), .init(name: "nonce", value: nonce),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256")
        ]
        guard let requestURL = components.url else {
            fail(.unavailable)
            return
        }

        activeChallenge = (state, nonce, verifier)
        authorizationURL = requestURL
        authorizationError = nil
        authorizationStatus = .authorizing
        let started = authorizationStarter.start(
            url: requestURL,
            callbackScheme: "lifediary"
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                await self?.finishAuthorization(callbackURL, error: error)
            }
        }
        if !started {
            fail(.unavailable)
        }
    }

    public func cancelAuthorization() {
        authorizationStarter.cancel()
        activeChallenge = nil
        fail(.cancelled)
    }

    public func handleCallback(_ callbackURL: URL) async {
        guard let activeChallenge,
              let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "lifediary",
              components.host?.lowercased() == "passport",
              components.path == "/callback",
              let state = singleQueryValue("state", in: components),
              let code = singleQueryValue("code", in: components),
              state == activeChallenge.state,
              !code.isEmpty else {
            fail(.invalidCallback)
            return
        }

        let challenge = activeChallenge
        self.activeChallenge = nil
        do {
            let result = try await exchangeClient.exchange(code: code, verifier: challenge.verifier)
            guard result.nonce == challenge.nonce else { fail(.invalidCallback); return }
            try tokenStore.save(accessToken: result.accessToken, accountID: result.accountID)
            accountID = result.accountID
            authorizationError = nil
            authorizationStatus = .authenticated
            onMinorLoginResult?(result.accountID, result.isMinor)
        } catch {
            fail(.exchangeFailed)
        }
    }

    private func restoreCredentials() {
        do {
            if let credentials = try tokenStore.load() {
                accountID = credentials.accountID
                authorizationStatus = .authenticated
            }
        } catch {
            fail(.unavailable)
        }
    }

    private func finishAuthorization(_ callbackURL: URL?, error: Error?) async {
        if error != nil {
            activeChallenge = nil
            fail(.cancelled)
            return
        }
        guard let callbackURL else {
            fail(.invalidCallback)
            return
        }
        await handleCallback(callbackURL)
    }

    private func fail(_ error: PassportAuthorizationError) {
        authorizationError = error
        authorizationStatus = .failed(error)
    }

    private func singleQueryValue(_ name: String, in components: URLComponents) -> String? {
        let matches = (components.queryItems ?? []).filter { $0.name == name }
        guard matches.count == 1 else { return nil }
        return matches[0].value
    }

    private static func generateChallenge() -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in
            UInt8.random(in: UInt8.min...UInt8.max, using: &generator)
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

@MainActor
private final class SystemPassportAuthorizationStarter: NSObject, PassportAuthorizationStarting {
    #if os(iOS) && canImport(AuthenticationServices)
    private var session: ASWebAuthenticationSession?
    private let contextProvider = PassportPresentationContextProvider()
    #endif

    func start(
        url: URL,
        callbackScheme: String,
        completion: @escaping (URL?, Error?) -> Void
    ) -> Bool {
        #if os(iOS) && canImport(AuthenticationServices)
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: callbackScheme,
            completionHandler: completion
        )
        session.prefersEphemeralWebBrowserSession = true
        session.presentationContextProvider = contextProvider
        self.session = session
        return session.start()
        #else
        return false
        #endif
    }

    func cancel() {
        #if os(iOS) && canImport(AuthenticationServices)
        session?.cancel()
        session = nil
        #endif
    }
}

#if os(iOS) && canImport(AuthenticationServices)
private final class PassportPresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? UIWindow()
    }
}
#endif
