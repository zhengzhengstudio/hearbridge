import { PlayMode } from '../shared/model/GameSave';

@Component
export struct GameHud {
  @Prop day: number = 1;
  @Prop minute: number = 360;
  @Prop weather: string = 'clear';
  @Prop mode: PlayMode = PlayMode.GUIDED;
  @Prop health: number = 100;
  @Prop stamina: number = 100;
  @Prop hunger: number = 100;
  @Prop hydration: number = 100;
  @Prop wood: number = 0;
  @Prop fiber: number = 0;
  @Prop stone: number = 0;
  @Prop campfires: number = 0;
  @Prop online: boolean = false;
  @Prop notice: string = '';
  @Prop guideText: string = '';
  @Prop contextActionLabel: string = '采集';
  @Prop secondaryActionLabel: string = '就近采集';
  onGatherWood: () => void = () => {};
  onGatherFiber: () => void = () => {};
  onGatherStone: () => void = () => {};
  onCraftCampfire: () => void = () => {};
  onCraftRope: () => void = () => {};
  onPlaceCampfire: () => void = () => {};
  onDiary: () => void = () => {};
  onToggleMode: () => void = () => {};
  onMap: () => void = () => {};
  onVillager: () => void = () => {};
  onFriends: () => void = () => {};
  onAdvanceTime: () => void = () => {};
  onFacilities: () => void = () => {};
  onContextAction: () => void = () => {};
  onSecondaryAction: () => void = () => {};
  onInventory: () => void = () => {};
  onCrafting: () => void = () => {};
  onSystem: () => void = () => {};

  private clock(): string {
    const hour = Math.floor(this.minute / 60).toString().padStart(2, '0');
    const minute = (this.minute % 60).toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }

  private weatherIcon(): Resource {
    if (this.weather === 'snow' || this.weather === 'blizzard') return $r('app.media.game_ui_weather_snow');
    if (this.weather === 'rain' || this.weather === 'storm') return $r('app.media.game_ui_weather_rain');
    return $r('app.media.game_ui_weather_clear');
  }

  build() {
    Column() {
      Row() {
        Text(`第 ${this.day} 天`).fontWeight(FontWeight.Bold).fontColor('#FFF9E9');
        Image(this.weatherIcon()).width(26).height(26).borderRadius(5).margin({ left: 12 });
        Text(`${this.clock()} · ${this.weather}`).fontColor('#FFD394').margin({ left: 12 });
        Blank();
        Text(this.online ? '联机版' : '单机版').fontSize(12).fontColor('#BEE7D6');
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 9, bottom: 9 })
      .border({ width: 1, color: '#B38B6C39' })
      .borderRadius(9)
      .backgroundColor('#F02B2118');

      if (this.mode === PlayMode.GUIDED) {
        Text(this.guideText)
          .fontSize(13)
          .fontColor('#F4E7C8')
          .padding(10)
          .margin({ top: 8 })
          .border({ width: 1, color: '#997D5D32' })
          .borderRadius(9)
          .backgroundColor('#EE3A2D20');
      }

      Column({ space: 2 }) {
        this.Vital('生命', this.health, '#C95B52', $r('app.media.game_ui_health'));
        this.Vital('体力', this.stamina, '#D2A348', $r('app.media.game_ui_energy'));
        this.Vital('饱腹', this.hunger, '#6E9A53', $r('app.media.game_ui_food'));
        this.Vital('饮水', this.hydration, '#3D93AE', $r('app.media.game_ui_water'));
      }.width(132).margin({ top: 8 }).padding(5).border({ width: 1, color: '#786342' }).borderRadius(6).backgroundColor('#F01B231D');

      Blank();

      Row({ space: 7 }) {
        Blank();
        Button(this.secondaryActionLabel).constraintSize({ minWidth: 92, maxWidth: 118, minHeight: 50 }).borderRadius(9).border({ width: 1, color: '#8C7651' }).fontSize(13).fontWeight(FontWeight.Bold).fontColor('#E7DFC7').backgroundColor('#EE2B3D34').onClick(this.onSecondaryAction);
        Button(this.contextActionLabel).constraintSize({ minWidth: 122, maxWidth: 154, minHeight: 56 }).borderRadius(13).border({ width: 2, color: '#D4A33F' }).fontWeight(FontWeight.Bold).fontColor('#FFF1D2').backgroundColor('#F0345F4C').shadow({ radius: 9, color: '#66030A08', offsetY: 4 }).onClick(this.onContextAction);
      }
        .width('100%');

      if (this.notice.length > 0) {
        Text(this.notice).fontSize(13).fontColor('#F4E7C8').padding(8).backgroundColor('#EE2B2118').borderRadius(9);
      }

      Row({ space: 4 }) {
        this.Hotbar($r('app.media.hotbar_driftwood'), this.wood);
        this.Hotbar($r('app.media.hotbar_palm_fiber'), this.fiber);
        this.Hotbar($r('app.media.hotbar_stone'), this.stone);
        this.Hotbar($r('app.media.hotbar_rope'), 0);
        this.Hotbar($r('app.media.hotbar_campfire'), this.campfires);
        this.Hotbar($r('app.media.hotbar_shelter'), 0);
      }.width('100%').height(58).padding(4).borderRadius(5).backgroundColor('#F02B2118');

      Row() {
        this.Dock($r('app.media.game_ui_backpack'), '背包', this.onInventory);
        this.Dock($r('app.media.game_ui_crafting'), '制作', this.onCrafting);
        this.Dock($r('app.media.game_ui_map'), '地图', this.onMap);
        this.Dock($r('app.media.game_ui_journal'), '日记', this.onDiary);
        this.Dock($r('app.media.game_ui_time'), '系统', this.onSystem);
      }.width('100%').height(60).padding(2).backgroundColor('#F20C1210');
    }
    .padding(12)
    .width('100%')
    .height('100%')
    .hitTestBehavior(HitTestMode.Default);
  }

  @Builder
  private Hotbar(icon: Resource, count: number) {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Image(icon).width(42).height(42).objectFit(ImageFit.Contain);
      Text(`${count}`).fontSize(10).fontWeight(FontWeight.Bold).fontColor('#FFD394')
        .padding({ left: 3, right: 3 }).borderRadius(7).backgroundColor('#E62B2118');
    }.layoutWeight(1).height(50).borderRadius(4).backgroundColor('#D4403224');
  }

  @Builder
  private Vital(label: string, value: number, color: string, icon: Resource) {
    Row({ space: 4 }) {
      Image(icon).width(20).height(20).borderRadius(3);
      Column({ space: 2 }) {
      Row() {
        Text(label).fontSize(10).fontColor('#D7C9A9');
        Blank();
        Text(`${Math.round(value)}`).fontSize(10).fontWeight(FontWeight.Bold).fontColor('#FFF7E5');
      }.width('100%');
      Progress({ value: value, total: 100, type: ProgressType.Linear })
        .height(6).color(color).backgroundColor('#281D18');
      }.layoutWeight(1);
    }.width('100%').padding({ left: 3, right: 3, top: 2, bottom: 2 });
  }

  @Builder
  private Dock(icon: Resource, label: string, action: () => void) {
    Column({ space: 2 }) {
      Image(icon).width(32).height(32).borderRadius(5);
      Text(label).fontSize(10).fontColor('#F4E7C8');
    }
    .layoutWeight(1).height(56).justifyContent(FlexAlign.Center).onClick(action);
  }
}
