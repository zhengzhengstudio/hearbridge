import CryptoKit
import Foundation

public struct ReleaseManifest: Codable, Equatable, Sendable {
    public var version: String; public var build: Int; public var url: URL; public var sha256: String; public var storeURL: URL?
    public init(version: String, build: Int, url: URL, sha256: String, storeURL: URL? = nil) { self.version = version; self.build = build; self.url = url; self.sha256 = sha256; self.storeURL = storeURL }
}

public enum UpdateDecision: Equatable, Sendable { case current, store(URL), direct(URL, sha256: String) }
public enum UpdateError: Error, Equatable { case checksumMismatch }

public struct UpdateService: Sendable {
    private struct ManifestDocument: Decodable { let apps: [ManifestEntry] }
    private struct ManifestEntry: Decodable {
        let id: String
        let version: String
        let build: Int
        let url: String?
        let downloadURL: String?
        let versionedUrl: String?
        let installURL: String?
        let sha256: String?
        let checksum: String?
        let available: Bool?
        let updateEligible: Bool?
    }

    public init() {}

    public func fetchRelease(manifestURL: URL, appID: String) async throws -> ReleaseManifest? {
        let (data, response) = try await URLSession.shared.data(from: manifestURL)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return try release(in: data, manifestURL: manifestURL, appID: appID)
    }

    public func release(in data: Data, manifestURL: URL, appID: String) throws -> ReleaseManifest? {
        let document = try JSONDecoder().decode(ManifestDocument.self, from: data)
        guard let entry = document.apps.first(where: { $0.id == appID }),
              entry.available != false, entry.updateEligible != false else { return nil }
        let storeURL = entry.installURL.flatMap { value in
            value.isEmpty ? nil : URL(string: value, relativeTo: manifestURL)?.absoluteURL
        }
        let rawURL = [entry.downloadURL, entry.versionedUrl, entry.url]
            .compactMap({ $0 }).first(where: { !$0.isEmpty })
        let directURL = rawURL.flatMap { URL(string: $0, relativeTo: manifestURL)?.absoluteURL }
        guard let artifactURL = directURL ?? storeURL else { return nil }
        let checksum = (entry.sha256 ?? entry.checksum ?? "").lowercased()
        if directURL != nil && checksum.isEmpty && storeURL == nil { return nil }
        return ReleaseManifest(version: entry.version, build: entry.build, url: artifactURL, sha256: checksum, storeURL: storeURL)
    }

    public func check(currentVersion: String, currentBuild: Int, release: ReleaseManifest, platform: String) -> UpdateDecision {
        guard release.build > currentBuild || release.version.compare(currentVersion, options: .numeric) == .orderedDescending else { return .current }
        if platform == "ios" { return release.storeURL.map(UpdateDecision.store) ?? .current }
        guard !release.sha256.isEmpty else { return .current }
        return .direct(release.url, sha256: release.sha256.lowercased())
    }
    public func verify(_ data: Data, expectedSHA256: String) throws {
        let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard actual == expectedSHA256.lowercased() else { throw UpdateError.checksumMismatch }
    }

    public func verify(fileAt url: URL, expectedSHA256: String) throws {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var digest = SHA256()
        while let chunk = try handle.read(upToCount: 256 * 1024), !chunk.isEmpty {
            digest.update(data: chunk)
        }
        let actual = digest.finalize().map { String(format: "%02x", $0) }.joined()
        guard actual == expectedSHA256.lowercased() else { throw UpdateError.checksumMismatch }
    }
}

public struct ReleasePushService: Sendable {
    public let manifestURL: URL
    public init(manifestURL: URL) { self.manifestURL = manifestURL }
    public func manifestToRefetch(notification: [String: String]) -> URL? {
        notification["type"] == "release" && notification["build"] != nil ? manifestURL : nil
    }
}
