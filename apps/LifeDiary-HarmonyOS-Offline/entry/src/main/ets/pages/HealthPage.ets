import { common } from '@kit.AbilityKit'
import { OfflineData, OfflineProfile, PeriodRecord, SmokingRecord } from '../models/OfflineModels'
import { LocalDiaryStore } from '../services/LocalDiaryStore'

@Component export struct HealthPage {
  @State profile: OfflineProfile = new OfflineProfile()
  @State pain: number = 0
  @State note: string = ''
  @State notice: string = '健康功能默认关闭，由你自己选择'
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private store: LocalDiaryStore = new LocalDiaryStore(this.context)
  aboutToAppear(): void { this.store.load().then((data: OfflineData) => this.profile = data.profile) }
  private saveProfile(): void { this.store.saveProfile(this.profile).then(() => this.notice = '设置已保存在本机') }
  build() { Scroll() { Column() {
    Text('健康记录').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#202821').width('100%')
    Text('不按性别自动开启；周期预测只作生活参考。').fontSize(13).fontColor('#697169').margin({ top: 5, bottom: 18 }).width('100%')
    Row() { Text('启用周期记录').layoutWeight(1); Toggle({ type: ToggleType.Switch, isOn: this.profile.periodEnabled }).onChange((value: boolean) => { this.profile.periodEnabled = value; this.saveProfile() }) }.padding(15).backgroundColor('#FFFDF8').borderRadius(18).width('100%')
    if (this.profile.periodEnabled) { Column() {
      Text(`今天有多难受：${this.pain}/10`).width('100%'); Slider({ value: this.pain, min: 0, max: 10, step: 1 }).onChange((value: number) => this.pain = value)
      TextInput({ text: this.note, placeholder: '身体感受或备注' }).onChange((value: string) => this.note = value)
      Button('保存周期记录').width('100%').margin({ top: 8 }).backgroundColor('#244A37').onClick(() => this.store.addPeriod(new PeriodRecord(`${Date.now()}`, Date.now(), this.pain, this.note)).then(() => { this.note = ''; this.notice = '周期记录已保存' }))
    }.padding(15).margin({ top: 10 }).backgroundColor('#FFFDF8').borderRadius(18).width('100%') }
    Row() { Text('启用戒烟日记').layoutWeight(1); Toggle({ type: ToggleType.Switch, isOn: this.profile.smokingEnabled }).onChange((value: boolean) => { this.profile.smokingEnabled = value; this.saveProfile() }) }.padding(15).margin({ top: 12 }).backgroundColor('#FFFDF8').borderRadius(18).width('100%')
    if (this.profile.smokingEnabled) { Column() {
      Text('诚实记录坚持和反复，不评判。').fontSize(13).fontColor('#697169').width('100%')
      TextInput({ text: this.note, placeholder: '今天的感受' }).onChange((value: string) => this.note = value).margin({ top: 8 })
      Button('记录今天没有吸烟').width('100%').margin({ top: 8 }).backgroundColor('#244A37').onClick(() => this.store.addSmoking(new SmokingRecord(`${Date.now()}`, Date.now(), false, this.note)).then(() => { this.note = ''; this.notice = '戒烟记录已保存' }))
    }.padding(15).margin({ top: 10 }).backgroundColor('#FFFDF8').borderRadius(18).width('100%') }
    Text(this.notice).fontSize(12).fontColor('#697169').margin({ top: 12 }).width('100%')
  }.padding(18).alignItems(HorizontalAlign.Start).width('100%') }.width('100%').height('100%').backgroundColor('#F7F3E9') }
}
