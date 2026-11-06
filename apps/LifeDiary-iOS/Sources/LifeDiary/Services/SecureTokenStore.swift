import Foundation
#if canImport(Security)
import Security
#endif

public protocol KeychainClientProtocol: AnyObject {
    func read(service: String, account: String) throws -> String?
    func write(_ value: String, service: String, account: String) throws
    func remove(service: String, account: String) throws
}

public final class SecureTokenStore: KeychainClientProtocol {
    #if !canImport(Security)
    private var values: [String: String] = [:]
    #endif

    public init() {}

    public func read(service: String, account: String) throws -> String? {
        #if canImport(Security)
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
        guard status == errSecSuccess,
              let data = result as? Data else { throw SecureTokenStoreError.keychain(status) }
        return String(data: data, encoding: .utf8)
        #else
        return values[service + "." + account]
        #endif
    }

    public func write(_ value: String, service: String, account: String) throws {
        #if canImport(Security)
        let identity: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let data = Data(value.utf8)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(identity as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = identity
            add[kSecValueData as String] = data
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw SecureTokenStoreError.keychain(addStatus) }
        } else if status != errSecSuccess {
            throw SecureTokenStoreError.keychain(status)
        }
        #else
        values[service + "." + account] = value
        #endif
    }

    public func remove(service: String, account: String) throws {
        #if canImport(Security)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SecureTokenStoreError.keychain(status) }
        #else
        values.removeValue(forKey: service + "." + account)
        #endif
    }
}

public enum SecureTokenStoreError: Error { case keychain(OSStatus) }
