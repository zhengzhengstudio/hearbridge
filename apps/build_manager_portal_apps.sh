#!/bin/bash
set -euo pipefail

VERSION="1.5.2"
BUILD="14"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_DOWNLOADS="${USER_DOWNLOADS:-$HOME/Downloads}"
APPS_DIR="$ROOT/apps"
API_APPS="$ROOT/website/api/apps"
PUBLIC_APPS="$ROOT/website/zhengzhengstudio.cn/api/apps"
MANAGER_PORTAL_APPS="$ROOT/website/zhengzhengstudio.cn/manager_portal/apps.json"
ICON_PNG="$ROOT/website/zhengzhengstudio.cn/assets/icons/manager-portal-icon.png"
MAC_DIR="$APPS_DIR/ManagerPortalMac"
IOS_DIR="$APPS_DIR/ManagerPortal-iOS"
ANDROID_DIR="$APPS_DIR/ManagerPortal-Android"
HARMONY_DIR="$APPS_DIR/ManagerPortal-HarmonyOS"
JDK21="${JDK21:-/Users/ljg/java/zulu21.34.19-ca-jdk21.0.3-macosx_x64/zulu-21.jdk/Contents/Home}"

MAC_DMG="ManagerPortal-macOS-v${VERSION}.dmg"
IOS_IPA="ManagerPortal-iOS-v${VERSION}-unsigned.ipa"
ANDROID_APK="ManagerPortal-Android-v${VERSION}.apk"
HARMONY_HAP="ManagerPortal-HarmonyOS-v${VERSION}-unsigned.hap"

mkdir -p "$API_APPS" "$PUBLIC_APPS" "$APPS_DIR/build_output"

build_macos() {
  echo "=== Building ManagerPortal macOS ==="
  local build_dir="$MAC_DIR/build-v${VERSION}"
  local app_dir="$build_dir/ManagerPortal.app"
  local temp_dmg="/tmp/$MAC_DMG"
  if [ "${SKIP_MAC_DMG:-0}" = "1" ] && [ -f "$APPS_DIR/build_output/$MAC_DMG" ]; then
    echo "Reusing verified $MAC_DMG"
    cp "$APPS_DIR/build_output/$MAC_DMG" "$API_APPS/$MAC_DMG"
    cp "$API_APPS/$MAC_DMG" "$API_APPS/ManagerPortal-macOS-latest.dmg"
    return
  fi
  rm -rf "$build_dir"
  mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
  xcrun swiftc -O -framework Cocoa -framework UserNotifications \
    "$MAC_DIR/Sources/main.swift" \
    -o "$app_dir/Contents/MacOS/ManagerPortal"
  cp "$MAC_DIR/ManagerPortal.icns" "$app_dir/Contents/Resources/ManagerPortal.icns"
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' '<plist version="1.0"><dict></dict></plist>' > "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string ManagerPortal" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string cn.zhengzhengstudio.managerportal.macos" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string 铮铮控制台" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 铮铮控制台" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string ManagerPortal" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD" "$app_dir/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string 12.0" "$app_dir/Contents/Info.plist"
  codesign --force --deep --sign - "$app_dir" >/dev/null 2>&1 || true
  # DiskImages can stall when writing directly into a path containing non-ASCII segments.
  hdiutil create -fs HFS+ -volname "ManagerPortal" -srcfolder "$app_dir" -ov -format UDZO "$temp_dmg"
  mv -f "$temp_dmg" "$APPS_DIR/build_output/$MAC_DMG"
  cp "$APPS_DIR/build_output/$MAC_DMG" "$API_APPS/$MAC_DMG"
  cp "$API_APPS/$MAC_DMG" "$API_APPS/ManagerPortal-macOS-latest.dmg"
}

build_ios() {
  echo "=== Building ManagerPortal iOS ==="
  local build_dir="$IOS_DIR/build-v${VERSION}"
  local payload="$build_dir/Payload"
  local app_dir="$payload/ManagerPortal.app"
  local sdk_path
  sdk_path="$(xcrun --sdk iphoneos --show-sdk-path)"
  rm -rf "$build_dir"
  mkdir -p "$app_dir"
  xcrun --sdk iphoneos swiftc -O -target arm64-apple-ios16.0 -sdk "$sdk_path" \
    -framework UIKit -framework UserNotifications \
    "$IOS_DIR/Sources/main.swift" \
    -o "$app_dir/ManagerPortal"
  if [ "${SKIP_IOS_ASSETS:-0}" = "1" ] && [ -f "$IOS_DIR/build-v1.1.0/Payload/ManagerPortal.app/Assets.car" ]; then
    echo "Reusing unchanged verified iOS icon assets"
    cp "$IOS_DIR/build-v1.1.0/Payload/ManagerPortal.app/Assets.car" "$app_dir/Assets.car"
    cp "$IOS_DIR/build-v1.1.0/Payload/ManagerPortal.app/AppIcon60x60@2x.png" "$app_dir/AppIcon60x60@2x.png"
    cp "$IOS_DIR/build-v1.1.0/Payload/ManagerPortal.app/AppIcon76x76@2x~ipad.png" "$app_dir/AppIcon76x76@2x~ipad.png"
    cp "$IOS_DIR/build-v1.1.0/asset-info.plist" "$build_dir/asset-info.plist"
  else
    xcrun actool "$IOS_DIR/Assets.xcassets" \
      --compile "$app_dir" \
      --platform iphoneos \
      --minimum-deployment-target 16.0 \
      --app-icon AppIcon \
      --output-partial-info-plist "$build_dir/asset-info.plist" >/dev/null
  fi
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' '<plist version="1.0"><dict></dict></plist>' > "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string ManagerPortal" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string cn.zhengzhengstudio.managerportal.ios" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string 铮铮控制台" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 铮铮控制台" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :MinimumOSVersion string 16.0" "$app_dir/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :NSUserNotificationUsageDescription string 后台信息、重大漏洞和安全告警会通过通知提醒。" "$app_dir/Info.plist" || true
  /usr/libexec/PlistBuddy -c "Add :UIApplicationSceneManifest dict" "$app_dir/Info.plist" || true
  /usr/libexec/PlistBuddy -c "Merge $build_dir/asset-info.plist" "$app_dir/Info.plist" || true
  codesign --force --deep --sign - "$app_dir" >/dev/null 2>&1 || true
  (
    cd "$build_dir"
    zip -qry "$IOS_IPA" Payload
  )
  cp "$build_dir/$IOS_IPA" "$API_APPS/$IOS_IPA"
  cp "$API_APPS/$IOS_IPA" "$API_APPS/ManagerPortal-iOS-latest-unsigned.ipa"
}

build_android() {
  echo "=== Building ManagerPortal Android ==="
  (
    cd "$ANDROID_DIR"
    if [ -d "$JDK21" ]; then
      export JAVA_HOME="$JDK21"
      export PATH="$JAVA_HOME/bin:$PATH"
    fi
    ./gradlew :app:assembleDebug
  )
  cp "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk" "$API_APPS/$ANDROID_APK"
  cp "$API_APPS/$ANDROID_APK" "$API_APPS/ManagerPortal-Android-latest.apk"
}

build_harmony() {
  echo "=== Building ManagerPortal HarmonyOS ==="
  local deveco_app="${DEVECO_APP:-/Applications/DevEco-Studio.app}"
  local build_dir="/tmp/ManagerPortal-HarmonyOS-build"
  local hvigor="$deveco_app/Contents/tools/hvigor/bin/hvigorw"
  if [ ! -x "$hvigor" ]; then
    echo "DevEco Studio not found: $deveco_app" >&2
    return 1
  fi
  rm -rf "$build_dir"
  ditto "$HARMONY_DIR" "$build_dir"
  (
    export DEVECO_SDK_HOME="$deveco_app/Contents/sdk"
    export PATH="/tmp/hvigor-home/.hvigor/wrapper/tools/node_modules/pnpm/bin:$deveco_app/Contents/tools/node/bin:$PATH"
    export HOME="/tmp/hvigor-home"
    mkdir -p "$HOME"
    printf '%s\n' 'registry=https://registry.npmjs.org/' > "$HOME/.npmrc"
    cd "$build_dir"
    "$hvigor" assembleHap --mode module -p product=default -p module=entry@default -p buildMode=release --no-daemon
  )
  local output="$build_dir/entry/build/default/outputs/default/entry-default-unsigned.hap"
  if [ ! -f "$output" ]; then
    echo "HarmonyOS build completed without an unsigned HAP" >&2
    return 1
  fi
  mkdir -p "$HARMONY_DIR/entry/build/default/outputs/default"
  cp "$output" "$HARMONY_DIR/entry/build/default/outputs/default/$HARMONY_HAP"
  cp "$output" "$API_APPS/$HARMONY_HAP"
  cp "$output" "$API_APPS/ManagerPortal-HarmonyOS-latest-unsigned.hap"
}

cleanup_private_manager_files() {
  echo "=== Replacing ManagerPortal packages in private api/apps ==="
  rm -f "$API_APPS"/ManagerPortal-macOS-v*.dmg \
        "$API_APPS"/ManagerPortal-macOS-latest.dmg \
        "$API_APPS"/ManagerPortal-iOS-v*-unsigned.ipa \
        "$API_APPS"/ManagerPortal-iOS-latest-unsigned.ipa \
        "$API_APPS"/ManagerPortal-Android-v*.apk \
        "$API_APPS"/ManagerPortal-Android-latest.apk \
        "$API_APPS"/ManagerPortal-HarmonyOS-v*-unsigned.hap \
        "$API_APPS"/ManagerPortal-HarmonyOS-latest-unsigned.hap
}

cleanup_public_manager_files() {
  echo "=== Removing ManagerPortal packages from public static apps ==="
  rm -f "$PUBLIC_APPS"/ManagerPortal-macOS-v*.dmg \
        "$PUBLIC_APPS"/ManagerPortal-macOS-latest.dmg \
        "$PUBLIC_APPS"/ManagerPortal-iOS-v*-unsigned.ipa \
        "$PUBLIC_APPS"/ManagerPortal-iOS-latest-unsigned.ipa \
        "$PUBLIC_APPS"/ManagerPortal-Android-v*.apk \
        "$PUBLIC_APPS"/ManagerPortal-Android-latest.apk \
        "$PUBLIC_APPS"/ManagerPortal-HarmonyOS-v*-unsigned.hap \
        "$PUBLIC_APPS"/ManagerPortal-HarmonyOS-latest-unsigned.hap
}

update_downloads() {
  echo "=== Updating ManagerPortal private app entries ==="
  node - "$ROOT" "$VERSION" "$BUILD" "$MAC_DMG" "$IOS_IPA" "$ANDROID_APK" "$HARMONY_HAP" "$MANAGER_PORTAL_APPS" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [root, version, buildStr, macDmg, iosIpa, androidApk, harmonyHap, managerPortalAppsFile] = process.argv.slice(2);
const build = Number(buildStr);
const now = new Date().toISOString();
const ids = new Set(['manager-portal-web', 'manager-portal-macos', 'manager-portal-ios', 'manager-portal-android', 'manager-portal-harmony']);

function sizeSha(full) {
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  return { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

const baseNotes = [
  '媒体、下载、文档、网站与公共作品现已使用原生结构化列表和表单，不再以原始 JSON 作为主要工作区。',
  '内容修改使用字段白名单和版本校验完成安全编辑，删除前必须进行目标名称一致的删除确认。',
  '网站工作区支持原生网站创建，并在成功后刷新服务端记录。',
  '每次读取和修改都会执行模块权限检查；无权限会保留登录状态并显示明确提示。',
  '管理员会话失效并收到 401 时会清除本地凭据并自动退出到登录页。',
  '独立 Manager Portal 原生客户端，支持管理员密码与铮铮通行证直登。',
  '采用原生运维工作台：总览汇总队列，macOS 使用分组侧栏，iOS、Android 与 HarmonyOS 使用权限感知底部导航。',
  '新增完整反馈中心：状态处理、内部备注、回收站、恢复与仅总管理员可用的永久删除。',
  '反馈查看、处理、回收站和永久删除使用四级独立权限，未授权入口不会显示。',
  '支持后台信息、重大漏洞与安全告警提醒；用户授权系统通知后会推送到本机。',
  '内置自动更新检查；客户端清单和安装包只通过 Manager Portal 私有票据下载。',
  '修复通行证 authToken 登录、管理员登录 Turnstile 一次性 token 与指纹误拦截问题。',
  '新增用户喜好池：实时查看热门模块、页面偏好，并可设置定期提醒时间。',
  '终端升级为完整命令工作区：支持命令输入、执行状态、标准输出与错误输出分区、复制和清空。',
  '反馈记录支持一键复制编号、来源、联系方式、正文、状态、内部备注与提交时间。',
  '新增权限裁剪的原生工作台，集中显示系统状态、管理员目录、最近审计和四端客户端版本。',
  '总览只保留关键状态、最近告警和常用操作，移动端底部导航固定为总览、事务、工作台、账户。',
  '有权限且级别足够的管理员可在原生工作台启用或停用下级管理员，服务端阻止修改自己和同级或更高级账号。',
  '工作台新增与主站一致的完整功能目录，由服务端按管理员权限裁剪，无权限模块不会下发或显示。',
  '复杂管理模块使用原生数据工作区读取真实管理接口，不嵌入网页或 WebView；反馈、喜好、终端、系统和管理员使用专门原生界面。',
  '修复总管理员在 App 恢复会话后显示为零权限，以及无权限会话错误进入终端的问题。',
  '自动扫描发现新版本时会直接显示应用内提示，不再依赖系统通知权限；Android、macOS 与 HarmonyOS 下载完成后会交给系统安装器。'
];

function nativeEntries(appsDir) {
  const candidates = [
    ['manager-portal-macos', 'macos', 'macOS', 'macOS 12.0', macDmg, 'ManagerPortal-macOS-latest.dmg', 'macOS',
      '原生 macOS 客户端。当前 DMG 未配置开发者签名与公证，首次打开可能需要在系统设置中放行。'],
    ['manager-portal-ios', 'ios', 'iOS', 'iOS 16.0', iosIpa, 'ManagerPortal-iOS-latest-unsigned.ipa', 'iOS',
      '原生 iOS 客户端。当前为未签名开发包，真机安装需配置 Apple 分发签名。'],
    ['manager-portal-android', 'android', 'Android', 'Android 7.0', androidApk, 'ManagerPortal-Android-latest.apk', 'Android',
      '原生 Android 客户端。调试签名包，可直接安装测试；Android 13+ 会请求通知权限。'],
    ['manager-portal-harmony', 'harmonyos', 'HarmonyOS', 'HarmonyOS 5.0', harmonyHap, 'ManagerPortal-HarmonyOS-latest-unsigned.hap', 'HarmonyOS',
      '原生 HarmonyOS ArkUI 客户端。当前为未签名 HAP，真机安装前需配置对应发布证书与 Profile。']
  ];
  return candidates.flatMap(([id, platform, platformLabel, minSystem, fileName, latestFile, category, remarks]) => {
    const info = sizeSha(path.join(appsDir, fileName));
    if (!info) return [];
    return [{
      id,
      name: '铮铮控制台',
      platform,
      platformLabel,
      kind: 'package',
      version,
      build,
      minSystem,
      minimumSystem: minSystem,
      fileName,
      url: '',
      versionedUrl: '',
      downloadURL: '',
      tokenURL: `/api/admin/manager/apps/download-token?file=${encodeURIComponent(fileName)}`,
      pageURL: '/manager_portal/',
      size: info.size,
      sha256: info.sha256,
      updatedAt: now,
      category,
      icon: '/assets/icons/manager-portal-icon.png',
      notes: platform === 'ios' ? baseNotes.concat(['注意：未签名开发包，远程安装器会阻止真机安装。']) : baseNotes.slice(),
      remarks,
      title: `铮铮控制台 ${platformLabel} v${version}${platform === 'ios' ? '（未签名开发包）' : ''}`,
      versionName: version,
      latestVersion: version,
      versionCode: build,
      fileSize: info.size,
      checksum: info.sha256
    }];
  });
}

function stripPublicDownloads(file) {
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.apps = (Array.isArray(data.apps) ? data.apps : []).filter(app => !ids.has(String(app.id || '')));
  data.updatedAt = now;
  if ('generatedAt' in data) data.generatedAt = now;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`${path.basename(file)}: removed public ManagerPortal entries`);
}

const privateEntries = nativeEntries(path.join(root, 'website/api/apps'));
fs.writeFileSync(managerPortalAppsFile, JSON.stringify({
  updatedAt: now,
  private: true,
  scope: 'manager_portal',
  apps: privateEntries
}, null, 2) + '\n');
console.log(`apps.json: wrote ${privateEntries.length} private ManagerPortal entries`);

stripPublicDownloads(path.join(root, 'website/api/apps/manifest.json'));
stripPublicDownloads(path.join(root, 'website/api/apps/client-downloads.json'));
stripPublicDownloads(path.join(root, 'website/zhengzhengstudio.cn/api/apps/manifest.json'));
stripPublicDownloads(path.join(root, 'website/zhengzhengstudio.cn/api/apps/client-downloads.json'));
NODE
}

cleanup_private_manager_files
build_macos
build_ios || echo "[warn] iOS build failed/skipped (continuing)"
build_android
build_harmony || echo "[warn] HarmonyOS build failed/skipped (continuing)"
cleanup_public_manager_files
update_downloads

mkdir -p "$USER_DOWNLOADS"
for package in "$MAC_DMG" "$IOS_IPA" "$ANDROID_APK" "$HARMONY_HAP"; do
  if [ -f "$API_APPS/$package" ]; then
    cp "$API_APPS/$package" "$USER_DOWNLOADS/$package"
  fi
done

echo "ManagerPortal build complete."
