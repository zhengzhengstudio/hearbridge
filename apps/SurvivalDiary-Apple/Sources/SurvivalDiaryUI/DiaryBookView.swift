import SwiftUI

public struct DiaryBookView: View {
    @ObservedObject var store: GameStore
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var text: String

    public init(store: GameStore) {
        self.store = store
        let entry = store.save.diary.first { $0.day == store.save.clock.day }
        _title = State(initialValue: entry?.title ?? "")
        _text = State(initialValue: entry?.text ?? "")
    }

    public var body: some View {
        ZStack {
            Color(red: 0.075, green: 0.055, blue: 0.04).ignoresSafeArea()
            VStack(spacing: 12) {
                HStack(spacing: 10) {
                    Image("journal", bundle: .module).resizable().scaledToFit().frame(width: 38, height: 38)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("生存日记").font(.title2.bold()).foregroundStyle(Color(red: 0.95, green: 0.91, blue: 0.79))
                        Text("第 \(store.save.clock.day) 天 · 本机自动保存").font(.caption).foregroundStyle(Color(red: 0.69, green: 0.64, blue: 0.53))
                    }
                    Spacer()
                    Button("稍后再写") { dismiss() }.buttonStyle(.bordered)
                    Button("保存") { store.writeDiary(title: title, text: text); dismiss() }.buttonStyle(.borderedProminent).tint(Color(red: 0.72, green: 0.48, blue: 0.18))
                }
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 10) {
                        TextField("今天的标题", text: $title).font(.title3.bold()).textFieldStyle(.plain)
                        Divider().overlay(Color.brown.opacity(0.5))
                        TextEditor(text: $text).scrollContentBackground(.hidden).frame(minHeight: 280).accessibilityLabel("日记正文")
                        Text("潮声、天气、发现和你建造的东西，都可以留在这里。")
                            .font(.caption).foregroundStyle(Color(red: 0.43, green: 0.34, blue: 0.25))
                    }
                    .padding(16).foregroundStyle(Color(red: 0.23, green: 0.18, blue: 0.13))
                    .background(Color(red: 0.94, green: 0.88, blue: 0.72), in: DiaryPaperShape())
                    if !store.save.diary.isEmpty {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 6) {
                                Text("往日记录").font(.caption.bold()).foregroundStyle(.yellow.opacity(0.8))
                                ForEach(store.save.diary) { entry in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("第 \(entry.day) 天").font(.caption2).foregroundStyle(.secondary)
                                        Text(entry.title.isEmpty ? "未命名" : entry.title).lineLimit(2)
                                    }.padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 4))
                                }
                            }
                        }.frame(minWidth: 150, idealWidth: 180, maxWidth: 220)
                    }
                }
            }.padding(14)
        }.preferredColorScheme(.dark)
    }
}

private struct DiaryPaperShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path(); p.move(to: .init(x: rect.minX + 4, y: rect.minY + 9)); p.addLine(to: .init(x: rect.maxX - 12, y: rect.minY)); p.addLine(to: .init(x: rect.maxX, y: rect.minY + 7)); p.addLine(to: .init(x: rect.maxX - 5, y: rect.maxY - 3)); p.addLine(to: .init(x: rect.minX + 9, y: rect.maxY)); p.addLine(to: .init(x: rect.minX, y: rect.maxY - 11)); p.closeSubpath(); return p
    }
}
