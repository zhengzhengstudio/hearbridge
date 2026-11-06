import LocalAuthentication

protocol DeviceAuthenticating: AnyObject {
    func authenticate(reason: String) async throws -> Bool
}

final class DeviceOwnerAuthenticator: DeviceAuthenticating {
    func authenticate(reason: String) async throws -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            throw error ?? DeviceAuthenticationError.unavailable
        }
        return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
    }
}

private enum DeviceAuthenticationError: LocalizedError {
    case unavailable
    var errorDescription: String? { "这台 Mac 未配置可用的登录密码或生物识别认证。" }
}
