#!/usr/bin/env python3
"""国内版飞行棋：底图 + ArkTS 坐标表一体生成。

几何模型（画布 1080，格宽 60，边距 30）：
- 跑道 = 圆角方形环：每边直段 11 格 + 每角弧 2 格 = 52 格，顺时针
- 环中心线距边 60px；弧圆心 = (210,210)/(870,210)/(870,870)/(210,870)，半径 150
- 索引：顶 0..10（左→右）、右上弧 11..12、右 13..23（上→下）、右下弧 24..25、
  底 26..36（右→左）、左下弧 37..38、左 39..49（下→上）、左上弧 50..51
- 归航入口 = 各边正中格：红5/绿18/黄31/蓝44 → 起飞格 = 入口+2（红7/绿20/黄33/蓝46）
  → route[(p + player*13 + 7) % 52]，与现有 route[player*13] 结构兼容
- 跑道四色循环 [蓝,红,绿,黄]（使 5/18/31/44 号格自然落在本方色）
- 归航道 5 格从入口直插中央，终点 = 中央风车 (540,540)
- 四角机场 200x200 贴角，白色圆角内框 + 2x2 同色圆点
- 四条对角虚线（机场内角 → 中央），带白色小箭头
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

S = 1080          # 逻辑画布
OUT_PX = 1280     # 输出尺寸
W = 60            # 格宽
EDGE = 30         # 环外缘距边
CL = EDGE + W / 2  # 中心线距边 = 60

RED = (233, 75, 60)
GREEN = (34, 155, 84)
BLUE = (59, 125, 216)
YELLOW = (245, 166, 35)
WHITE = (250, 247, 240)
LINE = (110, 110, 108)
FRAME = (92, 58, 34)
CREAM = (243, 236, 222)

CYCLE = [BLUE, RED, GREEN, YELLOW]  # i%4 → 使 5/18/31/44 号格自然为本方色

CORNER = {"tl": (210, 210), "tr": (870, 210), "br": (870, 870), "bl": (210, 870)}
AIRPORT = {"tl": RED, "tr": GREEN, "br": YELLOW, "bl": BLUE}


def route_points() -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(11):                      # 顶 0..10
        pts.append((240 + 60 * i, CL))
    for k in range(2):                       # 右上弧 11..12（-67.5°,-22.5°）
        a = math.radians(-90 + 45 * (k + 0.5))
        cx, cy = CORNER["tr"]
        pts.append((cx + 150 * math.cos(a), cy + 150 * math.sin(a)))
    for i in range(11):                      # 右 13..23
        pts.append((S - CL, 240 + 60 * i))
    for k in range(2):                       # 右下弧 24..25（22.5°,67.5°）
        a = math.radians(90 - 45 * (k + 0.5))
        cx, cy = CORNER["br"]
        pts.append((cx + 150 * math.cos(a), cy + 150 * math.sin(a)))
    for i in range(11):                      # 底 26..36
        pts.append((840 - 60 * i, S - CL))
    for k in range(2):                       # 左下弧 37..38（112.5°,157.5°）
        a = math.radians(90 + 45 * (k + 0.5))
        cx, cy = CORNER["bl"]
        pts.append((cx + 150 * math.cos(a), cy + 150 * math.sin(a)))
    for i in range(11):                      # 左 39..49
        pts.append((CL, 840 - 60 * i))
    for k in range(2):                       # 左上弧 50..51（202.5°,247.5°）
        a = math.radians(180 + 45 * (k + 0.5))
        cx, cy = CORNER["tl"]
        pts.append((cx + 150 * math.cos(a), cy + 150 * math.sin(a)))
    return pts


ROUTE = route_points()
OFFSETS = [7, 20, 33, 46]                    # 红/绿/黄/蓝 起飞格索引
HOME_PATH = [                                 # p51..55：入口向中央 5 格
    [(540, 120), (540, 180), (540, 240), (540, 300), (540, 360)],   # 红（顶入）
    [(960, 540), (900, 540), (840, 540), (780, 540), (720, 540)],   # 绿（右入）
    [(540, 960), (540, 900), (540, 840), (540, 780), (540, 720)],   # 黄（底入）
    [(120, 540), (180, 540), (240, 540), (300, 540), (360, 540)],   # 蓝（左入）
]
HOME_COLOR = [RED, GREEN, YELLOW, BLUE]
CENTRE = (540, 540)
BASE = [(140, 140), (940, 140), (940, 940), (140, 940)]  # 机场中心（棋子待机位）
DASH = [((240, 240), RED), ((840, 240), GREEN), ((840, 840), YELLOW), ((240, 840), BLUE)]


def cell_color(idx: int) -> tuple[int, int, int]:
    return CYCLE[idx % 4]


def draw_straight_cell(draw: ImageDraw.Draw, cx: float, cy: float, color) -> None:
    draw.rectangle((cx - 30, cy - 30, cx + 30, cy + 30), fill=color, outline=LINE, width=3)


def draw_arc_cell(draw: ImageDraw.Draw, cx: float, cy: float, corner: str, color) -> None:
    """弧格：以角圆心为参照的扇环段。"""
    ccx, ccy = CORNER[corner]
    a_center = math.atan2(cy - ccy, cx - ccx)
    span = math.radians(45)
    r_in, r_out = 120, 180
    p = draw.polygon
    pts = []
    steps = 8
    for i in range(steps + 1):
        a = a_center - span / 2 + span * i / steps
        pts.append((ccx + r_out * math.cos(a), ccy + r_out * math.sin(a)))
    for i in range(steps, -1, -1):
        a = a_center - span / 2 + span * i / steps
        pts.append((ccx + r_in * math.cos(a), ccy + r_in * math.sin(a)))
    p(pts, fill=color, outline=LINE)


def arc_corner(idx: int) -> str:
    return {11: "tr", 12: "tr", 24: "br", 25: "br", 37: "bl", 38: "bl", 50: "tl", 51: "tl"}[idx]


def render(out: Path) -> None:
    scale = OUT_PX / S
    image = Image.new("RGB", (OUT_PX, OUT_PX), CREAM)
    draw = ImageDraw.Draw(image)

    def px(v: float) -> float:
        return v * scale

    # 外框
    draw.rounded_rectangle((8 * scale, 8 * scale, OUT_PX - 8 * scale, OUT_PX - 8 * scale),
                           radius=26 * scale, outline=FRAME, width=16 * scale)

    # 中央风车（先画，归航条压在下面一格）
    a = (px(390), px(390))
    b = (px(690), px(390))
    c = (px(690), px(690))
    d = (px(390), px(690))
    m = (px(540), px(540))
    draw.polygon([a, b, m], fill=RED)      # 上红
    draw.polygon([b, c, m], fill=GREEN)    # 右绿
    draw.polygon([c, d, m], fill=YELLOW)   # 下黄
    draw.polygon([d, a, m], fill=BLUE)     # 左蓝
    for p1, p2 in ((a, m), (b, m), (c, m), (d, m)):
        draw.line((p1, p2), fill=(255, 255, 255), width=3 * scale)
    dot_r = 9 * scale
    for pt, col in ((a, BLUE), (b, RED), (c, GREEN), (d, YELLOW)):
        draw.ellipse((pt[0] - dot_r, pt[1] - dot_r, pt[0] + dot_r, pt[1] + dot_r), fill=col)

    # 跑道 52 格
    for i, (cx, cy) in enumerate(ROUTE):
        col = cell_color(i)
        if i in OFFSETS:                     # 起飞格强制本方色
            col = HOME_COLOR[OFFSETS.index(i)]
        if i in (11, 12, 24, 25, 37, 38, 50, 51):
            draw_arc_cell(draw, cx, cy, arc_corner(i), col)
        else:
            draw_straight_cell(draw, px(cx), px(cy), col)

    # 起飞箭头（白色，指向顺时针前进方向）
    arrows = [(OFFSETS[0], "right"), (OFFSETS[1], "down"), (OFFSETS[2], "left"), (OFFSETS[3], "up")]
    for idx, direction in arrows:
        cx, cy = ROUTE[idx]
        cx, cy = px(cx), px(cy)
        s_, tip, shaft = px(22), px(24), px(9)
        if direction == "right":
            draw.rectangle((cx - tip, cy - shaft, cx + tip - s_, cy + shaft), fill=(255, 255, 255))
            draw.polygon([(cx + tip - s_, cy - s_), (cx + tip - s_, cy + s_), (cx + tip, cy)],
                         fill=(255, 255, 255))
        elif direction == "left":
            draw.rectangle((cx - tip + s_, cy - shaft, cx + tip, cy + shaft), fill=(255, 255, 255))
            draw.polygon([(cx - tip + s_, cy - s_), (cx - tip + s_, cy + s_), (cx - tip, cy)],
                         fill=(255, 255, 255))
        elif direction == "down":
            draw.rectangle((cx - shaft, cy - tip, cx + shaft, cy + tip - s_), fill=(255, 255, 255))
            draw.polygon([(cx - s_, cy + tip - s_), (cx + s_, cy + tip - s_), (cx, cy + tip)],
                         fill=(255, 255, 255))
        else:
            draw.rectangle((cx - shaft, cy - tip + s_, cx + shaft, cy + tip), fill=(255, 255, 255))
            draw.polygon([(cx - s_, cy - tip + s_), (cx + s_, cy - tip + s_), (cx, cy - tip)],
                         fill=(255, 255, 255))

    # 归航条 5 格 x4
    for player, path in enumerate(HOME_PATH):
        for (cx, cy) in path:
            draw_straight_cell(draw, px(cx), px(cy), HOME_COLOR[player])

    # 对角虚线 + 白色小箭头
    for (start, color) in DASH:
        ex = 540 + (540 - start[0]) * 0.24
        ey = 540 + (540 - start[1]) * 0.24
        draw.line((px(start[0]), px(start[1]), px(ex), px(ey)), fill=color, width=7 * scale)
        # 虚线感：叠 CREAM 短线
        seg = 10
        for k in range(1, seg, 2):
            t0, t1 = k / seg, (k + 0.55) / seg
            x0 = start[0] + (ex - start[0]) * t0
            y0 = start[1] + (ey - start[1]) * t0
            x1 = start[0] + (ex - start[0]) * t1
            y1 = start[1] + (ey - start[1]) * t1
            draw.line((px(x0), px(y0), px(x1), px(y1)), fill=CREAM, width=7 * scale)
        # 指向中央的小箭头
        ax, ay = px(540 + (start[0] - 540) * 0.32), px(540 + (start[1] - 540) * 0.32)
        dx, dy = 540 - start[0], 540 - start[1]
        n = math.hypot(dx, dy)
        ux, uy = dx / n, dy / n
        s_ = px(16)
        tipx, tipy = ax + ux * s_ * 1.6, ay + uy * s_ * 1.6
        left = (tipx - ux * s_ * 1.6 - uy * s_ * 0.8, tipy - uy * s_ * 1.6 + ux * s_ * 0.8)
        right = (tipx - ux * s_ * 1.6 + uy * s_ * 0.8, tipy - uy * s_ * 1.6 - ux * s_ * 0.8)
        draw.polygon([(tipx, tipy), left, right], fill=color)

    # 四角机场
    for key, color in AIRPORT.items():
        x0, y0 = (40, 40) if key == "tl" else (840, 40) if key == "tr" else \
                 (840, 840) if key == "br" else (40, 840)
        block = (px(x0), px(y0), px(x0 + 200), px(y0 + 200))
        draw.rounded_rectangle(block, radius=18 * scale, fill=color)
        inset = 26 * scale
        inner = (block[0] + inset, block[1] + inset, block[2] - inset, block[3] - inset)
        draw.rounded_rectangle(inner, radius=12 * scale, fill=(255, 255, 255))
        cw = (inner[2] - inner[0]) / 2
        ch = (inner[3] - inner[1]) / 2
        r = min(cw, ch) * 0.26
        for ix in (0, 1):
            for iy in (0, 1):
                cx = inner[0] + cw * (ix + 0.5)
                cy = inner[1] + ch * (iy + 0.5)
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)

    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, optimize=True)
    print(f"[ok] {out}")


def ts_constants() -> str:
    def pct(v: float) -> str:
        return str(round(v / S * 100, 2))

    rx = ", ".join(pct(x) for x, _ in ROUTE)
    ry = ", ".join(pct(y) for _, y in ROUTE)
    lines = ["// 国内版飞行棋坐标（百分比），由 scripts/ludo_cn_board.py 生成",
             "  readonly ludoRouteX: number[] = [" + rx + "]",
             "  readonly ludoRouteY: number[] = [" + ry + "]"]
    for dim, label in ((0, "X"), (1, "Y")):
        rows = []
        for path in HOME_PATH:
            rows.append("[" + ", ".join(pct(p[dim]) for p in path) + "]")
        lines.append(f"  readonly ludoHome{label}: number[][] = [" + ", ".join(rows) + "]")
    bx = ", ".join(pct(x) for x, _ in BASE)
    by = ", ".join(pct(y) for _, y in BASE)
    lines.append("  readonly ludoBaseX: number[] = [" + bx + "]")
    lines.append("  readonly ludoBaseY: number[] = [" + by + "]")
    return "\n".join(lines)


def main() -> None:
    out_dir = Path("/Users/ljg/Desktop/开发者/TRAE/.workbuddy/tmp/boards_out")
    render(out_dir / "ludo_board.png")
    ts = ts_constants()
    (out_dir / "ludo_ts_constants.txt").write_text(ts + "\n")
    print(ts[:600])
    print("...（完整见 ludo_ts_constants.txt）")


if __name__ == "__main__":
    main()
