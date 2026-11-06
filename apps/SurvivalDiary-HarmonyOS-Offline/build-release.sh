#!/bin/bash
set -Eeuo pipefail
set +x
umask 077

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"
DEVECO_APP="${DEVECO_APP:-/Applications/DevEco-Studio.app}"
CERT_DIR="${CERT_DIR:-$ROOT/devecostudio证书}"
PROFILE_FILE="${HARMONY_SIGN_PROFILE:-$CERT_DIR/生存日记单机版发布1Release.p7b}"
STORE_FILE="${HARMONY_SIGN_STORE_FILE:-$CERT_DIR/zhengzhengstudio-devecostudio.p12}"
CERT_FILE="${HARMONY_SIGN_CERT_PATH:-$CERT_DIR/铮铮实验室发布证书.cer}"
PUBLISH_DIR="${PUBLISH_DIR:-$ROOT/website/api/apps}"
PUBLIC_PUBLISH_DIR="${PUBLIC_PUBLISH_DIR:-$ROOT/website/zhengzhengstudio.cn/api/apps}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$PROJECT_DIR/Artifacts}"
BUNDLE_NAME="cn.zhengzhengstudio.survivaldiary.offline.hmos"
BUILD_DIR=""
STORE_PASSWORD="${HARMONY_SIGN_STORE_PASSWORD:-}"
KEY_PASSWORD="${HARMONY_SIGN_KEY_PASSWORD:-}"
KEY_ALIAS="${HARMONY_SIGN_KEY_ALIAS:-}"
KEYCHAIN_ACCOUNT="${HARMONY_SIGN_KEYCHAIN_ACCOUNT:-${USER:-}}"
STORE_KEYCHAIN_SERVICE="cn.zhengzhengstudio.survivaldiary.harmony.release.store"
KEY_KEYCHAIN_SERVICE="cn.zhengzhengstudio.survivaldiary.harmony.release.key"
REMEMBER_SIGNING="${HARMONY_SIGN_REMEMBER:-1}"
STORE_PASSWORD_SOURCE="${STORE_PASSWORD:+environment}"
KEY_PASSWORD_SOURCE="${KEY_PASSWORD:+environment}"

cleanup() {
  local status=$?
  if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then rm -rf -- "$BUILD_DIR"; fi
  unset STORE_PASSWORD KEY_PASSWORD HARMONY_SIGN_STORE_PASSWORD HARMONY_SIGN_KEY_PASSWORD
  return "$status"
}
trap cleanup EXIT INT TERM HUP

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法：./build-release.sh [--no-keychain | --forget-keychain]

默认会优先读取环境变量，其次读取 macOS 钥匙串；首次成功签名后会把弹窗输入的
密钥库密码和 key 密码分别保存到钥匙串，后续构建不再重复询问。

  --no-keychain       本次不读取或保存钥匙串
  --forget-keychain   删除已保存的两项 HarmonyOS 签名凭据后退出
EOF
}

read_keychain_secret() {
  local service="$1"
  [ "$REMEMBER_SIGNING" = "1" ] || return 0
  [ -n "$KEYCHAIN_ACCOUNT" ] || return 0
  command -v security >/dev/null 2>&1 || return 0
  security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$service" -w 2>/dev/null || true
}

save_keychain_secret() {
  local service="$1"
  local label="$2"
  local value="$3"
  [ "$REMEMBER_SIGNING" = "1" ] || return 0
  [ -n "$KEYCHAIN_ACCOUNT" ] || return 1
  command -v security >/dev/null 2>&1 || return 1
  security add-generic-password -U -a "$KEYCHAIN_ACCOUNT" -s "$service" -l "$label" -w "$value" >/dev/null
}

forget_keychain_secrets() {
  [ -n "$KEYCHAIN_ACCOUNT" ] || fail '无法确定当前钥匙串账户'
  command -v security >/dev/null 2>&1 || fail 'macOS 钥匙串命令不可用'
  security delete-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$STORE_KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
  security delete-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEY_KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
  printf '已删除生存日记 HarmonyOS 正式签名的钥匙串凭据。\n'
}

prompt_secret() {
  local label="$1"
  if [ -t 0 ]; then
    local value=""
    read -rsp "$label: " value
    printf '\n' >&2
    printf '%s' "$value"
  elif command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$label\" default answer \"\" with hidden answer buttons {\"继续\"} default button \"继续\"" -e 'text returned of result'
  fi
}

for option in "$@"; do
  case "$option" in
    --no-keychain) REMEMBER_SIGNING=0 ;;
    --forget-keychain) forget_keychain_secrets; exit 0 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; fail "未知参数：$option" ;;
  esac
done

[ -x "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" ] || fail "未找到 DevEco Studio：$DEVECO_APP"
[ -f "$PROFILE_FILE" ] || fail "缺少 Release Profile：$PROFILE_FILE"
[ -f "$STORE_FILE" ] || fail "缺少 PKCS12 密钥库：$STORE_FILE"
[ -f "$CERT_FILE" ] || fail "缺少发布证书：$CERT_FILE"

PROFILE_BUNDLE="$(openssl smime -verify -inform DER -in "$PROFILE_FILE" -noverify 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)['bundle-info']['bundle-name']||''))")"
[ "$PROFILE_BUNDLE" = "$BUNDLE_NAME" ] || fail "Profile 包名不匹配：期望 $BUNDLE_NAME，实际 $PROFILE_BUNDLE"

if [ -z "$STORE_PASSWORD" ]; then
  STORE_PASSWORD="$(read_keychain_secret "$STORE_KEYCHAIN_SERVICE")"
  [ -z "$STORE_PASSWORD" ] || STORE_PASSWORD_SOURCE="keychain"
fi
if [ -z "$KEY_PASSWORD" ]; then
  KEY_PASSWORD="$(read_keychain_secret "$KEY_KEYCHAIN_SERVICE")"
  [ -z "$KEY_PASSWORD" ] || KEY_PASSWORD_SOURCE="keychain"
fi
if [ -z "$STORE_PASSWORD" ]; then
  STORE_PASSWORD="$(prompt_secret '请输入 HarmonyOS 密钥库密码（验证成功后会安全记住）')"
  STORE_PASSWORD_SOURCE="prompt"
fi
if [ -z "$KEY_PASSWORD" ]; then
  KEY_PASSWORD="$(prompt_secret '请输入 HarmonyOS key 密码（验证成功后会安全记住）')"
  KEY_PASSWORD_SOURCE="prompt"
fi
[ -n "$STORE_PASSWORD" ] || fail '密钥库密码为空'
[ -n "$KEY_PASSWORD" ] || fail 'key 密码为空'

JAVA_BIN="$DEVECO_APP/Contents/jbr/Contents/Home/bin/java"
[ -x "$JAVA_BIN" ] || JAVA_BIN="$(command -v java)"
KEYTOOL_BIN="$DEVECO_APP/Contents/jbr/Contents/Home/bin/keytool"
[ -x "$KEYTOOL_BIN" ] || KEYTOOL_BIN="$(command -v keytool)"
SIGN_TOOL="$DEVECO_APP/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"
[ -f "$SIGN_TOOL" ] || fail '缺少 hap-sign-tool.jar'

KEYSTORE_LIST="$($KEYTOOL_BIN -list -keystore "$STORE_FILE" -storetype PKCS12 -storepass "$STORE_PASSWORD" 2>/dev/null)" ||
  fail '无法打开密钥库，请检查密钥库密码；如密码已更换，请运行 --forget-keychain'
if [ -z "$KEY_ALIAS" ]; then
  KEY_ALIAS="$(printf '%s\n' "$KEYSTORE_LIST" | sed -n 's/^\([^,][^,]*\),.*/\1/p' | head -1)"
fi
[ -n "$KEY_ALIAS" ] || fail '无法从密钥库读取 key alias，请检查密码'

APP_JSON="$PROJECT_DIR/AppScope/app.json5"
VERSION_NAME="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_JSON" | head -1)"
VERSION_CODE="$(sed -n 's/.*"versionCode":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$APP_JSON" | head -1)"
[ -n "$VERSION_NAME" ] && [ -n "$VERSION_CODE" ] || fail '无法读取应用版本'

BUILD_DIR="$(mktemp -d /tmp/survival-diary-harmony-offline-release.XXXXXX)"
rsync -a --exclude '.idea' --exclude '.hvigor' --exclude 'build' --exclude 'entry/build' --exclude 'entry/.preview' "$PROJECT_DIR/" "$BUILD_DIR/"

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export NODE_HOME="$DEVECO_APP/Contents/tools/node"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

printf '构建 %s %s (%s)\n' "$BUNDLE_NAME" "$VERSION_NAME" "$VERSION_CODE"
(
  cd "$BUILD_DIR"
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" clean --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap --mode module -p product=default -p module=entry@default -p buildMode=release --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleApp --mode project -p product=default -p buildMode=release --no-daemon
)

HAP_UNSIGNED="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*.hap' -print | sort | tail -1)"
APP_UNSIGNED="$(find "$BUILD_DIR/build/outputs/default" -maxdepth 1 -type f -name '*.app' -print | sort | tail -1)"
[ -f "$HAP_UNSIGNED" ] || fail '未找到 Release HAP'
[ -f "$APP_UNSIGNED" ] || fail '未找到 Release APP'

STAGE_DIR="$BUILD_DIR/publish"
VERIFY_DIR="$BUILD_DIR/verify"
mkdir -p "$STAGE_DIR" "$VERIFY_DIR" "$PUBLISH_DIR"
HAP_NAME="SurvivalDiary-HarmonyOS-Offline-v${VERSION_NAME}-b${VERSION_CODE}.hap"
APP_NAME="SurvivalDiary-HarmonyOS-Offline-v${VERSION_NAME}-b${VERSION_CODE}.app"
HAP_STAGE="$STAGE_DIR/$HAP_NAME"
APP_STAGE="$STAGE_DIR/$APP_NAME"

sign_artifact() {
  "$JAVA_BIN" -jar "$SIGN_TOOL" sign-app -mode localSign \
    -keyAlias "$KEY_ALIAS" -keyPwd "$KEY_PASSWORD" \
    -appCertFile "$CERT_FILE" -profileFile "$PROFILE_FILE" -profileSigned 1 \
    -inFile "$1" -signAlg SHA256withECDSA -keystoreFile "$STORE_FILE" \
    -keystorePwd "$STORE_PASSWORD" -outFile "$2" -compatibleVersion 22 -signCode 1
}

sign_artifact "$HAP_UNSIGNED" "$HAP_STAGE"
sign_artifact "$APP_UNSIGNED" "$APP_STAGE"

"$JAVA_BIN" -jar "$SIGN_TOOL" verify-app -inFile "$HAP_STAGE" -outCertChain "$VERIFY_DIR/hap-cert-chain.cer" -outProfile "$VERIFY_DIR/hap-profile.p7b"
"$JAVA_BIN" -jar "$SIGN_TOOL" verify-app -inFile "$APP_STAGE" -outCertChain "$VERIFY_DIR/app-cert-chain.cer" -outProfile "$VERIFY_DIR/app-profile.p7b"

for verified_profile in "$VERIFY_DIR/hap-profile.p7b" "$VERIFY_DIR/app-profile.p7b"; do
  verified_bundle="$(openssl smime -verify -inform DER -in "$verified_profile" -noverify 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)['bundle-info']['bundle-name']||''))")"
  [ "$verified_bundle" = "$BUNDLE_NAME" ] || fail "签名产物 Profile 包名异常：$verified_bundle"
done

if [ "$STORE_PASSWORD_SOURCE" = "prompt" ]; then
  save_keychain_secret "$STORE_KEYCHAIN_SERVICE" '生存日记 HarmonyOS 正式签名密钥库密码' "$STORE_PASSWORD" ||
    printf 'WARNING: 正式签名已验证，但密钥库密码未能写入 macOS 钥匙串。\n' >&2
fi
if [ "$KEY_PASSWORD_SOURCE" = "prompt" ]; then
  save_keychain_secret "$KEY_KEYCHAIN_SERVICE" '生存日记 HarmonyOS 正式签名 key 密码' "$KEY_PASSWORD" ||
    printf 'WARNING: 正式签名已验证，但 key 密码未能写入 macOS 钥匙串。\n' >&2
fi
if [ "$STORE_PASSWORD_SOURCE" = "prompt" ] || [ "$KEY_PASSWORD_SOURCE" = "prompt" ]; then
  printf '签名凭据已在正式签名和验签成功后保存到 macOS 钥匙串。\n'
elif [ "$STORE_PASSWORD_SOURCE" = "keychain" ] && [ "$KEY_PASSWORD_SOURCE" = "keychain" ]; then
  printf '本次签名已自动使用 macOS 钥匙串凭据。\n'
fi

for publish_root in "$PUBLISH_DIR" "$PUBLIC_PUBLISH_DIR"; do
  mkdir -p "$publish_root"
  for item in "$HAP_NAME:$HAP_STAGE" "$APP_NAME:$APP_STAGE" "SurvivalDiary-HarmonyOS-Offline-latest.hap:$HAP_STAGE" "SurvivalDiary-HarmonyOS-Offline-latest.app:$APP_STAGE"; do
    name="${item%%:*}"
    source="${item#*:}"
    cp -f "$source" "$publish_root/$name"
    shasum -a 256 "$publish_root/$name" | sed "s#  .*#  $name#" > "$publish_root/$name.sha256"
    cmp -s "$source" "$publish_root/$name" || fail "发布文件复制后不一致：$publish_root/$name"
  done
done

mkdir -p "$ARTIFACT_DIR"
for item in "$HAP_NAME:$HAP_STAGE" "$APP_NAME:$APP_STAGE"; do
  name="${item%%:*}"
  source="${item#*:}"
  cp -f "$source" "$ARTIFACT_DIR/$name"
  shasum -a 256 "$ARTIFACT_DIR/$name" | sed "s#  .*#  $name#" > "$ARTIFACT_DIR/$name.sha256"
done

printf 'SIGNED_HAP=%s\nSIGNED_APP=%s\n' "$PUBLISH_DIR/$HAP_NAME" "$PUBLISH_DIR/$APP_NAME"
shasum -a 256 "$PUBLISH_DIR/$HAP_NAME" "$PUBLISH_DIR/$APP_NAME"
