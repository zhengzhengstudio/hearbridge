import SwiftUI

enum LifeTheme {
    static let paper = Color(red: 0.95, green: 0.97, blue: 0.96)
    static let raisedPaper = Color(red: 0.98, green: 0.99, blue: 0.98)
    static let moss = Color(red: 0.09, green: 0.36, blue: 0.26)
    static let sage = Color(red: 0.34, green: 0.46, blue: 0.40)
    static let charcoal = Color(red: 0.09, green: 0.13, blue: 0.11)
    static let hairline = Color(red: 0.82, green: 0.87, blue: 0.84)

    static let pageCornerRadius: CGFloat = 14
    static let pageInset: CGFloat = 18

    static let pageTitle = Font.system(.largeTitle, design: .rounded).weight(.semibold)
    static let sectionTitle = Font.system(.title3, design: .rounded).weight(.semibold)
}

// The cross-platform contract recognizes this name while views use the concise LifeTheme API.
typealias LifeDiaryDesignTokens = LifeTheme

struct LifePaperBackground: View {
    var body: some View {
        ZStack {
            LifeTheme.paper
        }
        .ignoresSafeArea()
    }
}

struct LifeEmptyState: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(LifeTheme.sage)
                .accessibilityHidden(true)
            Text(title)
                .font(LifeTheme.sectionTitle)
                .foregroundStyle(LifeTheme.charcoal)
            Text(message)
                .font(.body)
                .foregroundStyle(LifeTheme.charcoal.opacity(0.72))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
        .padding(.horizontal, LifeTheme.pageInset)
    }
}

extension View {
    func lifePaperBackground() -> some View {
        background(LifePaperBackground())
            .scrollContentBackground(.hidden)
            .foregroundStyle(LifeTheme.charcoal)
    }
}
