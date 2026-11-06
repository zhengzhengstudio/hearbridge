import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'
import { CompanionPage } from './CompanionPage'
import { CommunityPage } from './CommunityPage'
import { DiaryPage } from './DiaryPage'
import { LedgerPage } from './LedgerPage'
import { ProfilePage } from './ProfilePage'
import { TodayPage } from './TodayPage'
import { LifeDiaryDesignTokens } from '../components/LifeComponents'
import { MinorModeService } from '../services/MinorModeService'
import { PassportService } from '../services/PassportService'
import { UpdateInfo, UpdateService } from '../services/UpdateService'

@Entry
@Component
struct MainPage {
  @State tab: number = 0
  @State showMinorPrompt: boolean = false
  @State notice: string = ''
  @State pendingUpdate: UpdateInfo | null = null
  @State downloadProgress: number = -1
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private minor: MinorModeService = new MinorModeService(this.context)
  private passport: PassportService = new PassportService(this.context)
  private updates: UpdateService = new UpdateService(this.context)

  private setSensitivePrivacy(protectedScreen: boolean): void {
    this.context.windowStage.getMainWindowSync().setWindowPrivacyMode(protectedScreen).catch(() => {})
  }

  private selectTab(index: number): void {
    this.tab = index
    this.setSensitivePrivacy(index === 1 || index === 3 || index === 5)
  }

  @Builder
  LifeNavigationBar() {
    Row({ space: 4 }) {
      Text('今天').fontSize(12).fontWeight(this.tab === 0 ? FontWeight.Bold : FontWeight.Regular).fontColor(this.tab === 0 ? Color.White : LifeDiaryDesignTokens.muted).backgroundColor(this.tab === 0 ? LifeDiaryDesignTokens.pine : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(0))
      Text('日记').fontSize(12).fontWeight(this.tab === 1 ? FontWeight.Bold : FontWeight.Regular).fontColor(this.tab === 1 ? Color.White : LifeDiaryDesignTokens.muted).backgroundColor(this.tab === 1 ? LifeDiaryDesignTokens.pine : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(1))
      Text('公共').fontSize(12).fontWeight(this.tab === 2 ? FontWeight.Bold : FontWeight.Regular).fontColor(this.tab === 2 ? Color.White : LifeDiaryDesignTokens.muted).backgroundColor(this.tab === 2 ? LifeDiaryDesignTokens.pine : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(2))
      Text('记账').fontSize(12).fontWeight(this.tab === 3 ? FontWeight.Bold : FontWeight.Regular).fontColor(this.tab === 3 ? Color.White : LifeDiaryDesignTokens.muted).backgroundColor(this.tab === 3 ? LifeDiaryDesignTokens.pine : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(3))
      Text('陪伴').fontSize(12).fontWeight(this.tab === 4 ? FontWeight.Bold : FontWeight.Regular).fontColor(this.tab === 4 ? Color.White : LifeDiaryDesignTokens.muted).backgroundColor(this.tab === 4 ? LifeDiaryDesignTokens.pine : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(4))
      Text('我的').fontSize(12).fontWeight(this.tab === 5 ? FontWeight.Bold : FontWeight.Regular).fontColor(this.tab === 5 ? Color.White : LifeDiaryDesignTokens.muted).backgroundColor(this.tab === 5 ? LifeDiaryDesignTokens.pine : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(5))
    }.padding({ left: 8, right: 8, top: 7, bottom: 9 }).width('100%').justifyContent(FlexAlign.SpaceAround).backgroundColor(LifeDiaryDesignTokens.paper)
  }

  aboutToAppear(): void {
    this.minor.initialize().catch(() => {})
    this.updates.check().then((info: UpdateInfo | null) => {
      if (!info) return
      this.pendingUpdate = info
    }).catch(() => {})
    preferences.getPreferences(this.context, 'life_passport_callback').then((store: preferences.Preferences) => {
      let uri = store.getSync('uri', '') as string
      if (uri.length === 0) return
      store.deleteSync('uri'); store.flush()
      this.passport.completeCallback(uri).then((session) => {
        this.notice = '通行证已绑定'
        this.minor.shouldPromptAfterAuthentication(session.isMinor).then((show: boolean) => this.showMinorPrompt = show)
      }).catch(() => this.notice = '通行证登录校验失败')
    })
  }

  build() {
    Stack() {
      Column() {
        if (this.downloadProgress >= 0) {
          Column() {
            Row() { Text('正在并发下载更新').fontSize(12).fontWeight(FontWeight.Medium).layoutWeight(1); Text(`${Math.floor(this.downloadProgress * 100)}%`).fontSize(12).fontColor(LifeDiaryDesignTokens.muted) }.padding({ left: 18, right: 18, top: 8, bottom: 6 }).width('100%')
            Stack({ alignContent: Alignment.Start }) { Row().width('100%').height(3).backgroundColor('#DCE7E0'); Row().width(`${Math.floor(this.downloadProgress * 100)}%`).height(3).backgroundColor(LifeDiaryDesignTokens.pine) }.width('100%').height(3)
          }.width('100%').backgroundColor(LifeDiaryDesignTokens.paper)
        }
        Row() {
          Text('生活日记 hmos').fontSize(20).fontWeight(FontWeight.Bold).fontColor(LifeDiaryDesignTokens.ink).layoutWeight(1)
          Text(this.notice).fontSize(11).fontColor(LifeDiaryDesignTokens.muted)
        }.padding({ left: 18, right: 18, top: 10, bottom: 6 }).width('100%').backgroundColor(LifeDiaryDesignTokens.paper)
        Column() {
          if (this.tab === 0) { TodayPage() }
          else if (this.tab === 1) { DiaryPage() }
          else if (this.tab === 2) { CommunityPage() }
          else if (this.tab === 3) { LedgerPage() }
          else if (this.tab === 4) { CompanionPage() }
          else { ProfilePage() }
        }.layoutWeight(1).width('100%')
        this.LifeNavigationBar()
      }.width('100%').height('100%')
      if (this.showMinorPrompt) {
        Column() {
          Text('未成年人模式').fontSize(24).fontWeight(FontWeight.Bold).fontColor(LifeDiaryDesignTokens.ink)
          Text('通行证或系统确认当前为未成年人。是否开启更安静的社区体验？').fontSize(15).fontColor(LifeDiaryDesignTokens.muted).margin({ top: 12, bottom: 20 })
          Button('开启未成年人模式').width('100%').backgroundColor(LifeDiaryDesignTokens.pine).onClick(() => { this.showMinorPrompt = false; this.notice = '未成年人模式已开启' })
          Button('7 天内不再提示').width('100%').margin({ top: 10 }).backgroundColor('#E7E1D5').fontColor(LifeDiaryDesignTokens.ink).onClick(() => this.minor.suppressSevenDays().then(() => this.showMinorPrompt = false))
          Button('永久不再提示').width('100%').margin({ top: 10 }).backgroundColor(Color.Transparent).fontColor(LifeDiaryDesignTokens.muted).onClick(() => this.minor.setNeverPrompt(true).then(() => this.showMinorPrompt = false))
        }.padding(24).width('86%').backgroundColor(LifeDiaryDesignTokens.card).borderRadius(28).shadow({ radius: 28, color: '#33000000' })
      }
      if (this.pendingUpdate) {
        Rect().width('100%').height('100%').fill('#66000000').zIndex(299)
        Column() {
          Text(`发现生活日记 ${this.pendingUpdate?.version || ''}`).fontSize(22).fontWeight(FontWeight.Bold).fontColor(LifeDiaryDesignTokens.ink)
          Text('新版本已准备好。系统将接管下载和安装确认，不会读取你的日记或账目。').fontSize(14).fontColor(LifeDiaryDesignTokens.muted).margin({ top: 10, bottom: 18 })
          Button('下载并安装').width('100%').backgroundColor(LifeDiaryDesignTokens.pine).onClick(() => { let info=this.pendingUpdate;this.pendingUpdate=null;if(info){this.downloadProgress=0;this.updates.downloadAndInstall(info,(value:number)=>this.downloadProgress=value).then(()=>this.downloadProgress=-1).catch(()=>{this.downloadProgress=-1;this.notice='更新下载失败'})} })
          Button('稍后').width('100%').margin({ top: 8 }).backgroundColor(Color.Transparent).fontColor(LifeDiaryDesignTokens.muted).onClick(() => this.pendingUpdate = null)
        }.padding(24).width('86%').backgroundColor(LifeDiaryDesignTokens.card).borderRadius(24).shadow({ radius: 30, color: '#44000000' }).zIndex(300)
      }
    }.width('100%').height('100%')
  }
}
