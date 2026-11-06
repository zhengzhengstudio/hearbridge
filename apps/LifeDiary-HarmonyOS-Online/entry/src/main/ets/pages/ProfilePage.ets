import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'
import { MinorModeService } from '../services/MinorModeService'
import { PassportService } from '../services/PassportService'
import { UpdateInfo, UpdateService } from '../services/UpdateService'
import { LifeDiaryDesignTokens, PageHeading } from '../components/LifeComponents'

@Component export struct ProfilePage {
  @State signedIn: boolean = false
  @State healthMode: number = 0
  @State pain: number = 0
  @State minorEnabled: boolean = false
  @State neverPrompt: boolean = false
  @State notice: string = '生活日记 hmos · 0.3.1'
  @State downloadProgress: number = -1
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private passport: PassportService = new PassportService(this.context)
  private minor: MinorModeService = new MinorModeService(this.context)
  private updates: UpdateService = new UpdateService(this.context)
  aboutToAppear(): void { this.passport.token().then((token: string) => this.signedIn = token.length > 0); preferences.getPreferences(this.context, 'life_profile').then((store: preferences.Preferences) => {
    this.healthMode = store.getSync('healthMode', 0) as number; this.minorEnabled = store.getSync('minorEnabled', false) as boolean
  }) }
  private setHealth(value: number): void { this.healthMode = value; preferences.getPreferences(this.context, 'life_profile').then((store: preferences.Preferences) => { store.putSync('healthMode', value); store.flush() }) }
  private checkUpdate(): void { this.updates.check().then((info: UpdateInfo | null) => {
    if (!info) { this.notice = '已是最新版本'; return }
    AlertDialog.show({ title: `发现 ${info.version}`, message: info.notes || '将并发下载并在校验后调用系统安装入口。', primaryButton: { value: '下载更新', action: () => { this.downloadProgress=0;this.updates.downloadAndInstall(info,(value:number)=>this.downloadProgress=value).then(()=>this.downloadProgress=-1).catch(()=>{this.downloadProgress=-1;this.notice='更新下载失败'}) } }, secondaryButton: { value: '稍后', action: () => {} } })
  }).catch(() => this.notice = '暂时无法检查更新') }
  build() {
    Scroll() { Column() {
      if (this.downloadProgress >= 0) { Column() { Row() { Text('正在并发下载更新').fontSize(12).layoutWeight(1);Text(`${Math.floor(this.downloadProgress*100)}%`).fontSize(12).fontColor(LifeDiaryDesignTokens.muted) };Stack({alignContent:Alignment.Start}) { Row().width('100%').height(3).backgroundColor('#DCE7E0');Row().width(`${Math.floor(this.downloadProgress*100)}%`).height(3).backgroundColor(LifeDiaryDesignTokens.pine) }.height(3).width('100%') }.width('100%').margin({bottom:12}) }
      PageHeading('我的生活', '通行证、健康日记和使用设置')
      Button(this.signedIn ? '退出通行证' : '绑定通行证').width('100%').backgroundColor(LifeDiaryDesignTokens.pine).onClick(() => {
        if (this.signedIn) {
          this.passport.signOut().then(() => this.signedIn = false)
        } else {
          this.passport.signIn().catch(() => this.notice = '未能打开通行证')
        }
      })
      Text('健康日记').fontSize(20).fontWeight(FontWeight.Bold).margin({ top: 22, bottom: 6 }).width('100%')
      Text('由你主动选择，不根据性别自动开启。').fontSize(12).fontColor(LifeDiaryDesignTokens.muted).width('100%')
      Row() { Button('不启用').layoutWeight(1).onClick(() => this.setHealth(0)); Button('经期记录').layoutWeight(1).onClick(() => this.setHealth(1)); Button('戒烟日记').layoutWeight(1).onClick(() => this.setHealth(2)) }.margin({ top: 10 }).width('100%')
      if (this.healthMode === 1) { Column() { Text(`今天有多难受：${this.pain}/10`).width('100%'); Slider({ value: this.pain, min: 0, max: 10, step: 1 }).onChange((value: number) => this.pain = value); Text('周期预测仅作生活参考，不作医学诊断。').fontSize(11).fontColor(LifeDiaryDesignTokens.muted).width('100%') }.padding(14).margin({ top: 10 }).backgroundColor(LifeDiaryDesignTokens.card).borderRadius(18) }
      if (this.healthMode === 2) { Text('从今天起记录不吸烟的时间，也允许诚实记录反复。').padding(14).margin({ top: 10 }).backgroundColor(LifeDiaryDesignTokens.card).borderRadius(18).width('100%') }
      Row() { Text('未成年人模式').layoutWeight(1); Toggle({ type: ToggleType.Switch, isOn: this.minorEnabled }).onChange((value: boolean) => this.minorEnabled = value) }.padding(14).margin({ top: 18 }).backgroundColor(LifeDiaryDesignTokens.card).borderRadius(18).width('100%')
      Row() { Text('永久不再提示').layoutWeight(1); Toggle({ type: ToggleType.Switch, isOn: this.neverPrompt }).onChange((value: boolean) => { this.neverPrompt = value; this.minor.setNeverPrompt(value) }) }.padding(14).margin({ top: 10 }).backgroundColor(LifeDiaryDesignTokens.card).borderRadius(18).width('100%')
      Button('恢复未成年人提示').width('100%').margin({ top: 8 }).backgroundColor(Color.Transparent).fontColor(LifeDiaryDesignTokens.muted).onClick(() => this.minor.setNeverPrompt(false).then(() => { this.neverPrompt = false; this.notice = '提示设置已恢复' }))
      Button('检查新版本').width('100%').margin({ top: 16 }).onClick(() => this.checkUpdate())
      Button('打开生活日记网站').width('100%').margin({ top: 8 }).backgroundColor(Color.Transparent).fontColor(LifeDiaryDesignTokens.pine).onClick(() => this.context.openLink('https://life.zhengzhengstudio.cn').catch(() => this.notice = '暂时无法打开网站'))
      Text(this.notice).fontSize(12).fontColor(LifeDiaryDesignTokens.muted).margin({ top: 10 }).width('100%')
    }.padding(18).alignItems(HorizontalAlign.Start).width('100%') }.width('100%').height('100%').backgroundColor(LifeDiaryDesignTokens.paper)
  }
}
