#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/SpaceFightHarmonyOffline-build"
DEVECO_APP="${DEVECO_APP:-}"
if [ -z "$DEVECO_APP" ]; then
  if [ -d "/Applications/DevEco-Studio.app" ]; then
    DEVECO_APP="/Applications/DevEco-Studio.app"
  else
    DEVECO_APP="/Volumes/DevEco-Studio/DevEco-Studio.app"
  fi
fi
VERSION="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
HAP_NAME="SpaceFight-HarmonyOS-Offline-v${VERSION:-test}.hap"

if [ ! -d "$DEVECO_APP" ]; then
  echo "未找到 DevEco Studio，请设置 DEVECO_APP 指向 DevEco-Studio.app：$DEVECO_APP" >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
ditto "$PROJECT_DIR" "$BUILD_DIR"

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

(
  cd "$BUILD_DIR"
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap \
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
ditto "$OUTPUT" "$HOME/Downloads/$HAP_NAME"

echo "已构建未签名开发包：$HOME/Downloads/$HAP_NAME"
echo "此文件不能直接真机安装；配置并保持同一 HarmonyOS 签名后，才可覆盖升级。"
