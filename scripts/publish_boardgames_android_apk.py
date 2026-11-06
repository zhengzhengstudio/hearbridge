#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_ID = "cn.zhengzhengstudio.boardgames"
APP_DIRS = [ROOT / "website" / "api" / "apps", ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps"]
MANIFESTS = [
    ROOT / "website" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "manifest.json",
]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Publish the BoardGames Android APK.")
    parser.add_argument("apk", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True, type=int)
    args = parser.parse_args()
    source = args.apk.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"APK not found: {source}")

    file_name = f"ZhengzhengBoardGames-Android-v{args.version}.apk"
    latest_name = "ZhengzhengBoardGames-Android-latest.apk"
    for app_dir in APP_DIRS:
        shutil.copy2(source, app_dir / file_name)
        shutil.copy2(source, app_dir / latest_name)
    download_target = (Path.home() / "Downloads" / file_name).resolve()
    if source != download_target:
        shutil.copy2(source, download_target)

    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    size = source.stat().st_size
    checksum = sha256(source)
    notes = [
        "AI 升级：五子棋、围棋和中国象棋会识别立即获胜、必须防守、提子与吃子，并返回候选着、置信度和主变化。",
        "残局升级：每个支持棋种至少 3 道具名题目，包含难度、目标、标准答案和合法错误着判断。",
        "局内邀请统一为 v1 接续/对弈申请协议，只接受有效房间令牌，并兼容旧版字段。",
        "Android 可选棋盘纹理未从 iCloud 下载时安全回退到原生绘制，不再阻断测试和 APK 构建。",
    ]
    package = {
        "fileName": file_name, "filename": file_name, "file": file_name,
        "url": f"/api/apps/{latest_name}", "latestUrl": f"/api/apps/{latest_name}",
        "latestURL": f"/api/apps/{latest_name}", "latestDownloadURL": f"/api/apps/{latest_name}",
        "versionedUrl": f"/api/apps/{file_name}", "versionedURL": f"/api/apps/{file_name}",
        "downloadURL": f"/api/apps/{file_name}", "downloadUrl": f"/api/apps/{file_name}",
        "download_url": f"/api/apps/{file_name}", "size": size, "fileSize": size,
        "sha256": checksum, "checksum": checksum,
    }
    entry = {
        "id": APP_ID, "name": "铮铮桌游中心", "platform": "android", "platformLabel": "Android",
        "kind": "package", "bundleIdentifier": APP_ID, "packageName": APP_ID, "applicationId": APP_ID,
        "version": args.version, "versionName": args.version, "shortVersion": args.version,
        "latestVersion": args.version, "build": args.build, "buildNumber": args.build,
        "latestBuild": args.build, "versionCode": args.build, "latestVersionCode": args.build,
        "minimumSystem": "Android 7.0", "minSystem": "Android 7.0", "updatedAt": now,
        "releaseDate": now[:10], "pageURL": "/boardgames/", "category": "桌游",
        "title": f"铮铮桌游中心 Android v{args.version}", "remarks": "AI、残局与棋局分析正式升级。",
        "notes": notes, "changelog": "\n".join(notes), "signed": True,
        "distributionStatus": "compatible-debug-signature", **package,
    }

    for manifest_path in MANIFESTS:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["updatedAt"] = now
        manifest["generatedAt"] = now
        apps = manifest.setdefault("apps", [])
        index = next((i for i, app in enumerate(apps)
                      if app.get("id") == APP_ID and app.get("platform") == "android"), None)
        if index is None:
            apps.append(entry)
        else:
            apps[index] = {**apps[index], **entry}
        if manifest_path.name == "client-downloads.json":
            manifest["latestVersion"] = args.version
            manifest["latestBuild"] = args.build
            manifest["versionCode"] = args.build
            manifest.setdefault("downloads", {})["android"] = entry
            macos = next((app for app in apps
                          if app.get("id") == "com.zzsys.MuitpalBoardGames.MultipleBoardGames"
                          and app.get("platform") == "macos"), None)
            if macos:
                manifest["downloads"]["macos"] = macos
        save(manifest_path, manifest)
    print(f"Published {file_name} ({size} bytes, {checksum})")


if __name__ == "__main__":
    main()
