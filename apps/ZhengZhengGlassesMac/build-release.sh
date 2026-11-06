#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${VERSION:-0.1.5}"
BUILD_NUMBER="${BUILD_NUMBER:-6}"
BUILD_DIR="$PROJECT_DIR/build-v$VERSION"
STAGE_DIR="$BUILD_DIR/stage"
APP_DIR="$STAGE_DIR/ZhengZhengGlasses.app"
CONTENTS="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"
DMG="$BUILD_DIR/ZhengZhengGlasses-macOS-v$VERSION.dmg"
SOURCE="$PROJECT_DIR/Sources/main.swift"

rm -rf "$BUILD_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

xcrun swiftc -O -target x86_64-apple-macos12.0 -framework Cocoa \
  "$SOURCE" -o "$BUILD_DIR/ZhengZhengGlasses-x86_64"
xcrun swiftc -O -target arm64-apple-macos12.0 -framework Cocoa \
  "$SOURCE" -o "$BUILD_DIR/ZhengZhengGlasses-arm64"
lipo -create \
  "$BUILD_DIR/ZhengZhengGlasses-x86_64" \
  "$BUILD_DIR/ZhengZhengGlasses-arm64" \
  -output "$MACOS_DIR/ZhengZhengGlasses"

cp "$PROJECT_DIR/build/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"

/usr/libexec/PlistBuddy -c 'Add :CFBundleDisplayName string 铮铮眼镜' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string ZhengZhengGlasses' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string AppIcon' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string cn.zhengzhengstudio.glasses' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string 铮铮眼镜' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string APPL' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD_NUMBER" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 12.0' "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSHighResolutionCapable bool true' "$CONTENTS/Info.plist"

codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"

ln -s /Applications "$STAGE_DIR/Applications"

# 分发物：优先出标准 .dmg；但 hdiutil 需要把镜像挂到 /Volumes，
# 在受限/沙箱环境下该挂载会被拒绝。失败时回退到 zip（已签名的 .app 直接打包，
# macOS 用户双击解压即得 .app，拖入「应用程序」即可安装）。
ZIP="$BUILD_DIR/ZhengZhengGlasses-macOS-v$VERSION.zip"
rm -f "$ZIP"
/usr/bin/ditto -c -k --keepParent "$APP_DIR" "$ZIP"

ARTIFACT="$ZIP"
# 默认只出 zip（沙箱/受限环境无法挂载 /Volumes 做 hdiutil）。
# 在本机真实环境需要标准 .dmg 时，用 MAKE_DMG=1 触发（需能挂载 /Volumes）：
#   MAKE_DMG=1 VERSION=0.1.6 BUILD_NUMBER=7 bash build-release.sh
if [ "${MAKE_DMG:-0}" = "1" ]; then
  if hdiutil create -volname "铮铮眼镜" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG" 2>/dev/null; then
    ARTIFACT="$DMG"
  fi
fi

rm -f "$BUILD_DIR/ZhengZhengGlasses-x86_64" "$BUILD_DIR/ZhengZhengGlasses-arm64"

mkdir -p "$PROJECT_DIR/release"
cp "$ARTIFACT" "$PROJECT_DIR/release/$(basename "$ARTIFACT")"
echo "macOS package: $ARTIFACT"
shasum -a 256 "$ARTIFACT"
stat -f 'size=%z' "$ARTIFACT"
