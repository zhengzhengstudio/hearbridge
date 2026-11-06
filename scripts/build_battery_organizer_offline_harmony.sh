#!/usr/bin/env bash
# 电池收纳器单机版 HarmonyOS 发布构建。
#
# 流程：把源码 rsync 到临时构建目录 -> 注入 release 签名配置 -> hvigor 同时产出
#       已签名的 .hap 与 .app（app 内的 hap 与独立 hap 逐字节一致）。
#
# ⚠️ 为什么不用「先 unsigned 再后置签名」：
#    hap-sign-tool sign-app 作用于 .app 时只会签容器本体，内部的 entry-default.hap
#    仍然是未签名的；而 app_packing_tool 重打 app 时会把 hap 的签名块剥掉。两者都无法
#    产出「内含已签名 hap」的 app，应用市场上传会失败。历史发布版（1.0.13）的内部 hap
#    与独立 hap 的 sha256 完全一致，说明官方正确流程就是由 hvigor 统一签名。
#
# 环境变量：
#   OFFLINE_BUILD_DIR  构建目录，默认 /tmp/battery_organizer_offline_harmony_build
#   OFFLINE_OUT_DIR    产物目录，默认 $HOME/Downloads
#   BUILD_MODE         signed（默认）| unsigned | both
#   DEVECO_APP         DevEco 安装路径
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/HarmonyOS-App/BatteryOrganizerHarmonyOffline"
BUILD_DIR="${OFFLINE_BUILD_DIR:-/tmp/battery_organizer_offline_harmony_build}"
OUT_DIR="${OFFLINE_OUT_DIR:-$HOME/Downloads}"
DEVECO_APP="${DEVECO_APP:-/Applications/DevEco-Studio.app}"
SDK_HOME="${DEVECO_SDK_HOME:-$DEVECO_APP/Contents/sdk}"
HVIGOR="$DEVECO_APP/Contents/tools/hvigor/bin/hvigorw"
BUILD_MODE="${BUILD_MODE:-signed}"
MATERIAL_DIR="${HARMONY_MATERIAL_DIR:-$ROOT_DIR/website/api/data/harmony-signing/cn.zhengzhengstudio.batteryorganizeronedevice.hmos}"
BUNDLE_NAME="cn.zhengzhengstudio.batteryorganizeronedevice.hmos"
JAVA="$DEVECO_APP/Contents/jbr/Contents/Home/bin/java"
SIGN_TOOL_JAR="$SDK_HOME/default/openharmony/toolchains/lib/hap-sign-tool.jar"

if [ ! -x "$HVIGOR" ]; then
  echo "找不到 DevEco hvigorw: $HVIGOR" >&2
  exit 1
fi
if [ "$BUILD_MODE" != "unsigned" ] && { [ ! -f "$MATERIAL_DIR/keystore.p12" ] || [ ! -f "$MATERIAL_DIR/signing.env" ]; }; then
  echo "缺少签名材料: $MATERIAL_DIR" >&2
  exit 2
fi

APP_JSON="$PROJECT_DIR/AppScope/app.json5"
VERSION_NAME="$(sed -n 's/.*"versionName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_JSON" | head -1)"
VERSION_CODE="$(sed -n 's/.*"versionCode"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$APP_JSON" | head -1)"
VERSION_NAME="${VERSION_NAME:-dev}"
echo "构建 $BUNDLE_NAME v$VERSION_NAME ($VERSION_CODE) mode=$BUILD_MODE"

STEM="BatteryOrganizer-Offline-HarmonyOS-v${VERSION_NAME}"
UNSIGNED_HAP="$OUT_DIR/${STEM}-unsigned.hap"
SIGNED_HAP="$OUT_DIR/${STEM}-signed.hap"
UNSIGNED_APP="$OUT_DIR/${STEM}-unsigned.app"
SIGNED_APP="$OUT_DIR/${STEM}-signed.app"

mkdir -p "$BUILD_DIR" "$OUT_DIR"
# 增量同步并保留 .hvigor 缓存，避免每次都做全量编译。
rsync -a --delete \
  --exclude '.idea' \
  --exclude '.hvigor' \
  --exclude 'build' \
  --exclude 'entry/build' \
  --exclude 'entry/.preview' \
  --exclude 'node_modules' \
  --exclude 'release' \
  "$PROJECT_DIR/" "$BUILD_DIR/"

if [ "$BUILD_MODE" != "unsigned" ]; then
  # 把签名材料放进构建副本（源码仓库保持干净），再注入 release signingConfig。
  # 说明：hvigor 用这套配置把 hap 签好；app 容器则由后面的 repack + sign_hap.sh 处理。
  mkdir -p "$BUILD_DIR/release"
  # shellcheck disable=SC1090
  source "$MATERIAL_DIR/signing.env"
  # hvigor 不接受明文密码：它要求 storePassword/keyPassword 是 hex 串（长度 >=32 且为偶数），
  # 并用 <p12 所在目录>/material 派生的密钥解密。DevEco 的「自动签名」才会生成这套 material，
  # 本机没有，所以按 hvigor 的算法自洽生成一份（见 scripts/harmony_make_signing_material.mjs）。
  # 生成结果缓存起来复用，避免每次都改 build-profile.json5 导致全量重编译。
  NODE_BIN="$DEVECO_APP/Contents/tools/node/bin/node"
  [ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
  [ -n "$NODE_BIN" ] || { echo "找不到 node。" >&2; exit 3; }
  PWD_CACHE="$BUILD_DIR/release/.signing-pwd.json"
  if [ ! -f "$PWD_CACHE" ]; then
    "$NODE_BIN" "$ROOT_DIR/scripts/harmony_make_signing_material.mjs" \
      "$BUILD_DIR/release" "$KEYSTORE_PWD" "${KEY_PWD:-$KEYSTORE_PWD}" > "$PWD_CACHE" 2>/dev/null \
      || { echo "生成 hvigor 签名材料失败。" >&2; exit 3; }
  fi
  ENC_STORE_PWD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["storePassword"])' "$PWD_CACHE")"
  ENC_KEY_PWD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["keyPassword"])' "$PWD_CACHE")"
  cp -f "$MATERIAL_DIR/keystore.p12" "$BUILD_DIR/release/battery-organizer-release.p12"
  cp -f "$MATERIAL_DIR"/*.cer "$BUILD_DIR/release/battery-organizer-release.cer"
  cp -f "$MATERIAL_DIR"/*.p7b "$BUILD_DIR/release/battery-organizer-release.p7b"

  # 前置自检：用 hvigor 自己的解密实现验证一遍，失败就在几秒内退出，不用等完整编译。
  DEVECO_APP="$DEVECO_APP" "$NODE_BIN" "$ROOT_DIR/scripts/harmony_verify_signing_material.cjs" \
    "$BUILD_DIR/release" "$ENC_STORE_PWD" "$KEYSTORE_PWD" || exit 3

  NEW_CONFIGS='[
      {
        "name": "release",
        "type": "HarmonyOS",
        "material": {
          "certpath": "release/battery-organizer-release.cer",
          "storePassword": "'"$ENC_STORE_PWD"'",
          "keyAlias": "'"$KEY_ALIAS"'",
          "keyPassword": "'"$ENC_KEY_PWD"'",
          "profile": "release/battery-organizer-release.p7b",
          "signAlg": "'"${SIGN_ALG:-SHA256withECDSA}"'",
          "storeFile": "release/battery-organizer-release.p12"
        }
      }
    ]'
  CONFIG_ESCAPED="$(printf '%s' "$NEW_CONFIGS" | python3 -c 'import sys; print(sys.stdin.read().replace("\\", "\\\\").replace("&", "\\&"))')"
  python3 - "$BUILD_DIR/build-profile.json5" "$CONFIG_ESCAPED" <<'PY'
import re, sys
path, configs = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
text = re.sub(r'"signingConfigs"\s*:\s*\[[^\]]*\]', f'"signingConfigs": {configs}', text, count=1)
text = re.sub(r'"signingConfig"\s*:\s*"[^"]*"', '"signingConfig": "release"', text, count=1)
open(path, 'w', encoding='utf-8').write(text)
PY
  # build-profile.json5 带尾逗号，不能用 json.load 校验，改为确认关键字段已注入。
  INJECTED="$(python3 - "$BUILD_DIR/build-profile.json5" <<'PY'
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
ok = bool(re.search(r'"signingConfig"\s*:\s*"release"', text)) and bool(re.search(r'"name"\s*:\s*"release"', text))
print('ok' if ok else 'missing')
PY
)"
  [ "$INJECTED" = "ok" ] || { echo "build-profile.json5 注入失败，未找到 release 签名配置。" >&2; exit 3; }
  echo "已注入 release 签名配置。"
fi

export DEVECO_SDK_HOME="$SDK_HOME"
export PATH="$DEVECO_APP/Contents/tools/node/bin:$DEVECO_APP/Contents/tools/ohpm/bin:$DEVECO_APP/Contents/tools/hvigor/bin:$DEVECO_APP/Contents/jbr/Contents/Home/bin:$PATH"

run_assemble() {
  ( cd "$BUILD_DIR" && "$@" )
}

BUILD_MODE_FLAG="debug"
[ "$BUILD_MODE" = "unsigned" ] || BUILD_MODE_FLAG="release"

(
  cd "$BUILD_DIR"
  "$HVIGOR" --stop-daemon >/dev/null 2>&1 || true
  "$HVIGOR" assembleHap --mode module -p module=entry@default -p product=default -p buildMode="$BUILD_MODE_FLAG" --no-daemon
  "$HVIGOR" assembleApp --mode project -p product=default -p buildMode="$BUILD_MODE_FLAG" --no-daemon
)

# 注意排序：默认 sort 会把 *-unsigned.* 排在 *-signed.* 之后，必须显式挑 signed 产物。
HAP_SOURCE="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*-signed.hap' -print | sort | tail -1)"
if [ -z "$HAP_SOURCE" ]; then
  HAP_SOURCE="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*.hap' ! -name '*-unsigned.hap' -print | sort | tail -1)"
fi
# 容器模板取 hvigor 产出的未签名 app，只为拿 pac.json / pack.info。
APP_TEMPLATE="$(find "$BUILD_DIR/build/outputs/default" -maxdepth 1 -type f -name '*-unsigned.app' -print | sort | tail -1)"
if [ -z "$APP_TEMPLATE" ]; then
  APP_TEMPLATE="$(find "$BUILD_DIR/build/outputs/default" -maxdepth 1 -type f -name '*.app' -print | sort | tail -1)"
fi
[ -n "$HAP_SOURCE" ] && [ -f "$HAP_SOURCE" ] || { echo "未找到已签名 HAP 产物。" >&2; exit 4; }
[ -n "$APP_TEMPLATE" ] && [ -f "$APP_TEMPLATE" ] || { echo "未找到 APP 产物。" >&2; exit 5; }

if [ "$BUILD_MODE" = "unsigned" ]; then
  HAP_UNSIGNED="$(find "$BUILD_DIR/entry/build/default/outputs/default" -maxdepth 1 -type f -name '*-unsigned.hap' -print | sort | tail -1)"
  cp -f "${HAP_UNSIGNED:-$HAP_SOURCE}" "$UNSIGNED_HAP"
  cp -f "$APP_TEMPLATE" "$UNSIGNED_APP"
  echo "hap=$UNSIGNED_HAP"
  echo "app=$UNSIGNED_APP"
  exit 0
fi

cp -f "$HAP_SOURCE" "$SIGNED_HAP"

# hvigor 的 assembleApp 会把**未签名**的 hap 塞进 app 再只签容器，这种包装不上设备。
# 所以这里自己重建容器：把已签名的 hap 原样（ZIP_STORED + 4096 对齐）放进去，再给容器补签名。
TMP_APP="$(mktemp "${TMPDIR:-/tmp}/bo-app.XXXXXX.app")"
python3 "$ROOT_DIR/scripts/harmony_repack_app.py" \
  --template "$APP_TEMPLATE" --hap "$SIGNED_HAP" --out "$TMP_APP" || { rm -f "$TMP_APP"; exit 6; }
bash "$ROOT_DIR/website/api/tools/harmony_signing/sign_hap.sh" \
  "$TMP_APP" "$BUNDLE_NAME" "$SIGNED_APP" >/dev/null || { rm -f "$TMP_APP"; exit 6; }
rm -f "$TMP_APP"

verify_signed() {
  local target="$1" cert profile
  cert="$(mktemp "${TMPDIR:-/tmp}/bo-chain.XXXXXX.cer")"
  profile="$(mktemp "${TMPDIR:-/tmp}/bo-profile.XXXXXX.p7b")"
  if "$JAVA" -jar "$SIGN_TOOL_JAR" verify-app -inFile "$target" -outCertChain "$cert" -outProfile "$profile" >/dev/null 2>&1; then
    echo "✅ 签名校验通过: $(basename "$target")"
  else
    echo "❌ 签名校验失败: $(basename "$target")" >&2
    rm -f "$cert" "$profile"
    return 1
  fi
  rm -f "$cert" "$profile"
}

verify_signed "$SIGNED_HAP"
verify_signed "$SIGNED_APP"

# 关键自检：app 内部嵌入的 hap 必须与独立发布的 hap 逐字节一致（否则应用市场安装会失败）。
TMP_CHECK="$(mktemp -d "${TMPDIR:-/tmp}/bo-appcheck.XXXXXX")"
unzip -o -q "$SIGNED_APP" -d "$TMP_CHECK"
INNER="$TMP_CHECK/entry-default.hap"
if [ -f "$INNER" ]; then
  INNER_SHA="$(shasum -a 256 "$INNER" | awk '{print $1}')"
  HAP_SHA="$(shasum -a 256 "$SIGNED_HAP" | awk '{print $1}')"
  if [ "$INNER_SHA" = "$HAP_SHA" ]; then
    echo "✅ app 内嵌 hap 与独立 hap 一致 ($HAP_SHA)"
  else
    echo "❌ app 内嵌 hap 与独立 hap 不一致！app=$INNER_SHA hap=$HAP_SHA" >&2
    rm -rf "$TMP_CHECK"
    exit 6
  fi
else
  echo "❌ app 内没有找到 entry-default.hap" >&2
  rm -rf "$TMP_CHECK"
  exit 7
fi
rm -rf "$TMP_CHECK"

ls -la "$SIGNED_HAP" "$SIGNED_APP"
echo "hap=$SIGNED_HAP"
echo "app=$SIGNED_APP"
