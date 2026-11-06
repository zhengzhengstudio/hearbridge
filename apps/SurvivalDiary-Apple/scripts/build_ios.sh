#!/usr/bin/env bash
set -euo pipefail
mode="${1:---unsigned}"
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"
info_plist="$root_dir/Support/iOS-Info.plist"
version_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist")"
version_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist")"
if [[ "$mode" != "--unsigned" && "$mode" != "--signed" ]]; then
  echo "usage: $0 --unsigned|--signed" >&2; exit 2
fi
if [[ "$mode" == "--signed" ]]; then
  : "${SURVIVAL_DIARY_APPLE_TEAM_ID:?SURVIVAL_DIARY_APPLE_TEAM_ID is required}"
  : "${SURVIVAL_DIARY_IOS_PROFILE:?SURVIVAL_DIARY_IOS_PROFILE must point to a release mobileprovision}"
  : "${SURVIVAL_DIARY_IOS_SIGNING_IDENTITY:?SURVIVAL_DIARY_IOS_SIGNING_IDENTITY is required}"
  test -f "$SURVIVAL_DIARY_IOS_PROFILE"
fi

derived_data="${SURVIVAL_DIARY_DERIVED_DATA:-$root_dir/DerivedData/iOS}"
mkdir -p "$derived_data"
# Xcode's module/PCH cache embeds the absolute checkout path. The project is
# sometimes moved back from a task worktree to the main workspace, so keeping
# that cache makes an otherwise valid build fail with a stale module path.
rm -rf "$derived_data/ModuleCache.noindex" \
  "$derived_data/Build/Intermediates.noindex/PrecompiledHeaders"
xcodebuild -scheme SurvivalDiaryIOS -destination 'generic/platform=iOS' -configuration Release \
  -derivedDataPath "$derived_data" CODE_SIGNING_ALLOWED=NO ENABLE_TESTABILITY=YES build

products="$derived_data/Build/Products/Release-iphoneos"
staging="$root_dir/Artifacts/iOS-staging"
app="$staging/Payload/SurvivalDiary.app"
rm -rf "$staging"
mkdir -p "$app"
cp "$products/SurvivalDiaryIOS" "$app/SurvivalDiary"
cp -R "$products/SurvivalDiaryApple_SurvivalDiaryGame.bundle" "$app/"
cp Support/iOS-Info.plist "$app/Info.plist"
cp Support/AppIcon.png "$app/AppIcon.png"
chmod 0755 "$app/SurvivalDiary"

if [[ "$mode" == "--signed" ]]; then
  cp "$SURVIVAL_DIARY_IOS_PROFILE" "$app/embedded.mobileprovision"
  profile_plist="$(mktemp)"
  entitlements_plist="$(mktemp)"
  trap 'rm -f "$profile_plist" "$entitlements_plist"' EXIT
  security cms -D -i "$SURVIVAL_DIARY_IOS_PROFILE" > "$profile_plist"
  /usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$profile_plist" > "$entitlements_plist"
  application_identifier="$(/usr/libexec/PlistBuddy -c 'Print :application-identifier' "$entitlements_plist")"
  expected_identifier="$SURVIVAL_DIARY_APPLE_TEAM_ID.cn.zhengzhengstudio.survivaldiary.ios"
  [[ "$application_identifier" == "$expected_identifier" ]] || {
    echo "profile identifier mismatch: expected $expected_identifier" >&2; exit 3;
  }
  codesign --force --timestamp --sign "$SURVIVAL_DIARY_IOS_SIGNING_IDENTITY" --entitlements "$entitlements_plist" "$app"
  codesign --verify --strict --verbose=2 "$app"
  ipa="$root_dir/Artifacts/SurvivalDiary-iOS-v${version_name}-b${version_build}.ipa"
  rm -f "$ipa"
  (cd "$staging" && /usr/bin/zip -qry "$ipa" Payload)
  echo "$ipa"
else
  unsigned_app="$root_dir/Artifacts/SurvivalDiary-iOS-v${version_name}-b${version_build}-unsigned.app"
  unsigned_ipa="$root_dir/Artifacts/SurvivalDiary-iOS-v${version_name}-b${version_build}-debug-unsigned.ipa"
  rm -rf "$unsigned_app"
  rm -f "$unsigned_ipa"
  touch "$app/UNSIGNED_LOCAL_BUILD"
  cp -R "$app" "$unsigned_app"
  (cd "$staging" && /usr/bin/zip -qry "$unsigned_ipa" Payload)
  echo "$unsigned_app"
  echo "$unsigned_ipa"
fi
