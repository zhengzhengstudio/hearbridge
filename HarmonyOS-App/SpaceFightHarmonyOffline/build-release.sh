#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"
BUILD_DIR="${BUILD_DIR:-/tmp/SpaceFightHarmonyOffline-release}"
OUT_DIR="$PROJECT_DIR/entry/build/default/outputs/default"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-$HOME/Downloads}"
BUNDLE_NAME="cn.zhengzhengstudio.spacefight.huawei"
MATERIAL_DIR="${HARMONY_MATERIAL_DIR:-$ROOT/website/api/data/harmony-signing/$BUNDLE_NAME}"
DEVECO_APP="${DEVECO_APP:-}"

is_deveco_usable() {
  [ -n "${1:-}" ] && [ -x "$1/Contents/tools/hvigor/bin/hvigorw" ]
}

if [ -z "$DEVECO_APP" ]; then
  if is_deveco_usable "/Applications/DevEco-Studio.app"; then
    DEVECO_APP="/Applications/DevEco-Studio.app"
  elif is_deveco_usable "/Volumes/DevEco-Studio/DevEco-Studio.app"; then
    DEVECO_APP="/Volumes/DevEco-Studio/DevEco-Studio.app"
  fi
fi
if ! is_deveco_usable "$DEVECO_APP"; then
  echo "未找到可用 DevEco Studio，请设置 DEVECO_APP。" >&2
  exit 1
fi

APP_JSON="$PROJECT_DIR/AppScope/app.json5"
VERSION_NAME="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_JSON" | head -1)"
VERSION_CODE="$(sed -n 's/.*"versionCode":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$APP_JSON" | head -1)"
ENV_FILE="$MATERIAL_DIR/signing.env"
KEYSTORE_FILE="$MATERIAL_DIR/keystore.p12"
CERT_FILE="$(find "$MATERIAL_DIR" -maxdepth 1 -type f -name '*.cer' -print | sort | head -1 || true)"
PROFILE_FILE="$(find "$MATERIAL_DIR" -maxdepth 1 -type f -name '*.p7b' -print | sort | head -1 || true)"

[ -f "$ENV_FILE" ] || { echo "缺少 signing.env：$MATERIAL_DIR" >&2; exit 2; }
[ -f "$KEYSTORE_FILE" ] || { echo "缺少 keystore.p12：$MATERIAL_DIR" >&2; exit 2; }
[ -f "$CERT_FILE" ] || { echo "缺少发布证书 .cer：$MATERIAL_DIR" >&2; exit 2; }
[ -f "$PROFILE_FILE" ] || { echo "缺少发布 Profile .p7b：$MATERIAL_DIR" >&2; exit 2; }
# shellcheck disable=SC1090
source "$ENV_FILE"

PROFILE_BUNDLE="$(openssl smime -verify -inform DER -in "$PROFILE_FILE" -noverify 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)['bundle-info']['bundle-name']||''))")"
if [ "$PROFILE_BUNDLE" != "$BUNDLE_NAME" ]; then
  echo "Profile 包名不匹配：期望 $BUNDLE_NAME，实际 $PROFILE_BUNDLE" >&2
  exit 3
fi

SIGN_TOOL="$DEVECO_APP/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"
JAVA_BIN="$DEVECO_APP/Contents/jbr/Contents/Home/bin/java"
[ -x "$JAVA_BIN" ] || JAVA_BIN="$(command -v java)"
[ -f "$SIGN_TOOL" ] || { echo "缺少 hap-sign-tool.jar" >&2; exit 4; }

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export NODE_HOME="$DEVECO_APP/Contents/tools/node"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUT_DIR" "$DOWNLOADS_DIR"
rsync -a \
  --exclude '.idea' \
  --exclude '.hvigor' \
  --exclude 'build' \
  --exclude 'entry/build' \
  --exclude 'entry/.preview' \
  "$PROJECT_DIR/" "$BUILD_DIR/"

echo "构建 $BUNDLE_NAME $VERSION_NAME ($VERSION_CODE)"
(
  cd "$BUILD_DIR"
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" clean --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap \
    --mode module -p product=default -p module=entry@default -p buildMode=release --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleApp \
    --mode project -p product=default -p buildMode=release --no-daemon
)

HAP_UNSIGNED="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*.hap' -print | sort | tail -1)"
APP_UNSIGNED="$(find "$BUILD_DIR/build/outputs/default" -maxdepth 1 -type f -name '*.app' -print | sort | tail -1)"
[ -f "$HAP_UNSIGNED" ] || { echo "未找到 release HAP。" >&2; exit 5; }
[ -f "$APP_UNSIGNED" ] || { echo "未找到 release APP。" >&2; exit 6; }

HAP_OUT="$OUT_DIR/SpaceFight-HarmonyOS-Offline-v${VERSION_NAME}.hap"
APP_OUT="$OUT_DIR/SpaceFight-HarmonyOS-Offline-v${VERSION_NAME}.app"
rm -f "$HAP_OUT" "$APP_OUT"

sign_artifact() {
  local input="$1"
  local output="$2"
  "$JAVA_BIN" -jar "$SIGN_TOOL" sign-app \
    -mode localSign \
    -keyAlias "$KEY_ALIAS" \
    -keyPwd "$KEY_PWD" \
    -appCertFile "$CERT_FILE" \
    -profileFile "$PROFILE_FILE" \
    -profileSigned 1 \
    -inFile "$input" \
    -signAlg "${SIGN_ALG:-SHA256withECDSA}" \
    -keystoreFile "$KEYSTORE_FILE" \
    -keystorePwd "$KEYSTORE_PWD" \
    -outFile "$output" \
    -compatibleVersion 22 \
    -signCode 1
}

sign_artifact "$HAP_UNSIGNED" "$HAP_OUT"
sign_artifact "$APP_UNSIGNED" "$APP_OUT"

VERIFY_DIR="$BUILD_DIR/verify"
mkdir -p "$VERIFY_DIR"
"$JAVA_BIN" -jar "$SIGN_TOOL" verify-app \
  -inFile "$HAP_OUT" \
  -outCertChain "$VERIFY_DIR/hap-cert-chain.cer" \
  -outProfile "$VERIFY_DIR/hap-profile.p7b"
"$JAVA_BIN" -jar "$SIGN_TOOL" verify-app \
  -inFile "$APP_OUT" \
  -outCertChain "$VERIFY_DIR/app-cert-chain.cer" \
  -outProfile "$VERIFY_DIR/app-profile.p7b"

cp "$HAP_OUT" "$DOWNLOADS_DIR/$(basename "$HAP_OUT")"
cp "$APP_OUT" "$DOWNLOADS_DIR/$(basename "$APP_OUT")"

printf 'bundleName=%s\nversionName=%s\nversionCode=%s\nhap=%s\napp=%s\n' \
  "$BUNDLE_NAME" "$VERSION_NAME" "$VERSION_CODE" "$HAP_OUT" "$APP_OUT"
shasum -a 256 "$HAP_OUT" "$APP_OUT"
