#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/zz_boardgames_harmony_online"
DEVECO_APP="${DEVECO_APP:-}"
MOUNTED_DEVECO_VOLUME=""
KEYCHAIN_ACCOUNT="${USER:-$(id -un)}"
KEYCHAIN_STORE_SERVICE="cn.zhengzhengstudio.boardgames.online.release.store"
KEYCHAIN_KEY_SERVICE="cn.zhengzhengstudio.boardgames.online.release.key"
LEGACY_KEYCHAIN_STORE_SERVICE="cn.zhengzhengstudio.survivaldiary.harmony.release.store"
LEGACY_KEYCHAIN_KEY_SERVICE="cn.zhengzhengstudio.survivaldiary.harmony.release.key"
is_deveco_usable() {
  [ -n "${1:-}" ] && [ -x "$1/Contents/tools/hvigor/bin/hvigorw" ]
}

mount_download_deveco() {
  KNOWN_DEVECO_DMG="$HOME/Downloads/devecostudio-mac-6.0.2.640/deveco-studio-6.0.2.640.dmg"
  if [ -f "$KNOWN_DEVECO_DMG" ]; then
    DEVECO_DMG="$KNOWN_DEVECO_DMG"
  else
    DEVECO_DMG="$(find "$HOME/Downloads" -maxdepth 3 \( -iname '*deveco*.dmg' -o -iname '*DevEco*.dmg' \) -print -quit || true)"
  fi
  if [ -n "$DEVECO_DMG" ] && [ -f "$DEVECO_DMG" ]; then
    echo "挂载下载目录 DevEco DMG：$DEVECO_DMG" >&2
    MOUNT_OUTPUT="$(hdiutil attach "$DEVECO_DMG" -nobrowse)"
    MOUNTED_DEVECO_VOLUME="$(printf '%s\n' "$MOUNT_OUTPUT" | awk '/\/Volumes\// {print substr($0, index($0, "/Volumes/")); exit}')"
    find "$MOUNTED_DEVECO_VOLUME" -maxdepth 3 -name 'DevEco-Studio.app' -type d -print | head -1 || true
  fi
}

if [ -z "$DEVECO_APP" ]; then
  if is_deveco_usable "/Applications/DevEco-Studio.app"; then
    DEVECO_APP="/Applications/DevEco-Studio.app"
  elif is_deveco_usable "/Volumes/DevEco-Studio/DevEco-Studio.app"; then
    DEVECO_APP="/Volumes/DevEco-Studio/DevEco-Studio.app"
  else
    DEVECO_APP="$(mount_download_deveco)"
  fi
fi
VERSION="$(sed -n 's/.*"versionName":[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
SIGNED_BUILD=0
CERT_DIR="$(cd "$PROJECT_DIR/../.." && pwd)/devecostudio证书"
APP_BUNDLE_NAME="$(sed -n 's/.*"bundleName":[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_DIR/AppScope/app.json5" | head -1)"
if [ -z "${HARMONY_SIGN_CERT_PATH:-}" ] && [ -f "$CERT_DIR/铮铮实验室发布证书.cer" ]; then
  HARMONY_SIGN_CERT_PATH="$CERT_DIR/铮铮实验室发布证书.cer"
fi
HARMONY_SIGN_CERT_PATH="${HARMONY_SIGN_CERT_PATH:-$CERT_DIR/AirCode-Debug.cer}"
HARMONY_SIGN_STORE_FILE="${HARMONY_SIGN_STORE_FILE:-$CERT_DIR/zhengzhengstudio-devecostudio.p12}"

read_keychain_secret() {
  security find-generic-password -s "$1" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true
}

prompt_hidden_secret() {
  osascript - "$1" "$2" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  set dialogResult to display dialog (item 2 of argv) with title (item 1 of argv) default answer "" with hidden answer buttons {"取消", "继续"} default button "继续" cancel button "取消"
  return text returned of dialogResult
end run
APPLESCRIPT
}

load_signing_secrets() {
  if [ -z "${HARMONY_SIGN_STORE_PASSWORD:-}" ]; then
    HARMONY_SIGN_STORE_PASSWORD="$(read_keychain_secret "$KEYCHAIN_STORE_SERVICE")"
    [ -n "$HARMONY_SIGN_STORE_PASSWORD" ] || HARMONY_SIGN_STORE_PASSWORD="$(read_keychain_secret "$LEGACY_KEYCHAIN_STORE_SERVICE")"
  fi
  if [ -z "${HARMONY_SIGN_KEY_PASSWORD:-}" ]; then
    HARMONY_SIGN_KEY_PASSWORD="$(read_keychain_secret "$KEYCHAIN_KEY_SERVICE")"
    [ -n "$HARMONY_SIGN_KEY_PASSWORD" ] || HARMONY_SIGN_KEY_PASSWORD="$(read_keychain_secret "$LEGACY_KEYCHAIN_KEY_SERVICE")"
  fi
  if [ -z "${HARMONY_SIGN_STORE_PASSWORD:-}" ] && command -v osascript >/dev/null 2>&1; then
    HARMONY_SIGN_STORE_PASSWORD="$(prompt_hidden_secret '铮铮桌游联网版发布签名' '请输入 HarmonyOS .p12 密钥库密码')"
  fi
  if [ -z "${HARMONY_SIGN_KEY_PASSWORD:-}" ] && command -v osascript >/dev/null 2>&1; then
    HARMONY_SIGN_KEY_PASSWORD="$(prompt_hidden_secret '铮铮桌游联网版发布签名' '请输入 HarmonyOS key 密码')"
  fi
  if [ -z "${HARMONY_SIGN_KEY_ALIAS:-}" ] && [ -n "${HARMONY_SIGN_STORE_PASSWORD:-}" ] && [ -f "$HARMONY_SIGN_STORE_FILE" ]; then
    HARMONY_SIGN_KEY_ALIAS="$(openssl pkcs12 -in "$HARMONY_SIGN_STORE_FILE" -passin "pass:$HARMONY_SIGN_STORE_PASSWORD" -info -nokeys -clcerts 2>&1 | sed -n 's/^[[:space:]]*friendlyName: //p' | head -1)"
  fi
  export HARMONY_SIGN_STORE_PASSWORD HARMONY_SIGN_KEY_PASSWORD HARMONY_SIGN_KEY_ALIAS
}

save_signing_secrets() {
  # 钥匙串写入只是“下次免输密码”的便利功能；沙箱/CI 环境下会被拒绝，
  # 绝不能因此中断已经签名成功的构建。
  security add-generic-password -U -s "$KEYCHAIN_STORE_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$HARMONY_SIGN_STORE_PASSWORD" >/dev/null 2>&1 || \
    echo "提示：未能把 p12 密码写入钥匙串（无钥匙串权限），下次构建仍需手动输入。" >&2
  security add-generic-password -U -s "$KEYCHAIN_KEY_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$HARMONY_SIGN_KEY_PASSWORD" >/dev/null 2>&1 || true
}

load_signing_secrets
if [ -z "${HARMONY_SIGN_PROFILE:-}" ]; then
  HARMONY_SIGN_PROFILE="$(find "$CERT_DIR" -maxdepth 1 -type f -iname '*.p7b' -print 2>/dev/null | while IFS= read -r profile; do
    if strings "$profile" | grep -q "\"bundle-name\":\"$APP_BUNDLE_NAME\""; then
      printf '%s\n' "$profile"
      break
    fi
  done)"
fi

if [ -n "$HARMONY_SIGN_PROFILE" ] && [ -f "$HARMONY_SIGN_PROFILE" ] && ! strings "$HARMONY_SIGN_PROFILE" | grep -q "\"bundle-name\":\"$APP_BUNDLE_NAME\""; then
  echo "签名 profile 与当前应用不匹配，已跳过：$(basename "$HARMONY_SIGN_PROFILE") 不属于 $APP_BUNDLE_NAME" >&2
  HARMONY_SIGN_PROFILE=""
fi

if [ -n "${HARMONY_SIGN_STORE_PASSWORD:-}" ] \
  && [ -n "${HARMONY_SIGN_KEY_PASSWORD:-}" ] \
  && [ -n "${HARMONY_SIGN_KEY_ALIAS:-}" ] \
  && [ -f "$HARMONY_SIGN_CERT_PATH" ] \
  && [ -f "$HARMONY_SIGN_STORE_FILE" ] \
  && [ -f "$HARMONY_SIGN_PROFILE" ]; then
  SIGNED_BUILD=1
fi
BUILD_MODE="$([ "$SIGNED_BUILD" -eq 1 ] && echo release || echo debug)"
HAP_NAME="ZhengZhengBoardGames-Online-HarmonyOS-v${VERSION:-test}-$([ "$SIGNED_BUILD" -eq 1 ] && echo signed || echo unsigned-test).hap"
APP_NAME="ZhengZhengBoardGames-Online-HarmonyOS-v${VERSION:-test}-$([ "$SIGNED_BUILD" -eq 1 ] && echo signed || echo unsigned-test).app"

validate_icon_assets() {
  local scope_icon="$PROJECT_DIR/AppScope/resources/base/media/app_icon.png"
  local entry_icon="$PROJECT_DIR/entry/src/main/resources/base/media/app_icon.png"
  local layered_icon="$PROJECT_DIR/AppScope/resources/base/media/layered_image.json"
  local scope_background="$PROJECT_DIR/AppScope/resources/base/media/background.png"
  local entry_background="$PROJECT_DIR/entry/src/main/resources/base/media/background.png"
  local scope_foreground="$PROJECT_DIR/AppScope/resources/base/media/foreground.png"
  local entry_foreground="$PROJECT_DIR/entry/src/main/resources/base/media/foreground.png"
  local start_icon="$PROJECT_DIR/entry/src/main/resources/base/media/startIcon.png"
  local app_config="$PROJECT_DIR/AppScope/app.json5"
  local module_config="$PROJECT_DIR/entry/src/main/module.json5"
  for icon in "$scope_icon" "$entry_icon" "$layered_icon" "$scope_background" "$entry_background" "$scope_foreground" "$entry_foreground" "$start_icon"; do
    if [ ! -s "$icon" ]; then
      echo "鸿蒙图标资源缺失或为空：$icon" >&2
      exit 1
    fi
  done
  # base 必须齐全（上面已逐个校验）。phone / tablet 与 base 用的是同一套图标，
  # 为压缩包体只保留 base 一份：鸿蒙资源限定目录缺文件时会自动回退 base/media，
  # 视觉完全一致，因此这里只提示、不阻断（三份 1024 图标 = 4MB 纯冗余）。
  for qualifier in phone tablet; do
    for root in "$PROJECT_DIR/AppScope/resources" "$PROJECT_DIR/entry/src/main/resources"; do
      for resource in app_icon.png background.png foreground.png startIcon.png; do
        if [ ! -s "$root/$qualifier/media/$resource" ]; then
          echo "提示：${qualifier} 未提供 ${resource} ，运行时回退 base（省包体）" >&2
        fi
      done
    done
  done
  if ! file "$scope_icon" | grep -q '1024 x 1024'; then
    echo "鸿蒙桌面图标必须是 1024 x 1024 PNG：$scope_icon" >&2
    exit 1
  fi
  if [ "$(od -An -tu1 -j25 -N1 "$scope_icon" | tr -d ' ')" != "2" ] \
    || [ "$(od -An -tu1 -j25 -N1 "$scope_background" | tr -d ' ')" != "2" ]; then
    echo "鸿蒙桌面图标与分层背景必须是不带透明通道的 RGB PNG。" >&2
    exit 1
  fi
  if ! grep -q '"bundleName"[[:space:]]*:[[:space:]]*"cn.zhengzhengstudio.boardgames.hmos"' "$app_config"; then
    echo "联网版必须使用包名 cn.zhengzhengstudio.boardgames.hmos。" >&2
    exit 1
  fi
  if ! grep -q '"icon"[[:space:]]*:[[:space:]]*"\$media:layered_image"' "$app_config" \
    || ! grep -q '"icon"[[:space:]]*:[[:space:]]*"\$media:layered_image"' "$module_config"; then
    echo "鸿蒙桌面入口必须引用 layered_image 分层图标。" >&2
    exit 1
  fi
  if ! cmp -s "$scope_background" "$entry_background" || ! cmp -s "$scope_foreground" "$entry_foreground"; then
    echo "AppScope 与 EntryAbility 的分层图标资源不一致。" >&2
    exit 1
  fi
  if ! file "$start_icon" | grep -q '1024 x 1024.*RGB'; then
    echo "鸿蒙启动图标必须是 1024 x 1024 不透明 RGB PNG：$start_icon" >&2
    exit 1
  fi
  grep -q '"ohos.want.action.home"' "$module_config" && grep -q '"action.system.home"' "$module_config" || {
    echo "鸿蒙桌面入口必须同时兼容新旧 HOME action。" >&2
    exit 1
  }
}

create_hvigor_signing_config() {
  # DevEco 6 only accepts IDE-encrypted passwords in build-profile.json5.
  # Keep secrets out of the project; the SDK signs the release HAP after packing.
  return 0
}

verify_hap() {
  local hap="$1" verify_dir output
  verify_dir="$(mktemp -d /tmp/zz-online-hap-verify.XXXXXX)"
  output="$(java -jar "$SIGN_TOOL" verify-app -inFile "$hap" -outCertChain "$verify_dir/cert.cer" -outProfile "$verify_dir/profile.p7b" 2>&1)"
  rm -rf "$verify_dir"
  if ! printf '%s\n' "$output" | grep -qi 'verify-app success'; then
    printf '%s\n' "$output" >&2
    echo "发布签名校验失败：$hap" >&2
    exit 1
  fi
}

verify_app_signature() {
  # AGC 上传报「非法软件包 991」的真正原因：只对内部 HAP 签名、再用 zip 手工重打包，
  # .app 自身没有 Signing Block，AGC 找不到签名就判 991。
  # 因此必须用 verify-app 直接校验 .app 整体签名，而不是仅校验解出来的 HAP。
  local app_pack="$1" verify_dir output
  verify_dir="$(mktemp -d /tmp/zz-online-app-verify.XXXXXX)"
  output="$(java -jar "$SIGN_TOOL" verify-app -inFile "$app_pack" -outCertChain "$verify_dir/cert.cer" -outProfile "$verify_dir/profile.p7b" 2>&1)"
  rm -rf "$verify_dir"
  if ! printf '%s\n' "$output" | grep -qi 'verify-app success'; then
    printf '%s\n' "$output" >&2
    echo "APP Pack 整体签名校验失败（AGC 会判 991）：$app_pack" >&2
    exit 1
  fi
}

verify_app_pack() {
  local app_pack="$1"
  verify_app_signature "$app_pack"
  # 带 Signing Block 的 .app 用 ditto 解不开（报 Not a central directory signature），
  # 结构校验改用 python zipfile：必须恰好一个 hap + pac.json + pack.info。
  # 官方形态下内部 hap 不单独签名，校验 .app 整体签名即可。
  if ! python3 - "$app_pack" <<'PY'
import sys, zipfile
names = zipfile.ZipFile(sys.argv[1]).namelist()
hap_count = len([n for n in names if n.endswith('.hap')])
assert hap_count == 1, 'APP Pack 必须只包含一个 HAP: %s' % names
assert 'pac.json' in names and 'pack.info' in names, '缺少 pac.json / pack.info: %s' % names
PY
  then
    echo "APP Pack 结构校验失败：$app_pack" >&2
    exit 1
  fi
}

sign_app_pack() {
  # 直接对 hvigor 产出的未签名 APP Pack 签名：让 SDK 在 .app 上写入 Signing Block，
  # 绝不能再拆包手工重打包。
  local source_app="$1" target_app="$2"
  rm -f "$target_app"
  java -jar "$SIGN_TOOL" sign-app \
    -mode localSign \
    -keyAlias "$HARMONY_SIGN_KEY_ALIAS" \
    -keyPwd "$HARMONY_SIGN_KEY_PASSWORD" \
    -appCertFile "$HARMONY_SIGN_CERT_PATH" \
    -profileFile "$HARMONY_SIGN_PROFILE" \
    -profileSigned 1 \
    -inFile "$source_app" \
    -signAlg SHA256withECDSA \
    -keystoreFile "$HARMONY_SIGN_STORE_FILE" \
    -keystorePwd "$HARMONY_SIGN_STORE_PASSWORD" \
    -outFile "$target_app" \
    -compatibleVersion 22 \
    -signCode 1
}

restore_icons_from_cache() {
  # iCloud 会把桌面图标（app_icon / startIcon / foreground / background）回滚成云端旧版本，
  # 导致 AppScope 与 entry 的分层图标不一致而构建失败。图标一并纳入本地缓存兜底：
  # 缓存命中且内容不一致时强制恢复，恢复不了就直接报错终止（绝不能打出旧图标包）。
  [ -d "$MEDIA_CACHE_DIR/_icons" ] || return 0
  local rel_dirs=(
    "AppScope/resources/base/media"
    "AppScope/resources/phone/media"
    "AppScope/resources/tablet/media"
    "entry/src/main/resources/base/media"
    "entry/src/main/resources/phone/media"
    "entry/src/main/resources/tablet/media"
  )
  local name file target restored=0
  for name in app_icon.png startIcon.png foreground.png background.png; do
    file="$MEDIA_CACHE_DIR/_icons/$name"
    [ -f "$file" ] || continue
    for rel in "${rel_dirs[@]}"; do
      target="$PROJECT_DIR/$rel/$name"
      [ -f "$target" ] || continue
      if ! cmp -s "$file" "$target"; then
        cp -X -f "$file" "$target" 2>/dev/null || true
        restored=$((restored + 1))
        sleep 1
        if ! cmp -s "$file" "$target"; then
          cp -X -f "$file" "$target" 2>/dev/null || true
          sleep 1
        fi
      fi
      if ! cmp -s "$file" "$target"; then
        echo "错误：$rel/$name 与图标缓存不一致（iCloud 回滚），已重试仍失败。" >&2
        exit 1
      fi
    done
  done
  [ "$restored" -gt 0 ] && echo "已从图标缓存恢复 $restored 处被 iCloud 回滚的图标。" >&2
  return 0
}

MEDIA_CACHE_DIR="${ZZ_MEDIA_CACHE_DIR:-$HOME/Library/Caches/zhengzheng-boardgames-media/$(basename "$PROJECT_DIR")}"

restore_media_from_cache() {
  # iCloud 会因为磁盘紧张反复驱逐棋盘资源（本地只剩 0 字节空壳 + .xxx.icloud 占位），
  # brctl download 拉回来后过一阵又被驱逐，构建每隔几天就会失败一次。
  # 这里维护一份脱离 iCloud 的本地缓存（~/Library/Caches，不会被驱逐），
  # 每次构建前先把缺失或被驱逐的资源从缓存补回，并清掉 iCloud 冲突副本（"xxx 2.png"）。
  [ -d "$MEDIA_CACHE_DIR" ] || return 0
  local dir="$PROJECT_DIR/entry/src/main/resources/base/media"
  [ -d "$dir" ] || return 0

  local restored=0 file target conflict base backup
  for file in "$MEDIA_CACHE_DIR"/*; do
    [ -f "$file" ] || continue
    target="$dir/$(basename "$file")"
    # iCloud 云端副本可能是更早的版本：补回来后立刻比对，不对再补一次，避免落地竞争
    if [ ! -s "$target" ] || ! cmp -s "$file" "$target"; then
      cp -X -f "$file" "$target" 2>/dev/null || true
      restored=$((restored + 1))
      sleep 1
      if ! cmp -s "$file" "$target"; then
        cp -X -f "$file" "$target" 2>/dev/null || true
        sleep 1
      fi
    fi
    if ! cmp -s "$file" "$target"; then
      echo "警告：${target##*/} 未能与本地资源缓存一致，可能仍是 iCloud 旧版本。" >&2
    fi
  done

  # 资源名里有空格鸿蒙会报 Invalid resource name；这些 "xxx 2.png" 是 iCloud 冲突副本，
  # 缓存里已有同名正主，挪到备份目录而不是直接删除
  local found=0
  while IFS= read -r conflict; do
    [ -n "$conflict" ] || continue
    base="$(basename "$conflict")"
    base="${base/ 2./.}"
    if [ -f "$MEDIA_CACHE_DIR/$base" ]; then
      backup="$HOME/Library/Caches/zhengzheng-boardgames-media/_icloud-dup-backup/$(date '+%Y%m%d-%H%M%S')"
      mkdir -p "$backup" 2>/dev/null || true
      mv "$conflict" "$backup/" 2>/dev/null || true
      found=$((found + 1))
    fi
  done < <(find "$dir" -maxdepth 1 -type f -name '* 2.*' -print 2>/dev/null)

  # 占位符会让预检反复等待，资源已经从缓存补回，占位符留着只是噪音
  find "$dir" -maxdepth 1 -type f -name '.*.icloud' -delete 2>/dev/null || true

  if [ "$restored" -gt 0 ] || [ "$found" -gt 0 ]; then
    echo "已从本地资源缓存恢复 $restored 个被 iCloud 驱逐的资源，清理 $found 个带空格的冲突副本。" >&2
  fi
}

ensure_icloud_assets() {
  # 工程位于 iCloud 桌面同步目录，资源可能只剩云端副本：本地同名文件是 0 字节空壳，
  # 旁边留着 ".xxx.icloud" 占位符；rsync 会把空壳原样拷进构建目录，
  # hvigor 随后以资源缺失或 "Invalid resource name" 失败。
  local roots=()
  [ -d "$PROJECT_DIR/AppScope/resources" ] && roots+=("$PROJECT_DIR/AppScope/resources")
  [ -d "$PROJECT_DIR/entry/src/main/resources" ] && roots+=("$PROJECT_DIR/entry/src/main/resources")
  [ "${#roots[@]}" -eq 0 ] && return 0

  local stubs target_list=() dir base name target
  stubs="$(find "${roots[@]}" -type f -name '.*.icloud' -print 2>/dev/null)"
  while IFS= read -r stub; do
    [ -n "$stub" ] || continue
    dir="$(dirname "$stub")"
    base="$(basename "$stub")"
    name="${base#.}"
    name="${name%.icloud}"
    target_list+=("$dir/$name")
  done <<<"$stubs"

  if [ "${#target_list[@]}" -gt 0 ]; then
    echo "发现 ${#target_list[@]} 个资源仍在 iCloud 云端，正在拉取到本地…" >&2
    # brctl 在沙箱/CI 下可能被拒绝，失败不中断，后面还有读取兜底
    command -v brctl >/dev/null 2>&1 && brctl download "${target_list[@]}" >/dev/null 2>&1 || true
  fi

  # 兜底：直接读取也能触发 iCloud 落地，且不依赖 brctl 权限
  find "${roots[@]}" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \
    -o -name '*.webp' -o -name '*.json' -o -name '*.svg' -o -name '*.mp3' \) \
    -exec head -c 1 {} + >/dev/null 2>&1 || true

  # 源码没引用的资源（历史遗留孤儿）不值得干等，直接跳过等待
  local referenced=()
  if [ "${#target_list[@]}" -gt 0 ]; then
    for target in "${target_list[@]}"; do
      if grep -raq "$(basename "${target%.*}")" "$PROJECT_DIR/entry/src/main/ets" 2>/dev/null; then
        referenced+=("$target")
      else
        echo "提示：${target##*/} 未被任何源码引用（遗留资源），跳过等待。" >&2
      fi
    done
  fi
  target_list=("${referenced[@]+"${referenced[@]}"}")

  local waited=0 pending=0 remain=0
  if [ "${#target_list[@]}" -gt 0 ]; then
    pending=1
    while [ "$waited" -lt 120 ] && [ "$pending" -gt 0 ]; do
      sleep 2
      waited=$((waited + 2))
      pending=0
      for target in "${target_list[@]}"; do
        [ -s "$target" ] || pending=$((pending + 1))
      done
    done
    if [ "$pending" -eq 0 ]; then
      echo "已把 ${#target_list[@]} 个 iCloud 资源下载到本地。" >&2
    else
      for target in "${target_list[@]}"; do
        if [ ! -s "$target" ]; then
          echo "警告：仍未下载到本地，构建可能因资源缺失失败：$target" >&2
          remain=$((remain + 1))
        fi
      done
      echo "$remain 个资源还在 iCloud 云端（离线或 brctl 被拦截），继续尝试构建。" >&2
    fi
  fi

  # 鸿蒙资源名不能含空格，iCloud 冲突副本（xxx 2.png）会让 CompileResource 直接失败
  local illegal
  illegal="$(find "${roots[@]}" -type f -name '* *' -print 2>/dev/null)"
  if [ -n "$illegal" ]; then
    printf '%s\n' "$illegal" >&2
    echo "以上资源文件名含空格，鸿蒙会报 Invalid resource name，请重命名后再构建。" >&2
    exit 1
  fi
}

disable_hvigor_file_log() {
  # hvigor 的 log4js 会把每条日志同步落盘到 .hvigor/outputs/build-logs/build.log。
  # 在受限执行环境里每次写盘都要走 IPC 代理并超时重试，实测会把 20 分钟的构建拖到
  # 50 分钟以上，甚至让 CompileArkTS worker 永久空转（CPU 0~1%）卡死。
  # 把该文件指向 /dev/null 后日志仍走 stdout，构建行为不变但不再被 IO 拖累。
  mkdir -p "$BUILD_DIR/.hvigor/outputs/build-logs"
  if [ ! -e "$BUILD_DIR/.hvigor/outputs/build-logs/build.log" ]; then
    ln -s /dev/null "$BUILD_DIR/.hvigor/outputs/build-logs/build.log" 2>/dev/null || true
  fi
}

if ! is_deveco_usable "$DEVECO_APP"; then
  echo "未找到可用的 DevEco Studio hvigorw，请设置 DEVECO_APP 指向 DevEco-Studio.app：$DEVECO_APP" >&2
  exit 1
fi
restore_media_from_cache
restore_icons_from_cache
ensure_icloud_assets
validate_icon_assets

cleanup() {
  if [ -n "$MOUNTED_DEVECO_VOLUME" ] && [ -d "$MOUNTED_DEVECO_VOLUME" ]; then
    hdiutil detach "$MOUNTED_DEVECO_VOLUME" -quiet || true
  fi
}
trap cleanup EXIT

export DEVECO_SDK_HOME="$DEVECO_APP/Contents/sdk"
export NODE_HOME="$DEVECO_APP/Contents/tools/node"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$PATH"

# 默认保留 $BUILD_DIR 里的 .hvigor 缓存做增量构建；需要彻底干净重建时设 FULL_CLEAN=1
if [ "${FULL_CLEAN:-0}" = "1" ]; then
  rm -rf "$BUILD_DIR/.hvigor" "$BUILD_DIR/entry/build" "$BUILD_DIR/build" 2>/dev/null || true
fi
disable_hvigor_file_log
mkdir -p "$BUILD_DIR"
rsync -a \
  --exclude '.idea' \
  --exclude '.hvigor' \
  --exclude 'build' \
  --exclude 'entry/build' \
  --exclude 'entry/.preview' \
  "$PROJECT_DIR/" "$BUILD_DIR/"
rm -f "$BUILD_DIR/entry/build/default/outputs/default/entry-default-unsigned.hap"
rm -f "$BUILD_DIR/entry/build/default/outputs/default/entry-default-signed.hap"
# 资源目录必须镜像同步：源码里删掉的资源（比如被 PNG 图标替换的 game_*.svg）
# 若残留在增量构建副本里，restool 会报 "Resource 'xxx' conflict"。
for resource_dir in "entry/src/main/resources" "AppScope/resources"; do
  if [ -d "$PROJECT_DIR/$resource_dir" ] && [ -d "$BUILD_DIR/$resource_dir" ]; then
    rsync -a --delete "$PROJECT_DIR/$resource_dir/" "$BUILD_DIR/$resource_dir/"
  fi
done
if [ "$SIGNED_BUILD" -eq 1 ]; then
  create_hvigor_signing_config
  echo "已找到 HarmonyOS 发布签名材料；构建后将签名 HAP 并写回 APP Pack。" >&2
else
  echo "未启用 HarmonyOS 签名；需要 p7b、p12 密码和 key alias 才能生成可安装 HAP。" >&2
fi
(
  cd "$BUILD_DIR"
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleHap \
      --mode module \
      -p product=default \
      -p module=entry@default \
      -p buildMode="$BUILD_MODE" \
      --no-daemon
  "$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw" assembleApp \
      --mode project \
      -p product=default \
      -p buildMode="$BUILD_MODE" \
      --no-daemon
)

OUTPUT="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*.hap' -print | sort | tail -1)"
if [ ! -f "$OUTPUT" ]; then
  echo "构建完成，但未找到 HAP：$OUTPUT" >&2
  exit 1
fi
# 必须拿 hvigor 刚产出的未签名 APP Pack；BUILD_DIR 根目录下可能残留上一轮的
# *-signed.app，用 sort|tail 会误选已签名包，导致二次签名失败或产物不对。
APP_OUTPUT="$(find "$BUILD_DIR/build/outputs/default" -maxdepth 1 -type f -name '*-unsigned.app' -print | sort | tail -1)"
if [ ! -f "$APP_OUTPUT" ]; then
  APP_OUTPUT="$(find "$BUILD_DIR" -type f -name '*.app' -print | sort | tail -1)"
fi
if [ ! -f "$APP_OUTPUT" ]; then
  echo "构建完成，但未找到 APP Pack：$APP_OUTPUT" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/entry/build/default/outputs/default"
FINAL_OUTPUT="$OUTPUT"
FINAL_APP_OUTPUT="$APP_OUTPUT"
if [ "$SIGNED_BUILD" -eq 1 ]; then
  SIGN_TOOL="$DEVECO_APP/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"
  if [ ! -f "$SIGN_TOOL" ]; then
    echo "未找到 HarmonyOS HAP 签名工具：$SIGN_TOOL" >&2
    exit 1
  fi
  FINAL_OUTPUT="$BUILD_DIR/entry/build/default/outputs/default/entry-default-signed-by-sdk.hap"
  rm -f "$FINAL_OUTPUT"
  java -jar "$SIGN_TOOL" sign-app \
    -mode localSign \
    -keyAlias "$HARMONY_SIGN_KEY_ALIAS" \
    -keyPwd "$HARMONY_SIGN_KEY_PASSWORD" \
    -appCertFile "$HARMONY_SIGN_CERT_PATH" \
    -profileFile "$HARMONY_SIGN_PROFILE" \
    -profileSigned 1 \
    -inFile "$OUTPUT" \
    -signAlg SHA256withECDSA \
    -keystoreFile "$HARMONY_SIGN_STORE_FILE" \
    -keystorePwd "$HARMONY_SIGN_STORE_PASSWORD" \
    -outFile "$FINAL_OUTPUT" \
    -compatibleVersion 22 \
    -signCode 1
  FINAL_APP_OUTPUT="$BUILD_DIR/ZhengZhengBoardGames-Online-signed.app"
  sign_app_pack "$APP_OUTPUT" "$FINAL_APP_OUTPUT"
  verify_hap "$FINAL_OUTPUT"
  verify_app_pack "$FINAL_APP_OUTPUT"
  save_signing_secrets
fi

ditto "$FINAL_OUTPUT" "$PROJECT_DIR/entry/build/default/outputs/default/$HAP_NAME"
# 沙箱/无权限环境可能拦 Downloads 写入；产物已在项目目录，绝不能因此判构建失败
ditto "$FINAL_OUTPUT" "$HOME/Downloads/$HAP_NAME" 2>/dev/null || echo "提示：未能复制到 ~/Downloads（沙箱限制），产物在项目 outputs 目录。" >&2
ditto "$FINAL_APP_OUTPUT" "$PROJECT_DIR/entry/build/default/outputs/default/$APP_NAME"
ditto "$FINAL_APP_OUTPUT" "$HOME/Downloads/$APP_NAME" 2>/dev/null || true

if [ "$SIGNED_BUILD" -eq 1 ]; then
  echo "已构建签名发布 HAP：$HOME/Downloads/$HAP_NAME"
  echo "已构建签名发布 APP Pack：$HOME/Downloads/$APP_NAME"
else
  echo "已构建未签名开发包：$HOME/Downloads/$HAP_NAME"
  echo "此文件不能直接真机安装；配置并保持同一 HarmonyOS 签名后，才可覆盖升级。"
fi
