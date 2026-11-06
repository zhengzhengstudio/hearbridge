#!/bin/bash
set -euo pipefail

brand_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$brand_root/../.." && pwd)"
master="$brand_root/icon/lifediary-icon-master-1024.png"
ios_dir="$repo_root/apps/LifeDiary-iOS/Sources/LifeDiary/Resources/Assets.xcassets/AppIcon.appiconset"
mac_set="$repo_root/apps/LifeDiary-macOS/AppIcon.iconset"

test -f "$master"
mkdir -p "$ios_dir" "$mac_set"
sips -z 1024 1024 "$master" --out "$ios_dir/AppIcon-1024.png" >/dev/null

for size in 16 32 128 256 512; do
    double=$((size * 2))
    sips -z "$size" "$size" "$master" --out "$mac_set/icon_${size}x${size}.png" >/dev/null
    sips -z "$double" "$double" "$master" --out "$mac_set/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$mac_set" -o "$repo_root/apps/LifeDiary-macOS/LifeDiary.icns"

foreground="$brand_root/icon/lifediary-icon-foreground-transparent.png"
android_res="$repo_root/apps/LifeDiary-Android/app/src/main/res"
test -f "$foreground"

for spec in "mdpi 108 48" "hdpi 162 72" "xhdpi 216 96" "xxhdpi 324 144" "xxxhdpi 432 192"; do
    set -- $spec
    density="$1"
    adaptive="$2"
    legacy="$3"
    mkdir -p "$android_res/mipmap-$density"
    sips -z "$adaptive" "$adaptive" "$foreground" --out "$android_res/mipmap-$density/ic_launcher_foreground.png" >/dev/null
    sips -z "$legacy" "$legacy" "$master" --out "$android_res/mipmap-$density/ic_launcher.png" >/dev/null
done

for project in LifeDiary-HarmonyOS-Online LifeDiary-HarmonyOS-Offline; do
    for target in AppScope/resources/base/media entry/src/main/resources/base/media; do
        sips -z 1024 1024 "$foreground" --out "$repo_root/apps/$project/$target/foreground.png" >/dev/null
    done
done
