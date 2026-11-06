import Foundation

enum LifeSection: String, CaseIterable, Identifiable, Codable {
    case today
    case diary
    case health
    case ledger
    case community
    case friends
    case messages
    case companion
    case passport

    var id: String { rawValue }

    static let record: [LifeSection] = [.today, .diary, .health, .ledger]
    static let connection: [LifeSection] = [.community, .friends, .messages]
    static let support: [LifeSection] = [.companion, .passport]

    var title: String {
        switch self {
        case .today: return "今天"
        case .diary: return "个人日记"
        case .health: return "健康记录"
        case .ledger: return "记账"
        case .community: return "公共日记"
        case .friends: return "好友"
        case .messages: return "消息"
        case .companion: return "陪伴"
        case .passport: return "铮铮通行证"
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max"
        case .diary: return "book.closed"
        case .health: return "heart.text.square"
        case .ledger: return "chart.pie"
        case .community: return "person.3"
        case .friends: return "person.2"
        case .messages: return "bubble.left.and.bubble.right"
        case .companion: return "leaf"
        case .passport: return "person.badge.key"
        }
    }
}

enum LifeCommand: CaseIterable {
    case newEntry, focusSearch, export, lock, checkForUpdates

    var shortcut: String {
        switch self {
        case .newEntry: return "⌘N"
        case .focusSearch: return "⌘F"
        case .export: return "⇧⌘E"
        case .lock: return "⇧⌘L"
        case .checkForUpdates: return "⌘U"
        }
    }
}
