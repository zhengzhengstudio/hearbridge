#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLE_PROJECT="$ROOT/电池收纳器/电池收纳器.xcodeproj/project.pbxproj"
ANDROID_MANIFEST="$ROOT/BatteryOrganizerAndroid/app/src/main/AndroidManifest.xml"
ANDROID_KEYSTORE="$ROOT/BatteryOrganizerAndroid/keystore.properties"
HARMONY_RELEASE_SCRIPT="$ROOT/HarmonyOS-App/BatteryOrganizerHarmony/build-release.sh"
HARMONY_OFFLINE_RELEASE_SCRIPT="$ROOT/HarmonyOS-App/BatteryOrganizerHarmonyOffline/build-release.sh"
HARMONY_CERT_DIR="$ROOT/devecostudio证书"

fail=0

check() {
  local name="$1"
  shift
  if "$@"; then
    printf 'OK  %s\n' "$name"
  else
    printf 'NO  %s\n' "$name"
    fail=1
  fi
}

check "Apple version is 1.1.19 build 19" bash -c "grep -q 'MARKETING_VERSION = 1.1.19;' '$APPLE_PROJECT' && grep -q 'CURRENT_PROJECT_VERSION = 19;' '$APPLE_PROJECT'"
check "Apple has PrivacyInfo.xcprivacy" test -f "$ROOT/电池收纳器/电池收纳器/PrivacyInfo.xcprivacy"
check "macOS uses App Sandbox entitlement" grep -q "com.apple.security.app-sandbox" "$ROOT/电池收纳器/电池收纳器/电池收纳器-macOS.entitlements"
check "Android removed APK install permission" bash -c "! grep -q 'REQUEST_INSTALL_PACKAGES' '$ANDROID_MANIFEST'"
check "Android cleartext traffic disabled" grep -q 'android:usesCleartextTraffic="false"' "$ANDROID_MANIFEST"
check "Android release keystore configured" test -f "$ANDROID_KEYSTORE"
check "HarmonyOS online release signing configured" bash -c "test -x '$HARMONY_RELEASE_SCRIPT' && grep -q 'verify_artifact' '$HARMONY_RELEASE_SCRIPT' && test -f '$HARMONY_CERT_DIR/电池收纳器发布1Release.p7b'"
check "HarmonyOS offline release signing configured" bash -c "test -x '$HARMONY_OFFLINE_RELEASE_SCRIPT' && grep -q 'verify_artifact' '$HARMONY_OFFLINE_RELEASE_SCRIPT' && test -f '$HARMONY_CERT_DIR/电池收纳器单机版发布1Release.p7b'"

if ! security find-identity -v -p codesigning | grep -Eq 'Apple Distribution|3rd Party Mac Developer Application|Developer ID Application'; then
  printf 'NO  Apple distribution signing identity installed\n'
  fail=1
else
  printf 'OK  Apple distribution signing identity installed\n'
fi

if [ "$fail" -ne 0 ]; then
  printf '\nStore readiness check failed. Fill the missing signing credentials before uploading.\n'
  exit 1
fi

printf '\nStore readiness check passed.\n'
