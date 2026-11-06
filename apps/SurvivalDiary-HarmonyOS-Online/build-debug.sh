#!/bin/bash
set -Eeuo pipefail
set +x
umask 077

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"
DEVECO_APP="${DEVECO_APP:-/Applications/DevEco-Studio.app}"
PUBLISH_DIR="${PUBLISH_DIR:-$ROOT/website/api/apps}"
PUBLIC_PUBLISH_DIR="${PUBLIC_PUBLISH_DIR:-$ROOT/website/zhengzhengstudio.cn/api/apps}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$PROJECT_DIR/Artifacts}"
BUNDLE_NAME="cn.zhengzhengstudio.survivaldiary.hmos"
BUILD_DIR=""

mode="${1:---debug}"
BUILD_MODE="debug"
case "$mode" in
  --release) BUILD_MODE="release" ;;
  --debug) BUILD_MODE="debug" ;;
  *) echo "usage: $0 --debug|--release" >&2; exit 2 ;;
esac

cleanup() {
  local status=$?
  if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then rm -rf -- "$BUILD_DIR"; fi
  return "$status"
}
trap cleanup EXIT INT TERM HUP

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -x "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" ] || fail "未找到 DevEco Studio：$DEVECO_APP"

APP_JSON="$PROJECT_DIR/AppScope/app.json5"
VERSION_NAME="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_JSON" | head -1)"
VERSION_CODE="$(sed -n 's/.*"versionCode":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$APP_JSON" | head -1)"
[ -n "$VERSION_NAME" ] && [ -n "$VERSION_CODE" ] || fail '无法读取应用版本'

BUILD_DIR="$(mktemp -d /tmp/survival-diary-harmony-online-build.XXXXXX)"
FAKE_HOME="$BUILD_DIR/.home"
CACHE_DIR="$BUILD_DIR/.cache"
mkdir -p "$FAKE_HOME" "$CACHE_DIR"
rsync -a --exclude '.idea' --exclude '.hvigor' --exclude 'build' --exclude 'entry/build' --exclude 'entry/.preview' "$PROJECT_DIR/" "$BUILD_DIR/"

export HOME="$FAKE_HOME"
export HAP_CACHE_DIR="$CACHE_DIR"
export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export NODE_HOME="$DEVECO_APP/Contents/tools/node"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

printf '构建 %s %s (%s) mode=%s\n' "$BUNDLE_NAME" "$VERSION_NAME" "$VERSION_CODE" "$BUILD_MODE"
(
  cd "$BUILD_DIR"
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" clean --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap --mode module -p product=default -p module=entry@default -p buildMode="$BUILD_MODE" --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleApp --mode project -p product=default -p buildMode="$BUILD_MODE" --no-daemon
)

HAP_UNSIGNED="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*.hap' -print | sort | tail -1)"
APP_UNSIGNED="$(find "$BUILD_DIR/build/outputs/default" -maxdepth 1 -type f -name '*.app' -print | sort | tail -1)"
[ -f "$HAP_UNSIGNED" ] || fail '未找到 HAP'
[ -f "$APP_UNSIGNED" ] || fail '未找到 APP'

mkdir -p "$PUBLISH_DIR"
SUFFIX=""
# Keep unsigned Debug artifacts explicit and avoid colliding with an iCloud
# placeholder left behind by an earlier package with the generic -debug name.
[ "$BUILD_MODE" = "debug" ] && SUFFIX="-unsigned-debug"
HAP_NAME="SurvivalDiary-HarmonyOS-Online-v${VERSION_NAME}-b${VERSION_CODE}${SUFFIX}.hap"
APP_NAME="SurvivalDiary-HarmonyOS-Online-v${VERSION_NAME}-b${VERSION_CODE}${SUFFIX}.app"
HAP_OUT="$PUBLISH_DIR/$HAP_NAME"
APP_OUT="$PUBLISH_DIR/$APP_NAME"

cp -f "$HAP_UNSIGNED" "$HAP_OUT"
cp -f "$APP_UNSIGNED" "$APP_OUT"
shasum -a 256 "$HAP_OUT" | sed "s#  .*#  $HAP_NAME#" > "$HAP_OUT.sha256"
shasum -a 256 "$APP_OUT" | sed "s#  .*#  $APP_NAME#" > "$APP_OUT.sha256"

mkdir -p "$PUBLIC_PUBLISH_DIR" "$ARTIFACT_DIR"
for publish_root in "$PUBLIC_PUBLISH_DIR" "$ARTIFACT_DIR"; do
  cp -f "$HAP_OUT" "$publish_root/$HAP_NAME"
  cp -f "$APP_OUT" "$publish_root/$APP_NAME"
  shasum -a 256 "$publish_root/$HAP_NAME" | sed "s#  .*#  $HAP_NAME#" > "$publish_root/$HAP_NAME.sha256"
  shasum -a 256 "$publish_root/$APP_NAME" | sed "s#  .*#  $APP_NAME#" > "$publish_root/$APP_NAME.sha256"
done

printf 'UNSIGNED_HAP=%s\nUNSIGNED_APP=%s\n' "$HAP_OUT" "$APP_OUT"
shasum -a 256 "$HAP_OUT" "$APP_OUT"
