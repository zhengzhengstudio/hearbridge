export interface RoadTile { x: number; y: number; kind: string; rotation: number }
export interface WorldEntityVisual { id: string; type: string; x: number; y: number; railKind: string; railRotation: number }
export interface GroundItemVisual { id: string; itemId: string; amount: number; x: number; y: number }

@Component
export struct GameCanvas {
  @Link zoom: number;
  @Link offsetX: number;
  @Link offsetY: number;
  @Prop rotation: number = 0;
  @Prop weatherKind: string = 'clear';
  @Prop weatherIntensity: number = 0;
  @Prop minute: number = 480;
  @Prop campfires: number = 0;
  @Prop shelters: number = 0;
  @Prop villagers: number = 1;
  @Prop roads: RoadTile[] = [];
  @Prop entities: WorldEntityVisual[] = [];
  @Prop groundItems: GroundItemVisual[] = [];
  private lastOffsetX: number = 0;
  private lastOffsetY: number = 0;
  private lastScale: number = 1;

  private nightOpacity(): number {
    const hour = this.minute / 60;
    return Math.max(0, Math.min(0.58, Math.abs(hour - 12) / 12 * 0.72 - 0.12));
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Stack({ alignContent: Alignment.Center }) {
        // Procedural island background (replaces missing world_atlas asset)
        Stack({ alignContent: Alignment.Center }) {
          Column().width('100%').height('100%').backgroundColor('#0b1716');
          Column()
            .width(760)
            .height(560)
            .borderRadius({ topLeft: 310, topRight: 280, bottomLeft: 260, bottomRight: 300 })
            .backgroundColor('#15302b')
            .translate({ x: 10, y: 6 });
          Column()
            .width(720)
            .height(520)
            .borderRadius({ topLeft: 290, topRight: 260, bottomLeft: 240, bottomRight: 280 })
            .backgroundColor('#1c3f38')
            .translate({ x: 0, y: -8 });
          Column()
            .width(640)
            .height(440)
            .borderRadius({ topLeft: 250, topRight: 220, bottomLeft: 200, bottomRight: 240 })
            .backgroundColor('#2a4a3e')
            .translate({ x: -8, y: 18 });
          Column()
            .width(520)
            .height(340)
            .borderRadius({ topLeft: 180, topRight: 160, bottomLeft: 150, bottomRight: 170 })
            .backgroundColor('#224236')
            .translate({ x: 6, y: -6 });
          Column()
            .width(180)
            .height(130)
            .borderRadius({ topLeft: 90, topRight: 90, bottomLeft: 40, bottomRight: 60 })
            .backgroundColor('#182e29')
            .translate({ x: 160, y: -110 });
          Column()
            .width(110)
            .height(80)
            .borderRadius({ topLeft: 55, topRight: 55, bottomLeft: 30, bottomRight: 30 })
            .backgroundColor('#1a332d')
            .translate({ x: 130, y: -100 });
        }
        .width(980)
        .height(760);

        ForEach(this.roads, (road: RoadTile) => {
          Stack({ alignContent: Alignment.Center }) {
            if (road.kind === 'crossing') {
              Image($r('app.media.road_straight_ew')).width(56).height(56).objectFit(ImageFit.Contain);
              Image($r('app.media.road_straight_ns')).width(56).height(56).objectFit(ImageFit.Contain);
            } else if (road.kind === 'junction') {
              Image($r('app.media.road_junction_t')).width(56).height(56).objectFit(ImageFit.Contain).rotate({ angle: road.rotation });
            } else if (road.kind === 'curve') {
              Image($r('app.media.road_curve_es')).width(56).height(56).objectFit(ImageFit.Contain).rotate({ angle: road.rotation });
            } else if (road.kind === 'vertical') {
              Image($r('app.media.road_straight_ns')).width(56).height(56).objectFit(ImageFit.Contain);
            } else {
              Image($r('app.media.road_straight_ew')).width(56).height(56).objectFit(ImageFit.Contain);
            }
          }.width(56).height(56).translate({ x: road.x * 52, y: road.y * 52 });
        }, (road: RoadTile) => `${road.x},${road.y}`);

        ForEach(this.entities, (entity: WorldEntityVisual) => {
          Stack({ alignContent: Alignment.Bottom }) {
            if (entity.type === 'rail-segment') {
              if (entity.railKind === 'crossing') {
                Image($r('app.media.rail_crossing')).width(60).height(60).objectFit(ImageFit.Contain);
              } else if (entity.railKind === 'junction') {
                Image($r('app.media.rail_junction_t')).width(60).height(60).objectFit(ImageFit.Contain).rotate({ angle: entity.railRotation });
              } else if (entity.railKind === 'curve') {
                Image($r('app.media.rail_curve_es')).width(60).height(60).objectFit(ImageFit.Contain).rotate({ angle: entity.railRotation });
              } else if (entity.railKind === 'ns') {
                Image($r('app.media.rail_straight_ns')).width(60).height(60).objectFit(ImageFit.Contain);
              } else if (entity.railKind === 'ew') {
                Image($r('app.media.rail_straight_ew')).width(60).height(60).objectFit(ImageFit.Contain);
              } else {
                Image($r('app.media.rail_straight_ew')).width(60).height(60).objectFit(ImageFit.Contain);
              }
            } else if (entity.type === 'minecart') {
              Image($r('app.media.minecart')).width(76).height(52).objectFit(ImageFit.Contain);
            } else if (entity.type === 'rowboat') {
              Image($r('app.media.rowboat')).width(164).height(82).objectFit(ImageFit.Contain);
            } else if (entity.type === 'animal-land-crab') {
              Image($r('app.media.animal_land_crab')).width(58).height(48).objectFit(ImageFit.Contain);
            } else if (entity.type === 'animal-sea-turtle') {
              Image($r('app.media.animal_sea_turtle')).width(82).height(58).objectFit(ImageFit.Contain);
            } else if (entity.type === 'animal-wild-boar') {
              Image($r('app.media.animal_wild_boar')).width(88).height(70).objectFit(ImageFit.Contain);
            } else if (entity.type === 'campfire' || entity.type === 'furnace') {
              Image($r('app.media.campfire')).width(78).height(72).objectFit(ImageFit.Contain);
            } else if (entity.type === 'shelter' || entity.type === 'bed') {
              Image($r('app.media.shelter')).width(138).height(122).objectFit(ImageFit.Contain);
            } else if (entity.type === 'garden-plot' || entity.type === 'farm') {
              Image($r('app.media.game_ui_gather')).width(72).height(72).objectFit(ImageFit.Contain);
            } else if (entity.type === 'storage-crate') {
              Image($r('app.media.game_ui_backpack')).width(68).height(68).objectFit(ImageFit.Contain);
            } else {
              Image($r('app.media.game_ui_crafting')).width(68).height(68).objectFit(ImageFit.Contain);
            }
          }.width(142).height(126).translate({ x: entity.x * 52, y: entity.y * 52 });
        }, (entity: WorldEntityVisual) => entity.id);

        ForEach(this.groundItems, (item: GroundItemVisual) => {
          Stack({ alignContent: Alignment.BottomEnd }) {
            if (item.itemId === 'coconut') {
              Image($r('app.media.game_ui_food')).width(48).height(48).objectFit(ImageFit.Contain);
            } else if (item.itemId === 'berry') {
              Image($r('app.media.game_ui_food')).width(48).height(48).objectFit(ImageFit.Contain);
            } else if (item.itemId === 'fresh-water') {
              Image($r('app.media.game_ui_water')).width(48).height(48).objectFit(ImageFit.Contain);
            } else if (item.itemId === 'palm-fiber') {
              Image($r('app.media.hotbar_palm_fiber')).width(48).height(48).objectFit(ImageFit.Contain);
            } else if (item.itemId === 'stone') {
              Image($r('app.media.hotbar_stone')).width(48).height(48).objectFit(ImageFit.Contain);
            } else {
              Image($r('app.media.hotbar_driftwood')).width(48).height(48).objectFit(ImageFit.Contain);
            }
            Text(`${item.amount}`).fontSize(11).fontColor('#FFF1C7').padding(3).borderRadius(9).backgroundColor('#D7191814');
          }.width(54).height(54).translate({ x: item.x * 52, y: item.y * 52 });
        }, (item: GroundItemVisual) => item.id);

        if (this.villagers > 0) {
          Row().width(220).height(92).borderRadius(38).backgroundColor('#55684839').translate({ x: 142, y: -8 });
          Image($r('app.media.survivor')).width(68).height(136).objectFit(ImageFit.Contain).opacity(0.92).translate({ x: 88 + Math.sin(this.minute / 45) * 18, y: -22 });
          Image($r('app.media.survivor')).width(63).height(126).objectFit(ImageFit.Contain).opacity(0.82).translate({ x: 145 + Math.cos(this.minute / 52) * 16, y: -4 });
          Image($r('app.media.survivor')).width(70).height(132).objectFit(ImageFit.Contain).opacity(0.86).translate({ x: 190 + Math.sin(this.minute / 58) * 20, y: 24 });
          Text('潮生村').fontSize(12).fontColor('#FFF1C7').translate({ x: 142, y: 70 });
        }

        // Exploration fog is anchored to world coordinates, so camera panning cannot reveal it.
        Column().width(980).height(230).backgroundColor('#F2071718').translate({ y: -265 });
        Column().width(980).height(230).backgroundColor('#F2071718').translate({ y: 265 });
        Column().width(275).height(300).backgroundColor('#F2071718').translate({ x: -352 });
        Column().width(275).height(300).backgroundColor('#F2071718').translate({ x: 352 });
        Stack() {
          ForEach([0, 1, 2, 3, 4, 5, 6, 7, 8], (index: number) => {
            Column().width(78 + index % 3 * 9).height(54 + index % 4 * 6)
              .borderRadius({ topLeft: 18 + index % 3 * 5, topRight: 31 - index % 3 * 4, bottomLeft: 27 - index % 2 * 6, bottomRight: 20 + index % 2 * 7 })
              .backgroundColor('#F20A2322').translate({ x: index * 61 - 244, y: index % 3 * 7 - 8 });
          });
        }.width(560).height(82).translate({ y: -150 }).hitTestBehavior(HitTestMode.None);
        Stack() {
          ForEach([0, 1, 2, 3, 4, 5, 6, 7, 8], (index: number) => {
            Column().width(74 + index % 4 * 8).height(52 + index % 3 * 7)
              .borderRadius({ topLeft: 28 - index % 3 * 4, topRight: 18 + index % 2 * 7, bottomLeft: 20 + index % 3 * 5, bottomRight: 30 - index % 2 * 6 })
              .backgroundColor('#F20A2322').translate({ x: index * 61 - 244, y: index % 3 * 6 - 6 });
          });
        }.width(560).height(82).translate({ y: 150 }).hitTestBehavior(HitTestMode.None);
      }
        .width(980)
        .height(760)
        .scale({ x: this.zoom, y: this.zoom })
        .rotate({ angle: this.rotation })
        .translate({ x: this.offsetX, y: this.offsetY })
        .hitTestBehavior(HitTestMode.None);

      // The survivor stays at the camera focus. Panning moves the island, not the avatar.
      Image($r('app.media.survivor')).width(74).height(148).objectFit(ImageFit.Contain).translate({ x: 0, y: 12 }).hitTestBehavior(HitTestMode.None);

      if (this.weatherKind === 'rain' || this.weatherKind === 'storm') {
        Text('╱  ╱  ╱  ╱  ╱  ╱  ╱\n  ╱  ╱  ╱  ╱  ╱  ╱\n╱  ╱  ╱  ╱  ╱  ╱  ╱')
          .fontSize(30)
          .fontColor('#9EDAF0')
          .opacity(0.35 + this.weatherIntensity * 0.4)
          .width('100%')
          .height('100%');
      }
      if (this.weatherKind === 'snow' || this.weatherKind === 'blizzard') {
        Text('•   ·   •   ·   •   ·\n  ·   •   ·   •   ·\n•   ·   •   ·   •')
          .fontSize(36)
          .fontColor('#FFFFFF')
          .opacity(0.45 + this.weatherIntensity * 0.35)
          .width('100%')
          .height('100%');
      }

      if (this.nightOpacity() > 0) {
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor('#07122E')
          .opacity(this.nightOpacity())
          .hitTestBehavior(HitTestMode.None);
      }
    }
    .width('100%')
    .height('100%')
    .clip(true)
    .gesture(
      GestureGroup(GestureMode.Parallel,
        PanGesture({ fingers: 1 })
          .onActionStart(() => {
            this.lastOffsetX = this.offsetX;
            this.lastOffsetY = this.offsetY;
          })
          .onActionUpdate((event: GestureEvent) => {
            this.offsetX = this.lastOffsetX + event.offsetX;
            this.offsetY = this.lastOffsetY + event.offsetY;
          }),
        PinchGesture({ fingers: 2 })
          .onActionStart(() => {
            this.lastScale = this.zoom;
          })
          .onActionUpdate((event: GestureEvent) => {
            this.zoom = Math.max(0.35, Math.min(3, this.lastScale * event.scale));
          })
      )
    );
  }
}
