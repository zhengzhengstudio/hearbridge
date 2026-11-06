import SpriteKit
import SurvivalDiaryCore

public enum EntityVisualMetrics {
    public static func size(for type: String) -> CGSize {
        switch type {
        case "shelter": return CGSize(width: 170, height: 132)
        case "garden-plot": return CGSize(width: 138, height: 96)
        case "rain-collector": return CGSize(width: 116, height: 102)
        case "workbench", "fish-rack", "palisade": return CGSize(width: 112, height: 80)
        case "storage-crate": return CGSize(width: 76, height: 66)
        case "furnace": return CGSize(width: 104, height: 94)
        case "campfire": return CGSize(width: 62, height: 58)
        case "road-segment": return CGSize(width: 52, height: 52)
        case "rail-segment": return CGSize(width: 56, height: 56)
        case "minecart": return CGSize(width: 72, height: 48)
        case "rowboat": return CGSize(width: 172, height: 78)
        case "animal-land-crab": return CGSize(width: 54, height: 44)
        case "animal-sea-turtle": return CGSize(width: 82, height: 58)
        case "animal-wild-boar": return CGSize(width: 92, height: 70)
        default: return CGSize(width: 92, height: 82)
        }
    }
}

public final class IslandScene: SKScene {
    private let terrain = SKNode()
    private let entities = SKNode()
    private let actors = SKNode()
    private let villagers = SKNode()
    private let explorationFog = SKNode()
    private let weather = SKNode()
    private let screenMarkers = SKNode()
    public private(set) var cameraController = CameraController()

    public override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        backgroundColor = SKColor(red: 0.07, green: 0.39, blue: 0.43, alpha: 1)
        weather.zPosition = 50_000
        screenMarkers.zPosition = 60_000
        explorationFog.zPosition = 40_000
        [terrain, entities, villagers, actors, explorationFog, weather, screenMarkers].forEach(addChild)
        drawInitialIsland()
    }

    @available(*, unavailable)
    required init?(coder aDecoder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func drawInitialIsland() {
        if let texture = AtlasLoader.texture(named: "continuous-world-atlas-v2.png") {
            let island = SKSpriteNode(texture: texture)
            island.size = CGSize(width: 980, height: 620)
            island.texture?.filteringMode = .linear
            terrain.addChild(island)
        } else {
            let island = SKShapeNode(ellipseOf: CGSize(width: 680, height: 420))
            island.fillColor = SKColor(red: 0.37, green: 0.60, blue: 0.33, alpha: 1)
            island.strokeColor = SKColor(red: 0.78, green: 0.70, blue: 0.46, alpha: 1)
            island.lineWidth = 28
            terrain.addChild(island)
        }

        if let sheet = AtlasLoader.texture(named: "survivor-directions-v1.png") {
            let frame = SKTexture(rect: CGRect(x: 0, y: 0.5, width: 0.125, height: 0.5), in: sheet)
            let survivor = SKSpriteNode(texture: frame)
            survivor.size = CGSize(width: 78, height: 122)
            survivor.anchorPoint = CGPoint(x: 0.5, y: 0.18)
            survivor.name = "local-player"
            actors.addChild(survivor)
            drawVillage(using: sheet)
        } else {
            let survivor = SKShapeNode(circleOfRadius: 18)
            survivor.fillColor = SKColor(red: 0.93, green: 0.48, blue: 0.25, alpha: 1)
            survivor.strokeColor = .white
            survivor.lineWidth = 3
            actors.addChild(survivor)
        }
    }

    private func drawVillage(using sheet: SKTexture) {
        let path = SKShapeNode(rectOf: CGSize(width: 190, height: 92), cornerRadius: 34)
        path.fillColor = SKColor(red: 0.55, green: 0.43, blue: 0.25, alpha: 0.38); path.strokeColor = .clear
        path.position = CGPoint(x: VillageRules.center.x, y: VillageRules.center.y); path.zPosition = -2; villagers.addChild(path)
        for (index, resident) in VillageRules.residents.enumerated() {
            let frame = SKTexture(rect: CGRect(x: CGFloat((index + 1) % 8) * 0.125, y: 0.5, width: 0.125, height: 0.5), in: sheet)
            let sprite = SKSpriteNode(texture: frame)
            sprite.size = CGSize(width: 64 + CGFloat(index * 4), height: 106 + CGFloat(index * 3)); sprite.anchorPoint = CGPoint(x: 0.5, y: 0.18)
            sprite.position = CGPoint(x: resident.home.x, y: resident.home.y); sprite.name = resident.id
            sprite.color = [SKColor.systemOrange, SKColor.systemTeal, SKColor.systemGreen][index]; sprite.colorBlendFactor = 0.22
            villagers.addChild(sprite)
        }
    }

    public func apply(state: GameSave) {
        actors.position = CGPoint(x: state.player.position.x, y: state.player.position.y)
        actors.zPosition = 20_000 - state.player.position.y
        renderExplorationFog(around: state.player.position)
        for resident in VillageRules.residents {
            let position = VillageRules.position(of: resident, minute: state.clock.minute)
            let node = villagers.childNode(withName: resident.id)
            node?.position = CGPoint(x: position.x, y: position.y)
            node?.zPosition = 20_000 - position.y
        }
        renderEntities(state.entities)
        weather.removeAllChildren()
        let hour = Double(state.clock.minute) / 60
        let night = max(0, min(0.62, abs(hour - 12) / 12 * 0.78 - 0.16))
        let shade = SKShapeNode(rectOf: size)
        shade.fillColor = SKColor(red: 0.03, green: 0.07, blue: 0.20, alpha: night)
        shade.strokeColor = .clear; shade.zPosition = 90; weather.addChild(shade)
        if ["rain", "storm", "snow", "blizzard"].contains(state.weather.kind) {
            let count = max(8, Int(40 * state.weather.intensity))
            for index in 0..<count {
                let drop = SKShapeNode(circleOfRadius: state.weather.kind.contains("snow") ? 2.2 : 1.1)
                drop.fillColor = state.weather.kind.contains("snow") ? .white : SKColor(red: 0.72, green: 0.88, blue: 0.95, alpha: 0.7)
                drop.position = CGPoint(x: (index * 71) % max(1, Int(size.width)), y: (index * 43) % max(1, Int(size.height)))
                drop.zPosition = 100; weather.addChild(drop)
            }
        }
    }

    private func renderExplorationFog(around player: WorldPoint) {
        let center = CGPoint(x: player.x, y: player.y)
        let world = CGSize(width: 1_760, height: 1_320)
        let clearing = CGSize(width: 430, height: 300)
        explorationFog.removeAllChildren()

        func fogRect(_ size: CGSize, _ position: CGPoint, alpha: CGFloat = 0.96) {
            let node = SKShapeNode(rectOf: size)
            node.position = position
            node.fillColor = SKColor(red: 0.025, green: 0.09, blue: 0.085, alpha: alpha)
            node.strokeColor = .clear
            explorationFog.addChild(node)
        }
        fogRect(CGSize(width: world.width, height: (world.height - clearing.height) / 2), CGPoint(x: center.x, y: center.y + (world.height + clearing.height) / 4))
        fogRect(CGSize(width: world.width, height: (world.height - clearing.height) / 2), CGPoint(x: center.x, y: center.y - (world.height + clearing.height) / 4))
        fogRect(CGSize(width: (world.width - clearing.width) / 2, height: clearing.height), CGPoint(x: center.x - (world.width + clearing.width) / 4, y: center.y))
        fogRect(CGSize(width: (world.width - clearing.width) / 2, height: clearing.height), CGPoint(x: center.x + (world.width + clearing.width) / 4, y: center.y))

        func fogBank(horizontal: Bool, boundary: CGFloat, sign: CGFloat, length: CGFloat, phase: CGFloat) {
            let path = CGMutablePath()
            let start = horizontal ? CGPoint(x: center.x - length / 2, y: boundary) : CGPoint(x: boundary, y: center.y - length / 2)
            path.move(to: start)
            var points: [CGPoint] = []
            for index in 0...10 {
                let progress = CGFloat(index) / 10
                let reach = 34 + sin(progress * .pi * 2 + phase) * 12 + sin(progress * .pi * 4 + phase * 0.57) * 5 + CGFloat((index * 17 + Int(phase * 10)) % 8)
                let along = progress * length - length / 2
                points.append(horizontal
                    ? CGPoint(x: center.x + along, y: boundary + sign * reach)
                    : CGPoint(x: boundary + sign * reach, y: center.y + along))
            }
            path.addLine(to: points[0])
            for index in 1..<points.count {
                let previous = points[index - 1], current = points[index]
                path.addQuadCurve(to: CGPoint(x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2), control: previous)
            }
            path.addQuadCurve(to: points.last!, control: points.last!)
            path.addLine(to: horizontal ? CGPoint(x: center.x + length / 2, y: boundary) : CGPoint(x: boundary, y: center.y + length / 2))
            path.closeSubpath()
            let bank = SKShapeNode(path: path)
            bank.fillColor = SKColor(red: 0.025, green: 0.09, blue: 0.085, alpha: 1)
            bank.strokeColor = .clear
            explorationFog.addChild(bank)
        }
        fogBank(horizontal: true, boundary: center.y + clearing.height / 2, sign: -1, length: clearing.width, phase: 0.8)
        fogBank(horizontal: true, boundary: center.y - clearing.height / 2, sign: 1, length: clearing.width, phase: 2.4)
        fogBank(horizontal: false, boundary: center.x - clearing.width / 2, sign: 1, length: clearing.height, phase: 1.7)
        fogBank(horizontal: false, boundary: center.x + clearing.width / 2, sign: -1, length: clearing.height, phase: 3.1)
        explorationFog.alpha = 0
        explorationFog.run(.fadeAlpha(to: 1, duration: 0.42))
    }

    private func renderEntities(_ values: [PlacedEntity]) {
        entities.removeAllChildren()
        for entity in values {
            if entity.type == "road-segment" || entity.type == "rail-segment" {
                let node = entity.type == "road-segment" ? roadNode(for: entity, among: values) : railNode(for: entity, among: values)
                node.name = entity.id
                node.position = CGPoint(x: entity.position.x, y: entity.position.y)
                node.zPosition = -10_000 - entity.position.y
                entities.addChild(node)
                continue
            }
            let filename = "placeables/\(entity.type)-v1.png"
            let node: SKNode
            if let texture = AtlasLoader.texture(named: filename) {
                let sprite = SKSpriteNode(texture: texture)
                sprite.size = EntityVisualMetrics.size(for: entity.type)
                sprite.texture?.filteringMode = .linear
                node = sprite
            } else {
                let fallback = SKShapeNode(rectOf: CGSize(width: 64, height: 48), cornerRadius: 8)
                fallback.fillColor = SKColor(red: 0.35, green: 0.24, blue: 0.14, alpha: 1)
                node = fallback
            }
            node.name = entity.id
            node.position = CGPoint(x: entity.position.x, y: entity.position.y)
            node.zPosition = 20_000 - entity.position.y
            node.zRotation = CGFloat(entity.rotation) * .pi / 2
            node.setScale(1 + CGFloat(max(0, entity.level - 1)) * 0.08)
            entities.addChild(node)
        }
    }

    private func roadNode(for road: PlacedEntity, among values: [PlacedEntity]) -> SKNode {
        let tolerance: CGFloat = 8
        let roads = values.filter { $0.type == "road-segment" && $0.id != road.id }
        func connected(_ dx: CGFloat, _ dy: CGFloat) -> Bool {
            roads.contains { abs($0.position.x - road.position.x - dx) <= tolerance && abs($0.position.y - road.position.y - dy) <= tolerance }
        }
        let n = connected(0, 48), e = connected(48, 0), s = connected(0, -48), w = connected(-48, 0)
        let count = [n, e, s, w].filter { $0 }.count
        let root = SKNode()
        func add(_ filename: String, rotation: CGFloat = 0) {
            guard let texture = AtlasLoader.texture(named: "placeables/\(filename)") else { return }
            let sprite = SKSpriteNode(texture: texture); sprite.size = CGSize(width: 54, height: 54)
            sprite.texture?.filteringMode = .linear; sprite.zRotation = rotation; root.addChild(sprite)
        }
        if count == 4 { add("road-straight-ew-v1.png"); add("road-straight-ns-v1.png") }
        else if count == 3 {
            let missing = !n ? 0 : !e ? 1 : !s ? 2 : 3
            add("road-junction-t-v1.png", rotation: CGFloat(missing) * .pi / 2)
        } else if count == 2 && !((n && s) || (e && w)) {
            let turns: Int = (e && s) ? 0 : (s && w) ? 1 : (w && n) ? 2 : 3
            add("road-curve-es-v1.png", rotation: CGFloat(turns) * .pi / 2)
        } else if n || s { add("road-straight-ns-v1.png") }
        else { add("road-straight-ew-v1.png") }
        return root
    }

    private func railNode(for rail: PlacedEntity, among values: [PlacedEntity]) -> SKNode {
        let tolerance: CGFloat = 8
        let rails = values.filter { $0.type == "rail-segment" && $0.id != rail.id }
        func connected(_ dx: CGFloat, _ dy: CGFloat) -> Bool {
            rails.contains { abs($0.position.x - rail.position.x - dx) <= tolerance && abs($0.position.y - rail.position.y - dy) <= tolerance }
        }
        let n = connected(0, 48), e = connected(48, 0), s = connected(0, -48), w = connected(-48, 0)
        let count = [n, e, s, w].filter { $0 }.count
        let root = SKNode()
        func add(_ filename: String, rotation: CGFloat = 0) {
            guard let texture = AtlasLoader.texture(named: "placeables/\(filename)") else { return }
            let sprite = SKSpriteNode(texture: texture)
            sprite.size = CGSize(width: 56, height: 56)
            sprite.texture?.filteringMode = .linear
            sprite.zRotation = rotation
            root.addChild(sprite)
        }
        if count == 4 { add("rail-crossing-v1.png") }
        else if count == 3 {
            let missing = !n ? 0 : !e ? 1 : !s ? 2 : 3
            add("rail-junction-t-v1.png", rotation: CGFloat(missing) * .pi / 2)
        } else if count == 2 && !((n && s) || (e && w)) {
            let turns: Int = (e && s) ? 0 : (s && w) ? 1 : (w && n) ? 2 : 3
            add("rail-curve-es-v1.png", rotation: CGFloat(turns) * .pi / 2)
        } else if n && s { add("rail-straight-ns-v1.png") }
        else if e && w { add("rail-straight-ew-v1.png") }
        else if n || s { add("rail-straight-ns-v1.png") }
        else { add("rail-straight-ew-v1.png") }
        return root
    }

    public func applyCamera(_ controller: CameraController) {
        cameraController = controller
        let angle = CGFloat(controller.quarterTurns) * .pi / 2
        [terrain, entities, villagers, actors, explorationFog].forEach { node in
            node.setScale(controller.zoom); node.zRotation = angle; node.position = CGPoint(x: -controller.center.x, y: -controller.center.y)
        }
    }

    public func zoom(by factor: CGFloat) {
        cameraController.zoom(by: factor)
        applyCamera(cameraController)
    }

    public func pan(screenDelta: CGPoint) {
        cameraController.pan(screenDelta: screenDelta)
        applyCamera(cameraController)
    }

    public func rotateQuarterTurn() {
        cameraController.rotateQuarterTurn()
        applyCamera(cameraController)
    }

    public func previewPlacement(type: String, at point: CGPoint, valid: Bool) {
        screenMarkers.childNode(withName: "placement-preview")?.removeFromParent()
        let preview = SKShapeNode(rectOf: CGSize(width: 72, height: 50), cornerRadius: 8)
        preview.name = "placement-preview"; preview.position = point; preview.alpha = 0.62
        preview.fillColor = valid ? SKColor(red: 0.25, green: 0.62, blue: 0.39, alpha: 1) : SKColor(red: 0.72, green: 0.25, blue: 0.22, alpha: 1)
        screenMarkers.addChild(preview)
    }
}
