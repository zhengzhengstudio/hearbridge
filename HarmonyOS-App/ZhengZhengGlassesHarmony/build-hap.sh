#!/bin/bash
# 眼镜 HarmonyOS 构建脚本（模型照 SpaceFightHarmony/build-hap.sh）
# 注意：本机未配置 Release Profile 签名材料，这里只出【未签名】HAP 用于编译验证。
# 真机安装/上架需另行用 matching 包名的 Release Profile 签名（hap-sign-tool verify-app）。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/ZhengZhengGlassesHarmony-build"
DEVECO_APP="${DEVECO_APP:-/Applications/Deveco-Studio.app}"

if [ ! -d "$DEVECO_APP" ]; then
  echo "未找到 DevEco Studio，请设置 DEVECO_APP：$DEVECO_APP" >&2
  exit 1
fi

VERSION="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
HAP_NAME="ZhengZhengGlasses-HarmonyOS-v${VERSION:-test}-unsigned.hap"

rm -rf "$BUILD_DIR"
ditto "$PROJECT_DIR" "$BUILD_DIR"

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

(
  cd "$BUILD_DIR"
  # WorkBuddy 给所有 node 进程注入了 broker 垫片（NODE_OPTIONS --require），
  # 会 hook fs 并把 hvigor 的日志转发到不在线 broker 导致构建超时。
  # hvigorw 是 node 脚本，必须先清掉这些注入再启动。
  unset NODE_OPTIONS
  unset CODEBUDDY_BROKERED_FS_HOOK_ENABLED
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap \
    --mode module \
    -p product=default \
    -p module=entry@default \
    -p buildMode=release \
    --no-daemon
)

# 未签名产物可能在 default 或 release 子目录
OUTPUT="$(find "$BUILD_DIR/entry/build" -name '*.hap' 2>/dev/null | head -1)"
if [ -z "$OUTPUT" ]; then
  echo "构建完成，但未找到 HAP 产物" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/release"
ditto "$OUTPUT" "$PROJECT_DIR/release/$HAP_NAME"
echo "已构建未签名 HAP：$PROJECT_DIR/release/$HAP_NAME"
echo "sha256: $(shasum -a 256 "$PROJECT_DIR/release/$HAP_NAME" | awk '{print $1}')"
stat -f 'size=%z' "$PROJECT_DIR/release/$HAP_NAME"
