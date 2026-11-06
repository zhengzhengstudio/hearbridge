#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---build}"
APP_NAME="LifeDiary"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${LIFEDIARY_CONFIGURATION:-Release}"
BUILD_DIR="$ROOT_DIR/.build/release-ios"
PRODUCT_DIR="$BUILD_DIR/Build/Products/$CONFIGURATION-iphoneos"
APP_BUNDLE="$ROOT_DIR/dist/Payload/$APP_NAME.app"
ASSET_CATALOG="$ROOT_DIR/Sources/LifeDiary/Resources/Assets.xcassets"
INFO_TEMPLATE="$ROOT_DIR/Support/Info.plist"

package_icon_assets() {
    local app_bundle="$1"
    local partial_info
    test -d "$app_bundle"
    test -f "$app_bundle/Info.plist"
    test -f "$ASSET_CATALOG/AppIcon.appiconset/AppIcon-1024.png"
    partial_info="$(mktemp "${TMPDIR:-/tmp}/lifediary-icon-info.XXXXXX")"
    xcrun actool "$ASSET_CATALOG" \
        --compile "$app_bundle" \
        --platform iphoneos \
        --minimum-deployment-target 16.0 \
        --app-icon AppIcon \
        --target-device iphone \
        --target-device ipad \
        --output-partial-info-plist "$partial_info"
    /usr/libexec/PlistBuddy -c "Merge $partial_info" "$app_bundle/Info.plist"
    rm -f "$partial_info"
    test -s "$app_bundle/Assets.car"
    test -s "$app_bundle/AppIcon60x60@2x.png"
    test -s "$app_bundle/AppIcon76x76@2x~ipad.png"
}

if [[ "$MODE" == "--package-icons" ]]; then
    test "$#" -eq 2
    package_icon_assets "$2"
    exit 0
fi

if [[ "$MODE" != "--build" && "$MODE" != "build" ]]; then
    echo "usage: $0 [--build|--package-icons APP_BUNDLE]" >&2
    exit 2
fi

cd "$ROOT_DIR"
LIFEDIARY_BUILD_APP=1 xcodebuild -scheme LifeDiary \
    -sdk iphoneos \
    -configuration "$CONFIGURATION" \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$BUILD_DIR" \
    SWIFT_COMPILATION_MODE=singlefile \
    CODE_SIGNING_ALLOWED=NO \
    build

test -x "$PRODUCT_DIR/$APP_NAME"
test -d "$PRODUCT_DIR/LifeDiary_LifeDiary.bundle"
if [[ "$APP_BUNDLE" != "$ROOT_DIR/dist/Payload/LifeDiary.app" ]]; then exit 3; fi
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE"
cp "$PRODUCT_DIR/$APP_NAME" "$APP_BUNDLE/$APP_NAME"
chmod +x "$APP_BUNDLE/$APP_NAME"
cp -R "$PRODUCT_DIR/LifeDiary_LifeDiary.bundle" "$APP_BUNDLE/"
cp "$INFO_TEMPLATE" "$APP_BUNDLE/Info.plist"
package_icon_assets "$APP_BUNDLE"

rm -f "$ROOT_DIR/dist/LifeDiary-iOS-v0.3.1-b4-unsigned.ipa"
(
    cd "$ROOT_DIR/dist"
    /usr/bin/zip -qry "LifeDiary-iOS-v0.3.1-b4-unsigned.ipa" Payload
)
