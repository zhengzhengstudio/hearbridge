#!/usr/bin/env python3
"""检测国内版飞行棋参考图上的白色圆点（棋位），输出中心坐标。"""

import numpy as np
from PIL import Image

REF = "/Users/ljg/Desktop/开发者/TRAE/.workbuddy/board-preview/ref/ludo-cn-sohu.jpeg"


def main() -> None:
    im = Image.open(REF).convert("RGB")
    a = np.asarray(im).astype(int)
    white = (a[:, :, 0] > 232) & (a[:, :, 1] > 232) & (a[:, :, 2] > 232)
    h, w = white.shape
    labels = np.zeros((h, w), dtype=int)
    cur = 0
    comps = []
    from collections import deque
    ys, xs = np.nonzero(white)
    for y0, x0 in zip(ys, xs):
        if labels[y0, x0]:
            continue
        cur += 1
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
        pix_arr = np.array(pix)
        area = len(pix)
        if area < 150 or area > 1200:
            continue
        ymin, xmin = pix_arr.min(axis=0)
        ymax, xmax = pix_arr.max(axis=0)
        bw, bh = xmax - xmin + 1, ymax - ymin + 1
        if not (14 <= bw <= 40 and 14 <= bh <= 40):
            continue
        if bw / bh > 1.6 or bh / bw > 1.6:
            continue
        cy, cx = pix_arr.mean(axis=0)
        comps.append((round(cx, 1), round(cy, 1), area))
    comps.sort(key=lambda c: (c[1], c[0]))
    print(f"共 {len(comps)} 个白点")
    for cx, cy, area in comps:
        print(f"  ({cx},{cy}) a={area}")


if __name__ == "__main__":
    main()
