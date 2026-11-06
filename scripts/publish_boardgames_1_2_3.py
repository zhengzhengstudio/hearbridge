#!/usr/bin/env python3
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.2.3"
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
    "ZhengzhengBoardGames-Android-v1.2.3.apk",
    "ZhengzhengBoardGames-Android-latest.apk",
)
macos = package(
    "MultipleBoardGames-macOS-v1.2.3.dmg",
    "MultipleBoardGames-macOS-latest.dmg",
)
harmony_hap = package(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.3-signed.hap",
    "ZhengZhengBoardGames-HarmonyOS-latest.hap",
)
harmony_app = package(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.3-signed.app",
    "ZhengZhengBoardGames-HarmonyOS-latest.app",
)

notes = [
    "恢复主站 /api/boardgames/ws 原生联机入口，网页、Android、macOS 与服务端重新共享房间、棋局和聊天状态。",
    "修复语音成员标识不一致导致无法建立通话；网页加入 WebRTC 与原生 PCM16 桥接，Android、macOS、iPhone/iPad 与鸿蒙在线工程使用真实麦克风采集和播放。",
    "实时对局改为不压缩的持久 WebSocket，避免轮询被多个 Cloudflare 连接器拆散，并减少长时间连接、卡住和不同步。",
    "网页局内交流面板按 taste-skill 专修为桌边记分台布局，桌面、手机、平板与折叠屏均避免遮挡棋盘。",
    "HarmonyOS 1.2.3 为备案前纯单机发布版，不申请联网和扫码权限，保留完整本地桌游、深浅色与响应式布局。",
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
        "build": 26,
        "versionCode": 26,
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
        "build": 21,
        "versionCode": 21,
        "minimumSystem": "macOS 13.0",
        "minSystem": "macOS 13.0",
        "bundleIdentifier": "com.zzsys.MuitpalBoardGames.MultipleBoardGames",
        "signed": True,
        "distributionStatus": "apple-development",
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
        "build": 19,
        "versionCode": 1020300,
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
        "build": 21,
        "versionCode": 21,
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
            "remarks": "网页与联网原生端共享房间协议；HarmonyOS 当前提供备案前纯单机版。",
            "notes": notes,
        }
    )
    entry["latestBuild"] = entry["build"]
    entry["buildNumber"] = entry["build"]
    entry["latestVersionCode"] = entry["versionCode"]
    entry["shortVersion"] = VERSION
    entry["releaseDate"] = NOW[:10]
    entry["changelog"] = "\n".join(notes)
    if entry.get("fileName"):
        entry["filename"] = entry["fileName"]
        entry["file"] = entry["fileName"]
        entry["latestURL"] = entry["latestUrl"]
        entry["latestDownloadURL"] = entry["latestUrl"]
        entry["downloadUrl"] = entry["versionedUrl"]
        entry["download_url"] = entry["versionedUrl"]
        entry["versionedURL"] = entry["versionedUrl"]

entries["harmonyos"]["appPackLatestURL"] = "/api/apps/ZhengZhengBoardGames-HarmonyOS-latest.app"


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

print("Published BoardGames 1.2.3 packages and synchronized manifests.")
