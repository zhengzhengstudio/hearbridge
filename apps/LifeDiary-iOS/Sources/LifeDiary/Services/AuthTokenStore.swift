import Foundation

/// This boundary delegates platform persistence to `SecureTokenStore`, which uses
/// `kSecClassGenericPassword` and `kSecValueData` through `SecItemAdd(...)`,
/// `SecItemUpdate(...)`, and `SecItemCopyMatching(...)`; credentials are never written to UserDefaults.
public struct AuthCredentials: Codable, Equatable, Sendable {
    public let accessToken: String
    public let accountID: String

    public init(accessToken: String, accountID: String) {
        self.accessToken = accessToken
        self.accountID = accountID
    }
}

public protocol AuthTokenStoreProtocol: AnyObject {
    func load() throws -> AuthCredentials?
    func save(accessToken: String, accountID: String) throws
    func clear() throws
}

public final class AuthTokenStore: AuthTokenStoreProtocol {
    private let keychain: KeychainClientProtocol
    private let service = "cn.zhengzhengstudio.lifediary.auth"
    private let account = "credentials"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(keychain: KeychainClientProtocol = SecureTokenStore()) {
        self.keychain = keychain
    }

    public func load() throws -> AuthCredentials? {
        guard let encoded = try keychain.read(service: service, account: account) else {
            return nil
        }
        return try decoder.decode(AuthCredentials.self, from: Data(encoded.utf8))
    }

    public func save(accessToken: String, accountID: String) throws {
        let credentials = AuthCredentials(accessToken: accessToken, accountID: accountID)
        let data = try encoder.encode(credentials)
        guard let encoded = String(data: data, encoding: .utf8) else {
            throw AuthTokenStoreError.invalidEncoding
        }
        try keychain.write(encoded, service: service, account: account)
    }

    public func clear() throws {
        try keychain.remove(service: service, account: account)
    }
}

public enum AuthTokenStoreError: Error {
    case invalidEncoding
}
