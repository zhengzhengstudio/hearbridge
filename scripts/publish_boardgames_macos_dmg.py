#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_ID = "com.zzsys.MuitpalBoardGames.MultipleBoardGames"
APP_DIRS = [ROOT / "website" / "api" / "apps", ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps"]
MANIFESTS = [
    ROOT / "website" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "manifest.json",
]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def save(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish the BoardGames macOS DMG.")
    parser.add_argument("dmg", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True, type=int)
    args = parser.parse_args()
    source = args.dmg.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"DMG not found: {source}")

    file_name = f"MultipleBoardGames-macOS-v{args.version}.dmg"
    latest_name = "MultipleBoardGames-macOS-latest.dmg"
    for app_dir in APP_DIRS:
        shutil.copy2(source, app_dir / file_name)
        shutil.copy2(source, app_dir / latest_name)
    destination = Path.home() / "Downloads" / file_name
    if source != destination:
        shutil.copy2(source, destination)

    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    size = source.stat().st_size
    checksum = digest(source)
    notes = [
        "五子棋、围棋和中国象棋的 AI 会识别立即获胜、必须防守、提子与吃子。",
        "棋局分析加入候选着、置信度、搜索节点和主变化路线。",
        "每个支持棋种至少提供 3 道具名残局，并区分标准答案与合法错误着。",
        "DMG 内含应用本体和“应用程序”替身。",
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
        "id": APP_ID, "name": "铮铮桌游中心", "platform": "macos", "platformLabel": "macOS",
        "kind": "package", "bundleIdentifier": APP_ID, "version": args.version,
        "versionName": args.version, "shortVersion": args.version, "latestVersion": args.version,
        "build": args.build, "buildNumber": args.build, "latestBuild": args.build,
        "versionCode": args.build, "latestVersionCode": args.build,
        "minimumSystem": "macOS 13.0", "minSystem": "macOS 13.0", "updatedAt": now,
        "releaseDate": now[:10], "pageURL": "/boardgames/", "category": "桌游",
        "title": f"铮铮桌游中心 macOS v{args.version}", "remarks": "AI、残局与棋局分析正式升级。",
        "notes": notes, "changelog": "\n".join(notes), "signed": True,
        "distributionStatus": "ad-hoc", **package,
    }

    for manifest_path in MANIFESTS:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["updatedAt"] = now
        manifest["generatedAt"] = now
        apps = manifest.setdefault("apps", [])
        index = next((i for i, app in enumerate(apps)
                      if app.get("id") == APP_ID and app.get("platform") == "macos"), None)
        if index is None:
            apps.append(entry)
        else:
            apps[index] = {**apps[index], **entry}
        if manifest_path.name == "client-downloads.json":
            manifest.setdefault("downloads", {})["macos"] = entry
        save(manifest_path, manifest)
    print(f"Published {file_name} ({size} bytes, {checksum})")


if __name__ == "__main__":
    main()
