#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_PROJECT="$ROOT_DIR/apps/LifeDiary-Android"
KEYSTORE="$ROOT_DIR/Android证书/SurvivalDiary-Android-Release.p12"
PUBLISH_DIR="$ROOT_DIR/website/api/apps"
KEYCHAIN_SERVICE="cn.zhengzhengstudio.survivaldiary.release"
KEYCHAIN_ACCOUNT="${USER:?USER is required to address the signing Keychain entry}"
EXPECTED_PACKAGE="cn.zhengzhengstudio.survivaldiary"
EXPECTED_LABEL="生存日记"
EXPECTED_VERSION_CODE="2"
EXPECTED_VERSION_NAME="0.2.0"
EXPECTED_CERT_SHA256="2A:2A:C1:58:09:43:81:2F:D8:0D:38:F7:F1:9A:2C:78:7A:F0:71:71:78:85:D9:23:82:43:72:A6:A3:86:64:C5"
VERSIONED_NAME="SurvivalDiary-Android-v0.2.0-b2.apk"
LATEST_NAME="SurvivalDiary-Android-latest.apk"

SIGNING_PASSWORD=""
PUBLISH_TMP_DIR=""
PUBLISH_COMMIT_ACTIVE=0
PUBLISH_TARGETS=()
PUBLISH_BACKUPS=()

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

release_cleanup() {
    local status=$?
    local index target backup
    set +e
    if [[ "$PUBLISH_COMMIT_ACTIVE" -eq 1 ]]; then
        printf 'ERROR: publish interrupted; restoring previous public artifact set\n' >&2
        for index in "${!PUBLISH_TARGETS[@]}"; do
            target="${PUBLISH_TARGETS[$index]}"
            backup="${PUBLISH_BACKUPS[$index]}"
            if [[ -f "$backup" ]]; then
                mv -f "$backup" "$target" || printf 'ERROR: failed to restore %s\n' "$target" >&2
            else
                rm -f "$target" || printf 'ERROR: failed to remove partial %s\n' "$target" >&2
            fi
        done
    fi
    if [[ -n "$PUBLISH_TMP_DIR" && -d "$PUBLISH_TMP_DIR" ]]; then
        rm -rf -- "$PUBLISH_TMP_DIR"
    fi
    unset SIGNING_PASSWORD SURVIVAL_DIARY_STORE_PASSWORD SURVIVAL_DIARY_KEY_PASSWORD
    return "$status"
}

install_release_cleanup_trap() {
    trap release_cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
}

artifact_size() {
    if stat -f '%z' "$1" >/dev/null 2>&1; then
        stat -f '%z' "$1"
    else
        stat -c '%s' "$1"
    fi
}

artifact_sha256() {
    LC_ALL=C shasum -a 256 "$1" | awk '{print $1}'
}

publish_verified_apk() {
    local source_apk="$1"
    local expected_sha256="$2"
    local publish_dir="$3"
    local versioned_name="$4"
    local latest_name="$5"
    local source_size stage_dir backup_dir name staged target backup
    local -a names

    [[ -f "$source_apk" ]] || fail "verified source APK is missing: $source_apk"
    [[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'verified source SHA-256 is malformed'
    source_size="$(artifact_size "$source_apk")"
    [[ "$source_size" =~ ^[0-9]+$ && "$source_size" -gt 0 ]] || fail 'verified source APK is empty'
    [[ "$(artifact_sha256 "$source_apk")" == "$expected_sha256" ]] || fail 'verified source APK SHA-256 changed before publication'

    mkdir -p "$publish_dir"
    PUBLISH_TMP_DIR="$(mktemp -d "$publish_dir/.survival-diary-release.XXXXXX")"
    stage_dir="$PUBLISH_TMP_DIR/stage"
    backup_dir="$PUBLISH_TMP_DIR/backup"
    mkdir -p "$stage_dir" "$backup_dir"

    cp "$source_apk" "$stage_dir/$versioned_name"
    cp "$source_apk" "$stage_dir/$latest_name"
    printf '%s  %s\n' "$expected_sha256" "$versioned_name" > "$stage_dir/$versioned_name.sha256"
    printf '%s  %s\n' "$expected_sha256" "$latest_name" > "$stage_dir/$latest_name.sha256"

    [[ "$(artifact_size "$stage_dir/$versioned_name")" == "$source_size" ]] || fail 'versioned APK size changed while staging'
    [[ "$(artifact_size "$stage_dir/$latest_name")" == "$source_size" ]] || fail 'latest APK size changed while staging'
    [[ "$(artifact_sha256 "$stage_dir/$versioned_name")" == "$expected_sha256" ]] || fail 'versioned APK SHA-256 changed while staging'
    [[ "$(artifact_sha256 "$stage_dir/$latest_name")" == "$expected_sha256" ]] || fail 'latest APK SHA-256 changed while staging'
    cmp -s "$source_apk" "$stage_dir/$versioned_name" || fail 'versioned APK bytes differ from verified source'
    cmp -s "$source_apk" "$stage_dir/$latest_name" || fail 'latest APK bytes differ from verified source'
    (
        cd "$stage_dir"
        LC_ALL=C shasum -a 256 -c "$versioned_name.sha256" >/dev/null
        LC_ALL=C shasum -a 256 -c "$latest_name.sha256" >/dev/null
    ) || fail 'staged checksum files do not validate'

    names=("$versioned_name" "$versioned_name.sha256" "$latest_name" "$latest_name.sha256")
    PUBLISH_TARGETS=()
    PUBLISH_BACKUPS=()
    for name in "${names[@]}"; do
        target="$publish_dir/$name"
        backup="$backup_dir/$name"
        PUBLISH_TARGETS+=("$target")
        PUBLISH_BACKUPS+=("$backup")
        if [[ -f "$target" ]]; then
            cp -p "$target" "$backup"
        fi
    done

    PUBLISH_COMMIT_ACTIVE=1
    for name in "${names[@]}"; do
        staged="$stage_dir/$name"
        target="$publish_dir/$name"
        mv -f "$staged" "$target"
    done

    cmp -s "$source_apk" "$publish_dir/$versioned_name" || fail 'published versioned APK differs from verified source'
    cmp -s "$source_apk" "$publish_dir/$latest_name" || fail 'published latest APK differs from verified source'
    [[ "$(artifact_size "$publish_dir/$versioned_name")" == "$source_size" ]] || fail 'published versioned APK size mismatch'
    [[ "$(artifact_size "$publish_dir/$latest_name")" == "$source_size" ]] || fail 'published latest APK size mismatch'
    [[ "$(artifact_sha256 "$publish_dir/$versioned_name")" == "$expected_sha256" ]] || fail 'published versioned APK SHA-256 mismatch'
    [[ "$(artifact_sha256 "$publish_dir/$latest_name")" == "$expected_sha256" ]] || fail 'published latest APK SHA-256 mismatch'
    (
        cd "$publish_dir"
        LC_ALL=C shasum -a 256 -c "$versioned_name.sha256" >/dev/null
        LC_ALL=C shasum -a 256 -c "$latest_name.sha256" >/dev/null
    ) || fail 'published checksum files do not validate'
    PUBLISH_COMMIT_ACTIVE=0

    rm -rf -- "$PUBLISH_TMP_DIR"
    PUBLISH_TMP_DIR=""
    PUBLISH_TARGETS=()
    PUBLISH_BACKUPS=()
}

main() {
    local sdk_root apksigner aapt cached_gradle apk verify_output actual_cert_sha256
    local badging manifest_tree debuggable_entry sha256
    local -a gradle

    install_release_cleanup_trap
    command -v security >/dev/null 2>&1 || fail 'macOS Keychain command is unavailable'
    [[ -f "$KEYSTORE" ]] || fail "release keystore is missing: $KEYSTORE"

    SIGNING_PASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w)" ||
        fail 'release-signing password was not found in Keychain'
    [[ -n "$SIGNING_PASSWORD" ]] || fail 'release-signing password is empty'
    export SURVIVAL_DIARY_KEYSTORE="$KEYSTORE"
    export SURVIVAL_DIARY_STORE_PASSWORD="$SIGNING_PASSWORD"
    export SURVIVAL_DIARY_KEY_PASSWORD="$SIGNING_PASSWORD"

    sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
    [[ -d "$sdk_root/build-tools" ]] || fail "Android SDK build-tools not found under $sdk_root"
    export ANDROID_SDK_ROOT="$sdk_root"
    apksigner="$(find "$sdk_root/build-tools" -type f -name apksigner | sort | tail -n 1)"
    aapt="$(find "$sdk_root/build-tools" -type f -name aapt | sort | tail -n 1)"
    [[ -x "$apksigner" ]] || fail 'apksigner is unavailable'
    [[ -x "$aapt" ]] || fail 'aapt is unavailable'

    if [[ -z "${JAVA_HOME:-}" && -x '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java' ]]; then
        export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
    fi

    if [[ -x "$ANDROID_PROJECT/gradlew" ]]; then
        gradle=("$ANDROID_PROJECT/gradlew")
    elif command -v gradle >/dev/null 2>&1; then
        gradle=("$(command -v gradle)")
    else
        cached_gradle="$(find "$HOME/.gradle/wrapper/dists" -type f -path '*/gradle-8.*/bin/gradle' 2>/dev/null | sort | tail -n 1)"
        [[ -x "$cached_gradle" ]] || fail 'Gradle wrapper or a compatible Gradle 8 executable is required'
        gradle=("$cached_gradle")
    fi

    (
        cd "$ANDROID_PROJECT"
        "${gradle[@]}" clean assembleSurvivalDiaryRelease
    )

    apk="$ANDROID_PROJECT/app/build/outputs/apk/survivalDiary/release/app-survivalDiary-release.apk"
    [[ -f "$apk" ]] || fail "signed release APK was not produced: $apk"
    verify_output="$("$apksigner" verify --verbose --print-certs "$apk")" || fail 'apksigner verification failed'
    printf '%s\n' "$verify_output"
    grep -q 'Verifies' <<<"$verify_output" || fail 'APK signature verification did not report success'
    if grep -q 'CN=Android Debug' <<<"$verify_output"; then
        fail 'APK is signed with the Android Debug certificate'
    fi
    actual_cert_sha256="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$verify_output" | head -n 1 | tr '[:lower:]' '[:upper:]' | sed 's/../&:/g; s/:$//')"
    [[ "$actual_cert_sha256" == "$EXPECTED_CERT_SHA256" ]] || fail "unexpected signing certificate SHA-256: $actual_cert_sha256"

    badging="$("$aapt" dump badging "$apk")" || fail 'unable to inspect APK manifest metadata'
    grep -q "package: name='$EXPECTED_PACKAGE' versionCode='$EXPECTED_VERSION_CODE' versionName='$EXPECTED_VERSION_NAME'" <<<"$badging" ||
        fail 'APK package or version metadata does not match the release contract'
    grep -q "application-label:'$EXPECTED_LABEL'" <<<"$badging" || fail 'APK application label does not match the release contract'
    if grep -q '^application-debuggable' <<<"$badging"; then
        fail 'APK manifest is debuggable'
    fi
    manifest_tree="$("$aapt" dump xmltree "$apk" AndroidManifest.xml)" || fail 'unable to inspect compiled AndroidManifest.xml'
    debuggable_entry="$(grep 'android:debuggable' <<<"$manifest_tree" || true)"
    if [[ -n "$debuggable_entry" ]] && ! grep -Eq '\(type 0x12\)0x0$' <<<"$debuggable_entry"; then
        fail 'compiled android:debuggable is not false'
    fi

    sha256="$(artifact_sha256 "$apk")"
    [[ "$sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'failed to calculate APK SHA-256'
    publish_verified_apk "$apk" "$sha256" "$PUBLISH_DIR" "$VERSIONED_NAME" "$LATEST_NAME"

    printf 'Verified package: %s\n' "$EXPECTED_PACKAGE"
    printf 'Verified label: %s\n' "$EXPECTED_LABEL"
    printf 'Verified version: %s (build %s)\n' "$EXPECTED_VERSION_NAME" "$EXPECTED_VERSION_CODE"
    printf 'Verified certificate SHA-256: %s\n' "$EXPECTED_CERT_SHA256"
    printf 'APK SHA-256: %s\n' "$sha256"
    printf 'Published: %s\n' "$PUBLISH_DIR/$VERSIONED_NAME"
    printf 'Published latest: %s\n' "$PUBLISH_DIR/$LATEST_NAME"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
