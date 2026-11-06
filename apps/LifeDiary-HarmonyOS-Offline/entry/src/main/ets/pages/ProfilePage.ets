import { common } from '@kit.AbilityKit'
import { OfflineData, OfflineProfile } from '../models/OfflineModels'
import { LocalDiaryStore } from '../services/LocalDiaryStore'
import { MinorModeService } from '../services/MinorModeService'

@Component export struct ProfilePage {
  @State profile: OfflineProfile = new OfflineProfile()
  @State profileMinor: boolean = false
  @State showMinorPrompt: boolean = false
  @State notice: string = '数据只保存在这台设备'
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private store: LocalDiaryStore = new LocalDiaryStore(this.context)
  private minor: MinorModeService = new MinorModeService(this.context)
  aboutToAppear(): void { this.store.load().then((data: OfflineData) => this.profile = data.profile) }
  private saveProfile(): void { this.store.saveProfile(this.profile).then(() => this.notice = '设置已保存在本机') }
  private finishAgeProfile(): void { this.minor.shouldPromptAfterProfile(this.profileMinor).then((show: boolean) => this.showMinorPrompt = show) }
  build() { Stack() {
    Scroll() { Column() {
      Text('本机与备份').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#202821').width('100%')
      Text('不创建账户，不上传内容。公共日记仅在联机版提供，备份文件由你自己保管。').fontSize(13).fontColor('#697169').margin({ top: 5, bottom: 18 }).width('100%')
      Button('导出备份').width('100%').backgroundColor('#244A37').onClick(() => this.store.exportBackup().then(() => this.notice = '备份已导出').catch(() => this.notice = '未能导出备份'))
      Button('导入备份').width('100%').margin({ top: 10 }).backgroundColor('#E7E1D5').fontColor('#202821').onClick(() => this.store.importBackup().then(() => this.notice = '备份已恢复').catch(() => this.notice = '备份格式不正确，原数据未改变'))
      Row() { Text('应用锁').layoutWeight(1); Toggle({ type: ToggleType.Switch, isOn: this.profile.appLockEnabled }).onChange((value: boolean) => { this.profile.appLockEnabled = value; this.saveProfile() }) }.padding(15).margin({ top: 20 }).backgroundColor('#FFFDF8').borderRadius(18).width('100%')
      Row() { Text('我是未成年人').layoutWeight(1); Toggle({ type: ToggleType.Switch, isOn: this.profileMinor }).onChange((value: boolean) => this.profileMinor = value) }.padding(15).margin({ top: 10 }).backgroundColor('#FFFDF8').borderRadius(18).width('100%')
      Button('保存年龄设置').width('100%').margin({ top: 10 }).backgroundColor('#244A37').onClick(() => this.finishAgeProfile())
      Button('恢复未成年人提示').width('100%').margin({ top: 8 }).backgroundColor(Color.Transparent).fontColor('#697169').onClick(() => this.minor.setNeverPrompt(false).then(() => this.notice = '提示设置已恢复'))
      Text(this.notice).fontSize(12).fontColor('#697169').margin({ top: 12 }).width('100%')
    }.padding(18).alignItems(HorizontalAlign.Start).width('100%') }.width('100%').height('100%')
    if (this.showMinorPrompt) { Column() {
      Text('未成年人模式').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#202821')
      Text('系统或年龄设置显示当前为未成年人。是否开启更安静的使用体验？').fontSize(15).fontColor('#697169').margin({ top: 12, bottom: 20 })
      Button('开启未成年人模式').width('100%').backgroundColor('#244A37').onClick(() => { this.profile.minorEnabled = true; this.saveProfile(); this.showMinorPrompt = false })
      Button('7 天内不再提示').width('100%').margin({ top: 10 }).backgroundColor('#E7E1D5').fontColor('#202821').onClick(() => this.minor.suppressSevenDays().then(() => this.showMinorPrompt = false))
      Button('永久不再提示').width('100%').margin({ top: 10 }).backgroundColor(Color.Transparent).fontColor('#697169').onClick(() => this.minor.setNeverPrompt(true).then(() => this.showMinorPrompt = false))
    }.padding(24).width('86%').backgroundColor('#FFFDF8').borderRadius(28).shadow({ radius: 28, color: '#33000000' }) }
  }.width('100%').height('100%').backgroundColor('#F7F3E9') }
}
