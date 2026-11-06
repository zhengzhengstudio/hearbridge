#!/usr/bin/env bash
# 棋盘底图一键同步 + 校验
#
# 背景（踩过的坑）：gen_*.py 生成的新图落在 ZhengZhengBoardGamesHarmonyOffline/scripts/ 下，
# 如果不手动拷进 entry/src/main/resources/base/media/，构建出来的包还是旧图 ——
# 表现为「代码改了但游戏里没变化」。本脚本负责：
#   1. 重新生成全部棋盘底图（Chrome 无头渲染，超时自动收尾）
#   2. 同步到离线版 / 在线版两个工程的 base/media/
#   3. 用 md5 校验三处完全一致，并输出对照表
#
# 用法：
#   ./scripts/sync_board_artworks.sh              # 重新生成 + 同步 + 校验
#   ./scripts/sync_board_artworks.sh --no-render  # 只同步已有图，不重新渲染
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/HarmonyOS-App"
OFFLINE="$APP/ZhengZhengBoardGamesHarmonyOffline"
ONLINE="$APP/ZhengZhengBoardGamesHarmony"
GEN_DIR="$OFFLINE/scripts"          # 生成器与产出图都在这里
PY="${ZZ_PYTHON:-/Users/ljg/.workbuddy/binaries/python/envs/default/bin/python}"
NO_RENDER=0
if [[ "${1:-}" == "--no-render" ]]; then
  NO_RENDER=1
fi

if [[ ! -x "$PY" ]]; then
  echo "❌ 找不到 Python: $PY" >&2
  echo "   可用 ZZ_PYTHON=<python> 覆盖，或先执行：" >&2
  echo "   /Users/ljg/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m venv \\" >&2
  echo "     /Users/ljg/.workbuddy/binaries/python/envs/default && \\" >&2
  echo "     ${PY} -m pip install pillow" >&2
  exit 1
fi

GENERATORS=(gen_ludo_board gen_junqi_board gen_jump_board gen_go_board)
ARTWORKS=(ludo_board junqi_board jump_board go_board_13 go_board_19 gobang_board)

echo "▸ 生成棋盘底图（${GEN_DIR}）"
# 注意：空数组在 `set -u` 下用 "${ARR[@]}" 展开会报 unbound variable，
# 所以这里用 NO_RENDER 标志 + 显式分支，不用数组。
for gen in "${GENERATORS[@]}"; do
  [[ -f "$GEN_DIR/$gen.py" ]] || { echo "  - 跳过 ${gen}.py（不存在）"; continue; }
  rm -rf "/tmp/zz_chrome_${gen}"
  if [[ "$NO_RENDER" == "1" ]]; then
    echo "  - ${gen}.py（仅导出坐标，不渲染）"
    ZZ_CHROME_PROFILE="/tmp/zz_chrome_${gen}" "$PY" "$GEN_DIR/$gen.py" --no-render >/dev/null
  else
    echo "  - ${gen}.py"
    ZZ_CHROME_PROFILE="/tmp/zz_chrome_${gen}" "$PY" "$GEN_DIR/$gen.py" >/dev/null
  fi
done

echo "▸ 同步到 base/media"
for art in "${ARTWORKS[@]}"; do
  src="$GEN_DIR/$art.png"
  [[ -f "$src" ]] || { echo "  - $art.png 缺失，跳过"; continue; }
  for target in "$OFFLINE" "$ONLINE"; do
    dst="$target/entry/src/main/resources/base/media/$art.png"
    if ! cmp -s "$src" "$dst"; then
      cp "$src" "$dst"
      echo "  ✓ 更新 $(basename "$(dirname "$(dirname "$(dirname "$(dirname "$dst")")")")")/…/$art.png"
    fi
  done
done

echo "▸ 校验 md5（scripts / 离线版 / 在线版）"
fail=0
printf "  %-16s %-34s %-34s %s\n" "文件" "scripts" "离线版" "在线版"
for art in "${ARTWORKS[@]}"; do
  src="$GEN_DIR/$art.png"
  [[ -f "$src" ]] || continue
  a=$(md5 -q "$src")
  b=$(md5 -q "$OFFLINE/entry/src/main/resources/base/media/$art.png" 2>/dev/null || echo "-")
  c=$(md5 -q "$ONLINE/entry/src/main/resources/base/media/$art.png" 2>/dev/null || echo "-")
  flag="✅"
  [[ "$a" == "$b" && "$a" == "$c" ]] || { flag="❌ 不一致"; fail=1; }
  printf "  %-16s %-34s %-34s %s\n" "$art.png" "${a:0:8}" "${b:0:8}" "${c:0:8}  $flag"
done

if ((fail)); then
  echo "❌ 存在未同步的底图，构建前必须先同步，否则包内仍是旧图" >&2
  exit 1
fi
echo "✅ 全部棋盘底图已同步一致，可以构建"