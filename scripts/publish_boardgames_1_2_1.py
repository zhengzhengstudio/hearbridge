#!/usr/bin/env python3
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.2.1"
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


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package(name: str, latest: str) -> dict:
    source = DOWNLOADS / name
    if not source.is_file():
        raise SystemExit(f"Missing package: {source}")
    for app_dir in APP_DIRS:
        app_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, app_dir / name)
        shutil.copy2(source, app_dir / latest)
    return {
        "fileName": name,
        "url": f"/api/apps/{latest}",
        "latestUrl": f"/api/apps/{latest}",
        "versionedUrl": f"/api/apps/{name}",
        "downloadURL": f"/api/apps/{name}",
        "size": source.stat().st_size,
        "fileSize": source.stat().st_size,
        "sha256": sha256(source),
        "checksum": sha256(source),
    }


android = package(
    "ZhengzhengBoardGames-Android-v1.2.1.apk",
    "ZhengzhengBoardGames-Android-latest.apk",
)
macos = package(
    "MultipleBoardGames-macOS-v1.2.1.dmg",
    "MultipleBoardGames-macOS-latest.dmg",
)
harmony_hap = package(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.1-signed.hap",
    "ZhengZhengBoardGames-HarmonyOS-latest.hap",
)
harmony_app = package(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.1-signed.app",
    "ZhengZhengBoardGames-HarmonyOS-latest.app",
)

notes = [
    "大厅与游戏库重新分工，账号、公开房间、排行榜、偏好、反馈、关于和更新改为独立面板。",
    "本地练习只显示 AI 难度、重开等本地操作；联机房间才显示邀请、聊天和房间状态。",
    "全平台统一中性色界面、低饱和绿色强调色、深浅色模式与紧凑响应式排版。",
    "HarmonyOS 补齐桌面图标、扫一扫入口、自动碰一碰邀请、隔空投送邀请和 HAP/APP 发布包。",
]

entries = {
    "android": {
        "id": "cn.zhengzhengstudio.boardgames",
        "name": "铮铮桌游中心",
        "platform": "android",
        "platformLabel": "Android",
        "kind": "package",
        "version": VERSION,
        "latestVersion": VERSION,
        "versionName": VERSION,
        "build": 24,
        "versionCode": 24,
        "minimumSystem": "Android 7.0",
        "minSystem": "Android 7.0",
        "bundleIdentifier": "cn.zhengzhengstudio.boardgames",
        "signed": True,
        "distributionStatus": "compatible-debug-signature",
        **android,
    },
    "macos": {
        "id": "com.zzsys.MuitpalBoardGames.MultipleBoardGames",
        "name": "铮铮桌游中心",
        "platform": "macos",
        "platformLabel": "macOS",
        "kind": "package",
        "version": VERSION,
        "latestVersion": VERSION,
        "versionName": VERSION,
        "build": 19,
        "versionCode": 19,
        "minimumSystem": "macOS 11.0",
        "minSystem": "macOS 11.0",
        "bundleIdentifier": "com.zzsys.MuitpalBoardGames.MultipleBoardGames",
        "signed": True,
        "distributionStatus": "ad-hoc",
        **macos,
    },
    "harmonyos": {
        "id": "cn.zhengzhengstudio.boardgames.hmos",
        "name": "铮铮桌游中心",
        "platform": "harmonyos",
        "platformLabel": "HarmonyOS",
        "kind": "package",
        "version": VERSION,
        "latestVersion": VERSION,
        "versionName": VERSION,
        "build": 17,
        "versionCode": 1020100,
        "minimumSystem": "HarmonyOS 6.0.2",
        "minSystem": "HarmonyOS 6.0.2",
        "bundleIdentifier": "cn.zhengzhengstudio.boardgames.hmos",
        "signed": True,
        "distributionStatus": "release",
        "installURL": "/tools/hap_installer.html?app=cn.zhengzhengstudio.boardgames.hmos",
        "appPackFileName": harmony_app["fileName"],
        "appPackURL": harmony_app["versionedUrl"],
        "appPackSize": harmony_app["size"],
        "appPackSha256": harmony_app["sha256"],
        **harmony_hap,
    },
    "web": {
        "id": "zhengzhengstudio-boardgames-web",
        "name": "铮铮桌游中心网页版",
        "platform": "web",
        "platformLabel": "Web",
        "kind": "web",
        "version": VERSION,
        "latestVersion": VERSION,
        "versionName": VERSION,
        "build": 18,
        "versionCode": 18,
        "url": "/boardgames/",
        "versionedUrl": "/boardgames/",
        "downloadURL": "",
        "minimumSystem": "现代浏览器",
        "minSystem": "现代浏览器",
        "size": 0,
        "fileSize": 0,
        "sha256": "",
        "checksum": "",
    },
}

for entry in entries.values():
    entry.update(
        {
            "pageURL": "/boardgames/",
            "category": "桌游",
            "updatedAt": NOW,
            "title": f"{entry['name']} {entry['platformLabel']} v{VERSION}",
            "remarks": "原生界面与网页版共享房间协议；本地练习在断网时仍可使用。",
            "notes": notes,
        }
    )


def update_manifest(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["updatedAt"] = NOW
    data["generatedAt"] = NOW
    data["latestVersion"] = VERSION
    apps = data.setdefault("apps", [])
    for platform, entry in entries.items():
        match = next(
            (
                index
                for index, app in enumerate(apps)
                if app.get("id") == entry["id"] and app.get("platform") == platform
            ),
            None,
        )
        if match is None:
            apps.append(entry)
        else:
            apps[match] = {**apps[match], **entry}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


for manifest in MANIFESTS:
    update_manifest(manifest)

print("Published BoardGames 1.2.1 packages and synchronized manifests.")
