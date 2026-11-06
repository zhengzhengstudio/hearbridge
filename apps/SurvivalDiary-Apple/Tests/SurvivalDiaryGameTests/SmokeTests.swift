import XCTest
@testable import SurvivalDiaryGame

final class SmokeTests: XCTestCase {
    func testSceneIsNativeSpriteKit() {
        let scene = IslandScene(size: .init(width: 100, height: 100))
        XCTAssertEqual(scene.children.count, 7)
        XCTAssertTrue(scene.children.contains { $0.zPosition == 40_000 })
    }

    func testCameraTransformIsReversibleAtEveryRotation() {
        let viewport = CGSize(width: 390, height: 844)
        for turn in 0..<4 {
            let camera = CameraController(center: CGPoint(x: 90, y: -40), zoom: 2.4, quarterTurns: turn)
            let source = CGPoint(x: -12, y: 74)
            let result = camera.screenToWorld(camera.worldToScreen(source, viewport: viewport), viewport: viewport)
            XCTAssertEqual(result.x, source.x, accuracy: 0.0001)
            XCTAssertEqual(result.y, source.y, accuracy: 0.0001)
        }
    }

    func testCameraClampsZoom() {
        var camera = CameraController(zoom: 1)
        camera.zoom(by: 100); XCTAssertEqual(camera.zoom, 3)
        camera.zoom(by: 0.001); XCTAssertEqual(camera.zoom, 0.35)
    }

    func testEntityVisualMetricsPreserveBuildingScaleHierarchy() {
        let shelter = EntityVisualMetrics.size(for: "shelter")
        let workbench = EntityVisualMetrics.size(for: "workbench")
        let campfire = EntityVisualMetrics.size(for: "campfire")
        XCTAssertGreaterThan(shelter.width, workbench.width)
        XCTAssertGreaterThan(workbench.width, campfire.width)
        XCTAssertGreaterThan(shelter.height, shelter.width * 0.65)
    }
}
