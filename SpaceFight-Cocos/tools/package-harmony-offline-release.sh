#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
PACKAGE_JSON="$PROJECT_DIR/package.json"
VERSION="$(node -p "require('$PACKAGE_JSON').version")"
BUILD="$(node -p "require('$PACKAGE_JSON').build")"
BUNDLE_NAME="cn.zhengzhengstudio.spacefight.huawei"
EXPORT_DIR="$PROJECT_DIR/native-build/spacefight-harmonyos-offline"
HARMONY_TEMPLATE="$PROJECT_DIR/native/engine/harmonyos-next"
COMMON_SOURCE="$PROJECT_DIR/native/engine/common"
ARTIFACT_DIR="$PROJECT_DIR/native-build/artifacts"
EVIDENCE_FILE="$PROJECT_DIR/native-build/evidence/harmonyos-offline.json"
STAGE="${SPACEFIGHT_HARMONY_STAGE:-/tmp/SpaceFightCocosHarmonyRelease}"
REUSE_STAGE="${SPACEFIGHT_HARMONY_REUSE_STAGE:-0}"
APP_UNPACKED="$STAGE/app-unpacked"
VERIFY_DIR="$STAGE/signature-verification"
STAGED_RUNTIME="$STAGE/entry/src/main/resources/rawfile/Resources"
MATERIAL_DIR="${HARMONY_MATERIAL_DIR:-$ROOT/website/api/data/harmony-signing/$BUNDLE_NAME}"
DEVECO_APP="${DEVECO_APP:-}"

fail() {
  echo "$1" >&2
  exit "${2:-1}"
}

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
is_deveco_usable "$DEVECO_APP" || fail "DevEco Studio is unavailable; set DEVECO_APP."

ENV_FILE="$MATERIAL_DIR/signing.env"
KEYSTORE_FILE="$MATERIAL_DIR/keystore.p12"
CERT_FILE="$(find "$MATERIAL_DIR" -maxdepth 1 -type f -name '*.cer' -print | sort | head -1 || true)"
PROFILE_FILE="$(find "$MATERIAL_DIR" -maxdepth 1 -type f -name '*.p7b' -print | sort | head -1 || true)"
[ -f "$ENV_FILE" ] || fail "Missing Harmony signing.env: $MATERIAL_DIR" 2
[ -f "$KEYSTORE_FILE" ] || fail "Missing Harmony keystore: $MATERIAL_DIR" 2
[ -f "$CERT_FILE" ] || fail "Missing Harmony release certificate: $MATERIAL_DIR" 2
[ -f "$PROFILE_FILE" ] || fail "Missing Harmony release profile: $MATERIAL_DIR" 2
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${KEY_ALIAS:?KEY_ALIAS is required}"
: "${KEY_PWD:?KEY_PWD is required}"
: "${KEYSTORE_PWD:?KEYSTORE_PWD is required}"

SIGN_TOOL="$DEVECO_APP/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"
JAVA_BIN="$DEVECO_APP/Contents/jbr/Contents/Home/bin/java"
[ -x "$JAVA_BIN" ] || JAVA_BIN="$(command -v java)"
[ -f "$SIGN_TOOL" ] || fail "hap-sign-tool.jar is unavailable." 3
HVIGOR="$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw"

profile_bundle() {
  openssl smime -verify -inform DER -in "$1" -noverify 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)['bundle-info']['bundle-name']||''))"
}

SOURCE_PROFILE_BUNDLE="$(profile_bundle "$PROFILE_FILE")"
[ "$SOURCE_PROFILE_BUNDLE" = "$BUNDLE_NAME" ] \
  || fail "Harmony profile bundle mismatch: expected $BUNDLE_NAME, got $SOURCE_PROFILE_BUNDLE" 4

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export NODE_HOME="$DEVECO_APP/Contents/tools/node"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

node "$PROJECT_DIR/tools/build-native-target.js" harmonyos-offline

mkdir -p "$STAGE"
if [ "$REUSE_STAGE" != "1" ]; then
  find "$STAGE" -mindepth 1 -depth -delete
fi
rsync -a "$EXPORT_DIR/" "$STAGE/"
rsync -a --exclude '.hvigor' --exclude 'build' --exclude 'entry/build' \
  "$HARMONY_TEMPLATE/" "$STAGE/"
rm -rf "$STAGED_RUNTIME"
mkdir -p "$STAGED_RUNTIME"
rsync -a "$EXPORT_DIR/data/" "$STAGED_RUNTIME/"
mkdir -p "$STAGE/common"
rsync -a "$COMMON_SOURCE/" "$STAGE/common/"

STAGED_ENTRY_PROFILE="$STAGE/entry/build-profile.json5"
perl -0pi -e "s#-DRES_DIR=[^ ]+#-DRES_DIR=$STAGE#g; s#-DCOMMON_DIR=[^ ]+#-DCOMMON_DIR=$STAGE/common#g" \
  "$STAGED_ENTRY_PROFILE"

echo "Building $BUNDLE_NAME $VERSION ($BUILD)"
(
  cd "$STAGE"
  if [ "$REUSE_STAGE" != "1" ]; then
    "$HVIGOR" clean --no-daemon
  fi
  "$HVIGOR" assembleHap \
    --mode module -p product=default -p module=entry@default -p buildMode=release --no-daemon
  "$HVIGOR" assembleApp \
    --mode project -p product=default -p buildMode=release --no-daemon
)

UNSIGNED_HAP="$(find "$STAGE/entry/build" -type f -name '*unsigned.hap' -print | sort | tail -1)"
UNSIGNED_APP="$(find "$STAGE/build" -type f -name '*unsigned.app' -print | sort | tail -1)"
[ -f "$UNSIGNED_HAP" ] || fail "The release build did not produce an unsigned HAP." 5
[ -f "$UNSIGNED_APP" ] || fail "The release build did not produce an unsigned APP." 6

mkdir -p "$ARTIFACT_DIR" "$VERIFY_DIR"
SIGNED_HAP="$ARTIFACT_DIR/SpaceFight-HarmonyOS-Offline-v${VERSION}.hap"
SIGNED_APP="$ARTIFACT_DIR/SpaceFight-HarmonyOS-Offline-v${VERSION}.app"
REPACKED_APP="$STAGE/SpaceFight-HarmonyOS-Offline-v${VERSION}-embedded-unsigned.app"
INNER_HAP="$VERIFY_DIR/entry-default.hap"
find "$APP_UNPACKED" -mindepth 1 -depth -delete 2>/dev/null || true
mkdir -p "$APP_UNPACKED"

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
    -compatibleVersion "${COMPATIBLE_VERSION:-22}" \
    -signCode 1
}

verify_artifact() {
  local input="$1"
  local prefix="$2"
  "$JAVA_BIN" -jar "$SIGN_TOOL" verify-app \
    -inFile "$input" \
    -outCertChain "$VERIFY_DIR/${prefix}-cert-chain.cer" \
    -outProfile "$VERIFY_DIR/${prefix}-profile.p7b"
}

# The inner HAP must be signed before it is embedded in the distributable APP.
sign_artifact "$UNSIGNED_HAP" "$SIGNED_HAP"
(
  cd "$APP_UNPACKED"
  unzip -q "$UNSIGNED_APP"
)
[ -f "$APP_UNPACKED/entry-default.hap" ] || fail "APP does not contain entry-default.hap." 7
cp "$SIGNED_HAP" "$APP_UNPACKED/entry-default.hap"
(
  cd "$APP_UNPACKED"
  zip -q -0 "$REPACKED_APP" pac.json pack.info entry-default.hap
)
sign_artifact "$REPACKED_APP" "$SIGNED_APP"

verify_artifact "$SIGNED_HAP" "hap"
verify_artifact "$SIGNED_APP" "app"
unzip -p "$SIGNED_APP" entry-default.hap > "$INNER_HAP"
[ -s "$INNER_HAP" ] || fail "Signed APP does not contain a readable entry-default.hap." 8
verify_artifact "$INNER_HAP" "inner-hap"

for profile in "$VERIFY_DIR/hap-profile.p7b" "$VERIFY_DIR/app-profile.p7b" "$VERIFY_DIR/inner-hap-profile.p7b"; do
  ACTUAL_BUNDLE="$(profile_bundle "$profile")"
  [ "$ACTUAL_BUNDLE" = "$BUNDLE_NAME" ] \
    || fail "Verified artifact profile mismatch: expected $BUNDLE_NAME, got $ACTUAL_BUNDLE" 9
done

cp "$SIGNED_HAP" "$ARTIFACT_DIR/SpaceFight-HarmonyOS-Offline-latest.hap"
cp "$SIGNED_APP" "$ARTIFACT_DIR/SpaceFight-HarmonyOS-Offline-latest.app"

node - "$PROJECT_DIR" "$EVIDENCE_FILE" "$SIGNED_HAP" "$SIGNED_APP" <<'NODE'
const path = require('node:path');
const [projectRoot, evidencePath, hapPath, appPath] = process.argv.slice(2);
const { recordCompiledArtifacts } = require(path.join(projectRoot, 'tools/build-native-target.js'));
recordCompiledArtifacts(evidencePath, [
  { type: 'hap', path: hapPath, signed: true },
  { type: 'app', path: appPath, signed: true },
], {
  verification: {
    embeddedHapSignaturePassed: true,
    releaseProfileBundlePassed: true,
  },
});
NODE

printf 'bundleName=%s\nversion=%s\nbuild=%s\nhap=%s\napp=%s\n' \
  "$BUNDLE_NAME" "$VERSION" "$BUILD" "$SIGNED_HAP" "$SIGNED_APP"
shasum -a 256 "$SIGNED_HAP" "$SIGNED_APP"
