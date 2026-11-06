#!/bin/bash
set -euo pipefail

APK_PATH="${1:-$HOME/Downloads/ZhengzhengBoardGames-Android-v1.2.16.apk}"
LEGACY_CERT_SHA256="64768d8c33fbca18f96423336975b1f359b874d21667df40add84965d2535523"
CURRENT_CERT_SHA256="989238334adcf40d12fba0b89d46238f1b335e42b9d7ade5d24e53b33418f4ad"
SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
APKSIGNER="$(find "$SDK_DIR/build-tools" -maxdepth 2 -type f -name apksigner -print 2>/dev/null | sort -V | tail -1)"

if [ ! -f "$APK_PATH" ]; then
  echo "APK 不存在：$APK_PATH" >&2
  exit 1
fi
if [ -z "$APKSIGNER" ] || [ ! -x "$APKSIGNER" ]; then
  echo "找不到 apksigner" >&2
  exit 1
fi

certificate_for_sdk() {
  "$APKSIGNER" verify \
    --min-sdk-version "$1" \
    --max-sdk-version "$1" \
    --print-certs "$APK_PATH" 2>/dev/null \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    | head -1
}

LEGACY_ACTUAL="$(certificate_for_sdk 27)"
CURRENT_ACTUAL="$(certificate_for_sdk 28)"
if [ "$LEGACY_ACTUAL" != "$LEGACY_CERT_SHA256" ]; then
  echo "Android 8 升级签名不兼容：期望 $LEGACY_CERT_SHA256，实际 $LEGACY_ACTUAL" >&2
  exit 1
fi
if [ "$CURRENT_ACTUAL" != "$CURRENT_CERT_SHA256" ]; then
  echo "Android 9+ 轮换签名不兼容：期望 $CURRENT_CERT_SHA256，实际 $CURRENT_ACTUAL" >&2
  exit 1
fi

echo "Android 升级签名兼容：SDK 27=$LEGACY_ACTUAL，SDK 28+=$CURRENT_ACTUAL"
