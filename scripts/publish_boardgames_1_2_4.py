#!/usr/bin/env python3
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.2.4"
NOW = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
DOWNLOADS = Path.home() / "Downloads"
APP_DIRS = [
    ROOT / "website" / "api" / "apps",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps",
]
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


def publish(file_name: str, latest_name: str) -> dict:
    source = DOWNLOADS / file_name
    if not source.is_file():
        raise SystemExit(f"Missing package: {source}")
    for directory in APP_DIRS:
        directory.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, directory / file_name)
        shutil.copy2(source, directory / latest_name)
    checksum = digest(source)
    return {
        "fileName": file_name,
        "filename": file_name,
        "file": file_name,
        "url": f"/api/apps/{latest_name}",
        "latestUrl": f"/api/apps/{latest_name}",
        "latestURL": f"/api/apps/{latest_name}",
        "latestDownloadURL": f"/api/apps/{latest_name}",
        "versionedUrl": f"/api/apps/{file_name}",
        "versionedURL": f"/api/apps/{file_name}",
        "downloadURL": f"/api/apps/{file_name}",
        "downloadUrl": f"/api/apps/{file_name}",
        "download_url": f"/api/apps/{file_name}",
        "size": source.stat().st_size,
        "fileSize": source.stat().st_size,
        "sha256": checksum,
        "checksum": checksum,
    }


android_package = publish(
    "ZhengzhengBoardGames-Android-v1.2.4.apk",
    "ZhengzhengBoardGames-Android-latest.apk",
)
harmony_package = publish(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.4-signed.hap",
    "ZhengZhengBoardGames-HarmonyOS-latest.hap",
)
harmony_app_package = publish(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.4-signed.app",
    "ZhengZhengBoardGames-HarmonyOS-latest.app",
)

notes = [
    "修复 Android 联机快照清空棋盘后无法恢复扁平 board 数据，黑白棋子不再在联机中消失。",
    "服务端开局、重连和落子快照统一附带 boardFlat 与 boardSize，旧客户端字段继续保留。",
    "HarmonyOS 按当前游戏恢复 3×3、8×8、15×15 或 19×19 棋盘，修复五子棋盘混入 361 格状态的问题。",
]

entries = {
    ("cn.zhengzhengstudio.boardgames", "android"): {
        "id": "cn.zhengzhengstudio.boardgames",
        "name": "铮铮桌游中心",
        "platform": "android",
        "platformLabel": "Android",
        "kind": "package",
        "bundleIdentifier": "cn.zhengzhengstudio.boardgames",
        "build": 27,
        "versionCode": 27,
        "minimumSystem": "Android 7.0",
        "minSystem": "Android 7.0",
        "signed": True,
        "distributionStatus": "compatible-debug-signature",
        **android_package,
    },
    ("cn.zhengzhengstudio.boardgames.hmos", "harmonyos"): {
        "id": "cn.zhengzhengstudio.boardgames.hmos",
        "name": "铮铮桌游中心",
        "platform": "harmonyos",
        "platformLabel": "HarmonyOS",
        "kind": "package",
        "bundleIdentifier": "cn.zhengzhengstudio.boardgames.hmos",
        "build": 20,
        "versionCode": 1020400,
        "minimumSystem": "HarmonyOS 6.0.2",
        "minSystem": "HarmonyOS 6.0.2",
        "signed": True,
        "distributionStatus": "release",
        "installURL": "/tools/hap_installer.html?app=cn.zhengzhengstudio.boardgames.hmos",
        "appPackFileName": harmony_app_package["fileName"],
        "appPackURL": harmony_app_package["versionedUrl"],
        "appPackLatestURL": "/api/apps/ZhengZhengBoardGames-HarmonyOS-latest.app",
        "appPackSize": harmony_app_package["size"],
        "appPackSha256": harmony_app_package["sha256"],
        **harmony_package,
    },
}

for entry in entries.values():
    entry.update({
        "version": VERSION,
        "latestVersion": VERSION,
        "versionName": VERSION,
        "shortVersion": VERSION,
        "latestBuild": entry["build"],
        "buildNumber": entry["build"],
        "latestVersionCode": entry["versionCode"],
        "updatedAt": NOW,
        "releaseDate": NOW[:10],
        "pageURL": "/boardgames/",
        "category": "桌游",
        "title": f"铮铮桌游中心 {entry['platformLabel']} v{VERSION}",
        "remarks": "联机棋盘状态修复版。",
        "notes": notes,
        "changelog": "\n".join(notes),
    })


def update_manifest(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["updatedAt"] = NOW
    data["generatedAt"] = NOW
    data["latestVersion"] = VERSION
    apps = data.setdefault("apps", [])
    for key, replacement in entries.items():
        index = next((i for i, app in enumerate(apps) if (app.get("id"), app.get("platform")) == key), None)
        if index is None:
            apps.append(replacement)
        else:
            apps[index] = {**apps[index], **replacement}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


for manifest in MANIFESTS:
    update_manifest(manifest)

print("Published BoardGames 1.2.4 Android and HarmonyOS packages.")
