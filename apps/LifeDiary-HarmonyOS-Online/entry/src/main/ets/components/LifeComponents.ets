export class LifeDiaryDesignTokens {
  static readonly pine: string = '#175B42'
  static readonly paper: string = '#F3F7F4'
  static readonly card: string = '#FAFCFB'
  static readonly ink: string = '#17221C'
  static readonly muted: string = '#5D7167'
  static readonly coral: string = '#3E725D'
}

@Builder export function PageHeading(title: string, subtitle: string) {
  Column() {
    Text(title).fontSize(28).fontWeight(FontWeight.Bold).fontColor(LifeDiaryDesignTokens.ink).width('100%')
    Text(subtitle).fontSize(13).fontColor(LifeDiaryDesignTokens.muted).margin({ top: 5, bottom: 18 }).width('100%')
  }.alignItems(HorizontalAlign.Start)
}
