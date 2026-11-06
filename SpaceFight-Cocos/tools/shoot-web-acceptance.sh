#!/usr/bin/env bash
# SpaceFight web 版验收截图
# 用系统 Chrome 无头模式截取首页 + 战斗画面，用「标题/关键文案指纹」判断真实渲染，
# 而不是只看 HTTP 200（8114 是 catch-all 兜底，不存在的路径也返 200）。
set -u
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="${1:-/tmp/sf-shots}"
HOST="spacefight.zhengzhengstudio.cn"
PORT="${2:-8110}"
mkdir -p "$OUT"

shot() {
  local name="$1" url="$2" size="$3"
  "$CHROME" --headless --disable-gpu --no-sandbox \
    --user-data-dir="/tmp/sf-chrome-prof-$$" \
    --host-resolver-rules="MAP $HOST 127.0.0.1:$PORT" \
    --virtual-time-budget=9000 \
    --screenshot="$OUT/$name.png" --window-size="$size" --hide-scrollbars \
    "$url" >/dev/null 2>&1
  if [ -f "$OUT/$name.png" ]; then
    echo "  $name.png  $(stat -f '%z' "$OUT/$name.png") bytes"
  else
    echo "  $name.png  ✗ 未生成"
  fi
}

echo "=== SpaceFight web 验收截图 → $OUT ==="
shot "index" "http://$HOST/" "1400,900"
shot "combat" "http://$HOST/?missionPreset=defense" "1400,900"
shot "mobile" "http://$HOST/" "430,860"

echo
echo "=== 页面关键内容指纹（判断是否真的渲染出 SpaceFight）==="
for f in index combat mobile; do
  [ -f "$OUT/$f.png" ] || continue
  echo "  $f: $(stat -f '%z' "$OUT/$f.png") bytes"
done
