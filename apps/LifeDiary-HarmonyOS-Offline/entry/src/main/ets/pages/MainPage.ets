import { common } from '@kit.AbilityKit'
import { DiaryPage } from './DiaryPage'
import { HealthPage } from './HealthPage'
import { LedgerPage } from './LedgerPage'
import { ProfilePage } from './ProfilePage'
import { TodayPage } from './TodayPage'

class LifeDiaryDesignTokens { static readonly paper: string = '#F7F3E9'; static readonly ink: string = '#202821' }

@Entry
@Component
struct MainPage {
  @State tab: number = 0
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private setSensitivePrivacy(protectedScreen: boolean): void {
    this.context.windowStage.getMainWindowSync().setWindowPrivacyMode(protectedScreen).catch(() => {})
  }
  private selectTab(index: number): void { this.tab = index; this.setSensitivePrivacy(index === 1 || index === 2 || index === 3) }
  @Builder LifeNavigationBar() { Row({ space: 6 }) {
    Text('今天').fontSize(12).fontColor(this.tab === 0 ? Color.White : '#697169').backgroundColor(this.tab === 0 ? '#175B42' : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(0))
    Text('日记').fontSize(12).fontColor(this.tab === 1 ? Color.White : '#697169').backgroundColor(this.tab === 1 ? '#175B42' : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(1))
    Text('健康').fontSize(12).fontColor(this.tab === 2 ? Color.White : '#697169').backgroundColor(this.tab === 2 ? '#175B42' : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(2))
    Text('记账').fontSize(12).fontColor(this.tab === 3 ? Color.White : '#697169').backgroundColor(this.tab === 3 ? '#175B42' : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(3))
    Text('我的').fontSize(12).fontColor(this.tab === 4 ? Color.White : '#697169').backgroundColor(this.tab === 4 ? '#175B42' : Color.Transparent).borderRadius(10).padding(10).onClick(() => this.selectTab(4))
  }.padding({ left: 8, right: 8, top: 7, bottom: 9 }).width('100%').justifyContent(FlexAlign.SpaceAround).backgroundColor(LifeDiaryDesignTokens.paper) }
  build() { Column() {
    Row() { Text('生活日记 offline').fontSize(20).fontWeight(FontWeight.Bold).fontColor(LifeDiaryDesignTokens.ink).layoutWeight(1); Text('只保存在这台设备').fontSize(11).fontColor('#697169') }
      .padding({ left: 18, right: 18, top: 10, bottom: 6 }).width('100%').backgroundColor(LifeDiaryDesignTokens.paper)
    Column() {
      if (this.tab === 0) { TodayPage() }
      else if (this.tab === 1) { DiaryPage() }
      else if (this.tab === 2) { HealthPage() }
      else if (this.tab === 3) { LedgerPage() }
      else { ProfilePage() }
    }.layoutWeight(1).width('100%')
    this.LifeNavigationBar()
  }.width('100%').height('100%') }
}
