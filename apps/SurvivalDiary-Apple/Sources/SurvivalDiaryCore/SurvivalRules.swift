import Foundation

public enum SurvivalActivity: Sendable {
    case idle
    case walking
    case running
    case sleeping
}

public enum SurvivalRules {
    private static let gameMinutesPerRealSecond = 0.8

    public static func advance(
        _ source: GameSave,
        elapsedRealSeconds: TimeInterval,
        activity: SurvivalActivity
    ) -> GameSave {
        guard elapsedRealSeconds > 0 else { return source }
        var next = source
        let minutes = elapsedRealSeconds * gameMinutesPerRealSecond
        let total = Double(next.clock.minute) + minutes
        next.clock.day += Int(total / 1_440)
        next.clock.minute = Int(total.truncatingRemainder(dividingBy: 1_440).rounded(.down))

        let food = clamp(Double(next.player.food) - minutes * (activity == .running ? 0.026 : 0.015))
        let water = clamp(Double(next.player.water) - minutes * (activity == .running ? 0.038 : 0.022))
        let fedForHealing = food >= 80
        let hydratedForHealing = water >= 70
        var blockers: [String] = []
        if !fedForHealing { blockers.append("needs-food") }
        if !hydratedForHealing { blockers.append("needs-water") }

        let nutritionFactor = fedForHealing && hydratedForHealing ? 1.6 : food >= 45 && water >= 45 ? 1 : food > 10 && water > 10 ? 0.35 : 0
        let energyPerMinute: Double
        switch activity {
        case .idle: energyPerMinute = 0.14 * nutritionFactor
        case .sleeping: energyPerMinute = 0.36 * nutritionFactor
        case .walking: energyPerMinute = -0.08
        case .running: energyPerMinute = -0.24
        }
        let crisisDamage = (food <= 10 ? 0.035 : 0) + (water <= 10 ? 0.05 : 0)
        let healthDelta = crisisDamage > 0 ? -crisisDamage * minutes : fedForHealing && hydratedForHealing && activity != .running ? 0.02 * minutes : 0

        next.player.food = Int(clamp(food).rounded())
        next.player.water = Int(clamp(water).rounded())
        next.player.energy = rounded4(clamp(next.player.energy + energyPerMinute * minutes))
        next.player.health = Int(clamp(Double(next.player.health) + healthDelta).rounded())
        next.recoveryBlockers = blockers
        return next
    }

    private static func clamp(_ value: Double) -> Double { min(100, max(0, value)) }
    private static func rounded4(_ value: Double) -> Double { (value * 10_000).rounded() / 10_000 }
}
