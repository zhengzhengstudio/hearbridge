#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成围棋(19/13路)与五子棋(15路)棋盘底图。

设计要点：棋子必须落在**交叉点**上，所以底图只画「线 + 星位 + 木纹底」，
棋子由 Index.ets 用校准网格叠加（网格宽 = 线距跨度 * n/(n-1)，居中即对齐，
推导与 xiangqi_board 的校准一致）。

产物（scripts/ 下，再由 scripts/sync_board_artworks.sh 分发到各工程 base/media/）：
  go_board_19.png / go_board_13.png / gobang_board.png
并打印校准常量：MARGIN 比例、线距跨度 span。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from board_render_util import flatten_to_png, render_with_chrome  # noqa: E402

SIZE = 900
MARGIN = 48                     # 首末线到画布边的距离(px)
SPAN = SIZE - 2 * MARGIN        # 804
WOOD_TOP = '#E3BC75'
WOOD_BOT = '#C99A4E'
LINE = '#4A3319'
# 与 gen_ludo_board.py / gen_junqi_board.py 保持一致：产物先落在 scripts/ 下，
# 再由 scripts/sync_board_artworks.sh 统一分发到各工程的 base/media/。
# （以前这里直接写进 media，导致同步脚本找不到它、两端版本也可能不同步）
OUT = os.path.dirname(os.path.abspath(__file__))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def star_points(n: int):
    """标准星位（0 基行列）。"""
    if n == 19:
        pts = [(3, 3), (3, 9), (3, 15), (9, 3), (9, 9), (9, 15),
               (15, 3), (15, 9), (15, 15)]
    elif n == 13:
        pts = [(3, 3), (3, 9), (6, 6), (9, 3), (9, 9)]
    else:  # 15 路五子棋
        pts = [(3, 3), (3, 11), (7, 7), (11, 3), (11, 11)]
    return pts


def build_html(n: int, title: str) -> str:
    step = SPAN / (n - 1)
    lines = []
    for i in range(n):
        p = MARGIN + i * step
        lines.append(f'  <div class="h" style="top:{p:.2f}px"></div>')
        lines.append(f'  <div class="v" style="left:{p:.2f}px"></div>')
    stars = []
    for r, c in star_points(n):
        x = MARGIN + c * step
        y = MARGIN + r * step
        stars.append(f'  <div class="star" style="left:{x:.2f}px;top:{y:.2f}px"></div>')
    star_html = '\n'.join(stars)
    line_html = '\n'.join(lines)
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{ width: {SIZE}px; height: {SIZE}px; overflow: hidden; background: #FFFFFF; }}
  #board {{ position: relative; width: {SIZE}px; height: {SIZE}px; border-radius: 14px;
    background: linear-gradient(155deg, {WOOD_TOP} 0%, {WOOD_BOT} 100%);
    box-shadow: inset 0 0 60px rgba(120,70,20,.18); }}
  .frame {{ position: absolute; inset: 10px; border: 4px solid rgba(90,58,22,.55); border-radius: 10px; }}
  .h {{ position: absolute; left: {MARGIN}px; width: {SPAN}px; height: 1.6px; background: {LINE}; transform: translateY(-50%); }}
  .v {{ position: absolute; top: {MARGIN}px; height: {SPAN}px; width: 1.6px; background: {LINE}; transform: translateX(-50%); }}
  .star {{ position: absolute; width: 9px; height: 9px; border-radius: 50%;
    background: {LINE}; transform: translate(-50%, -50%); }}
  .brand {{ position: absolute; right: 20px; bottom: 14px; font-family: "PingFang SC", sans-serif;
    font-size: 20px; color: rgba(90,58,22,.4); font-weight: 700; letter-spacing: 4px; }}
</style></head><body><div id="board">
  <div class="frame"></div>
{line_html}
{star_html}
  <div class="brand">{title}</div>
</div></body></html>"""


def render(n: int, title: str, png: str):
    html = os.path.join('/tmp', f'_go_{n}.html')
    with open(html, 'w', encoding='utf-8') as f:
        f.write(build_html(n, title))
    raw = png + '.raw.png'
    render_with_chrome(html, raw, SIZE, SIZE, tag=f'go{n}')
    _, size, _ = flatten_to_png(raw, png, colors=160)
    print('png:', png, size, 'bytes')


def main():
    os.makedirs(OUT, exist_ok=True)
    render(19, '围棋 19 路', os.path.join(OUT, 'go_board_19.png'))
    render(13, '围棋 13 路', os.path.join(OUT, 'go_board_13.png'))
    render(15, '五子棋 15 路', os.path.join(OUT, 'gobang_board.png'))
    span_pct = round(SPAN / SIZE * 100, 3)
    margin_pct = round(MARGIN / SIZE * 100, 3)
    print(f'校准：margin={margin_pct}%  span={span_pct}%')
    for n in (13, 15, 19):
        w = span_pct * n / (n - 1)
        print(f'  {n}路: 网格 width={w:.2f}% (居中)')


if __name__ == '__main__':
    main()
