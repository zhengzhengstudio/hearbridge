# Survival Diary Native Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Survival Diary WebView release with a tested native, open-ended game on Web, Android, iOS, macOS, and HarmonyOS, then publish correctly signed artifacts and download metadata.

**Architecture:** Platform-native renderers consume one versioned content/save/protocol contract and must pass the same deterministic fixtures. Delivery is split into six independently reviewable plans so gameplay, each native client family, online services, and release publishing can be accepted without hiding incomplete platforms.

**Tech Stack:** JSON Schema, Node.js tests, Canvas/WebGL, Kotlin/Compose, SwiftUI/SpriteKit, ArkTS/ArkUI Canvas, Express/WebSocket, Gradle, SwiftPM/Xcode, Hvigor/DevEco Studio.

## Global Constraints

- Product name is `生存日记`; do not rename or repurpose `生活日记`.
- Release version is `0.3.0`; normalized release build is `3`.
- Android `versionCode` is `3`; Apple `CFBundleVersion` is `3`; HarmonyOS `versionCode` is `30000`.
- Android application ID is `cn.zhengzhengstudio.survivaldiary`.
- iOS bundle ID is `cn.zhengzhengstudio.survivaldiary.ios`.
- macOS bundle ID is `cn.zhengzhengstudio.survivaldiary.macos`.
- HarmonyOS online bundle name is `cn.zhengzhengstudio.survivaldiary.hmos`.
- HarmonyOS offline bundle name is `cn.zhengzhengstudio.survivaldiary.offline.hmos`.
- No Android WebView, WKWebView, or ArkWeb may render the game.
- New account login and first local install default to A guided mode.
- A and B share one island save and never reset progress.
- The game has no ending, day limit, or fixed map boundary.
- Gameplay assets use PNG/WebP atlases; final tools and world items do not use SVG or emoji.
- Website product changes update `website/api/data/changelogs.json` and its live mirror.
- Missing release credentials must fail closed and must never produce a `storeReady: true` claim.

---

## Plan Set and Dependency Order

1. [Shared contracts and Web game](2026-07-29-survival-diary-foundation-web.md)
2. [Online services, friends, cloud saves, and AI](2026-07-29-survival-diary-online-services.md)
3. [Android native client](2026-07-29-survival-diary-android-native.md)
4. [iOS and macOS native clients](2026-07-29-survival-diary-apple-native.md)
5. [HarmonyOS online and offline native clients](2026-07-29-survival-diary-harmony-native.md)
6. [Signing, packages, download center, store assets, and release](2026-07-29-survival-diary-release-publishing.md)

Plans 2–5 consume the v2 contracts and golden fixtures produced by Plan 1. Plans 3–5 can run in parallel after Plan 1. Plan 6 starts only after Plans 1–5 pass their platform acceptance suites.

## Cross-Plan Review Gates

- [ ] **Gate 1: Contract freeze**

Run:

```bash
node --test tests/survival_diary_contracts_v2.test.js
```

Expected: all v2 schema, deterministic weather, biome, A/B mode, placement, and migration fixtures pass.

- [ ] **Gate 2: Native proof**

Run:

```bash
node --test tests/survival_diary_native_clients.test.js
```

Expected: each native source tree exists, owns its product identity, and contains no WebView/WKWebView/ArkWeb game surface.

- [ ] **Gate 3: Cross-platform fixture parity**

Run the Node, Kotlin, Swift, and ArkTS fixture tests listed in Plans 1, 3, 4, and 5.

Expected: every platform emits the digest stored in `apps/SurvivalDiaryShared/fixtures/world-v2-seed-20260729.json`.

- [ ] **Gate 4: Release integrity**

Run:

```bash
node --test tests/survival_diary_release_v3.test.js
```

Expected: all available artifacts, hashes, signatures, manifests, client downloads, and changelog entries agree; unavailable signed artifacts remain explicitly unavailable.

- [ ] **Gate 5: Commit the roadmap**

```bash
git add docs/superpowers/plans/2026-07-29-survival-diary-*.md
git commit -m "docs: plan Survival Diary native release"
```
