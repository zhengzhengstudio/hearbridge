import { common } from '@kit.AbilityKit'
import { FriendItem } from '../models/LifeModels'
import { LifeApiService } from '../services/LifeApiService'
import { PassportService } from '../services/PassportService'
import { TapFriendService } from '../services/TapFriendService'
import { LifeDiaryDesignTokens, PageHeading } from '../components/LifeComponents'

@Component export struct ConnectionsPage {
  @State query: string = ''
  @State items: FriendItem[] = []
  @State notice: string = '好友申请不包含设备名称'
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private api: LifeApiService = new LifeApiService()
  private passport: PassportService = new PassportService(this.context)
  private tap: TapFriendService = new TapFriendService(this.context)
  private load(query: string = ''): void { this.passport.token().then((token: string) => {
    if (token.length === 0) throw new Error('请先绑定通行证'); return this.api.friends(token, query)
  }).then((items: FriendItem[]) => this.items = items).catch((error: Error) => this.notice = error.message) }
  private request(uid: string): void { this.passport.token().then((token: string) => this.api.requestFriend(token, uid)).then(() => this.notice = '好友申请已发送').catch(() => this.notice = '申请发送失败') }
  private touch(): void { this.passport.token().then((token: string) => {
    if (token.length === 0) throw new Error('请先绑定通行证'); return this.tap.shareFriendRequest(token)
  }).then(() => this.notice = '一次性好友申请已交给系统碰一碰').catch((error: Error) => this.notice = error.message) }
  build() {
    Column() {
      PageHeading('连接', '用通行证添加认识的人，也可碰一下发送一次性申请')
      Button('碰一下加好友').width('100%').height(50).backgroundColor(LifeDiaryDesignTokens.pine).onClick(() => this.touch())
      Row() {
        TextInput({ text: this.query, placeholder: '昵称或 UID' }).layoutWeight(1).onChange((value: string) => this.query = value)
        Button('查找').margin({ left: 8 }).onClick(() => this.load(this.query))
      }.margin({ top: 12 }).width('100%')
      Text(this.notice).fontSize(12).fontColor(LifeDiaryDesignTokens.muted).margin({ top: 8 }).width('100%')
      List() { ForEach(this.items, (item: FriendItem) => { ListItem() { Row() {
        Column() { Text(item.name).fontSize(16); Text(item.uid).fontSize(11).fontColor(LifeDiaryDesignTokens.muted) }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (item.status !== 'friend') Button('发送申请').fontSize(12).onClick(() => this.request(item.uid))
      }.padding(14).backgroundColor(LifeDiaryDesignTokens.card).borderRadius(18) }.margin({ top: 9 }) }, (item: FriendItem) => item.uid) }.layoutWeight(1).width('100%')
    }.padding(18).width('100%').height('100%').backgroundColor(LifeDiaryDesignTokens.paper)
  }
}
