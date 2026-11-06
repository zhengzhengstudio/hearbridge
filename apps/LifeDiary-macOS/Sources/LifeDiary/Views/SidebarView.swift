import SwiftUI

struct SidebarView: View {
    @Binding var selection: LifeSection?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                group("记录", LifeSection.record)
                group("连接", LifeSection.connection)
                group("支持", LifeSection.support)
            }.padding(12)
        }
        .background(LifeDiaryDesignTokens.paper)
    }

    @ViewBuilder
    private func group(_ title: String, _ sections: [LifeSection]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary).padding(.leading, 8)
            ForEach(sections) { section in
                Button { selection = section } label: {
                    Label(section.title, systemImage: section.icon)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 9).frame(height: 34)
                        .foregroundStyle(selection == section ? Color.white : .primary)
                        .background(selection == section ? LifeDiaryDesignTokens.moss : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }.buttonStyle(.plain)
            }
        }
    }
}
