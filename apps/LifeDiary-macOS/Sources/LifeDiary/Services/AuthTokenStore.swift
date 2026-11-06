import Foundation
import Security

struct AuthCredentials: Codable, Equatable, Sendable {
    let accessToken: String
    let accountID: String
}

protocol AuthTokenStoreProtocol: AnyObject {
    func load() throws -> AuthCredentials?
    func save(accessToken: String, accountID: String) throws
    func clear() throws
}

protocol KeychainClientProtocol: AnyObject {
    func read(service: String, account: String) throws -> String?
    func write(_ value: String, service: String, account: String) throws
    func remove(service: String, account: String) throws
}

final class AuthTokenStore: AuthTokenStoreProtocol {
    private let keychain: KeychainClientProtocol
    private let service = "cn.zhengzhengstudio.lifediary.auth"
    private let account = "credentials"

    init(keychain: KeychainClientProtocol = SecureTokenStore()) { self.keychain = keychain }

    func load() throws -> AuthCredentials? {
        guard let string = try keychain.read(service: service, account: account) else { return nil }
        return try JSONDecoder().decode(AuthCredentials.self, from: Data(string.utf8))
    }

    func save(accessToken: String, accountID: String) throws {
        let data = try JSONEncoder().encode(AuthCredentials(accessToken: accessToken, accountID: accountID))
        guard let string = String(data: data, encoding: .utf8) else { throw AuthTokenStoreError.invalidEncoding }
        try keychain.write(string, service: service, account: account)
    }

    func clear() throws { try keychain.remove(service: service, account: account) }
}

enum AuthTokenStoreError: Error { case invalidEncoding }

final class SecureTokenStore: KeychainClientProtocol {
    func read(service: String, account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw SecureTokenStoreError.keychain(status) }
        return String(data: data, encoding: .utf8)
    }

    func write(_ value: String, service: String, account: String) throws {
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemUpdate(identity as CFDictionary, [kSecValueData as String: Data(value.utf8)] as CFDictionary)
        if status == errSecItemNotFound {
            var add = identity
            add[kSecValueData as String] = Data(value.utf8)
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw SecureTokenStoreError.keychain(addStatus) }
        } else if status != errSecSuccess {
            throw SecureTokenStoreError.keychain(status)
        }
    }

    func remove(service: String, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SecureTokenStoreError.keychain(status) }
    }
}

enum SecureTokenStoreError: Error { case keychain(OSStatus) }
