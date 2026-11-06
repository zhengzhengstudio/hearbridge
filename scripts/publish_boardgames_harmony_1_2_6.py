#!/usr/bin/env python3
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.2.6"
NOW = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
DOWNLOADS = Path.home() / "Downloads"
APP_DIRS = [ROOT / "website/api/apps", ROOT / "website/zhengzhengstudio.cn/api/apps"]
MANIFESTS = [
    ROOT / "website/api/apps/manifest.json",
    ROOT / "website/api/apps/client-downloads.json",
    ROOT / "website/zhengzhengstudio.cn/api/apps/manifest.json",
    ROOT / "website/zhengzhengstudio.cn/api/apps/client-downloads.json",
    ROOT / "website/zhengzhengstudio.cn/api/boardgames/apps/manifest.json",
    ROOT / "website/zhengzhengstudio.cn/api/boardgames/manifest.json",
]


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def copy_package(file_name: str, latest_name: str) -> dict:
    source = DOWNLOADS / file_name
    if not source.is_file():
        raise SystemExit(f"Missing package: {source}")
    for directory in APP_DIRS:
        directory.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, directory / file_name)
        shutil.copy2(source, directory / latest_name)
    checksum = sha256(source)
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


hap = copy_package(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.6-signed.hap",
    "ZhengZhengBoardGames-HarmonyOS-latest.hap",
)
app_pack = copy_package(
    "ZhengZhengBoardGames-HarmonyOS-v1.2.6-signed.app",
    "ZhengZhengBoardGames-HarmonyOS-latest.app",
)
notes = [
    "完整恢复旧版蓝底四枚白色棋格图标，AppScope、EntryAbility、启动页和单层回退资源保持一致。",
    "五子棋改为真正的 15 路交点棋盘，补齐边界半线、九个星位、棋子层次和最后一步标记。",
    "围棋同步改为 19 路交点棋盘，棋子不再落在方格中心，并补齐标准九星与最后一步标记。",
    "网页拉密手机端取消空公共牌区的超高占位，手牌更早进入首屏；顶部标题和联机操作在窄屏下不再互相挤压。",
    "保留联机快照兼容修复，网页、Android、Apple 与 HarmonyOS 继续使用同一套房间状态。",
]
entry = {
    "id": "cn.zhengzhengstudio.boardgames.hmos",
    "name": "铮铮桌游中心",
    "platform": "harmonyos",
    "platformLabel": "HarmonyOS",
    "kind": "package",
    "bundleIdentifier": "cn.zhengzhengstudio.boardgames.hmos",
    "version": VERSION,
    "latestVersion": VERSION,
    "versionName": VERSION,
    "shortVersion": VERSION,
    "build": 22,
    "latestBuild": 22,
    "buildNumber": 22,
    "versionCode": 1020600,
    "latestVersionCode": 1020600,
    "minimumSystem": "HarmonyOS 6.0.2",
    "minSystem": "HarmonyOS 6.0.2",
    "signed": True,
    "distributionStatus": "release",
    "installURL": "/tools/hap_installer.html?app=cn.zhengzhengstudio.boardgames.hmos",
    "appPackFileName": app_pack["fileName"],
    "appPackURL": app_pack["versionedUrl"],
    "appPackLatestURL": "/api/apps/ZhengZhengBoardGames-HarmonyOS-latest.app",
    "appPackSize": app_pack["size"],
    "appPackSha256": app_pack["sha256"],
    "updatedAt": NOW,
    "releaseDate": NOW[:10],
    "pageURL": "/boardgames/",
    "category": "桌游",
    "title": f"铮铮桌游中心 HarmonyOS v{VERSION}",
    "remarks": "鸿蒙旧版图标恢复与交点棋盘修复版。",
    "notes": notes,
    "changelog": "\n".join(notes),
    **hap,
}


for path in MANIFESTS:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["updatedAt"] = NOW
    data["generatedAt"] = NOW
    data["latestVersion"] = VERSION
    apps = data.setdefault("apps", [])
    index = next((i for i, app in enumerate(apps) if app.get("id") == entry["id"] and app.get("platform") == "harmonyos"), None)
    if index is None:
        apps.append(entry)
    else:
        apps[index] = {**apps[index], **entry}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

changelog_path = ROOT / "website/api/data/changelogs.json"
changelogs = json.loads(changelog_path.read_text(encoding="utf-8"))
changelog_id = "2026-07-31-boardgames-harmony-1-2-6-icon-board"
changelogs = [item for item in changelogs if item.get("id") != changelog_id]
changelogs.insert(0, {
    "id": changelog_id,
    "date": NOW,
    "type": "fix",
    "product": "铮铮桌游中心",
    "title": "铮铮桌游中心 HarmonyOS 1.2.6：旧版图标恢复与交点棋盘修复",
    "content": "已完成：\n- " + "\n- ".join(notes) + "\n- 发布版 HAP 与 APP Pack 已使用正式发布证书签名，并同步下载中心与应用更新清单。"
})
changelog_path.write_text(json.dumps(changelogs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("Published BoardGames HarmonyOS 1.2.6 packages.")
