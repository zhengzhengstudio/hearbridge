#!/usr/bin/env bash
# 棋盘底图同步脚本
#
# 背景：棋盘 PNG 由离线版 scripts/ 下的生成器产出，但**在线版与离线版是两个独立工程**，
#       两边的 base/media/ 必须保持 md5 一致，否则会出现「改了代码但某个端还是旧图」。
#       历史上就真实发生过一次：改了离线版忘了同步在线版，构建出的包仍是旧图。
#
# 用法：
#   ./sync_board_artworks.sh              # 只同步 + 校验（不重新渲染）
#   ./sync_board_artworks.sh --render     # 先跑生成器重新出图，再同步 + 校验
#   ./sync_board_artworks.sh --render go  # 只重渲 go（go_board_13/19 + gobang_board）
#
# 退出码：0 = 全部一致；1 = 存在不一致（不会静默放过）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ 的上一级 = 离线版工程根；再上一级 = HarmonyOS-App/；再上一级 = 仓库根
# （2026-10-22 修正：原来写的是 ../..，实际只到 HarmonyOS-App/，
#  导致所有底图都"离线版不存在，跳过"，脚本却照样打印"全部一致 ✅"——静默失效）
PROJ="$(cd "$SCRIPT_DIR/.." && pwd)"
HARMONY="$(cd "$PROJ/.." && pwd)"
TRAE="$(cd "$HARMONY/.." && pwd)"
OFFLINE_MEDIA="$PROJ/entry/src/main/resources/base/media"
ONLINE_MEDIA="$HARMONY/ZhengZhengBoardGamesHarmony/entry/src/main/resources/base/media"

PY="${PY:-/Users/ljg/.workbuddy/binaries/python/envs/default/bin/python}"
[ -x "$PY" ] || PY="$(command -v python3)"

# 需要保持两端一致的棋盘底图（在线版没有中国跳棋，跳棋仅离线版使用）
BOARDS=(go_board_13.png go_board_19.png gobang_board.png xiangqi_board.png
        junqi_board.png ludo_board.png checkers_board.png reversi_board.png
        tictactoe_board.png)
# 仅离线版使用
OFFLINE_ONLY=(jump_board.png)

# Android 端也要同一张底图。2026-10-22 之前**没有任何脚本同步到 Android**，
# 结果 Android 装到的是一张弧形错误图，而鸿蒙装的是经典十字图 —— 三端长得不一样。
# 现在把 Android 纳入同步与校验范围。
ANDROID_RES="$TRAE/MultipleBoardGamesAndroid/app/src/main/res/drawable-nodpi"
ANDROID_BOARDS=(ludo_board.png)

RENDER=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --render) RENDER=1 ;;
    go)       RENDER=1; ONLY="go" ;;
  esac
done

echo "离线版底图: $OFFLINE_MEDIA"
echo "在线版底图: $ONLINE_MEDIA"
echo

if [ "$RENDER" = "1" ]; then
  if [ "$ONLY" = "go" ]; then
    # 围棋/五子棋用 ImageGen 木纹 + 程序网格的生成器（gen_board_artwork.py），
    # 军棋/跳棋/飞行棋用 Chrome 渲染的 HTML 生成器。
    echo "→ 重渲 围棋13/19 + 五子棋 (gen_board_artwork.py)"
    "$PY" "$SCRIPT_DIR/gen_board_artwork.py" || exit 1
  else
    echo "→ 重渲 全部 HTML 类棋盘"
    for g in gen_junqi_board.py gen_jump_board.py gen_ludo_board.py; do
      [ -f "$SCRIPT_DIR/$g" ] || continue
      echo "  - $g"
      "$PY" "$SCRIPT_DIR/$g" || exit 1
    done
    "$PY" "$SCRIPT_DIR/gen_board_artwork.py" || exit 1
  fi
  echo
fi

echo "=== 同步到在线版 ==="
fail=0
for f in "${BOARDS[@]}"; do
  src="$OFFLINE_MEDIA/$f"
  [ -f "$src" ] || { echo "  ❌ $f 离线版不存在（不能静默跳过，否则构建出来还是旧图）"; fail=1; continue; }
  dst="$ONLINE_MEDIA/$f"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  ha=$(md5 -q "$src" | cut -c1-10)
  hb=$(md5 -q "$dst" | cut -c1-10)
  if [ "$ha" = "$hb" ]; then
    printf "  ✅ %-22s %s\n" "$f" "$ha"
  else
    printf "  ❌ %-22s 离线 %s 在线 %s\n" "$f" "$ha" "$hb"
    fail=1
  fi
done

echo
echo "=== 仅离线版棋盘（不需同步）==="
for f in "${OFFLINE_ONLY[@]}"; do
  src="$OFFLINE_MEDIA/$f"
  [ -f "$src" ] && printf "  ➖ %-22s %s\n" "$f" "$(md5 -q "$src" | cut -c1-10)"
done

echo
echo "=== 同步到 Android ==="
for f in "${ANDROID_BOARDS[@]}"; do
  src="$OFFLINE_MEDIA/$f"
  if [ ! -f "$src" ]; then
    echo "  ⚠️  $f 离线版不存在，跳过"; continue
  fi
  if [ ! -d "$ANDROID_RES" ]; then
    echo "  ⚠️  Android 资源目录不存在: $ANDROID_RES"; fail=1; continue
  fi
  cp "$src" "$ANDROID_RES/$f"
  ha=$(md5 -q "$src" | cut -c1-10)
  hb=$(md5 -q "$ANDROID_RES/$f" | cut -c1-10)
  if [ "$ha" = "$hb" ]; then
    printf "  ✅ %-22s %s\n" "$f" "$ha"
  else
    printf "  ❌ %-22s 离线 %s Android %s\n" "$f" "$ha" "$hb"
    fail=1
  fi
done

echo
if [ "$fail" = "0" ]; then
  echo "全部一致 ✅"
else
  echo "存在不一致 ❌ —— 不要跳过这一步直接构建，否则某个端会装到旧图" >&2
fi
exit $fail
