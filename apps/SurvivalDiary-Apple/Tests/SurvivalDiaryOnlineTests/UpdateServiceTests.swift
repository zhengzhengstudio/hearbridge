import XCTest
@testable import SurvivalDiaryOnline

final class UpdateServiceTests: XCTestCase {
    func testSelectsAppleReleaseFromDownloadManifest() throws {
        let json = #"{"apps":[{"id":"survival-diary-macos","version":"0.4.2","build":7,"downloadURL":"/api/apps/download/SurvivalDiary.dmg","sha256":"ABC123"}]}"#.data(using: .utf8)!
        let manifestURL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!
        let release = try UpdateService().release(in: json, manifestURL: manifestURL, appID: "survival-diary-macos")
        XCTAssertEqual(release?.version, "0.4.2")
        XCTAssertEqual(release?.build, 7)
        XCTAssertEqual(release?.url.absoluteString, "https://zhengzhengstudio.cn/api/apps/download/SurvivalDiary.dmg")
        XCTAssertEqual(release?.sha256, "abc123")
    }

    func testIOSUsesStoreWhileMacUsesVerifiedDirectArtifact() throws {
        let file = URL(string: "https://example.com/game.pkg")!
        let store = URL(string: "https://apps.apple.com/app/id1")!
        let release = ReleaseManifest(version: "0.3.0", build: 3, url: file, sha256: "abc", storeURL: store)
        XCTAssertEqual(UpdateService().check(currentVersion: "0.2.0", currentBuild: 2, release: release, platform: "ios"), .store(store))
        XCTAssertEqual(UpdateService().check(currentVersion: "0.2.0", currentBuild: 2, release: release, platform: "macos"), .direct(file, sha256: "abc"))
        XCTAssertThrowsError(try UpdateService().verify(Data("wrong".utf8), expectedSHA256: "abc"))
    }

    func testIOSAcceptsAStoreOnlyManifestWithoutPretendingMacHasADirectPackage() throws {
        let json = #"{"apps":[{"id":"survival-diary-ios","version":"0.6.0","build":40,"installURL":"https://apps.apple.com/app/id1"}]}"#.data(using: .utf8)!
        let manifestURL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!
        let release = try XCTUnwrap(UpdateService().release(in: json, manifestURL: manifestURL, appID: "survival-diary-ios"))
        XCTAssertEqual(UpdateService().check(currentVersion: "0.5.5", currentBuild: 20, release: release, platform: "ios"), .store(release.url))
        XCTAssertEqual(UpdateService().check(currentVersion: "0.5.5", currentBuild: 20, release: release, platform: "macos"), .current)
    }

    func testVerifiesDownloadedFileWithoutLoadingWholeArtifactIntoMemory() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("survival-diary".utf8).write(to: url)
        XCTAssertNoThrow(try UpdateService().verify(
            fileAt: url,
            expectedSHA256: "bac289851561220e8d8a93ab38b8313a5eacec1142fdd77539af71b3d2666546"
        ))
        XCTAssertThrowsError(try UpdateService().verify(fileAt: url, expectedSHA256: String(repeating: "0", count: 64)))
    }

    func testPushNeverTrustsPayloadURL() {
        let canonical = URL(string: "https://example.com/manifest.json")!
        let service = ReleasePushService(manifestURL: canonical)
        XCTAssertEqual(service.manifestToRefetch(notification: ["type": "release", "build": "3", "url": "https://evil.invalid/app"]), canonical)
    }
}
