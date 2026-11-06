import SwiftUI

enum LifeDiaryDesignTokens {
    static let moss = Color(red: 0.09, green: 0.36, blue: 0.26)
    static let paper = Color(red: 0.95, green: 0.97, blue: 0.96)
    static let paperDark = Color(red: 0.08, green: 0.12, blue: 0.10)
    static let cornerRadius: CGFloat = 12
}

struct PaperPage<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(28)
            .frame(maxWidth: 760, maxHeight: .infinity, alignment: .topLeading)
            .background(colorScheme == .dark ? LifeDiaryDesignTokens.paperDark : LifeDiaryDesignTokens.paper)
            .clipShape(RoundedRectangle(cornerRadius: LifeDiaryDesignTokens.cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: LifeDiaryDesignTokens.cornerRadius).stroke(.secondary.opacity(0.14)))
            .padding(24)
    }
}
