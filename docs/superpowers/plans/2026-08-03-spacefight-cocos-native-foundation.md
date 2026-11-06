# SpaceFight Cocos Native Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可验证、可回退的 SpaceFight 全端 Cocos 原生基础，并先解决镜头扭头阻力、高低配策略、平台桥接和跨端构建风险。

**Architecture:** `SpaceFight-Cocos` 作为唯一游戏工程，通过纯 TypeScript 的飞行、性能和平台接口隔离 Cocos 节点与原生细节。构建工具为 Web、Android、iOS、macOS 和 HarmonyOS 生成独立输出并产出机器可读的验收证据，旧 Canvas/SpriteKit/ArkUI 战斗在新基础达标前保留。

**Tech Stack:** Cocos Creator 3.8.8, TypeScript 4.9.5, Node.js test runner, Cocos native JSB, Android Gradle/JDK 21, Xcode, DevEco/Hvigor, WebGL2, JSON build evidence.

## Global Constraints

- 保持 `0.10.0 build 18`，本计划不通过版本号跳升代替实现和验收。
- Android/iOS/macOS 包名保持 `cn.zhengzhengstudio.spacefight`。
- HarmonyOS 联机包名保持 `cn.zhengzhengstudio.spacefight.hmos`，单机包名保持 `cn.zhengzhengstudio.spacefight.hmos.offline`。
- 原生 App 不加载网站，不使用 WebView、WKWebView 或 ArkWeb。
- 单机模式不要求通行证，不请求线上仓库或玩家市场。
- 手机和平板只支持横屏全屏游玩，所有控件计入安全区。
- HarmonyOS 默认高画质。Android 默认高画质，明显低于基线时只在战斗前提供 `立即切换`、`暂时不` 和 `不再提示`。
- Web 保留明确的低配入口，低配入口不先下载高清资源。
- 镜头必须立即响应鼠标或右侧滑动；重量感只作用在机体追随、角速度、侧滑和推力。
- 使用 LauncherX JDK 21 构建 Android。
- 旧 App 只在新 Cocos 导出通过启动、输入、存储、震动、横屏和签名验收后退役。
- 每个里程碑更新 `docs/spacefight/COCOS_REFACTOR_LOG.md`，真实运行截图存入 `docs/spacefight/screenshots`。
- 修改 `website` 目录时同步更新 `website/api/data/changelogs.json`。

---

## File Structure

### New foundation files

- `SpaceFight-Cocos/assets/scripts/platform/PlatformBridge.ts`: 平台能力接口、注册和安全降级。
- `SpaceFight-Cocos/assets/scripts/platform/WebPlatformBridge.ts`: Web 存储、震动和设备信息适配。
- `SpaceFight-Cocos/assets/scripts/platform/NativePlatformBridge.ts`: 通过 `globalThis.__SPACEFIGHT_NATIVE__` 调用原生能力，缺失时显式降级。
- `SpaceFight-Cocos/assets/scripts/platform/PlatformBootstrap.ts`: 启动时选择并注册平台桥接。
- `SpaceFight-Cocos/assets/scripts/performance/GraphicsProfile.ts`: `low`/`high` 档位与可调参数。
- `SpaceFight-Cocos/assets/scripts/performance/CapabilityPolicy.ts`: Android/HarmonyOS/Web 默认档位与建议策略。
- `SpaceFight-Cocos/assets/scripts/performance/AssetBundlePolicy.ts`: 在引擎加载高清资源包前执行档位分流。
- `SpaceFight-Cocos/assets/scripts/core/FlightAttitude.ts`: 视线航向与机体航向分离的纯函数模型。
- `SpaceFight-Cocos/assets/scripts/core/AimConvergence.ts`: 相机射线、HUD 汇聚点和多枪口弹道共用的纯函数。
- `SpaceFight-Cocos/tools/create-native-migration-baseline.js`: 生成源码与已发布包的备份索引。
- `SpaceFight-Cocos/tools/build-native-target.js`: 调用 Cocos Creator 构建单个目标并写入证据 JSON。
- `SpaceFight-Cocos/tools/verify-native-foundation.js`: 验证构建输出、包名、横屏、WebView 禁止项和平台桥接标记。
- `SpaceFight-Cocos/tools/verify-web-asset-partition.js`: 启动本地构建并记录高低配两次网络请求。
- `SpaceFight-Cocos/config/build-android-foundation.json`: Android Cocos 原生导出。
- `SpaceFight-Cocos/config/build-ios-foundation.json`: iOS Cocos 原生导出。
- `SpaceFight-Cocos/config/build-mac-foundation.json`: macOS Cocos 原生导出。
- `SpaceFight-Cocos/config/build-harmony-foundation.json`: HarmonyOS 联机 Cocos 原生导出。
- `SpaceFight-Cocos/config/build-harmony-offline-foundation.json`: HarmonyOS 单机 Cocos 原生导出。
- `tests/spacefight_native_migration_baseline.test.js`: 备份索引和旧包证据。
- `tests/spacefight_platform_bridge.test.js`: 平台能力、降级和本地存储。
- `tests/spacefight_graphics_policy.test.js`: HarmonyOS/Android/Web 画质策略。
- `tests/spacefight_web_asset_partition.test.js`: 低配启动不请求高清资源包。
- `tests/spacefight_flight_attitude.test.js`: 镜头即时响应和机体惯性。
- `tests/spacefight_camera_convergence_contract.test.js`: 相机、HUD 与枪口汇聚一致性。
- `tests/spacefight_native_build_matrix.test.js`: 五个原生输出配置与验收证据。

### Existing files to modify

- `SpaceFight-Cocos/package.json`: 增加基线、平台、性能、飞行和原生构建命令。
- `SpaceFight-Cocos/assets/scripts/core/FlightCommand.ts`: 增加视线输入语义，保持网络可序列化。
- `SpaceFight-Cocos/assets/scripts/core/FlightTuning.ts`: 将视线速率、机体角加速度和最大角速度分开。
- `SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts`: 独立更新视线姿态和机体姿态。
- `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`: 相机使用视线姿态，飞船使用机体姿态，启动平台与画质策略。
- `SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts`: 按机体姿态渲染，不将相机的即时转动强行套给模型。
- `SpaceFight-Cocos/assets/scripts/input/DesktopFlightInput.ts`: 输出无额外平滑的鼠标视线命令。
- `SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts`: 输出低死区右侧相对滑动命令。
- `SpaceFight-Cocos/assets/resources/models/ships`: 仅保留低配启动所需的简化机体资源。
- `SpaceFight-Cocos/assets/spacefight-high`: 新建可选高清 Asset Bundle，承载高清机体和后续高清材质。
- `SpaceFight-Cocos/build-templates/web-desktop/index.ejs`: 增加高画质与低配进入选择。
- `SpaceFight-Cocos/build-templates/web-mobile/index.ejs`: 增加高画质与低配进入选择。
- `SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.js`: 在 Cocos 启动前写入 Web 画质选择。
- `SpaceFight-Cocos/build-templates/web-mobile/spacefight-shell.js`: 与桌面外壳使用同一画质存储键。
- `website/api/data/changelogs.json`: 记录低配入口和统一原生基础。
- `docs/spacefight/COCOS_REFACTOR_LOG.md`: 记录备份、输出矩阵、测试、实际构建、失败原因和截图。

---

### Task 1: Freeze the old applications and release evidence

**Files:**
- Create: `SpaceFight-Cocos/tools/create-native-migration-baseline.js`
- Create: `tests/spacefight_native_migration_baseline.test.js`
- Create at runtime: `docs/spacefight/baselines/2026-08-03/native-foundation.json`
- Modify: `SpaceFight-Cocos/package.json`

**Interfaces:**
- Produces: `createBaseline({ root, outputPath, now }): BaselineManifest`
- Produces: `BaselineManifest.artifacts[]` with `platform`, `path`, `size`, `sha256`
- Produces: an external archive under `/Users/ljg/Downloads/SpaceFight-native-foundation-before-<timestamp>.tar.gz`

- [ ] **Step 1: Write the failing baseline test**

```js
test('baseline records every current release artifact without copying signing secrets', () => {
  const manifest = createBaseline({ root: fixtureRoot, outputPath, now: fixedNow });
  assert.deepEqual(manifest.identity, { version: '0.10.0', build: 18 });
  assert.deepEqual(manifest.artifacts.map((item) => item.platform), [
    'android', 'ios', 'macos', 'harmonyos', 'harmonyos-offline-hap', 'harmonyos-offline-app',
  ]);
  assert.ok(manifest.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.equal(JSON.stringify(manifest).includes('KEY_PWD'), false);
});
```

- [ ] **Step 2: Run the baseline test and verify it fails**

Run: `node --test tests/spacefight_native_migration_baseline.test.js`

Expected: FAIL because `create-native-migration-baseline.js` does not exist.

- [ ] **Step 3: Implement the baseline manifest and external archive**

```js
function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function artifact(platform, filePath, root) {
  const stat = statSync(filePath);
  return {
    platform,
    path: relative(root, filePath),
    size: stat.size,
    sha256: sha256(filePath),
  };
}
```

Archive only source directories and published application files. Exclude `.git`, `build`, `library`, `temp`, `.preview`, `node_modules`, `website/api/data/harmony-signing` and every `signing.env`, `.p12`, `.cer`, `.p7b` file. Record signing material presence as booleans, never file content or passwords.

- [ ] **Step 4: Add and run the baseline command**

Add to `SpaceFight-Cocos/package.json`:

```json
"baseline:native": "node tools/create-native-migration-baseline.js"
```

Run: `cd SpaceFight-Cocos && npm run baseline:native`

Expected: manifest JSON exists, archive exists in Downloads, and all six current published artifacts have hashes.

- [ ] **Step 5: Re-run the test and commit**

Run: `node --test tests/spacefight_native_migration_baseline.test.js`

```bash
git add SpaceFight-Cocos/tools/create-native-migration-baseline.js SpaceFight-Cocos/package.json tests/spacefight_native_migration_baseline.test.js docs/spacefight/baselines/2026-08-03/native-foundation.json
git commit -m "chore(spacefight): freeze native migration baseline"
```

### Task 2: Capture honest pre-migration runtime evidence

**Files:**
- Create: `SpaceFight-Cocos/tools/capture-native-baselines.js`
- Create: `tests/spacefight_native_capture_contract.test.js`
- Create at runtime: `docs/spacefight/baselines/2026-08-03/runtime-capture.json`
- Create at runtime: `docs/spacefight/screenshots/2026-08-03-legacy-<platform>-launch.png`
- Create at runtime: `docs/spacefight/screenshots/2026-08-03-legacy-<platform>-combat.png`

**Interfaces:**
- Produces: `captureCommands()` with adapters for `macos`, `android`, `ios`, `harmonyos`
- Produces: `CaptureResult { platform, status, command, screenshots, reason }`

- [ ] **Step 1: Write the capture contract test**

```js
test('runtime capture never reports success without a real PNG', () => {
  const result = finalizeCapture({ platform: 'android', exitCode: 0, files: [] });
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /screenshot/i);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/spacefight_native_capture_contract.test.js`

Expected: FAIL because the capture tool is absent.

- [ ] **Step 3: Implement platform capture adapters**

Use these concrete commands when a target is connected:

```js
const commands = {
  android: ['adb', ['exec-out', 'screencap', '-p']],
  ios: ['xcrun', ['simctl', 'io', 'booted', 'screenshot', '{outputPath}']],
  harmonyos: ['hdc', ['shell', 'snapshot_display']],
  macos: ['/usr/sbin/screencapture', ['-x', '{outputPath}']],
};
```

The adapter replaces `{outputPath}` with the absolute destination. Android and HarmonyOS stdout is written directly to that destination. The tool must write `status: "unavailable"` with the exact missing executable/device reason when a real runtime cannot be launched. It must not substitute source previews, promotional images or generated concepts for application screenshots.

- [ ] **Step 4: Capture every available legacy target**

Run: `node SpaceFight-Cocos/tools/capture-native-baselines.js`

Expected: macOS launch and combat PNGs exist. Connected Android/iOS/HarmonyOS targets also produce PNGs; unavailable targets are explicitly recorded.

- [ ] **Step 5: Verify PNG signatures and commit**

Run: `node --test tests/spacefight_native_capture_contract.test.js`

```bash
git add SpaceFight-Cocos/tools/capture-native-baselines.js tests/spacefight_native_capture_contract.test.js docs/spacefight/baselines/2026-08-03/runtime-capture.json docs/spacefight/screenshots/2026-08-03-legacy-*.png
git commit -m "docs(spacefight): capture legacy native baselines"
```

### Task 3: Define and validate the five-target Cocos build matrix

**Files:**
- Create: `SpaceFight-Cocos/config/build-android-foundation.json`
- Create: `SpaceFight-Cocos/config/build-ios-foundation.json`
- Create: `SpaceFight-Cocos/config/build-mac-foundation.json`
- Create: `SpaceFight-Cocos/config/build-harmony-foundation.json`
- Create: `SpaceFight-Cocos/config/build-harmony-offline-foundation.json`
- Create: `SpaceFight-Cocos/tools/native-targets.js`
- Create: `tests/spacefight_native_build_matrix.test.js`
- Modify: `SpaceFight-Cocos/tools/check-toolchain.js`

**Interfaces:**
- Produces: `NATIVE_TARGETS: Record<TargetId, NativeTarget>`
- Produces: `NativeTarget { platform, configPath, outputName, packageName, offline }`
- Consumes: Cocos Creator executable from `COCOS_CREATOR_BIN` or the installed 3.8.8 path

- [ ] **Step 1: Write the failing matrix test**

```js
test('native matrix preserves every package identity', () => {
  assert.deepEqual(Object.keys(NATIVE_TARGETS), [
    'android', 'ios', 'mac', 'harmonyos', 'harmonyos-offline',
  ]);
  assert.equal(NATIVE_TARGETS.android.packageName, 'cn.zhengzhengstudio.spacefight');
  assert.equal(NATIVE_TARGETS.harmonyos.packageName, 'cn.zhengzhengstudio.spacefight.hmos');
  assert.equal(NATIVE_TARGETS['harmonyos-offline'].packageName, 'cn.zhengzhengstudio.spacefight.hmos.offline');
});
```

- [ ] **Step 2: Run the matrix test and verify it fails**

Run: `node --test tests/spacefight_native_build_matrix.test.js`

Expected: FAIL because `native-targets.js` and native build configs do not exist.

- [ ] **Step 3: Implement the target registry**

```js
function target(id, platform, packageName, offline) {
  return Object.freeze({
    id,
    platform,
    configPath: `config/build-${id}-foundation.json`,
    outputName: `spacefight-${id}`,
    packageName,
    offline,
  });
}

const NATIVE_TARGETS = Object.freeze({
  android: target('android', 'android', 'cn.zhengzhengstudio.spacefight', false),
  ios: target('ios', 'ios', 'cn.zhengzhengstudio.spacefight', false),
  mac: target('mac', 'mac', 'cn.zhengzhengstudio.spacefight', false),
  harmonyos: target('harmonyos', 'harmonyos-next', 'cn.zhengzhengstudio.spacefight.hmos', false),
  'harmonyos-offline': target('harmonyos-offline', 'harmonyos-next', 'cn.zhengzhengstudio.spacefight.hmos.offline', true),
});
```

Each build config must set `debug: false`, `buildPath: "project://native-build"`, the Combat scene UUID, package name, landscape orientation and a unique `outputName`.

- [ ] **Step 4: Extend toolchain output with target-specific readiness**

Return this stable shape from `check-toolchain.js`:

```js
nativeTargets: {
  android: { ready: Boolean(jdk21), packageName: 'cn.zhengzhengstudio.spacefight' },
  ios: { ready: Boolean(xcodeVersion), packageName: 'cn.zhengzhengstudio.spacefight' },
  mac: { ready: Boolean(xcodeVersion), packageName: 'cn.zhengzhengstudio.spacefight' },
  harmonyos: { ready: devecoReady, packageName: 'cn.zhengzhengstudio.spacefight.hmos' },
  harmonyosOffline: { ready: devecoReady && offlineSigningReady, packageName: 'cn.zhengzhengstudio.spacefight.hmos.offline' },
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/spacefight_native_build_matrix.test.js tests/spacefight_cocos_toolchain.test.js`

```bash
git add SpaceFight-Cocos/config SpaceFight-Cocos/tools/native-targets.js SpaceFight-Cocos/tools/check-toolchain.js tests/spacefight_native_build_matrix.test.js tests/spacefight_cocos_toolchain.test.js
git commit -m "build(spacefight): define Cocos native target matrix"
```

### Task 4: Add a platform bridge that never opens the website

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/platform/PlatformBridge.ts`
- Create: `SpaceFight-Cocos/assets/scripts/platform/WebPlatformBridge.ts`
- Create: `SpaceFight-Cocos/assets/scripts/platform/NativePlatformBridge.ts`
- Create: `SpaceFight-Cocos/assets/scripts/platform/PlatformBootstrap.ts`
- Create: `tests/spacefight_platform_bridge.test.js`
- Modify: `SpaceFight-Cocos/tools/run-input-tests.js`
- Modify: `SpaceFight-Cocos/package.json`

**Interfaces:**
- Produces: `PlatformBridge`
- Produces: `registerPlatformBridge(bridge: PlatformBridge): void`
- Produces: `platformBridge(): PlatformBridge`
- Consumes native global: `globalThis.__SPACEFIGHT_NATIVE__: NativeHost | undefined`

- [ ] **Step 1: Write the failing bridge tests**

```js
test('offline bridge exposes storage and haptics without auth or web navigation', async () => {
  const bridge = new NativePlatformBridge(fakeHost, { offline: true });
  await bridge.writeText('graphics.profile', 'high');
  assert.equal(await bridge.readText('graphics.profile'), 'high');
  assert.equal(bridge.capabilities.auth, false);
  assert.equal('openWebView' in bridge, false);
});
```

```js
test('missing native host falls back without throwing', async () => {
  const bridge = createPlatformBridge({ nativeHost: undefined, storage: memoryStorage });
  await assert.doesNotReject(() => bridge.haptic('impact-medium'));
});
```

- [ ] **Step 2: Run the bridge tests and verify they fail**

Run: `node --test tests/spacefight_platform_bridge.test.js`

Expected: FAIL because the platform modules do not exist.

- [ ] **Step 3: Define the exact bridge contract**

```ts
export type HapticEvent =
  | 'ui-light'
  | 'lock-confirm'
  | 'weapon-light'
  | 'weapon-heavy'
  | 'impact-medium'
  | 'shield-break';

export interface PlatformBridge {
  readonly platform: 'web' | 'android' | 'ios' | 'macos' | 'harmonyos';
  readonly offline: boolean;
  readonly capabilities: { auth: boolean; updates: boolean; haptics: boolean };
  readText(key: string): Promise<string | null>;
  writeText(key: string, value: string): Promise<void>;
  haptic(event: HapticEvent): Promise<void>;
  deviceSnapshot(): Promise<DeviceSnapshot>;
}

export interface DeviceSnapshot {
  readonly memoryGB: number | null;
  readonly logicalCores: number | null;
  readonly gpuRenderer: string | null;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pixelRatio: number;
}
```

Do not include a URL opener or WebView method. Authentication and update methods enter the bridge only in the later online-shell plan.

- [ ] **Step 4: Implement web and native adapters**

The native host contract is JSON-safe:

```ts
export interface NativeHost {
  invoke(method: 'readText' | 'writeText' | 'haptic' | 'deviceSnapshot', payload: string): string | Promise<string>;
}
```

Every host response is parsed in one place. Invalid JSON returns a typed fallback and writes one diagnostic event; it must not crash the scene.

- [ ] **Step 5: Compile with TypeScript 4.9.5, run tests and commit**

Add platform files to the compiler input in `run-input-tests.js` and add:

```json
"test:platform": "node tools/run-input-tests.js && node --test ../tests/spacefight_platform_bridge.test.js"
```

Run: `cd SpaceFight-Cocos && npm run test:platform`

```bash
git add SpaceFight-Cocos/assets/scripts/platform SpaceFight-Cocos/tools/run-input-tests.js SpaceFight-Cocos/package.json tests/spacefight_platform_bridge.test.js
git commit -m "feat(spacefight): add native platform bridge"
```

### Task 5: Implement graphics profiles and Android low-spec advice

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/performance/GraphicsProfile.ts`
- Create: `SpaceFight-Cocos/assets/scripts/performance/CapabilityPolicy.ts`
- Create: `tests/spacefight_graphics_policy.test.js`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`
- Modify: `SpaceFight-Cocos/package.json`

**Interfaces:**
- Produces: `GraphicsTier = 'low' | 'high'`
- Produces: `resolveGraphicsDecision(input: CapabilityInput): GraphicsDecision`
- Produces: `GraphicsDecision { tier, prompt, reason, persistPromptSuppression }`

```ts
export interface CapabilityInput {
  readonly platform: 'web' | 'android' | 'ios' | 'macos' | 'harmonyos';
  readonly memoryGB: number | null;
  readonly benchmarkFrameMs: number | null;
  readonly promptPreference?: 'ask' | 'never';
  readonly requestedTier?: GraphicsTier;
}

export interface GraphicsDecision {
  readonly tier: GraphicsTier;
  readonly prompt: boolean;
  readonly reason: 'user-selected' | 'harmony-default-high' | 'android-below-baseline' | 'platform-default-high';
  readonly persistPromptSuppression: boolean;
}
```

- [ ] **Step 1: Write the failing policy tests**

```js
test('HarmonyOS always starts high without an automatic downgrade prompt', () => {
  assert.deepEqual(resolveGraphicsDecision({ platform: 'harmonyos', memoryGB: 3, benchmarkFrameMs: 45 }), {
    tier: 'high', prompt: false, reason: 'harmony-default-high', persistPromptSuppression: false,
  });
});

test('weak Android starts high but advises before combat', () => {
  const result = resolveGraphicsDecision({ platform: 'android', memoryGB: 3, benchmarkFrameMs: 42 });
  assert.equal(result.tier, 'high');
  assert.equal(result.prompt, true);
  assert.equal(result.reason, 'android-below-baseline');
});

test('do-not-ask-again suppresses later Android advice', () => {
  const result = resolveGraphicsDecision({
    platform: 'android', memoryGB: 3, benchmarkFrameMs: 42, promptPreference: 'never',
  });
  assert.equal(result.prompt, false);
});
```

- [ ] **Step 2: Run the policy test and verify it fails**

Run: `node --test tests/spacefight_graphics_policy.test.js`

Expected: FAIL because the performance modules do not exist.

- [ ] **Step 3: Define concrete high and low profiles**

```ts
export const GRAPHICS_PROFILES = {
  low: {
    targetFps: 30,
    renderScaleMin: 0.58,
    renderScaleMax: 0.82,
    shadows: false,
    particleCapacity: 48,
    activeWorldChunks: 9,
    decorationBudget: 42,
  },
  high: {
    targetFps: 60,
    renderScaleMin: 0.82,
    renderScaleMax: 1,
    shadows: true,
    particleCapacity: 180,
    activeWorldChunks: 25,
    decorationBudget: 180,
  },
} as const;
```

- [ ] **Step 4: Apply the profile once before world creation**

`CombatBootstrap` must resolve the profile before creating particles, shadows and world chunks. It must expose `applyGraphicsTier(tier)` for settings changes and must not show any performance prompt while simulation state is `playing`.

- [ ] **Step 5: Run policy, simulation and scene tests**

Run: `node --test tests/spacefight_graphics_policy.test.js tests/spacefight_cocos_scene_contract.test.js`

Run: `cd SpaceFight-Cocos && npm run test:simulation`

- [ ] **Step 6: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/performance SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts SpaceFight-Cocos/package.json tests/spacefight_graphics_policy.test.js tests/spacefight_cocos_scene_contract.test.js
git commit -m "feat(spacefight): add cross-platform graphics policy"
```

### Task 6: Separate instant view response from weighted ship attitude

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/core/FlightAttitude.ts`
- Create: `tests/spacefight_flight_attitude.test.js`
- Modify: `SpaceFight-Cocos/assets/scripts/core/FlightCommand.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/core/FlightTuning.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts`
- Modify: `SpaceFight-Cocos/tools/run-simulation-tests.js`

**Interfaces:**
- Produces: `FlightAttitudeState { aimYaw, aimPitch, hullYaw, hullPitch, hullYawVelocity, hullPitchVelocity }`
- Produces: `stepFlightAttitude(state, command, dt, tuning): FlightAttitudeState`
- Snapshot fields: `player.aimYaw`, `player.aimPitch`, `player.yaw`, `player.pitch`

- [ ] **Step 1: Write failing attitude tests**

```js
test('view responds on the first simulation step while hull follows with weight', () => {
  const next = stepFlightAttitude(neutralAttitude(), { yaw: 0.5, pitch: -0.25 }, 1 / 60, DEFAULT_ATTITUDE_TUNING);
  assert.ok(next.aimYaw > 0.02);
  assert.ok(next.hullYaw > 0);
  assert.ok(next.hullYaw < next.aimYaw);
  assert.ok(next.aimPitch < 0);
});

test('hull keeps converging after the player stops moving the view', () => {
  const aimed = stepFlightAttitude(neutralAttitude(), { yaw: 1, pitch: 0 }, 0.1, DEFAULT_ATTITUDE_TUNING);
  const settledInput = stepFlightAttitude(aimed, { yaw: 0, pitch: 0 }, 0.1, DEFAULT_ATTITUDE_TUNING);
  assert.equal(settledInput.aimYaw, aimed.aimYaw);
  assert.ok(settledInput.hullYaw > aimed.hullYaw);
});
```

- [ ] **Step 2: Run the attitude test and verify it fails**

Run: `node --test tests/spacefight_flight_attitude.test.js`

Expected: FAIL because `FlightAttitude.ts` is absent.

- [ ] **Step 3: Implement deterministic angular pursuit**

```ts
export const DEFAULT_ATTITUDE_TUNING = {
  lookYawRate: Math.PI * 4.4,
  lookPitchRate: Math.PI * 3.2,
  hullYawAcceleration: Math.PI * 8.5,
  hullPitchAcceleration: Math.PI * 6.2,
  hullYawRateMax: Math.PI * 2.25,
  hullPitchRateMax: Math.PI * 1.45,
  maxPitch: Math.PI * 0.43,
} as const;
```

Use shortest-angle error for yaw, clamp pitch, accelerate hull angular velocity toward the aim error and integrate with fixed `dt`. Do not interpolate `aimYaw` or `aimPitch`.

- [ ] **Step 4: Integrate attitude into simulation snapshots**

`CombatSimulation` initializes a neutral attitude at spawn, updates it before movement, uses hull attitude for thrust and muzzle transforms, and serializes both aim and hull orientation. Existing `yaw` and `pitch` remain hull values for compatibility.

- [ ] **Step 5: Run attitude and deterministic simulation tests**

Add `FlightAttitude.ts` to `run-simulation-tests.js`.

Run: `node --test tests/spacefight_flight_attitude.test.js`

Run: `cd SpaceFight-Cocos && npm run test:simulation`

- [ ] **Step 6: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/core/FlightAttitude.ts SpaceFight-Cocos/assets/scripts/core/FlightCommand.ts SpaceFight-Cocos/assets/scripts/core/FlightTuning.ts SpaceFight-Cocos/assets/scripts/core/CombatSimulation.ts SpaceFight-Cocos/tools/run-simulation-tests.js tests/spacefight_flight_attitude.test.js tests/spacefight_cocos_simulation.test.js
git commit -m "feat(spacefight): separate view aim from ship attitude"
```

### Task 7: Drive camera, model and projectile convergence from the new attitude

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/core/AimConvergence.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/CombatBootstrap.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/game/ProjectilePresenter.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/input/DesktopFlightInput.ts`
- Modify: `SpaceFight-Cocos/assets/scripts/input/TouchFlightInput.ts`
- Modify: `tests/spacefight_cocos_input.test.js`
- Create: `tests/spacefight_camera_convergence_contract.test.js`

**Interfaces:**
- Consumes snapshot: `player.aimYaw`, `player.aimPitch`, `player.yaw`, `player.pitch`
- Produces: `computeAimRay(player: AimAttitude): RayLike`
- Produces: `computeConvergencePoint(aimRay: RayLike, distance: number): Vec3Like`
- Produces: `computeMuzzleDirection(muzzlePosition: Vec3Like, convergencePoint: Vec3Like): Vec3Like`

- [ ] **Step 1: Write failing camera and convergence tests**

```js
test('camera direction uses aim attitude and ship model uses hull attitude', () => {
  const snapshot = playerSnapshot({ aimYaw: 0.8, aimPitch: 0.2, yaw: 0.3, pitch: 0.05 });
  assert.deepEqual(cameraAngles(snapshot), { yaw: 0.8, pitch: 0.2 });
  assert.deepEqual(shipAngles(snapshot), { yaw: 0.3, pitch: 0.05 });
});

test('both muzzles converge on the visible aim ray', () => {
  const point = computeConvergencePoint(forwardRay(), 120);
  assert.deepEqual(point, { x: 0, y: 0, z: -120 });
  assert.deepEqual(computeMuzzleDirection({ x: -1, y: 0, z: 0 }, point), normalized({ x: 1, y: 0, z: -120 }));
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/spacefight_camera_convergence_contract.test.js`

Expected: FAIL because aim helpers do not exist.

- [ ] **Step 3: Update desktop and touch look input**

Desktop pointer deltas and touch relative deltas must pass through sensitivity and clamping only. Remove temporal smoothing from the view path. Keep `0.04` touch deadzone for movement; right-side look has no radial joystick deadzone because it is relative motion.

- [ ] **Step 4: Update camera and ship presentation**

Camera orientation reads aim attitude on the same frame. Chase camera position may use a critically damped positional follow with a maximum 90 ms half-life; camera rotation cannot use that positional filter. `ShipPresenter` reads hull attitude and adds visual roll without changing simulation aim.

- [ ] **Step 5: Use convergence point for projectile direction**

Primary and secondary projectiles spawn from named muzzle nodes. Their direction comes from `computeMuzzleDirection(muzzleWorldPosition, convergencePoint)`. HUD convergence uses the same `computeConvergencePoint` result and distance as projectile spawning.

- [ ] **Step 6: Run input, simulation and convergence tests**

Run: `cd SpaceFight-Cocos && npm run test:input && npm run test:simulation`

Run: `node --test tests/spacefight_camera_convergence_contract.test.js tests/spacefight_control_latency.test.js`

- [ ] **Step 7: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/core/AimConvergence.ts SpaceFight-Cocos/assets/scripts/game SpaceFight-Cocos/assets/scripts/input tests/spacefight_cocos_input.test.js tests/spacefight_camera_convergence_contract.test.js tests/spacefight_control_latency.test.js
git commit -m "fix(spacefight): make aiming immediate and projectile-authentic"
```

### Task 8: Add the Web low-spec entry before engine loading

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/performance/AssetBundlePolicy.ts`
- Create: `SpaceFight-Cocos/assets/spacefight-high.meta`
- Create: `SpaceFight-Cocos/tools/verify-web-asset-partition.js`
- Create: `tests/spacefight_web_asset_partition.test.js`
- Move: high-resolution ship assets from `SpaceFight-Cocos/assets/resources/models/ships` to `SpaceFight-Cocos/assets/spacefight-high/models/ships`
- Create: low-detail launch ship assets under `SpaceFight-Cocos/assets/resources/models-low/ships`
- Modify: `SpaceFight-Cocos/build-templates/web-desktop/index.ejs`
- Modify: `SpaceFight-Cocos/build-templates/web-mobile/index.ejs`
- Modify: `SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.js`
- Modify: `SpaceFight-Cocos/build-templates/web-mobile/spacefight-shell.js`
- Modify: `SpaceFight-Cocos/build-templates/web-desktop/spacefight-shell.css`
- Modify: `SpaceFight-Cocos/build-templates/web-mobile/spacefight-shell.css`
- Modify: `tests/spacefight_web_shell_responsive.test.js`
- Modify: `website/api/data/changelogs.json`

**Interfaces:**
- Storage key: `spacefight.graphics.v1`
- DOM event: `spacefight:graphics-tier` with `{ detail: { tier: 'low' | 'high' } }`
- Body attribute: `data-graphics-tier="low|high"`
- Automation query: `?graphics=low|high` uses the same selection path as the visible control
- Optional Cocos bundle: `spacefight-high`
- Produces: `selectAssetBundles(tier: GraphicsTier): readonly ('resources' | 'spacefight-high')[]`

- [ ] **Step 1: Add failing Web shell tests**

```js
assert.match(desktopHtml, /data-graphics-choice="low"/);
assert.match(mobileHtml, /data-graphics-choice="low"/);
assert.match(shellSource, /spacefight\.graphics\.v1/);
assert.match(shellSource, /spacefight:graphics-tier/);

assert.deepEqual(selectAssetBundles('low'), ['resources']);
assert.deepEqual(selectAssetBundles('high'), ['resources', 'spacefight-high']);
```

- [ ] **Step 2: Run and verify the Web test fails**

Run: `node --test tests/spacefight_web_shell_responsive.test.js`

- [ ] **Step 3: Implement high-quality and low-spec choices**

Add a compact segmented control beside the launch action. `low` must be labeled `低配模式`; `high` must be labeled `高画质`. The selected tier is written before the Cocos application script starts. Do not add a marketing explanation panel.

Move the current 1.9-3.4 MB ship GLBs into the optional `spacefight-high` Asset Bundle. Add genuinely reduced launch/combat models to `resources/models-low/ships`, update `ShipPresenter` to resolve low paths immediately and load `spacefight-high` only after `selectAssetBundles('high')` permits it. Do not rename a copy of the same GLB as a low asset.

- [ ] **Step 4: Keep both choices inside narrow landscape safe areas**

At `667x375`, the control, launch button and task title must fit without horizontal overflow. Use a fixed control height and `max-inline-size: 100%`; do not use viewport-scaled font sizes.

- [ ] **Step 5: Update the website changelog and run tests**

Add one SpaceFight entry describing the pre-engine low-spec entry, immediate aim response and unchanged `0.10.0 build 18` identity.

Run: `node --test tests/spacefight_web_shell_responsive.test.js tests/spacefight_cocos_fullscreen_contract.test.js`

Run: `node --test tests/spacefight_web_asset_partition.test.js`

After the release build, `verify-web-asset-partition.js` starts the build on an ephemeral localhost port, launches the installed Chrome in headless mode with a DevTools network log, visits `?graphics=low` and `?graphics=high`, and writes `SpaceFight-Cocos/build-evidence/web-asset-partition.json`. The low run must contain no URL with `/spacefight-high/`; the high run must request the bundle after launch.

Run: `node SpaceFight-Cocos/tools/verify-web-asset-partition.js`

Run: `node -e "JSON.parse(require('fs').readFileSync('website/api/data/changelogs.json','utf8'))"`

- [ ] **Step 6: Build, capture and commit**

Run: `cd SpaceFight-Cocos && npm run build:web:release && npm run publish:web:release`

Capture desktop `1440x900`, mobile `844x390` and narrow mobile `667x375` launch and combat states into `docs/spacefight/screenshots`.

```bash
git add SpaceFight-Cocos/assets/resources SpaceFight-Cocos/assets/spacefight-high SpaceFight-Cocos/assets/scripts/performance/AssetBundlePolicy.ts SpaceFight-Cocos/assets/scripts/game/ShipPresenter.ts SpaceFight-Cocos/build-templates SpaceFight-Cocos/tools/verify-web-asset-partition.js tests/spacefight_web_shell_responsive.test.js tests/spacefight_web_asset_partition.test.js website/api/data/changelogs.json docs/spacefight/screenshots
git commit -m "feat(spacefight): add preflight low-spec entry"
```

### Task 9: Build and verify each Cocos native foundation target

**Files:**
- Create: `SpaceFight-Cocos/tools/build-native-target.js`
- Create: `SpaceFight-Cocos/tools/verify-native-foundation.js`
- Create at runtime: `SpaceFight-Cocos/native-build/evidence/<target>.json`
- Modify: `SpaceFight-Cocos/package.json`
- Modify: `tests/spacefight_native_build_matrix.test.js`

**Interfaces:**
- CLI: `node tools/build-native-target.js <target>`
- CLI targets: `android`, `ios`, `mac`, `harmonyos`, `harmonyos-offline`
- Evidence: `{ target, packageName, creatorVersion, commandExit, generatedProject, files, verification }`

- [ ] **Step 1: Add failing build evidence tests**

```js
test('successful evidence requires a generated native project and package identity', () => {
  assert.throws(() => validateEvidence({ target: 'android', commandExit: 0, files: [] }), /generated project/);
});

test('offline Harmony evidence rejects the online package name', () => {
  assert.throws(() => validateEvidence({
    target: 'harmonyos-offline', commandExit: 0,
    packageName: 'cn.zhengzhengstudio.spacefight.hmos', files: ['build-profile.json5'],
  }), /package/i);
});
```

- [ ] **Step 2: Run and verify the matrix tests fail**

Run: `node --test tests/spacefight_native_build_matrix.test.js`

- [ ] **Step 3: Implement one-target Cocos builds**

Use the same exit rule as the Web builder: Cocos exit `0` and documented success exit `36` are accepted. Delete only the selected target output before building. Never delete the old native App projects.

```js
const result = spawnSync(creator, [
  '--project', projectRoot,
  '--build', `configPath=${target.configPath}`,
], { cwd: projectRoot, stdio: 'inherit' });
```

- [ ] **Step 4: Add package scripts**

```json
"build:native:android": "node tools/build-native-target.js android",
"build:native:ios": "node tools/build-native-target.js ios",
"build:native:mac": "node tools/build-native-target.js mac",
"build:native:harmony": "node tools/build-native-target.js harmonyos",
"build:native:harmony-offline": "node tools/build-native-target.js harmonyos-offline",
"verify:native": "node tools/verify-native-foundation.js"
```

- [ ] **Step 5: Run Android export and Gradle smoke build**

Run: `cd SpaceFight-Cocos && npm run build:native:android`

Use the JDK path reported by `npm run check:toolchain`. Run the generated Gradle wrapper `assembleDebug`. Expected: installable debug APK with package `cn.zhengzhengstudio.spacefight`, no WebView component/node in the Cocos scene, and no native shell code that navigates to a website. Engine-owned classes that are bundled but never instantiated do not fail this check.

- [ ] **Step 6: Run iOS and macOS export smoke builds**

Run: `cd SpaceFight-Cocos && npm run build:native:ios && npm run build:native:mac`

Run `xcodebuild` against the generated schemes. iOS must compile for an available simulator or device destination; macOS must produce a launchable `.app` with bundle identifier `cn.zhengzhengstudio.spacefight`.

- [ ] **Step 7: Run HarmonyOS online and offline export smoke builds**

Run: `cd SpaceFight-Cocos && npm run build:native:harmony && npm run build:native:harmony-offline`

Use DevEco/Hvigor to compile HAPs. Verify package names separately. Sign the offline HAP/APP only with the existing `cn.zhengzhengstudio.spacefight.hmos.offline` profile. Keep online output explicitly unsigned until a matching online profile exists.

- [ ] **Step 8: Verify all evidence and commit**

Run: `cd SpaceFight-Cocos && npm run verify:native`

Run: `node --test tests/spacefight_native_build_matrix.test.js tests/spacefight_product_contract.test.js tests/spacefight_release_contract.test.js`

```bash
git add SpaceFight-Cocos/tools/build-native-target.js SpaceFight-Cocos/tools/verify-native-foundation.js SpaceFight-Cocos/package.json tests/spacefight_native_build_matrix.test.js
git commit -m "build(spacefight): prove Cocos native foundations"
```

Do not commit generated native projects or signed packages unless their existing repository policy already tracks that exact output class. Evidence JSON records paths and hashes instead.

### Task 10: Run native bridge smoke checks and capture new baselines

**Files:**
- Create: `SpaceFight-Cocos/assets/scripts/platform/BridgeDiagnostics.ts`
- Create: `tests/spacefight_native_bridge_diagnostics.test.js`
- Create at runtime: `docs/spacefight/baselines/2026-08-03/cocos-native-foundation.json`
- Create at runtime: `docs/spacefight/screenshots/2026-08-03-cocos-<platform>-launch.png`
- Create at runtime: `docs/spacefight/screenshots/2026-08-03-cocos-<platform>-combat.png`
- Modify: `docs/spacefight/COCOS_REFACTOR_LOG.md`

**Interfaces:**
- Produces: `BridgeDiagnostic { platform, storage, haptics, landscape, fullscreen, offline, startupMs, passed, failures }`
- Diagnostic event: `spacefight:native-diagnostic`

- [ ] **Step 1: Write the failing diagnostic test**

```js
test('diagnostic fails closed when a required native capability is absent', async () => {
  const result = await runBridgeDiagnostic(fakeBridge({ haptics: false }), { requireHaptics: true });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['haptics']);
});
```

- [ ] **Step 2: Run and verify the diagnostic test fails**

Run: `node --test tests/spacefight_native_bridge_diagnostics.test.js`

- [ ] **Step 3: Implement diagnostics without exposing secrets**

The diagnostic writes capability booleans, package identity, orientation, viewport, process-start-to-first-interactive `startupMs` and a temporary storage round-trip. It triggers one `ui-light` haptic only after the user presses the diagnostic button. It never records account tokens, signing paths or device identifiers.

- [ ] **Step 4: Install and run available native targets**

For each available target, launch the Cocos build, enter the combat scene, exercise look input, pause, graphics settings and one haptic event, then save the diagnostic JSON and real screenshots. Unavailable hardware remains `unavailable` with a reason; it cannot be marked passed.

- [ ] **Step 5: Update the process record**

Append a dated section to `docs/spacefight/COCOS_REFACTOR_LOG.md` containing:

```markdown
### Native foundation matrix

| Platform | Export | Compile | Launch | Startup ms | Storage | Haptics | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- |
```

Fill every cell from evidence JSON. Record the exact Cocos output fingerprint and any unresolved platform issue.

- [ ] **Step 6: Run focused and full foundation tests**

Run: `cd SpaceFight-Cocos && npm run check:toolchain && npm run test:input && npm run test:simulation && npm run test:fullscreen && npm run test:platform && npm run verify:native`

Run: `node --test tests/spacefight_native_bridge_diagnostics.test.js tests/spacefight_graphics_policy.test.js tests/spacefight_flight_attitude.test.js tests/spacefight_camera_convergence_contract.test.js tests/spacefight_product_contract.test.js`

- [ ] **Step 7: Commit**

```bash
git add SpaceFight-Cocos/assets/scripts/platform/BridgeDiagnostics.ts tests/spacefight_native_bridge_diagnostics.test.js docs/spacefight/baselines/2026-08-03 docs/spacefight/screenshots/2026-08-03-cocos-*.png docs/spacefight/COCOS_REFACTOR_LOG.md
git commit -m "test(spacefight): verify Cocos native foundation"
```

### Task 11: Publish only validated artifacts and close Phase 0

**Files:**
- Modify after successful builds: `apps/build_spacefight_apps.sh`
- Modify after successful builds: `website/api/apps/manifest.json`
- Modify after successful builds: `website/api/apps/client-downloads.json`
- Modify after successful builds: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify after successful builds: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Modify: `docs/spacefight/COCOS_REFACTOR_LOG.md`
- Test: `tests/spacefight_release_contract.test.js`
- Test: `tests/spacefight_harmony_store_release.test.js`

**Interfaces:**
- Consumes: validated native build evidence from Tasks 9 and 10
- Produces: existing `manifest.json` and `client-downloads.json` schemas with updated hashes only for targets that passed

- [ ] **Step 1: Add a release guard test**

```js
test('download metadata cannot point at an unverified Cocos native artifact', () => {
  for (const app of cocosMigrationCandidates(manifest, evidenceDirectory)) {
    assert.equal(evidenceFor(app.id).launchPassed, true);
    assert.equal(evidenceFor(app.id).sha256, app.sha256);
  }
});
```

- [ ] **Step 2: Run and verify the guard fails before metadata changes**

Run: `node --test tests/spacefight_release_contract.test.js`

Expected: only metadata entries selected for Cocos replacement are rejected until evidence JSON records launch and hash verification. Untouched legacy packages remain valid and downloadable.

- [ ] **Step 3: Update the build orchestrator target by target**

Replace a legacy build function only when the matching Cocos target has `export`, `compile` and `launch` set to passed. Keep the previous function and published package for targets that remain unavailable. Do not publish a mixed package under a new version without listing exactly which targets changed.

- [ ] **Step 4: Update download metadata using artifact hashes**

Run the existing structured manifest updater. Confirm package names, mode (`offline` where applicable), signed state, size and SHA-256. Keep online HarmonyOS explicitly unsigned when the matching release profile is absent.

- [ ] **Step 5: Run release and signature checks**

Run: `node --test tests/spacefight_release_contract.test.js tests/spacefight_harmony_store_release.test.js tests/spacefight_product_contract.test.js`

Run `apksigner verify`, `codesign --verify`, `spctl` where applicable, and DevEco `verify-app` for signed HarmonyOS offline HAP/APP.

- [ ] **Step 6: Sync only after all selected targets pass**

Run: `node sync_to_termux.js --spacefight-apps`

Expected: zero failed uploads. Confirm the watcher does not upload `.git` paths and confirm the public site serves the new manifest hashes.

- [ ] **Step 7: Final screenshots, process log and commit**

Append package paths, hashes, signing results, sync totals, online URLs and final screenshots to `docs/spacefight/COCOS_REFACTOR_LOG.md` and `website/api/data/changelogs.json`.

```bash
git add apps/build_spacefight_apps.sh website/api/apps website/zhengzhengstudio.cn/api/apps website/api/data/changelogs.json docs/spacefight/COCOS_REFACTOR_LOG.md docs/spacefight/screenshots tests/spacefight_release_contract.test.js tests/spacefight_harmony_store_release.test.js
git commit -m "release(spacefight): publish validated Cocos native foundation"
```

---

## Phase 0 Completion Gate

Phase 0 is complete only when all of the following are true:

1. The pre-migration archive and artifact hashes exist outside the release directories.
2. Every available legacy platform has honest launch and combat screenshots; unavailable targets have explicit evidence.
3. Web, Android, iOS, macOS, HarmonyOS online and HarmonyOS offline have separate Cocos build identities.
4. Android, iOS, macOS and at least one HarmonyOS target compile from the Cocos project. A target without launch evidence remains unvalidated.
5. Camera aim responds on the first input step while hull attitude follows with bounded physical inertia.
6. Camera ray, muzzle convergence, projectile direction and visible HUD marker share one calculation.
7. HarmonyOS defaults to high graphics. Weak Android devices receive the approved three-choice advice only before combat.
8. Web exposes a pre-engine low-spec entry at desktop and `667x375` mobile landscape sizes; its request log never downloads the optional `spacefight-high` bundle.
9. Native storage and user-triggered haptics pass diagnostics without WebView or website loading.
10. Every launched native target records process-start-to-first-interactive startup time; missing measurements fail that target's validation.
11. Process documentation contains test totals, build outputs, unresolved targets and real screenshots.
12. No download-center package is replaced unless its hash, launch, package identity and signature state match the evidence record.

After this gate passes, write a separate implementation plan for Phase 1: the first open zone, landing/docking, first-person combat, loot, extraction, presets and ship customization.
