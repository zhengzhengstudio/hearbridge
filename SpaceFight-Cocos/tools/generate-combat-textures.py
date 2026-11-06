#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 SpaceFight 的战斗视觉贴图（星空 / 爆炸 / 炮口火光 / 命中火花）。

背景（2026-10-23）：
  之前战斗场景**没有任何贴图** —— 背景是相机清屏纯色 + 线性雾，
  爆炸是「球 + 环」的纯几何体，子弹是纯色小球。
  3D 子弹和爆炸完全不用贴图，所以想提升观感必须新建一套贴图方案，
  而不是替换现有 PNG（现有 PNG 只有武器图标和菜单大图）。

产物（放进 assets/resources/textures/，由 Cocos 导入）：
  starfield.png      2048×1024 等距柱状投影星空 + 星云带 → 贴在内翻球壳上当背景
  explosion.png      256×256  火球（白热核心 → 橙 → 红 → 透明）+ 湍流噪声
  muzzle-flash.png   128×128  四芒星炮口火光
  spark.png          128×128  命中火花（软圆晕）

用法：python3 tools/generate-combat-textures.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "resources", "textures")


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(width, height, cells, seed):
    """低频 value noise（双线性插值的随机格点）。"""
    rng = random.Random(seed)
    grid_w = cells + 2
    grid_h = cells + 2
    points = [[rng.random() for _ in range(grid_w)] for _ in range(grid_h)]

    def sample(x, y):
        gx = x / width * cells
        gy = y / height * cells
        x0, y0 = int(gx), int(gy)
        fx, fy = smooth(gx - x0), smooth(gy - y0)
        p00 = points[y0 % grid_h][x0 % grid_w]
        p10 = points[y0 % grid_h][(x0 + 1) % grid_w]
        p01 = points[(y0 + 1) % grid_h][x0 % grid_w]
        p11 = points[(y0 + 1) % grid_h][(x0 + 1) % grid_w]
        return lerp(lerp(p00, p10, fx), lerp(p01, p11, fx), fy)

    return sample


def fbm(sample, width, height, octaves=4, base=4, seed=0):
    """分形叠加噪声。"""
    out = Image.new("L", (width, height))
    px = out.load()
    amp = 1.0
    total = 0.0
    for octave in range(octaves):
        cells = base * (2 ** octave)
        for y in range(height):
            for x in range(width):
                px[x, y] += int(sample(x, y) * amp * 255)
        total += amp
        amp *= 0.5
    return out.point(lambda v: min(255, int(v / total * 255 / max(1e-6, 1) * 1.0)))


def make_starfield(path, width=2048, height=1024, seed=20261023):
    """等距柱状投影星空：深蓝底 + 银河带 + 疏密不一的星点。"""
    rng = random.Random(seed)
    img = Image.new("RGB", (width, height), (4, 8, 18))
    px = img.load()

    # 垂直渐变：上深下略亮，避免纯色死板
    for y in range(height):
        t = y / height
        r = int(lerp(3, 10, t))
        g = int(lerp(7, 16, t))
        b = int(lerp(18, 32, t))
        for x in range(width):
            px[x, y] = (r, g, b)

    # 银河带（沿倾斜方向的一条噪声亮带）
    noise = value_noise(width, height, 6, seed + 1)
    band = Image.new("L", (width, height))
    band_px = band.load()
    for y in range(height):
        for x in range(width):
            band_y = y / height * 2 - 1
            band_x = x / width * 2 - 1
            # 一条斜穿画面的带子
            distance = abs(band_y - band_x * 0.35)
            falloff = max(0.0, 1.0 - distance / 0.34)
            cloud = noise(x, y)
            band_px[x, y] = int(falloff * falloff * cloud * 190)
    band = band.filter(ImageFilter.GaussianBlur(9))
    for y in range(height):
        for x in range(width):
            v = band_px[x, y] / 255.0
            if v <= 0.002:
                continue
            pr, pg, pb = px[x, y]
            px[x, y] = (
                min(255, int(pr + v * 46)),
                min(255, int(pg + v * 40)),
                min(255, int(pb + v * 62)),
            )

    # 星点：大部分暗弱，少数明亮
    stars = 0
    for _ in range(9000):
        x = rng.randrange(width)
        y = rng.randrange(height)
        brightness = rng.random()
        if brightness > 0.985:
            value, tint = 235, (215, 230, 255)
        elif brightness > 0.9:
            value, tint = 165, (225, 238, 255)
        elif brightness > 0.6:
            value, tint = 105, (210, 228, 255)
        else:
            value, tint = 62, (200, 220, 255)
        px[x, y] = (min(255, tint[0] + value // 6), min(255, tint[1] + value // 6), min(255, tint[2]))
        stars += 1
        # 亮星带一点十字光芒
        if brightness > 0.985:
            for dx in range(-2, 3):
                if 0 <= x + dx < width:
                    px[x + dx, y] = (200, 214, 255)
            for dy in range(-2, 3):
                if 0 <= y + dy < height:
                    px[x, y + dy] = (200, 214, 255)

    img.save(path)
    print(f"  ✅ {os.path.basename(path)}  {img.size}  {stars} 颗星")


def make_explosion(path, size=256, seed=7):
    """火球：白热核心 → 橙 → 红 → 透明，边缘带湍流噪声。"""
    rng = random.Random(seed)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    center = size / 2
    for y in range(size):
        for x in range(size):
            dx = (x - center) / center
            dy = (y - center) / center
            dist = math.hypot(dx, dy)
            if dist > 1:
                continue
            # 噪声让边缘不规则，像真实火焰
            wobble = 1.0 + 0.16 * math.sin(math.atan2(dy, dx) * 5 + dist * 7)
            t = dist / wobble
            if t >= 1:
                continue
            core = max(0.0, 1.0 - t / 0.34)
            mid = max(0.0, 1.0 - abs(t - 0.45) / 0.42)
            alpha = max(0.0, min(1.0, 1.0 - t))
            alpha = alpha ** 0.72
            r = int(min(255, 255 * (0.35 + 0.65 * core) * (1.0 - 0.25 * mid)))
            g = int(min(255, 190 * (0.22 + 0.78 * core) * (1.0 - 0.45 * mid)))
            b = int(min(255, 60 * core * (1.0 - 0.7 * mid)))
            px[x, y] = (r, g, b, int(alpha * 255))
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    # 加几块更亮的碎片斑
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(26):
        angle = rng.random() * math.tau
        rad = rng.random() * center * 0.62
        x = center + math.cos(angle) * rad
        y = center + math.sin(angle) * rad
        s = rng.uniform(3, 11)
        draw.ellipse([x - s, y - s, x + s, y + s], fill=(255, 226, 150, rng.randint(90, 190)))
    img.save(path)
    print(f"  ✅ {os.path.basename(path)}  {img.size}")


def make_muzzle_flash(path, size=128):
    """四芒星炮口火光：白热中心 + 横向长条 + 斜向短芒。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    center = size / 2
    for y in range(size):
        for x in range(size):
            dx = (x - center) / center
            dy = (y - center) / center
            dist = math.hypot(dx, dy)
            if dist > 1:
                continue
            core = max(0.0, 1.0 - dist / 0.3)
            horizontal = max(0.0, 1.0 - abs(dy) / 0.09) * max(0.0, 1.0 - abs(dx) / 0.92)
            diagonal = max(0.0, 1.0 - abs(abs(dx) - abs(dy)) / 0.08) * max(0.0, 1.0 - dist / 0.78)
            value = min(1.0, core + horizontal * 0.95 + diagonal * 0.55)
            alpha = int(min(1.0, value ** 0.8) * 255)
            r = 255
            g = int(min(255, 150 + 105 * core))
            b = int(min(255, 60 + 195 * core))
            px[x, y] = (r, g, b, alpha)
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    img.save(path)
    print(f"  ✅ {os.path.basename(path)}  {img.size}")


def make_spark(path, size=128):
    """命中火花：冷白软圆晕。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    center = size / 2
    for y in range(size):
        for x in range(size):
            dx = (x - center) / center
            dy = (y - center) / center
            dist = math.hypot(dx, dy)
            if dist > 1:
                continue
            value = (1.0 - dist) ** 2.4
            alpha = int(min(1.0, value * 1.15) * 255)
            px[x, y] = (235, 250, 255, alpha)
    img = img.filter(ImageFilter.GaussianBlur(2.0))
    img.save(path)
    print(f"  ✅ {os.path.basename(path)}  {img.size}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("生成战斗视觉贴图 →", OUT_DIR)
    make_starfield(os.path.join(OUT_DIR, "starfield.png"))
    make_explosion(os.path.join(OUT_DIR, "explosion.png"))
    make_muzzle_flash(os.path.join(OUT_DIR, "muzzle-flash.png"))
    make_spark(os.path.join(OUT_DIR, "spark.png"))
    print("完成。重新用 Cocos Creator 构建即可导入这些贴图。")


if __name__ == "__main__":
    main()
