#!/usr/bin/env python3
"""鸿蒙桌游资源瘦身：删死资源、去掉 phone/tablet 重复图标、棋盘图降分辨率 + 量化。

用法：
  python3 slim_boardgames_media.py ZhengZhengBoardGamesHarmonyOffline
  python3 slim_boardgames_media.py ZhengZhengBoardGamesHarmony

改动会同时同步到 ~/Library/Caches/zhengzheng-boardgames-media/<项目名>/，
否则 build-hap.sh 的 restore_media_from_cache 会把旧图覆盖回来。
"""
import os
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path("/Users/ljg/Desktop/开发者/TRAE/HarmonyOS-App")
CACHE_ROOT = Path.home() / "Library/Caches/zhengzheng-boardgames-media"

# 没有任何 Builder 引用的底图（boardArtwork 只被 reversi/tictactoe/chess/checkers/ludo 使用）
DEAD_MEDIA = {"card_table.png", "property_board.png", "rummy_table.png"}
BOARD_SIZE = 800          # 棋盘底图最长显示 720px，800 足够
BOARD_COLORS = 256
# phone / tablet 只是 base 的拷贝，删掉后自动回退 base，省掉两份 1024 图标
DUP_ICON_DIRS = ("phone", "tablet")
DUP_ICON_FILES = ("app_icon.png", "startIcon.png", "foreground.png", "background.png")


def human(size: int) -> str:
    return f"{size / 1048576:.2f} MB"


def slim_png(path: Path, target: int, colors: int) -> tuple:
    """返回 (原大小, 新大小)。"""
    original = path.stat().st_size
    image = Image.open(path).convert("RGB")
    if max(image.size) > target:
        image = image.resize((target, target), Image.LANCZOS)
    image = image.quantize(colors=colors, method=Image.MEDIANCUT).convert("RGB")
    image.save(path, "PNG", optimize=True)
    return original, path.stat().st_size


def main() -> None:
    project = sys.argv[1]
    project_dir = ROOT / project
    cache_dir = CACHE_ROOT / project
    backup_dir = Path(f"/tmp/media_backup_{project}")
    if backup_dir.exists():
        shutil.rmtree(backup_dir)
    backup_dir.mkdir(parents=True)

    saved = 0
    for media_dir in sorted(project_dir.glob("*/src/main/resources/*/media")) + \
                     sorted(project_dir.glob("AppScope/resources/*/media")):
        rel = media_dir.relative_to(project_dir)
        backup_target = backup_dir / rel
        backup_target.mkdir(parents=True, exist_ok=True)
        for png in media_dir.glob("*.png"):
            shutil.copy2(png, backup_target / png.name)

    # 1) 删死资源
    for media_dir in sorted(project_dir.glob("*/src/main/resources/base/media")):
        for name in DEAD_MEDIA:
            victim = media_dir / name
            if victim.exists():
                saved += victim.stat().st_size
                victim.unlink()
                print(f"  删除死资源 {victim.relative_to(project_dir)}")
                cached = cache_dir / name
                if cached.exists():
                    cached.unlink()

    # 2) 删 phone / tablet 的重复图标（保留 base）
    for qualifier in DUP_ICON_DIRS:
        for media_dir in list(project_dir.glob(f"*/src/main/resources/{qualifier}/media")) + \
                         list(project_dir.glob(f"AppScope/resources/{qualifier}/media")):
            for name in DUP_ICON_FILES:
                victim = media_dir / name
                if victim.exists():
                    saved += victim.stat().st_size
                    victim.unlink()
                    print(f"  删除重复图标 {victim.relative_to(project_dir)}")

    # 3) 棋盘图降分辨率 + 量化
    for media_dir in sorted(project_dir.glob("*/src/main/resources/base/media")):
        for png in sorted(media_dir.glob("*_board.png")):
            if max(Image.open(png).size) <= BOARD_SIZE and png.stat().st_size < 400 * 1024:
                continue
            before, after = slim_png(png, BOARD_SIZE, BOARD_COLORS)
            saved += before - after
            print(f"  压缩 {png.name}: {human(before)} -> {human(after)}")
            cached = cache_dir / png.name
            if cached.exists():
                shutil.copy2(png, cached)
            icon_cache = cache_dir / "_icons" / png.name
            if icon_cache.exists():
                shutil.copy2(png, icon_cache)

    # 4) 同步图标缓存（base 图标没变，但确保缓存与工程一致）
    for name in DUP_ICON_FILES:
        source = project_dir / "entry/src/main/resources/base/media" / name
        if not source.exists():
            continue
        for target in (cache_dir / name, cache_dir / "_icons" / name):
            if target.exists() and not shutil.__dict__.get("_never"):
                shutil.copy2(source, target)

    print(f"{project}: 累计省下 {human(saved)}（原图已备份到 {backup_dir}）")


if __name__ == "__main__":
    main()
