#!/usr/bin/env python3
"""精致版中国象棋棋盘：木纹渐变 + 楚河汉界 + 九宫斜线 + 炮/兵位标记。

底图 1280x1280，可玩区与 ArkUI 网格对齐：
网格宽 82%、aspectRatio 0.9、水平居中、垂直居中
→ 玩赛区 x: 9%~91%，y: (100-73.8)/2=13.1% ~ 86.9%
9 列 10 行，交点即棋位（棋子在格心 = 交点上）。
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W = H = 1280
# 玩赛区（比例）
PX0, PY0, PX1, PY1 = 0.09, 0.131, 0.91, 0.869
COLS, ROWS = 9, 10

OUT = Path("/Users/ljg/Desktop/开发者/TRAE/.workbuddy/tmp/boards_out/xiangqi_board.png")

CELL_X = (PX1 - PX0) * W / (COLS - 1)
CELL_Y = (PY1 - PY0) * H / (ROWS - 1)

def px(c: int) -> float:
    return PX0 * W + c * CELL_X

def py(r: int) -> float:
    return PY0 * H + r * CELL_Y

WOOD_TOP = (243, 208, 138)
WOOD_BOT = (219, 176, 94)
LINE = (110, 78, 38)
HALF = 7  # 半格纵线（楚河汉界断开）

image = Image.new("RGB", (W, H), WOOD_TOP)
draw = ImageDraw.Draw(image)

# ---- 木纹渐变 + 噪点 ----
arr = np.zeros((H, W, 3), dtype=float)
grad = np.linspace(0, 1, H)[:, None]
for k in range(3):
    arr[..., k] = WOOD_TOP[k] + (WOOD_BOT[k] - WOOD_TOP[k]) * grad
rng = np.random.default_rng(7)
# 水平木纹条带
bands = rng.normal(0, 7, (H // 6 + 1, 1, 1)).repeat(6, axis=0)[:H]
arr += bands
arr += rng.normal(0, 3.5, (H, W, 1))
image = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))
draw = ImageDraw.Draw(image)

LW = 3
# ---- 横线（10 条）----
for r in range(ROWS):
    y = py(r)
    draw.line((px(0), y, px(COLS - 1), y), fill=LINE, width=LW)
# ---- 竖线（两侧贯通，中间半格断开）----
for c in range(COLS):
    x = px(c)
    if c == 0 or c == COLS - 1:
        draw.line((x, py(0), x, py(ROWS - 1)), fill=LINE, width=LW)
    else:
        draw.line((x, py(0), x, py(4)), fill=LINE, width=LW)
        draw.line((x, py(5), x, py(ROWS - 1)), fill=LINE, width=LW)

# ---- 九宫斜线 ----
for r0, r1 in ((0, 2), (7, 9)):
    draw.line((px(3), py(r0), px(5), py(r1)), fill=LINE, width=LW)
    draw.line((px(5), py(r0), px(3), py(r1)), fill=LINE, width=LW)

# ---- 外框加粗 ----
PAD = 10
draw.rectangle((px(0) - PAD, py(0) - PAD, px(COLS - 1) + PAD, py(ROWS - 1) + PAD),
               outline=LINE, width=6)

# ---- 炮位/兵位标记（拐角小勾）----
def mark(c: int, r: int) -> None:
    x, y = px(c), py(r)
    d, g = 9, 16
    for dx in (-1, 1):
        for dy in (-1, 1):
            # 边缘列只画内侧
            if (c == 0 and dx < 0) or (c == COLS - 1 and dx > 0):
                continue
            draw.line((x + dx * g, y + dy * (g - d), x + dx * g, y + dy * g), fill=LINE, width=2)
            draw.line((x + dx * (g - d), y + dy * g, x + dx * g, y + dy * g), fill=LINE, width=2)

for c, r in ((1, 2), (7, 2), (1, 7), (7, 7)):
    mark(c, r)
for c in (0, 2, 4, 6, 8):
    mark(c, 3)
    mark(c, 6)

# ---- 楚河 汉界 ----
try:
    font = ImageFont.truetype("/System/Library/Fonts/STHeiti Light.ttc", 64)
    fonts = ImageFont.truetype("/System/Library/Fonts/STHeiti Light.ttc", 44)
except OSError:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 64)
        fonts = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 44)
    except OSError:
        font = fonts = ImageFont.load_default()

cy = (py(4) + py(5)) / 2
def text_center(s: str, cx: float, size=None, fill=(124, 92, 48)):
    f = font if size is None else fonts
    bb = draw.textbbox((0, 0), s, font=f)
    draw.text((cx - (bb[2] - bb[0]) / 2, cy - (bb[3] - bb[1]) / 2 - bb[1]), s, font=f, fill=fill)

text_center("楚  河", px(1.6))
text_center("汉  界", px(6.4))
# 中间小字装饰
text_center("棋 乐 无 穷", px(4), size=30, fill=(150, 118, 74))

OUT.write_bytes(b"")
image.save(OUT, optimize=True)
print("[ok]", OUT)
