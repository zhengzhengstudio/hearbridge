import Foundation
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct MobileUpdate: Identifiable {
    let id: String
    let version: String
    let build: Int
    let installURL: URL
    let notes: String
}

private struct Manifest: Decodable { let apps: [ManifestApp] }
private struct ManifestApp: Decodable {
    let id: String
    let version: String
    let build: Int
    let installURL: String?
    let downloadURL: String?
    let url: String?
    let notes: [String]?
}

@MainActor
final class UpdateService: ObservableObject {
    @Published var availableUpdate: MobileUpdate?
    @Published private(set) var isChecking = false
    @Published private(set) var statusMessage: String?
    @Published private(set) var errorMessage: String?
    private let manifestURL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!

    func check(userInitiated: Bool = false) async {
        guard !isChecking else { return }
        isChecking = true
        if userInitiated {
            statusMessage = nil
            errorMessage = nil
        }
        defer { isChecking = false }
        do {
            let (data, response) = try await URLSession.shared.data(from: manifestURL)
            guard let response = response as? HTTPURLResponse,
                  200..<300 ~= response.statusCode else {
                throw UpdateCheckError.unsuccessfulResponse
            }
            let manifest = try JSONDecoder().decode(Manifest.self, from: data)
            guard let app = manifest.apps.first(where: { $0.id == "lifediary-ios" }) else {
                throw UpdateCheckError.appMissing
            }
            let localVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.3.1"
            let localBuild = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1") ?? 1
            let remoteBuild = app.build
            let isNewer = remoteBuild > localBuild || compareVersions(app.version, localVersion) > 0
            guard isNewer else {
                if userInitiated { statusMessage = "当前已是最新版（\(localVersion)）。" }
                return
            }
            guard let value = app.installURL ?? app.downloadURL ?? app.url,
                  let url = absoluteURL(value), url.scheme == "https" else {
                throw UpdateCheckError.invalidInstallURL
            }
            availableUpdate = MobileUpdate(id: app.id, version: app.version, build: app.build,
                installURL: url, notes: app.notes?.joined(separator: "\n") ?? "")
            if userInitiated { statusMessage = "发现新版本 \(app.version)。" }
        } catch {
            if userInitiated {
                errorMessage = "检查更新失败：\(error.localizedDescription)"
            }
        }
    }

#if os(iOS)
    func open(_ update: MobileUpdate) { UIApplication.shared.open(update.installURL) }
#elseif os(macOS)
    func open(_ update: MobileUpdate) { NSWorkspace.shared.open(update.installURL) }
#endif

    private func absoluteURL(_ value: String) -> URL? {
        if let url = URL(string: value), url.scheme != nil { return url }
        return URL(string: "https://zhengzhengstudio.cn/" + value.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }
    private func compareVersions(_ left: String, _ right: String) -> Int {
        let a = left.split(separator: ".").map { Int($0.prefix(while: { $0.isNumber })) ?? 0 }
        let b = right.split(separator: ".").map { Int($0.prefix(while: { $0.isNumber })) ?? 0 }
        for index in 0..<max(a.count, b.count) {
            let av = index < a.count ? a[index] : 0, bv = index < b.count ? b[index] : 0
            if av != bv { return av > bv ? 1 : -1 }
        }
        return 0
    }
}

private enum UpdateCheckError: LocalizedError {
    case unsuccessfulResponse
    case appMissing
    case invalidInstallURL

    var errorDescription: String? {
        switch self {
        case .unsuccessfulResponse: return "服务器响应异常。"
        case .appMissing: return "更新清单中没有生活日记。"
        case .invalidInstallURL: return "更新地址无效。"
        }
    }
}
