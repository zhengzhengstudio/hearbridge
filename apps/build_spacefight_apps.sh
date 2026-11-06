#!/bin/bash
set -euo pipefail

VERSION="0.10.2"
BUILD="20"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# This SpriteKit/Compose/ArkUI pipeline is retained only for historical
# reproducibility. Current SpaceFight clients are exported from Cocos Creator;
# keeping the old builder opt-in prevents a 2D package from replacing them.
if [ "${SPACEFIGHT_ALLOW_LEGACY_2D_BUILD:-0}" != "1" ]; then
  echo "旧版 2D 构建器已停用。请使用 SpaceFight-Cocos 的原生构建命令。" >&2
  exit 64
fi
APPS_DIR="$ROOT/apps"
API_APPS="$ROOT/website/api/apps"
# 网站下载中心实际读取的目录（client-downloads.json + 发布包都放这里，
# 并被 sync_to_termux.js 白名单同步到线上 Termux）。
PUBLIC_APPS="$ROOT/website/zhengzhengstudio.cn/api/apps"
ANDROID_DIR="$ROOT/ZhengZhengStudioApp/ZhengZhengStudioAndroid"
HARMONY_DIR="$ROOT/HarmonyOS-App/SpaceFightHarmony"
HARMONY_OFFLINE_DIR="$ROOT/HarmonyOS-App/SpaceFightHarmonyOffline"
HARMONY_MATERIAL="$ROOT/website/api/data/harmony-signing/cn.zhengzhengstudio.spacefight.hmos"
HARMONY_OFFLINE_MATERIAL="$ROOT/website/api/data/harmony-signing/cn.zhengzhengstudio.spacefight.huawei"
JDK21="${JDK21:-$HOME/Library/Application Support/LauncherX/LauncherX/DownloadedJRE/ZULU_JDK_21_OSX_X64/zulu-21.jdk/Contents/Home}"

BUILD_ANDROID=1
BUILD_MACOS=1
BUILD_IOS=1
BUILD_HARMONY=1
UPDATE_METADATA=1

if [ "$#" -gt 0 ]; then
  BUILD_ANDROID=0
  BUILD_MACOS=0
  BUILD_IOS=0
  BUILD_HARMONY=0
  for option in "$@"; do
    case "$option" in
      --android-only)
        BUILD_ANDROID=1
        ;;
      --apple-only)
        BUILD_MACOS=1
        BUILD_IOS=1
        ;;
      --harmony-only)
        BUILD_HARMONY=1
        ;;
      --metadata-only)
        UPDATE_METADATA=1
        ;;
      --with-metadata)
        UPDATE_METADATA=1
        ;;
      *)
        echo "Unknown option: $option" >&2
        exit 2
        ;;
    esac
  done
fi

ANDROID_APK="SpaceFight-Android-v${VERSION}.apk"
MAC_DMG="SpaceFight-macOS-v${VERSION}.dmg"
IOS_IPA="SpaceFight-iOS-v${VERSION}.ipa"
# 是否已配置鸿蒙签名材料（.p12 + .cer + .p7b 齐全）。决定 HAP 命名/标记。
if [ -f "$HARMONY_MATERIAL/keystore.p12" ] && ls "$HARMONY_MATERIAL"/*.cer >/dev/null 2>&1 && ls "$HARMONY_MATERIAL"/*.p7b >/dev/null 2>&1; then
  HARMONY_SIGNED=1
  HAP_FILE="SpaceFight-HarmonyOS-v${VERSION}.hap"
  HAP_LATEST="SpaceFight-HarmonyOS-latest.hap"
else
  HARMONY_SIGNED=0
  HAP_FILE="SpaceFight-HarmonyOS-v${VERSION}-unsigned.hap"
  HAP_LATEST="SpaceFight-HarmonyOS-latest-unsigned.hap"
fi
if [ -f "$HARMONY_OFFLINE_MATERIAL/keystore.p12" ] && ls "$HARMONY_OFFLINE_MATERIAL"/*.cer >/dev/null 2>&1 && ls "$HARMONY_OFFLINE_MATERIAL"/*.p7b >/dev/null 2>&1; then
  HARMONY_OFFLINE_SIGNED=1
HAP_OFFLINE_FILE="SpaceFight-HarmonyOS-Offline-v${VERSION}.hap"
HAP_OFFLINE_LATEST="SpaceFight-HarmonyOS-Offline-latest.hap"
APP_OFFLINE_FILE="SpaceFight-HarmonyOS-Offline-v${VERSION}.app"
APP_OFFLINE_LATEST="SpaceFight-HarmonyOS-Offline-latest.app"
else
  HARMONY_OFFLINE_SIGNED=0
  HAP_OFFLINE_FILE="SpaceFight-HarmonyOS-Offline-v${VERSION}-unsigned.hap"
  HAP_OFFLINE_LATEST="SpaceFight-HarmonyOS-Offline-latest-unsigned.hap"
fi

mkdir -p "$API_APPS" "$PUBLIC_APPS" "$APPS_DIR/build_output"

build_android() {
  echo "=== Building SpaceFight Android ==="
  if [ -d "$JDK21" ]; then
    export JAVA_HOME="$JDK21"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
  (
    cd "$ANDROID_DIR"
    ./gradlew :app:assembleRelease
  )
  cp "$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk" "$API_APPS/$ANDROID_APK"
  cp "$API_APPS/$ANDROID_APK" "$API_APPS/SpaceFight-Android-latest.apk"
}

build_macos() {
  echo "=== Building SpaceFight macOS ==="
  local build_dir="$APPS_DIR/SpaceFightMac/build"
  local app_dir="$build_dir/SpaceFight.app"
  rm -rf "$build_dir"
  mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
  xcrun swiftc -O -framework Cocoa -framework SpriteKit \
    "$APPS_DIR/SpaceFightShared/NativeGameScene.swift" \
    "$APPS_DIR/SpaceFightMac/Sources/main.swift" \
    -o "$app_dir/Contents/MacOS/SpaceFight"
  cp "$APPS_DIR/SpaceFightShared/Resources/ships/"*.png "$app_dir/Contents/Resources/"
  cp "$APPS_DIR/SpaceFightShared/Resources/spacefight-battlefield.png" "$app_dir/Contents/Resources/"
  cp "$APPS_DIR/SpaceFightShared/Resources/icons/SpaceFight.icns" "$app_dir/Contents/Resources/SpaceFight.icns"
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' '<plist version="1.0"><dict></dict></plist>' > "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string SpaceFight" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string cn.zhengzhengstudio.spacefight" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string SpaceFight" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string SpaceFight" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string SpaceFight.icns" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string 11.0" "$app_dir/Contents/Info.plist"
  codesign --force --deep --sign - "$app_dir" >/dev/null 2>&1 || true
  hdiutil create -volname "SpaceFight" -srcfolder "$app_dir" -ov -format UDZO "$APPS_DIR/build_output/$MAC_DMG"
  cp "$APPS_DIR/build_output/$MAC_DMG" "$API_APPS/$MAC_DMG"
  cp "$API_APPS/$MAC_DMG" "$API_APPS/SpaceFight-macOS-latest.dmg"
}

build_ios() {
  echo "=== Building SpaceFight iOS ==="
  local build_dir="$APPS_DIR/SpaceFight-iOS/build"
  local payload="$build_dir/Payload"
  local app_dir="$payload/SpaceFight.app"
  local sdk_path
  sdk_path="$(xcrun --sdk iphoneos --show-sdk-path)"
  rm -rf "$build_dir"
  mkdir -p "$app_dir"
  xcrun --sdk iphoneos swiftc -O -target arm64-apple-ios16.0 -sdk "$sdk_path" \
    -framework UIKit -framework SpriteKit \
    "$APPS_DIR/SpaceFightShared/NativeGameScene.swift" \
    "$APPS_DIR/SpaceFight-iOS/Sources/main.swift" \
    -o "$app_dir/SpaceFight"
  cp "$APPS_DIR/SpaceFightShared/Resources/ships/"*.png "$app_dir/"
  cp "$APPS_DIR/SpaceFightShared/Resources/spacefight-battlefield.png" "$app_dir/"
  cp "$APPS_DIR/SpaceFightShared/Resources/icons/AppIcon60x60@2x.png" "$app_dir/"
  cp "$APPS_DIR/SpaceFightShared/Resources/icons/AppIcon60x60@3x.png" "$app_dir/"
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' '<plist version="1.0"><dict></dict></plist>' > "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string SpaceFight" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string cn.zhengzhengstudio.spacefight" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string SpaceFight" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string SpaceFight" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFiles array" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFiles:0 string AppIcon60x60" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :MinimumOSVersion string 16.0" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations array" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationLandscapeLeft" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :UISupportedInterfaceOrientations:1 string UIInterfaceOrientationLandscapeRight" "$app_dir/Info.plist"
  codesign --force --deep --sign - "$app_dir" >/dev/null 2>&1 || true
  (
    cd "$build_dir"
    zip -qry "$IOS_IPA" Payload
  )
  cp "$build_dir/$IOS_IPA" "$API_APPS/$IOS_IPA"
  cp "$API_APPS/$IOS_IPA" "$API_APPS/SpaceFight-iOS-latest.ipa"
}

build_harmony() {
  echo "=== Building SpaceFight HarmonyOS ==="
  if [ ! -d "$HARMONY_DIR" ]; then
    echo "HarmonyOS project missing: $HARMONY_DIR" >&2
    return 0
  fi
  if [ ! -x "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ] &&
     [ ! -x "/Volumes/DevEco-Studio/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ] &&
     ! command -v hvigor >/dev/null 2>&1 &&
     ! command -v hvigorw >/dev/null 2>&1; then
    echo "未找到 DevEco/Hvigor，跳过 HAP 构建。SpaceFightHarmony 工程已准备好。"
    return 0
  fi
  # Pick a DevEco that actually carries the hvigor toolchain (the /Applications
  # stub may exist but be empty; the mounted DMG volume is valid).
  if [ -z "${DEVECO_APP:-}" ]; then
    if [ -x "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ]; then
      export DEVECO_APP="/Applications/DevEco-Studio.app"
    elif [ -x "/Volumes/DevEco-Studio/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ]; then
      export DEVECO_APP="/Volumes/DevEco-Studio/DevEco-Studio.app"
    fi
  fi
  local expected_output="$HARMONY_DIR/entry/build/default/outputs/default/SpaceFight-HarmonyOS-v${VERSION}.hap"
  if [ -f "$expected_output" ]; then
    unlink "$expected_output"
  fi
  "$HARMONY_DIR/build-hap.sh"
  local output
  output="$expected_output"
  if [ -z "$output" ]; then
    echo "HAP output not found" >&2
    return 0
  fi
  if [ ! -f "$output" ]; then
    echo "HAP output not found: $output" >&2
    return 0
  fi
  # 若已配置签名材料，则把未签名 HAP 交给签名工具产出正式签名包。
  if [ "$HARMONY_SIGNED" = "1" ] && [ -x "$ROOT/website/api/tools/harmony_signing/sign_hap.sh" ]; then
    local signed
    if signed="$("$ROOT/website/api/tools/harmony_signing/sign_hap.sh" "$output" cn.zhengzhengstudio.spacefight.hmos)" && [ -f "$signed" ]; then
      output="$signed"
      echo "已使用华为签名材料对 HAP 完成签名：$output"
    else
      echo "[warn] 签名失败，回退为未签名 HAP" >&2
      HARMONY_SIGNED=0
      HAP_FILE="SpaceFight-HarmonyOS-v${VERSION}-unsigned.hap"
      HAP_LATEST="SpaceFight-HarmonyOS-latest-unsigned.hap"
    fi
  fi
  # 清掉旧的另一命名（signed<->unsigned 切换时避免下载中心同时出现两个）。
  rm -f "$API_APPS"/SpaceFight-HarmonyOS-v*.hap "$API_APPS"/SpaceFight-HarmonyOS-latest*.hap 2>/dev/null || true
  cp "$output" "$API_APPS/$HAP_FILE"
  cp "$API_APPS/$HAP_FILE" "$API_APPS/$HAP_LATEST"
}

build_harmony_offline() {
  echo "=== Building SpaceFight Offline HarmonyOS ==="
  if [ ! -d "$HARMONY_OFFLINE_DIR" ]; then
    echo "HarmonyOS Offline project missing: $HARMONY_OFFLINE_DIR" >&2
    return 1
  fi
  if [ ! -x "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ] &&
     [ ! -x "/Volumes/DevEco-Studio/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ] &&
     ! command -v hvigor >/dev/null 2>&1 &&
     ! command -v hvigorw >/dev/null 2>&1; then
    echo "未找到 DevEco/Hvigor，跳过 Offline HAP 构建。"
    return 1
  fi
  if [ -z "${DEVECO_APP:-}" ]; then
    if [ -x "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ]; then
      export DEVECO_APP="/Applications/DevEco-Studio.app"
    elif [ -x "/Volumes/DevEco-Studio/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw" ]; then
      export DEVECO_APP="/Volumes/DevEco-Studio/DevEco-Studio.app"
    fi
  fi
  if [ "$HARMONY_OFFLINE_SIGNED" = "1" ] && [ -x "$HARMONY_OFFLINE_DIR/build-release.sh" ]; then
    "$HARMONY_OFFLINE_DIR/build-release.sh"
    local release_dir="$HARMONY_OFFLINE_DIR/entry/build/default/outputs/default"
    [ -f "$release_dir/$HAP_OFFLINE_FILE" ] || { echo "Offline release HAP output not found" >&2; return 1; }
    [ -f "$release_dir/$APP_OFFLINE_FILE" ] || { echo "Offline release APP output not found" >&2; return 1; }
    rm -f "$API_APPS"/SpaceFight-HarmonyOS-Offline-v*.hap "$API_APPS"/SpaceFight-HarmonyOS-Offline-latest*.hap 2>/dev/null || true
    cp "$release_dir/$HAP_OFFLINE_FILE" "$API_APPS/$HAP_OFFLINE_FILE"
    cp "$API_APPS/$HAP_OFFLINE_FILE" "$API_APPS/$HAP_OFFLINE_LATEST"
    cp "$release_dir/$APP_OFFLINE_FILE" "$API_APPS/$APP_OFFLINE_FILE"
    cp "$API_APPS/$APP_OFFLINE_FILE" "$API_APPS/$APP_OFFLINE_LATEST"
    return 0
  fi
  local expected_output="$HARMONY_OFFLINE_DIR/entry/build/default/outputs/default/SpaceFight-HarmonyOS-Offline-v${VERSION}.hap"
  if [ -f "$expected_output" ]; then
    unlink "$expected_output"
  fi
  "$HARMONY_OFFLINE_DIR/build-hap.sh"
  if [ ! -f "$expected_output" ]; then
    echo "Offline HAP output not found: $expected_output" >&2
    return 1
  fi
  local output="$expected_output"
  if [ "$HARMONY_OFFLINE_SIGNED" = "1" ] && [ -x "$ROOT/website/api/tools/harmony_signing/sign_hap.sh" ]; then
    local signed
    if signed="$("$ROOT/website/api/tools/harmony_signing/sign_hap.sh" "$output" cn.zhengzhengstudio.spacefight.huawei)" && [ -f "$signed" ]; then
      output="$signed"
      echo "已使用 Offline 华为签名材料对 HAP 完成签名：$output"
    else
      echo "[warn] Offline 签名失败，回退为未签名 HAP" >&2
      HARMONY_OFFLINE_SIGNED=0
      HAP_OFFLINE_FILE="SpaceFight-HarmonyOS-Offline-v${VERSION}-unsigned.hap"
      HAP_OFFLINE_LATEST="SpaceFight-HarmonyOS-Offline-latest-unsigned.hap"
    fi
  fi
  rm -f "$API_APPS"/SpaceFight-HarmonyOS-Offline-v*.hap "$API_APPS"/SpaceFight-HarmonyOS-Offline-latest*.hap 2>/dev/null || true
  cp "$output" "$API_APPS/$HAP_OFFLINE_FILE"
  cp "$API_APPS/$HAP_OFFLINE_FILE" "$API_APPS/$HAP_OFFLINE_LATEST"
}

update_manifest() {
  echo "=== Updating website/api/apps/manifest.json ==="
  node - "$ROOT" "$VERSION" "$BUILD" "$HAP_FILE" "$HAP_LATEST" "$HARMONY_SIGNED" \
    "$HAP_OFFLINE_FILE" "$HAP_OFFLINE_LATEST" "$HARMONY_OFFLINE_SIGNED" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.argv[2];
const version = process.argv[3];
const build = Number(process.argv[4]);
const hapFile = process.argv[5];
const hapLatest = process.argv[6];
const harmonySigned = process.argv[7] === '1';
const hapOfflineFile = process.argv[8];
const hapOfflineLatest = process.argv[9];
const harmonyOfflineSigned = process.argv[10] === '1';
const appsDir = path.join(root, 'website/api/apps');
const manifestPath = path.join(appsDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const now = new Date().toISOString();

const candidates = [
  ['spacefight-android', 'android', 'Android', 'SpaceFight Android', `SpaceFight-Android-v${version}.apk`, '/api/apps/SpaceFight-Android-latest.apk', 'Android 7.0', 'cn.zhengzhengstudio.spacefight', '', false],
  ['spacefight-macos', 'macos', 'macOS', 'SpaceFight macOS', `SpaceFight-macOS-v${version}.dmg`, '/api/apps/SpaceFight-macOS-latest.dmg', 'macOS 11.0', 'cn.zhengzhengstudio.spacefight', '', false],
  ['spacefight-ios', 'ios', 'iOS', 'SpaceFight iOS', `SpaceFight-iOS-v${version}.ipa`, '/api/apps/SpaceFight-iOS-latest.ipa', 'iOS 16.0', 'cn.zhengzhengstudio.spacefight', '', false],
  ['spacefight-harmonyos', 'harmonyos', 'HarmonyOS', 'SpaceFight HarmonyOS', hapFile, `/api/apps/${hapLatest}`, 'HarmonyOS 4.0 / 5.0 / 6.0', 'cn.zhengzhengstudio.spacefight.hmos', '', harmonySigned],
  ['spacefight-harmonyos-offline', 'harmonyos', 'HarmonyOS', 'SpaceFight Offline HarmonyOS', hapOfflineFile, `/api/apps/${hapOfflineLatest}`, 'HarmonyOS 4.0 / 5.0 / 6.0', 'cn.zhengzhengstudio.spacefight.huawei', 'offline', harmonyOfflineSigned],
  ['spacefight-harmonyos-offline-app', 'harmonyos', 'HarmonyOS', 'SpaceFight Offline HarmonyOS APP', `SpaceFight-HarmonyOS-Offline-v${version}.app`, '/api/apps/SpaceFight-HarmonyOS-Offline-latest.app', 'HarmonyOS 4.0 / 5.0 / 6.0', 'cn.zhengzhengstudio.spacefight.huawei', 'offline', harmonyOfflineSigned]
];
const entries = candidates.filter(([, , , , fileName]) => fs.existsSync(path.join(appsDir, fileName)));

function fileInfo(fileName) {
  const full = path.join(appsDir, fileName);
  if (!fs.existsSync(full)) return { size: 0, sha256: '' };
  const data = fs.readFileSync(full);
  return {
    size: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

manifest.apps = (manifest.apps || []).filter(app => {
  const id = String(app.id || '');
  return !id.startsWith('spacefight-');
});
for (const [id, platform, platformLabel, name, fileName, latestUrl, minSystem, bundleIdentifier, variant, signed] of entries) {
  const info = fileInfo(fileName);
  const entry = {
    id,
    platform,
    platformLabel,
    kind: 'package',
    name,
    version,
    build,
    fileName,
    downloadURL: `/api/apps/${fileName}`,
    url: latestUrl,
    versionedUrl: `/api/apps/${fileName}`,
    pageURL: 'https://spacefight.zhengzhengstudio.cn/',
    minimumSystem: minSystem,
    minSystem,
    bundleIdentifier,
    notes: (variant === 'offline' ? [
      `${version}：HarmonyOS 单机版使用独立包名，可与联网版同时安装。`,
      '完整提供生存、首领、护航、防守、歼灭和突袭六种本地任务，不含通行证、账号状态、网络权限或在线更新请求。',
      '本机 60 Hz 模拟、第一/第三人称切换、双指操控、飞行校准、暂停和矢量图标完整保留。'
    ] : [
      `${version}：新增真实炮口、弹道引导线与主炮准星，镜头视线和武器实际朝向不再混为一谈。`,
      '推进/平移、机头转向和主武器控制区均明确标注；六种任务继续使用本机 60 Hz 模拟。',
      '账号、更新、暂停与武器控制使用本地矢量图标；App 不加载网站、HTML 或 WebView。',
      platform === 'harmonyos'
        ? (signed
            ? 'HAP 已使用华为正式证书签名，可直接安装/覆盖升级。'
            : 'HAP 为未签名开发包，仅供构建检查；正式安装请配置同一华为证书签名。')
        : '安装包不包含 HTML、JavaScript 或 WebView；更新只读取版本清单并打开安装包地址。'
    ]).concat(platform === 'harmonyos' && variant === 'offline'
      ? [signed ? 'Offline HAP 已签名，可直接安装。' : 'Offline HAP 为未签名开发包，仅供构建检查。']
      : []),
    size: info.size,
    sha256: info.sha256,
    updatedAt: now,
    title: `${name} v${version} build ${build}`
  };
  if (variant) entry.variant = variant;
  if (platform === 'harmonyos') {
    entry.signed = signed;
    entry.artifactType = id.endsWith('-app') ? 'app' : 'hap';
    if (id.endsWith('-app')) entry.storeReady = signed;
  }
  manifest.apps.unshift(entry);
}

manifest.generatedAt = now;
manifest.updatedAt = now;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
NODE
}

# 把构建产物同步到网站下载中心实际服务的目录 PUBLIC_APPS。
copy_to_public() {
  echo "=== Copying packages to $PUBLIC_APPS ==="
  local f
  for f in "$ANDROID_APK" "SpaceFight-Android-latest.apk" \
           "$MAC_DMG" "SpaceFight-macOS-latest.dmg" \
           "$IOS_IPA" "SpaceFight-iOS-latest.ipa" \
           "$HAP_FILE" "$HAP_LATEST" \
           "$HAP_OFFLINE_FILE" "$HAP_OFFLINE_LATEST" \
           "$APP_OFFLINE_FILE" "$APP_OFFLINE_LATEST"; do
    if [ -f "$API_APPS/$f" ]; then
      cp "$API_APPS/$f" "$PUBLIC_APPS/$f"
    fi
  done
  cp "$API_APPS/manifest.json" "$PUBLIC_APPS/manifest.json"
  # 切换 signed<->unsigned 命名时，清掉 PUBLIC 目录里另一种 HAP 命名。
  if [ "$HARMONY_SIGNED" = "1" ]; then
    rm -f "$PUBLIC_APPS/SpaceFight-HarmonyOS-v${VERSION}-unsigned.hap" "$PUBLIC_APPS/SpaceFight-HarmonyOS-latest-unsigned.hap" 2>/dev/null || true
  else
    rm -f "$PUBLIC_APPS/SpaceFight-HarmonyOS-v${VERSION}.hap" "$PUBLIC_APPS/SpaceFight-HarmonyOS-latest.hap" 2>/dev/null || true
  fi
  if [ "$HARMONY_OFFLINE_SIGNED" = "1" ]; then
    rm -f "$PUBLIC_APPS/SpaceFight-HarmonyOS-Offline-v${VERSION}-unsigned.hap" "$PUBLIC_APPS/SpaceFight-HarmonyOS-Offline-latest-unsigned.hap" 2>/dev/null || true
  else
    rm -f "$PUBLIC_APPS/SpaceFight-HarmonyOS-Offline-v${VERSION}.hap" "$PUBLIC_APPS/SpaceFight-HarmonyOS-Offline-latest.hap" 2>/dev/null || true
  fi
}

# 把 SpaceFight 全端条目幂等写入 client-downloads.json（下载中心真正读取的清单）。
update_client_downloads() {
  echo "=== Updating client-downloads.json (download center) ==="
  node - "$ROOT" "$VERSION" "$BUILD" "$HAP_FILE" "$HAP_LATEST" "$HARMONY_SIGNED" \
    "$HAP_OFFLINE_FILE" "$HAP_OFFLINE_LATEST" "$HARMONY_OFFLINE_SIGNED" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.argv[2];
const version = process.argv[3];
const build = Number(process.argv[4]);
const hapFile = process.argv[5];
const hapLatest = process.argv[6];
const harmonySigned = process.argv[7] === '1';
const hapOfflineFile = process.argv[8];
const hapOfflineLatest = process.argv[9];
const harmonyOfflineSigned = process.argv[10] === '1';
const appsDir = path.join(root, 'website/zhengzhengstudio.cn/api/apps');
const filePath = path.join(appsDir, 'client-downloads.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const now = new Date().toISOString();

const notes = [
  `${version}：新增真实炮口、弹道引导线与主炮准星，镜头视线和武器实际朝向不再混为一谈。`,
  '推进/平移、机头转向和主武器控制区均明确标注；六种任务继续使用本机 60 Hz 模拟。',
  '账号、更新、暂停与武器控制使用本地矢量图标；App 不加载网站、HTML 或 WebView。'
];

const candidates = [
  ['spacefight-ios', 'ios', 'iOS', 'SpaceFight', `SpaceFight-iOS-v${version}.ipa`, '/api/apps/SpaceFight-iOS-latest.ipa', 'iOS 16.0', 'cn.zhengzhengstudio.spacefight', '', false],
  ['spacefight-macos', 'macos', 'macOS', 'SpaceFight', `SpaceFight-macOS-v${version}.dmg`, '/api/apps/SpaceFight-macOS-latest.dmg', 'macOS 11.0', 'cn.zhengzhengstudio.spacefight', '', false],
  ['spacefight-android', 'android', 'Android', 'SpaceFight', `SpaceFight-Android-v${version}.apk`, '/api/apps/SpaceFight-Android-latest.apk', 'Android 7.0', 'cn.zhengzhengstudio.spacefight', '', false],
  ['spacefight-harmonyos', 'harmonyos', 'HarmonyOS', 'SpaceFight', hapFile, `/api/apps/${hapLatest}`, 'HarmonyOS 4.0 / 5.0 / 6.0', 'cn.zhengzhengstudio.spacefight.hmos', '', harmonySigned],
  ['spacefight-harmonyos-offline', 'harmonyos', 'HarmonyOS', 'SpaceFight Offline', hapOfflineFile, `/api/apps/${hapOfflineLatest}`, 'HarmonyOS 4.0 / 5.0 / 6.0', 'cn.zhengzhengstudio.spacefight.huawei', 'offline', harmonyOfflineSigned],
  ['spacefight-harmonyos-offline-app', 'harmonyos', 'HarmonyOS', 'SpaceFight Offline APP', `SpaceFight-HarmonyOS-Offline-v${version}.app`, '/api/apps/SpaceFight-HarmonyOS-Offline-latest.app', 'HarmonyOS 4.0 / 5.0 / 6.0', 'cn.zhengzhengstudio.spacefight.huawei', 'offline', harmonyOfflineSigned]
];

function fileInfo(fileName) {
  const full = path.join(appsDir, fileName);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  return { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

const built = [];
for (const [id, platform, platformLabel, name, fileName, latestUrl, minSystem, bundleIdentifier, variant, signed] of candidates) {
  const info = fileInfo(fileName);
  if (!info) continue; // 该端没产出包就不写条目
  const isHarmony = platform === 'harmonyos';
  const entry = {
    id,
    name,
    platform,
    platformLabel,
    kind: 'package',
    version,
    build,
    minSystem,
    fileName,
    url: latestUrl,
    versionedUrl: `/api/apps/${fileName}`,
    downloadURL: `/api/apps/${fileName}`,
    pageURL: 'https://spacefight.zhengzhengstudio.cn/',
    bundleIdentifier,
    size: info.size,
    sha256: info.sha256,
    updatedAt: now,
    notes: variant === 'offline'
      ? [
          `${version}：HarmonyOS 单机版使用独立包名，可与联网版同时安装。`,
          '完整提供生存、首领、护航、防守、歼灭和突袭六种本地任务，不含通行证、账号状态、网络权限或在线更新请求。',
          '本机 60 Hz 模拟、第一/第三人称切换、双指操控、飞行校准、暂停和矢量图标完整保留。',
          signed ? 'Offline HAP 已签名，可直接安装。' : '未签名 Offline 开发包仅供构建检查，下载中心会阻止直接安装。'
        ]
      : isHarmony
      ? notes.concat(signed
          ? ['HAP 已使用华为正式证书签名，可直接安装或覆盖升级。']
          : ['未签名开发包仅供构建检查，远程安装器会在安装前阻止。配置同一华为证书签名后可正式安装。'])
      : notes.concat(['安装包不包含 HTML、JavaScript 或 WebView；更新只读取版本清单并打开安装包地址。']),
    category: '游戏',
    remarks: variant === 'offline'
      ? '纯单机原生 HarmonyOS 太空射击，不含通行证和网络权限。'
      : isHarmony && !signed
      ? '原生 HarmonyOS 太空射击。此构建未配置华为签名，下载中心会阻止直接真机安装。'
      : '原生太空射击客户端，主要模式使用本机 60 Hz 离线运行。',
    title: variant === 'offline'
      ? `SpaceFight Offline HarmonyOS v${version}${signed ? '' : '（未签名开发包）'}`
      : isHarmony
      ? `SpaceFight HarmonyOS v${version}${signed ? '' : '（未签名开发包）'}`
      : `SpaceFight ${platformLabel} v${version} build ${build}`
  };
  if (variant) entry.variant = variant;
  if (platform === 'harmonyos') {
    entry.signed = signed;
    entry.artifactType = id.endsWith('-app') ? 'app' : 'hap';
    if (id.endsWith('-app')) entry.storeReady = signed;
  }
  built.push(entry);
}

data.apps = (Array.isArray(data.apps) ? data.apps : []).filter(a => {
  const id = String(a.id || '');
  return !id.startsWith('spacefight-');
});
// 放到列表前部，下载中心默认按 mtime 排序，这里只保证存在性与字段正确。
data.apps = built.concat(data.apps);
data.updatedAt = now;
fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
fs.copyFileSync(filePath, path.join(root, 'website/api/apps/client-downloads.json'));
console.log(`client-downloads.json: wrote ${built.length} SpaceFight entries (${built.map(e => e.platform).join(', ')})`);
NODE
}

# Build small/safe targets first; tolerate per-platform failure (e.g. low disk)
# so a single failed platform never blocks the others or the manifest refresh.
# update_manifest already skips packages that were not produced.
if [ "$BUILD_MACOS" = "1" ]; then build_macos || echo "[warn] macOS build failed (continuing)"; fi
if [ "$BUILD_IOS" = "1" ]; then build_ios || echo "[warn] iOS build failed (continuing)"; fi
if [ "$BUILD_ANDROID" = "1" ]; then build_android || echo "[warn] Android build failed (continuing)"; fi
if [ "$BUILD_HARMONY" = "1" ]; then build_harmony || echo "[warn] HarmonyOS build skipped/failed (continuing)"; fi
if [ "$BUILD_HARMONY" = "1" ]; then build_harmony_offline || echo "[warn] HarmonyOS Offline build skipped/failed (continuing)"; fi

if [ "$UPDATE_METADATA" = "1" ]; then
  update_manifest
  copy_to_public
  update_client_downloads
fi

echo "SpaceFight app packages copied to $API_APPS and $PUBLIC_APPS"
