#!/usr/bin/env python3
import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps


def contain(subject: Image.Image, width: int, height: int, scale: float = 0.84) -> Image.Image:
    canvas = Image.new("RGBA", (width, height))
    bbox = subject.getbbox()
    if not bbox:
        return canvas
    cropped = subject.crop(bbox)
    max_width = max(1, int(width * scale))
    max_height = max(1, int(height * scale))
    ratio = min(max_width / cropped.width, max_height / cropped.height)
    resized = cropped.resize(
        (max(1, round(cropped.width * ratio)), max(1, round(cropped.height * ratio))),
        Image.Resampling.LANCZOS,
    )
    canvas.alpha_composite(
        resized,
        ((width - resized.width) // 2, (height - resized.height) // 2),
    )
    return canvas


def wet_variant(base: Image.Image) -> Image.Image:
    color = Image.new("RGBA", base.size, (66, 137, 176, 0))
    color.putalpha(base.getchannel("A").point(lambda value: round(value * 0.22)))
    result = Image.alpha_composite(base, color)
    return ImageEnhance.Contrast(result).enhance(1.06)


def snow_variant(base: Image.Image) -> Image.Image:
    alpha = base.getchannel("A")
    shifted = ImageChops.offset(alpha, 0, max(2, base.height // 45))
    upper_edge = ImageChops.subtract(alpha, shifted).filter(ImageFilter.GaussianBlur(max(1, base.width // 180)))
    upper_mask = Image.new("L", base.size)
    upper_mask.paste(190, (0, 0, base.width, int(base.height * 0.58)))
    snow_mask = ImageChops.multiply(upper_edge, upper_mask)
    snow = Image.new("RGBA", base.size, (239, 247, 247, 0))
    snow.putalpha(snow_mask)
    return Image.alpha_composite(base, snow)


def depleted_variant(base: Image.Image) -> Image.Image:
    muted = ImageEnhance.Color(base).enhance(0.45)
    muted = ImageEnhance.Brightness(muted).enhance(0.76)
    return contain(muted, base.width, base.height, 0.68)


def damaged_variant(base: Image.Image) -> Image.Image:
    result = ImageEnhance.Color(base).enhance(0.65)
    result = ImageEnhance.Brightness(result).enhance(0.82)
    draw = ImageDraw.Draw(result, "RGBA")
    width, height = result.size
    for index in range(5):
        x = round(width * (0.32 + index * 0.08))
        y = round(height * (0.28 + (index % 2) * 0.11))
        draw.line(
            [(x, y), (x + width * 0.035, y + height * 0.07), (x - width * 0.01, y + height * 0.13)],
            fill=(48, 34, 25, 150),
            width=max(2, width // 160),
        )
    return result


def working_variant(base: Image.Image) -> Image.Image:
    glow_alpha = base.getchannel("A").filter(ImageFilter.GaussianBlur(max(2, base.width // 32)))
    glow = Image.new("RGBA", base.size, (244, 166, 76, 0))
    glow.putalpha(glow_alpha.point(lambda value: round(value * 0.18)))
    return Image.alpha_composite(glow, ImageEnhance.Brightness(base).enhance(1.06))


def transformed_variant(base: Image.Image, state: str) -> Image.Image:
    if state == "wet":
        return wet_variant(base)
    if state == "snow":
        return snow_variant(base)
    if state == "depleted":
        return depleted_variant(base)
    if state == "damaged":
        return damaged_variant(base)
    if state == "working":
        return working_variant(base)
    if state == "held":
        rotated = base.rotate(-18, resample=Image.Resampling.BICUBIC, expand=False)
        return contain(rotated, base.width, base.height, 0.8)
    if state == "action":
        rotated = base.rotate(20, resample=Image.Resampling.BICUBIC, expand=False)
        return contain(rotated, base.width, base.height, 0.88)
    return base


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--keys", required=True, help="comma-separated image keys in row-major order")
    parser.add_argument("--columns", type=int, required=True)
    parser.add_argument("--rows", type=int, required=True)
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    manifest = json.loads(Path(args.manifest).read_text())
    keys = [key.strip() for key in args.keys.split(",") if key.strip()]
    if len(keys) > args.columns * args.rows:
        raise ValueError("more keys than sprite cells")

    root = Path(args.manifest).resolve().parents[3]
    for index, image_key in enumerate(keys):
        column = index % args.columns
        row = index // args.columns
        left = math.floor(column * source.width / args.columns)
        right = math.floor((column + 1) * source.width / args.columns)
        top = math.floor(row * source.height / args.rows)
        bottom = math.floor((row + 1) * source.height / args.rows)
        cell = source.crop((left, top, right, bottom))
        asset = manifest["assets"][image_key]
        for state, definition in asset["variants"].items():
            if asset["kind"] == "terrain":
                base = ImageOps.fit(
                    cell,
                    (definition["width"], definition["height"]),
                    Image.Resampling.LANCZOS,
                )
            else:
                base = contain(cell, definition["width"], definition["height"])
            output = transformed_variant(base, state)
            destination = root / definition["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            optimized = output.quantize(
                colors=256,
                method=Image.Quantize.FASTOCTREE,
                dither=Image.Dither.FLOYDSTEINBERG,
            )
            optimized.save(destination, "PNG", optimize=True)
            print(destination.relative_to(root))


if __name__ == "__main__":
    main()
