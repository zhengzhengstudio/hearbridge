#!/usr/bin/env python3
"""国内版飞行棋：真实棋盘图做底图 + 白点检测生成 ArkTS 坐标/颜色表。

原图 640x638（中驰第一城飞行棋）。裁掉水印后拉伸到 1280x1280。
白点 = 棋位。输出：
1. ludo_board.png（底图）
2. ludo_ts_constants.txt（route/home/base 坐标百分比 + 44 格颜色表）
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REF = Path("/Users/ljg/Desktop/开发者/TRAE/.workbuddy/board-preview/ref/ludo-cn-sohu.jpeg")
OUT_DIR = Path("/Users/ljg/Desktop/开发者/TRAE/.workbuddy/tmp/boards_out")
CROP = (10, 6, 630, 596)  # left, top, right, bottom（去水印/白边）

# 颜色分类参考值
PALETTE = {
    "R": (200, 40, 40),
    "G": (30, 150, 60),
    "Y": (245, 200, 30),
    "B": (60, 130, 210),
    "W": (250, 250, 250),
}


def classify(px) -> str:
    best, bd = "?", 1e9
    for k, ref in PALETTE.items():
        d = sum((int(a) - b) ** 2 for a, b in zip(px, ref)) ** 0.5
        if d < bd:
            best, bd = k, d
    return best


def detect_dots(a) -> list[tuple[float, float, int]]:
    white = (a[:, :, 0] > 232) & (a[:, :, 1] > 232) & (a[:, :, 2] > 232)
    h, w = white.shape
    labels = np.zeros((h, w), dtype=int)
    comps = []
    from collections import deque
    ys, xs = np.nonzero(white)
    for y0, x0 in zip(ys, xs):
        if labels[y0, x0]:
            continue
        cur = labels.max() + 1
        q = deque([(y0, x0)])
        labels[y0, x0] = cur
        pix = []
        while q:
            y, x = q.popleft()
            pix.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = cur
                        q.append((ny, nx))
        arr = np.array(pix)
        if not (150 <= len(arr) <= 1200):
            continue
        ymin, xmin = arr.min(axis=0)
        ymax, xmax = arr.max(axis=0)
        bw, bh = xmax - xmin + 1, ymax - ymin + 1
        if not (14 <= bw <= 40 and 14 <= bh <= 40 and bw / bh < 1.6 and bh / bw < 1.6):
            continue
        cy, cx = arr.mean(axis=0)
        comps.append((float(cx), float(cy), int(len(arr))))
    return comps


def ring_color(a, cx: float, cy: float) -> str:
    """白点周围环带（r 16..24）的主彩色。"""
    votes: dict[str, int] = {}
    for k in range(48):
        ang = 2 * math.pi * k / 48
        for r in (16, 20, 24):
            x = int(cx + r * math.cos(ang))
            y = int(cy + r * math.sin(ang))
            if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
                c = classify(a[y, x])
                if c != "W":
                    votes[c] = votes.get(c, 0) + 1
    return max(votes, key=votes.get) if votes else "W"


def main() -> None:
    im = Image.open(REF).convert("RGB")
    a = np.asarray(im).astype(int)
    dots = detect_dots(a)
    print(f"检测白点 {len(dots)}")

    L, T, R, B = CROP
    cw, ch = R - L, B - T

    def to_pct(cx: float, cy: float) -> tuple[float, float]:
        return round((cx - L) / cw * 100, 2), round((cy - T) / ch * 100, 2)

    centre = (320.4, 319.0)
    # ---- 归航条（各方向 6 点，靠中央的 6 个）----
    def line_points(fixed_axis: str, fixed: float, lo: float, hi: float) -> list:
        pts = [d for d in dots if abs(d[0 if fixed_axis == "x" else 1] - fixed) < 6
               and lo <= d[1 if fixed_axis == "x" else 0] <= hi]
        pts.sort(key=lambda d: d[1 if fixed_axis == "x" else 0])
        return pts

    top_col = line_points("x", 320.4, 30, 300)     # 黄归航（顶→中心）
    bottom_col = line_points("x", 320.4, 340, 610)  # 绿归航（底→中心）
    left_row = line_points("y", 319, 40, 300)       # 红归航（左→中心）
    right_row = line_points("y", 319, 340, 610)     # 蓝归航（右→中心）
    print(f"归航条：黄{len(top_col)} 绿{len(bottom_col)} 红{len(left_row)} 蓝{len(right_row)}")
    home = [left_row[-6:], top_col[-6:][::-1], bottom_col[-6:][::-1], right_row[:6]]
    # 红：左→内；黄：顶→内；绿：底→内；蓝：右→内

    home_pts = {tuple(round(v, 1) for v in d[:2]) for path in home for d in path}
    # ---- 外圈 = 其余点 ----
    ring = [d for d in dots if tuple(round(v, 1) for v in d[:2]) not in home_pts]
    cx0, cy0 = centre
    ring.sort(key=lambda d: (math.atan2(d[1] - cy0, d[0] - cx0) + 2 * math.pi) % (2 * math.pi))
    # 让 index0 = 红归航入口（最靠左中的外圈点，x 最小且 y≈319）
    entry_red = min(range(len(ring)), key=lambda i: ring[i][0] ** 2 + (ring[i][1] - 319) ** 2 * 4)
    ring = ring[entry_red:] + ring[:entry_red]
    print(f"外圈 {len(ring)} 格")

    colors = [ring_color(a, d[0], d[1]) for d in ring]
    print("外圈颜色序列：", "".join(colors))

    # ---- 底图 ----
    board = im.crop(CROP).resize((1280, 1280), Image.LANCZOS)
    board = board.filter(ImageFilter.UnsharpMask(radius=2, percent=80))
    board.save(OUT_DIR / "ludo_board.png", optimize=True)
    print(f"[ok] {OUT_DIR / 'ludo_board.png'}")

    # ---- TS 常量 ----
    def p(d) -> tuple[str, str]:
        x, y = to_pct(d[0], d[1])
        return str(x), str(y)

    lines = []
    rx = ", ".join(p(d)[0] for d in ring)
    ry = ", ".join(p(d)[1] for d in ring)
    lines.append("// 国内版飞行棋（44 格外圈）坐标与颜色，由 scripts/ludo_cn_real_board.py 生成")
    lines.append("  readonly ludoRouteX: number[] = [" + rx + "]")
    lines.append("  readonly ludoRouteY: number[] = [" + ry + "]")
    lines.append("  readonly ludoRouteColor: string[] = [" +
                 ", ".join({"R": "'#E94B3C'", "G": "'#229B54'", "Y": "'#F5A623'", "B": "'#3B7DD8'"}[c]
                           for c in colors) + "]")
    for dim, label in ((0, "X"), (1, "Y")):
        rows = []
        for path in home:
            rows.append("[" + ", ".join(p(d)[dim] for d in path) + "]")
        lines.append(f"  readonly ludoHome{label}: number[][] = [" + ", ".join(rows) + "]")
    bases = [((100, 100), (540, 100), (100, 540), (540, 540))]
    bx = ", ".join(str(round(to_pct(x, y)[0], 2)) for x, y in bases[0])
    by = ", ".join(str(round(to_pct(x, y)[1], 2)) for x, y in bases[0])
    lines.append("  readonly ludoBaseX: number[] = [" + bx + "]")
    lines.append("  readonly ludoBaseY: number[] = [" + by + "]")
    out = OUT_DIR / "ludo_ts_constants.txt"
    out.write_text("\n".join(lines) + "\n")
    print(f"[ok] {out}")
    print("\n".join(lines[:6]))


if __name__ == "__main__":
    main()
