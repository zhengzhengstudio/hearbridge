import { common } from '@kit.AbilityKit'
import { OfflineData, OfflineDiaryEntry } from '../models/OfflineModels'
import { LocalDiaryStore } from '../services/LocalDiaryStore'

@Component export struct DiaryPage {
  @State items: OfflineDiaryEntry[] = []
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private store: LocalDiaryStore = new LocalDiaryStore(this.context)
  aboutToAppear(): void { this.store.load().then((data: OfflineData) => this.items = data.diaries) }
  build() { Column() {
    Text('个人日记').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#202821').width('100%')
    Text('只属于你，也只保存在这台设备。').fontSize(13).fontColor('#697169').margin({ top: 5, bottom: 12 }).width('100%')
    if (this.items.length === 0) { Text('还没有日记，去“今天”写下第一篇吧。').fontSize(14).fontColor('#697169').margin({ top: 24 }) }
    List() { ForEach(this.items, (item: OfflineDiaryEntry) => { ListItem() { Row() {
      Column() { Text(item.title).fontSize(17).fontWeight(FontWeight.Medium).width('100%'); Text(item.body).fontSize(14).fontColor('#697169').maxLines(4).margin({ top: 5 }).width('100%') }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Button('删除').fontSize(11).backgroundColor(Color.Transparent).fontColor('#A54C43').onClick(() => this.store.removeDiary(item.id).then((data: OfflineData) => this.items = data.diaries))
    }.padding(15).backgroundColor('#FFFDF8').borderRadius(18) }.margin({ top: 10 }) }, (item: OfflineDiaryEntry) => item.id) }.layoutWeight(1).width('100%')
  }.padding(18).width('100%').height('100%').backgroundColor('#F7F3E9') }
}
