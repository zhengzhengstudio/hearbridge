# SpaceFight 0.8.0 Cross-Platform Visual Design

## Objective

Raise the web, Android, iOS, macOS, and HarmonyOS editions to one coherent game-quality presentation. The target is 70% tactical science fiction and 30% cinematic space opera: precise and readable during combat, dramatic in ship presentation, lighting, motion, and effects.

The native apps remain native. They must not load the website, embed its HTML, or use WebView, WKWebView, or ArkWeb. Passport login and update checks may call JSON APIs directly. Offline combat is the default path and runs entirely on-device at 60 Hz.

## Product Language

- Package identifier: `cn.zhengzhengstudio.spacefight`.
- Release target: `0.8.0`, build `10`.
- Palette: near-black neutral space, cold white data, a single amber action accent, and restrained cyan only for shields or navigation telemetry.
- Shape system: 0-4 px tactical corners; circles are reserved for reticles, radar, joysticks, and radial weapon controls.
- Typography: condensed display treatment for the title and mission names; monospaced tabular numerals for combat data; readable platform-native Chinese UI text elsewhere.
- Icons: web uses the local SVG set. Android uses vector drawables, Apple uses SF Symbols or bundled vector artwork, and HarmonyOS uses SymbolGlyph or bundled media. App icons remain in each platform's required raster/adaptive formats.

## Shared Experience

### Flight Deck

The first screen is the game, not a settings dashboard. A full-bleed battlefield and a large inspectable ship establish the product immediately. Mission selection forms a compact vertical rail. The selected mission shows its objective, expected pressure, and local 60 Hz status without explanatory marketing copy.

Account, passport, update, and download actions live in a restrained utility area. They never cover the ship or compete with the launch action. Mobile layouts use icon controls with accessible names.

### Combat HUD

The center remains visually clear. Reticle, target direction, threat warning, and hit confirmation are the only central overlays. Health, shield, and energy anchor to one edge; score, wave, and objective anchor to the opposite edge. Weapons form a compact bottom rail on desktop and a thumb-reachable radial or short rail control on touch devices.

The HUD uses no decorative cards. Information is grouped with alignment, thin rules, small backing plates, and consistent numeric widths. Account and download controls disappear during combat.

### Cinematic Layer

Ship scale, engine bloom, directional light, damage flashes, impact sparks, projectile trails, and short camera response provide the cinematic portion. Effects must preserve target readability and must not cover touch controls. Enemy silhouettes remain distinct at gameplay scale.

## Native Boundaries

- Android: native Activity/View and Canvas rendering; no WebView. Bundle battlefield, ships, and vector UI assets in the APK.
- iOS: native UIKit/SpriteKit; no WKWebView. Controls respect safe areas and touch reach.
- macOS: native AppKit/SpriteKit; no WKWebView. Keyboard and pointer states are first-class.
- HarmonyOS: native ArkUI/Canvas; no ArkWeb. Bundle all game visuals in the HAP.
- Web: Three.js for capable desktop GPUs and optimized rendered sprites for constrained devices.

The four apps may use the passport JSON endpoint and app manifest endpoint. Offline missions do not open a WebSocket. Any future public co-op entry remains secondary and clearly marked as online.

## Screens And States

Each platform must provide: loading, flight deck, offline mission selection, active combat, pause, game over, profile, native passport login, update available, update failure, and offline/no-network states. No action may silently open a website.

## Delivery

Build Android APK, iOS IPA, macOS app archive, and HarmonyOS HAP. Copy versioned and latest packages into both app distribution directories, update `manifest.json` and `client-downloads.json`, and add a public changelog entry. Version checks only prompt when the manifest build is greater than the installed build.

## Acceptance Criteria

- All five editions visibly belong to the same game without sharing web UI code inside native apps.
- Offline combat responds immediately and does not require network access.
- No placeholder geometry, CSS-built weapon art, emoji controls, or generic dashboard cards remain in primary screens.
- Ship, enemy, projectile, and effect assets remain sharp at the tested resolutions.
- Desktop and mobile/touch layouts have no overlap, clipping, or off-screen controls.
- Native package scans contain no WebView/WKWebView/ArkWeb implementation.
- Four release packages build successfully, manifest hashes and sizes match, and download entries resolve to the new files.
