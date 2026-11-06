#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_ID = "zhengzhengstudio-boardgames-web"
MANIFESTS = [
    ROOT / "website" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "manifest.json",
]


def save(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish BoardGames web release metadata.")
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True, type=int)
    args = parser.parse_args()

    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    notes = [
        "五子棋、围棋和中国象棋的 AI 会识别立即获胜、必须防守、提子与吃子。",
        "棋局分析加入候选着、置信度、搜索节点和主变化路线。",
        "每个支持棋种至少提供 3 道具名残局，并区分标准答案与合法错误着。",
    ]
    release = {
        "id": APP_ID,
        "name": "铮铮桌游中心网页版",
        "platform": "web",
        "platformLabel": "Web",
        "kind": "web",
        "version": args.version,
        "versionName": args.version,
        "shortVersion": args.version,
        "latestVersion": args.version,
        "build": args.build,
        "buildNumber": args.build,
        "latestBuild": args.build,
        "versionCode": args.build,
        "latestVersionCode": args.build,
        "updatedAt": now,
        "releaseDate": now[:10],
        "pageURL": "/boardgames/",
        "url": "/boardgames/",
        "title": f"铮铮桌游中心网页版 v{args.version}",
        "remarks": "AI、残局与棋局分析正式升级。",
        "notes": notes,
        "changelog": "\n".join(notes),
        "distributionStatus": "online",
    }

    for path in MANIFESTS:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["updatedAt"] = now
        manifest["generatedAt"] = now
        apps = manifest.setdefault("apps", [])
        for index, app in enumerate(apps):
            if app.get("id") == APP_ID:
                apps[index] = {**app, **release}
                break
        else:
            apps.append(release)
        save(path, manifest)

    print(f"Published web metadata {args.version} build {args.build}")


if __name__ == "__main__":
    main()
