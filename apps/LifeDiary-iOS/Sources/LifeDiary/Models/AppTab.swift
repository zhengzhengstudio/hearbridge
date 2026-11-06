import Foundation

public enum AppTab: String, CaseIterable, Identifiable, Sendable {
    case today
    case diary
    case community
    case ledger
    case companion
    case profile

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .today: return "今天"
        case .diary: return "日记"
        case .community: return "公共日记"
        case .ledger: return "记账"
        case .companion: return "陪伴"
        case .profile: return "我的"
        }
    }

    public var icon: String {
        switch self {
        case .today: return "sun.max"
        case .diary: return "book.closed"
        case .community: return "person.3"
        case .ledger: return "yensign.circle"
        case .companion: return "sparkles"
        case .profile: return "person.crop.circle"
        }
    }

    public var accessibilityTitle: String {
        switch self {
        case .today: return "今天"
        case .diary: return "个人日记"
        case .community: return "公共日记：浏览真实生活分享"
        case .ledger: return "私人记账与统计"
        case .companion: return "陪伴"
        case .profile: return "我的"
        }
    }
}
