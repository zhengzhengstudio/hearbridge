import Foundation

public struct PeriodRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let startDate: Date

    public init(id: UUID = UUID(), startDate: Date) {
        self.id = id
        self.startDate = startDate
    }
}

public enum PeriodPrediction {
    public static func nextStart(records: [PeriodRecord], cycleLength: Int, calendar: Calendar) -> Date? {
        guard let latest = records.map(\.startDate).max() else { return nil }
        return calendar.date(byAdding: .day, value: max(1, cycleLength), to: latest)
    }
}

public struct SmokingStatistics: Equatable, Sendable {
    public let daysSmokeFree: Int
    public let cigarettesAvoided: Int
    public let moneySaved: Int

    public static func make(
        startedAt: Date,
        asOf: Date,
        cigarettesPerDay: Int,
        pricePerPack: Int,
        cigarettesPerPack: Int,
        calendar: Calendar
    ) -> SmokingStatistics {
        let days = max(0, calendar.dateComponents([.day], from: startedAt, to: asOf).day ?? 0)
        let avoided = days * max(0, cigarettesPerDay)
        let saved = cigarettesPerPack > 0 ? avoided * max(0, pricePerPack) / cigarettesPerPack : 0
        return SmokingStatistics(daysSmokeFree: days, cigarettesAvoided: avoided, moneySaved: saved)
    }
}
