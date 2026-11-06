# SpaceFight HarmonyOS Offline Edition Design

## Goal

Ship two native HarmonyOS variants that can coexist on one device:

- Online: `cn.zhengzhengstudio.spacefight.hmos`
- Offline: `cn.zhengzhengstudio.spacefight.hmos.offline`

The existing HarmonyOS client becomes the online variant after receiving the `.hmos` suffix. A new offline project is derived from the same native Canvas game, without loading the website or sharing the online package identity.

## Product Boundary

The online variant keeps local missions, passport login, update checks, and the optional public WebSocket mode. The offline variant contains only local missions and local gameplay preferences. It has no passport login, account fields, stored account state, or authenticated profile. It must not request internet permission, create a WebSocket, call passport APIs, or fetch update metadata at runtime.

The offline launch screen labels the product as `SpaceFight Offline` and exposes only the local survival, boss, and onslaught missions. It opens directly to local mission selection without a login action. Controls, first-flight calibration, pause, vector icons, and local 60 Hz simulation stay aligned with the existing HarmonyOS experience.

## Project Structure

Keep `HarmonyOS-App/SpaceFightHarmony` as the online project. Create `HarmonyOS-App/SpaceFightHarmonyOffline` as a separately buildable native project with its own bundle name, app label, resources, and output artifact.

The offline project may initially copy the proven native game implementation to preserve independent package generation. Its network-specific source, permission declarations, login controls, and public mode are removed rather than hidden behind runtime flags.

## Release Artifacts

The builder produces separate entries and files:

- `SpaceFight-HarmonyOS-v0.8.0-unsigned.hap`
- `SpaceFight-HarmonyOS-Offline-v0.8.0-unsigned.hap`
- `SpaceFight-HarmonyOS-latest-unsigned.hap`
- `SpaceFight-HarmonyOS-Offline-latest-unsigned.hap`

The online download entry remains `spacefight-harmonyos` and uses bundle identifier `cn.zhengzhengstudio.spacefight.hmos`. The new entry is `spacefight-harmonyos-offline`, carries `variant: offline`, and uses `cn.zhengzhengstudio.spacefight.hmos.offline`.

Both artifacts and both metadata entries are synchronized to `website/api/apps` and `website/zhengzhengstudio.cn/api/apps`. Unsigned builds remain clearly marked as development packages and are never described as directly installable.

## Signing And Updates

Online and offline editions require distinct, stable HarmonyOS signing identities matching their bundle names. Signing failure must downgrade only the affected artifact to its `-unsigned` filename.

The online app keeps its update check and queries `spacefight-harmonyos`. The offline app has no runtime network access, so its version is shown locally and updates are discovered through the website download center rather than an in-app request.

## Verification

Automated contracts verify:

- both bundle names and variant labels;
- no login UI, stored passport state, internet permission, WebSocket, passport URL, or update fetch in the offline project;
- local simulation and touch controls remain present in both projects;
- both HAPs build successfully;
- manifests, client downloads, latest aliases, sizes, and SHA-256 values match in both publication roots;
- the website changelog records the new offline package and `.hmos` migration.

Runtime validation is limited to build and package inspection when no HarmonyOS device is connected. The release notes must state that limitation and the unsigned status.
