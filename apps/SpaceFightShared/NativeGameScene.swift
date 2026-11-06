import Foundation
import SpriteKit

private let ANALOG_DEADZONE: CGFloat = 0.05
private let ANALOG_RESPONSE_EXPONENT: CGFloat = 0.72

/// Flight feel, kept in sync with the Cocos `FlightTuning` constants.
/// Speed used to be an instantaneous per-frame value, so releasing the stick
/// stopped the ship dead and it felt like sliding on ice. It now chases a
/// target speed: quick to spool up, then coasts all the way to zero.
///
/// Note the release target must be 0, not a "floor" ratio — a floor makes the
/// ship drift forward forever when the player does nothing, so it can never
/// hover and slowly flies out of the battlefield.
private let FLIGHT_THROTTLE_RESPONSE: CGFloat = 0.28
private let FLIGHT_COAST_DRAG: CGFloat = 0.5

/// Brief invulnerability after each hit, so a single burst cannot delete the
/// player before the damage is readable.
private let PLAYER_HIT_GRACE_SECONDS: TimeInterval = 0.42

enum SFMissionKind: String, CaseIterable {
    case survival = "survival"
    case boss = "boss"
    case escort = "escort"
    case defense = "defense"
    case timed = "timed"
    case raid = "raid"
}

enum SFCameraMode: String, CaseIterable {
    case cockpit = "cockpit"
    case chase = "chase"
}

enum SFRegionKind: String, CaseIterable {
    case canyon = "canyon"
    case storm = "storm"
}

struct SFLoadoutProfile {
    var weapon: Int
    var device: Int
    var core: Int

    static func saved() -> SFLoadoutProfile {
        SFLoadoutProfile(
            weapon: max(0, min(4, UserDefaults.standard.integer(forKey: "spacefight.startingWeapon"))),
            device: max(0, min(4, UserDefaults.standard.integer(forKey: "spacefight.tacticalDevice"))),
            core: max(0, min(5, UserDefaults.standard.integer(forKey: "spacefight.frameCore")))
        )
    }

    func save() {
        UserDefaults.standard.set(max(0, min(4, weapon)), forKey: "spacefight.startingWeapon")
        UserDefaults.standard.set(max(0, min(4, device)), forKey: "spacefight.tacticalDevice")
        UserDefaults.standard.set(max(0, min(5, core)), forKey: "spacefight.frameCore")
    }
}

struct SFControlProfile {
    var aimSensitivity: CGFloat
    var leftHanded: Bool
    var forwardKey: UInt16
    var backwardKey: UInt16
    var leftKey: UInt16
    var rightKey: UInt16
    var fireKey: UInt16
    var cameraKey: UInt16

    static func saved() -> SFControlProfile {
        let defaults = UserDefaults.standard
        func key(_ name: String, _ fallback: UInt16) -> UInt16 {
            let stored = defaults.integer(forKey: "spacefight.key.\(name)")
            return stored == 0 ? fallback : UInt16(clamping: stored)
        }
        let savedSensitivity = defaults.double(forKey: "spacefight.aimSensitivity")
        return SFControlProfile(
            aimSensitivity: savedSensitivity == 0 ? 1 : max(0.65, min(1.6, savedSensitivity)),
            leftHanded: defaults.bool(forKey: "spacefight.leftHanded"),
            forwardKey: key("forward", 13),
            backwardKey: key("backward", 1),
            leftKey: key("left", 0),
            rightKey: key("right", 2),
            fireKey: key("fire", 49),
            cameraKey: key("camera", 9)
        )
    }

    func save() {
        let defaults = UserDefaults.standard
        defaults.set(Double(aimSensitivity), forKey: "spacefight.aimSensitivity")
        defaults.set(leftHanded, forKey: "spacefight.leftHanded")
        defaults.set(Int(forwardKey), forKey: "spacefight.key.forward")
        defaults.set(Int(backwardKey), forKey: "spacefight.key.backward")
        defaults.set(Int(leftKey), forKey: "spacefight.key.left")
        defaults.set(Int(rightKey), forKey: "spacefight.key.right")
        defaults.set(Int(fireKey), forKey: "spacefight.key.fire")
        defaults.set(Int(cameraKey), forKey: "spacefight.key.camera")
    }
}

struct SFObjectiveState {
    var label = ""
    var progress: CGFloat = 0
    var escortHealth = 100
    var controlProgress = 0
    var timeRemaining: TimeInterval = 0
    var raidCollected = 0
    var bossComponents = 0
}

struct SFEntity {
    let id: String
    let type: String
    let x: CGFloat
    let z: CGFloat
    let rotation: CGFloat
    let health: CGFloat
    let maxHealth: CGFloat
    let owner: String
    let weapon: String
}

struct SFSnapshot {
    var playerId = ""
    var wave = 0
    var score = 0
    var health = 100
    var shield = 100
    var energy = 100
    var players: [SFEntity] = []
    var enemies: [SFEntity] = []
    var bullets: [SFEntity] = []
    var powerups: [SFEntity] = []
    var mission: SFMissionKind = .survival
    var region: SFRegionKind = .canyon
    var objective = SFObjectiveState()
    var missionComplete = false
    var missionFailed = false
}

private struct SFLocalBody {
    var id: String
    var type: String
    var x: CGFloat
    var z: CGFloat
    var rotation: CGFloat
    var health: CGFloat
    var maxHealth: CGFloat
    var owner: String
    var weapon: String
    var vx: CGFloat = 0
    var vz: CGFloat = 0
    var life: CGFloat = 0
}

private final class SFLocalBattle {
    private let maxTurnRate: CGFloat = .pi * 1.25
    private var mission: SFMissionKind = .survival
    private var region: SFRegionKind = .canyon
    private var playerX: CGFloat = 0
    private var playerZ: CGFloat = 8
    private var playerRotation: CGFloat = 0
    private var health: CGFloat = 100
    private var shield: CGFloat = 80
    private var energy: CGFloat = 100
    private var score = 0
    private var wave = 0
    private var cooldown: CGFloat = 0
    /// Current longitudinal speed scalar produced by the first-order chase.
    private var currentSpeed: CGFloat = 0
    /// Remaining post-hit invulnerability; damage is ignored while positive.
    private var hitGraceRemaining: TimeInterval = 0
    /// Damage accumulated during the current step, applied in flushPlayerDamage().
    private var pendingPlayerDamage: CGFloat = 0
    private var enemyFireCooldown: CGFloat = 0.7
    private var waveDelay: CGFloat = 0.8
    private var missionElapsed: TimeInterval = 0
    private var timeRemaining: TimeInterval = 0
    private var escortHealth: CGFloat = 100
    private var escortZ: CGFloat = 24
    private var controlProgress: CGFloat = 0
    private var raidCollected = 0
    private var missionKills = 0
    private var bossComponents = 0
    private var missionComplete = false
    private var missionFailed = false
    private var lockRange: CGFloat = 28
    private var energyRecovery: CGFloat = 20
    private var maxHealth: CGFloat = 100
    private var maxShield: CGFloat = 80
    private var speedFactor: CGFloat = 1
    private var turnFactor: CGFloat = 1
    private var damageFactor: CGFloat = 1
    private var energyCostFactor: CGFloat = 1
    private var pickupRadius: CGFloat = 2.2
    private var scoreFactor: CGFloat = 1
    private var hullRegen: CGFloat = 0
    private var shieldRegen: CGFloat = 3.5
    private var energyRecoveryFactor: CGFloat = 1
    private var nextId = 1
    private var enemies: [SFLocalBody] = []
    private var bullets: [SFLocalBody] = []
    private var objectives: [SFLocalBody] = []

    func reset(mode: String, loadout: SFLoadoutProfile) -> SFSnapshot {
        mission = Self.mission(for: mode)
        region = SFRegionKind.allCases.randomElement() ?? Self.region(for: mission)
        configure(loadout)
        playerX = 0
        playerZ = 8
        playerRotation = 0
        // Clear coasting speed and invulnerability so a new run never starts
        // with leftover momentum or free damage window from the previous one.
        currentSpeed = 0
        hitGraceRemaining = 0
        pendingPlayerDamage = 0
        health = maxHealth
        shield = maxShield
        energy = 100
        score = 0
        wave = 0
        cooldown = 0
        enemyFireCooldown = 0.7
        waveDelay = 0.6
        missionElapsed = 0
        timeRemaining = mission == .timed ? 55 : 0
        escortHealth = 100
        escortZ = 24
        controlProgress = 0
        raidCollected = 0
        missionKills = 0
        bossComponents = 0
        missionComplete = false
        missionFailed = false
        lockRange = 28
        energyRecovery = 20 * energyRecoveryFactor
        nextId = 1
        enemies.removeAll(keepingCapacity: true)
        bullets.removeAll(keepingCapacity: true)
        objectives.removeAll(keepingCapacity: true)
        configureMission()
        return snapshot()
    }

    func step(
        dt: CGFloat,
        throttle: CGFloat,
        strafe: CGFloat,
        turn: CGFloat,
        boost: Bool,
        fire: Bool,
        weapon: Int,
        training: Bool = false
    ) -> SFSnapshot {
        guard !missionComplete, !missionFailed else { return snapshot() }
        let frame = min(dt, 1.0 / 30.0)
        missionElapsed += TimeInterval(frame)
        playerRotation += turn * frame * maxTurnRate * turnFactor
        let speed: CGFloat = (boost && energy > 1 ? 15 : 9) * speedFactor
        let forwardX = sin(playerRotation)
        let forwardZ = -cos(playerRotation)
        let rightX = cos(playerRotation)
        let rightZ = sin(playerRotation)
        // First-order chase toward the target speed: spool up under thrust,
        // coast down with drag when the stick is released.
        let hasThrust = hypot(throttle, strafe) > 0.01
        let targetSpeed: CGFloat = hasThrust ? (boost ? 1.5 : 1) : 0
        let response = hasThrust ? FLIGHT_THROTTLE_RESPONSE : FLIGHT_COAST_DRAG
        currentSpeed += (targetSpeed - currentSpeed) * min(1, frame / response)
        let moveSpeed = speed * currentSpeed
        // Coasting must be driven independently of the stick input: if the
        // displacement still multiplies throttle/strafe, releasing the stick
        // zeroes displacement and coastDrag / idleSpeedFloor become no-ops.
        let driveX = hasThrust ? forwardX * throttle : forwardX
        let driveZ = hasThrust ? forwardZ * throttle : forwardZ
        playerX += (driveX + rightX * strafe * 0.86) * moveSpeed * frame
        playerZ += (driveZ + rightZ * strafe * 0.86) * moveSpeed * frame
        if hitGraceRemaining > 0 {
            hitGraceRemaining = max(0, hitGraceRemaining - frame)
        }
        applyRegionRules(dt: frame)
        energy = max(0, min(100, energy + (boost ? -34 : energyRecovery) * frame))
        health = min(maxHealth, health + hullRegen * frame)
        shield = min(maxShield, shield + shieldRegen * frame)

        cooldown = max(0, cooldown - frame)
        if fire && cooldown <= 0 && energy >= 4 {
            let rates: [CGFloat] = [0.13, 0.38, 0.58, 0.7, 0.26]
            let speeds: [CGFloat] = [48, 38, 28, 82, 34]
            let damages: [CGFloat] = [12, 9, 34, 52, 27]
            let selected = max(0, min(4, weapon))
            cooldown = rates[selected]
            energy -= (selected == 0 || selected == 4 ? 5 : 2) * energyCostFactor
            let muzzleX = playerX + forwardX * 1.4
            let muzzleZ = playerZ + forwardZ * 1.4
            var velocityX = forwardX * speeds[selected]
            var velocityZ = forwardZ * speeds[selected]
            if selected == 2, let target = enemies.min(by: {
                hypot($0.x - playerX, $0.z - playerZ) < hypot($1.x - playerX, $1.z - playerZ)
            }), hypot(target.x - playerX, target.z - playerZ) <= lockRange {
                let distance = max(0.001, hypot(target.x - muzzleX, target.z - muzzleZ))
                velocityX = (target.x - muzzleX) / distance * speeds[selected]
                velocityZ = (target.z - muzzleZ) / distance * speeds[selected]
            }
            bullets.append(SFLocalBody(
                id: id("b"), type: "bullet", x: muzzleX, z: muzzleZ,
                rotation: playerRotation, health: damages[selected] * damageFactor, maxHealth: damages[selected] * damageFactor,
                owner: "player", weapon: selected == 2 ? "missile" : String(selected),
                vx: velocityX, vz: velocityZ, life: 1.5
            ))
        }

        if !training && enemies.isEmpty && shouldBeginWave {
            waveDelay -= frame
            if waveDelay <= 0 { beginWave() }
        }

        for index in enemies.indices {
            let target = enemyTarget(for: enemies[index])
            let dx = target.x - enemies[index].x
            let dz = target.z - enemies[index].z
            let distance = max(0.001, hypot(dx, dz))
            let baseSpeed: CGFloat = enemies[index].type == "boss" ? 2.0 : (enemies[index].type == "bomber" ? 3.4 : 5.0)
            let speed = baseSpeed + min(4, CGFloat(wave) * 0.22)
            enemies[index].x += dx / distance * speed * frame
            enemies[index].z += dz / distance * speed * frame
            enemies[index].rotation = atan2(dx, -dz)
            if distance < (enemies[index].type == "boss" ? 3.2 : 1.25) {
                let damage = (enemies[index].type == "boss" ? 28 : 13) * frame
                if mission == .escort, target.isObjective {
                    escortHealth = max(0, escortHealth - damage)
                } else if !target.isObjective {
                    applyDamage(damage)
                }
            }
        }

        if !training {
            enemyFireCooldown -= frame
            if enemyFireCooldown <= 0, let shooter = enemies
                .filter({ $0.type != "bossComponent" })
                .min(by: { hypot($0.x - playerX, $0.z - playerZ) < hypot($1.x - playerX, $1.z - playerZ) }) {
                let dx = playerX - shooter.x
                let dz = playerZ - shooter.z
                let distance = max(0.001, hypot(dx, dz))
                if distance < 27 {
                    let speed: CGFloat = shooter.type == "boss" ? 18 : 15
                    bullets.append(SFLocalBody(
                        id: id("eb"), type: "bullet", x: shooter.x, z: shooter.z,
                        rotation: atan2(dx, -dz), health: shooter.type == "boss" ? 16 : (shooter.type == "scout" ? 6 : 9),
                        maxHealth: 16, owner: "enemy", weapon: "enemy",
                        vx: dx / distance * speed, vz: dz / distance * speed, life: 2.4
                    ))
                    enemyFireCooldown = max(0.32, 1.05 - CGFloat(wave) * 0.035)
                } else {
                    enemyFireCooldown = 0.2
                }
            }
        }

        for index in bullets.indices {
            bullets[index].x += bullets[index].vx * frame
            bullets[index].z += bullets[index].vz * frame
            bullets[index].life -= frame
            if bullets[index].owner == "enemy" {
                if hypot(bullets[index].x - playerX, bullets[index].z - playerZ) < 1.05 {
                    applyDamage(bullets[index].health)
                    bullets[index].life = 0
                }
                continue
            }
            var hit: Int?
            for enemyIndex in enemies.indices {
                let hitRadius: CGFloat = enemies[enemyIndex].type == "boss" ? 3.6 : 1.15
                if hypot(bullets[index].x - enemies[enemyIndex].x, bullets[index].z - enemies[enemyIndex].z) < hitRadius {
                    if enemies[enemyIndex].type == "boss", bossComponents > 0 { continue }
                    hit = enemyIndex
                    break
                }
            }
            if let hit {
                enemies[hit].health -= bullets[index].health
                bullets[index].life = 0
            }
        }
        bullets.removeAll { $0.life <= 0 || hypot($0.x - playerX, $0.z - playerZ) > 64 }
        // Settle damage accumulated during this step once, then open the brief
        // invulnerability window. Applying it per hit would also block sustained
        // contact damage, which can leave the player effectively immortal.
        flushPlayerDamage()

        let destroyed = enemies.filter { $0.health <= 0 }
        if !destroyed.isEmpty {
            score += Int(CGFloat(destroyed.reduce(0) { total, body in total + (body.type == "boss" ? 2500 : 120) }) * scoreFactor)
            missionKills += destroyed.count
            let destroyedComponents = destroyed.filter { $0.type == "bossComponent" }.count
            bossComponents = max(0, bossComponents - destroyedComponents)
            if mission == .timed { timeRemaining = min(75, timeRemaining + Double(destroyed.count) * 2.5) }
            enemies.removeAll { $0.health <= 0 }
            if enemies.isEmpty { waveDelay = mission == .timed ? 0.35 : 1.1 }
        }
        if !training { updateMission(dt: frame) }
        missionFailed = missionFailed || health <= 0
        return snapshot()
    }

    private static func mission(for mode: String) -> SFMissionKind {
        if let exact = SFMissionKind(rawValue: mode) { return exact }
        switch mode {
        case "boss": return .boss
        case "onslaught": return .timed
        default: return .survival
        }
    }

    private static func region(for mission: SFMissionKind) -> SFRegionKind {
        switch mission {
        case .escort, .defense, .raid: return .canyon
        case .survival, .boss, .timed: return .storm
        }
    }

    private var shouldBeginWave: Bool {
        switch mission {
        case .survival, .timed: return true
        case .boss: return wave == 0
        case .escort, .defense, .raid: return !missionComplete && !missionFailed
        }
    }

    private func configureMission() {
        switch mission {
        case .escort:
            objectives = [SFLocalBody(id: "escort", type: "escort", x: 0, z: escortZ, rotation: 0, health: 100, maxHealth: 100, owner: "friendly", weapon: "none")]
        case .defense:
            objectives = [SFLocalBody(id: "control", type: "control", x: 0, z: -3, rotation: 0, health: 100, maxHealth: 100, owner: "friendly", weapon: "none")]
        case .raid:
            objectives = (0..<10).map { index in
                let angle = CGFloat(index) / 10 * .pi * 2
                return SFLocalBody(id: "resource\(index)", type: "resource", x: cos(angle) * 19, z: sin(angle) * 19, rotation: angle, health: 1, maxHealth: 1, owner: "neutral", weapon: "resource")
            }
        default:
            break
        }
    }

    private func beginWave() {
        wave += 1
        if wave > 1, (wave - 1).isMultiple(of: 3) {
            region = region == .canyon ? .storm : .canyon
        }
        let bossWave = mission == .boss || (mission == .survival && wave % 5 == 0)
        if bossWave {
            let bossX = playerX + sin(playerRotation) * 28
            let bossZ = playerZ - cos(playerRotation) * 28
            let core = SFLocalBody(
                id: id("boss"), type: "boss", x: bossX, z: bossZ, rotation: .pi,
                health: CGFloat(700 + wave * 110), maxHealth: CGFloat(700 + wave * 110),
                owner: "enemy", weapon: "boss"
            )
            if mission == .boss {
                bossComponents = 3
                enemies = [core] + (0..<3).map { index in
                    let angle = CGFloat(index) / 3 * .pi * 2
                    return SFLocalBody(
                        id: id("component"), type: "bossComponent",
                        x: bossX + cos(angle) * 7, z: bossZ + sin(angle) * 7, rotation: angle,
                        health: 115, maxHealth: 115, owner: "enemy", weapon: "component"
                    )
                }
            } else {
                enemies = [core]
            }
            return
        }
        let count: Int
        switch mission {
        case .timed: count = min(18, 5 + wave * 2)
        case .escort: count = min(10, 3 + wave)
        case .defense: count = min(12, 4 + wave)
        case .raid: count = min(10, 3 + wave)
        default: count = min(20, 4 + wave)
        }
        let phase = CGFloat.random(in: 0..<(.pi * 2))
        let formation = Int.random(in: 0..<3)
        for index in 0..<count {
            let spread = formation == 0
                ? (CGFloat(index) - CGFloat(count) / 2) * 0.11
                : CGFloat(index) / CGFloat(max(1, count)) * .pi * 2
            let angle = phase + spread + CGFloat.random(in: 0..<0.18)
            let type: String
            if wave >= 4 && index % 7 == 0 { type = "gunship" }
            else if wave >= 3 && index % 5 == 0 { type = "bomber" }
            else if index % 3 == 0 { type = "fighter" }
            else { type = "scout" }
            let hp: CGFloat = type == "gunship" ? 110 : (type == "bomber" ? 78 : (type == "fighter" ? 42 : 24))
            let radius = CGFloat.random(in: 31..<38)
            enemies.append(SFLocalBody(
                id: id("e"), type: type,
                x: playerX + cos(angle) * radius, z: playerZ + sin(angle) * radius,
                rotation: angle, health: hp, maxHealth: hp,
                owner: "enemy", weapon: type
            ))
        }
    }

    private func updateMission(dt: CGFloat) {
        switch mission {
        case .survival:
            break
        case .boss:
            missionComplete = wave > 0 && bossComponents == 0 && enemies.isEmpty
        case .escort:
            escortZ -= 2.7 * dt
            if let index = objectives.firstIndex(where: { $0.type == "escort" }) {
                objectives[index].z = escortZ
                objectives[index].health = escortHealth
            }
            missionComplete = escortZ <= -24 && escortHealth > 0
            missionFailed = escortHealth <= 0
        case .defense:
            let playerInside = hypot(playerX, playerZ + 3) < 7
            let enemiesInside = enemies.filter { hypot($0.x, $0.z + 3) < 8 }.count
            if playerInside && enemiesInside == 0 { controlProgress += 16 * dt }
            else if enemiesInside > 0 { controlProgress -= CGFloat(enemiesInside) * 10 * dt }
            else { controlProgress -= 2 * dt }
            controlProgress = max(-100, min(100, controlProgress))
            missionComplete = controlProgress >= 100
            missionFailed = controlProgress <= -100
        case .timed:
            timeRemaining = max(0, timeRemaining - TimeInterval(dt))
            missionComplete = missionKills >= 18
            missionFailed = timeRemaining <= 0 && !missionComplete
        case .raid:
            let collected = objectives.filter { body in
                body.type == "resource" && hypot(body.x - playerX, body.z - playerZ) < pickupRadius
            }
            if !collected.isEmpty {
                let ids = Set(collected.map(\.id))
                objectives.removeAll { ids.contains($0.id) }
                raidCollected += collected.count
                score += Int(CGFloat(collected.count * 300) * scoreFactor)
            }
            missionComplete = raidCollected >= 8
        }
    }

    private func enemyTarget(for enemy: SFLocalBody) -> (x: CGFloat, z: CGFloat, isObjective: Bool) {
        let ordinal = enemy.id.compactMap(\.wholeNumberValue).reduce(0, +)
        if mission == .escort, ordinal % 3 != 0 {
            return (0, escortZ, true)
        }
        if mission == .defense, ordinal % 2 == 0 {
            return (0, -3, true)
        }
        return (playerX, playerZ, false)
    }

    private func applyRegionRules(dt: CGFloat) {
        switch region {
        case .canyon:
            let corridorCenter = sin(playerZ * 0.11) * 5
            let corridorHalfWidth: CGFloat = 13
            let collision = abs(playerX - corridorCenter) - corridorHalfWidth
            lockRange = 28
            energyRecovery = 20 * energyRecoveryFactor
            if collision > 0 {
                playerX = corridorCenter + (playerX < corridorCenter ? -corridorHalfWidth : corridorHalfWidth)
                applyDamage((8 + collision * 4) * dt)
            }
        case .storm:
            let stormPulse = (sin(CGFloat(missionElapsed) * 1.7) + 1) * 0.5
            lockRange = 14 + stormPulse * 3
            energyRecovery = 9 * energyRecoveryFactor
            playerRotation += sin(CGFloat(missionElapsed) * 0.9) * 0.08 * dt
        }
    }

    /// Player damage entry point: only **accumulates** damage for this step.
    ///
    /// It is applied once in `flushPlayerDamage()` at the end of the step, so a
    /// same-frame burst hits for a single hit (no instant deletion) while
    /// sustained contact damage still lands across steps.
    private func applyDamage(_ amount: CGFloat) {
        pendingPlayerDamage += max(0, amount)
    }

    /// Apply the damage accumulated during this step and open the grace window.
    private func flushPlayerDamage() {
        let damage = pendingPlayerDamage
        pendingPlayerDamage = 0
        guard damage > 0, hitGraceRemaining <= 0 else { return }
        let shieldHit = min(shield, damage)
        shield -= shieldHit
        health = max(0, health - max(0, damage - shieldHit))
        hitGraceRemaining = PLAYER_HIT_GRACE_SECONDS
    }

    private func configure(_ loadout: SFLoadoutProfile) {
        maxHealth = 100
        maxShield = 80
        speedFactor = 1
        turnFactor = 1
        damageFactor = 1
        energyCostFactor = 1
        pickupRadius = 2.2
        scoreFactor = 1
        hullRegen = 0
        shieldRegen = 3.5
        energyRecoveryFactor = 1
        switch max(0, min(5, loadout.core)) {
        case 1: maxHealth = 85; speedFactor = 1.18; turnFactor = 1.1
        case 2: maxHealth = 135; maxShield = 95; speedFactor = 0.85
        case 3: energyRecoveryFactor = 1.45
        case 4: maxShield = 64; speedFactor = 1.08; turnFactor = 1.25
        case 5: maxHealth = 155; maxShield = 110; speedFactor = 0.72; turnFactor = 0.82
        default: break
        }
        switch max(0, min(4, loadout.device)) {
        case 0: damageFactor = 1.12
        case 1: hullRegen = 1.15
        case 2: energyCostFactor = 0.72
        case 3: pickupRadius = 4.2; scoreFactor = 1.25
        case 4: maxShield += 28; shieldRegen = 6.2
        default: break
        }
    }

    private func id(_ prefix: String) -> String {
        defer { nextId += 1 }
        return "\(prefix)\(nextId)"
    }

    private func entity(_ body: SFLocalBody) -> SFEntity {
        SFEntity(
            id: body.id, type: body.type, x: body.x, z: body.z, rotation: body.rotation,
            health: body.health, maxHealth: body.maxHealth, owner: body.owner, weapon: body.weapon
        )
    }

    private func snapshot() -> SFSnapshot {
        var result = SFSnapshot()
        result.playerId = "local"
        result.wave = wave
        result.score = score
        result.health = Int(health.rounded())
        result.shield = Int(shield.rounded())
        result.energy = Int(energy.rounded())
        result.mission = mission
        result.region = region
        result.missionComplete = missionComplete
        result.missionFailed = missionFailed
        result.players = [SFEntity(
            id: "local", type: "player", x: playerX, z: playerZ, rotation: playerRotation,
            health: health, maxHealth: maxHealth, owner: "local", weapon: "player"
        )] + objectives.filter { $0.type == "escort" }.map(entity)
        result.enemies = enemies.map(entity)
        result.bullets = bullets.map(entity)
        result.powerups = objectives.filter { $0.type != "escort" }.map(entity)
        result.objective = objectiveState()
        return result
    }

    private func objectiveState() -> SFObjectiveState {
        var state = SFObjectiveState()
        state.escortHealth = Int(escortHealth.rounded())
        state.controlProgress = Int(controlProgress.rounded())
        state.timeRemaining = timeRemaining
        state.raidCollected = raidCollected
        state.bossComponents = bossComponents
        switch mission {
        case .survival:
            state.label = "坚持生存并刷新纪录"
            state.progress = min(1, CGFloat(wave) / 12)
        case .boss:
            state.label = bossComponents > 0 ? "摧毁首领组件" : "击穿首领核心"
            state.progress = CGFloat(3 - bossComponents) / 3
        case .escort:
            state.label = "护送运输舰穿越峡谷"
            state.progress = min(1, max(0, (24 - escortZ) / 48))
        case .defense:
            state.label = "夺取并守住控制点"
            state.progress = max(0, controlProgress) / 100
        case .timed:
            state.label = "限时消灭 18 个目标"
            state.progress = min(1, CGFloat(missionKills) / 18)
        case .raid:
            state.label = "回收 8 份战区资源"
            state.progress = min(1, CGFloat(raidCollected) / 8)
        }
        return state
    }
}

final class SpaceFightSocket: NSObject, URLSessionWebSocketDelegate {
    var onStatus: ((String) -> Void)?
    var onSnapshot: ((SFSnapshot) -> Void)?
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private(set) var playerId = ""
    private var connected = false

    func connect(mode: String, name: String) {
        disconnect()
        onStatus?("正在连接战区")
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 8
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        task = session.webSocketTask(with: URL(string: "wss://spacefight.zhengzhengstudio.cn/ws")!)
        task?.resume()
        receive()
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self else { return }
            self.connected = true
            self.send([
                "type": "join",
                "mode": mode,
                "difficulty": "normal",
                "name": String(name.prefix(18))
            ])
            self.onStatus?("已连接 · \(self.modeName(mode))")
        }
    }

    func sendInput(throttle: CGFloat, strafe: CGFloat, turn: CGFloat, boost: Bool, fire: Bool, weapon: Int) {
        guard connected else { return }
        let input: [String: Any] = [
            "throttle": throttle,
            "strafe": strafe,
            "turn": turn,
            "boost": boost,
            "fire": fire,
            "weapon": weapon
        ]
        send([
            "type": "input",
            "input": input
        ])
    }

    func disconnect() {
        if connected { send(["type": "leave"]) }
        connected = false
        task?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
        task = nil
        session = nil
        playerId = ""
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                let raw: String
                switch message {
                case .string(let value): raw = value
                case .data(let data): raw = String(data: data, encoding: .utf8) ?? ""
                @unknown default: raw = ""
                }
                self.parse(raw)
                if self.task != nil { self.receive() }
            case .failure:
                self.connected = false
                self.onStatus?("连接已结束")
            }
        }
    }

    private func parse(_ raw: String) {
        guard
            let data = raw.data(using: .utf8),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = root["type"] as? String
        else { return }
        if type == "welcome" {
            playerId = root["playerId"] as? String ?? ""
            return
        }
        guard type == "snapshot" else { return }
        var snapshot = SFSnapshot()
        snapshot.playerId = playerId
        snapshot.wave = (root["room"] as? [String: Any])?["wave"] as? Int ?? 0
        snapshot.players = entities(root["players"], fallback: "player")
        snapshot.enemies = entities(root["enemies"], fallback: "enemy")
        snapshot.bullets = entities(root["bullets"], fallback: "bullet")
        snapshot.powerups = entities(root["powerups"], fallback: "powerup")
        if let own = (root["players"] as? [[String: Any]])?.first(where: { ($0["id"] as? String) == playerId }) {
            snapshot.score = own["score"] as? Int ?? 0
            snapshot.health = own["health"] as? Int ?? 100
            snapshot.shield = own["shield"] as? Int ?? 100
            snapshot.energy = own["energy"] as? Int ?? 100
        }
        onSnapshot?(snapshot)
    }

    private func entities(_ value: Any?, fallback: String) -> [SFEntity] {
        guard let rows = value as? [[String: Any]] else { return [] }
        return rows.map { row in
            let position = row["position"] as? [String: Any]
            return SFEntity(
                id: row["id"] as? String ?? UUID().uuidString,
                type: row["type"] as? String ?? fallback,
                x: CGFloat(position?["x"] as? Double ?? 0),
                z: CGFloat(position?["z"] as? Double ?? 0),
                rotation: CGFloat(row["rotation"] as? Double ?? 0),
                health: CGFloat(row["health"] as? Double ?? 1),
                maxHealth: CGFloat(row["maxHealth"] as? Double ?? 1),
                owner: row["owner"] as? String ?? "",
                weapon: row["weapon"] as? String ?? ""
            )
        }
    }

    private func send(_ object: [String: Any]) {
        guard
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            let raw = String(data: data, encoding: .utf8)
        else { return }
        task?.send(.string(raw)) { _ in }
    }

    private func modeName(_ mode: String) -> String {
        switch mode {
        case "public": return "公开协作"
        case "boss": return "首领战"
        case "onslaught": return "强袭"
        default: return "生存"
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        connected = true
    }
}

final class NativeGameScene: SKScene {
    var onStatus: ((String) -> Void)? {
        didSet {
            socket.onStatus = { [weak self] value in
                DispatchQueue.main.async { self?.onStatus?(value) }
            }
        }
    }
    var onGameOver: ((Int, Int) -> Void)?
    var onPauseRequest: (() -> Void)?

    private let socket = SpaceFightSocket()
    private let localBattle = SFLocalBattle()
    private let battlefieldLayer = SKNode()
    private let worldLayer = SKNode()
    private let hudLayer = SKNode()
    private let controlsLayer = SKNode()
    private let effectsLayer = SKNode()
    private let showcaseLayer = SKNode()
    private var entityNodes: [String: SKNode] = [:]
    private var meterFills: [String: SKSpriteNode] = [:]
    private var meterLabels: [String: SKLabelNode] = [:]
    private var weaponSlots: [SKShapeNode] = []
    private var previousEnemyHealth: [String: CGFloat] = [:]
    private var latest = SFSnapshot()
    private var usesLocalBattle = true
    private var missionMode = SFMissionKind.survival.rawValue
    private var cameraMode = SFCameraMode(
        rawValue: UserDefaults.standard.string(forKey: "spacefight.cameraMode") ?? ""
    ) ?? .chase
    private var missionRunning = false
    private var missionPaused = false
    private var gameOverReported = false
    private var previousHealth = 100
    private var inputTimer: Timer?
    private var throttle: CGFloat = 0
    private var strafe: CGFloat = 0
    private var turn: CGFloat = 0
    private var firing = false
    private var weapon = 0
    private var trainingStep = -1
    private var joystickOrigin = CGPoint.zero
    private var aimOriginX: CGFloat = 0
    private var moveTouch: AnyHashable?
    private var aimTouch: AnyHashable?
    private var fireTouch: AnyHashable?
    private var controlProfile = SFControlProfile.saved()
    #if os(macOS)
    private var keys = Set<UInt16>()
    #endif

    override func didMove(to view: SKView) {
        scaleMode = .resizeFill
        backgroundColor = SKColor(red: 0.018, green: 0.024, blue: 0.03, alpha: 1)
        if battlefieldLayer.parent == nil {
            battlefieldLayer.zPosition = -30
            showcaseLayer.zPosition = -5
            worldLayer.zPosition = 0
            hudLayer.zPosition = 20
            effectsLayer.zPosition = 30
            controlsLayer.zPosition = 40
            addChild(battlefieldLayer)
            addChild(showcaseLayer)
            addChild(worldLayer)
            addChild(hudLayer)
            addChild(effectsLayer)
            addChild(controlsLayer)
        }
        buildBattlefield()
        buildHUD()
        buildTouchControls()
        buildEffects()
        socket.onSnapshot = { [weak self] snapshot in
            DispatchQueue.main.async {
                self?.latest = snapshot
                self?.render(snapshot)
            }
        }
    }

    override func didChangeSize(_ oldSize: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        buildBattlefield()
        buildHUD()
        buildTouchControls()
        buildEffects()
        render(latest)
    }

    func start(
        mode: String,
        name: String,
        loadout: SFLoadoutProfile = .saved(),
        controls: SFControlProfile = .saved()
    ) {
        weapon = max(0, min(4, loadout.weapon))
        controlProfile = controls
        missionMode = SFMissionKind(rawValue: mode)?.rawValue ?? (mode == "boss" ? "boss" : (mode == "onslaught" ? "timed" : "survival"))
        missionRunning = true
        missionPaused = false
        gameOverReported = false
        previousHealth = 100
        previousEnemyHealth.removeAll()
        showcaseLayer.isHidden = true
        hudLayer.isHidden = false
        controlsLayer.isHidden = false
        usesLocalBattle = mode != "public"
        if usesLocalBattle {
            socket.disconnect()
            latest = localBattle.reset(mode: missionMode, loadout: loadout)
            trainingStep = UserDefaults.standard.bool(forKey: "spacefight.flightTrainingComplete") ? -1 : 0
            buildBattlefield()
            buildEffects()
            buildTouchControls()
            render(latest)
            onStatus?(trainingStep >= 0 ? "飞行校准 · 完成三项操作后敌潮抵达" : "离线战斗 · 本机 60 Hz")
        } else {
            trainingStep = -1
            socket.connect(mode: mode, name: name)
        }
        inputTimer?.invalidate()
        inputTimer = Timer.scheduledTimer(withTimeInterval: usesLocalBattle ? 1.0 / 60.0 : 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self, self.missionRunning, !self.missionPaused else { return }
            #if os(macOS)
            self.updateKeyboardInput()
            #endif
            if self.usesLocalBattle {
                self.latest = self.localBattle.step(
                    dt: 1.0 / 60.0,
                    throttle: self.throttle,
                    strafe: self.strafe,
                    turn: self.turn,
                    boost: hypot(self.throttle, self.strafe) > 0.82,
                    fire: self.firing,
                    weapon: self.weapon,
                    training: self.trainingStep >= 0
                )
                self.render(self.latest)
            } else {
                self.socket.sendInput(
                    throttle: self.throttle,
                    strafe: self.strafe,
                    turn: self.turn,
                    boost: hypot(self.throttle, self.strafe) > 0.82,
                    fire: self.firing,
                    weapon: self.weapon
                )
            }
        }
    }

    @discardableResult
    func toggleCamera() -> SFCameraMode {
        cameraMode = cameraMode == .chase ? .cockpit : .chase
        UserDefaults.standard.set(cameraMode.rawValue, forKey: "spacefight.cameraMode")
        buildEffects()
        render(latest)
        onStatus?(cameraMode == .cockpit ? "驾驶舱视角" : "追尾视角")
        return cameraMode
    }

    func setPaused(_ paused: Bool) {
        guard missionRunning else { return }
        missionPaused = paused
        if paused { resetInput() }
        onStatus?(paused ? "行动暂停" : (usesLocalBattle ? "离线战斗 · 本机 60 Hz" : "公开协作 · 在线"))
    }

    func stop() {
        inputTimer?.invalidate()
        inputTimer = nil
        if !usesLocalBattle { socket.disconnect() }
        missionRunning = false
        missionPaused = false
        trainingStep = -1
        gameOverReported = false
        resetInput()
        entityNodes.values.forEach { $0.removeFromParent() }
        entityNodes.removeAll()
        previousEnemyHealth.removeAll()
        hudLayer.isHidden = true
        controlsLayer.isHidden = true
        showcaseLayer.isHidden = false
    }

    private func buildBattlefield() {
        battlefieldLayer.removeAllChildren()
        showcaseLayer.removeAllChildren()
        guard size.width > 0, size.height > 0 else { return }

        let battlefield = SKSpriteNode(texture: SKTexture(imageNamed: "spacefight-battlefield.png"))
        battlefield.name = "battlefield"
        battlefield.position = CGPoint(x: size.width / 2, y: size.height / 2)
        battlefield.size = size
        battlefield.alpha = 0.82
        battlefieldLayer.addChild(battlefield)

        let vignette = SKShapeNode(rectOf: size)
        vignette.position = battlefield.position
        vignette.fillColor = SKColor(red: 0.01, green: 0.015, blue: 0.02, alpha: 0.18)
        vignette.strokeColor = SKColor(red: 0.42, green: 0.5, blue: 0.54, alpha: 0.16)
        vignette.lineWidth = 2
        battlefieldLayer.addChild(vignette)
        buildRegionVisuals(latest.region)

        let shipSide = min(size.width, size.height) * 0.52
        let ship = SKSpriteNode(texture: SKTexture(imageNamed: "interceptor.png"))
        ship.name = "flightdeck.ship"
        ship.size = CGSize(width: shipSide, height: shipSide)
        ship.position = CGPoint(x: size.width * 0.68, y: size.height * 0.48)
        ship.zRotation = -0.12
        showcaseLayer.addChild(ship)
        let bloom = SKShapeNode(circleOfRadius: shipSide * 0.055)
        bloom.fillColor = SKColor(red: 0.95, green: 0.41, blue: 0.16, alpha: 0.88)
        bloom.strokeColor = .clear
        bloom.glowWidth = shipSide * 0.13
        bloom.position = CGPoint(x: 0, y: shipSide * 0.3)
        bloom.zPosition = -1
        bloom.run(.repeatForever(.sequence([
            .scale(to: 0.72, duration: 0.18),
            .scale(to: 1.12, duration: 0.24)
        ])))
        ship.addChild(bloom)
        ship.run(.repeatForever(.sequence([
            .moveBy(x: 0, y: 5, duration: 1.8),
            .moveBy(x: 0, y: -5, duration: 1.8)
        ])))
        showcaseLayer.isHidden = missionRunning
    }

    private func buildRegionVisuals(_ region: SFRegionKind) {
        let regionLayer = SKNode()
        regionLayer.name = "battlefield.region"
        regionLayer.zPosition = 2
        battlefieldLayer.addChild(regionLayer)
        switch region {
        case .canyon:
            for side in [-1.0, 1.0] {
                let wall = SKShapeNode(rectOf: CGSize(width: size.width * 0.2, height: size.height * 1.25))
                wall.position = CGPoint(x: size.width * (side < 0 ? 0.06 : 0.94), y: size.height * 0.48)
                wall.zRotation = CGFloat(side) * 0.055
                wall.fillColor = SKColor(red: 0.31, green: 0.16, blue: 0.08, alpha: 0.72)
                wall.strokeColor = SKColor(red: 0.92, green: 0.48, blue: 0.18, alpha: 0.44)
                wall.lineWidth = 2
                regionLayer.addChild(wall)
            }
            for index in 0..<7 {
                let terrain = SKSpriteNode(
                    color: SKColor(red: 0.78, green: 0.34, blue: 0.12, alpha: 0.3),
                    size: CGSize(width: size.width * 0.08, height: 2)
                )
                terrain.position = CGPoint(x: size.width * 0.5, y: size.height * (0.16 + CGFloat(index) * 0.11))
                terrain.zRotation = CGFloat(index % 2 == 0 ? 1 : -1) * 0.08
                regionLayer.addChild(terrain)
            }
        case .storm:
            let wash = SKShapeNode(rectOf: size)
            wash.position = CGPoint(x: size.width / 2, y: size.height / 2)
            wash.fillColor = SKColor(red: 0.08, green: 0.16, blue: 0.2, alpha: 0.38)
            wash.strokeColor = .clear
            regionLayer.addChild(wash)
            for index in 0..<6 {
                let cloud = SKShapeNode(ellipseOf: CGSize(width: size.width * 0.34, height: size.height * 0.12))
                cloud.position = CGPoint(
                    x: size.width * (0.12 + CGFloat(index % 3) * 0.38),
                    y: size.height * (0.22 + CGFloat(index / 3) * 0.48)
                )
                cloud.fillColor = SKColor(red: 0.12, green: 0.22, blue: 0.26, alpha: 0.34)
                cloud.strokeColor = SKColor(red: 0.35, green: 0.76, blue: 0.82, alpha: 0.18)
                cloud.run(.repeatForever(.sequence([
                    .moveBy(x: index.isMultiple(of: 2) ? 18 : -18, y: 0, duration: 2.4 + Double(index) * 0.2),
                    .moveBy(x: index.isMultiple(of: 2) ? -18 : 18, y: 0, duration: 2.4 + Double(index) * 0.2)
                ])))
                regionLayer.addChild(cloud)
            }
            let lightning = SKSpriteNode(
                color: SKColor(red: 0.35, green: 0.84, blue: 0.94, alpha: 0.55),
                size: CGSize(width: 2, height: size.height * 0.32)
            )
            lightning.position = CGPoint(x: size.width * 0.72, y: size.height * 0.62)
            lightning.zRotation = 0.18
            lightning.run(.repeatForever(.sequence([
                .fadeAlpha(to: 0.05, duration: 0.08), .wait(forDuration: 1.8),
                .fadeAlpha(to: 0.72, duration: 0.03), .fadeAlpha(to: 0.05, duration: 0.12),
                .wait(forDuration: 2.7)
            ])))
            regionLayer.addChild(lightning)
        }
    }

    private func buildHUD() {
        hudLayer.removeAllChildren()
        meterFills.removeAll()
        meterLabels.removeAll()
        weaponSlots.removeAll()
        guard size.width > 0, size.height > 0 else { return }

        let leftRule = SKSpriteNode(color: SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.72), size: CGSize(width: 3, height: 82))
        leftRule.position = CGPoint(x: 17, y: size.height - 66)
        hudLayer.addChild(leftRule)

        addMeter(name: "hud.health", title: "HULL", color: SKColor(red: 0.82, green: 0.31, blue: 0.25, alpha: 1), y: size.height - 35)
        addMeter(name: "hud.shield", title: "SHIELD", color: SKColor(red: 0.32, green: 0.72, blue: 0.77, alpha: 1), y: size.height - 62)
        addMeter(name: "hud.energy", title: "ENERGY", color: SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 1), y: size.height - 89)

        let wave = label("WAVE 00", size: 15, color: SKColor(white: 0.95, alpha: 1), bold: true)
        wave.name = "hud.wave"
        wave.fontName = "Menlo-Bold"
        wave.horizontalAlignmentMode = .right
        wave.position = CGPoint(x: size.width - 20, y: size.height - 36)
        hudLayer.addChild(wave)

        let score = label("0000000", size: 13, color: SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 1), bold: true)
        score.name = "hud.score"
        score.fontName = "Menlo-Bold"
        score.horizontalAlignmentMode = .right
        score.position = CGPoint(x: size.width - 20, y: size.height - 58)
        hudLayer.addChild(score)

        let objective = label("清除当前波次", size: 11, color: SKColor(white: 0.74, alpha: 1), bold: true)
        objective.name = "hud.objective"
        objective.horizontalAlignmentMode = .right
        objective.position = CGPoint(x: size.width - 20, y: size.height - 81)
        hudLayer.addChild(objective)

        let region = label("CANYON · CHASE", size: 9, color: SKColor(red: 0.46, green: 0.82, blue: 0.84, alpha: 1), bold: true)
        region.name = "hud.region"
        region.fontName = "Menlo-Bold"
        region.horizontalAlignmentMode = .right
        region.position = CGPoint(x: size.width - 20, y: size.height - 101)
        hudLayer.addChild(region)

        let rail = SKNode()
        rail.name = "hud.weapon"
        hudLayer.addChild(rail)
        let names = ["PULSE", "SCATTER", "MISSILE", "RAIL", "PLASMA"]
        let slotWidth = min(CGFloat(88), max(58, (size.width - 220) / 5.4))
        let railWidth = CGFloat(names.count) * slotWidth + CGFloat(names.count - 1) * 5
        let startX = (size.width - railWidth) / 2 + slotWidth / 2
        for (index, title) in names.enumerated() {
            let slot = SKShapeNode(rectOf: CGSize(width: slotWidth, height: 34), cornerRadius: 2)
            slot.name = "weapon-\(index)"
            slot.position = CGPoint(x: startX + CGFloat(index) * (slotWidth + 5), y: 27)
            slot.lineWidth = 1
            rail.addChild(slot)
            weaponSlots.append(slot)
            let number = label("0\(index + 1)", size: 8, color: SKColor(white: 0.48, alpha: 1), bold: true)
            number.name = slot.name
            number.horizontalAlignmentMode = .left
            number.verticalAlignmentMode = .center
            number.position = CGPoint(x: -slotWidth / 2 + 6, y: 0)
            slot.addChild(number)
            let titleNode = label(title, size: 9, color: SKColor(white: 0.82, alpha: 1), bold: true)
            titleNode.name = slot.name
            titleNode.horizontalAlignmentMode = .right
            titleNode.verticalAlignmentMode = .center
            titleNode.position = CGPoint(x: slotWidth / 2 - 6, y: 0)
            slot.addChild(titleNode)
        }
        hudLayer.isHidden = !missionRunning
    }

    private func buildTouchControls() {
        controlsLayer.removeAllChildren()
        #if os(iOS)
        guard size.width > 0, size.height > 0 else { return }
        let radius = min(size.width, size.height) * 0.082
        let moveX = controlProfile.leftHanded ? size.width * 0.86 : size.width * 0.14
        let fireX = controlProfile.leftHanded ? size.width * 0.075 : size.width * 0.925
        let aimX = controlProfile.leftHanded ? size.width * 0.19 : size.width * 0.81
        let move = SKShapeNode(circleOfRadius: radius)
        move.name = "controls.move"
        move.fillColor = SKColor(red: 0.04, green: 0.06, blue: 0.075, alpha: 0.28)
        move.strokeColor = SKColor(white: 0.68, alpha: 0.34)
        move.lineWidth = 1.5
        move.position = CGPoint(x: moveX, y: size.height * 0.18)
        controlsLayer.addChild(move)
        let thumb = SKShapeNode(circleOfRadius: radius * 0.26)
        thumb.name = "controls.move.thumb"
        thumb.fillColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.48)
        thumb.strokeColor = .clear
        move.addChild(thumb)

        let aim = SKShapeNode(circleOfRadius: radius * 0.76)
        aim.name = "controls.aim"
        aim.fillColor = SKColor(red: 0.04, green: 0.06, blue: 0.075, alpha: 0.24)
        aim.strokeColor = SKColor(white: 0.68, alpha: 0.3)
        aim.lineWidth = 1.5
        aim.position = CGPoint(x: aimX, y: size.height * 0.21)
        controlsLayer.addChild(aim)
        let aimLabel = label("机头转向", size: 9, color: SKColor(white: 0.84, alpha: 1), bold: true)
        aimLabel.verticalAlignmentMode = .center
        aim.addChild(aimLabel)

        let fire = SKShapeNode(circleOfRadius: radius * 0.62)
        fire.name = "controls.fire"
        fire.fillColor = SKColor(red: 0.04, green: 0.06, blue: 0.075, alpha: 0.34)
        fire.strokeColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.62)
        fire.lineWidth = 2
        fire.position = CGPoint(x: fireX, y: size.height * 0.14)
        controlsLayer.addChild(fire)
        let fireLabel = label("主武器", size: 9, color: SKColor(white: 0.94, alpha: 1), bold: true)
        fireLabel.verticalAlignmentMode = .center
        fire.addChild(fireLabel)
        let moveLabel = label("推进 · 平移", size: 9, color: SKColor(white: 0.76, alpha: 1), bold: true)
        moveLabel.position = CGPoint(x: 0, y: -radius - 17)
        move.addChild(moveLabel)
        #endif
        buildTrainingPanel()
        controlsLayer.isHidden = !missionRunning
    }

    private func buildTrainingPanel() {
        guard missionRunning, trainingStep >= 0, size.width > 0 else { return }
        let width = min(CGFloat(460), size.width * 0.56)
        let panel = SKShapeNode(rectOf: CGSize(width: width, height: 86), cornerRadius: 3)
        panel.name = "training.panel"
        panel.position = CGPoint(x: size.width / 2, y: size.height - 126)
        panel.fillColor = SKColor(red: 0.035, green: 0.052, blue: 0.064, alpha: 0.94)
        panel.strokeColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.82)
        panel.lineWidth = 2
        controlsLayer.addChild(panel)

        let titles = ["移动校准", "瞄准并开火", "切换武器"]
        #if os(iOS)
        let copies = ["拖动移动杆推进与横移", "拖动瞄准区转向，再按独立开火键", "点选底部武器"]
        #else
        let copies = ["WASD 移动", "移动鼠标瞄准，按住左键开火", "按 1–5 切换武器"]
        #endif
        let heading = label("飞行校准 \(trainingStep + 1)/3 · \(titles[trainingStep])", size: 17, color: .white, bold: true)
        heading.horizontalAlignmentMode = .left
        heading.position = CGPoint(x: -width / 2 + 18, y: 12)
        panel.addChild(heading)
        let copy = label(copies[trainingStep], size: 11, color: SKColor(white: 0.72, alpha: 1), bold: false)
        copy.horizontalAlignmentMode = .left
        copy.position = CGPoint(x: -width / 2 + 18, y: -17)
        panel.addChild(copy)
    }

    private func advanceTraining(to step: Int) {
        guard trainingStep >= 0, step > trainingStep else { return }
        if step > 2 {
            trainingStep = -1
            UserDefaults.standard.set(true, forKey: "spacefight.flightTrainingComplete")
            onStatus?("校准完成 · 敌潮接近")
        } else {
            trainingStep = step
        }
        buildTouchControls()
    }

    private func buildEffects() {
        effectsLayer.removeAllChildren()
        guard size.width > 0, size.height > 0 else { return }
        let damage = SKShapeNode(rectOf: size)
        damage.name = "fx.damage"
        damage.position = CGPoint(x: size.width / 2, y: size.height / 2)
        damage.fillColor = SKColor(red: 0.8, green: 0.06, blue: 0.03, alpha: 0.2)
        damage.strokeColor = SKColor(red: 0.95, green: 0.16, blue: 0.08, alpha: 0.55)
        damage.lineWidth = 12
        damage.alpha = 0
        effectsLayer.addChild(damage)

        let threat = SKShapeNode(circleOfRadius: min(size.width, size.height) * 0.12)
        threat.name = "fx.threat"
        threat.position = CGPoint(x: size.width / 2, y: size.height / 2)
        threat.fillColor = .clear
        threat.strokeColor = SKColor(red: 0.94, green: 0.25, blue: 0.18, alpha: 0.9)
        threat.lineWidth = 2
        threat.alpha = 0
        effectsLayer.addChild(threat)

        let reticle = SKShapeNode(circleOfRadius: 18)
        reticle.name = "fx.reticle"
        reticle.position = CGPoint(x: size.width / 2, y: size.height / 2)
        reticle.fillColor = .clear
        reticle.strokeColor = SKColor(white: 0.86, alpha: 0.45)
        reticle.lineWidth = 1
        effectsLayer.addChild(reticle)
        for angle in stride(from: 0.0, to: Double.pi * 2, by: Double.pi / 2) {
            let tick = SKSpriteNode(color: SKColor(white: 0.9, alpha: 0.6), size: CGSize(width: 11, height: 1))
            tick.position = CGPoint(x: cos(angle) * 25, y: sin(angle) * 25)
            tick.zRotation = CGFloat(angle)
            reticle.addChild(tick)
        }

        let fireLine = SKShapeNode()
        fireLine.name = "fx.fireVector"
        fireLine.strokeColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.55)
        fireLine.lineWidth = 1.2
        fireLine.glowWidth = 1
        effectsLayer.addChild(fireLine)

        let fireOrigin = SKShapeNode(circleOfRadius: 5)
        fireOrigin.name = "fx.fireOrigin"
        fireOrigin.fillColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.9)
        fireOrigin.strokeColor = SKColor(red: 1, green: 0.83, blue: 0.56, alpha: 1)
        fireOrigin.lineWidth = 1
        let originLabel = label("炮口", size: 8, color: SKColor(red: 0.96, green: 0.78, blue: 0.5, alpha: 0.9), bold: true)
        originLabel.position = CGPoint(x: 0, y: -18)
        fireOrigin.addChild(originLabel)
        effectsLayer.addChild(fireOrigin)

        let firePipper = SKShapeNode(circleOfRadius: 12)
        firePipper.name = "fx.firePipper"
        firePipper.fillColor = .clear
        firePipper.strokeColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.95)
        firePipper.lineWidth = 1.4
        let pipperLabel = label("主炮", size: 8, color: SKColor(red: 0.96, green: 0.78, blue: 0.5, alpha: 0.9), bold: true)
        pipperLabel.position = CGPoint(x: 0, y: -26)
        firePipper.addChild(pipperLabel)
        effectsLayer.addChild(firePipper)

        let hit = label("×", size: 30, color: SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 1), bold: true)
        hit.name = "fx.hit"
        hit.position = CGPoint(x: size.width / 2, y: size.height / 2 - 12)
        hit.alpha = 0
        effectsLayer.addChild(hit)

        let direction = SKShapeNode(path: {
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0, y: 9))
            path.addLine(to: CGPoint(x: -7, y: -6))
            path.addLine(to: CGPoint(x: 7, y: -6))
            path.closeSubpath()
            return path
        }())
        direction.name = "fx.target"
        direction.fillColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.9)
        direction.strokeColor = .clear
        direction.alpha = 0
        effectsLayer.addChild(direction)
        buildCockpitOverlay()
    }

    private func buildCockpitOverlay() {
        let cockpitOverlay = SKNode()
        cockpitOverlay.name = "fx.cockpit.overlay"
        cockpitOverlay.isHidden = cameraMode != .cockpit
        effectsLayer.addChild(cockpitOverlay)

        let panelHeight = max(CGFloat(70), size.height * 0.14)
        let panel = SKShapeNode(rectOf: CGSize(width: size.width, height: panelHeight))
        panel.name = "fx.cockpit.frame"
        panel.position = CGPoint(x: size.width / 2, y: panelHeight / 2)
        panel.fillColor = SKColor(red: 0.025, green: 0.035, blue: 0.042, alpha: 0.96)
        panel.strokeColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.72)
        panel.lineWidth = 2
        cockpitOverlay.addChild(panel)

        for side in [-1.0, 1.0] {
            let rail = SKShapeNode(path: {
                let path = CGMutablePath()
                path.move(to: CGPoint(x: size.width / 2, y: panelHeight * 0.7))
                path.addLine(to: CGPoint(x: size.width * (side < 0 ? 0.08 : 0.92), y: size.height * 0.62))
                path.addLine(to: CGPoint(x: size.width * (side < 0 ? 0.02 : 0.98), y: size.height * 0.94))
                return path
            }())
            rail.name = "fx.cockpit.rail"
            rail.strokeColor = SKColor(red: 0.08, green: 0.11, blue: 0.13, alpha: 0.95)
            rail.lineWidth = max(8, size.width * 0.012)
            rail.glowWidth = 1
            cockpitOverlay.addChild(rail)
        }

        let cameraLabel = label("COCKPIT", size: 9, color: SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 1), bold: true)
        cameraLabel.fontName = "Menlo-Bold"
        cameraLabel.position = CGPoint(x: size.width / 2, y: panelHeight * 0.55)
        cockpitOverlay.addChild(cameraLabel)
    }

    private func render(_ snapshot: SFSnapshot) {
        guard size.width > 0, size.height > 0 else { return }
        updateEntities(snapshot)
        updateHUD(snapshot)
        updateControls()
        updateFireVector(snapshot)
        updateFeedback(snapshot)
        if missionRunning, (snapshot.health <= 0 || snapshot.missionFailed || snapshot.missionComplete), !gameOverReported {
            gameOverReported = true
            missionRunning = false
            inputTimer?.invalidate()
            inputTimer = nil
            resetInput()
            onStatus?(snapshot.missionComplete ? "任务完成 · \(snapshot.objective.label)" : "任务失败 · \(snapshot.objective.label)")
            onGameOver?(snapshot.score, snapshot.wave)
        }
    }

    private func updateEntities(_ snapshot: SFSnapshot) {
        var liveKeys = Set<String>()
        for powerup in snapshot.powerups {
            updateEntity(powerup, key: "powerup.\(powerup.id)", kind: .powerup, local: false)
            liveKeys.insert("powerup.\(powerup.id)")
        }
        for bullet in snapshot.bullets {
            updateEntity(bullet, key: "bullet.\(bullet.id)", kind: .bullet, local: false)
            liveKeys.insert("bullet.\(bullet.id)")
        }
        for enemy in snapshot.enemies {
            updateEntity(enemy, key: "enemy.\(enemy.id)", kind: .enemy, local: false)
            liveKeys.insert("enemy.\(enemy.id)")
        }
        for player in snapshot.players {
            let local = player.id == snapshot.playerId
            let showsChaseShip = !local || cameraMode == .chase
            if !showsChaseShip {
                let key = "player.\(player.id)"
                entityNodes.removeValue(forKey: key)?.removeFromParent()
                continue
            }
            updateEntity(player, key: "player.\(player.id)", kind: .ship, local: local)
            liveKeys.insert("player.\(player.id)")
        }

        for key in entityNodes.keys where !liveKeys.contains(key) {
            guard let node = entityNodes.removeValue(forKey: key) else { continue }
            if key.hasPrefix("enemy.") { emitSparks(at: node.position) }
            node.removeFromParent()
        }
    }

    private enum EntityKind {
        case ship, enemy, bullet, powerup
    }

    private func updateEntity(_ entity: SFEntity, key: String, kind: EntityKind, local: Bool) {
        let node: SKNode
        if let existing = entityNodes[key] {
            node = existing
        } else {
            node = makeEntityNode(entity, kind: kind, local: local)
            node.name = key
            entityNodes[key] = node
            worldLayer.addChild(node)
        }
        node.position = worldPoint(entity)
        node.isHidden = !isVisibleInCamera(entity)
        if kind == .ship || kind == .enemy || kind == .bullet {
            let ownRotation = latest.players.first(where: { $0.id == latest.playerId })?.rotation ?? 0
            node.zRotation = -(entity.rotation - ownRotation)
        }
        if let healthFill = node.childNode(withName: "health.fill") as? SKSpriteNode {
            healthFill.xScale = max(0.001, min(1, entity.health / max(1, entity.maxHealth)))
        }
    }

    private func makeEntityNode(_ entity: SFEntity, kind: EntityKind, local: Bool) -> SKNode {
        switch kind {
        case .ship, .enemy:
            let textureName = local ? "interceptor.png" : shipTexture(for: entity.type)
            let side = min(size.width, size.height) * (entity.type == "boss" ? 0.21 : (local ? 0.115 : 0.078))
            let ship = SKSpriteNode(texture: SKTexture(imageNamed: textureName))
            ship.size = CGSize(width: side, height: side)
            if local {
                let exhaust = SKShapeNode(ellipseOf: CGSize(width: side * 0.11, height: side * 0.28))
                exhaust.fillColor = SKColor(red: 0.96, green: 0.35, blue: 0.13, alpha: 0.9)
                exhaust.strokeColor = .clear
                exhaust.glowWidth = side * 0.11
                exhaust.position = CGPoint(x: 0, y: side * 0.4)
                exhaust.zPosition = -1
                exhaust.run(.repeatForever(.sequence([
                    .scaleY(to: 0.68, duration: 0.08),
                    .scaleY(to: 1.18, duration: 0.12)
                ])))
                ship.addChild(exhaust)
            } else {
                let width = side * 0.72
                let back = SKSpriteNode(color: SKColor(white: 0.04, alpha: 0.82), size: CGSize(width: width, height: 3))
                back.position = CGPoint(x: 0, y: -side * 0.43)
                back.zRotation = entity.rotation
                ship.addChild(back)
                let fill = SKSpriteNode(color: SKColor(red: 0.82, green: 0.31, blue: 0.25, alpha: 1), size: CGSize(width: width, height: 3))
                fill.name = "health.fill"
                fill.anchorPoint = CGPoint(x: 0, y: 0.5)
                fill.position = CGPoint(x: -width / 2, y: 0)
                back.addChild(fill)
            }
            return ship
        case .bullet:
            let color: SKColor
            if entity.owner == "enemy" { color = SKColor(red: 0.88, green: 0.25, blue: 0.2, alpha: 1) }
            else if entity.weapon == "1" { color = SKColor(red: 1, green: 0.72, blue: 0.34, alpha: 1) }
            else if entity.weapon == "missile" { color = SKColor(red: 1, green: 0.34, blue: 0.2, alpha: 1) }
            else if entity.weapon == "3" { color = SKColor(red: 0.9, green: 0.97, blue: 1, alpha: 1) }
            else if entity.weapon == "4" { color = SKColor(red: 0.35, green: 0.86, blue: 0.82, alpha: 1) }
            else { color = SKColor(red: 0.96, green: 0.91, blue: 0.75, alpha: 1) }
            let radius: CGFloat = entity.weapon == "4" ? 5 : (entity.weapon == "missile" ? 4 : 2.6)
            let bullet = SKShapeNode(circleOfRadius: radius)
            bullet.fillColor = color
            bullet.strokeColor = entity.weapon == "4" ? color.withAlphaComponent(0.55) : .clear
            bullet.lineWidth = 2
            bullet.glowWidth = entity.weapon == "4" ? 11 : 7
            let trailLength: CGFloat = entity.weapon == "3" ? 34 : (entity.weapon == "missile" ? 22 : (entity.weapon == "1" ? 7 : 14))
            let trail = SKSpriteNode(color: color.withAlphaComponent(0.42), size: CGSize(width: entity.weapon == "3" ? 1.4 : radius * 1.1, height: trailLength))
            trail.position = CGPoint(x: 0, y: -trailLength * 0.52)
            trail.zPosition = -1
            bullet.addChild(trail)
            if entity.weapon == "4" {
                let ring = SKShapeNode(circleOfRadius: 8)
                ring.strokeColor = color.withAlphaComponent(0.72)
                ring.fillColor = .clear
                ring.lineWidth = 1.5
                bullet.addChild(ring)
            }
            return bullet
        case .powerup:
            if entity.type == "control" {
                let control = SKShapeNode(circleOfRadius: 24)
                control.fillColor = SKColor(red: 0.08, green: 0.22, blue: 0.24, alpha: 0.34)
                control.strokeColor = SKColor(red: 0.34, green: 0.82, blue: 0.84, alpha: 0.9)
                control.lineWidth = 3
                control.glowWidth = 4
                control.run(.repeatForever(.sequence([.scale(to: 1.12, duration: 0.65), .scale(to: 0.94, duration: 0.65)])))
                return control
            }
            let resource = SKShapeNode(rectOf: CGSize(width: 17, height: 17), cornerRadius: 2)
            resource.fillColor = SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.26)
            resource.strokeColor = SKColor(red: 0.98, green: 0.72, blue: 0.3, alpha: 1)
            resource.lineWidth = 3
            resource.glowWidth = 5
            resource.run(.repeatForever(.rotate(byAngle: .pi, duration: 1.2)))
            return resource
        }
    }

    private func updateHUD(_ snapshot: SFSnapshot) {
        updateMeter("hud.health", value: snapshot.health)
        updateMeter("hud.shield", value: snapshot.shield)
        updateMeter("hud.energy", value: snapshot.energy)
        (hudLayer.childNode(withName: "hud.wave") as? SKLabelNode)?.text = "WAVE \(String(format: "%02d", snapshot.wave))"
        (hudLayer.childNode(withName: "hud.score") as? SKLabelNode)?.text = String(format: "%07d", snapshot.score)
        (hudLayer.childNode(withName: "hud.objective") as? SKLabelNode)?.text = objectiveText(for: snapshot)
        (hudLayer.childNode(withName: "hud.region") as? SKLabelNode)?.text = "\(snapshot.region.rawValue.uppercased()) · \(cameraMode.rawValue.uppercased())"
        for (index, slot) in weaponSlots.enumerated() {
            let active = index == weapon
            slot.fillColor = active
                ? SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.96)
                : SKColor(red: 0.035, green: 0.05, blue: 0.062, alpha: 0.84)
            slot.strokeColor = active
                ? SKColor(red: 1, green: 0.75, blue: 0.4, alpha: 1)
                : SKColor(white: 0.62, alpha: 0.24)
            slot.children.compactMap { $0 as? SKLabelNode }.forEach {
                $0.fontColor = active ? SKColor(white: 0.08, alpha: 1) : SKColor(white: 0.76, alpha: 1)
            }
        }
    }

    private func updateControls() {
        #if os(iOS)
        guard
            let move = controlsLayer.childNode(withName: "controls.move"),
            let thumb = move.childNode(withName: "controls.move.thumb"),
            let fire = controlsLayer.childNode(withName: "controls.fire") as? SKShapeNode
        else { return }
        let radius = min(size.width, size.height) * 0.082
        let moveX = controlProfile.leftHanded ? size.width * 0.86 : size.width * 0.14
        move.position = moveTouch == nil
            ? CGPoint(x: moveX, y: size.height * 0.18)
            : joystickOrigin
        thumb.position = CGPoint(x: strafe * radius * 0.57, y: throttle * radius * 0.57)
        fire.fillColor = firing
            ? SKColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.5)
            : SKColor(red: 0.04, green: 0.06, blue: 0.075, alpha: 0.34)
        #endif
    }

    private func updateFireVector(_ snapshot: SFSnapshot) {
        guard let own = snapshot.players.first(where: { $0.id == snapshot.playerId }) else {
            effectsLayer.childNode(withName: "fx.fireVector")?.isHidden = true
            effectsLayer.childNode(withName: "fx.fireOrigin")?.isHidden = true
            effectsLayer.childNode(withName: "fx.firePipper")?.isHidden = true
            return
        }
        let forwardX = sin(own.rotation)
        let forwardZ = -cos(own.rotation)
        let muzzle = SFEntity(
            id: "__muzzle", type: "guide",
            x: own.x + forwardX * 1.4, z: own.z + forwardZ * 1.4,
            rotation: own.rotation, health: 1, maxHealth: 1, owner: "local", weapon: ""
        )
        let aim = SFEntity(
            id: "__aim", type: "guide",
            x: own.x + forwardX * 22, z: own.z + forwardZ * 22,
            rotation: own.rotation, health: 1, maxHealth: 1, owner: "local", weapon: ""
        )
        let muzzlePoint = worldPoint(muzzle)
        let aimPoint = worldPoint(aim)
        if let line = effectsLayer.childNode(withName: "fx.fireVector") as? SKShapeNode {
            let path = CGMutablePath()
            path.move(to: muzzlePoint)
            path.addLine(to: aimPoint)
            line.path = path
            line.isHidden = false
        }
        if let origin = effectsLayer.childNode(withName: "fx.fireOrigin") {
            origin.position = muzzlePoint
            origin.isHidden = false
        }
        if let pipper = effectsLayer.childNode(withName: "fx.firePipper") as? SKShapeNode {
            pipper.position = aimPoint
            pipper.isHidden = false
            pipper.glowWidth = firing ? 4 : 1
        }
    }

    private func updateFeedback(_ snapshot: SFSnapshot) {
        if snapshot.health < previousHealth, let flash = effectsLayer.childNode(withName: "fx.damage") {
            flash.removeAllActions()
            flash.alpha = 1
            flash.run(.fadeOut(withDuration: 0.24))
            worldLayer.removeAction(forKey: "camera.damage")
            worldLayer.run(.sequence([
                .moveBy(x: -5, y: 2, duration: 0.035),
                .moveBy(x: 9, y: -4, duration: 0.05),
                .moveTo(x: 0, duration: 0.05),
                .moveTo(y: 0, duration: 0.05)
            ]), withKey: "camera.damage")
        }
        previousHealth = snapshot.health

        var didHit = false
        for enemy in snapshot.enemies {
            if let previous = previousEnemyHealth[enemy.id], enemy.health < previous {
                didHit = true
                emitImpact(at: worldPoint(enemy))
            }
        }
        previousEnemyHealth = Dictionary(uniqueKeysWithValues: snapshot.enemies.map { ($0.id, $0.health) })
        if didHit, let hit = effectsLayer.childNode(withName: "fx.hit") {
            hit.removeAllActions()
            hit.alpha = 1
            hit.setScale(0.72)
            hit.run(.group([
                .scale(to: 1, duration: 0.09),
                .sequence([.wait(forDuration: 0.08), .fadeOut(withDuration: 0.12)])
            ]))
        }

        guard
            let own = snapshot.players.first(where: { $0.id == snapshot.playerId }),
            let target = snapshot.enemies.min(by: {
                hypot($0.x - own.x, $0.z - own.z) < hypot($1.x - own.x, $1.z - own.z)
            })
        else {
            effectsLayer.childNode(withName: "fx.threat")?.alpha = 0
            effectsLayer.childNode(withName: "fx.target")?.alpha = 0
            return
        }
        let dx = target.x - own.x
        let dz = target.z - own.z
        let distance = hypot(dx, dz)
        let projected = worldPoint(target)
        let screenDX = projected.x - size.width / 2
        let screenDY = projected.y - size.height / 2
        let screenLength = max(0.001, hypot(screenDX, screenDY))
        if let direction = effectsLayer.childNode(withName: "fx.target") {
            let radius = min(size.width, size.height) * 0.18
            direction.position = CGPoint(
                x: size.width / 2 + screenDX / screenLength * radius,
                y: size.height / 2 + screenDY / screenLength * radius
            )
            direction.zRotation = atan2(screenDY, screenDX) - .pi / 2
            let lockDistance: CGFloat = snapshot.region == .storm ? 17 : 28
            direction.alpha = distance <= lockDistance ? 0.88 : 0.22
        }
        if let threat = effectsLayer.childNode(withName: "fx.threat") {
            threat.alpha = distance < 11 ? 0.84 : 0
            if distance < 11, threat.action(forKey: "threat.pulse") == nil {
                threat.run(.repeatForever(.sequence([
                    .fadeAlpha(to: 0.25, duration: 0.18),
                    .fadeAlpha(to: 0.84, duration: 0.18)
                ])), withKey: "threat.pulse")
            }
        }
    }

    private func addMeter(name: String, title: String, color: SKColor, y: CGFloat) {
        let width = min(CGFloat(214), size.width * 0.22)
        let back = SKShapeNode(rectOf: CGSize(width: width, height: 18), cornerRadius: 1)
        back.name = name
        back.fillColor = SKColor(red: 0.035, green: 0.05, blue: 0.062, alpha: 0.86)
        back.strokeColor = SKColor(white: 0.65, alpha: 0.18)
        back.lineWidth = 1
        back.position = CGPoint(x: 27 + width / 2, y: y)
        hudLayer.addChild(back)
        let fill = SKSpriteNode(color: color, size: CGSize(width: width - 2, height: 16))
        fill.anchorPoint = CGPoint(x: 0, y: 0.5)
        fill.position = CGPoint(x: -width / 2 + 1, y: 0)
        fill.zPosition = -1
        back.addChild(fill)
        meterFills[name] = fill
        let caption = label("\(title) 100", size: 9, color: SKColor(white: 0.96, alpha: 1), bold: true)
        caption.fontName = "Menlo-Bold"
        caption.horizontalAlignmentMode = .left
        caption.verticalAlignmentMode = .center
        caption.position = CGPoint(x: -width / 2 + 6, y: 0)
        back.addChild(caption)
        meterLabels[name] = caption
    }

    private func updateMeter(_ name: String, value: Int) {
        meterFills[name]?.xScale = max(0.001, CGFloat(max(0, min(100, value))) / 100)
        let title: String
        switch name {
        case "hud.health": title = "HULL"
        case "hud.shield": title = "SHIELD"
        default: title = "ENERGY"
        }
        meterLabels[name]?.text = "\(title) \(String(format: "%03d", max(0, value)))"
    }

    private func objectiveText(for snapshot: SFSnapshot) -> String {
        if !usesLocalBattle { return "公开协作 · 队伍同步" }
        let objective = snapshot.objective
        switch snapshot.mission {
        case .survival:
            return "\(objective.label) · WAVE \(snapshot.wave)"
        case .boss:
            return "\(objective.label) · 组件 \(objective.bossComponents)"
        case .escort:
            return "\(objective.label) · 舰体 \(max(0, objective.escortHealth))%"
        case .defense:
            return "\(objective.label) · \(objective.controlProgress)%"
        case .timed:
            return "\(objective.label) · \(Int(ceil(objective.timeRemaining))) 秒"
        case .raid:
            return "\(objective.label) · \(objective.raidCollected)/8"
        }
    }

    private func shipTexture(for type: String) -> String {
        switch type {
        case "boss": return "boss.png"
        case "bossComponent": return "gunship.png"
        case "escort": return "bomber.png"
        case "bomber": return "bomber.png"
        case "gunship": return "gunship.png"
        case "fighter": return "fighter.png"
        default: return "scout.png"
        }
    }

    private func worldPoint(_ entity: SFEntity) -> CGPoint {
        guard let own = latest.players.first(where: { $0.id == latest.playerId }) else {
            return CGPoint(
                x: size.width * 0.5 + entity.x / 30 * size.width * 0.46,
                y: size.height * 0.14 + (entity.z + 20) / 55 * size.height * 0.7
            )
        }
        let dx = entity.x - own.x
        let dz = entity.z - own.z
        let right = dx * cos(own.rotation) + dz * sin(own.rotation)
        let forward = dx * sin(own.rotation) - dz * cos(own.rotation)
        let scale = min(size.width, size.height) / (cameraMode == .cockpit ? 27 : 32)
        let anchorY = size.height * (cameraMode == .cockpit ? 0.31 : 0.22)
        return CGPoint(
            x: size.width / 2 + right * scale,
            y: anchorY + forward * scale
        )
    }

    private func isVisibleInCamera(_ entity: SFEntity) -> Bool {
        guard cameraMode == .cockpit,
              let own = latest.players.first(where: { $0.id == latest.playerId })
        else { return true }
        let dx = entity.x - own.x
        let dz = entity.z - own.z
        let forward = dx * sin(own.rotation) - dz * cos(own.rotation)
        return forward > -2.5
    }

    private func emitImpact(at point: CGPoint) {
        for index in 0..<5 {
            let spark = SKShapeNode(circleOfRadius: index == 0 ? 2.4 : 1.4)
            spark.fillColor = SKColor(red: 1, green: 0.67, blue: 0.25, alpha: 1)
            spark.strokeColor = .clear
            spark.glowWidth = 3
            spark.position = point
            effectsLayer.addChild(spark)
            let angle = CGFloat(index) / 5 * .pi * 2
            spark.run(.sequence([
                .group([
                    .moveBy(x: cos(angle) * 24, y: sin(angle) * 24, duration: 0.18),
                    .fadeOut(withDuration: 0.18)
                ]),
                .removeFromParent()
            ]))
        }
    }

    private func emitSparks(at point: CGPoint) {
        let ring = SKShapeNode(circleOfRadius: 5)
        ring.position = point
        ring.fillColor = .clear
        ring.strokeColor = SKColor(red: 0.95, green: 0.5, blue: 0.2, alpha: 0.9)
        ring.lineWidth = 3
        ring.glowWidth = 5
        effectsLayer.addChild(ring)
        ring.run(.sequence([
            .group([.scale(to: 5.2, duration: 0.24), .fadeOut(withDuration: 0.24)]),
            .removeFromParent()
        ]))
    }

    private func label(_ value: String, size: CGFloat, color: SKColor, bold: Bool) -> SKLabelNode {
        let node = SKLabelNode(fontNamed: bold ? "AvenirNext-DemiBold" : "AvenirNext-Medium")
        node.text = value
        node.fontSize = size
        node.fontColor = color
        return node
    }

    private func selectWeapon(at point: CGPoint) -> Bool {
        guard point.y < 54 else { return false }
        if let name = nodes(at: point).compactMap(\.name).first(where: { $0.hasPrefix("weapon-") }),
           let index = Int(name.replacingOccurrences(of: "weapon-", with: "")) {
            weapon = index
            if trainingStep == 2 { advanceTraining(to: 3) }
            updateHUD(latest)
            return true
        }
        return false
    }

    #if os(iOS)
    private func shapedTurn(at x: CGFloat) -> CGFloat {
        let raw = max(-1, min(1, (x - aimOriginX) / (size.width * 0.13) * controlProfile.aimSensitivity))
        let magnitude = abs(raw)
        let shaped = magnitude <= ANALOG_DEADZONE ? 0 : pow(
            (magnitude - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE),
            ANALOG_RESPONSE_EXPONENT
        )
        return raw < 0 ? -shaped : shaped
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard missionRunning, !missionPaused else { return }
        for touch in touches {
            let point = touch.location(in: self)
            if selectWeapon(at: point) { continue }
            let fireCenter = CGPoint(
                x: controlProfile.leftHanded ? size.width * 0.075 : size.width * 0.925,
                y: size.height * 0.14
            )
            let fireRadius = min(size.width, size.height) * 0.066
            let moveSide = controlProfile.leftHanded ? point.x > size.width / 2 : point.x < size.width / 2
            if hypot(point.x - fireCenter.x, point.y - fireCenter.y) <= fireRadius, fireTouch == nil {
                fireTouch = AnyHashable(ObjectIdentifier(touch))
                firing = true
                if trainingStep == 1 { advanceTraining(to: 2) }
            } else if moveSide, moveTouch == nil {
                moveTouch = AnyHashable(ObjectIdentifier(touch))
                let base = CGPoint(x: controlProfile.leftHanded ? size.width * 0.86 : size.width * 0.14, y: size.height * 0.18)
                let radius = min(size.width, size.height) * 0.082
                let dx = point.x - base.x
                let dy = point.y - base.y
                let distance = max(0.001, hypot(dx, dy))
                let pickupRadius = radius * 0.62
                joystickOrigin = distance > pickupRadius
                    ? CGPoint(x: point.x - dx / distance * pickupRadius, y: point.y - dy / distance * pickupRadius)
                    : base
            } else if aimTouch == nil {
                aimTouch = AnyHashable(ObjectIdentifier(touch))
                aimOriginX = point.x
                turn = shapedTurn(at: point.x)
            }
        }
        updateControls()
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            let key = AnyHashable(ObjectIdentifier(touch))
            let point = touch.location(in: self)
            if key == moveTouch {
                let radius = min(size.width, size.height) * 0.082
                let dx = point.x - joystickOrigin.x
                let dy = point.y - joystickOrigin.y
                let length = max(0.001, hypot(dx, dy))
                let raw = min(1, length / radius)
                let response = raw <= ANALOG_DEADZONE ? 0 : pow(
                    (raw - ANALOG_DEADZONE) / (1 - ANALOG_DEADZONE),
                    ANALOG_RESPONSE_EXPONENT
                )
                strafe = max(-1, min(1, dx / length * response))
                throttle = max(-1, min(1, dy / length * response))
                if trainingStep == 0, hypot(strafe, throttle) > 0.22 { advanceTraining(to: 1) }
            } else if key == aimTouch {
                turn = shapedTurn(at: point.x)
            }
        }
        updateControls()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        release(touches)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        release(touches)
    }

    private func release(_ touches: Set<UITouch>) {
        for touch in touches {
            let key = AnyHashable(ObjectIdentifier(touch))
            if key == moveTouch { moveTouch = nil; throttle = 0; strafe = 0 }
            if key == aimTouch { aimTouch = nil; turn = 0 }
            if key == fireTouch { fireTouch = nil; firing = false }
        }
        updateControls()
    }
    #else
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onPauseRequest?()
            return
        }
        if event.keyCode == controlProfile.cameraKey {
            toggleCamera()
            return
        }
        keys.insert(event.keyCode)
        if trainingStep == 0, [controlProfile.leftKey, controlProfile.backwardKey, controlProfile.rightKey, controlProfile.forwardKey].contains(event.keyCode) {
            advanceTraining(to: 1)
        }
    }
    override func keyUp(with event: NSEvent) {
        keys.remove(event.keyCode)
        if event.keyCode == controlProfile.fireKey { firing = false }
    }
    override func mouseDown(with event: NSEvent) {
        guard missionRunning, !missionPaused else { return }
        let point = event.location(in: self)
        if !selectWeapon(at: point) {
            firing = true
            aim(at: point)
            if trainingStep == 1 { advanceTraining(to: 2) }
        }
    }
    override func mouseDragged(with event: NSEvent) { aim(at: event.location(in: self)) }
    override func mouseMoved(with event: NSEvent) { aim(at: event.location(in: self)) }
    override func mouseUp(with event: NSEvent) { firing = false; turn = 0 }

    private func aim(at point: CGPoint) {
        guard missionRunning, !missionPaused else { return }
        turn = max(-0.72, min(0.72, (point.x - size.width / 2) / (size.width * 0.6) * controlProfile.aimSensitivity))
    }

    private func updateKeyboardInput() {
        throttle = keys.contains(controlProfile.forwardKey) ? 1 : (keys.contains(controlProfile.backwardKey) ? -1 : 0)
        strafe = keys.contains(controlProfile.rightKey) ? 1 : (keys.contains(controlProfile.leftKey) ? -1 : 0)
        firing = keys.contains(controlProfile.fireKey) || firing
        if keys.contains(18) { weapon = 0 }
        if keys.contains(19) { weapon = 1 }
        if keys.contains(20) { weapon = 2 }
        if keys.contains(21) { weapon = 3 }
        if keys.contains(23) { weapon = 4 }
    }
    #endif

    private func resetInput() {
        throttle = 0
        strafe = 0
        turn = 0
        firing = false
        moveTouch = nil
        aimTouch = nil
        fireTouch = nil
        #if os(macOS)
        keys.removeAll()
        #endif
        updateControls()
    }

    deinit {
        inputTimer?.invalidate()
        socket.disconnect()
    }
}
