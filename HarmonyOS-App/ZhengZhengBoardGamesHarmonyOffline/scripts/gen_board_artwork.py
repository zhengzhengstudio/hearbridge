#!/usr/bin/env python3
"""棋盘底图生成器：AI 木纹材质 + 程序精确网格 + 同源坐标输出。

为什么不用纯 AI 出图：棋盘的每条线必须像素级等距，AI 生成的网格无法保证，
而棋子是靠百分比坐标落在交叉点上的，线位差 1% 就会错位。
所以拆成两层：
  1) 木纹底板  —— AI 生成（只提供材质，无任何线条）
  2) 网格 + 星位 —— 本脚本按数学精确绘制，同时输出 coords*.json 给 Index.ets 用

用法：
  python3 gen_board_artwork.py            # 生成全部棋盘
  python3 gen_board_artwork.py go13       # 只生成 13 路围棋
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.abspath(os.path.join(HERE, '..', 'entry', 'src', 'main', 'resources', 'base', 'media'))
TEX_DIR = os.path.join(HERE, '_tex')

SIZE = 900          # 输出边长（棋盘最大显示约 780px，900 足够）
MARGIN = 0.085      # 棋盘线区距画布边缘的比例

# 线区跨度（占整图百分比）——网格宽度由它反推，见 grid_width()
SPAN = 0.782        # 首末交叉点之间的距离


def grid_width(n: int) -> float:
    """Grid 宽（占整图百分比）。

    Grid 的列落在「格子中心」，而棋子要落在底图的「交叉点」上，两者差半格。
    设底图 n 条线跨度 S%，则网格宽 = S * n / (n - 1)。
    """
    return SPAN * n / (n - 1)


def load_wood() -> Image.Image:
    """取木纹底板，裁掉 AI 水印区域并校正色调。"""
    files = [f for f in os.listdir(TEX_DIR) if f.lower().endswith('.png')] if os.path.isdir(TEX_DIR) else []
    files.sort(key=lambda f: os.path.getmtime(os.path.join(TEX_DIR, f)), reverse=True)
    if not files:
        raise SystemExit('找不到木纹底板：%s' % TEX_DIR)
    im = Image.open(os.path.join(TEX_DIR, files[0])).convert('RGB')
    # 裁掉底部 8%（右下角水印）
    w, h = im.size
    im = im.crop((0, 0, w, int(h * 0.92))).resize((SIZE, SIZE), Image.LANCZOS)
    # AI 出图普遍偏亮偏橙：压饱和 + 压亮度 + 提对比，
    # 让它落到传统棋盘那种偏蜜黄的沉稳木色，线条才压得住
    im = ImageEnhance.Color(im).enhance(0.55)
    im = ImageEnhance.Brightness(im).enhance(0.88)
    im = ImageEnhance.Contrast(im).enhance(1.16)
    return im


def save_optimized(im: Image.Image, path: str):
    """存盘并量化。

    木纹是有噪点的照片级素材，直接存 PNG 要 1.3MB/张，三张就把包体撑大 4MB。
    棋盘是纯色线条 + 平缓木纹，压到 96 色 + 轻微降噪后肉眼几乎无损，体积能降到 1/5。
    """
    from PIL import ImageFilter
    raw = os.path.getsize(path) if os.path.exists(path) else 0
    # 先轻微模糊，抹掉木纹的高频噪点 —— 噪点正是吃掉调色板的主因
    smoothed = im.filter(ImageFilter.SMOOTH_MORE)
    quantized = smoothed.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.NONE)
    quantized.save(path, optimize=True)
    saved = os.path.getsize(path)
    print('       %-18s %6.0f KB → %6.0f KB' % (
        os.path.basename(path), raw / 1024, saved / 1024))


def draw_board(n: int, stars: int = 0, out_name: str = None, wood=None) -> dict:
    """画 n×n 交叉点棋盘；stars 为星位所在的对角索引数。"""
    im = (wood or load_wood()).copy()
    d = ImageDraw.Draw(im)

    # 交叉点坐标：首末线分别落在 MARGIN 和 1-MARGIN
    lo = MARGIN * SIZE
    hi = (1 - MARGIN) * SIZE
    step = (hi - lo) / (n - 1)
    pts = [lo + i * step for i in range(n)]

    line = (52, 30, 10)
    w = 2 if n <= 15 else 2

    # 刻线立体感：只在主线下方压一道 1px 的浅色高光，不加宽 halo，
    # 否则木纹底上会出现一圈发白的"粗边"，线看起来反而更浅。
    halo = (238, 218, 178)
    for p in pts:
        d.line([(p, lo), (p + 1, lo), (p + 1, hi), (p, hi)], fill=halo, width=1)
        d.line([(lo, p), (lo, p + 1), (hi, p + 1), (hi, p)], fill=halo, width=1)
    for p in pts:
        d.line([(p, lo), (p, hi)], fill=line, width=w)
        d.line([(lo, p), (hi, p)], fill=line, width=w)

    # 星位：围棋按路数取标准星位，五子棋取 5 点
    marks = []
    if stars == 9:      # 19 路：3x3 星位（4/10/16）
        idx = [3, 9, 15]
    elif stars == 5:    # 15 路：3x3 + 2 中星
        idx = [3, 7, 11]
    elif stars == 3:    # 13 路：4 个星位（3/6/9）
        idx = [3, 9]
    elif stars == 4:    # 13 路四角
        idx = [3, 9]
    else:
        idx = []
    if stars == 5:
        marks = [(i, j) for i in idx for j in idx] + [(7, 7)]
    elif stars in (3, 4):
        marks = [(i, j) for i in idx for j in idx]
    else:
        marks = [(i, j) for i in idx for j in idx]

    r = max(4, int(step * 0.14))
    for (i, j) in marks:
        cx, cy = pts[i], pts[j]
        d.ellipse([cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], fill=halo)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(48, 32, 16))

    name = out_name or ('go_board_%d.png' % n)
    path = os.path.join(MEDIA, name)
    save_optimized(im, path)

    # 输出同源坐标：交叉点相对整图的百分比
    coords = {
        'size': n,
        'spanPct': round(SPAN * 100, 4),
        'gridWidthPct': round(grid_width(n) * 100, 4),
        'cellPct': round(step / SIZE * 100, 4),
        'pointsPct': [round(p / SIZE * 100, 4) for p in pts],
    }
    return {'file': name, 'path': path, 'coords': coords, 'marks': len(marks)}


def emit_coords(prefix: str, data: dict):
    with open(os.path.join(HERE, 'coords_%s.json' % prefix), 'w', encoding='utf-8') as f:
        json.dump(data['coords'], f, ensure_ascii=False, indent=2)
    with open(os.path.join(HERE, 'coords_%s.ts.txt' % prefix), 'w', encoding='utf-8') as f:
        f.write('// 由 gen_board_artwork.py 生成，请勿手改\n')
        f.write('// %s 交叉点百分比坐标\n' % data['file'])
        f.write('export const %s_POINTS_PCT: number[] = [%s]\n' % (
            prefix.upper(), ', '.join('%.4f' % v for v in data['coords']['pointsPct'])))
        f.write('export const %s_GRID_WIDTH_PCT: number = %.4f\n' % (
            prefix.upper(), data['coords']['gridWidthPct']))


def main():
    os.makedirs(MEDIA, exist_ok=True)
    os.makedirs(TEX_DIR, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None

    wood = load_wood()
    jobs = [
        ('go13', 13, 4, 'go_board_13.png'),
        ('go19', 19, 9, 'go_board_19.png'),
        ('gobang', 15, 5, 'gobang_board.png'),
    ]
    for prefix, n, stars, fname in jobs:
        if only and only != prefix:
            continue
        data = draw_board(n, stars, fname, wood=wood)
        emit_coords(prefix, data)
        print('%-8s %-18s %d×%d  星位%d  网格宽%.2f%%  格距%.2f%%' % (
            prefix, data['file'], n, n, data['marks'],
            data['coords']['gridWidthPct'], data['coords']['cellPct']))


if __name__ == '__main__':
    main()