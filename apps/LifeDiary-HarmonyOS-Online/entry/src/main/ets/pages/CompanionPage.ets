import { common } from '@kit.AbilityKit'
import { LifeApiService } from '../services/LifeApiService'
import { PassportService } from '../services/PassportService'
import { LifeDiaryDesignTokens, PageHeading } from '../components/LifeComponents'

class CompanionMessage { role: string; body: string; constructor(role: string, body: string) { this.role = role; this.body = body } }

@Component export struct CompanionPage {
  @State draft: string = ''
  @State messages: CompanionMessage[] = []
  @State sending: boolean = false
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private api: LifeApiService = new LifeApiService()
  private passport: PassportService = new PassportService(this.context)
  private send(): void { let message = this.draft.trim(); if (message.length === 0) return
    this.messages = this.messages.concat([new CompanionMessage('user', message)]); this.draft = ''; this.sending = true
    this.passport.token().then((token: string) => { if (token.length === 0) throw new Error('请先绑定通行证'); return this.api.companion(token, message) })
      .then((answer: string) => this.messages = this.messages.concat([new CompanionMessage('assistant', answer)]))
      .catch(() => this.messages = this.messages.concat([new CompanionMessage('assistant', '现在连接不上服务，但你写下的话仍然重要。')]))
      .finally(() => this.sending = false)
  }
  build() {
    Column() {
      PageHeading('陪伴助手', '倾听与整理，不替代医疗或紧急帮助')
      List() { ForEach(this.messages, (item: CompanionMessage, index: number) => { ListItem() {
        Text(item.body).fontSize(15).padding(14).backgroundColor(item.role === 'user' ? '#DCEADD' : LifeDiaryDesignTokens.card).borderRadius(18).width('92%')
      }.margin({ top: 8 }) }, (_item: CompanionMessage, index: number) => `${index}`) }.layoutWeight(1).width('100%')
      Row() { TextInput({ text: this.draft, placeholder: '写下想说的话' }).layoutWeight(1).onChange((value: string) => this.draft = value)
        Button(this.sending ? '发送中' : '发送').margin({ left: 8 }).enabled(!this.sending).onClick(() => this.send()) }.width('100%')
    }.padding(18).width('100%').height('100%').backgroundColor(LifeDiaryDesignTokens.paper)
  }
}
