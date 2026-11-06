import { common } from '@kit.AbilityKit'
import { preferences } from '@kit.ArkData'
import { OfflineDiaryEntry } from '../models/OfflineModels'
import { LocalDiaryStore } from '../services/LocalDiaryStore'

@Component export struct TodayPage {
  @State title: string = ''
  @State body: string = ''
  @State mood: number = 3
  @State notice: string = '只保存在这台设备'
  @State section: number = 0
  @State toolInput: string = ''
  @State plans: string[] = []
  @State schedule: string[] = []
  @State meals: string[] = []
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
  private store: LocalDiaryStore = new LocalDiaryStore(this.context)
  aboutToAppear(): void { preferences.getPreferences(this.context, 'daily_tools').then((store: preferences.Preferences) => {
    this.plans = JSON.parse(store.getSync('plans', '[]') as string) as string[]; this.schedule = JSON.parse(store.getSync('schedule', '[]') as string) as string[]; this.meals = JSON.parse(store.getSync('meals', '[]') as string) as string[]
  }).catch(() => {}) }
  private saveTools(): void { preferences.getPreferences(this.context, 'daily_tools').then((store: preferences.Preferences) => { store.putSync('plans', JSON.stringify(this.plans)); store.putSync('schedule', JSON.stringify(this.schedule)); store.putSync('meals', JSON.stringify(this.meals)); store.flush() }) }
  private currentTools(): string[] { return this.section === 1 ? this.plans : this.section === 2 ? this.schedule : this.meals }
  private addTool(): void { let value = this.toolInput.trim(); if (value.length === 0) return; if (this.section === 1) this.plans = [...this.plans, value]; else if (this.section === 2) this.schedule = [...this.schedule, value]; else this.meals = [...this.meals, value]; this.toolInput = ''; this.saveTools() }
  private removeTool(index: number): void { if (this.section === 1) this.plans = this.plans.filter((_value: string, itemIndex: number) => itemIndex !== index); else if (this.section === 2) this.schedule = this.schedule.filter((_value: string, itemIndex: number) => itemIndex !== index); else this.meals = this.meals.filter((_value: string, itemIndex: number) => itemIndex !== index); this.saveTools() }
  private save(): void { if (this.body.trim().length === 0) return
    this.store.addDiary(new OfflineDiaryEntry(`${Date.now()}`, this.title.trim() || '今天', this.body.trim(), this.mood)).then(() => {
      this.title = ''; this.body = ''; this.notice = '已安静地保存在本机'
    }).catch(() => this.notice = '保存失败，请稍后重试')
  }
  build() { Column() {
    Row() { ForEach(['快记', '计划', '课程', '饮食'], (label: string, index: number) => { Button(label).layoutWeight(1).fontSize(12).margin({ right: index < 3 ? 5 : 0 }).backgroundColor(this.section === index ? '#244A37' : '#E4EAE6').fontColor(this.section === index ? Color.White : '#202821').onClick(() => this.section = index) }) }.width('100%').margin({ bottom: 18 })
    if (this.section === 0) {
    Text('今天，也值得被记住').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#202821').width('100%')
    Text('不注册、不联网，先留下此刻。').fontSize(13).fontColor('#697169').margin({ top: 5, bottom: 18 }).width('100%')
    TextInput({ text: this.title, placeholder: '一句标题' }).onChange((value: string) => this.title = value).backgroundColor('#FFFDF8')
    TextArea({ text: this.body, placeholder: '此刻发生了什么？' }).onChange((value: string) => this.body = value).height(150).margin({ top: 10 }).backgroundColor('#FFFDF8')
    Text(`今天的感受 · ${this.mood}/5`).fontSize(13).fontColor('#697169').margin({ top: 12 }).width('100%')
    Slider({ value: this.mood, min: 1, max: 5, step: 1 }).onChange((value: number) => this.mood = value)
    Button('保存到个人日记').width('100%').height(50).backgroundColor('#244A37').onClick(() => this.save())
    Text(this.notice).fontSize(12).fontColor('#697169').margin({ top: 10 }).width('100%')
    } else {
      Text(this.section === 1 ? '今日计划' : this.section === 2 ? '课程表' : '饮食记录').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#202821').width('100%')
      Text(this.section === 3 ? '用于观察规律，不替代医疗或营养建议。' : '所有内容只保存在这台设备。').fontSize(13).fontColor('#697169').margin({ top: 5, bottom: 18 }).width('100%')
      Row() { TextInput({ text: this.toolInput, placeholder: this.section === 1 ? '添加要做的事' : this.section === 2 ? '例如：08:00 数学' : '这一餐吃了什么' }).onChange((value: string) => this.toolInput = value).layoutWeight(1); Button('添加').margin({ left: 8 }).backgroundColor('#244A37').onClick(() => this.addTool()) }.width('100%')
      List() { ForEach(this.currentTools(), (item: string, index: number) => { ListItem() { Row() { Text(item).layoutWeight(1); Button('删除').fontSize(12).backgroundColor(Color.Transparent).fontColor('#697169').onClick(() => this.removeTool(index)) }.padding(13).backgroundColor('#FFFDF8').borderRadius(14) }.margin({ top: 8 }) }, (item: string, index: number) => `${index}-${item}`) }.layoutWeight(1).width('100%')
    }
  }.padding(18).width('100%').height('100%').backgroundColor('#F7F3E9') }
}
