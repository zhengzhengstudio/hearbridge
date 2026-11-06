#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_SCRIPT="$ROOT_DIR/MultipleBoardGamesAndroid/build-release.sh"

test -x "$ANDROID_SCRIPT"
grep -q 'cn.zhengzhengstudio.boardgames.android.release' "$ANDROID_SCRIPT"
grep -q 'security find-generic-password' "$ANDROID_SCRIPT"
grep -q 'display dialog' "$ANDROID_SCRIPT"
grep -q 'with hidden answer' "$ANDROID_SCRIPT"
grep -q 'keytool -list' "$ANDROID_SCRIPT"
grep -q 'security add-generic-password' "$ANDROID_SCRIPT"
grep -q 'assembleDirectRelease' "$ANDROID_SCRIPT"
grep -q 'APKSIGNER.*verify' "$ANDROID_SCRIPT"

for script in \
  "$ROOT_DIR/HarmonyOS-App/ZhengZhengBoardGamesHarmony/build-hap.sh" \
  "$ROOT_DIR/HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/build-hap.sh"; do
  grep -q 'cn.zhengzhengstudio.boardgames.harmony.release.store' "$script"
  grep -q 'cn.zhengzhengstudio.boardgames.harmony.release.key' "$script"
  grep -q 'display dialog' "$script"
  grep -q 'save_signing_secrets' "$script"
done

echo "Board games release signing script contract passed."
