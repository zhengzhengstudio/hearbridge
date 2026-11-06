# -*- coding: utf-8 -*-
"""棋盘底图生成的共用工具。

目前只放一件事：Chrome 无头渲染容错。

坑：新版 Chrome（--headless=new）截图写出后**不一定主动退出**，
subprocess.run 会一直等到超时甚至被外部 kill，表现为「脚本卡住不动」。
gen_junqi_board 已经踩过这个坑并自行实现了一份，这里抽成共用函数，
所有 gen_*.py 统一调用，避免每张棋盘各写一遍略有差异的版本。

约定：只要截图文件已落盘就算成功。
"""

import os
import subprocess

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def render_with_chrome(html, raw, width, height, timeout=60, tag='board'):
    """用 Chrome 无头把 html 渲染成 raw 截图。

    - 超时但截图已生成 → 视为成功，杀掉 Chrome 自身即可
    - 超时且无截图 / 非零退出且无截图 → 抛错

    环境变量 ZZ_CHROME_PROFILE 可指定 user-data-dir（避免多实例抢同一个 profile）。
    """
    if os.path.exists(raw):
        os.remove(raw)
    profile = os.environ.get('ZZ_CHROME_PROFILE', f'/tmp/zz_chrome_{tag}')
    args = [
        CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
        f'--user-data-dir={profile}',
        '--hide-scrollbars', '--force-device-scale-factor=1',
        f'--window-size={width},{height}',
        '--virtual-time-budget=3000',
        f'--screenshot={raw}', f'file://{html}',
    ]
    proc = None
    try:
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        code = proc.wait(timeout=timeout)
        if code != 0 and not os.path.exists(raw):
            raise RuntimeError(f'Chrome 退出码 {code}，且未产出截图: {raw}')
    except subprocess.TimeoutExpired:
        if not os.path.exists(raw):
            raise RuntimeError(f'Chrome 超时且未产出截图: {raw}')
    finally:
        if proc and proc.poll() is None:
            proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
    if not os.path.exists(raw):
        raise RuntimeError(f'未生成截图: {raw}')
    return raw


def flatten_to_png(raw, png, colors=192):
    """截图 → 白底合成 → 量化 → 存 png，并清掉中间 raw。"""
    from PIL import Image
    im = Image.open(raw).convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert('RGB')
    im.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE) \
        .convert('RGB').save(png, 'PNG', optimize=True)
    try:
        os.remove(raw)
    except OSError:
        pass
    return png, os.path.getsize(png), im.size