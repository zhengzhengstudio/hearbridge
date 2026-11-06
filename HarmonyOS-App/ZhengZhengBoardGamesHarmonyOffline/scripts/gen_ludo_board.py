#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「中国标准飞行棋」经典棋盘底图与坐标（唯一真源）。

背景（2026-10-22 修复）：
  历史上「底图」和「坐标表」是两套东西各改各的 —— 底图是照片畸变版，
  坐标表是另一套内缩几何，还把黄/绿两个机库放错了角。
  结果：鸿蒙 / Android / Windows 三端棋盘长得都不一样。
  现在改为**同一个脚本同时产出底图和坐标**，坐标按百分比写死，
  三端（鸿蒙在线 / 鸿蒙离线 / Android）共用同一张 PNG + 同一张坐标表。

拓扑（标准 15×15 Ludo 几何，cell 记作 [row, col]，row/col 均 0..14）：
  * 主跑道 52 格闭环（正交相邻，四个内角为对角过渡 —— 标准 Ludo 画法）：
    (6,1..5)→(5..0,6)→(0,7)→(0..5,8)→(6,9..14)→(7,14)→(8,14..9)
    →(9..14,8)→(14,7)→(14..9,6)→(8,5..0)→(7,0)→(6,0)→回(6,1)
  * 跑道颜色四色循环 红黄蓝绿：color[i] = PLAYER[i%4]。
  * 起飞点 start = 0/13/26/39（13 ≡ 1 (mod 4)，故各起飞格自动是本方色）。
  * 归航通道 5 格：红(7,1..5) 黄(1..5,7) 蓝(7,9..13) 绿(9..13,7)，中心为终点。
  * 四角机库：红左上 / 黄右上 / 蓝右下 / 绿左下（与参考图同色序）。
  * 相对步数模型：0..50 主跑道 / 51..55 归航通道 / 56 中心终点。

产物：
  ludo_board.png   800×800 底图（与坐标 1:1）
  coords.json      坐标表（百分比）
  coords.ts.txt    ArkTS 直接粘贴用
  ludo_board.html  人眼预览
并把底图复制到：鸿蒙离线 media、鸿蒙在线 media、Android drawable-nodpi。
"""

import json
import math
import os
import shutil
import sys

from PIL import Image, ImageDraw

# ---------------------------------------------------------------- 画布与网格
SIZE = 800
MARGIN = 18
CS = (SIZE - 2 * MARGIN) / 15.0
GRID = 15

PLAYER_COLOR = ['#E94B3C', '#F5A623', '#3B7DD8', '#229B54']   # 红 黄 蓝 绿
PLAYER_RGB = [(233, 75, 60), (245, 166, 35), (59, 125, 216), (34, 155, 84)]
PLAYER_NAME = ['红', '黄', '蓝', '绿']
START = [0, 13, 26, 39]

CREAM = (244, 237, 221)
BORDER = (90, 60, 40)
WHITE = (255, 255, 255)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(OUT_DIR)                      # 离线版工程根
HARMONY = os.path.dirname(PROJ)                      # HarmonyOS-App
TRAE = os.path.dirname(HARMONY)                      # 仓库根
OFFLINE_MEDIA = os.path.join(PROJ, 'entry/src/main/resources/base/media')
ONLINE_MEDIA = os.path.join(HARMONY, 'ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media')
ANDROID_RES = os.path.join(TRAE, 'MultipleBoardGamesAndroid/app/src/main/res/drawable-nodpi')


# ---------------------------------------------------------------- 几何
def route_cells():
    """52 格主跑道（[row, col]），下标即 abs 序号。"""
    cells = []
    for c in range(1, 6):
        cells.append((6, c))          # abs 0..4   上臂左列
    for r in range(5, -1, -1):
        cells.append((r, 6))          # abs 5..10  左臂上排
    cells.append((0, 7))              # abs 11     顶部中列
    for r in range(0, 6):
        cells.append((r, 8))          # abs 12..17 左臂下排
    for c in range(9, 15):
        cells.append((6, c))          # abs 18..23 下臂左列
    cells.append((7, 14))             # abs 24     右侧中列
    for c in range(14, 8, -1):
        cells.append((8, c))          # abs 25..30 下臂右列
    for r in range(9, 15):
        cells.append((r, 8))          # abs 31..36 右臂下排
    cells.append((14, 7))             # abs 37     底部中列
    for r in range(14, 8, -1):
        cells.append((r, 6))          # abs 38..43 右臂上排
    for c in range(5, -1, -1):
        cells.append((8, c))          # abs 44..49 上臂右列
    cells.append((7, 0))              # abs 50     左侧中列
    cells.append((6, 0))              # abs 51     闭环
    assert len(cells) == 52, len(cells)
    return cells


ROUTE = route_cells()

# 归航通道（[row, col]）：红左 / 黄上 / 蓝右 / 绿下
HOME_CELLS = [
    [(7, c) for c in range(1, 6)],       # 0 红：从 (7,1) 向右进中心
    [(r, 7) for r in range(1, 6)],       # 1 黄：从 (1,7) 向下进中心
    [(7, c) for c in range(13, 8, -1)],  # 2 蓝：从 (7,13) 向左进中心
    [(r, 7) for r in range(13, 8, -1)],  # 3 绿：从 (13,7) 向上进中心
]

# 四角机库 6×6 区域起点（[row, col]）：0 左上 / 1 右上 / 2 右下 / 3 左下
YARD = [(0, 0), (0, 9), (9, 9), (9, 0)]

# 中央风车四象限 → 玩家（上黄 / 右蓝 / 下绿 / 左红）
WIND = {'top': 1, 'right': 2, 'bottom': 3, 'left': 0}


def cell_center(rc):
    """[row, col] -> 像素中心 (x, y)。"""
    return (MARGIN + (rc[1] + 0.5) * CS, MARGIN + (rc[0] + 0.5) * CS)


def cell_rect(rc, inset=0.06):
    r, c = rc
    return [
        MARGIN + c * CS + CS * inset,
        MARGIN + r * CS + CS * inset,
        MARGIN + (c + 1) * CS - CS * inset,
        MARGIN + (r + 1) * CS - CS * inset,
    ]


def pct(v):
    return round(v / SIZE * 100.0, 2)


# ---------------------------------------------------------------- 渲染
def render_board():
    img = Image.new('RGB', (SIZE, SIZE), CREAM)
    d = ImageDraw.Draw(img)

    # 外框
    d.rounded_rectangle([4, 4, SIZE - 4, SIZE - 4], radius=22, outline=BORDER, width=8)

    # ---- 中央风车（3×3）----
    cx0, cy0 = MARGIN + 6 * CS, MARGIN + 6 * CS
    cx1, cy1 = MARGIN + 9 * CS, MARGIN + 9 * CS
    cc = ((cx0 + cx1) / 2, (cy0 + cy1) / 2)
    tris = {
        'top': [(cx0, cy0), (cx1, cy0), cc],
        'right': [(cx1, cy0), (cx1, cy1), cc],
        'bottom': [(cx1, cy1), (cx0, cy1), cc],
        'left': [(cx0, cy1), (cx0, cy0), cc],
    }
    for k, pts in tris.items():
        d.polygon(pts, fill=PLAYER_RGB[WIND[k]], outline=WHITE)
    d.line([cx0, cc[1], cx1, cc[1]], fill=WHITE, width=2)
    d.line([cc[0], cy0, cc[0], cy1], fill=WHITE, width=2)
    fr = CS * 0.9
    d.ellipse([cc[0] - fr, cc[1] - fr, cc[0] + fr, cc[1] + fr], fill=WHITE, outline=BORDER, width=3)

    # ---- 归航通道（各 5 格，本方色）----
    for p, lane in enumerate(HOME_CELLS):
        for cell in lane:
            d.rounded_rectangle(cell_rect(cell), radius=CS * 0.18, fill=PLAYER_RGB[p],
                                outline=WHITE, width=3)

    # ---- 主跑道 52 格（四色循环）----
    for i, cell in enumerate(ROUTE):
        d.rounded_rectangle(cell_rect(cell), radius=CS * 0.18, fill=PLAYER_RGB[i % 4],
                            outline=WHITE, width=3)

    # ---- 起飞格白色方向箭头 ----
    for off in START:
        c1, c2 = ROUTE[off], ROUTE[(off + 1) % 52]
        x, y = cell_center(c1)
        xn, yn = cell_center(c2)
        ang = math.atan2(yn - y, xn - x)
        L, w = CS * 0.62, CS * 0.34
        ca, sa = math.cos(ang), math.sin(ang)
        pts = [(-L / 2, -w / 2), (L / 2 - w * 0.4, -w / 2), (L / 2 - w * 0.4, -w * 0.85),
               (L / 2, 0), (L / 2 - w * 0.4, w * 0.85), (L / 2 - w * 0.4, w / 2), (-L / 2, w / 2)]
        d.polygon([(x + px * ca - py * sa, y + px * sa + py * ca) for (px, py) in pts], fill=WHITE)

    # ---- 四角机库（本色大块 + 白色内框 + 2×2 停机圆点）----
    for p in range(4):
        r0, c0 = YARD[p]
        bx0, by0 = MARGIN + c0 * CS, MARGIN + r0 * CS
        bx1, by1 = bx0 + 6 * CS, by0 + 6 * CS
        d.rounded_rectangle([bx0, by0, bx1, by1], radius=CS * 0.5, fill=PLAYER_RGB[p],
                            outline=WHITE, width=4)
        fi = CS * 0.55
        d.rounded_rectangle([bx0 + fi, by0 + fi, bx1 - fi, by1 - fi], radius=CS * 0.35, fill=WHITE)
        rad = CS * 0.55
        for dr, dc in [(1.5, 1.5), (1.5, 3.5), (3.5, 1.5), (3.5, 3.5)]:
            cx = MARGIN + (c0 + dc + 0.5) * CS
            cy = MARGIN + (r0 + dr + 0.5) * CS
            d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=PLAYER_RGB[p])

    # ---- 机库 → 中央 对角虚线 ----
    for p in range(4):
        r0, c0 = YARD[p]
        sx, sy = cell_center((r0 + 2, c0 + 2))
        ex = cc[0] + (sx - cc[0]) * 0.25
        ey = cc[1] + (sy - cc[1]) * 0.25
        dash, dist = CS * 0.32, math.hypot(ex - sx, ey - sy)
        steps = max(1, int(dist / dash))
        for s in range(steps):
            t0, t1 = s / steps, (s + 0.55) / steps
            d.line([sx + (ex - sx) * t0, sy + (ey - sy) * t0,
                    sx + (ex - sx) * t1, sy + (ey - sy) * t1], fill=PLAYER_RGB[p], width=4)
    return img


# ---------------------------------------------------------------- 坐标表
def build_coords():
    route_xy = [cell_center(c) for c in ROUTE]
    home_xy = [[cell_center(c) for c in lane] for lane in HOME_CELLS]
    # 终点：中央四色错开，各偏向自己机库来向（避免 4 架飞机叠在同一点）
    cc = (MARGIN + 7.5 * CS, MARGIN + 7.5 * CS)
    finish_xy = []
    for p in range(4):
        r0, c0 = YARD[p]
        sx, sy = cell_center((r0 + 2, c0 + 2))
        finish_xy.append((cc[0] + (sx - cc[0]) * 0.06, cc[1] + (sy - cc[1]) * 0.06))
    # 机位：各机库 2×2 圆点中心
    base_xy = []
    for p in range(4):
        r0, c0 = YARD[p]
        for dr, dc in [(1.5, 1.5), (1.5, 3.5), (3.5, 1.5), (3.5, 3.5)]:
            base_xy.append(cell_center((r0 + dr, c0 + dc)))
    return {
        'routeX': [pct(x) for x, _ in route_xy],
        'routeY': [pct(y) for _, y in route_xy],
        'routeColor': [PLAYER_COLOR[i % 4] for i in range(52)],
        'start': START,
        'homeX': [[pct(x) for x, _ in lane] for lane in home_xy],
        'homeY': [[pct(y) for _, y in lane] for lane in home_xy],
        'finishX': [pct(x) for x, _ in finish_xy],
        'finishY': [pct(y) for _, y in finish_xy],
        'baseX': [pct(x) for x, _ in base_xy],
        'baseY': [pct(y) for _, y in base_xy],
    }


def emit_ts(coords):
    out = []
    out.append('  private readonly ludoRouteX: number[] = [%s]' % ', '.join(str(v) for v in coords['routeX']))
    out.append('  private readonly ludoRouteY: number[] = [%s]' % ', '.join(str(v) for v in coords['routeY']))
    cols = ', '.join("'%s'" % c for c in coords['routeColor'])
    out.append('  private readonly ludoRouteColor: string[] = [%s]' % cols)
    homex = ', '.join('[%s]' % ', '.join(str(v) for v in row) for row in coords['homeX'])
    homey = ', '.join('[%s]' % ', '.join(str(v) for v in row) for row in coords['homeY'])
    out.append('  private readonly ludoHomeX: number[][] = [%s]' % homex)
    out.append('  private readonly ludoHomeY: number[][] = [%s]' % homey)
    out.append('  private readonly ludoStartOffset: number[] = [0, 13, 26, 39]')
    out.append('  private readonly ludoBaseX: number[] = [%s]' % ', '.join(str(v) for v in coords['baseX']))
    out.append('  private readonly ludoBaseY: number[] = [%s]' % ', '.join(str(v) for v in coords['baseY']))
    out.append('  private readonly ludoFinishX: number[] = [%s]' % ', '.join(str(v) for v in coords['finishX']))
    out.append('  private readonly ludoFinishY: number[] = [%s]' % ', '.join(str(v) for v in coords['finishY']))
    return '\n'.join(out)


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
 body{margin:0;background:#2B2F3A;display:flex;gap:24px;padding:24px;
      font-family:"PingFang SC","Heiti SC",sans-serif;color:#F2F4F8}
 img{width:640px;height:640px;border-radius:12px}
 pre{font-size:12px;line-height:1.5;background:#1A1D24;padding:16px;border-radius:10px;
     max-height:640px;overflow:auto}
 h1{font-size:18px;margin:0 0 8px}
</style></head><body>
<div><h1>中国标准飞行棋 · 经典棋盘（%dx%d 唯一真源）</h1>
<img src="ludo_board.png"></div>
<pre>%s</pre>
</body></html>
"""


def main():
    coords = build_coords()

    png = os.path.join(OUT_DIR, 'ludo_board.png')
    img = render_board()
    img.save(png)
    print('png :', png, os.path.getsize(png), 'bytes')

    json.dump(coords, open(os.path.join(OUT_DIR, 'coords.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    ts = emit_ts(coords)
    open(os.path.join(OUT_DIR, 'coords.ts.txt'), 'w', encoding='utf-8').write(ts + '\n')
    open(os.path.join(OUT_DIR, 'ludo_board.html'), 'w', encoding='utf-8').write(
        HTML_TEMPLATE % (SIZE, SIZE, ts))

    # 部署到底图目录（在线版由 sync_board_artworks.sh 同步；Android 此前没同步，
    # 才会装到一张弧形错误图 —— 这里补上）
    targets = [
        os.path.join(OFFLINE_MEDIA, 'ludo_board.png'),
        os.path.join(ONLINE_MEDIA, 'ludo_board.png'),
        os.path.join(ANDROID_RES, 'ludo_board.png'),
    ]
    for t in targets:
        if not os.path.isdir(os.path.dirname(t)):
            print('  ⚠️  目录不存在，跳过:', os.path.dirname(t))
            continue
        shutil.copyfile(png, t)
        print('  ✅ 已部署:', t)

    print()
    print(ts)


if __name__ == '__main__':
    main()
