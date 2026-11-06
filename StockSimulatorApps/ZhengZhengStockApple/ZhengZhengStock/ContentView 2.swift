import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

private let apiBase = URL(string: "https://zhengzhengstudio.cn/api")!

struct PassportUser: Codable {
    let username: String
}

struct AuthResponse: Codable {
    let success: Bool?
    let token: String?
    let account: String?
    let displayName: String?
    let user: PassportUser?
    let error: String?
}

struct Stock: Codable, Identifiable {
    var id: String { code }
    let code: String
    let name: String
    let price: Double
    let change: Double
    let market: String?
    let isIndex: Bool?
}

struct Holding: Codable {
    let qty: Int
    let avgPrice: Double
}

struct StockAccount: Codable {
    let cash: Double
    let holdings: [String: Holding]
}

struct StockResponse: Codable {
    let success: Bool?
    let data: StockAccount?
    let stocks: [Stock]?
    let error: String?
}

struct UpdateResponse: Codable {
    let success: Bool?
    let version: String?
    let installUrl: String?
    let notes: String?
}

final class StockStore: ObservableObject {
    @Published var username = UserDefaults.standard.string(forKey: "stock.username") ?? ""
    @Published var token = UserDefaults.standard.string(forKey: "stock.token") ?? ""
    @Published var market = "cn"
    @Published var cash = 100_000.0
    @Published var holdings: [String: Holding] = [:]
    @Published var stocks: [Stock] = []
    @Published var message = "独立交易流程练习客户端"
    @Published var updateURL: URL?

    var isLoggedIn: Bool { !username.isEmpty }
    var currency: String { market == "hk" ? "HK$" : market == "us" ? "$" : "¥" }
    var assets: Double {
        cash + holdings.reduce(0) { result, item in
            result + Double(item.value.qty) * (stocks.first(where: { $0.code == item.key })?.price ?? 0)
        }
    }

    func authenticate(account: String, password: String, register: Bool) {
        request(path: register ? "/zz-pass/register" : "/zz-pass/login",
                method: "POST",
                body: ["account": account, "username": account, "nickname": account, "password": password]) {
            (response: AuthResponse) in
            guard response.success == true, let name = response.user?.username else {
                self.setMessage(response.error ?? "登录失败")
                return
            }
            DispatchQueue.main.async {
                self.username = name
                self.token = response.token ?? ""
                UserDefaults.standard.set(name, forKey: "stock.username")
                UserDefaults.standard.set(self.token, forKey: "stock.token")
                self.bindAndLoad()
            }
        }
    }

    func bindAndLoad() {
        request(path: "/stock/bind-passport?market=\(market)", method: "POST", body: ["username": username, "market": market]) {
            (response: StockResponse) in self.apply(response)
        }
    }

    func switchMarket(_ value: String) {
        market = value
        bindAndLoad()
    }

    func trade(stock: Stock, type: String, quantity: Int) {
        request(path: "/stock/trade/\(username)", method: "POST",
                body: ["code": stock.code, "market": market, "type": type, "quantity": quantity]) {
            (response: StockResponse) in
            self.apply(response)
            self.setMessage(type == "buy" ? "买入成功" : "卖出成功")
        }
    }

    func checkUpdate() {
        #if os(macOS)
        let platform = "macos"
        #else
        let platform = "ios"
        #endif
        request(path: "/stock/app-update?platform=\(platform)", method: "GET", body: nil) {
            (response: UpdateResponse) in
            DispatchQueue.main.async {
                if let value = response.installUrl, !value.isEmpty {
                    self.updateURL = URL(string: value, relativeTo: apiBase)?.absoluteURL
                }
                self.message = "最新版本 \(response.version ?? "1.0.0")：\(response.notes ?? "可用")"
            }
        }
    }

    func downloadUpdate() {
        guard let url = updateURL else {
            checkUpdate()
            return
        }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    func logout() {
        username = ""
        token = ""
        stocks = []
        holdings = [:]
        UserDefaults.standard.removeObject(forKey: "stock.username")
        UserDefaults.standard.removeObject(forKey: "stock.token")
    }

    private func apply(_ response: StockResponse) {
        DispatchQueue.main.async {
            self.cash = response.data?.cash ?? self.cash
            self.holdings = response.data?.holdings ?? self.holdings
            self.stocks = (response.stocks ?? self.stocks).filter { $0.isIndex != true }
            self.message = response.error ?? "行情已刷新"
        }
    }

    private func setMessage(_ value: String) {
        DispatchQueue.main.async { self.message = value }
    }

    private func request<T: Decodable>(path: String, method: String, body: [String: Any]?, completion: @escaping (T) -> Void) {
        var request = URLRequest(url: URL(string: apiBase.absoluteString + path)!)
        request.httpMethod = method
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body = body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        URLSession.shared.dataTask(with: request) { data, _, error in
            guard let data = data, error == nil, let decoded = try? JSONDecoder().decode(T.self, from: data) else {
                self.setMessage("连接失败，请稍后重试")
                return
            }
            completion(decoded)
        }.resume()
    }
}

struct ContentView: View {
    @StateObject private var store = StockStore()

    var body: some View {
        Group {
            if store.isLoggedIn {
                TradingView(store: store)
            } else {
                AuthView(store: store)
            }
        }
        .frame(minWidth: 360, minHeight: 560)
    }
}

struct AuthView: View {
    @ObservedObject var store: StockStore
    @State private var account = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 16) {
            Text(Compliance.appName).font(.largeTitle).bold()
            TextField("通行证账号", text: $account).textFieldStyle(RoundedBorderTextFieldStyle())
            SecureField("密码（至少 6 位）", text: $password).textFieldStyle(RoundedBorderTextFieldStyle())
            Button("登录通行证") { store.authenticate(account: account, password: password, register: false) }
            Button("注册新通行证") { store.authenticate(account: account, password: password, register: true) }
            Text(store.message).font(.caption).foregroundColor(.secondary)
        }
        .padding(28)
        .frame(maxWidth: 480)
    }
}

struct TradingView: View {
    @ObservedObject var store: StockStore
    @State private var selected: Stock?

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                VStack(alignment: .leading) {
                    Text(Compliance.appName).font(.title2).bold()
                    Text("\(store.username) · 独立账户").font(.caption).foregroundColor(.secondary)
                }
                Spacer()
                Menu("更多") {
                    Button("刷新行情") { store.bindAndLoad() }
                    Button("检查更新") { store.checkUpdate() }
                    if store.updateURL != nil {
                        Button("下载更新") { store.downloadUpdate() }
                    }
                    Button("退出通行证") { store.logout() }
                }
            }
            Picker("市场", selection: Binding(get: { store.market }, set: { store.switchMarket($0) })) {
                Text("A股").tag("cn"); Text("港股").tag("hk"); Text("美股").tag("us")
            }.pickerStyle(SegmentedPickerStyle())
            HStack {
                Metric(title: "可用资金", value: "\(store.currency)\(String(format: "%.2f", store.cash))")
                Metric(title: "总资产", value: "\(store.currency)\(String(format: "%.2f", store.assets))")
            }
            List(store.stocks) { stock in
                Button(action: { selected = stock }) {
                    HStack {
                        VStack(alignment: .leading) { Text(stock.name); Text(stock.code).font(.caption).foregroundColor(.secondary) }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text("\(store.currency)\(stock.price, specifier: "%.2f")")
                            Text("\(stock.change >= 0 ? "+" : "")\(stock.change, specifier: "%.2f")%")
                                .foregroundColor(stock.change >= 0 ? .red : .green)
                        }
                    }
                }.buttonStyle(PlainButtonStyle())
            }
            Text(store.message).font(.caption).foregroundColor(.secondary)
        }
        .padding()
        .sheet(item: $selected) { stock in TradeView(store: store, stock: stock) }
        .onAppear { store.bindAndLoad() }
    }
}

struct Metric: View {
    let title: String
    let value: String
    var body: some View {
        VStack(alignment: .leading) { Text(title).font(.caption).foregroundColor(.secondary); Text(value).bold() }
            .frame(maxWidth: .infinity, alignment: .leading).padding(10)
    }
}

struct TradeView: View {
    @ObservedObject var store: StockStore
    let stock: Stock
    @State private var quantity = "100"
    @Environment(\.presentationMode) private var presentationMode

    var body: some View {
        VStack(spacing: 16) {
            Text("\(stock.name) \(stock.code)").font(.title2).bold()
            Text("\(store.currency)\(stock.price, specifier: "%.2f")")
            TextField("数量", text: $quantity).textFieldStyle(RoundedBorderTextFieldStyle())
            HStack {
                Button("买入") { execute("buy") }
                Button("卖出") { execute("sell") }
                Button("取消") { presentationMode.wrappedValue.dismiss() }
            }
        }.padding(24).frame(minWidth: 320, minHeight: 220)
    }

    private func execute(_ type: String) {
        store.trade(stock: stock, type: type, quantity: Int(quantity) ?? 0)
        presentationMode.wrappedValue.dismiss()
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View { ContentView() }
}
