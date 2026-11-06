#!/usr/bin/env python3
"""Calibrate generated board textures with rule-accurate geometry.

Image generation supplies the material and lighting. This script supplies the
geometry that must never be guessed: grid counts, palace diagonals, river gaps,
and the 15 x 15 Ludo path.
"""

import argparse
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


SIZE = 1280


def softened_texture(source: Path, tint: Tuple[int, int, int]) -> Image.Image:
    image = Image.open(source).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    image = image.filter(ImageFilter.GaussianBlur(18))
    tint_layer = Image.new("RGB", image.size, tint)
    image = Image.blend(image, tint_layer, 0.36)
    return ImageEnhance.Contrast(image).enhance(0.9)


def render_xiangqi(source: Path, destination: Path) -> None:
    image = softened_texture(source, (218, 157, 76))
    draw = ImageDraw.Draw(image)
    frame = (34, 34, SIZE - 34, SIZE - 34)
    draw.rounded_rectangle(frame, radius=22, outline=(86, 47, 20), width=20)
    draw.rounded_rectangle((55, 55, SIZE - 55, SIZE - 55), radius=10, outline=(139, 82, 31), width=5)

    # Matches the Harmony 9 x 10 cell overlay: 82% wide and 10/9 as tall.
    grid_width = SIZE * 0.82
    grid_height = grid_width / 0.9
    left = (SIZE - grid_width) / 2
    top = (SIZE - grid_height) / 2
    cell_x = grid_width / 9
    cell_y = grid_height / 10
    xs = [left + (column + 0.5) * cell_x for column in range(9)]
    ys = [top + (row + 0.5) * cell_y for row in range(10)]
    line = (73, 48, 24)

    for row_y in ys:
        draw.line((xs[0], row_y, xs[-1], row_y), fill=line, width=3)
    for column, column_x in enumerate(xs):
        if column in (0, 8):
            draw.line((column_x, ys[0], column_x, ys[-1]), fill=line, width=3)
        else:
            draw.line((column_x, ys[0], column_x, ys[4]), fill=line, width=3)
            draw.line((column_x, ys[5], column_x, ys[-1]), fill=line, width=3)

    # The two palaces are always 3 files by 3 ranks, with two full diagonals.
    draw.line((xs[3], ys[0], xs[5], ys[2]), fill=line, width=3)
    draw.line((xs[5], ys[0], xs[3], ys[2]), fill=line, width=3)
    draw.line((xs[3], ys[7], xs[5], ys[9]), fill=line, width=3)
    draw.line((xs[5], ys[7], xs[3], ys[9]), fill=line, width=3)

    # Cannon and soldier marks. The small gap leaves the intersection visible.
    def marker(column: int, row: int) -> None:
        x, y = xs[column], ys[row]
        arm, gap = 13, 5
        for sx in (-1, 1):
            draw.line((x + sx * gap, y - arm, x + sx * gap, y - gap), fill=line, width=2)
            draw.line((x + sx * gap, y + gap, x + sx * gap, y + arm), fill=line, width=2)
        for sy in (-1, 1):
            draw.line((x - arm, y + sy * gap, x - gap, y + sy * gap), fill=line, width=2)
            draw.line((x + gap, y + sy * gap, x + arm, y + sy * gap), fill=line, width=2)

    for column, row in ((1, 2), (7, 2), (1, 7), (7, 7)):
        marker(column, row)
    for row in (3, 6):
        for column in (0, 2, 4, 6, 8):
            marker(column, row)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def render_ludo(source: Path, destination: Path) -> None:
    """经典模式中国飞行棋棋盘（**非闪电版**）。

    经典版布局：四角 6x6 飞机场 + 52 格外圈跑道 + 四条 5 格归航道 + 中央圆形终点区。
    闪电版那种贯穿中心的对角虚线捷径在经典版里不存在，这里刻意不画。
    """
    image = softened_texture(source, (238, 230, 210))
    draw = ImageDraw.Draw(image)
    outer = (28, 28, SIZE - 28, SIZE - 28)
    draw.rounded_rectangle(outer, radius=22, fill=(241, 234, 216), outline=(122, 84, 48), width=18)
    draw.rounded_rectangle((52, 52, SIZE - 52, SIZE - 52), radius=12, outline=(172, 128, 76), width=4)

    board_left = 76
    board_top = 76
    board_size = SIZE - 152
    cell = board_size / 15
    # 经典中式配色：跑道每一格都上色（四色循环 + 格内白圆点），参照实体飞行棋盘。
    colors = {
        "red": (211, 60, 54),
        "green": (46, 140, 78),
        "blue": (44, 105, 178),
        "yellow": (229, 168, 42),
        "neutral": (246, 244, 235),
    }
    cycle = [colors["red"], colors["green"], colors["yellow"], colors["blue"]]
    line = (120, 112, 100)

    def box(row: int, column: int) -> Tuple[float, float, float, float]:
        x0 = board_left + column * cell
        y0 = board_top + row * cell
        return (x0, y0, x0 + cell, y0 + cell)

    def square(row: int, column: int, fill: Tuple[int, int, int]) -> None:
        draw.rectangle(box(row, column), fill=fill, outline=line, width=2)

    def dot(row: int, column: int, fill: Tuple[int, int, int] = (255, 255, 255), scale: float = 0.30) -> None:
        x0, y0, x1, y1 = box(row, column)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        radius = cell * scale
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=fill)

    def arrow(row: int, column: int, direction: str, color: Tuple[int, int, int]) -> None:
        x0, y0, x1, y1 = box(row, column)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        length, half = cell * 0.52, cell * 0.18
        if direction == "right":
            points = [(cx - length / 2, cy - half), (cx, cy - half), (cx, cy - half * 1.8),
                      (cx + length / 2, cy), (cx, cy + half * 1.8), (cx, cy + half), (cx - length / 2, cy + half)]
        elif direction == "left":
            points = [(cx + length / 2, cy - half), (cx, cy - half), (cx, cy - half * 1.8),
                      (cx - length / 2, cy), (cx, cy + half * 1.8), (cx, cy + half), (cx + length / 2, cy + half)]
        elif direction == "down":
            points = [(cx - half, cy - length / 2), (cx - half, cy), (cx - half * 1.8, cy),
                      (cx, cy + length / 2), (cx + half * 1.8, cy), (cx + half, cy), (cx + half, cy - length / 2)]
        else:
            points = [(cx - half, cy + length / 2), (cx - half, cy), (cx - half * 1.8, cy),
                      (cx, cy - length / 2), (cx + half * 1.8, cy), (cx + half, cy), (cx + half, cy + length / 2)]
        draw.polygon(points, fill=color)

    # 四角 6x6 飞机场：整块色底 + 2x2 白色停机位圆（参照实体棋盘）。
    homes = [
        (0, 0, colors["red"]),
        (0, 9, colors["green"]),
        (9, 0, colors["blue"]),
        (9, 9, colors["yellow"]),
    ]
    for row, column, color in homes:
        x0, y0, _, _ = box(row, column)
        x1, y1, _, _ = box(row + 5, column + 5)
        draw.rectangle((x0, y0, x1 + cell, y1 + cell), fill=color, outline=line, width=3)
        for rr in (2.0, 4.0):
            for cc in (2.0, 4.0):
                cx = x0 + cc * cell
                cy = y0 + rr * cell
                radius = cell * 0.72
                draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
                             fill=(252, 250, 240), outline=color, width=6)

    # 52 格外圈跑道：每格按四色循环上色 + 白圆点。
    # 循环相位与起飞点严格对齐：track[0]=红(6,0) track[13]=绿(0,8)
    # track[26]=黄(8,14) track[39]=蓝(14,6)，间隔 13 格且 13%4==1，四家颜色天然吻合。
    track = [
        (6, 0), (6, 1), (6, 2), (6, 3), (6, 4), (6, 5), (5, 6), (4, 6),
        (3, 6), (2, 6), (1, 6), (0, 6), (0, 7), (0, 8), (1, 8), (2, 8),
        (3, 8), (4, 8), (5, 8), (6, 9), (6, 10), (6, 11), (6, 12), (6, 13),
        (6, 14), (7, 14), (8, 14), (8, 13), (8, 12), (8, 11), (8, 10), (8, 9),
        (9, 8), (10, 8), (11, 8), (12, 8), (13, 8), (14, 8), (14, 7), (14, 6),
        (13, 6), (12, 6), (11, 6), (10, 6), (9, 6), (8, 5), (8, 4), (8, 3),
        (8, 2), (8, 1), (8, 0), (7, 0),
    ]
    launch_indices = {0, 13, 26, 39}
    for index, (row, column) in enumerate(track):
        square(row, column, cycle[index % 4])
        if index in launch_indices:
            continue  # 起飞格下面画白色箭头
        dot(row, column)

    # 四条归航道：整条同色 + 白圆点（经典实体棋盘样式）。
    for column in range(1, 6):
        square(7, column, colors["red"])
        square(7, 14 - column, colors["yellow"])
        dot(7, column)
        dot(7, 14 - column)
    for row in range(1, 6):
        square(row, 7, colors["green"])
        square(14 - row, 7, colors["blue"])
        dot(row, 7)
        dot(14 - row, 7)

    # 起飞格：同色底 + 白色箭头，方向即起飞方向。
    # 与 App 端 route[player * 13] 完全对应：红(6,0) 绿(0,8) 黄(8,14) 蓝(14,6)
    arrow(6, 0, "right", (255, 255, 255))
    arrow(0, 8, "down", (255, 255, 255))
    arrow(8, 14, "left", (255, 255, 255))
    arrow(14, 6, "up", (255, 255, 255))

    # 中央终点：方形按对角线分四色三角（左红/上绿/右黄/下蓝，与归航方向一致）。
    center_left = board_left + 6 * cell
    center_top = board_top + 6 * cell
    center_right = center_left + 3 * cell
    center_bottom = center_top + 3 * cell
    pad = cell * 0.10
    cl, ct = center_left + pad, center_top + pad
    cr, cb = center_right - pad, center_bottom - pad
    ccx, ccy = (cl + cr) / 2, (ct + cb) / 2
    draw.polygon(((cl, ct), (cl, cb), ccx, ccy), fill=colors["red"])
    draw.polygon(((cl, ct), (cr, ct), ccx, ccy), fill=colors["green"])
    draw.polygon(((cr, ct), (cr, cb), ccx, ccy), fill=colors["yellow"])
    draw.polygon(((cl, cb), (cr, cb), ccx, ccy), fill=colors["blue"])
    draw.polygon(((cl, ct), (cr, ct), (cr, cb), (cl, cb)), outline=(255, 255, 255), width=6)
    draw.line((cl, ct, cr, cb), fill=(255, 255, 255), width=4)
    draw.line((cl, cb, cr, ct), fill=(255, 255, 255), width=4)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def render_property_china(source: Path, destination: Path) -> None:
    source_image = Image.open(source).convert("RGB")
    image = Image.new("RGB", (SIZE, SIZE), (239, 224, 190))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, SIZE - 24, SIZE - 24), radius=24, fill=(67, 43, 31), outline=(31, 27, 23), width=8)
    board = (58, 58, SIZE - 58, SIZE - 58)
    draw.rectangle(board, fill=(246, 236, 208), outline=(133, 87, 45), width=6)

    corner = 158
    inner = (board[0] + corner, board[1] + corner, board[2] - corner, board[3] - corner)
    # Preserve the generated China map and city landmarks as the board's visual centre.
    map_crop = source_image.crop((190, 190, source_image.width - 190, source_image.height - 190))
    map_image = ImageOps.fit(map_crop, (inner[2] - inner[0], inner[3] - inner[1]), method=Image.LANCZOS)
    map_image = ImageEnhance.Color(map_image).enhance(0.82)
    image.paste(map_image, (inner[0], inner[1]))
    draw = ImageDraw.Draw(image)
    draw.rectangle(inner, outline=(105, 76, 43), width=5)

    side = (board[2] - board[0] - corner * 2) / 5
    palette = [(174, 54, 47), (36, 104, 124), (35, 112, 77), (208, 145, 39), (126, 72, 125)]

    def cell(rect: Tuple[float, float, float, float], index: int, special: bool = False) -> None:
        draw.rectangle(rect, fill=(248, 239, 215), outline=(75, 61, 43), width=4)
        x0, y0, x1, y1 = rect
        band = palette[index % len(palette)]
        if special:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            radius = min(x1 - x0, y1 - y0) * 0.20
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=band, width=7)
            draw.line((cx - radius * 0.55, cy, cx + radius * 0.55, cy), fill=band, width=7)
        elif y1 - y0 < x1 - x0:
            draw.rectangle((x0, y0, x1, y0 + 24), fill=band)
        else:
            draw.rectangle((x0, y0, x0 + 24, y1), fill=band)

    corners = [
        (board[0], board[1], board[0] + corner, board[1] + corner),
        (board[2] - corner, board[1], board[2], board[1] + corner),
        (board[2] - corner, board[3] - corner, board[2], board[3]),
        (board[0], board[3] - corner, board[0] + corner, board[3]),
    ]
    for index, rect in enumerate(corners):
        draw.rectangle(rect, fill=palette[index], outline=(75, 61, 43), width=5)
        x0, y0, x1, y1 = rect
        draw.rounded_rectangle((x0 + 34, y0 + 34, x1 - 34, y1 - 34), radius=16, outline=(250, 236, 196), width=7)

    special_indices = {2, 5, 8, 11, 14, 17}
    index = 0
    for i in range(5):
        x0 = board[0] + corner + i * side
        cell((x0, board[1], x0 + side, board[1] + corner), index, index in special_indices); index += 1
    for i in range(5):
        y0 = board[1] + corner + i * side
        cell((board[2] - corner, y0, board[2], y0 + side), index, index in special_indices); index += 1
    for i in reversed(range(5)):
        x0 = board[0] + corner + i * side
        cell((x0, board[3] - corner, x0 + side, board[3]), index, index in special_indices); index += 1
    for i in reversed(range(5)):
        y0 = board[1] + corner + i * side
        cell((board[0], y0, board[0] + corner, y0 + side), index, index in special_indices); index += 1

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def render_ludo_china(source: Path, destination: Path) -> None:
    """中国飞行棋——**经典模式**（用户明确要求，不要闪电版）。

    经典版特征：四角 6x6 飞机场 + 52 格外圈跑道 + 四条 5 格归航道 + 中央圆形终点 +
    同色跳格；材质用中式米黄纸面/传统配色。闪电版的对角虚线捷径不画。
    """
    render_ludo(source, destination)


def render_rummy_china(source: Path, destination: Path) -> None:
    """拉密（Rummikub 106 张）桌面：中式木框 + 绿毡 + 中央公共牌区 + 四方牌架位。"""
    image = Image.open(source).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    image = image.filter(ImageFilter.GaussianBlur(3))
    draw = ImageDraw.Draw(image)

    # 中式木框
    draw.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=26,
                           outline=(92, 58, 32), width=26)
    draw.rounded_rectangle((44, 44, SIZE - 44, SIZE - 44), radius=18,
                           outline=(124, 82, 46), width=8)

    # 中央绿毡牌区
    inner = (86, 86, SIZE - 86, SIZE - 86)
    felt = Image.new("RGB", (inner[2] - inner[0], inner[3] - inner[1]), (44, 106, 78))
    felt = ImageEnhance.Brightness(felt).enhance(1.0)
    image.paste(felt, (inner[0], inner[1]))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(inner, radius=14, outline=(30, 74, 54), width=5)

    # 中央公共组合区：留出摆放牌组的浅色网格
    board_left, board_top = inner[0] + 34, inner[1] + 34
    board_right, board_bottom = inner[2] - 34, inner[3] - 34
    grid_w = board_right - board_left
    grid_h = board_bottom - board_top
    cols, rows = 13, 8
    cell_w, cell_h = grid_w / cols, grid_h / rows
    for row in range(rows + 1):
        y = board_top + row * cell_h
        draw.line((board_left, y, board_right, y), fill=(62, 128, 96), width=2)
    for col in range(cols + 1):
        x = board_left + col * cell_w
        draw.line((x, board_top, x, board_bottom), fill=(62, 128, 96), width=2)

    # 四方牌架位（中式牌桌四边各留一条木色搁架）
    shelf = 30
    for rect in (
        (board_left, board_top - shelf - 6, board_right, board_top - 6),
        (board_left, board_bottom + 6, board_right, board_bottom + shelf + 6),
    ):
        draw.rounded_rectangle(rect, radius=8, fill=(150, 104, 62), outline=(96, 62, 34), width=3)
    for rect in (
        (board_left - shelf - 6, board_top, board_left - 6, board_bottom),
        (board_right + 6, board_top, board_right + shelf + 6, board_bottom),
    ):
        draw.rounded_rectangle(rect, radius=8, fill=(150, 104, 62), outline=(96, 62, 34), width=3)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    jobs = [
        ("xiangqi-board.png", args.source_dir / "xiangqi-board.png", render_xiangqi, "xiangqi-board.png"),
        ("ludo-board.png", args.source_dir / "ludo-china-imagegen.png", render_ludo_china, "ludo-board.png"),
        ("property-board.png", args.source_dir / "property-china-imagegen.png", render_property_china, "property-board.png"),
        ("rummy-board.png", args.source_dir / "rummy-china-imagegen.png", render_rummy_china, "rummy-board.png"),
    ]
    for label, source, renderer, out_name in jobs:
        fallbacks = {
            "ludo-board.png": args.source_dir / "ludo-board.png",
            "property-board.png": args.source_dir / "property-board.png",
            "xiangqi-board.png": args.source_dir / "xiangqi-texture.png",
            "rummy-board.png": args.source_dir / "rummy-table.png",
        }
        actual = source if source.exists() else fallbacks.get(label)
        if actual is None or not actual.exists():
            print(f"[skip] {label}: no source texture")
            continue
        renderer(actual, args.output_dir / out_name)
        print(f"[ok] {out_name}")


if __name__ == "__main__":
    main()
