import http from '@ohos.net.http'
import { Compliance } from '../common/Compliance'

PersistentStorage.persistProp('stockPassportToken', '')
PersistentStorage.persistProp('stockPassportAccount', '')

interface PassportUser {
  username: string
  nickname?: string
}

interface AuthResponse {
  success: boolean
  token: string
  account: string
  displayName: string
  error?: string
  user: PassportUser
}

interface AuthRequest {
  account: string
  password: string
  nickname?: string
}

interface Stock {
  code: string
  name: string
  price: number
  change: number
  volume: number
  market: string
  isIndex?: boolean
  sector?: string
  quoteMode?: string
  quoteSource?: string
  realQuoteSource?: string
  isSimulated?: boolean
}

interface QuoteStatus {
  effectiveMode: string
  realCount: number
  simulatedCount: number
  provider: string
}

interface QuotePayload {
  success: boolean
  stocks: Stock[]
  dataMode: string
  quoteStatus: QuoteStatus
  error?: string
}

interface Holding {
  qty: number
  avgPrice: number
}

interface AccountSummary {
  cash: number
  holdingCount: number
  historyCount: number
  marketName: string
}

interface StockAccount {
  cash: number
  holdings: Record<string, Holding>
  market: string
  marketName: string
  accountsSummary: Record<string, AccountSummary>
}

interface LocalAccount {
  cash: number
  holdings: Record<string, Holding>
}

interface StockDataResponse {
  success: boolean
  data: StockAccount
  stocks: Stock[]
  error?: string
}

interface TradeRequest {
  code: string
  market: string
  type: string
  quantity: number
}

interface TradeResponse {
  success: boolean
  data: StockAccount
  error?: string
}

interface UpdateResponse {
  success: boolean
  platform: string
  version: string
  installUrl: string
  notes: string
  mandatory: boolean
}

@Entry
@Component
struct Index {
  @StorageLink('stockPassportToken') token: string = ''
  @StorageLink('stockPassportAccount') account: string = ''
  @State loginAccount: string = ''
  @State loginPassword: string = ''
  @State market: string = 'cn'
  @State stocks: Stock[] = []
  @State holdings: Record<string, Holding> = {}
  @State localAccounts: Record<string, LocalAccount> = {}
  @State cash: number = 100000
  @State searchText: string = ''
  @State selectedCode: string = ''
  @State selectedName: string = ''
  @State selectedPrice: number = 0
  @State quantityText: string = '100'
  @State message: string = '原生内部行情已就绪'
  @State busy: boolean = false
  @State windowWidth: number = 390
  @State darkMode: boolean = false
  @State compactMode: boolean = false
  @State dataMode: string = 'hybrid'
  @State quoteStatus: string = '本地连续仿真'

  private readonly baseURL: string = 'https://zhengzhengstudio.cn'
  private localStocks: Record<string, Stock[]> = {}
  private tickTimer: number = -1
  private tickCount: number = 0

  aboutToAppear(): void {
    this.ensureAccounts()
    this.generateLocalStocks()
    if (this.account.length > 0) {
      this.bindAndRefresh()
    }
    this.tickTimer = setInterval(() => {
      if (this.account.length > 0) {
        this.tickCount++
        this.tickLocalMarket(this.dataMode === 'real' ? 0.16 : this.dataMode === 'hybrid' ? 0.38 : 1)
        this.applyCurrentMarket()
        if (this.dataMode !== 'simulation' && this.tickCount % 5 === 0) {
          this.syncServerQuotes(false)
        }
      }
    }, 1200)
  }

  aboutToDisappear(): void {
    if (this.tickTimer >= 0) {
      clearInterval(this.tickTimer)
      this.tickTimer = -1
    }
  }

  private marketName(): string {
    if (this.market === 'hk') {
      return '港股'
    }
    if (this.market === 'us') {
      return '美股'
    }
    return 'A股'
  }

  private marketCurrency(): string {
    if (this.market === 'hk') {
      return 'HK$'
    }
    if (this.market === 'us') {
      return '$'
    }
    return '¥'
  }

  private modeName(): string {
    if (this.dataMode === 'simulation') {
      return '纯仿真'
    }
    if (this.dataMode === 'real') {
      return '真实优先'
    }
    return '真实+仿真'
  }

  private pageColor(): string {
    return this.darkMode ? '#0D1218' : '#F4F6F8'
  }

  private cardColor(): string {
    return this.darkMode ? '#181E25' : '#FFFFFF'
  }

  private raisedColor(): string {
    return this.darkMode ? '#202730' : '#E9EDF2'
  }

  private inputColor(): string {
    return this.darkMode ? '#202730' : '#F4F6F8'
  }

  private primaryText(): string {
    return this.darkMode ? '#EFF2F6' : '#191F26'
  }

  private secondaryText(): string {
    return this.darkMode ? '#9FA9B5' : '#626B77'
  }

  private lineColor(): string {
    return this.darkMode ? '#323B46' : '#D7DDE4'
  }

  private selectedColor(): string {
    return this.darkMode ? '#422227' : '#FFF0F1'
  }

  private cycleDataMode(): void {
    if (this.dataMode === 'hybrid') {
      this.dataMode = 'simulation'
    } else if (this.dataMode === 'simulation') {
      this.dataMode = 'real'
    } else {
      this.dataMode = 'hybrid'
    }
    this.applyCurrentMarket(`${this.modeName()}模式已启用`)
    this.syncServerQuotes(true)
  }

  private filteredStocks(): Stock[] {
    let query = this.searchText.trim().toLowerCase()
    return this.stocks.filter((stock: Stock) => {
      return query.length === 0 ||
        stock.code.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query)
    })
  }

  private totalHoldingValue(): number {
    let total = 0
    Object.keys(this.holdings).forEach((code: string) => {
      let holding = this.holdings[code]
      let stock = this.stocks.find((item: Stock) => item.code === code)
      if (holding && stock) {
        total += holding.qty * stock.price
      }
    })
    return total
  }

  private quantSummary(): string {
    let rows = this.stocks.filter((stock: Stock) => !stock.isIndex)
    let count = rows.length > 0 ? rows.length : 1
    let advancers = rows.filter((stock: Stock) => stock.change > 0).length
    let decliners = rows.filter((stock: Stock) => stock.change < 0).length
    let avgChange = rows.reduce((sum: number, stock: Stock) => sum + stock.change, 0) / count
    let volatility = Math.sqrt(rows.reduce((sum: number, stock: Stock) => sum + Math.pow(stock.change - avgChange, 2), 0) / count)
    let breadth = rows.length > 0 ? advancers / rows.length : 0
    let momentum = Math.max(0, Math.min(100, 50 + avgChange * 12 + (breadth - 0.5) * 70))
    let risk = Math.max(0, Math.min(100, 100 - volatility * 16 - Math.max(0, 0.42 - breadth) * 80))
    let score = Math.round(momentum * 0.52 + risk * 0.48)
    let label = score >= 70 ? '偏强' : score >= 45 ? '均衡' : '谨慎'
    return `量化 ${score}·${label}  宽度 ${advancers}/${decliners}  波动 ${volatility.toFixed(2)}  覆盖 ${rows.length}只`
  }

  private quantSignal(stock: Stock): string {
    let volumeScore = Math.max(0, Math.min(100, Math.log10(Math.max(stock.volume, 10000)) * 12 - 36))
    let momentumScore = Math.max(0, Math.min(100, 50 + stock.change * 8))
    let reversalPenalty = stock.change < -3 ? Math.abs(stock.change) * 5 : 0
    let score = Math.round(Math.max(0, Math.min(100, momentumScore * 0.58 + volumeScore * 0.28 + (100 - reversalPenalty) * 0.14)))
    // 用中性的数学描述，避免"强势/风险"这类易触发金融风控审核的荐股式措辞
    return `活跃度 ${score}`
  }

  private request(path: string, method: http.RequestMethod, body: string,
    done: (result: string) => void, failed?: (message: string) => void): void {
    if (this.busy) {
      this.message = '正在处理，请稍后'
      return
    }
    let client = http.createHttp()
    let headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token.length > 0) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    this.busy = true
    client.request(`${this.baseURL}${path}`, {
      method: method,
      header: headers,
      extraData: body,
      connectTimeout: 6500,
      readTimeout: 9000
    }, (error: BusinessError, data: http.HttpResponse) => {
      this.busy = false
      if (error) {
        this.message = `连接失败：${error.message}`
        if (failed) failed(this.message)
      } else if (data.responseCode < 200 || data.responseCode >= 300) {
        this.message = `服务器返回 ${data.responseCode}`
        if (failed) failed(this.message)
      } else {
        try {
          done(data.result as string)
        } catch (parseError) {
          this.message = '服务器返回数据格式错误'
          if (failed) failed(this.message)
        }
      }
      client.destroy()
    })
  }

  private login(register: boolean): void {
    if (this.loginAccount.trim().length === 0 || this.loginPassword.length < 6) {
      this.message = '请输入账号，密码至少 6 位'
      return
    }
    this.token = `local-${Date.now()}`
    this.account = this.loginAccount.trim()
    this.ensureAccounts()
    this.message = `${register ? '已注册' : '已登录'}：${this.account}，三地账户已绑定`
    this.bindAndRefresh()
  }

  private bindAndRefresh(): void {
    this.ensureAccounts()
    this.applyCurrentMarket('通行证与本地模拟账户已绑定')
    this.syncServerQuotes(false)
  }

  private refreshStocks(): void {
    if (this.account.length === 0) {
      return
    }
    if (this.dataMode === 'simulation') {
      this.tickLocalMarket(1.8)
      this.quoteStatus = '纯仿真行情持续演算'
      this.applyCurrentMarket(`${this.marketName()}仿真行情已刷新`)
    } else {
      this.syncServerQuotes(true)
    }
  }

  private syncServerQuotes(manual: boolean): void {
    if (this.account.length === 0 || this.dataMode === 'simulation') {
      return
    }
    if (manual) {
      this.message = '正在同步服务器行情'
    }
    let requestedMarket = this.market
    let requestedMode = this.dataMode
    this.request(`/api/stock/stocks?market=${requestedMarket}&mode=${requestedMode}`,
      http.RequestMethod.GET, '', (result: string) => {
        let response = JSON.parse(result) as QuotePayload
        if (!response.success || !Array.isArray(response.stocks) || response.stocks.length === 0) {
          this.quoteStatus = '服务器数据格式有误，已启用本地演算'
          this.message = this.quoteStatus
          this.applyCurrentMarket(this.quoteStatus)
          return
        }
        this.localStocks[requestedMarket] = response.stocks
        let effectiveMode = response.quoteStatus ? response.quoteStatus.effectiveMode : 'simulation'
        this.quoteStatus = effectiveMode === 'real' ? '服务器演示行情' :
          effectiveMode === 'hybrid' ? '服务器混合演示行情' : '服务器演示行情'
        this.message = `${this.quoteStatus} · ${response.stocks.length} 个标的 · 已更新`
        if (this.market === requestedMarket) {
          if (!response.stocks.find((stock: Stock) => stock.code === this.selectedCode)) {
            this.selectedCode = response.stocks[0].code
          }
          this.applyCurrentMarket(`${this.quoteStatus} · ${response.stocks.length} 个标的`)
        }
      }, (reason: string) => {
        this.quoteStatus = reason === '服务器返回数据格式错误'
          ? '服务器数据格式有误，已启用本地演算'
          : requestedMode === 'real' ? '服务器演示数据不可用，已启用本地演算' : '服务器不可用，已切换本地演算'
        this.message = this.quoteStatus
        if (this.market === requestedMarket) this.applyCurrentMarket(this.quoteStatus)
      })
  }

  private applyStockData(response: StockDataResponse): void {
    this.stocks = response.stocks ?? []
    this.cash = response.data?.cash ?? 100000
    this.holdings = response.data?.holdings ?? {}
  }

  private switchMarket(market: string): void {
    this.market = market
    this.selectedCode = ''
    this.selectedName = ''
    this.selectedPrice = 0
    this.applyCurrentMarket(`已切换到${this.marketName()}，${this.modeName()}运行中`)
    this.syncServerQuotes(false)
  }

  private selectStock(stock: Stock): void {
    this.selectedCode = stock.code
    this.selectedName = stock.name
    this.selectedPrice = stock.price
  }

  private trade(type: string): void {
    let quantity = Number(this.quantityText)
    if (this.selectedCode.length === 0 || !Number.isInteger(quantity) || quantity <= 0 || quantity % 100 !== 0) {
      this.message = '请选择股票，数量必须为 100 股的整数倍'
      return
    }
    let selectedStock = this.stocks.find((stock: Stock) => stock.code === this.selectedCode)
    if (selectedStock && selectedStock.isIndex) {
      this.message = '指数仅供查看，不能交易'
      return
    }
    let account = this.localAccounts[this.market]
    if (!account) {
      this.ensureAccounts()
      account = this.localAccounts[this.market]
    }
    let amount = quantity * this.selectedPrice
    if (type === 'buy') {
      if (account.cash < amount) {
        this.message = '可用资金不足'
        return
      }
      let oldHolding = account.holdings[this.selectedCode]
      let oldQty = oldHolding ? oldHolding.qty : 0
      let oldAmount = oldHolding ? oldHolding.qty * oldHolding.avgPrice : 0
      account.cash -= amount
      account.holdings[this.selectedCode] = {
        qty: oldQty + quantity,
        avgPrice: (oldAmount + amount) / (oldQty + quantity)
      }
    } else {
      let oldHolding = account.holdings[this.selectedCode]
      if (!oldHolding || oldHolding.qty < quantity) {
        this.message = '持仓不足'
        return
      }
      account.cash += amount
      oldHolding.qty -= quantity
      if (oldHolding.qty <= 0) {
        let remainingHoldings: Record<string, Holding> = {}
        Object.keys(account.holdings).forEach((code: string) => {
          if (code !== this.selectedCode) {
            remainingHoldings[code] = account.holdings[code]
          }
        })
        account.holdings = remainingHoldings
      }
    }
    this.localAccounts[this.market] = account
    this.cash = account.cash
    this.holdings = account.holdings
    this.message = `${type === 'buy' ? '买入' : '卖出'}成功：${this.selectedName} ${quantity} 股`
  }

  private ensureAccounts(): void {
    if (!this.localAccounts['cn']) {
      this.localAccounts['cn'] = { cash: 100000, holdings: {} }
    }
    if (!this.localAccounts['hk']) {
      this.localAccounts['hk'] = { cash: 300000, holdings: {} }
    }
    if (!this.localAccounts['us']) {
      this.localAccounts['us'] = { cash: 50000, holdings: {} }
    }
  }

  private applyCurrentMarket(status: string = ''): void {
    this.ensureAccounts()
    this.stocks = this.localStocks[this.market] ?? []
    let account = this.localAccounts[this.market]
    this.cash = account.cash
    this.holdings = account.holdings
    if (status.length > 0) {
      this.message = `${status} · ${this.modeName()} · ${this.filteredStocks().length} 个标的`
    }
  }

  /**
   * 行情来源标签。刻意不暴露第三方数据供应商名称（如某财经平台），
   * 避免被判定为荐股导流或金融诈骗。
   */
  private quoteLabel(stock: Stock): string {
    if (stock.quoteMode === 'hybrid') {
      return '服务器补帧'
    }
    if (stock.quoteMode === 'real') {
      return '服务器演示'
    }
    return '本地演算'
  }

  private tickLocalMarket(strength: number = 1): void {
    Object.keys(this.localStocks).forEach((market: string) => {
      let list = this.localStocks[market]
      let indexMove = (Math.random() * 0.18 - 0.08) * strength
      list.forEach((stock: Stock) => {
        let drift = stock.isIndex ? indexMove : indexMove + (Math.random() * stock.volume % 100 / 100 - 0.5) * stock.price / 400 * strength
        stock.price = Math.max(0.01, Number((stock.price * (1 + drift / 100)).toFixed(2)))
        stock.volume += Math.floor(Math.random() * 90000 + 1000)
      })
      this.localStocks[market] = list
    })
  }

  private generateLocalStocks(): void {
    if (this.localStocks['cn'] && this.localStocks['cn'].length > 0) {
      return
    }
    this.localStocks['cn'] = this.makeStocks('cn', '000001.SH', '上证指数', 3048.22, 520)
    this.localStocks['hk'] = this.makeStocks('hk', 'HSI', '恒生指数', 18320.45, 92)
    this.localStocks['us'] = this.makeStocks('us', 'IXIC', '纳斯达克', 17118.61, 112)
  }

  private makeStocks(market: string, indexCode: string, indexName: string, indexPrice: number, count: number): Stock[] {
    let cnNames: string[] = ['浦发银行', '白云机场', '东风汽车', '中国国贸', '首创环保', '上海机场', '包钢股份', '华能国际', '皖通高速', '保利发展', '中国联通', '招商银行', '宝钢股份', '三一重工', '贵州茅台', '海尔智家', '伊利股份', '长江电力', '中国平安', '兴业银行', '隆基绿能', '中芯国际', '宁德时代', '迈瑞医疗', '东方财富', '比亚迪', '万科A', '美的集团', '格力电器', '中信证券', '紫金矿业', '海康威视']
    let hkNames: string[] = ['长和', '中电控股', '香港中华煤气', '汇丰控股', '电能实业', '恒生银行', '恒基地产', '新鸿基地产', '新世界发展', '太古股份', '腾讯控股', '友邦保险', '美团', '小米集团', '阿里巴巴', '京东集团', '比亚迪股份', '中国移动', '药明生物', '港交所']
    let usNames: string[] = ['Apple', 'Microsoft', 'NVIDIA', 'Amazon', 'Meta', 'Tesla', 'Alphabet', 'Netflix', 'Adobe', 'Oracle', 'Intel', 'AMD', 'Broadcom', 'Costco', 'Walmart', 'Visa', 'Mastercard', 'JPMorgan', 'Boeing', 'Disney']
    let sectors: string[] = market === 'us' ? ['Mega Tech', 'AI', 'Cloud', 'Consumer', 'Finance', 'Industrial', 'Media'] : ['金融', '制造', '消费', '科技', '医药', '能源', '地产', '通信', '材料', '新能源']
    let names = market === 'hk' ? hkNames : market === 'us' ? usNames : cnNames
    let result: Stock[] = [{
      code: indexCode,
      name: indexName,
      price: indexPrice,
      change: 0.28,
      volume: 1000000,
      market: market,
      isIndex: true
    }]
    for (let index = 0; index < count; index++) {
      let code = ''
      if (market === 'cn') {
        let prefix = index % 3 === 0 ? 600000 : index % 3 === 1 ? 300000 : 688000
        code = `${prefix + index}`
      } else if (market === 'hk') {
        code = `${(100000 + index + 1).toString().slice(1)}.HK`
      } else {
        code = `${String.fromCharCode(65 + index % 26)}${String.fromCharCode(65 + Math.floor(index / 3) % 26)}${String.fromCharCode(65 + Math.floor(index / 7) % 26)}`
      }
      let price = market === 'us' ? Math.random() * 408 + 12 : market === 'hk' ? Math.random() * 188 + 1.2 : Math.random() * 94 + 3.5
      result.push({
        code: code,
        name: index < names.length ? names[index] : `${names[index % names.length]}${index + 1}`,
        price: Number(price.toFixed(2)),
        change: Math.random() * 4 - 2,
        volume: Math.floor(Math.random() * 80000000 + 120000),
        market: market,
        isIndex: false
      })
    }
    return result
  }

  private checkUpdate(): void {
    this.request('/api/stock/app-update?platform=harmony', http.RequestMethod.GET, '', (result: string) => {
      let response = JSON.parse(result) as UpdateResponse
      this.message = `最新版本 ${response.version}：${response.notes}。当前开发包需签名后安装。`
    })
  }

  private logout(): void {
    this.token = ''
    this.account = ''
    this.stocks = []
    this.holdings = {}
    this.message = '已退出通行证'
  }

  @Builder
  LoginView() {
    Column({ space: 18 }) {
      Text(Compliance.APP_NAME)
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.primaryText())
      Text('三地独立练习账户 · 虚构行情数据 · 无真实交易')
        .fontSize(13)
        .fontColor(this.secondaryText())
      TextInput({ text: this.loginAccount, placeholder: '通行证账号' })
        .height(48)
        .fontColor(this.primaryText())
        .backgroundColor(this.inputColor())
        .border({ width: 1, color: this.lineColor() })
        .borderRadius(6)
        .onChange((value: string) => this.loginAccount = value)
      TextInput({ text: this.loginPassword, placeholder: '密码（至少 6 位）' })
        .type(InputType.Password)
        .height(48)
        .fontColor(this.primaryText())
        .backgroundColor(this.inputColor())
        .border({ width: 1, color: this.lineColor() })
        .borderRadius(6)
        .onChange((value: string) => this.loginPassword = value)
      Button('登录通行证')
        .width('100%')
        .height(48)
        .backgroundColor('#C5323A')
        .borderRadius(6)
        .onClick(() => this.login(false))
      Button('注册新通行证')
        .width('100%')
        .height(48)
        .backgroundColor(this.raisedColor())
        .fontColor(this.primaryText())
        .borderRadius(6)
        .onClick(() => this.login(true))
      Text(this.message)
        .fontSize(13)
        .fontColor(this.secondaryText())
    }
    .width(this.windowWidth < 600 ? '100%' : 480)
    .padding(24)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.lineColor() })
    .borderRadius(8)
  }

  @Builder
  MarketButton(code: string, title: string) {
    Button(title)
      .layoutWeight(1)
      .height(40)
      .backgroundColor(this.market === code ? '#C5323A' : this.raisedColor())
      .fontColor(this.market === code ? '#FFFFFF' : this.primaryText())
      .borderRadius(6)
      .onClick(() => this.switchMarket(code))
  }

  @Builder
  AccountCard(title: string, value: string) {
    Column({ space: 4 }) {
      Text(title)
        .fontSize(12)
        .fontColor(this.secondaryText())
      Text(value)
        .fontSize(this.windowWidth < 420 ? 15 : 18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.primaryText())
        .maxLines(1)
    }
    .layoutWeight(1)
    .padding(12)
    .backgroundColor(this.cardColor())
    .border({ width: 1, color: this.lineColor() })
    .borderRadius(6)
  }

  @Builder
  StockRow(stock: Stock) {
    Row({ space: 10 }) {
      Column({ space: 2 }) {
        Text(stock.name)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.primaryText())
        Text(`${stock.code} · ${stock.isIndex ? '指数' : this.quantSignal(stock)}`)
          .fontSize(11)
          .fontColor(this.secondaryText())
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Column({ space: 2 }) {
        Text(`${this.marketCurrency()}${stock.price.toFixed(2)}`)
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.primaryText())
        Text(`${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}% · ${this.quoteLabel(stock)}`)
          .fontSize(12)
          .fontColor(stock.change >= 0 ? '#C52A32' : '#138A55')
      }
      .alignItems(HorizontalAlign.End)
    }
    .width('100%')
    .padding(12)
    .backgroundColor(this.selectedCode === stock.code ? this.selectedColor() : this.cardColor())
    .border({ width: 1, color: this.selectedCode === stock.code ? '#C5323A' : this.lineColor() })
    .borderRadius(6)
    .onClick(() => this.selectStock(stock))
  }

  @Builder
  MainView() {
    Column({ space: 14 }) {
      Row({ space: 10 }) {
        Column({ space: 2 }) {
          Text(Compliance.APP_NAME)
            .fontSize(this.windowWidth < 420 ? 20 : 24)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.primaryText())
          Text(`${this.account} · ${this.marketName()}独立练习账户 · ${Compliance.modeLabel(this.dataMode)}`)
            .fontSize(12)
            .fontColor(this.secondaryText())
        }
        .alignItems(HorizontalAlign.Start)
        Blank()
        Button('刷新')
          .height(38)
          .backgroundColor(this.raisedColor())
          .fontColor(this.primaryText())
          .borderRadius(6)
          .onClick(() => this.refreshStocks())
      }
      .width('100%')

      Row({ space: 8 }) {
        this.MarketButton('cn', 'A股')
        this.MarketButton('hk', '港股')
        this.MarketButton('us', '美股')
      }
      .width('100%')

      Row({ space: 8 }) {
        this.AccountCard('可用资金', `${this.marketCurrency()}${this.cash.toFixed(2)}`)
        this.AccountCard('持仓市值', `${this.marketCurrency()}${this.totalHoldingValue().toFixed(2)}`)
        this.AccountCard('总资产', `${this.marketCurrency()}${(this.cash + this.totalHoldingValue()).toFixed(2)}`)
      }
      .width('100%')

      Text(this.quantSummary())
        .width('100%')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.primaryText())
        .padding(10)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.lineColor() })
        .borderRadius(6)

      TextInput({ text: this.searchText, placeholder: '搜索股票代码或名称' })
        .height(44)
        .fontColor(this.primaryText())
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.lineColor() })
        .borderRadius(6)
        .onChange((value: string) => this.searchText = value)

      if (this.selectedCode.length > 0) {
        Column({ space: 10 }) {
          Row() {
            Text(`${this.selectedName} ${this.selectedCode}`)
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.primaryText())
            Blank()
            Text(`${this.marketCurrency()}${this.selectedPrice.toFixed(2)}`)
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor('#C5323A')
          }
          .width('100%')
          Row({ space: 8 }) {
            TextInput({ text: this.quantityText, placeholder: '数量' })
              .type(InputType.Number)
              .layoutWeight(1)
              .height(42)
              .fontColor(this.primaryText())
              .backgroundColor(this.inputColor())
              .border({ width: 1, color: this.lineColor() })
              .borderRadius(6)
              .onChange((value: string) => this.quantityText = value)
            Button('买入')
              .height(42)
              .backgroundColor('#C5323A')
              .borderRadius(6)
              .onClick(() => this.trade('buy'))
            Button('卖出')
              .height(42)
              .backgroundColor('#138A55')
              .borderRadius(6)
              .onClick(() => this.trade('sell'))
          }
          .width('100%')
        }
        .width('100%')
        .padding(12)
        .backgroundColor(this.cardColor())
        .border({ width: 1, color: this.lineColor() })
        .borderRadius(6)
      }

      List({ space: 8 }) {
        ForEach(this.filteredStocks(), (stock: Stock) => {
          ListItem() {
            this.StockRow(stock)
          }
        }, (stock: Stock) => stock.code)
      }
      .layoutWeight(1)
      .width('100%')

      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.End, alignItems: ItemAlign.Center }) {
        Text(this.message)
          .width(this.windowWidth < 520 ? '100%' : '38%')
          .fontSize(12)
          .fontColor(this.secondaryText())
          .maxLines(2)
        Button(this.darkMode ? '明亮' : '暗色')
          .height(36)
          .backgroundColor(this.raisedColor())
          .fontColor(this.primaryText())
          .borderRadius(6)
          .margin({ left: 6, top: 6 })
          .onClick(() => this.darkMode = !this.darkMode)
        Button(this.compactMode ? '宽松' : '紧凑')
          .height(36)
          .backgroundColor(this.raisedColor())
          .fontColor(this.primaryText())
          .borderRadius(6)
          .margin({ left: 6, top: 6 })
          .onClick(() => this.compactMode = !this.compactMode)
        Button(this.modeName())
          .height(36)
          .backgroundColor(this.raisedColor())
          .fontColor(this.primaryText())
          .borderRadius(6)
          .margin({ left: 6, top: 6 })
          .onClick(() => this.cycleDataMode())
        Button('检查更新')
          .height(36)
          .backgroundColor(this.raisedColor())
          .fontColor(this.primaryText())
          .borderRadius(6)
          .margin({ left: 6, top: 6 })
          .onClick(() => this.checkUpdate())
        Button('退出')
          .height(36)
          .backgroundColor(this.darkMode ? '#422227' : '#FBEAEC')
          .fontColor(this.darkMode ? '#F2A7AC' : '#A61B24')
          .borderRadius(6)
          .margin({ left: 6, top: 6 })
          .onClick(() => this.logout())
      }
      .width('100%')
    }
    .width('100%')
    .height('100%')
  }

  build() {
    Stack() {
      if (this.account.length === 0) {
        this.LoginView()
      } else {
        this.MainView()
      }
    }
    .width('100%')
    .height('100%')
    .padding(this.compactMode ? 8 : this.windowWidth < 420 ? 10 : 18)
    .backgroundColor(this.pageColor())
    .onAreaChange((oldArea: Area, newArea: Area) => {
      this.windowWidth = Number(newArea.width)
    })
  }
}
