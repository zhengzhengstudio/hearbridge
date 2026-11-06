#!/usr/bin/env bash
set -euo pipefail
mode="${1:---unsigned}"
if [[ "$mode" != "--unsigned" && "$mode" != "--signed" ]]; then echo "usage: $0 --unsigned|--signed" >&2; exit 2; fi
if [[ "$mode" == "--signed" ]]; then
  : "${SURVIVAL_DIARY_DEVELOPER_ID:?SURVIVAL_DIARY_DEVELOPER_ID is required}"
fi
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"
info_plist="$root_dir/Support/macOS-Info.plist"
version_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist")"
version_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist")"
swift build -c release --product SurvivalDiaryMac
app="$root_dir/Artifacts/SurvivalDiary-macOS-v${version_name}-b${version_build}.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp .build/release/SurvivalDiaryMac "$app/Contents/MacOS/SurvivalDiaryMac"
cp -R .build/release/SurvivalDiaryApple_SurvivalDiaryGame.bundle "$app/Contents/Resources/"
cp Support/AppIcon.png "$app/Contents/Resources/AppIcon.png"
cp Support/macOS-Info.plist "$app/Contents/Info.plist"
if [[ "$mode" == "--signed" ]]; then
  codesign --force --options runtime --timestamp --sign "$SURVIVAL_DIARY_DEVELOPER_ID" "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
else
  touch "$app/Contents/Resources/UNSIGNED_LOCAL_BUILD"
fi
zip="$root_dir/Artifacts/SurvivalDiary-macOS-v${version_name}-b${version_build}-debug-unsigned.zip"
rm -f "$zip"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
echo "$app"
echo "$zip"
