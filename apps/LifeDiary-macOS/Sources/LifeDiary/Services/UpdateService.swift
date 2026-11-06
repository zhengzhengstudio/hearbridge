import AppKit
import CryptoKit
import Foundation

struct DesktopUpdate: Identifiable {
    let id: String
    let version: String
    let build: Int
    let downloadURL: URL
    let fileName: String
    let sha256: String
    let notes: String
}
private struct Manifest: Decodable { let apps: [ManifestApp] }
private struct ManifestApp: Decodable {
    let id: String; let version: String; let build: Int
    let downloadURL: String?; let url: String?; let fileName: String?; let sha256: String?; let notes: [String]?
}

protocol UpdateHTTPTransport: AnyObject {
    func data(from url: URL) async throws -> (Data, HTTPURLResponse)
    func download(from url: URL) async throws -> (URL, HTTPURLResponse)
}

protocol ParallelUpdateHTTPTransport: UpdateHTTPTransport {
    func metadata(from url: URL) async throws -> (contentLength: Int64, acceptsRanges: Bool)
    func data(from url: URL, range: ClosedRange<Int64>) async throws -> (Data, HTTPURLResponse)
}

final class URLSessionUpdateTransport: ParallelUpdateHTTPTransport {
    func data(from url: URL) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let response = response as? HTTPURLResponse else { throw UpdateError.invalidResponse }
        return (data, response)
    }
    func download(from url: URL) async throws -> (URL, HTTPURLResponse) {
        let (file, response) = try await URLSession.shared.download(from: url)
        guard let response = response as? HTTPURLResponse else { throw UpdateError.invalidResponse }
        return (file, response)
    }
    func metadata(from url: URL) async throws -> (contentLength: Int64, acceptsRanges: Bool) {
        var request = URLRequest(url: url); request.httpMethod = "HEAD"
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw UpdateError.invalidResponse }
        return (response.expectedContentLength, response.value(forHTTPHeaderField: "Accept-Ranges")?.localizedCaseInsensitiveContains("bytes") == true)
    }
    func data(from url: URL, range: ClosedRange<Int64>) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.setValue("bytes=\(range.lowerBound)-\(range.upperBound)", forHTTPHeaderField: "Range")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw UpdateError.invalidResponse }
        return (data, response)
    }
}

@MainActor
final class UpdateService: ObservableObject {
    @Published var availableUpdate: DesktopUpdate?
    @Published var lastError: String?
    @Published var statusMessage: String?
    @Published var downloadProgress: Double?
    private let manifestURL: URL
    private let transport: UpdateHTTPTransport

    init(
        manifestURL: URL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!,
        transport: UpdateHTTPTransport = URLSessionUpdateTransport()
    ) {
        self.manifestURL = manifestURL
        self.transport = transport
    }

    func check(userInitiated: Bool = false) async {
        lastError = nil; statusMessage = nil
        do {
            let (data, response) = try await transport.data(from: manifestURL)
            guard 200..<300 ~= response.statusCode else { throw UpdateError.http(response.statusCode) }
            let manifest = try JSONDecoder().decode(Manifest.self, from: data)
            guard let app = manifest.apps.first(where: { $0.id == "lifediary-macos" }) else { throw UpdateError.missingManifestEntry }
            let localVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.3.1"
            let localBuild = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1") ?? 1
            let remoteBuild = app.build
            guard remoteBuild > localBuild || compareVersions(app.version, localVersion) > 0 else {
                availableUpdate = nil
                if userInitiated { statusMessage = "生活日记已是最新版本。" }
                return
            }
            guard let value = app.downloadURL ?? app.url,
                  let url = absoluteURL(value),
                  let expectedHash = app.sha256, expectedHash.count == 64 else { throw UpdateError.invalidManifest }
            availableUpdate = DesktopUpdate(id: app.id, version: app.version, build: app.build,
                downloadURL: url, fileName: app.fileName ?? "LifeDiary-macOS-\(app.version).dmg",
                sha256: expectedHash, notes: app.notes?.joined(separator: "\n") ?? "")
        } catch { lastError = "无法检查更新：\(error.localizedDescription)" }
    }

    func downloadAndOpen(_ update: DesktopUpdate) async {
        do {
            lastError = nil; statusMessage = nil; downloadProgress = 0
            let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0] // Downloads
            let destination = downloads.appendingPathComponent(safeName(update.fileName))
            if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
            if let parallel = transport as? ParallelUpdateHTTPTransport,
               let data = try await parallelData(update.downloadURL, transport: parallel) {
                try data.write(to: destination, options: .atomic)
            } else {
                let (temporary, response) = try await transport.download(from: update.downloadURL)
                guard 200..<300 ~= response.statusCode else { throw UpdateError.http(response.statusCode) }
                try FileManager.default.moveItem(at: temporary, to: destination)
                downloadProgress = 1
            }
            let data = try Data(contentsOf: destination, options: .mappedIfSafe)
            let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard actual.caseInsensitiveCompare(update.sha256) == .orderedSame else {
                try? FileManager.default.removeItem(at: destination)
                throw UpdateError.hashMismatch
            }
            guard NSWorkspace.shared.open(destination) else { throw UpdateError.cannotOpen }
            statusMessage = "安装包已校验并交给系统打开。"
            downloadProgress = nil
        } catch { downloadProgress = nil; lastError = "更新失败：\(error.localizedDescription)" }
    }

    private func parallelData(_ url: URL, transport: ParallelUpdateHTTPTransport) async throws -> Data? {
        let metadata = try await transport.metadata(from: url)
        guard metadata.contentLength > 1, metadata.acceptsRanges else { return nil }
        let ranges = ParallelDownloadRange.plan(contentLength: metadata.contentLength, requestedParts: 4)
        var pieces = Array<Data?>(repeating: nil, count: ranges.count)
        try await withThrowingTaskGroup(of: (Int, Data).self) { group in
            for (index, range) in ranges.enumerated() {
                group.addTask {
                    let (data, response) = try await transport.data(from: url, range: range)
                    guard response.statusCode == 206 else { throw UpdateError.rangeUnsupported }
                    return (index, data)
                }
            }
            var completed = 0
            for try await (index, data) in group {
                pieces[index] = data; completed += 1
                downloadProgress = Double(completed) / Double(ranges.count)
            }
        }
        return pieces.compactMap { $0 }.reduce(into: Data()) { $0.append($1) }
    }

    private func safeName(_ value: String) -> String { value.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression) }
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
enum ParallelDownloadRange {
    static func plan(contentLength: Int64, requestedParts: Int) -> [ClosedRange<Int64>] {
        guard contentLength > 0, requestedParts > 0 else { return [] }
        let count = min(Int64(requestedParts), contentLength)
        let base = contentLength / count, remainder = contentLength % count
        var start: Int64 = 0
        return (0..<count).map { index in
            let size = base + (index < remainder ? 1 : 0)
            defer { start += size }
            return start...(start + size - 1)
        }
    }
}
private enum UpdateError: LocalizedError {
    case hashMismatch, invalidResponse, invalidManifest, missingManifestEntry, cannotOpen, rangeUnsupported, http(Int)
    var errorDescription: String? {
        switch self {
        case .hashMismatch: return "安装包 SHA-256 校验失败"
        case .invalidResponse: return "服务器响应无效"
        case .invalidManifest: return "更新清单缺少下载地址或校验值"
        case .missingManifestEntry: return "更新清单中没有生活日记"
        case .cannotOpen: return "系统无法打开安装包"
        case .rangeUnsupported: return "服务器没有正确响应分片下载"
        case .http(let status): return "服务器返回 HTTP \(status)"
        }
    }
}
