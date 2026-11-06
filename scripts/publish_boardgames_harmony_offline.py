#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_DIRS = [
    ROOT / "website" / "api" / "apps",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps",
]
MANIFESTS = [
    app_dir / name
    for app_dir in APP_DIRS
    for name in ("manifest.json", "client-downloads.json")
]
CHANGELOG = ROOT / "website" / "api" / "data" / "changelogs.json"
PUBLIC_CHANGELOG = ROOT / "website" / "zhengzhengstudio.cn" / "api" / "changelogs.json"
BUNDLE_ID = "cn.zhengzhengstudio.boardgames.offline.hmos"


def find_sign_tool() -> Path:
    candidates = [
        Path(os.environ.get("HAP_SIGN_TOOL", "")),
        Path("/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar"),
    ]
    for candidate in candidates:
        if str(candidate) and candidate.is_file():
            return candidate
    raise SystemExit("HarmonyOS signing verifier not found; refusing to publish an unchecked release.")


def verify_hap(path: Path):
    tool = find_sign_tool()
    with tempfile.TemporaryDirectory(prefix="zz-offline-hap-verify-") as work:
        result = subprocess.run(
            ["java", "-jar", str(tool), "verify-app", "-inFile", str(path),
             "-outCertChain", f"{work}/cert.cer", "-outProfile", f"{work}/profile.p7b"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, check=False,
        )
    output = f"{result.stdout}\n{result.stderr}"
    if "verify-app success" not in output.lower():
        raise SystemExit(f"HarmonyOS package signature verification failed: {path}\n{output.strip()}")


def verify_app_pack(path: Path):
    with tempfile.TemporaryDirectory(prefix="zz-offline-app-verify-") as work:
        with zipfile.ZipFile(path) as archive:
            hap_names = [name for name in archive.namelist() if name.lower().endswith(".hap")]
            if len(hap_names) != 1:
                raise SystemExit(f"APP Pack must contain exactly one HAP: {path}")
            archive.extract(hap_names[0], work)
            verify_hap(Path(work) / hap_names[0])


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_json(path: Path, fallback):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def save_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def release_entry(source: Path, version: str, build: int, version_code: int, artifact: str, now: str):
    extension = artifact
    entry_id = BUNDLE_ID if artifact == "hap" else f"{BUNDLE_ID}.app"
    name = "铮铮单机桌游" if artifact == "hap" else "铮铮单机桌游 APP 上架包"
    versioned = f"ZhengZhengBoardGames-Offline-HarmonyOS-v{version}-signed.{extension}"
    latest = f"ZhengZhengBoardGames-Offline-HarmonyOS-latest.{extension}"
    file_digest = digest(source)
    size = source.stat().st_size
    notes = [
        f"使用独立包名 {BUNDLE_ID}，可与联机版并存安装。",
        "五子棋、围棋和中国象棋加入本地分析、残局训练、自建棋盘与三档 AI。",
        "围棋补齐提子、自杀禁入与基础劫；中国象棋使用独立合法着法生成与吃子规则。",
        "中国版飞行棋素材已逐图复核；手机、平板与 2in1 保持棋盘优先的响应式布局。",
        "HAP 和 APP Pack 内层 HAP 均通过发布签名校验。",
        "不声明网络权限；14 款桌游、线下多人、AI 训练和本地设置均可离线使用。",
    ]
    return {
        "id": entry_id,
        "name": name,
        "platform": "harmonyos",
        "platformLabel": "HarmonyOS",
        "kind": "package",
        "variant": "offline",
        "artifactType": artifact,
        "version": version,
        "versionName": version,
        "shortVersion": version,
        "latestVersion": version,
        "build": build,
        "buildNumber": build,
        "latestBuild": build,
        "versionCode": version_code,
        "latestVersionCode": version_code,
        "minSystem": "HarmonyOS 6.0.2",
        "minimumSystem": "HarmonyOS 6.0.2",
        "fileName": versioned,
        "filename": versioned,
        "file": versioned,
        "url": f"/api/apps/{latest}",
        "latestUrl": f"/api/apps/{latest}",
        "latestURL": f"/api/apps/{latest}",
        "latestDownloadURL": f"/api/apps/{latest}",
        "versionedUrl": f"/api/apps/{versioned}",
        "versionedURL": f"/api/apps/{versioned}",
        "downloadURL": f"/api/apps/{versioned}",
        "downloadUrl": f"/api/apps/{versioned}",
        "download_url": f"/api/apps/{versioned}",
        "pageURL": "/boardgames/",
        "size": size,
        "fileSize": size,
        "sha256": file_digest,
        "checksum": file_digest,
        "updatedAt": now,
        "category": "桌游",
        "remarks": "不联网也能完整游玩的鸿蒙原生桌游合集。" if artifact == "hap" else "供 AppGallery Connect 提交审核的正式 APP Pack。",
        "notes": notes,
        "title": f"{name} v{version}",
        "bundleIdentifier": BUNDLE_ID,
        "signed": True,
        "distributionStatus": "release",
        "storeReady": artifact == "app",
        "releaseDate": now[:10],
        "changelog": "\n".join(notes),
        **({
            "isHap": True,
            "installURL": f"/tools/hap_installer.html?app={BUNDLE_ID}",
            "links": [{"name": "HAP 分发安装", "url": f"/tools/hap_installer.html?app={BUNDLE_ID}"}],
        } if artifact == "hap" else {}),
    }


def main():
    parser = argparse.ArgumentParser(description="Publish the offline HarmonyOS board game HAP and APP Pack.")
    parser.add_argument("hap", type=Path)
    parser.add_argument("app", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True, type=int)
    parser.add_argument("--version-code", required=True, type=int)
    args = parser.parse_args()
    sources = {"hap": args.hap.expanduser().resolve(), "app": args.app.expanduser().resolve()}
    for source in sources.values():
        if not source.exists():
            raise SystemExit(f"Package not found: {source}")
    verify_hap(sources["hap"])
    verify_app_pack(sources["app"])

    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    entries = {
        artifact: release_entry(source, args.version, args.build, args.version_code, artifact, now)
        for artifact, source in sources.items()
    }
    for app_dir in APP_DIRS:
        app_dir.mkdir(parents=True, exist_ok=True)
        for artifact, source in sources.items():
            entry = entries[artifact]
            shutil.copy2(source, app_dir / entry["fileName"])
            shutil.copy2(source, app_dir / Path(entry["url"]).name)

    for manifest_path in MANIFESTS:
        manifest = load_json(manifest_path, {"schemaVersion": 1, "channel": "stable", "apps": []})
        manifest["updatedAt"] = now
        manifest["generatedAt"] = now
        apps = manifest.setdefault("apps", [])
        for entry in entries.values():
            for index, app in enumerate(apps):
                if app.get("id") == entry["id"]:
                    apps[index] = {**app, **entry}
                    break
            else:
                apps.append(entry)
        save_json(manifest_path, manifest)

    changelogs = load_json(CHANGELOG, [])
    item_id = f"{now[:10]}-boardgames-harmony-offline-{args.version}"
    item = {
        "id": item_id,
        "date": now,
        "type": "fix",
        "product": "铮铮单机桌游 HarmonyOS",
        "title": f"铮铮单机桌游：HarmonyOS {args.version} 上架前修复",
        "content": f"单机版保持 {args.version}（build {args.build} / versionCode {args.version_code}）同版本重打。五子棋、围棋和中国象棋新增纯本地分析、残局训练、自建棋盘与三档 AI；围棋补齐提子、自杀禁入和基础劫，中国象棋使用独立合法走子规则。中国版飞行棋素材完成逐图复核。单机版不声明网络权限，HAP 与 APP Pack 内层包均通过发布签名校验并同步 latest 清单。",
    }
    if isinstance(changelogs, list):
        changelogs = [item] + [log for log in changelogs if log.get("id") != item_id]
        save_json(CHANGELOG, changelogs)
        save_json(PUBLIC_CHANGELOG, changelogs)

    for artifact, entry in entries.items():
        print(f"Published {artifact.upper()}: {entry['fileName']} ({entry['sha256']})")


if __name__ == "__main__":
    main()
