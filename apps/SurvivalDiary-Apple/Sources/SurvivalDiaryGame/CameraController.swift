import CoreGraphics
import Foundation

public struct CameraController: Equatable, Sendable {
    public var center: CGPoint
    public var zoom: CGFloat
    public var quarterTurns: Int

    public init(center: CGPoint = .zero, zoom: CGFloat = 1, quarterTurns: Int = 0) {
        self.center = center; self.zoom = min(3, max(0.35, zoom)); self.quarterTurns = ((quarterTurns % 4) + 4) % 4
    }

    public mutating func zoom(by factor: CGFloat) { zoom = min(3, max(0.35, zoom * factor)) }
    public mutating func rotateQuarterTurn() { quarterTurns = (quarterTurns + 1) % 4 }
    public mutating func pan(screenDelta: CGPoint) {
        let world = rotate(CGPoint(x: screenDelta.x / zoom, y: screenDelta.y / zoom), turns: -quarterTurns)
        center.x -= world.x; center.y -= world.y
    }
    public func worldToScreen(_ point: CGPoint, viewport: CGSize) -> CGPoint {
        let local = CGPoint(x: point.x - center.x, y: point.y - center.y)
        let rotated = rotate(local, turns: quarterTurns)
        return CGPoint(x: viewport.width / 2 + rotated.x * zoom, y: viewport.height / 2 + rotated.y * zoom)
    }
    public func screenToWorld(_ point: CGPoint, viewport: CGSize) -> CGPoint {
        let local = CGPoint(x: (point.x - viewport.width / 2) / zoom, y: (point.y - viewport.height / 2) / zoom)
        let unrotated = rotate(local, turns: -quarterTurns)
        return CGPoint(x: center.x + unrotated.x, y: center.y + unrotated.y)
    }
    private func rotate(_ point: CGPoint, turns: Int) -> CGPoint {
        switch ((turns % 4) + 4) % 4 {
        case 1: return CGPoint(x: -point.y, y: point.x)
        case 2: return CGPoint(x: -point.x, y: -point.y)
        case 3: return CGPoint(x: point.y, y: -point.x)
        default: return point
        }
    }
}
