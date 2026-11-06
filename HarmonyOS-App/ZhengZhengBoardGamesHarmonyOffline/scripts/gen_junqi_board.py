#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「陆战棋（军棋）」棋盘底图与配套坐标（中国标准两人陆战棋样式）。

棋盘：5 列 × 12 行共 60 个落点，index = row * 5 + col。
  * 上方 6 行（0-5）为蓝方，下方 6 行（6-11）为红方。
  * 每方：大本营 2（(0,1)(0,3) / (11,1)(11,3)）、行营 5、兵站 23。
  * 山界：第 5/6 行之间留 GAP 通道带，只在左(col0)右(col4)架铁路桥 + 中(col2)公路。

铁路（标准「口」字环，工兵沿铁路任意走，与 Index.ets junqiIsRail 严格同源）：
  * 横向：每方「首排 + 前线排」两道 —— 蓝方 row0 / row5，红方 row6 / row11；
  * 纵向：两侧 col0 / col4 全程贯通（首尾排之间都能走）；
  * 两方之间仅通过 col0 / col4 的 row5—row6 竖向段相连（山界铁路桥）；
  这样铁路是一圈圈清晰的矩形环，而不是中央四排全互连的密网。

行营 8 向斜线公路；其余公路为正交一步。

产物：junqi_board.html、junqi_board.png、coords_junqi.json / coords_junqi.ts.txt
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from board_render_util import flatten_to_png, render_with_chrome  # noqa: E402

COLS, ROWS = 5, 12
STEP = 100
GAP = 78          # 山界通道带高度
MARGIN = 60
W = MARGIN * 2 + (COLS - 1) * STEP                 # 520
H = MARGIN * 2 + (ROWS - 1) * STEP + GAP           # 1298

BASE = [1, 3, 56, 58]                    # (0,1)(0,3)(11,1)(11,3)
CAMP = [5, 7, 9, 16, 18, 41, 43, 50, 52, 54]

# 「口」字环：横向铁路行（蓝方首排+前线排，红方前线排+首排）
RAIL_ROWS = (0, 5, 6, 11)
RAIL_ROWS_SET = set(RAIL_ROWS)
RAIL_COLS = (0, 4)                       # 两侧纵向铁路全程（含山界铁路桥）
MIDDLE_COL = 2                           # 山界中路公路

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def cell_y(row: int) -> int:
    return MARGIN + row * STEP + (GAP if row >= 6 else 0)


def cell_xy(index: int):
    row, col = divmod(index, COLS)
    return (MARGIN + col * STEP, cell_y(row))


XY = [cell_xy(i) for i in range(COLS * ROWS)]


def is_rail(a: int, b: int) -> bool:
    """与 Index.ets junqiIsRail 严格同源。"""
    ra, ca = divmod(a, COLS)
    rb, cb = divmod(b, COLS)
    if ra == rb:
        # 同一横排：只有首排 / 前线排是铁路
        return ra in RAIL_ROWS_SET
    if abs(ra - rb) != 1 or ca != cb:
        return False
    # 竖向：两侧 col0/col4 全程贯通（含 row5—row6 的山界铁路桥）
    return ca in RAIL_COLS


def has_link(a: int, b: int) -> bool:
    """棋盘上是否画连接线：正交相邻必有（公路或铁路），行营有 8 向斜线。"""
    ra, ca = divmod(a, COLS)
    rb, cb = divmod(b, COLS)
    if is_rail(a, b):
        return True
    if abs(ra - rb) == 1 and abs(ca - cb) == 1:
        return a in CAMP or b in CAMP
    return abs(ra - rb) + abs(ca - cb) == 1


def build_html() -> str:
    p = []
    p.append("""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: %dpx; height: %dpx; overflow: hidden; background: #FFFFFF; }
  #board { position: relative; width: %dpx; height: %dpx; border-radius: 22px;
    background: radial-gradient(circle at 50%% 42%%, #FFFDF4 0%%, #F7ECD0 62%%, #E8D8B2 100%%); }
  .zone { position: absolute; left: 24px; width: %dpx; border-radius: 16px; }
  .frame { position: absolute; left: 12px; top: 12px; width: %dpx; height: %dpx;
    border: 5px solid #C79A3C; border-radius: 18px; opacity: .85; }
  /* 公路：细实线（画在落点之下，从落点间隙露出） */
  .line { position: absolute; z-index: 1; background: #A6926E; transform-origin: 0 50%%; height: 3px; }
  /* 行营斜线公路：淡实线，画在落点之上 */
  .diag { position: absolute; z-index: 3; transform-origin: 0 50%%; height: 0; border-top: 2px solid #C6B58E; }
  /* 铁路：细双线 + 稀疏枕木，贯通所有落点（真实军棋即如此） */
  .rail  { position: absolute; z-index: 3; transform-origin: 0 50%%; height: 9px; margin-top: -4.5px;
    border-top: 2px solid #4A4A4A; border-bottom: 2px solid #4A4A4A;
    background: repeating-linear-gradient(90deg, #4A4A4A 0 2.5px, transparent 2.5px 15px); }
  /* 落点用小圆点，线条从点下穿过，符合实物军棋观感 */
  .node { position: absolute; z-index: 2; width: 30px; height: 30px; border-radius: 50%%;
    background: #FFFFFF; border: 3px solid #7A6A4F; transform: translate(-50%%, -50%%);
    box-shadow: 0 1px 2px rgba(0,0,0,.15); }
  .camp { position: absolute; z-index: 2; width: 52px; height: 52px; border-radius: 50%%;
    background: #F0E2BE; border: 3px dashed #B0862F; transform: translate(-50%%, -50%%); }
  .base { position: absolute; z-index: 2; width: 56px; height: 56px; border-radius: 12px;
    background: #F2E4C4; border: 4px solid #8A6A2F; transform: translate(-50%%, -50%%);
    box-shadow: inset 0 0 0 2px rgba(255,255,255,.75); }
  .tag { position: absolute; z-index: 5; transform: translate(-50%%, -50%%); text-align: center;
    font-family: "PingFang SC", "Heiti SC", sans-serif; font-weight: 800; white-space: nowrap;
    padding: 1px 5px; border-radius: 5px; background: rgba(255,255,255,.82); }
  .ghost { background: none; }
  .mountain { position: absolute; z-index: 0; }
</style></head><body><div id="board">
""" % (W, H, W, H, W - 48, W - 24, H - 24))
    # 双方底色（蓝上红下）
    p.append('  <div class="zone" style="top:%dpx;height:%dpx;background:rgba(90,130,180,.13)"></div>\n'
             % (MARGIN - 50, 5 * STEP + 50))
    p.append('  <div class="zone" style="top:%dpx;height:%dpx;background:rgba(190,80,70,.13)"></div>\n'
             % (MARGIN + 6 * STEP + GAP - 50, 5 * STEP + 50))
    p.append('  <div class="frame"></div>\n')

    def line(x1, y1, x2, y2, cls):
        import math
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy)
        ang = math.degrees(math.atan2(dy, dx))
        p.append('  <div class="%s" style="left:%.1fpx;top:%.1fpx;width:%.1fpx;'
                 'transform:rotate(%.2fdeg)"></div>\n'
                 % (cls, x1, y1 - (5 if cls == 'rail' else 0), ln, ang))

    # 分层绘制：先公路（最淡）→ 斜线 → 铁路（最上层，黑白双线最醒目）
    ordered = []
    for a in range(COLS * ROWS):
        ra, ca = divmod(a, COLS)
        for b in range(a + 1, COLS * ROWS):
            rb, cb = divmod(b, COLS)
            if not has_link(a, b):
                continue
            if is_rail(a, b):
                ordered.append((2, a, b))
            elif abs(ra - rb) == 1 and abs(ca - cb) == 1:
                ordered.append((1, a, b))
            else:
                ordered.append((0, a, b))
    for layer, a, b in sorted(ordered, key=lambda t: t[0]):
        x1, y1 = XY[a]
        x2, y2 = XY[b]
        if layer == 2:
            line(x1, y1, x2, y2, 'rail')
        elif layer == 1:
            line(x1, y1, x2, y2, 'diag')
        else:
            line(x1, y1, x2, y2, 'line')

    # 山界：GAP 中央两座山 + 「山界」题字；左(col0)右(col4)铁路 + 中(col2)公路已由连线画出
    gap_top = cell_y(5)
    gap_mid = gap_top + GAP // 2
    p.append('  <div class="tag ghost" style="left:%dpx;top:%dpx;font-size:24px;color:#A08A50;'
             'opacity:.8;letter-spacing:14px">山&emsp;界</div>\n' % (W // 2, gap_mid))

    def mountain(cx, cy, s, color, op):
        p.append(
            '  <svg class="mountain" style="left:%dpx;top:%dpx" width="%d" height="%d" viewBox="0 0 100 60">'
            '<path d="M2 58 L28 22 L42 42 L60 10 L98 58 Z" fill="%s" opacity="%s" '
            'stroke="#8A7344" stroke-width="2.5" stroke-linejoin="round"/>'
            '<path d="M60 10 L70 26 L64 26 Z" fill="#FFFFFF" opacity=".5"/></svg>\n'
            % (cx - s // 2, cy - s * 3 // 10, s, int(s * 0.6), color, op))

    mountain(W // 2 - 132, gap_mid + 6, 92, '#D9C48F', '.5')
    mountain(W // 2 + 132, gap_mid + 6, 92, '#D9C48F', '.5')

    # 落点：小圆点 = 兵站；虚线圆 = 行营；方块 = 大本营（棋子落点由运行时叠加绘制）
    # 标签放在落点与相邻排之间的空隙；顶排没上方空间，改为落在下方
    def label_y(row: int) -> float:
        return y - 44 if row > 0 else y + 44

    for i in range(COLS * ROWS):
        x, y = XY[i]
        row, col = divmod(i, COLS)
        if i in BASE:
            p.append('  <div class="base" style="left:%.1fpx;top:%.1fpx"></div>\n' % (x, y))
            p.append('  <div class="tag" style="left:%.1fpx;top:%.1fpx;font-size:17px;color:#8A6A2F;'
                     'padding:1px 4px">大本营</div>\n' % (x, label_y(row)))
        elif i in CAMP:
            p.append('  <div class="camp" style="left:%.1fpx;top:%.1fpx"></div>\n' % (x, y))
            p.append('  <div class="tag" style="left:%.1fpx;top:%.1fpx;font-size:16px;color:#9C7F3C;'
                     'padding:1px 4px">行营</div>\n' % (x, label_y(row)))
        else:
            p.append('  <div class="node" style="left:%.1fpx;top:%.1fpx"></div>\n' % (x, y))

    # 两侧题字（竖排、贴边，不与棋盘线重叠）
    p.append('  <div class="tag ghost" style="left:26px;top:%dpx;font-size:19px;color:#5B7BA6;'
             'opacity:.55;letter-spacing:6px;writing-mode:vertical-rl">蓝方阵地</div>\n'
             % (MARGIN + int(2.2 * STEP)))
    p.append('  <div class="tag ghost" style="left:%dpx;top:%dpx;font-size:19px;color:#B25A4E;'
             'opacity:.55;letter-spacing:6px;writing-mode:vertical-rl">红方阵地</div>\n'
             % (W - 26, cell_y(8) + 10))
    p.append('</div></body></html>\n')
    return ''.join(p)


def main():
    coords = {
        'posX': [round(x / W * 100, 2) for x, y in XY],
        'posY': [round(y / H * 100, 2) for x, y in XY],
        'base': BASE,
        'camp': CAMP,
        'railRows': list(RAIL_ROWS),
        'railCols': list(RAIL_COLS),
        'gap': GAP,
        'width': W,
        'height': H,
    }
    html = os.path.join(OUT_DIR, 'junqi_board.html')
    raw = os.path.join(OUT_DIR, '_junqi_raw.png')
    png = os.path.join(OUT_DIR, 'junqi_board.png')
    open(html, 'w', encoding='utf-8').write(build_html())
    json.dump(coords, open(os.path.join(OUT_DIR, 'coords_junqi.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    open(os.path.join(OUT_DIR, 'coords_junqi.ts.txt'), 'w', encoding='utf-8').write(
        '  private readonly junqiPosX: number[] = [%s]\n  private readonly junqiPosY: number[] = [%s]\n'
        % (', '.join(str(v) for v in coords['posX']), ', '.join(str(v) for v in coords['posY'])))

    if '--no-render' not in sys.argv:
        render_with_chrome(html, raw, W, H, tag='junqi')
        _, size, dim = flatten_to_png(raw, png, colors=192)
        print('png:', png, size, 'bytes', dim)
    print('html:', html)


if __name__ == '__main__':
    main()
