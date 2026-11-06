#!/usr/bin/env python3
"""Redraw the Ludo board strictly after the reference photo (中国/国内版).

Reference: .workbuddy/board-preview/cmp/ludo-board.jpg —— 国内版特征：
- 外圈干净白格跑道（无圆点）
- 四角机场：色块 + 白色圆角内框 + 同色 2x2 圆点
- 归航道 5 格全色，末端接入中央**四色大三角**（绿上/黄右/蓝下/红左，顶点指中心）
- 中央 3x3：大方块四色三角终点 + 四角异色小圆点 + 各三角斜边同色点
- 四个起飞格为彩色格 + 白色大方向箭头
"""

from pathlib import Path

from PIL import Image, ImageDraw

REF = Path("/Users/ljg/Desktop/开发者/TRAE/.workbuddy/board-preview/cmp/ludo-board.jpg")
OUT = Path("/Users/ljg/Desktop/开发者/TRAE/.workbuddy/tmp/boards_out/ludo_board.png")

SIZE = 1280
N = 15

RED = (240, 90, 90)      # #F05A5A —— 与 ArkUI ludoCellColor 一致
GREEN = (53, 200, 111)   # #35C86F
BLUE = (76, 141, 246)    # #4C8DF6
YELLOW = (246, 165, 26)  # #F6A51A
WHITE = (255, 255, 255)
CREAM = (247, 240, 226)
GRID_LINE = (176, 180, 174)
FRAME = (110, 72, 40)

PALETTE = {
    "R": RED, "G": GREEN, "B": BLUE, "Y": YELLOW,
    "W": WHITE, "C": CREAM,
}


def classify(px: tuple[int, int, int]) -> str:
    best, best_d = "?", 1e9
    for key, ref in PALETTE.items():
        d = sum((a - b) ** 2 for a, b in zip(px, ref)) ** 0.5
        if d < best_d:
            best, best_d = key, d
    return best


def sample_grid() -> list[str]:
    image = Image.open(REF).convert("RGB")
    w, h = image.size
    # 参考图 720x720：网格大约从 24 到 696（留 3.33% 边距）。先按比例推。
    margin = round(w * 0.0333)
    cell = (w - 2 * margin) / N
    rows = []
    for r in range(N):
        row = ""
        for c in range(N):
            cx = int(margin + (c + 0.5) * cell)
            cy = int(margin + (r + 0.5) * cell)
            # 5x5 平均，避开细线
            acc = [0, 0, 0]
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    p = image.getpixel((cx + dx, cy + dy))
                    acc = [a + b for a, b in zip(acc, p)]
            avg = tuple(a // 25 for a in acc)
            row += classify(avg)
        rows.append(row)
    return rows


def render(grid: list[str], destination: Path) -> None:
    image = Image.new("RGB", (SIZE, SIZE), CREAM)
    draw = ImageDraw.Draw(image)

    # 外框（参考图棕框 + 内衬白线）
    draw.rounded_rectangle((10, 10, SIZE - 10, SIZE - 10), radius=30,
                           outline=FRAME, width=22)
    draw.rounded_rectangle((34, 34, SIZE - 34, SIZE - 34), radius=16,
                           outline=(255, 255, 255), width=6)

    margin = round(SIZE * 0.0333) + 14  # 内衬线再留一点
    cell = (SIZE - 2 * margin) / N

    def cell_rect(r: int, c: int, inset: float = 0.0):
        x0 = margin + c * cell + inset
        y0 = margin + r * cell + inset
        return (x0, y0, margin + (c + 1) * cell - inset, margin + (r + 1) * cell - inset)

    # 1) 逐格填色（外圈干净白格 + 彩色格），细灰格线
    for r in range(N):
        for c in range(N):
            key = grid[r][c]
            in_corner = (r < 6 and c < 6) or (r < 6 and c > 8) or (r > 8 and c < 6) or (r > 8 and c > 8)
            in_centre = 6 <= r <= 8 and 6 <= c <= 8
            if in_corner or in_centre:
                continue  # 机场与中央单独画
            color = PALETTE.get(key, WHITE)
            draw.rectangle(cell_rect(r, c), fill=color, outline=GRID_LINE, width=2)

    # 2) 四角机场：色块 + 白色圆角内框 + 4 个同色圆点
    corners = [
        (0, 0, RED), (0, 9, GREEN), (9, 9, YELLOW), (9, 0, BLUE),
    ]
    for r0, c0, color in corners:
        block = (margin + c0 * cell, margin + r0 * cell,
                 margin + (c0 + 6) * cell, margin + (r0 + 6) * cell)
        draw.rectangle(block, fill=color)
        inset = cell * 0.95
        inner = (block[0] + inset, block[1] + inset, block[2] - inset, block[3] - inset)
        draw.rounded_rectangle(inner, radius=cell * 0.55, fill=(255, 255, 255))
        # 2x2 同色圆点
        cw = (inner[2] - inner[0]) / 2
        ch = (inner[3] - inner[1]) / 2
        dot_r = min(cw, ch) * 0.22
        for i in (0, 1):
            for j in (0, 1):
                cx = inner[0] + cw * (i + 0.5)
                cy = inner[1] + ch * (j + 0.5)
                draw.ellipse((cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r), fill=color)

    # 3) 中央方形四色三角终点（国内版）：四色大三角顶点指中心 + 四角圆点 + 斜边同色点
    #    3x3 块四角（格线交点坐标，格为单位）
    tl = (margin + 6 * cell, margin + 6 * cell)      # 左上
    tr = (margin + 9 * cell, margin + 6 * cell)      # 右上
    br = (margin + 9 * cell, margin + 9 * cell)      # 右下
    bl = (margin + 6 * cell, margin + 9 * cell)      # 左下
    cc = (margin + 7.5 * cell, margin + 7.5 * cell)  # 中心
    # 大三角：上绿 右黄 下蓝 左红（与四条归航方向一致）
    draw.polygon([tl, tr, cc], fill=GREEN)
    draw.polygon([tr, br, cc], fill=YELLOW)
    draw.polygon([bl, br, cc], fill=BLUE)
    draw.polygon([tl, bl, cc], fill=RED)
    # 三角之间细白描边
    for a, b in ((tl, cc), (tr, cc), (br, cc), (bl, cc)):
        draw.line((a, b), fill=(255, 255, 255), width=4)

    def dot(point: tuple[float, float], color, r: float) -> None:
        draw.ellipse((point[0] - r, point[1] - r, point[0] + r, point[1] + r), fill=color)

    corner_r = cell * 0.11
    dot(tl, RED, corner_r)
    dot(tr, GREEN, corner_r)
    dot(br, YELLOW, corner_r)
    dot(bl, BLUE, corner_r)
    # 各三角斜边中点的同色小点（装饰，照参考图）
    mid_r = cell * 0.07
    dot(((tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2), GREEN, mid_r)
    dot(((tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2), YELLOW, mid_r)
    dot(((bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2), BLUE, mid_r)
    dot(((tl[0] + bl[0]) / 2, (tl[1] + bl[1]) / 2), RED, mid_r)

    # 4) 四个起飞格：彩色格上白色大方向箭头（绿下 / 黄左 / 蓝上 / 红右）
    def arrow(r: int, c: int, direction: str) -> None:
        x0 = margin + c * cell
        y0 = margin + r * cell
        cx, cy = x0 + cell / 2, y0 + cell / 2
        s = cell * 0.34   # 箭头半宽
        shaft = cell * 0.12
        tip = cell * 0.45  # 尖端到中心距离
        if direction == "down":
            pts = [(cx - s, cy - tip + 2 * s), (cx + s, cy - tip + 2 * s), (cx, cy + tip)]
            rect = (cx - shaft, cy - tip, cx + shaft, cy - tip + 2 * s)
        elif direction == "up":
            pts = [(cx - s, cy + tip - 2 * s), (cx + s, cy + tip - 2 * s), (cx, cy - tip)]
            rect = (cx - shaft, cy + tip - 2 * s, cx + shaft, cy + tip)
        elif direction == "left":
            pts = [(cx + tip - 2 * s, cy - s), (cx + tip - 2 * s, cy + s), (cx - tip, cy)]
            rect = (cx + tip - 2 * s, cy - shaft, cx + tip, cy + shaft)
        else:  # right
            pts = [(cx - tip + 2 * s, cy - s), (cx - tip + 2 * s, cy + s), (cx + tip, cy)]
            rect = (cx - tip, cy - shaft, cx - tip + 2 * s, cy + shaft)
        draw.rectangle(rect, fill=(255, 255, 255))
        draw.polygon(pts, fill=(255, 255, 255))

    arrow(0, 8, "down")    # 绿起飞
    arrow(8, 14, "left")   # 黄起飞
    arrow(14, 6, "up")     # 蓝起飞
    arrow(6, 0, "right")   # 红起飞

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)
    print(f"[ok] {destination}")


def main() -> None:
    grid = sample_grid()
    print("15x15 采样结果（R红 G绿 B蓝 Y黄 W白 C米白）：")
    for row in grid:
        print(" ", " ".join(row))
    render(grid, OUT)


if __name__ == "__main__":
    main()
