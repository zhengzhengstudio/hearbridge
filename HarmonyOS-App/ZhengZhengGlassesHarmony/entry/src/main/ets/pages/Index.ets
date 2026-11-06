import http from '@ohos.net.http'
import preferences from '@ohos.data.preferences'

interface ChatPayload {
  uid: string
  role: string
  text: string
  merchantId: string
  merchantName: string
  customerName: string
}

interface PassportUser {
  uid?: string
  id?: string
  nickname?: string
  username?: string
}

interface PassportResponse {
  user?: PassportUser
}

/** 电商风镜框库：与网页版 / Android 端同源，服务端 /api/glasses/catalog。 */
interface ShopFrame {
  id?: string
  name?: string
  merchantName?: string
  merchantId?: string
  category?: string
  type?: string
  price?: number
  lensWidth?: number
  bridgeSize?: number
  image?: string
  tryOnImage?: string
  thumb?: string
}

interface CatalogResponse {
  frames?: ShopFrame[]
  total?: number
  excluded?: number
}

@Entry
@Component
struct Index {
  private readonly appVersion: string = '1.0.3'
  private readonly appBuild: number = 10003
  private pref?: preferences.Preferences
  @State activeTab: string = 'home'
  @State fittingStep: number = 1
  @State tempName: string = ''
  @State account: string = ''
  @State password: string = ''
  @State loginState: string = '未登录，可先创建本机临时配镜用户'
  @State loggedUid: string = ''
  @State loggedName: string = ''
  @State faceWidth: string = '139'
  @State pd: string = '63'
  @State bridgeWidth: string = '18'
  @State rightDegree: string = ''
  @State leftDegree: string = ''
  @State selectedFrame: string = '雾银圆框'
  @State templeLength: string = '145'
  @State customizationNote: string = ''
  @State wishlistText: string = '还没有加入心愿单'
  @State chatInput: string = '请根据我的配镜档案，帮我整理给商家的沟通内容。'
  @State chatStatus: string = '选择商家或 Kimi 顾问后即可沟通'
  @State localNote: string = '数据优先保存在本机；登录后再同步通行证。'
  @State windowWidth: number = 390
  @State catalogFrames: ShopFrame[] = []
  @State catalogNote: string = '正在加载镜框库…'
  private readonly shopAssetBase: string = 'https://glasses.zhengzhengstudio.cn/'

  // ===== 电商风 · 镜框库（2026-10-22）=====

  private loadCatalog(): void {
    let client = http.createHttp()
    client.request('https://zhengzhengstudio.cn/api/glasses/catalog', {
      method: http.RequestMethod.GET,
      connectTimeout: 6000,
      readTimeout: 8000
    }).then((result: http.HttpResponse) => {
      client.destroy()
      if (Number(result.responseCode) >= 200 && Number(result.responseCode) < 300) {
        let response = JSON.parse(String(result.result)) as CatalogResponse
        let frames = response.frames || []
        this.catalogFrames = frames
        this.catalogNote = frames.length > 0
          ? `镜框库共 ${frames.length} 款在售，点一下即可选中。`
          : '镜框库暂时没有加载出来，稍后再试。'
      } else {
        this.catalogNote = `镜框库加载失败（${result.responseCode}），稍后再试。`
      }
    }).catch(() => {
      client.destroy()
      this.catalogNote = '连不上镜框库，请检查网络后重试。'
    })
  }

  private shopImageUrl(frame: ShopFrame): string {
    let raw = String(frame.tryOnImage || frame.image || frame.thumb || '').trim()
    if (raw.length === 0) {
      return ''
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw
    }
    if (raw.startsWith('/')) {
      return `https://glasses.zhengzhengstudio.cn${raw}`
    }
    return `${this.shopAssetBase}${raw}`
  }

  private shopPriceText(frame: ShopFrame): string {
    let price = Number(frame.price || 0)
    return price > 0 ? `¥${price}` : '价格待询'
  }

  private shopSpecText(frame: ShopFrame): string {
    let lens = Number(frame.lensWidth || 0)
    let bridge = Number(frame.bridgeSize || 0)
    if (lens > 0) {
      return bridge > 0 ? `镜圈 ${lens}mm · 鼻梁 ${bridge}mm` : `镜圈 ${lens}mm`
    }
    return String(frame.type || '镜框')
  }

  @Builder
  private ShopGrid() {
    Grid() {
      ForEach(this.catalogFrames, (frame: ShopFrame) => {
        GridItem() {
          Column({ space: 5 }) {
            Image(this.shopImageUrl(frame))
              .width('100%')
              .aspectRatio(1)
              .objectFit(ImageFit.Contain)
              .backgroundColor('#f3f7f8')
              .borderRadius(10)
            Text(String(frame.merchantName || '铮铮精选'))
              .fontSize(11)
              .fontColor('#167769')
              .fontWeight(FontWeight.Medium)
              .width('100%')
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(String(frame.name || '未命名镜框'))
              .fontSize(13)
              .fontColor('#0d2227')
              .width('100%')
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.shopPriceText(frame))
              .fontSize(15)
              .fontColor('#e66f51')
              .fontWeight(FontWeight.Bold)
              .width('100%')
          }
          .width('100%')
          .padding(10)
          .backgroundColor('#ffffff')
          .borderRadius(14)
          .border({ width: 1, color: '#e0e9e8' })
          .onClick(() => {
            this.selectedFrame = String(frame.name || '未命名镜框')
            this.catalogNote = `已选中 ${this.selectedFrame}，可以进入实时试戴。`
            this.activeTab = 'fit'
            this.fittingStep = 3
          })
        }
      }, (frame: ShopFrame) => String(frame.id || frame.name || ''))
    }
    .columnsTemplate('1fr 1fr')
    .columnsGap(10)
    .rowsGap(10)
    .width('100%')
  }

  @Builder
  private ShopPage() {
    Column({ space: 12 }) {
      Column({ space: 5 }) {
        Text('镜框库').fontSize(26).fontWeight(FontWeight.Bold).fontColor('#0d2227')
        Text('陌森、珊珊与精选款式都在这里，先挑一副再进实时试戴。')
          .fontSize(14).fontColor('#53656b').lineHeight(20)
      }.width('100%').alignItems(HorizontalAlign.Start)

      if (this.catalogFrames.length === 0) {
        Column({ space: 10 }) {
          Text(this.catalogNote).fontSize(14).fontColor('#53656b')
          Button('重新加载').height(44).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.loadCatalog())
        }
        .width('100%')
        .padding(16)
        .backgroundColor('#ffffff')
        .borderRadius(12)
      } else {
        Text(this.catalogNote).fontSize(13).fontColor('#53656b').width('100%')
        this.ShopGrid()
      }
    }
    .width('100%')
  }

  aboutToAppear(): void {
    this.loadCatalog()
    preferences.getPreferences(getContext(this), 'zz_glasses_hmos_profile').then((pref: preferences.Preferences) => {
      this.pref = pref
      this.tempName = String(pref.getSync('tempName', ''))
      this.fittingStep = Number(pref.getSync('fittingStep', 1))
      this.faceWidth = String(pref.getSync('faceWidth', '139'))
      this.pd = String(pref.getSync('pd', '63'))
      this.bridgeWidth = String(pref.getSync('bridgeWidth', '18'))
      this.rightDegree = String(pref.getSync('rightDegree', ''))
      this.leftDegree = String(pref.getSync('leftDegree', ''))
      this.selectedFrame = String(pref.getSync('selectedFrame', '雾银圆框'))
      this.templeLength = String(pref.getSync('templeLength', '145'))
      this.customizationNote = String(pref.getSync('customizationNote', ''))
      this.wishlistText = String(pref.getSync('wishlistText', '还没有加入心愿单'))
      this.loggedUid = String(pref.getSync('loggedUid', ''))
      this.loggedName = String(pref.getSync('loggedName', ''))
      if (this.loggedUid.length > 0) {
        this.loginState = `${this.loggedName || '已登录用户'} · 通行证已连接`
      } else if (this.tempName.length > 0) {
        this.loginState = `${this.tempName} · 本机临时配镜用户`
      }
    })
  }

  private saveLocal(): void {
    if (!this.pref) {
      return
    }
    this.pref.putSync('tempName', this.tempName)
    this.pref.putSync('fittingStep', this.fittingStep)
    this.pref.putSync('faceWidth', this.faceWidth)
    this.pref.putSync('pd', this.pd)
    this.pref.putSync('bridgeWidth', this.bridgeWidth)
    this.pref.putSync('rightDegree', this.rightDegree)
    this.pref.putSync('leftDegree', this.leftDegree)
    this.pref.putSync('selectedFrame', this.selectedFrame)
    this.pref.putSync('templeLength', this.templeLength)
    this.pref.putSync('customizationNote', this.customizationNote)
    this.pref.putSync('wishlistText', this.wishlistText)
    this.pref.putSync('loggedUid', this.loggedUid)
    this.pref.putSync('loggedName', this.loggedName)
    this.pref.flush()
  }

  private currentName(): string {
    return this.loggedName.length > 0 ? this.loggedName : (this.tempName.length > 0 ? this.tempName : '匿名用户')
  }

  private currentUid(): string {
    return this.loggedUid.length > 0 ? this.loggedUid : (this.tempName.length > 0 ? `hmos_temp_${this.tempName}` : 'hmos_anonymous')
  }

  private compactLayout(): boolean {
    return this.windowWidth < 600
  }

  private pagePadding(): number {
    return this.compactLayout() ? 12 : 24
  }

  private recommendedLens(): number {
    let pdNumber = Number(this.pd)
    if (pdNumber <= 60) {
      return 49
    }
    if (pdNumber <= 63) {
      return 51
    }
    return 54
  }

  private reportText(): string {
    let lens = this.recommendedLens()
    let total = lens * 2 + Number(this.bridgeWidth)
    let dec = Math.max(0, (total - Number(this.pd)) / 2)
    return `用户：${this.currentName()}\n脸宽：${this.faceWidth} mm\n瞳距：${this.pd} mm\n建议镜圈宽度：${lens} mm\n鼻梁宽：${this.bridgeWidth} mm\n移心量约：${dec.toFixed(1)} mm\n当前镜框：${this.selectedFrame}\n右眼：${this.rightDegree || '未填'}\n左眼：${this.leftDegree || '未填'}`
  }

  private createTempUser(): void {
    this.loggedUid = ''
    this.loggedName = ''
    if (this.tempName.trim().length === 0) {
      this.tempName = '临时配镜用户'
    }
    this.loginState = `${this.tempName} · 本机临时配镜用户`
    this.localNote = '临时账户已保存在本机，不上传服务器。'
    this.saveLocal()
  }

  private addWishlist(): void {
    this.wishlistText = `${this.selectedFrame} · 镜圈 ${this.recommendedLens()} mm · 鼻梁 ${this.bridgeWidth} mm`
    this.localNote = '已加入心愿单，可在聊天页发送给商家。'
    this.saveLocal()
    this.syncSession('wishlist', this.wishlistText)
  }

  private syncSession(type: string, payload: string): void {
    if (this.loggedUid.length === 0) {
      return
    }
    let client = http.createHttp()
    client.request('https://zhengzhengstudio.cn/api/glasses/session/save', {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json' },
      extraData: JSON.stringify({ uid: this.loggedUid, type: type, payload: payload, createdAt: new Date().toISOString() }),
      connectTimeout: 6000,
      readTimeout: 8000
    }).then(() => client.destroy()).catch(() => client.destroy())
  }

  private login(): void {
    if (this.account.trim().length === 0 || this.password.length === 0) {
      this.loginState = '请填写账号和密码'
      return
    }
    let client = http.createHttp()
    client.request('https://zhengzhengstudio.cn/api/zz-pass/login', {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json' },
      extraData: JSON.stringify({ account: this.account, username: this.account, password: this.password }),
      connectTimeout: 6000,
      readTimeout: 8000
    }).then((result: http.HttpResponse) => {
      if (Number(result.responseCode) >= 200 && Number(result.responseCode) < 300) {
        let response = JSON.parse(String(result.result)) as PassportResponse
        let user = response.user
        if (user) {
          this.loggedUid = String(user.uid || user.id || '')
          this.loggedName = String(user.nickname || user.username || this.account)
          this.loginState = `${this.loggedName} · 通行证已连接`
          this.saveLocal()
          this.syncSession('harmony_profile', this.reportText())
        } else {
          this.loginState = '登录响应缺少用户信息'
        }
      } else {
        this.loginState = `登录失败：HTTP ${result.responseCode}`
      }
      client.destroy()
    }).catch(() => {
      this.loginState = '登录失败，已保留本机临时数据'
      client.destroy()
    })
  }

  private sendChat(): void {
    let payload: ChatPayload = {
      uid: this.currentUid(),
      role: 'customer',
      text: `${this.chatInput}\n\n${this.reportText()}\n心愿单：${this.wishlistText}`,
      merchantId: 'kimi',
      merchantName: 'Kimi 2.6 配镜顾问',
      customerName: this.currentName()
    }
    let client = http.createHttp()
    client.request('https://zhengzhengstudio.cn/api/glasses/chat/message', {
      method: http.RequestMethod.POST,
      header: { 'Content-Type': 'application/json' },
      extraData: JSON.stringify(payload),
      connectTimeout: 6000,
      readTimeout: 9000
    }).then((result: http.HttpResponse) => {
      this.chatStatus = Number(result.responseCode) >= 200 && Number(result.responseCode) < 300 ? '已发送到服务器会话' : `发送失败：HTTP ${result.responseCode}`
      client.destroy()
    }).catch(() => {
      this.chatStatus = '网络不可用，消息已保留在输入框，可稍后再发'
      client.destroy()
    })
  }

  @Builder
  private Card(title: string, subtitle: string) {
    Column({ space: 8 }) {
      Text(title).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#0d2227')
      Text(subtitle).fontSize(14).fontColor('#53656b').lineHeight(20)
    }
    .width('100%')
    .padding(this.compactLayout() ? 14 : 18)
    .backgroundColor('#ffffff')
    .borderRadius(12)
    .border({ width: 1, color: '#d7e5e2' })
  }

  @Builder
  private NavItem(label: string, key: string) {
    Button(label)
      .layoutWeight(1)
      .padding(0)
      .height(44)
      .fontSize(this.compactLayout() ? 12 : 13)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.activeTab === key ? '#ffffff' : '#167769')
      .backgroundColor(this.activeTab === key ? '#167769' : '#eef9f6')
      .borderRadius(12)
      .onClick(() => {
        this.activeTab = key
      })
  }

  @Builder
  private HomePage() {
    Column({ space: 14 }) {
      Column({ space: 5 }) {
        Text('铮铮眼镜').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#0d2227')
        Text('在线试戴与配镜沟通').fontSize(15).fontColor('#53656b')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 6 })
      this.Card(this.faceWidth === '139' && this.pd === '63' ? '开始第一次配镜' : '继续上次配镜',
        `脸宽 ${this.faceWidth} mm · 瞳距 ${this.pd} mm · ${this.wishlistText === '还没有加入心愿单' ? '心愿单为空' : '已有心愿镜框'}`)
      Row({ space: 10 }) {
        Button('继续配镜').layoutWeight(1).height(48).backgroundColor('#167769').fontColor('#fff').onClick(() => this.activeTab = 'fit')
        Button('联系顾问').layoutWeight(1).height(48).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.activeTab = 'chat')
      }
      Row({ space: 10 }) {
        Button('逛镜框库').layoutWeight(1).height(48).backgroundColor('#0d2227').fontColor('#fff').onClick(() => this.activeTab = 'shop')
        Button('实时试戴').layoutWeight(1).height(48).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.localNote = '正在准备实时试戴。')
      }
      this.Card('当前身份', this.loginState)
      this.Card('跨设备接力', this.loggedUid.length === 0
        ? '临时用户数据仅保存在本机。登录铮铮通行证后，可与网页版共享档案、心愿单和聊天。'
        : '登录后，App 与 glasses.zhengzhengstudio.cn 使用同一份配镜档案、心愿单和商家会话。')
    }
  }

  @Builder
  private FitStepHeader(title: string, description: string) {
    Column({ space: 8 }) {
      Text(`配镜进度  ${this.fittingStep} / 5`).fontSize(13).fontWeight(FontWeight.Bold).fontColor('#df674c')
      Text(title).fontSize(this.compactLayout() ? 24 : 28).fontWeight(FontWeight.Bold).fontColor('#0d2227')
      Text(description).fontSize(14).fontColor('#53656b').lineHeight(20)
      Row({ space: 4 }) {
        ForEach([1, 2, 3, 4, 5], (item: number) => {
          Divider().strokeWidth(6).color(item <= this.fittingStep ? '#167769' : '#d7e3e0').layoutWeight(1)
        })
      }.width('100%').margin({ top: 4, bottom: 8 })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  private advanceFit(): void {
    if (this.fittingStep < 5) {
      this.fittingStep += 1
    } else {
      this.fittingStep = 1
      this.activeTab = 'home'
      this.localNote = '本次配镜流程已完成，数据保留在“我的”中。'
    }
    this.saveLocal()
  }

  @Builder
  private FitNavigation() {
    Row({ space: 10 }) {
      Button(this.fittingStep === 1 ? '返回首页' : '上一步')
        .layoutWeight(1).height(48).fontColor('#167769').backgroundColor('#eef9f6')
        .onClick(() => {
          if (this.fittingStep === 1) {
            this.activeTab = 'home'
          } else {
            this.fittingStep -= 1
            this.saveLocal()
          }
        })
      Button(this.fittingStep === 5 ? '完成配镜' : '保存并下一步')
        .layoutWeight(1).height(48).fontColor('#ffffff').backgroundColor('#167769')
        .onClick(() => {
          this.saveLocal()
          this.syncSession('native_analysis', this.reportText())
          this.advanceFit()
        })
    }.width('100%')
  }

  @Builder
  private FitPage() {
    Column({ space: 12 }) {
      if (this.fittingStep === 1) {
        this.FitStepHeader('第 1 步 · 身份与临时用户', '确认这次配镜记录属于谁。正式账号可跨设备同步，临时用户只保存在本机。')
        this.Card('当前身份', this.loginState)
        TextInput({ placeholder: '临时用户名', text: this.tempName }).onChange((value: string) => this.tempName = value)
        Button('创建本机临时用户').height(46).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.createTempUser())
        TextInput({ placeholder: '通行证账号', text: this.account }).onChange((value: string) => this.account = value)
        TextInput({ placeholder: '密码', text: this.password }).type(InputType.Password).onChange((value: string) => this.password = value)
        Button('登录通行证').height(46).backgroundColor('#167769').fontColor('#ffffff').onClick(() => this.login())
      } else if (this.fittingStep === 2) {
        this.FitStepHeader('第 2 步 · 多角度采集', '只采集脸部关键帧，并用脸宽、瞳距或鼻梁宽校准毫米尺寸；本步骤不试戴镜框。')
        this.Card('尺寸校准', '摄像头测得的是比例，请至少输入一项真实测量值。')
        TextInput({ placeholder: '脸宽 mm', text: this.faceWidth }).type(InputType.Number).onChange((value: string) => this.faceWidth = value)
        TextInput({ placeholder: '瞳距 PD mm', text: this.pd }).type(InputType.Number).onChange((value: string) => this.pd = value)
        TextInput({ placeholder: '鼻梁宽 mm', text: this.bridgeWidth }).type(InputType.Number).onChange((value: string) => this.bridgeWidth = value)
        Button('开始多角度采集').height(48).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => {
          this.localNote = '请依次完成正脸、左右转头、抬头、低头、张嘴和眨眼。'
        })
        Text(this.localNote).fontSize(14).fontColor('#53656b')
      } else if (this.fittingStep === 3) {
        this.FitStepHeader('第 3 步 · 摄像头试戴', '选择一款镜框后进入实时试戴；本步骤只处理镜框选择、试戴与心愿单。')
        this.Card('当前试戴', this.selectedFrame)
        if (this.catalogFrames.length > 0) {
          Text('在售款式').fontSize(13).fontColor('#167769').fontWeight(FontWeight.Bold).width('100%')
          Grid() {
            ForEach(this.catalogFrames.slice(0, 6), (frame: ShopFrame) => {
              GridItem() {
                Row({ space: 8 }) {
                  Image(this.shopImageUrl(frame)).width(44).height(44).objectFit(ImageFit.Contain).backgroundColor('#f3f7f8').borderRadius(8)
                  Column({ space: 2 }) {
                    Text(String(frame.name || '未命名镜框')).fontSize(13).fontColor('#0d2227').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(this.shopSpecText(frame)).fontSize(11).fontColor('#53656b').maxLines(1)
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }
                .width('100%')
                .padding(8)
                .backgroundColor(this.selectedFrame === String(frame.name) ? '#eef9f6' : '#ffffff')
                .borderRadius(10)
                .border({ width: 1, color: '#d7e5e2' })
                .onClick(() => {
                  this.selectedFrame = String(frame.name || '未命名镜框')
                  this.saveLocal()
                })
              }
            }, (frame: ShopFrame) => String(frame.id || frame.name || ''))
          }
          .columnsTemplate('1fr')
          .columnsGap(8)
          .rowsGap(8)
          .width('100%')
          Button('去镜框库挑更多').height(44).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.activeTab = 'shop')
        } else {
          Text(this.catalogNote).fontSize(13).fontColor('#53656b')
          Button('去镜框库加载').height(44).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.activeTab = 'shop')
        }
        Button('打开实时试戴').height(48).backgroundColor('#167769').fontColor('#ffffff').onClick(() => {
          this.localNote = `正在准备 ${this.selectedFrame} 的实时试戴。`
        })
        Button('加入心愿单').height(46).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.addWishlist())
        Text(this.localNote).fontSize(14).fontColor('#53656b')
      } else if (this.fittingStep === 4) {
        this.FitStepHeader('第 4 步 · 报告与导出', '查看尺寸报告，并选填医院或视光机构提供的验光信息。摄像头不会估算度数。')
        TextInput({ placeholder: '右眼度数，可选', text: this.rightDegree }).onChange((value: string) => this.rightDegree = value)
        TextInput({ placeholder: '左眼度数，可选', text: this.leftDegree }).onChange((value: string) => this.leftDegree = value)
        Text(this.reportText()).fontSize(14).fontColor('#253b41').padding(16).backgroundColor('#ffffff').borderRadius(12)
        Button('保存报告').height(46).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => {
          this.saveLocal()
          this.syncSession('native_analysis', this.reportText())
        })
      } else if (this.fittingStep === 5) {
        this.FitStepHeader('第 5 步 · 定制镜框', '确认镜圈、鼻梁、镜腿和定制说明，正式制作前仍需商家复核。')
        TextInput({ placeholder: '建议镜圈宽度 mm', text: `${this.recommendedLens()}` }).type(InputType.Number)
        TextInput({ placeholder: '鼻梁宽 mm', text: this.bridgeWidth }).type(InputType.Number).onChange((value: string) => this.bridgeWidth = value)
        TextInput({ placeholder: '镜腿长度 mm', text: this.templeLength }).type(InputType.Number).onChange((value: string) => this.templeLength = value)
        TextArea({ placeholder: '材料、颜色、鼻托或其他定制说明', text: this.customizationNote }).height(100).onChange((value: string) => this.customizationNote = value)
        Button('联系配镜顾问').height(46).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => this.activeTab = 'chat')
      }
      this.FitNavigation()
    }
  }

  @Builder
  private WishPage() {
    Column({ space: 12 }) {
      this.Card('心愿单', '每次先收藏一副镜框，再带着参数发给商家。')
      TextInput({ placeholder: '镜框名称', text: this.selectedFrame }).onChange((value: string) => this.selectedFrame = value)
      Button('加入心愿单').height(48).backgroundColor('#167769').fontColor('#fff').onClick(() => this.addWishlist())
      Text(this.wishlistText).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#167769').padding(14).backgroundColor('#eef9f6').borderRadius(14)
    }
  }

  @Builder
  private ChatPage() {
    Column({ space: 12 }) {
      this.Card('配镜聊天', '把验光单、心愿单和配镜档案一起发送给 Kimi 2.6、闪闪或其他已入驻商家。')
      TextArea({ placeholder: '输入要问的问题', text: this.chatInput }).height(120).onChange((value: string) => this.chatInput = value)
      Button('发送给 Kimi 2.6').height(48).backgroundColor('#167769').fontColor('#fff').onClick(() => this.sendChat())
      Text(this.chatStatus).fontSize(14).fontColor('#53656b')
    }
  }

  @Builder
  private MePage() {
    Column({ space: 12 }) {
      this.Card('我的', this.loginState)
      TextInput({ placeholder: '通行证账号', text: this.account }).onChange((value: string) => this.account = value)
      TextInput({ placeholder: '密码', text: this.password }).type(InputType.Password).onChange((value: string) => this.password = value)
      Button('登录通行证').height(48).backgroundColor('#167769').fontColor('#fff').onClick(() => this.login())
      Button('清除本机临时用户').height(46).backgroundColor('#eef9f6').fontColor('#167769').onClick(() => {
        this.tempName = ''
        this.loggedUid = ''
        this.loggedName = ''
        this.loginState = '未登录，可先创建本机临时配镜用户'
        this.saveLocal()
      })
      Text(this.localNote).fontSize(14).fontColor('#53656b')
      Text(`v${this.appVersion} · build ${this.appBuild} · 通过华为应用市场更新`).fontSize(12).fontColor('#718187')
    }
  }

  @Builder
  private PageContent() {
    Column({ space: 14 }) {
      if (this.activeTab === 'home') {
        this.HomePage()
      } else if (this.activeTab === 'shop') {
        this.ShopPage()
      } else if (this.activeTab === 'fit') {
        this.FitPage()
      } else if (this.activeTab === 'wish') {
        this.WishPage()
      } else if (this.activeTab === 'chat') {
        this.ChatPage()
      } else {
        this.MePage()
      }
    }
    .width('100%')
    .constraintSize({ maxWidth: 920 })
    .padding(this.pagePadding())
  }

  @Builder
  private SideNavigation() {
    Column({ space: 8 }) {
      Column({ space: 3 }) {
        Text('铮铮眼镜').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#0d2227')
        Text('配镜工作台').fontSize(12).fontColor('#718187')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 8, bottom: 18 })
      this.SideNavItem('首页', 'home')
      this.SideNavItem('镜框库', 'shop')
      this.SideNavItem('配镜', 'fit')
      this.SideNavItem('心愿单', 'wish')
      this.SideNavItem('聊天', 'chat')
      this.SideNavItem('我的档案', 'me')
      Blank()
      Text(this.tempName.length > 0 ? '本机临时模式' : '网页版数据已连接')
        .fontSize(12).fontColor('#718187').width('100%').padding(8)
    }
    .width(220)
    .height('100%')
    .padding({ left: 12, right: 12, top: 22, bottom: 16 })
    .backgroundColor('#ffffff')
  }

  @Builder
  private SideNavItem(label: string, key: string) {
    Button(label)
      .width('100%').height(46)
      .fontSize(14).fontWeight(FontWeight.Medium)
      .fontColor(this.activeTab === key ? '#ffffff' : '#253b41')
      .backgroundColor(this.activeTab === key ? '#167769' : '#ffffff')
      .borderRadius(8)
      .onClick(() => this.activeTab = key)
  }

  build() {
    Stack() {
      if (this.windowWidth >= 840) {
        Row() {
          this.SideNavigation()
          Scroll() {
            Row() { this.PageContent() }.width('100%').justifyContent(FlexAlign.Center)
          }
          .layoutWeight(1).height('100%').backgroundColor('#edf3f2')
        }
        .width('100%').height('100%')
      } else {
        Column() {
          Scroll() {
            Row() { this.PageContent() }.width('100%').justifyContent(FlexAlign.Center)
          }
          .layoutWeight(1).backgroundColor('#edf3f2')
          Row({ space: 3 }) {
            this.NavItem('首页', 'home')
            this.NavItem('配镜', 'fit')
            this.NavItem('心愿', 'wish')
            this.NavItem('聊天', 'chat')
            this.NavItem('我的', 'me')
          }
          .width('100%').padding({ left: 8, right: 8, top: 8, bottom: 10 }).backgroundColor('#ffffff')
        }
        .width('100%').height('100%')
      }
    }
    .width('100%')
    .height('100%')
    .onAreaChange((_oldValue: Area, newValue: Area) => {
      let measuredWidth = Number(newValue.width)
      if (measuredWidth > 0 && measuredWidth !== this.windowWidth) {
        this.windowWidth = measuredWidth
      }
    })
  }
}
