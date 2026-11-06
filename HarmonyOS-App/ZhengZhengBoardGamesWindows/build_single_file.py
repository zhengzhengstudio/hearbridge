#!/usr/bin/env python3
"""把 Electron 版打成一个可以直接双击打开的单文件 HTML。

用法：python3 build_single_file.py
产物：铮铮桌游合集-Windows-单文件版.html

版本号取自 package.json，保证与桌面端一致。
"""

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "铮铮桌游合集-Windows-单文件版.html"

package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
version = package["version"]

html = (ROOT / "index.html").read_text(encoding="utf-8")

# 注入版本号（单文件版没有 preload，靠 data-version 读取）
html = re.sub(r'data-version="[^"]*"', f'data-version="{version}"', html)
if 'data-version=' not in html:
    html = html.replace('<html lang="zh-CN">', f'<html lang="zh-CN" data-version="{version}">')

# 内联样式
style = (ROOT / "assets" / "style.css").read_text(encoding="utf-8")
html = re.sub(
    r'<link rel="stylesheet" href="assets/style\.css">',
    lambda _: "<style>\n" + style + "\n</style>",
    html,
)

# 内联脚本（按 index.html 里的顺序）
script_pattern = re.compile(r'<script src="([^"]+)"></script>')


def inline(match):
    rel = match.group(1)
    code = (ROOT / rel).read_text(encoding="utf-8")
    if "</script" in code.lower():
        raise SystemExit(f"脚本里出现 </script 字面量，无法安全内联: {rel}")
    return "<script>\n" + code + "\n</script>"


html, count = script_pattern.subn(inline, html)
if count == 0:
    raise SystemExit("index.html 里没有找到可内联的 <script src>")

html = html.replace(
    "<title>铮铮桌游合集 · Windows 版</title>",
    f"<title>铮铮桌游合集 · Windows 单文件版 v{version}</title>",
)

OUT.write_text(html, encoding="utf-8")
print(f"✅ 已生成 {OUT.name}（v{version}，内联 {count} 个脚本，{len(html) / 1024:.0f} KB）")
