#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
KEYCHAIN_ACCOUNT="${USER:-$(id -un)}"
KEYCHAIN_SERVICE="cn.zhengzhengstudio.boardgames.android.release"
KEYCHAIN_KEY_SERVICE="cn.zhengzhengstudio.boardgames.android.release.key"
LEGACY_STORE_FILE="$ROOT_DIR/Android证书/BoardGames-Android-Legacy.keystore"
ROTATED_STORE_FILE="$ROOT_DIR/Android证书/BoardGames-Android-Release.p12"
SIGNING_LINEAGE_FILE="$ROOT_DIR/Android证书/BoardGames-Android-Signing-Lineage.bin"
STORE_FILE="${BOARDGAMES_ANDROID_STORE_FILE:-$LEGACY_STORE_FILE}"
KEY_ALIAS="${BOARDGAMES_ANDROID_KEY_ALIAS:-androiddebugkey}"
ROTATED_KEY_ALIAS="boardgames-release"
if [ -n "${BOARDGAMES_ANDROID_STORE_TYPE:-}" ]; then
  STORE_TYPE="$BOARDGAMES_ANDROID_STORE_TYPE"
elif [ "$STORE_FILE" = "$LEGACY_STORE_FILE" ]; then
  STORE_TYPE="JKS"
else
  STORE_TYPE="PKCS12"
fi

read_keychain_secret() {
  security find-generic-password -s "$1" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true
}

prompt_hidden_secret() {
  osascript - "$1" "$2" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  set dialogResult to display dialog (item 2 of argv) with title (item 1 of argv) default answer "" with hidden answer buttons {"取消", "继续"} default button "继续" cancel button "取消"
  return text returned of dialogResult
end run
APPLESCRIPT
}

validate_store_password() {
  [ -n "${BOARDGAMES_ANDROID_STORE_PASSWORD:-}" ] || return 1
  BOARDGAMES_ANDROID_STORE_PASSWORD="$BOARDGAMES_ANDROID_STORE_PASSWORD" \
    keytool -list \
      -keystore "$STORE_FILE" \
      -storetype "$STORE_TYPE" \
      -storepass:env BOARDGAMES_ANDROID_STORE_PASSWORD \
      -alias "$KEY_ALIAS" >/dev/null 2>&1
}

load_signing_secrets() {
  if [ "$STORE_FILE" = "$LEGACY_STORE_FILE" ]; then
    BOARDGAMES_ANDROID_STORE_PASSWORD="${BOARDGAMES_ANDROID_STORE_PASSWORD:-android}"
    BOARDGAMES_ANDROID_KEY_PASSWORD="${BOARDGAMES_ANDROID_KEY_PASSWORD:-android}"
  fi

  if [ -z "${BOARDGAMES_ANDROID_STORE_PASSWORD:-}" ]; then
    BOARDGAMES_ANDROID_STORE_PASSWORD="$(read_keychain_secret "$KEYCHAIN_SERVICE")"
  fi

  if ! validate_store_password; then
    BOARDGAMES_ANDROID_STORE_PASSWORD=""
    if command -v osascript >/dev/null 2>&1; then
      BOARDGAMES_ANDROID_STORE_PASSWORD="$(prompt_hidden_secret \
        '铮铮桌游中心 Android 发布签名' \
        '请输入 Android 发布密钥库密码。验证成功后会安全存入 macOS 钥匙串。')"
    fi
  fi

  if ! validate_store_password; then
    echo "Android 发布密钥库密码缺失或不正确，已停止构建。" >&2
    exit 1
  fi

  if [ -z "${BOARDGAMES_ANDROID_KEY_PASSWORD:-}" ]; then
    BOARDGAMES_ANDROID_KEY_PASSWORD="$(read_keychain_secret "$KEYCHAIN_KEY_SERVICE")"
    [ -n "$BOARDGAMES_ANDROID_KEY_PASSWORD" ] || \
      BOARDGAMES_ANDROID_KEY_PASSWORD="$BOARDGAMES_ANDROID_STORE_PASSWORD"
  fi

  export BOARDGAMES_ANDROID_STORE_FILE="$STORE_FILE"
  export BOARDGAMES_ANDROID_STORE_PASSWORD
  export BOARDGAMES_ANDROID_KEY_ALIAS="$KEY_ALIAS"
  export BOARDGAMES_ANDROID_KEY_PASSWORD
}

validate_rotated_store_password() {
  [ -n "${ROTATED_STORE_PASSWORD:-}" ] || return 1
  ROTATED_STORE_PASSWORD="$ROTATED_STORE_PASSWORD" \
    keytool -list \
      -keystore "$ROTATED_STORE_FILE" \
      -storetype PKCS12 \
      -storepass:env ROTATED_STORE_PASSWORD \
      -alias "$ROTATED_KEY_ALIAS" >/dev/null 2>&1
}

load_rotation_secrets() {
  ROTATED_STORE_PASSWORD="$(read_keychain_secret "$KEYCHAIN_SERVICE")"
  if ! validate_rotated_store_password && command -v osascript >/dev/null 2>&1; then
    ROTATED_STORE_PASSWORD="$(prompt_hidden_secret \
      '铮铮桌游中心 Android 轮换签名' \
      '请输入新版 Android 发布密钥库密码。验证后将用于生成兼容旧版的证书轮换签名。')"
  fi
  if ! validate_rotated_store_password; then
    echo "Android 新版发布密钥库密码缺失或不正确，已停止构建。" >&2
    exit 1
  fi
  ROTATED_KEY_PASSWORD="$(read_keychain_secret "$KEYCHAIN_KEY_SERVICE")"
  [ -n "$ROTATED_KEY_PASSWORD" ] || ROTATED_KEY_PASSWORD="$ROTATED_STORE_PASSWORD"
  export ROTATED_STORE_PASSWORD ROTATED_KEY_PASSWORD
}

find_java_home() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    printf '%s\n' "$JAVA_HOME"
    return
  fi
  for candidate in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    if [ -x "$candidate/bin/java" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  /usr/libexec/java_home -v 17 2>/dev/null || true
}

find_apksigner() {
  local sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  if [ -z "$sdk_dir" ] && [ -f "$PROJECT_DIR/local.properties" ]; then
    sdk_dir="$(sed -n 's/^sdk\.dir=//p' "$PROJECT_DIR/local.properties" | tail -1 | sed 's/\\:/:/g; s/\\ / /g')"
  fi
  find "$sdk_dir/build-tools" -maxdepth 2 -type f -name apksigner -print 2>/dev/null | sort -V | tail -1
}

load_signing_secrets
load_rotation_secrets
JAVA_HOME="$(find_java_home)"
if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "未找到 Java 17；请安装 Android Studio 或设置 JAVA_HOME。" >&2
  exit 1
fi
export JAVA_HOME

echo "正在构建铮铮桌游中心 Android 正式版……"
(cd "$PROJECT_DIR" && ./gradlew --no-daemon assembleDirectRelease)

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/direct/release/app-direct-release.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "构建完成，但没有找到正式 APK：$APK_PATH" >&2
  exit 1
fi

APKSIGNER="$(find_apksigner)"
if [ -z "$APKSIGNER" ] || [ ! -x "$APKSIGNER" ]; then
  echo "没有找到 Android apksigner，无法确认安装包签名。" >&2
  exit 1
fi
if [ ! -f "$SIGNING_LINEAGE_FILE" ]; then
  "$APKSIGNER" rotate --out "$SIGNING_LINEAGE_FILE" \
    --old-signer --ks "$LEGACY_STORE_FILE" --ks-type JKS \
      --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
      --set-installed-data true --set-shared-uid true --set-permission true \
      --set-rollback false --set-auth true \
    --new-signer --ks "$ROTATED_STORE_FILE" --ks-type PKCS12 \
      --ks-key-alias "$ROTATED_KEY_ALIAS" --ks-pass env:ROTATED_STORE_PASSWORD \
      --key-pass env:ROTATED_KEY_PASSWORD
fi

"$APKSIGNER" sign \
  --ks "$LEGACY_STORE_FILE" --ks-type JKS \
    --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --next-signer --ks "$ROTATED_STORE_FILE" --ks-type PKCS12 \
    --ks-key-alias "$ROTATED_KEY_ALIAS" --ks-pass env:ROTATED_STORE_PASSWORD \
    --key-pass env:ROTATED_KEY_PASSWORD \
  --lineage "$SIGNING_LINEAGE_FILE" --rotation-min-sdk-version 28 \
  --v2-signing-enabled true --v3-signing-enabled true \
  "$APK_PATH"

"$PROJECT_DIR/signing-compat.test.sh" "$APK_PATH"

# Only persist secrets after both the keystore and generated APK have validated.
if [ "$STORE_FILE" != "$LEGACY_STORE_FILE" ]; then
  security add-generic-password -U \
    -s "$KEYCHAIN_SERVICE" \
    -a "$KEYCHAIN_ACCOUNT" \
    -w "$BOARDGAMES_ANDROID_STORE_PASSWORD" >/dev/null
  if [ "$BOARDGAMES_ANDROID_KEY_PASSWORD" != "$BOARDGAMES_ANDROID_STORE_PASSWORD" ]; then
    security add-generic-password -U \
      -s "$KEYCHAIN_KEY_SERVICE" \
      -a "$KEYCHAIN_ACCOUNT" \
      -w "$BOARDGAMES_ANDROID_KEY_PASSWORD" >/dev/null
  fi
fi

VERSION_NAME="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' "$PROJECT_DIR/app/build.gradle.kts" | head -1)"
BACKUP_PATH="$HOME/Downloads/ZhengzhengBoardGames-Android-v${VERSION_NAME:-release}.apk"
ditto "$APK_PATH" "$BACKUP_PATH"

echo "正式 APK 已验证并备份到：$BACKUP_PATH"
