#!/usr/bin/env python3
"""Generate the rule-accurate square boards the Harmony app references.

These four textures are pure geometry (no AI texture needed), so they are drawn
deterministically. The playable grid in Index.ets is centred and sized as a
percentage of the board, so every renderer below mirrors that exact ratio:

    reversi    8 x 8  grid = 83% of the board
    tictactoe  3 x 3  grid = 86% of the board
    checkers   8 x 8  grid = 86% of the board
    card_table generic felt table used as the fallback artwork
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1280


def _grid_box(ratio: float) -> tuple[float, float, float, float]:
    side = SIZE * ratio
    offset = (SIZE - side) / 2
    return offset, offset, offset + side, offset + side


def _vignette(image: Image.Image, strength: float = 0.35) -> Image.Image:
    """Soft corner darkening so the flat fills read as a photographed table."""
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    inset = int(SIZE * 0.06)
    draw.rounded_rectangle((inset, inset, SIZE - inset, SIZE - inset),
                           radius=int(SIZE * 0.18), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(int(SIZE * 0.09)))
    shade = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    return Image.composite(image, Image.blend(image, shade, strength), mask)


def reversi_board(destination: Path) -> None:
    """黑白棋（Reversi / Othello）8x8 绿面棋盘，含中央四点与外框。"""
    image = Image.new("RGB", (SIZE, SIZE), (36, 96, 70))
    draw = ImageDraw.Draw(image)

    # 木质外框
    draw.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=26,
                           outline=(28, 74, 54), width=28)
    draw.rounded_rectangle((46, 46, SIZE - 46, SIZE - 46), radius=14,
                           outline=(20, 58, 42), width=6)

    left, top, right, bottom = _grid_box(0.83)
    cell = (right - left) / 8
    line = (16, 48, 36)

    draw.rectangle((left - 4, top - 4, right + 4, bottom + 4), outline=(22, 62, 46), width=8)
    for i in range(9):
        x = left + i * cell
        draw.line((x, top, x, bottom), fill=line, width=3)
        y = top + i * cell
        draw.line((left, y, right, y), fill=line, width=3)

    # 标准开局四点：中央四格交点
    for cx, cy in ((2, 2), (6, 2), (2, 6), (6, 6)):
        x, y = left + cx * cell, top + cy * cell
        r = cell * 0.075
        draw.ellipse((x - r, y - r, x + r, y + r), fill=line)

    image = _vignette(image, 0.18)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def tictactoe_board(destination: Path) -> None:
    """井字棋 3x3 纸面棋盘。"""
    image = Image.new("RGB", (SIZE, SIZE), (238, 232, 218))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=24,
                           outline=(198, 186, 162), width=20)
    draw.rounded_rectangle((52, 52, SIZE - 52, SIZE - 52), radius=12,
                           outline=(176, 163, 138), width=4)

    left, top, right, bottom = _grid_box(0.86)
    cell = (right - left) / 3
    line = (92, 78, 62)

    for i in (1, 2):
        x = left + i * cell
        draw.line((x, top + cell * 0.06, x, bottom - cell * 0.06), fill=line, width=14)
        y = top + i * cell
        draw.line((left + cell * 0.06, y, right - cell * 0.06, y), fill=line, width=14)

    image = _vignette(image, 0.12)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def checkers_board(destination: Path) -> None:
    """国际跳棋 / 方格跳棋 8x8 明暗相间棋盘（中国常见木纹配色）。"""
    image = Image.new("RGB", (SIZE, SIZE), (104, 68, 44))
    draw = ImageDraw.Draw(image)

    # 木框
    draw.rounded_rectangle((14, 14, SIZE - 14, SIZE - 14), radius=26,
                           outline=(82, 52, 32), width=30)
    draw.rounded_rectangle((48, 48, SIZE - 48, SIZE - 48), radius=14,
                           outline=(58, 36, 22), width=6)

    left, top, right, bottom = _grid_box(0.86)
    cell = (right - left) / 8
    light = (232, 213, 174)   # #E8D5AE —— 与 ArkUI 覆盖层同色
    dark = (117, 80, 56)      # #755038
    for row in range(8):
        for column in range(8):
            x0 = left + column * cell
            y0 = top + row * cell
            draw.rectangle((x0, y0, x0 + cell, y0 + cell),
                           fill=light if (row + column) % 2 == 0 else dark)

    draw.rectangle((left, top, right, bottom), outline=(52, 32, 20), width=8)

    image = _vignette(image, 0.2)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def card_table(destination: Path) -> None:
    """通用牌桌：绿毡 + 中央发牌区，作为卡牌类玩法的兜底底图。"""
    image = Image.new("RGB", (SIZE, SIZE), (40, 98, 74))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=28,
                           outline=(92, 58, 32), width=30)
    draw.rounded_rectangle((52, 52, SIZE - 52, SIZE - 52), radius=18,
                           outline=(122, 80, 44), width=8)

    inner = (112, 112, SIZE - 112, SIZE - 112)
    felt = Image.new("RGB", (inner[2] - inner[0], inner[3] - inner[1]), (46, 110, 82))
    image.paste(felt, (inner[0], inner[1]))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(inner, radius=20, outline=(30, 74, 56), width=6)

    # 中央发牌区轮廓
    centre = (SIZE * 0.24, SIZE * 0.24, SIZE * 0.76, SIZE * 0.76)
    draw.rounded_rectangle(centre, radius=18, outline=(62, 132, 100), width=4)

    # 四家座位提示
    seat = (int(SIZE * 0.30), int(SIZE * 0.30))
    for rect in (
        (SIZE / 2 - seat[0] / 2, inner[0] + 34, SIZE / 2 + seat[0] / 2, inner[0] + 34 + 26),
        (SIZE / 2 - seat[0] / 2, inner[3] - 60, SIZE / 2 + seat[0] / 2, inner[3] - 34),
    ):
        draw.rounded_rectangle(rect, radius=12, fill=(58, 124, 94))
    for rect in (
        (inner[0] + 34, SIZE / 2 - seat[1] / 2, inner[0] + 60, SIZE / 2 + seat[1] / 2),
        (inner[2] - 60, SIZE / 2 - seat[1] / 2, inner[2] - 34, SIZE / 2 + seat[1] / 2),
    ):
        draw.rounded_rectangle(rect, radius=12, fill=(58, 124, 94))

    image = _vignette(image, 0.28)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    jobs = [
        ("reversi_board.png", reversi_board),
        ("tictactoe_board.png", tictactoe_board),
        ("checkers_board.png", checkers_board),
        ("card_table.png", card_table),
    ]
    for out_name, renderer in jobs:
        renderer(args.output_dir / out_name)
        print(f"[ok] {out_name}")


if __name__ == "__main__":
    main()
