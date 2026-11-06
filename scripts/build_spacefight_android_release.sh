#!/bin/bash
# SpaceFight Android release 打包 + 签名 + 校验
# 证书：Android证书/SpaceFight-Android-Release.p12（密码在 macOS 钥匙串）
set -euo pipefail

REPO="/Users/ljg/Desktop/开发者/TRAE"
PROJ="$REPO/SpaceFight-Cocos/native-build/spacefight-android/proj"
KEYSTORE="$REPO/Android证书/SpaceFight-Android-Release.p12"
KEY_ALIAS="spacefight-release"
KEYCHAIN_SERVICE="cn.zhengzhengstudio.spacefight.android.release"
EXPECTED_CERT_SHA256="32:B7:30:D3:F8:F0:F0:3C:CA:AD:5F:06:96:33:FD:A6:90:75:CA:6C:36:CC:B8:44:17:D8:62:47:24:25:63:AA"

export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

SDK_BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -maxdepth 1 -type d | sort -V | tail -n 1)"
APKSIGNER="$SDK_BUILD_TOOLS/apksigner"
AAPT="$SDK_BUILD_TOOLS/aapt"
[ -x "$APKSIGNER" ] || { echo "apksigner 不可用: $APKSIGNER"; exit 1; }
[ -x "$AAPT" ] || { echo "aapt 不可用: $AAPT"; exit 1; }
[ -f "$KEYSTORE" ] || { echo "证书缺失: $KEYSTORE"; exit 1; }

# 密码只进内存，不 echo、不落盘
PW="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$USER" -w)" || {
  echo "钥匙串里找不到签名密码"; exit 1; }
[ -n "$PW" ] || { echo "签名密码为空"; exit 1; }
trap 'unset PW' EXIT

echo "=== gradle assembleRelease ==="
cd "$PROJ"
./gradlew \
  -PNATIVE_DIR="$REPO/SpaceFight-Cocos/native/engine/android" \
  -PRELEASE_STORE_FILE="$KEYSTORE" \
  -PRELEASE_STORE_PASSWORD="$PW" \
  -PRELEASE_KEY_ALIAS="$KEY_ALIAS" \
  -PRELEASE_KEY_PASSWORD="$PW" \
  -PAPPLICATION_ID="cn.zhengzhengstudio.spacefight" \
  assembleRelease

APK="$(find "$PROJ" -name "*release*.apk" -newermt "-30 minutes" 2>/dev/null | head -n 1)"
[ -n "$APK" ] || APK="$(find "$PROJ" -path "*outputs/apk/release*" -name "*.apk" | head -n 1)"
[ -f "$APK" ] || { echo "未产出 release APK"; exit 1; }

echo "=== 签名校验: $APK ==="
VERIFY_OUT="$("$APKSIGNER" verify --verbose --print-certs "$APK")" || {
  echo "apksigner 校验失败"; exit 1; }
echo "$VERIFY_OUT" | grep -E "Verifies|Signer #1 certificate SHA-256" || true
echo "$VERIFY_OUT" | grep -q 'Verifies' || { echo "签名未通过校验"; exit 1; }
if echo "$VERIFY_OUT" | grep -q 'CN=Android Debug'; then
  echo "错误：用的是 Android Debug 证书"; exit 1
fi
ACTUAL="$(echo "$VERIFY_OUT" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n 1 \
  | tr '[:lower:]' '[:upper:]' | sed 's/../&:/g; s/:$//')"
[ "$ACTUAL" = "$EXPECTED_CERT_SHA256" ] || {
  echo "证书指纹不符：期望 $EXPECTED_CERT_SHA256 实际 $ACTUAL"; exit 1; }
echo "证书指纹匹配 ✓"

echo "=== 包信息 ==="
"$AAPT" dump badging "$APK" | grep -E "^package:|application-label:|application-debuggable" || true
ls -la "$APK"
echo "MD5:    $(md5 -q "$APK")"
echo "SHA256: $(shasum -a 256 "$APK" | cut -d' ' -f1)"
echo "APK_PATH=$APK"