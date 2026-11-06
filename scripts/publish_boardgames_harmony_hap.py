#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APPS_DIR = ROOT / "website" / "api" / "apps"
APP_DIRS = [
    APPS_DIR,
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps",
]
MANIFESTS = [
    APPS_DIR / "manifest.json",
    APPS_DIR / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "apps" / "client-downloads.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "apps" / "manifest.json",
    ROOT / "website" / "zhengzhengstudio.cn" / "api" / "boardgames" / "manifest.json",
]
CHANGELOG = ROOT / "website" / "api" / "data" / "changelogs.json"
PUBLIC_CHANGELOG = ROOT / "website" / "zhengzhengstudio.cn" / "api" / "changelogs.json"
APP_ID = "cn.zhengzhengstudio.boardgames.hmos"
ANDROID_APP_ID = "cn.zhengzhengstudio.boardgames"


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
    with tempfile.TemporaryDirectory(prefix="zz-hap-verify-") as work:
        result = subprocess.run(
            ["java", "-jar", str(tool), "verify-app", "-inFile", str(path),
             "-outCertChain", f"{work}/cert.cer", "-outProfile", f"{work}/profile.p7b"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, check=False,
        )
    output = f"{result.stdout}\n{result.stderr}"
    if "verify-app success" not in output.lower():
        raise SystemExit(f"HarmonyOS package signature verification failed: {path}\n{output.strip()}")


def verify_app_pack(path: Path):
    with tempfile.TemporaryDirectory(prefix="zz-app-verify-") as work:
        with zipfile.ZipFile(path) as archive:
            hap_names = [name for name in archive.namelist() if name.lower().endswith(".hap")]
            if len(hap_names) != 1:
                raise SystemExit(f"APP Pack must contain exactly one HAP: {path}")
            archive.extract(hap_names[0], work)
            verify_hap(Path(work) / hap_names[0])


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_if_different(source: Path, destination: Path):
    destination = destination.resolve()
    if source == destination:
        return
    shutil.copy2(source, destination)


def main():
    parser = argparse.ArgumentParser(description="Publish ZhengZheng BoardGames HarmonyOS HAP to the website app manifest.")
    parser.add_argument("hap", type=Path, help="Path to the HAP package to publish.")
    parser.add_argument("--app", type=Path, help="Path to the HarmonyOS APP Pack for AppGallery.")
    parser.add_argument("--version", required=True, help="Version name, for example 1.1.10.")
    parser.add_argument("--build", required=True, type=int, help="Build number shown in app update metadata.")
    parser.add_argument("--version-code", required=True, type=int, help="HarmonyOS versionCode.")
    parser.add_argument("--signed", action="store_true", help="Mark the package as installable. Unsigned packages remain download-only.")
    args = parser.parse_args()

    source = args.hap.expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"HAP not found: {source}")
    if APP_ID == ANDROID_APP_ID:
        raise SystemExit("HarmonyOS bundle id must not equal the Android package id.")
    app_source = args.app.expanduser().resolve() if args.app else None
    if app_source and not app_source.exists():
        raise SystemExit(f"APP Pack not found: {app_source}")
    if args.signed:
        verify_hap(source)
        if app_source:
            verify_app_pack(app_source)

    suffix = "signed" if args.signed else "unsigned-test"
    file_name = f"ZhengZhengBoardGames-HarmonyOS-v{args.version}-{suffix}.hap"
    latest_name = "ZhengZhengBoardGames-HarmonyOS-latest.hap" if args.signed else "ZhengZhengBoardGames-HarmonyOS-latest-unsigned.hap"
    for app_dir in APP_DIRS:
        app_dir.mkdir(parents=True, exist_ok=True)
        copy_if_different(source, app_dir / file_name)
        copy_if_different(source, app_dir / latest_name)
    target = APPS_DIR / file_name
    latest = APPS_DIR / latest_name
    app_file_name = f"ZhengZhengBoardGames-HarmonyOS-v{args.version}-{suffix}.app"
    app_latest_name = "ZhengZhengBoardGames-HarmonyOS-latest.app"
    if app_source:
        for app_dir in APP_DIRS:
            copy_if_different(app_source, app_dir / app_file_name)
            copy_if_different(app_source, app_dir / app_latest_name)

    digest = sha256(target)
    size = target.stat().st_size
    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    signed_note = "已签名，可通过 HAP 分发安装工具安装或升级。" if args.signed else "未签名调试包：只用于下载和构建验证，真机安装需要同一调试/发布签名。"
    entry = {
        "id": APP_ID,
        "name": "铮铮桌游中心",
        "platform": "harmonyos",
        "platformLabel": "HarmonyOS",
        "kind": "package",
        "version": args.version,
        "build": args.build,
        "latestBuild": args.build,
        "buildNumber": args.build,
        "versionCode": args.version_code,
        "latestVersionCode": args.version_code,
        "versionName": args.version,
        "shortVersion": args.version,
        "latestVersion": args.version,
        "minSystem": "HarmonyOS 6.0.2",
        "minimumSystem": "HarmonyOS 6.0.2",
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
        "installURL": f"/tools/hap_installer.html?app={APP_ID}",
        "pageURL": "/boardgames/",
        "size": size,
        "fileSize": size,
        "sha256": digest,
        "checksum": digest,
        "updatedAt": now,
        "category": "HarmonyOS",
        "isHap": True,
        "signed": args.signed,
        "requiresSignedHap": not args.signed,
        "distributionStatus": "release" if args.signed else "unsigned-debug",
        "bundleIdentifier": APP_ID,
        "title": f"铮铮桌游中心 HarmonyOS v{args.version} build {args.build}{'' if args.signed else '（未签名调试包）'}",
        "remarks": f"原生 HarmonyOS 桌游中心。{signed_note}",
        "notes": [
            f"{args.version}（versionCode {args.version_code}）：保持版本号完成同版本功能重打。",
            "五子棋、围棋和中国象棋加入本地分析、残局训练、自建棋盘与三档 AI，断网也可运行。",
            "围棋补齐提子、自杀禁入与基础劫；中国象棋使用独立合法走子规则，围棋不再误判五连胜。",
            "扫码只用于继续对局或接受对弈申请，统一使用带有效期的 v1 房间令牌。",
            "中国版飞行棋素材已逐图复核；HAP 与 APP Pack 内层 HAP 均通过发布签名校验。",
            signed_note,
        ],
        "links": [{"name": "HAP 分发安装", "url": f"/tools/hap_installer.html?app={APP_ID}"}],
    }
    if app_source:
        entry.update(
            {
                "appPackFileName": app_file_name,
                "appPackURL": f"/api/apps/{app_file_name}",
                "appPackLatestURL": f"/api/apps/{app_latest_name}",
                "appPackSize": app_source.stat().st_size,
                "appPackSha256": sha256(app_source),
                "storeReady": bool(args.signed),
            }
        )

    for manifest_path in MANIFESTS:
        manifest = load_json(manifest_path, {"schemaVersion": 1, "channel": "stable", "apps": []})
        manifest["updatedAt"] = now
        manifest["generatedAt"] = now
        apps = manifest.setdefault("apps", [])
        for index, app in enumerate(apps):
            if app.get("id") == APP_ID:
                apps[index] = {**app, **entry}
                break
        else:
            apps.append(entry)
        save_json(manifest_path, manifest)

    changelogs = load_json(CHANGELOG, [])
    if isinstance(changelogs, list):
        item = {
            "id": f"{now[:10]}-boardgames-harmony-hap-{args.version}",
            "date": now,
            "type": "improvement" if args.signed else "fix",
            "product": "铮铮桌游中心 HarmonyOS",
            "title": f"铮铮桌游中心：HarmonyOS HAP {args.version} 分发清单更新",
            "content": f"HarmonyOS 联机版保持 {args.version}（build {args.build} / versionCode {args.version_code}）同版本重打。五子棋、围棋和中国象棋新增纯本地分析、残局训练、自建棋盘与三档 AI；围棋补齐提子、自杀禁入和基础劫，中国象棋使用独立合法走子规则。扫码接续仅接受继续对局或对弈申请令牌。中国版飞行棋素材完成逐图复核，signed HAP 与应用市场 APP Pack 均通过发布签名校验。{signed_note}",
        }
        changelogs = [log for log in changelogs if log.get("id") != item["id"]]
        changelogs.insert(0, item)
        save_json(CHANGELOG, changelogs)
        save_json(PUBLIC_CHANGELOG, changelogs)

    print(f"Published {target.name}")
    print(f"Latest alias {latest.name}")
    print(f"SHA-256 {digest}")


if __name__ == "__main__":
    main()
