import SwiftUI

struct ContentView: View {
    private let website = URL(string: "https://spacefight.zhengzhengstudio.cn/")!

    var body: some View {
        WebView(url: website)
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
