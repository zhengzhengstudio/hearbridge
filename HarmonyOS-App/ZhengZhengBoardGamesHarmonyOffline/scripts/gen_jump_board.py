#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「中国跳棋（Chinese Checkers）」六角星棋盘底图与配套坐标。

棋盘：17 行共 121 个孔（标准六角星 = 中心边长 5 的六边形 61 孔 + 6 个三角各 10 孔）。
每行孔数：1,2,3,4,13,12,11,10,9,10,11,12,13,4,3,2,1
行起点 x（单位 1，相邻行错开半格）：
  0, -0.5, -1, -1.5, -6, -5.5, -5, -4.5, -4, -4.5, -5, -5.5, -6, -1.5, -1, -0.5, 0

六个角（每角 10 孔）：
  T  顶（行 0-3）      B  底（行 13-16）
  TL 左上（行 4-7 左） TR 右上（行 4-7 右）
  BL 左下（行 9-12 左） BR 右下（行 9-12 右）

三人玩法：红=T→B，黄=BL→TR，蓝=BR→TL（起始三角与目标三角相隔 180°）。

产物：jump_board.html、jump_board.png、coords_jump.json / coords_jump.ts.txt
"""

import json
import os
import subprocess
import sys

STEP = 70                      # 孔间距（px）
ROW_DY = STEP * 0.866          # 行距（三角格高度）
MARGIN = 56
MIN_X, MAX_X = -6.0, 6.0
W = int(MARGIN * 2 + (MAX_X - MIN_X) * STEP)          # 952
H = int(MARGIN * 2 + 16 * ROW_DY + 34)                 # 底部留白防裁切

ROW_START = [0, -0.5, -1, -1.5, -6, -5.5, -5, -4.5, -4, -4.5, -5, -5.5, -6, -1.5, -1, -0.5, 0]
ROW_COUNT = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1]

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# 索引与几何
INDEX = []          # 每行 index 列表
XY = {}             # index -> (x, y) 像素
idx = 0
for r, (start, cnt) in enumerate(zip(ROW_START, ROW_COUNT)):
    row_idx = []
    for c in range(cnt):
        ux = start + c                      # 单位坐标
        x = MARGIN + (ux - MIN_X) * STEP
        y = MARGIN + r * ROW_DY
        XY[idx] = (x, y)
        row_idx.append(idx)
        idx += 1
    INDEX.append(row_idx)
assert idx == 121, idx

# 六个角
T = sum(INDEX[0:4], [])
B = sum(INDEX[13:17], [])
TL = INDEX[4][:4] + INDEX[5][:3] + INDEX[6][:2] + INDEX[7][:1]
TR = INDEX[4][-4:] + INDEX[5][-3:] + INDEX[6][-2:] + INDEX[7][-1:]
BL = INDEX[9][:1] + INDEX[10][:2] + INDEX[11][:3] + INDEX[12][:4]
BR = INDEX[9][-1:] + INDEX[10][-2:] + INDEX[11][-3:] + INDEX[12][-4:]
for name, grp in (('T', T), ('B', B), ('TL', TL), ('TR', TR), ('BL', BL), ('BR', BR)):
    assert len(grp) == 10, (name, len(grp))

# 邻接（三角格：同行 ±1，相邻行 |Δx| = 0.5）
NEIGHBORS = {i: [] for i in range(121)}
for i in range(121):
    xi, yi = XY[i]
    for j in range(121):
        if i == j:
            continue
        xj, yj = XY[j]
        dx = abs(xj - xi)
        dy = abs(yj - yi)
        if dy < 1 and abs(dx - STEP) < 1:                        # 同行相邻
            NEIGHBORS[i].append(j)
        elif abs(dy - ROW_DY) < 1 and abs(dx - STEP / 2) < 1:    # 相邻行错半格
            NEIGHBORS[i].append(j)
for i in range(121):
    assert len(NEIGHBORS[i]) in (2, 3, 4, 5, 6), (i, len(NEIGHBORS[i]))

# 跳跃对：i -> mid -> land（同方向跨 1 子）
JUMPS = {i: [] for i in range(121)}
for i in range(121):
    xi, yi = XY[i]
    for m in NEIGHBORS[i]:
        xm, ym = XY[m]
        vx, vy = xm - xi, ym - yi
        tx, ty = xi + 2 * vx, yi + 2 * vy
        for j in range(121):
            if j == i:
                continue
            xj, yj = XY[j]
            if abs(xj - tx) < 1 and abs(yj - ty) < 1:
                JUMPS[i].append((m, j))
                break

HOME = [T, BL, BR]        # 玩家 1/2/3 起始角
TARGET = [B, TR, TL]      # 玩家 1/2/3 目标角
COLORS = ['#E94B3C', '#F5A623', '#3B7DD8']
TINT = ['rgba(233,75,60,.16)', 'rgba(245,166,35,.16)', 'rgba(59,125,216,.16)']


def build_html() -> str:
    p = ["""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: %dpx; height: %dpx; overflow: hidden; background: #FFFFFF; }
  #board { position: relative; width: %dpx; height: %dpx; border-radius: 26px;
    background: radial-gradient(circle at 50%% 50%%, #FFFCF3 0%%, #F6EBD2 68%%, #E7D7B4 100%%); }
  .frame { position: absolute; left: 12px; top: 12px; width: %dpx; height: %dpx;
    border: 5px solid #C79A3C; border-radius: 22px; opacity: .8; }
  .hole { position: absolute; width: %dpx; height: %dpx; border-radius: 50%%;
    background: #FFFFFF; border: 2.5px solid #8A7856; transform: translate(-50%%, -50%%);
    box-shadow: inset 0 1px 2px rgba(0,0,0,.10); }
  .zone { position: absolute; width: %dpx; height: %dpx; border-radius: 50%%;
    transform: translate(-50%%, -50%%); }
  .tag { position: absolute; transform: translate(-50%%, -50%%); text-align: center;
    font-family: "PingFang SC", "Heiti SC", sans-serif; font-weight: 800; white-space: nowrap; }
</style></head><body><div id="board">
""" % (W, H, W, H, W - 24, H - 24, int(STEP * 0.74), int(STEP * 0.74), int(STEP * 1.02), int(STEP * 1.02))]
    p.append('  <div class="frame"></div>\n')

    # 起始角：实心淡色；目标角：淡色 + 虚线描边
    for k in range(3):
        for i in HOME[k]:
            x, y = XY[i]
            p.append('  <div class="zone" style="left:%.1fpx;top:%.1fpx;background:%s"></div>\n'
                     % (x, y, TINT[k]))
        for i in TARGET[k]:
            x, y = XY[i]
            p.append('  <div class="zone" style="left:%.1fpx;top:%.1fpx;background:%s;'
                     'border:2.5px dashed %s"></div>\n' % (x, y, TINT[k], COLORS[k]))

    for i in range(121):
        x, y = XY[i]
        p.append('  <div class="hole" style="left:%.1fpx;top:%.1fpx"></div>\n' % (x, y))

    # 角标注
    labels = [(T, '红'), (BL, '黄'), (BR, '蓝'), (B, '红家'), (TR, '黄家'), (TL, '蓝家')]
    for grp, text in labels:
        xs = [XY[i][0] for i in grp]
        ys = [XY[i][1] for i in grp]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        p.append('  <div class="tag" style="left:%.1fpx;top:%.1fpx;font-size:19px;color:#8A6A2F;'
                 'opacity:.62">%s</div>\n' % (cx, cy, text))
    p.append('</div></body></html>\n')
    return ''.join(p)


def main():
    coords = {
        'posX': [round(XY[i][0] / W * 100, 2) for i in range(121)],
        'posY': [round(XY[i][1] / H * 100, 2) for i in range(121)],
        'neighbors': NEIGHBORS,
        'jumps': {str(k): v for k, v in JUMPS.items()},
        'home': HOME,
        'target': TARGET,
        'width': W,
        'height': H,
    }
    html = os.path.join(OUT_DIR, 'jump_board.html')
    raw = os.path.join(OUT_DIR, '_jump_raw.png')
    png = os.path.join(OUT_DIR, 'jump_board.png')
    open(html, 'w', encoding='utf-8').write(build_html())
    json.dump(coords, open(os.path.join(OUT_DIR, 'coords_jump.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    open(os.path.join(OUT_DIR, 'coords_jump.ts.txt'), 'w', encoding='utf-8').write(
        '  private readonly jumpPosX: number[] = [%s]\n'
        '  private readonly jumpPosY: number[] = [%s]\n'
        % (', '.join(str(v) for v in coords['posX']), ', '.join(str(v) for v in coords['posY'])))

    if '--no-render' not in sys.argv:
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--force-device-scale-factor=1', '--window-size=%d,%d' % (W, H),
                        '--virtual-time-budget=3000', '--screenshot=%s' % raw,
                        'file://%s' % html], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        from PIL import Image
        im = Image.open(raw).convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im).convert('RGB')
        im.quantize(colors=192, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB') \
            .save(png, 'PNG', optimize=True)
        os.remove(raw)
        print('png:', png, os.path.getsize(png), 'bytes', im.size)
    print('html:', html)


if __name__ == '__main__':
    main()
