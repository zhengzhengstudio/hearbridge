import { common } from '@kit.AbilityKit'
import { DiaryEntry } from '../models/LifeModels'
import { LifeApiService } from '../services/LifeApiService'
import { PassportService } from '../services/PassportService'
import { LifeStore, PreferencesLifePersistence } from '../stores/LifeStore'
import { LifeDiaryDesignTokens, PageHeading } from '../components/LifeComponents'

@Component export struct DiaryPage {
  @State diaries: DiaryEntry[] = []
  @State notice: string = ''
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private api: LifeApiService = new LifeApiService()
  private store: LifeStore = new LifeStore(new PreferencesLifePersistence(this.context), this.api)
  private passport: PassportService = new PassportService(this.context)
  aboutToAppear(): void { this.store.load().then(() => this.diaries = this.store.diaries) }
  private confirmShare(entry: DiaryEntry): void {
    AlertDialog.show({ title: '确认发布到社区？', message: '会创建公开副本；个人日记仍保持私密，不支持匿名，也不显示设备名称。',
      primaryButton: { value: '确认公开副本', action: () => this.passport.token().then((token: string) => {
        if (token.length === 0) throw new Error('请先绑定通行证'); return this.api.publish(entry, token, true)
      }).then(() => { this.notice = '公共日记副本已发布' }).catch((error: Error) => this.notice = error.message) },
      secondaryButton: { value: '取消', action: () => {} } })
  }
  build() {
    Column() {
      PageHeading('个人日记', '这里保存私人原文。公开内容请前往公共日记。')
      Text(this.notice).fontSize(12).fontColor(LifeDiaryDesignTokens.muted).margin({ top: 8 }).width('100%')
      List() {
          ForEach(this.diaries, (item: DiaryEntry) => { ListItem() { Column() {
            Text(item.title).fontSize(17).fontWeight(FontWeight.Medium).width('100%')
            Text(item.body).fontSize(14).fontColor(LifeDiaryDesignTokens.muted).maxLines(4).margin({ top: 5 }).width('100%')
            Button('分享一个社区副本').fontSize(12).backgroundColor(Color.Transparent).fontColor(LifeDiaryDesignTokens.pine).onClick(() => this.confirmShare(item))
          }.alignItems(HorizontalAlign.Start).padding(15).backgroundColor(LifeDiaryDesignTokens.card).borderRadius(18) }.margin({ top: 10 }) }, (item: DiaryEntry) => item.id)
      }.layoutWeight(1).width('100%')
    }.padding(18).width('100%').height('100%').backgroundColor(LifeDiaryDesignTokens.paper)
  }
}
