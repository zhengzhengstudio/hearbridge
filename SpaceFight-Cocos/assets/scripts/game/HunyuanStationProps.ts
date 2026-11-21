import { instantiate, Node, Prefab, resources, Vec3 } from 'cc';
import { STATION_WALK_TERMINALS } from '../core/StationWalkSystem';

/**
 * 3D 混元精细建模增强层（2026-11-20）。
 *
 * 设计原则：不删除原有程序化几何体——它们是 fallback。这里异步加载 5 个
 * GLB Prefab，加载成功后实例化到 InteriorDetail 对应锚点，按各模型真实包围盒
 * 动态归一化尺寸/朝向；成功摆放后隐藏对应的程序化节点，加载失败则原样保留。
 *
 * 所有摆放参数集中在 PROPS 表，便于按真机截图微调，无需改动 WorldStreamer 主体。
 */

type Placement = {
  /** resources 下的 prefab 路径 */
  prefab: string;
  /** 最终缩放（GLB 原始尺寸约 1 单位，直接放大到舱内世界尺度） */
  finalScale: number;
  /** 模型欧拉角修正（混元各模型轴向不统一），绕 X/Y/Z */
  euler: readonly [number, number, number];
};

// 坐标参考：站内可行走区 x∈[-3.4,3.4]，z∈[-3.2,4.2]，地板 y≈-2，天花板 y≈2。
// 终端台原始高 1.0，放大到约 1.15 世界高；其余按预览比例与轴向换算。
const TERMINAL_PROP: Placement = {
  prefab: 'models/hunyuan/terminal_console/terminal_console',
  finalScale: 1.15,
  euler: [0, 0, 0],
};

const PROPS: readonly Placement[] = [
  TERMINAL_PROP, // 终端台 ×4（contracts/trade/facilities/refit）
  {
    prefab: 'models/hunyuan/mechanic_robot/mechanic_robot',
    // 原始躺倒：Z=1.118 是站立高度方向，scale 1.4 → 约 1.6 高
    finalScale: 1.4,
    euler: [-90, 0, 0],
  },
  {
    prefab: 'models/hunyuan/cargo_crates/cargo_crates',
    // 原始 Z=0.933 是堆叠高度方向
    finalScale: 1.15,
    euler: [-90, 0, 0],
  },
  {
    prefab: 'models/hunyuan/hangar_gate/hangar_gate',
    // 原始 Z=0.753 立起后是高度。缩到 scale 1.3（约 1 米高），避免糊在第三人称相机前。
    finalScale: 1.3,
    euler: [-90, 0, 0],
  },
  {
    prefab: 'models/hunyuan/space_fighter/space_fighter',
    finalScale: 1.1,
    euler: [0, 0, 0],
  },
];

type LoadedProp = { placement: Placement; prefab: Prefab };

export class HunyuanStationProps {
  private readonly loaded = new Map<string, Prefab>();
  private applied = false;
  private disabled = false;

  /** ?hy=0 调试：完全禁用混元增强（保留原程序化建模）。 */
  public setDisabled(value: boolean): void {
    this.disabled = value;
  }

  /** 串行加载全部 prefab（Cocos resources 对并发 GLB 场景 prefab 支持不稳），失败跳过。 */
  public load(onDone?: () => void): void {
    if (this.disabled) return;
    const paths = PROPS.map((p) => p.prefab).filter((p, i, a) => a.indexOf(p) === i);
    let index = 0;
    const next = (): void => {
      if (index >= paths.length) {
        onDone?.();
        return;
      }
      const path = paths[index];
      index += 1;
      resources.load(path, Prefab, (error: Error | null, prefab: Prefab | null) => {
        if (error || !prefab) {
          console.warn('[SpaceFight] hunyuan prefab load failed:', path, JSON.stringify(error));
        } else {
          this.loaded.set(path, prefab);
          console.info('[SpaceFight] hunyuan prefab loaded:', path);
        }
        next();
      });
    };
    next();
  }

  /**
   * 把已加载的模型摆到 detail 节点下，并隐藏被替代的程序化节点。
   * @param detail InteriorDetail 节点（坐标与 StationWalkSystem 一致）
   */
  public apply(detail: Node): void {
    if (this.applied || !detail || !detail.isValid) return;
    // 至少要有一个 prefab 加载成功才应用，避免「加载未完成 → 空 apply → 永久跳过」的竞态。
    if (this.loaded.size === 0) return;
    this.applied = true;

    // 终端台：4 个可交互终端（undock 用机库门表现，跳过）
    for (const terminal of STATION_WALK_TERMINALS) {
      if (terminal.id === 'undock') continue;
      this.place(detail, TERMINAL_PROP, new Vec3(terminal.x, -1.25, terminal.z), `HY.Terminal.${terminal.id}`);
      // 隐藏该终端的程序化底座/屏幕/光柱/光圈
      this.hide(detail, `TerminalBase.${terminal.id}`);
      this.hide(detail, `TerminalScreen.${terminal.id}`);
      this.hide(detail, `TerminalHolo.${terminal.id}`);
      this.hide(detail, `TerminalRing.${terminal.id}`);
    }

    // 机务 R-7 机器人
    const robot = PROPS[1];
    this.place(detail, robot, new Vec3(0, -1.1, -1.1), 'HY.MechanicR7');
    this.hide(detail, 'MechanicR7.Torso');
    this.hide(detail, 'MechanicR7.Head');
    this.hide(detail, 'MechanicR7.Visor');

    // 货箱 ×6：两侧各 3 个，替代程序化 CargoCrate
    const crates = PROPS[2];
    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const x = side * 2.75;
        const z = -2.45 + index * 1.3;
        this.place(detail, crates, new Vec3(x, -1.35, z), `HY.Cargo.${side}.${index}`);
        this.hide(detail, `CargoCrate.${side < 0 ? 'Port' : 'Starboard'}.${index + 1}`);
      }
    }

    // 机库气闸门：放在右后方侧壁 x=3.0/z=3.6，缩小后作为离港出口装饰，绝不挡相机中轴。
    const gate = PROPS[3];
    this.place(detail, gate, new Vec3(3.0, -0.5, 3.6), 'HY.HangarGate', [-90, -28, 0]);
    this.hide(detail, 'HangarGate.Left');
    this.hide(detail, 'HangarGate.Right');
    this.hide(detail, 'HangarGate.Header');

    // 玩家战斗机：悬停在舱内中后段上空，作为「船能开进站」的视觉主体。
    const fighter = PROPS[4];
    this.place(detail, fighter, new Vec3(1.6, 0.15, -2.2), 'HY.PlayerFighter', [0, 155, -8]);

    console.log(`[SpaceFight] hunyuan props applied: ${this.countPlaced(detail)} meshes, hidden ${this.hiddenCount} proc nodes, detailActive=${detail.active}, detailChildren=${detail.children.length}`);
  }

  private countPlaced(detail: Node): number {
    return detail.children.filter((c: Node) => c.name.startsWith('HY.')).length;
  }

  private hiddenCount = 0;
  private hide(parent: Node, name: string): void {
    const node = parent.getChildByName(name);
    if (node) {
      node.active = false;
      this.hiddenCount += 1;
    } else {
      console.warn('[SpaceFight] hunyuan hide miss:', name);
    }
  }

  private place(
    parent: Node,
    spec: Placement,
    anchor: Vec3,
    name: string,
    overrideEuler?: readonly [number, number, number],
  ): void {
    const prefab = this.loaded.get(spec.prefab);
    if (!prefab) return; // 没加载成功 → 程序化节点保持可见（fallback）

    const wrapper = new Node(name);
    wrapper.setParent(parent);
    wrapper.setPosition(anchor);
    const euler = overrideEuler ?? spec.euler;
    wrapper.setRotationFromEuler(euler[0], euler[1], euler[2]);

    const model = instantiate(prefab);
    model.name = `${name}.Model`;
    model.setParent(wrapper);

    const scale = spec.finalScale;
    model.setScale(scale, scale, scale);
    // 混元模型几何中心基本在原点，Z 方向有轻微偏移；旋转后补偿一点，避免整体沉入地板。
    model.setPosition(0, 0, 0);
  }
}
