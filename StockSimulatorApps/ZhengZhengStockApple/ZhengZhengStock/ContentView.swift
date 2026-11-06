import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

private let updateBase = URL(string: "https://zhengzhengstudio.cn/api")!

enum Market: String, CaseIterable, Codable, Identifiable {
    case cn
    case hk
    case us

    var id: String { rawValue }
    var title: String {
        switch self {
        case .cn: return "A股"
        case .hk: return "港股"
        case .us: return "美股"
        }
    }
    var currency: String {
        switch self {
        case .cn: return "¥"
        case .hk: return "HK$"
        case .us: return "$"
        }
    }
    var indexName: String {
        switch self {
        case .cn: return "上证指数"
        case .hk: return "恒生指数"
        case .us: return "纳斯达克"
        }
    }
}

enum AppTheme: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: return "跟随系统"
        case .light: return "明亮"
        case .dark: return "暗色"
        }
    }
}

enum Density: String, CaseIterable, Identifiable {
    case compact
    case standard
    case spacious

    var id: String { rawValue }
    var title: String {
        switch self {
        case .compact: return "紧凑"
        case .standard: return "标准"
        case .spacious: return "宽松"
        }
    }
    var rowHeight: CGFloat {
        switch self {
        case .compact: return 48
        case .standard: return 58
        case .spacious: return 72
        }
    }
}

enum DataMode: String, CaseIterable, Identifiable {
    case hybrid
    case simulation
    case real

    var id: String { rawValue }
    var title: String {
        switch self {
        case .hybrid: return "真实+仿真"
        case .simulation: return "纯仿真"
        case .real: return "真实优先"
        }
    }
    var statusText: String {
        switch self {
        case .hybrid: return "服务器演示数据可用时接入，当前用本地行情补帧"
        case .simulation: return "本地演算，不请求服务器数据"
        case .real: return "服务器演示优先；未配置时自动回落本地演算"
        }
    }
}

struct Stock: Codable, Identifiable, Equatable {
    var id: String { code }
    let code: String
    let name: String
    let market: Market
    let sector: String
    let isIndex: Bool
    var price: Double
    var previousClose: Double
    var volume: Int
    var amplitude: Double

    var change: Double {
        guard previousClose > 0 else { return 0 }
        return (price - previousClose) / previousClose * 100
    }
}

struct Holding: Codable, Equatable {
    var qty: Int
    var avgPrice: Double
}

struct TradeRecord: Codable, Identifiable, Equatable {
    let id: UUID
    let time: Date
    let market: Market
    let code: String
    let name: String
    let type: String
    let quantity: Int
    let price: Double
}

struct MarketAccount: Codable, Equatable {
    var cash: Double
    var holdings: [String: Holding]
    var history: [TradeRecord]

    static func fresh(for market: Market) -> MarketAccount {
        let cash: Double = market == .us ? 50_000 : market == .hk ? 300_000 : 100_000
        return MarketAccount(cash: cash, holdings: [:], history: [])
    }
}

struct QuantSnapshot {
    let count: Int
    let advancers: Int
    let decliners: Int
    let avgChange: Double
    let volatility: Double
    let momentum: Double
    let liquidity: Double
    let risk: Double
    let score: Int

    var breadthText: String { "\(advancers)/\(decliners)" }
    var riskLabel: String {
        if risk >= 72 { return "稳健" }
        if risk >= 48 { return "中性" }
        return "高波动"
    }
    var scoreLabel: String {
        if score >= 70 { return "偏强" }
        if score >= 45 { return "均衡" }
        return "谨慎"
    }
}

struct QuantSignal {
    let score: Int
    let label: String
    let color: Color
}

struct UpdateResponse: Codable {
    let success: Bool?
    let version: String?
    let installUrl: String?
    let notes: String?
}

final class StockStore: ObservableObject {
    @Published var passport = UserDefaults.standard.string(forKey: "stock.passport") ?? ""
    @Published var market: Market = Market(rawValue: UserDefaults.standard.string(forKey: "stock.market") ?? "cn") ?? .cn
    @Published var accounts: [Market: MarketAccount] = [:]
    @Published var stocksByMarket: [Market: [Stock]] = [:]
    @Published var selectedCode = ""
    @Published var searchText = ""
    @Published var quantityText = "100"
    @Published var message = "内部行情引擎已启动"
    @Published var lastTick = Date()
    @Published var updateURL: URL?
    @Published var theme: AppTheme = AppTheme(rawValue: UserDefaults.standard.string(forKey: "stock.theme") ?? "system") ?? .system {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: "stock.theme") }
    }
    @Published var density: Density = Density(rawValue: UserDefaults.standard.string(forKey: "stock.density") ?? "standard") ?? .standard {
        didSet { UserDefaults.standard.set(density.rawValue, forKey: "stock.density") }
    }
    @Published var dataMode: DataMode = DataMode(rawValue: UserDefaults.standard.string(forKey: "stock.dataMode") ?? "hybrid") ?? .hybrid {
        didSet {
            UserDefaults.standard.set(dataMode.rawValue, forKey: "stock.dataMode")
            message = dataMode.statusText
        }
    }
    @Published var showHoldingsOnly = false

    private var timer: Timer?

    var isLoggedIn: Bool { !passport.isEmpty }
    var account: MarketAccount { accounts[market] ?? .fresh(for: market) }
    var currentStocks: [Stock] { stocksByMarket[market] ?? [] }
    var selectedStock: Stock? { currentStocks.first { $0.code == selectedCode } }
    var indexStock: Stock? { currentStocks.first { $0.isIndex } }
    var tradableCount: Int { currentStocks.filter { !$0.isIndex }.count }
    var quantSnapshot: QuantSnapshot {
        let rows = currentStocks.filter { !$0.isIndex }
        let count = max(rows.count, 1)
        let advancers = rows.filter { $0.change > 0 }.count
        let decliners = rows.filter { $0.change < 0 }.count
        let avgChange = rows.reduce(0) { $0 + $1.change } / Double(count)
        let variance = rows.reduce(0) { $0 + pow($1.change - avgChange, 2) } / Double(count)
        let volatility = sqrt(variance)
        let breadth = rows.isEmpty ? 0 : Double(advancers) / Double(rows.count)
        let totalVolume = rows.reduce(0) { $0 + Double($1.volume) }
        let momentum = clamp(50 + avgChange * 12 + (breadth - 0.5) * 70)
        let liquidity = clamp(log10(max(totalVolume, 100_000)) * 12 - 52)
        let risk = clamp(100 - volatility * 16 - max(0, 0.42 - breadth) * 80)
        let score = Int(clamp(momentum * 0.42 + liquidity * 0.24 + risk * 0.34).rounded())
        return QuantSnapshot(count: rows.count, advancers: advancers, decliners: decliners, avgChange: avgChange, volatility: volatility, momentum: momentum, liquidity: liquidity, risk: risk, score: score)
    }

    var filteredStocks: [Stock] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return currentStocks.filter { stock in
            if showHoldingsOnly && account.holdings[stock.code] == nil { return false }
            if query.isEmpty { return true }
            return stock.name.lowercased().contains(query) || stock.code.lowercased().contains(query) || stock.sector.lowercased().contains(query)
        }
    }

    var holdingValue: Double {
        account.holdings.reduce(0) { partial, item in
            let price = currentStocks.first(where: { $0.code == item.key })?.price ?? item.value.avgPrice
            return partial + Double(item.value.qty) * price
        }
    }

    var assets: Double { account.cash + holdingValue }

    func quantSignal(for stock: Stock) -> QuantSignal {
        let volumeScore = clamp(log10(max(Double(stock.volume), 10_000)) * 12 - 36)
        let momentumScore = clamp(50 + stock.change * 8)
        let reversalPenalty = stock.change < -3 ? abs(stock.change) * 5 : 0
        let score = Int(clamp(momentumScore * 0.58 + volumeScore * 0.28 + (100 - reversalPenalty) * 0.14).rounded())
        if score >= 70 && stock.change >= 0 {
            return QuantSignal(score: score, label: "活跃", color: .red)
        }
        if score < 38 || stock.change < -4 {
            return QuantSignal(score: score, label: "平稳", color: .green)
        }
        return QuantSignal(score: score, label: "观察", color: .orange)
    }

    init() {
        loadAccounts()
        generateMarket()
        startEngine()
    }

    deinit {
        timer?.invalidate()
    }

    func login(account: String, password: String, register: Bool) {
        let clean = account.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, password.count >= 6 else {
            message = "请输入账号，密码至少 6 位"
            return
        }
        passport = clean
        UserDefaults.standard.set(clean, forKey: "stock.passport")
        ensureAccount()
        message = "\(register ? "已注册" : "已登录")：\(clean)，三地账户已绑定"
    }

    func logout() {
        passport = ""
        selectedCode = ""
        UserDefaults.standard.removeObject(forKey: "stock.passport")
        message = "已退出通行证，本地账户数据保留"
    }

    func switchMarket(_ next: Market) {
        market = next
        UserDefaults.standard.set(next.rawValue, forKey: "stock.market")
        selectedCode = indexStock?.code ?? ""
        ensureAccount()
        message = "已切换到 \(next.title)，\(dataMode.title)模式运行中"
    }

    func refreshNow() {
        tick(strength: 1.8)
        message = "\(market.title) 已刷新，\(dataMode.title)：\(dataMode.statusText)"
    }

    func trade(type: String) {
        guard let stock = selectedStock, !stock.isIndex else {
            message = "请选择可交易股票"
            return
        }
        let quantity = Int(quantityText) ?? 0
        guard quantity > 0, quantity % 100 == 0 else {
            message = "数量必须为 100 股整数倍"
            return
        }
        var next = account
        let amount = Double(quantity) * stock.price
        if type == "buy" {
            guard next.cash >= amount else {
                message = "可用资金不足"
                return
            }
            let old = next.holdings[stock.code]
            let oldQty = old?.qty ?? 0
            let oldAmount = Double(oldQty) * (old?.avgPrice ?? 0)
            next.cash -= amount
            next.holdings[stock.code] = Holding(qty: oldQty + quantity, avgPrice: (oldAmount + amount) / Double(oldQty + quantity))
        } else {
            guard let old = next.holdings[stock.code], old.qty >= quantity else {
                message = "持仓不足"
                return
            }
            next.cash += amount
            let remain = old.qty - quantity
            next.holdings[stock.code] = remain == 0 ? nil : Holding(qty: remain, avgPrice: old.avgPrice)
        }
        next.history.insert(TradeRecord(id: UUID(), time: Date(), market: market, code: stock.code, name: stock.name, type: type, quantity: quantity, price: stock.price), at: 0)
        next.history = Array(next.history.prefix(80))
        accounts[market] = next
        saveAccounts()
        message = "\(type == "buy" ? "买入" : "卖出")成功：\(stock.name) \(quantity) 股"
    }

    func checkUpdate() {
        #if os(macOS)
        let platform = "macos"
        #else
        let platform = "ios"
        #endif
        guard let url = URL(string: updateBase.absoluteString + "/stock/app-update?platform=\(platform)") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            DispatchQueue.main.async {
                guard let data = data, let response = try? JSONDecoder().decode(UpdateResponse.self, from: data) else {
                    self.message = "更新检查失败，当前版本可继续使用"
                    return
                }
                if let value = response.installUrl, !value.isEmpty {
                    self.updateURL = URL(string: value, relativeTo: updateBase)?.absoluteURL
                }
                self.message = "最新版本 \(response.version ?? "1.0.0")：\(response.notes ?? "暂无说明")"
            }
        }.resume()
    }

    func installUpdate() {
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

    private func ensureAccount() {
        for item in Market.allCases where accounts[item] == nil {
            accounts[item] = .fresh(for: item)
        }
        saveAccounts()
    }

    private func startEngine() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            self?.tick(strength: 1)
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func tick(strength: Double) {
        for market in Market.allCases {
            guard var list = stocksByMarket[market] else { continue }
            let indexMove = Double.random(in: -0.08...0.1) * strength
            for offset in list.indices {
                let drift = list[offset].isIndex ? indexMove : indexMove + Double.random(in: -list[offset].amplitude...list[offset].amplitude) * strength
                let next = max(0.01, list[offset].price * (1 + drift / 100))
                list[offset].price = rounded(next, digits: market == .cn || market == .hk ? 2 : 2)
                list[offset].volume += Int.random(in: 1_000...90_000)
            }
            stocksByMarket[market] = list
        }
        lastTick = Date()
    }

    private func generateMarket() {
        stocksByMarket[.cn] = makeStocks(market: .cn, count: 520, baseCode: 600000, names: cnNames, sectors: cnSectors, indexCode: "000001.SH", indexPrice: 3048.22)
        stocksByMarket[.hk] = makeStocks(market: .hk, count: 92, baseCode: 1, names: hkNames, sectors: hkSectors, indexCode: "HSI", indexPrice: 18320.45)
        stocksByMarket[.us] = makeStocks(market: .us, count: 112, baseCode: 1, names: usNames, sectors: usSectors, indexCode: "IXIC", indexPrice: 17118.61)
        selectedCode = indexStock?.code ?? ""
    }

    private func makeStocks(market: Market, count: Int, baseCode: Int, names: [String], sectors: [String], indexCode: String, indexPrice: Double) -> [Stock] {
        var list = [Stock(code: indexCode, name: market.indexName, market: market, sector: "指数", isIndex: true, price: indexPrice, previousClose: indexPrice * 0.997, volume: 1_000_000, amplitude: 0.05)]
        for item in 0..<count {
            let baseName = names[item % names.count]
            let sector = sectors[item % sectors.count]
            let code: String
            switch market {
            case .cn:
                let prefix = item % 3 == 0 ? 600000 : item % 3 == 1 ? 300000 : 688000
                code = String(format: "%06d", prefix + item)
            case .hk:
                code = String(format: "%05d.HK", baseCode + item)
            case .us:
                let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
                code = "\(letters[item % 26])\(letters[(item / 3) % 26])\(letters[(item / 7) % 26])"
            }
            let price = market == .us ? Double.random(in: 12...420) : market == .hk ? Double.random(in: 1.2...190) : Double.random(in: 3.5...98)
            list.append(Stock(
                code: code,
                name: item < names.count ? baseName : "\(baseName)\(item + 1)",
                market: market,
                sector: sector,
                isIndex: false,
                price: rounded(price, digits: 2),
                previousClose: rounded(price * Double.random(in: 0.97...1.03), digits: 2),
                volume: Int.random(in: 120_000...80_000_000),
                amplitude: Double.random(in: 0.04...0.42)
            ))
        }
        return list
    }

    private func saveAccounts() {
        let encoded = accounts.reduce(into: [String: MarketAccount]()) { $0[$1.key.rawValue] = $1.value }
        if let data = try? JSONEncoder().encode(encoded) {
            UserDefaults.standard.set(data, forKey: "stock.accounts")
        }
    }

    private func loadAccounts() {
        if let data = UserDefaults.standard.data(forKey: "stock.accounts"),
           let decoded = try? JSONDecoder().decode([String: MarketAccount].self, from: data) {
            accounts = decoded.reduce(into: [Market: MarketAccount]()) { result, item in
                if let market = Market(rawValue: item.key) { result[market] = item.value }
            }
        }
        ensureAccount()
    }
}

private func rounded(_ value: Double, digits: Int) -> Double {
    let factor = pow(10, Double(digits))
    return (value * factor).rounded() / factor
}

private func clamp(_ value: Double, min lower: Double = 0, max upper: Double = 100) -> Double {
    Swift.max(lower, Swift.min(upper, value.isFinite ? value : 0))
}

private let cnNames = ["浦发银行", "白云机场", "东风汽车", "中国国贸", "首创环保", "上海机场", "包钢股份", "华能国际", "皖通高速", "保利发展", "中国联通", "招商银行", "宝钢股份", "三一重工", "贵州茅台", "海尔智家", "伊利股份", "长江电力", "中国平安", "兴业银行", "隆基绿能", "中芯国际", "宁德时代", "迈瑞医疗", "东方财富", "比亚迪", "万科A", "美的集团", "格力电器", "中信证券", "紫金矿业", "海康威视"]
private let hkNames = ["长和", "中电控股", "香港中华煤气", "汇丰控股", "电能实业", "恒生银行", "恒基地产", "新鸿基地产", "新世界发展", "太古股份", "腾讯控股", "友邦保险", "美团", "小米集团", "阿里巴巴", "京东集团", "比亚迪股份", "中国移动", "药明生物", "港交所"]
private let usNames = ["Apple", "Microsoft", "NVIDIA", "Amazon", "Meta", "Tesla", "Alphabet", "Netflix", "Adobe", "Oracle", "Intel", "AMD", "Broadcom", "Costco", "Walmart", "Visa", "Mastercard", "JPMorgan", "Boeing", "Disney"]
private let cnSectors = ["金融", "制造", "消费", "科技", "医药", "能源", "地产", "通信", "材料", "新能源"]
private let hkSectors = ["金融", "地产", "科技", "医药", "消费", "电讯", "能源"]
private let usSectors = ["Mega Tech", "AI", "Cloud", "Consumer", "Finance", "Industrial", "Media"]

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
        .frame(minWidth: 390, minHeight: 620)
        .preferredColorScheme(colorScheme)
    }

    private var colorScheme: ColorScheme? {
        switch store.theme {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

struct AuthView: View {
    @ObservedObject var store: StockStore
    @State private var account = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 46, weight: .semibold))
                .foregroundColor(.red)
            Text(Compliance.appName)
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("原生行情模拟，三地独立账户，同一通行证绑定")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            TextField("通行证账号", text: $account)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            SecureField("密码（至少 6 位）", text: $password)
                .textFieldStyle(RoundedBorderTextFieldStyle())
            HStack {
                Button("登录") { store.login(account: account, password: password, register: false) }
                    .buttonStyle(PrimaryButtonStyle(color: .red))
                Button("注册") { store.login(account: account, password: password, register: true) }
                    .buttonStyle(SecondaryButtonStyle())
            }
            Text(store.message)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(28)
        .frame(maxWidth: 520)
    }
}

struct TradingView: View {
    @ObservedObject var store: StockStore

    var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= 860
            VStack(spacing: 0) {
                TopBar(store: store)
                Divider()
                if wide {
                    HStack(spacing: 0) {
                        MarketList(store: store)
                            .frame(minWidth: 380, idealWidth: 480, maxWidth: 560)
                        Divider()
                        TradeDesk(store: store)
                            .frame(minWidth: 360, maxWidth: .infinity)
                    }
                } else {
                    VStack(spacing: 0) {
                        MarketList(store: store)
                        Divider()
                        TradeDesk(store: store)
                            .frame(maxHeight: 270)
                    }
                }
            }
        }
        .background(Color.clear)
    }
}

struct TopBar: View {
    @ObservedObject var store: StockStore
    @State private var showCompliance = false

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Compliance.appName)
                        .font(.title2)
                        .fontWeight(.bold)
                    Text(Compliance.appTagline)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text("\(store.passport) · \(store.market.title)独立练习账户 · \(store.tradableCount) 只股票 + \(store.market.indexName) · \(Compliance.modeLabel(store.dataMode))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Menu("行情") {
                    ForEach(DataMode.allCases) { item in
                        Button(item.title) { store.dataMode = item }
                    }
                }
                Menu("外观") {
                    ForEach(AppTheme.allCases) { item in
                        Button(item.title) { store.theme = item }
                    }
                    Divider()
                    ForEach(Density.allCases) { item in
                        Button("密度：\(item.title)") { store.density = item }
                    }
                }
                Menu("更多") {
                    Button("立即刷新") { store.refreshNow() }
                    Button("检查更新") { store.checkUpdate() }
                    if store.updateURL != nil {
                        Button("安装更新") { store.installUpdate() }
                    }
                    Divider()
                    Button("声明与隐私") { showCompliance = true }
                    Button("退出通行证") { store.logout() }
                }
            }
            .sheet(isPresented: $showCompliance) {
                ComplianceView()
            }
            Picker("市场", selection: Binding(get: { store.market }, set: { store.switchMarket($0) })) {
                ForEach(Market.allCases) { market in
                    Text(market.title).tag(market)
                }
            }
            .pickerStyle(SegmentedPickerStyle())
        }
        .padding()
    }
}

struct MarketList: View {
    @ObservedObject var store: StockStore

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                AccountMetric(title: "可用资金", value: money(store.account.cash, store.market))
                AccountMetric(title: "持仓市值", value: money(store.holdingValue, store.market))
                AccountMetric(title: "总资产", value: money(store.assets, store.market))
            }
            HStack(spacing: 8) {
                AccountMetric(title: "市场宽度", value: store.quantSnapshot.breadthText)
                AccountMetric(title: "量化评分", value: "\(store.quantSnapshot.score)")
                AccountMetric(title: "风控", value: store.quantSnapshot.riskLabel)
            }
            HStack {
                TextField("搜索代码、名称、行业", text: $store.searchText)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                Toggle("持仓", isOn: $store.showHoldingsOnly)
                    .toggleStyle(SwitchToggleStyle())
            }
            if let index = store.indexStock {
                StockRow(store: store, stock: index)
            }
            List(store.filteredStocks.filter { !$0.isIndex }) { stock in
                StockRow(store: store, stock: stock)
                    .listRowInsets(EdgeInsets(top: 3, leading: 0, bottom: 3, trailing: 0))
            }
            .listStyle(PlainListStyle())
            HStack {
                Text(store.message)
                    .lineLimit(2)
                Spacer()
                Text(timeFormatter.string(from: store.lastTick))
            }
            .font(.caption)
            .foregroundColor(.secondary)
        }
        .padding()
    }
}

struct StockRow: View {
    @ObservedObject var store: StockStore
    let stock: Stock

    var body: some View {
        let signal = store.quantSignal(for: stock)
        Button(action: { store.selectedCode = stock.code }) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(stock.name)
                            .fontWeight(stock.isIndex ? .bold : .semibold)
                        if stock.isIndex {
                            Text("指数")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.red.opacity(0.12))
                                .foregroundColor(.red)
                                .cornerRadius(4)
                        }
                    }
                    Text("\(stock.code) · \(stock.sector) · 成交 \(stock.volume / 10000)万")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                if !stock.isIndex {
                    VStack(alignment: .center, spacing: 3) {
                        Text(signal.label)
                            .font(.caption2)
                            .fontWeight(.bold)
                        Text("\(signal.score)")
                            .font(.caption2)
                    }
                    .foregroundColor(signal.color)
                    .frame(width: 46)
                }
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(store.market.currency)\(stock.price, specifier: "%.2f")")
                        .fontWeight(.bold)
                    Text("\(stock.change >= 0 ? "+" : "")\(stock.change, specifier: "%.2f")%")
                        .foregroundColor(stock.change >= 0 ? .red : .green)
                        .font(.caption)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: stock.isIndex ? 64 : store.density.rowHeight)
            .background(store.selectedCode == stock.code ? Color.red.opacity(0.1) : Color.secondary.opacity(0.08))
            .cornerRadius(8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct TradeDesk: View {
    @ObservedObject var store: StockStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                QuantRadarView(store: store)
                if let stock = store.selectedStock {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(stock.name)
                                    .font(.title2)
                                    .fontWeight(.bold)
                                Text("\(stock.code) · \(stock.sector)")
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Text("\(store.market.currency)\(stock.price, specifier: "%.2f")")
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundColor(stock.change >= 0 ? .red : .green)
                        }
                        TextField("数量，100 股整数倍", text: $store.quantityText)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                        HStack {
                            Button("买入") { store.trade(type: "buy") }
                                .buttonStyle(PrimaryButtonStyle(color: .red))
                                .disabled(stock.isIndex)
                            Button("卖出") { store.trade(type: "sell") }
                                .buttonStyle(PrimaryButtonStyle(color: .green))
                                .disabled(stock.isIndex)
                        }
                    }
                    .padding()
                    .background(Color.secondary.opacity(0.08))
                    .cornerRadius(8)
                }
                HoldingsView(store: store)
                HistoryView(store: store)
            }
            .padding()
        }
    }
}

struct QuantRadarView: View {
    @ObservedObject var store: StockStore

    var body: some View {
        let snapshot = store.quantSnapshot
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("量化雷达")
                    .font(.headline)
                Spacer()
                Text("\(snapshot.score) · \(snapshot.scoreLabel)")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(snapshot.score >= 70 ? .red : snapshot.score >= 45 ? .orange : .green)
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                AccountMetric(title: "动量", value: "\(Int(snapshot.momentum.rounded()))")
                AccountMetric(title: "波动", value: String(format: "%.2f", snapshot.volatility))
                AccountMetric(title: "活跃度", value: "\(Int(snapshot.liquidity.rounded()))")
                AccountMetric(title: "覆盖", value: "\(snapshot.count)只")
            }
            SignalBar(title: "上行因子", value: snapshot.momentum)
            SignalBar(title: "成交因子", value: snapshot.liquidity)
            SignalBar(title: "波动因子", value: snapshot.risk)
        }
        .padding()
        .background(Color.secondary.opacity(0.08))
        .cornerRadius(8)
    }
}

/// 合规声明页：完整声明 + 逐条要点 + 隐私说明。
/// 与 Android / HarmonyOS 端保持同一套文案口径。
/// 注意：部署目标为 macOS 11，不可使用 NavigationStack（需 13.0）
/// 与 textSelection（需 12.0），故使用兼容写法。
struct ComplianceView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("重要声明")
                    .font(.title2)
                    .fontWeight(.bold)
                Text(Compliance.disclaimer)
                    .font(.callout)

                Divider()

                Text("关于本应用").font(.headline)
                ForEach(Array(Compliance.aboutPoints.enumerated()), id: \.offset) { index, line in
                    Text("\(index + 1). \(line)")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }

                Divider()

                Text("隐私说明").font(.headline)
                Text(Compliance.privacy)
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            .padding()
        }
        .frame(minWidth: 420, minHeight: 480)
    }
}

struct SignalBar: View {
    let title: String
    let value: Double

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(width: 64, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.16))
                    Capsule()
                        .fill(LinearGradient(colors: [.green, .orange, .red], startPoint: .leading, endPoint: .trailing))
                        .frame(width: proxy.size.width * CGFloat(clamp(value) / 100))
                }
            }
            .frame(height: 7)
            Text("\(Int(clamp(value).rounded()))")
                .font(.caption.monospacedDigit())
                .frame(width: 28, alignment: .trailing)
        }
    }
}

struct HoldingsView: View {
    @ObservedObject var store: StockStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("持仓")
                .font(.headline)
            if store.account.holdings.isEmpty {
                Text("暂无持仓")
                    .foregroundColor(.secondary)
                    .padding(.vertical, 8)
            } else {
                ForEach(store.account.holdings.keys.sorted(), id: \.self) { code in
                    if let holding = store.account.holdings[code] {
                        let stock = store.currentStocks.first { $0.code == code }
                        HStack {
                            VStack(alignment: .leading) {
                                Text(stock?.name ?? code)
                                    .fontWeight(.semibold)
                                Text("\(holding.qty) 股 · 成本 \(store.market.currency)\(holding.avgPrice, specifier: "%.2f")")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Text(money(Double(holding.qty) * (stock?.price ?? holding.avgPrice), store.market))
                                .fontWeight(.bold)
                        }
                        .padding(10)
                        .background(Color.secondary.opacity(0.08))
                        .cornerRadius(8)
                    }
                }
            }
        }
    }
}

struct HistoryView: View {
    @ObservedObject var store: StockStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("最近成交")
                .font(.headline)
            if store.account.history.isEmpty {
                Text("暂无成交记录")
                    .foregroundColor(.secondary)
                    .padding(.vertical, 8)
            } else {
                ForEach(store.account.history.prefix(8)) { record in
                    HStack {
                        Text(record.type == "buy" ? "买" : "卖")
                            .fontWeight(.bold)
                            .foregroundColor(record.type == "buy" ? .red : .green)
                            .frame(width: 26)
                        VStack(alignment: .leading) {
                            Text(record.name)
                            Text("\(record.quantity) 股 · \(record.market.currency)\(record.price, specifier: "%.2f")")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Text(timeFormatter.string(from: record.time))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

struct AccountMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(value)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.secondary.opacity(0.08))
        .cornerRadius(8)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    let color: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(color.opacity(configuration.isPressed ? 0.72 : 1))
            .cornerRadius(8)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundColor(.primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Color.secondary.opacity(configuration.isPressed ? 0.14 : 0.08))
            .cornerRadius(8)
    }
}

private func money(_ value: Double, _ market: Market) -> String {
    "\(market.currency)\(String(format: "%.2f", value))"
}

private let timeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss"
    return formatter
}()

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
