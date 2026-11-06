#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/ZhengZhengStockHarmony-build"
DEVECO_APP="${DEVECO_APP:-}"
HAP_NAME="ZhengZhengStock-HarmonyOS-v1.2.0-unsigned.hap"

if [ -z "$DEVECO_APP" ]; then
  for candidate in \
    "/Applications/DevEco-Studio.app" \
    "/Volumes/DevEco-Studio/DevEco-Studio.app"
  do
    if [ -d "$candidate" ]; then
      DEVECO_APP="$candidate"
      break
    fi
  done
fi

if [ -z "$DEVECO_APP" ] || [ ! -d "$DEVECO_APP" ]; then
  echo "未找到 DevEco Studio，请安装到 /Applications 或设置 DEVECO_APP。" >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
ditto "$PROJECT_DIR" "$BUILD_DIR"

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export JAVA_HOME="$DEVECO_APP/Contents/jbr/Contents/Home"
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v22.17.1/bin/node}"

(
  cd "$BUILD_DIR"
  "$NODE_BIN" "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw.js" assembleHap \
    --mode module \
    -p product=default \
    -p module=entry@default \
    -p buildMode=debug \
    --no-daemon
)

OUTPUT="$BUILD_DIR/entry/build/default/outputs/default/entry-default-unsigned.hap"
if [ ! -f "$OUTPUT" ]; then
  echo "构建完成，但未找到 HAP：$OUTPUT" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/entry/build/default/outputs/default"
ditto "$OUTPUT" "$PROJECT_DIR/entry/build/default/outputs/default/$HAP_NAME"
ditto "$OUTPUT" "$PROJECT_DIR/entry/build/default/outputs/default/entry-default-unsigned.hap"
ditto "$OUTPUT" "$HOME/Downloads/$HAP_NAME"

echo "已构建未签名开发包：$HOME/Downloads/$HAP_NAME"
echo "此文件不能直接真机安装；配置并保持同一 HarmonyOS 签名后，才可覆盖升级。"
