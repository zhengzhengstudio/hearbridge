# 铮铮桌游中心全端人性化改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为网页、Android、iOS、macOS 和 HarmonyOS 建立统一的三入口、连续游玩流程、完整设置与深浅色主题基础。

**Architecture:** 先建立跨端一致的产品状态与界面契约，再在各平台使用原生导航实现。游戏规则继续由各游戏模块负责，外壳只消费可用状态，不再把未知游戏映射到通用五子棋棋盘。

**Tech Stack:** HTML/CSS/JavaScript、Android Java、Apple Swift/SpriteKit/AppKit/UIKit、HarmonyOS ArkTS、Node.js contract tests、Gradle、Xcode、Hvigor。

## Global Constraints

- 主导航只能是大厅、游戏、我的。
- 对局必须属于游戏流程，进入对局后隐藏主导航。
- 设置必须包含账号、游戏、外观、联机、更新、反馈和关于。
- 外观必须支持跟随系统、浅色、深色。
- 未完成规则的游戏不得进入通用棋盘。
- 网站普通前端改动必须更新 `website/zhengzhengstudio.cn/api/data` 中主站实际引用的更新日志。

---

### Task 1: 跨端产品与主题契约

**Files:**
- Create: `website/zhengzhengstudio.cn/boardgames/product-model.js`
- Create: `tests/boardgame_product_model.test.js`
- Modify: `website/zhengzhengstudio.cn/boardgames/index.html`

**Interfaces:**
- Produces: `ZZBoardgameProduct.games`, `ZZBoardgameProduct.navigation`, `ZZBoardgameProduct.themeModes`。
- Consumes: 现有游戏 URL 和 `app-bridge.js` 游戏标识。

- [ ] 写失败测试，验证导航仅含 `lobby/games/profile`、主题含 `system/light/dark`、每个游戏拥有 `availability`。
- [ ] 运行 `node --test tests/boardgame_product_model.test.js`，确认测试因模块缺失失败。
- [ ] 实现产品模型并让网页首页从模型读取游戏目录。
- [ ] 再次运行测试并确认通过。

### Task 2: 网页三入口与动态大厅

**Files:**
- Modify: `website/zhengzhengstudio.cn/boardgames/index.html`
- Modify: `website/zhengzhengstudio.cn/boardgames/boardgame-common.css`
- Test: `tests/boardgame_web_shell.test.js`

**Interfaces:**
- Consumes: `window.ZZBoardgameProduct`。
- Produces: `data-page="lobby|games|profile"` 页面状态和 `data-theme` 主题状态。

- [ ] 写失败测试，验证大厅具有继续对局、推荐位、匹配和加入房间，且设置不在弹窗中。
- [ ] 运行测试确认失败。
- [ ] 将首页重排为三入口、独立游戏详情与独立设置区域。
- [ ] 加入系统/浅色/深色语义颜色和响应式布局。
- [ ] 更新主站实际引用的统一更新日志。
- [ ] 运行网页契约测试与现有 `app-bridge.test.cjs`。

### Task 3: Android 原生外壳

**Files:**
- Modify: `MultipleBoardGamesAndroid/app/src/main/java/cn/zhengzhengstudio/boardgames/MainActivity.java`
- Test: `tests/boardgame_android_shell.test.js`

**Interfaces:**
- Produces: `lobby/games/profile/settings/game-detail/game-room` 页面状态。
- Consumes: 现有 `gameTypes`、通行证、更新、反馈和联机方法。

- [ ] 写失败测试，锁定三入口、独立设置页和非占位游戏约束。
- [ ] 运行测试确认失败。
- [ ] 将现有单页布局拆为稳定页面状态，设置迁入 `profile` 下的独立页面。
- [ ] 加入主题偏好持久化与系统主题监听。
- [ ] 让未完成游戏进入详情说明而不是通用棋盘。
- [ ] 运行 Node 契约测试和 `JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :app:compileDirectDebugJavaWithJavac`。

### Task 4: Apple 通用外壳

**Files:**
- Modify: `MultipleBoardGames/MultipleBoardGames Shared/MainMenuScene.swift`
- Modify: `MultipleBoardGames/MultipleBoardGames iOS/GameViewController.swift`
- Modify: `MultipleBoardGames/MultipleBoardGames macOS/GameViewController.swift`
- Test: `tests/boardgame_apple_shell.test.js`

**Interfaces:**
- Produces: Apple 三入口导航、游戏详情、独立设置窗口/页面和主题状态。
- Consumes: 现有通行证、更新、反馈、Touch Bar 与联机接口。

- [ ] 写失败测试，验证三入口、设置能力与对局隐藏导航。
- [ ] 运行测试确认失败。
- [ ] 重排 SpriteKit 场景状态并使用 UIKit/AppKit 原生容器承载设置。
- [ ] 修复 iOS 缺失的 `checkAppUpdates(userInitiated:)` 调用契约。
- [ ] 适配系统/浅色/深色和 iPad/macOS 分栏。
- [ ] 运行 macOS 与 iOS Simulator 的无签名构建。

### Task 5: HarmonyOS 自适应外壳

**Files:**
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmony/entry/src/main/ets/pages/Index.ets`
- Test: `tests/boardgame_harmony_shell.test.js`

**Interfaces:**
- Produces: 三入口 Navigation、独立设置、手机/平板/PC/折叠布局。
- Consumes: 现有扫码、碰一碰、通行证、反馈、更新和房间接口。

- [ ] 写失败测试，验证三入口、设置分组、主题和未完成游戏保护。
- [ ] 运行测试确认失败。
- [ ] 重排大厅、游戏库、详情与设置页面，保留碰一碰和扫码但移入加入流程。
- [ ] 加入系统主题跟随及宽屏双栏。
- [ ] 在 ASCII 临时构建路径运行 `hvigorw assembleHap --mode module --no-daemon`。

### Task 6: 跨端恢复与体验验收

**Files:**
- Modify: `tests/boardgame_win_rule_isolation.test.js`
- Create: `tests/boardgame_cross_platform_experience.test.js`

**Interfaces:**
- Consumes: 五端页面与产品模型源码。
- Produces: 跨端导航、主题、设置、规则保护和错误恢复契约。

- [ ] 写测试覆盖连接超时恢复、继续对局、错误内联提示和更新失败不退出。
- [ ] 运行测试确认现有实现未满足契约。
- [ ] 补齐各端恢复动作和稳定状态文案。
- [ ] 运行全部桌游 Node 测试、Android 编译、macOS 构建、iOS Simulator 构建和 HarmonyOS HAP 构建。
