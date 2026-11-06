#!/bin/bash
# 铮铮调试助手 · 鸿蒙端构建（调试/未签名包）
# 用法：bash build-hap.sh
# 产物：~/.zzda_builds/ZhengZhengDebugAssistant-HarmonyOS-v<版本>.hap
# 说明：沙箱编译到 /tmp（避开 iCloud 占位符坑）；unsigned hap 需配置签名后才能真机安装。
# 注意：产物落在 ~/.zzda_builds/（非 Desktop/iCloud 目录），避免被 macOS「优化存储」踢成 .icloud 占位符。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/ZhengZhengDebugAssistant-build"
STAGE_DIR="$HOME/.zzda_builds"
DEVECO_APP="${DEVECO_APP:-/Applications/DevEco-Studio.app}"

VERSION="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
HAP_NAME="ZhengZhengDebugAssistant-HarmonyOS-v${VERSION:-test}.hap"

if [ ! -d "$DEVECO_APP" ]; then
  echo "未找到 DevEco Studio：$DEVECO_APP（可设 DEVECO_APP 环境变量）" >&2
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

mkdir -p "$STAGE_DIR"
ditto "$OUTPUT" "$STAGE_DIR/$HAP_NAME"
# 同时落到两个网站分发目录（供全量同步读取；若被 iCloud 踢掉，上传脚本会再用 sync-file 直推兜底）
for d in "/Users/ljg/Desktop/开发者/TRAE/website/api/apps" "/Users/ljg/Desktop/开发者/TRAE/website/zhengzhengstudio.cn/api/apps"; do
  mkdir -p "$d" && cp "$STAGE_DIR/$HAP_NAME" "$d/$HAP_NAME" 2>/dev/null || true
done

echo "已构建未签名开发包：$STAGE_DIR/$HAP_NAME"
echo "unsigned 包不能直接真机安装；在 DevEco 里配好自动签名（File → Project Structure → Signing Configs）后重新出签名包。"
