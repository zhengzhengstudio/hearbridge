#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/HarmonyOS-App/BatteryOrganizerHarmony"
BUILD_DIR="${HARMONY_BUILD_DIR:-$HOME/Downloads/BatteryOrganizerHarmonyBuild}"
OUT_DIR="${HARMONY_OUT_DIR:-$HOME/Downloads}"
DEVECO_APP="${DEVECO_APP:-/Applications/DevEco-Studio.app}"
SDK_HOME="${DEVECO_SDK_HOME:-$DEVECO_APP/Contents/sdk}"
HVIGOR="$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw"

if [ ! -x "$HVIGOR" ]; then
  echo "DevEco hvigorw not found: $HVIGOR" >&2
  exit 1
fi

VERSION_NAME="$(sed -n 's/.*"versionName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
VERSION_NAME="${VERSION_NAME:-dev}"
UNSIGNED_OUT="$OUT_DIR/battery-organizer-harmonyos-$VERSION_NAME-unsigned.hap"
SIGNED_OUT="$OUT_DIR/battery-organizer-harmonyos-$VERSION_NAME.hap"
UNSIGNED_APP_OUT="$OUT_DIR/battery-organizer-harmonyos-$VERSION_NAME-unsigned.app"
SIGNED_APP_OUT="$OUT_DIR/battery-organizer-harmonyos-$VERSION_NAME.app"
BUNDLE_NAME="$(sed -n 's/.*"bundleName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
BUNDLE_NAME="${BUNDLE_NAME:-cn.zhengzhengstudio.batteryorganizer.hmos}"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUT_DIR"
rsync -a \
  --exclude='.hvigor' \
  --exclude='build' \
  --exclude='entry/build' \
  "$PROJECT_DIR/" "$BUILD_DIR/"

export DEVECO_SDK_HOME="$SDK_HOME"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$DEVECO_APP/Contents/tools/ohpm/bin:$DEVECO_APP/Contents/tools/hvigor/bin:$DEVECO_APP/Contents/jbr/Contents/Home/bin:$PATH"

(
  cd "$BUILD_DIR"
  "$HVIGOR" --stop-daemon >/dev/null 2>&1 || true
  "$HVIGOR" assembleHap --mode module -p module=entry@default -p product=default
  "$HVIGOR" assembleApp -p product=default || true
)

cp -f "$BUILD_DIR/entry/build/default/outputs/default/entry-default-unsigned.hap" "$UNSIGNED_OUT"
echo "Unsigned HAP: $UNSIGNED_OUT"

APP_OUTPUT="$(find "$BUILD_DIR" -path '*/build/outputs/*' -type f -name '*.app' -print | sort | tail -1)"
if [ -n "$APP_OUTPUT" ] && [ -f "$APP_OUTPUT" ]; then
  cp -f "$APP_OUTPUT" "$UNSIGNED_APP_OUT"
  echo "Unsigned APP: $UNSIGNED_APP_OUT"
else
  echo "Harmony APP bundle was not produced by assembleApp." >&2
fi

if [ "${SIGN_HAP:-0}" = "1" ]; then
  "$ROOT_DIR/website/api/tools/harmony_signing/sign_hap.sh" \
    "$UNSIGNED_OUT" \
    "$BUNDLE_NAME" \
    "$SIGNED_OUT"
  if [ -f "$UNSIGNED_APP_OUT" ]; then
    "$ROOT_DIR/website/api/tools/harmony_signing/sign_hap.sh" \
      "$UNSIGNED_APP_OUT" \
      "$BUNDLE_NAME" \
      "$SIGNED_APP_OUT"
  fi
fi
