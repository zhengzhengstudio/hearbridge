# 铮铮眼镜响应式与跨端体验改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Web 配镜流程的布局漂移和底栏冲突，并让 Android、HarmonyOS 应用在手机和平板上保持稳定的信息层级。

**Architecture:** Web 通过末端单一作用域样式接管 onboarding 布局，并移除重复摄像头控件；Android 和 HarmonyOS 在现有原生页面结构上增加宽度自适应，不改账户与业务数据协议。每端独立构建验证。

**Tech Stack:** HTML/CSS/JavaScript、Android Java/CameraX/MediaPipe、HarmonyOS ArkTS/ArkUI、Gradle、Hvigor

## Global Constraints

- 全局账户继续使用铮铮通行证，不创建产品专属账户。
- Web 桌面内容最大宽度为 `1180px`，摄像头保持稳定宽高比。
- phone、tablet、2in1 都必须有可用布局。
- 不改变 HarmonyOS 包名、签名配置和后端协议。
- website 的用户界面变更必须同步更新 `website/api/data/changelogs.json`。

---

### Task 1: Web onboarding 布局与摄像头控制

**Files:**
- Modify: `website/glasses.zhengzhengstudio.cn/onboard.html`
- Modify: `website/glasses.zhengzhengstudio.cn/style.css`
- Modify: `website/api/data/changelogs.json`

**Interfaces:**
- Consumes: 现有 `startMediapipeCamera()`、`switchMediapipeCamera()`、`toggleTryonLayer()` 与 `setOnboardStep()`。
- Produces: 单一 `.camera-control-group` 工具栏结构和 `.onboard-layout-v2` 响应式作用域。

- [ ] **Step 1: 建立可失败的静态检查**

运行：

```bash
test "$(rg -o 'onclick="switchMediapipeCamera\(\)"' website/glasses.zhengzhengstudio.cn/onboard.html | wc -l | tr -d ' ')" = "1"
```

预期：当前失败，因为页面存在重复镜头切换入口。

- [ ] **Step 2: 整理摄像头工具栏 HTML**

保留一个镜头切换按钮，将摄像头、采集、显示控件分组，并让动态状态只更新 `<span id="camera-facing-label">前置</span>`，不创建独立散落文本节点。

- [ ] **Step 3: 添加末端响应式布局规则**

在 `style.css` 末端增加 `.onboard-layout-v2` 作用域：桌面五列步骤条、`1180px` 内容宽度、稳定工具栏网格；平板上下布局；手机横向步骤条与可滚动工具栏。为全站底栏预留安全区，并限制字号缩放作用域。

- [ ] **Step 4: 更新用户可见更新日志**

在 `website/api/data/changelogs.json` 增加“配镜流程响应式布局和摄像头控制稳定性优化”，保留既有 JSON 结构与排序。

- [ ] **Step 5: 运行静态验证**

```bash
test "$(rg -o 'onclick="switchMediapipeCamera\(\)"' website/glasses.zhengzhengstudio.cn/onboard.html | wc -l | tr -d ' ')" = "1"
node -e "JSON.parse(require('fs').readFileSync('website/api/data/changelogs.json','utf8'))"
```

预期：两个命令均退出码 0。

### Task 2: Android 自适应导航与配镜页

**Files:**
- Modify: `ZhengZhengStudioApp/ZhengZhengGlasses/app/src/main/java/com/zzsys/zhengzhengglasses/NativeMainActivity.java`
- Modify: `ZhengZhengStudioApp/ZhengZhengGlasses/app/src/main/java/com/zzsys/zhengzhengglasses/NativeTryOnActivity.java`

**Interfaces:**
- Consumes: 现有 `bottomNav()`、`buildNativeHome()`、CameraX 和 MediaPipe 生命周期。
- Produces: `isCompactWidth()` 宽度判断及不会挤压文字的操作栏。

- [ ] **Step 1: 检查现有固定尺寸和双列按钮**

```bash
rg -n "setOrientation|LayoutParams|bottomNav|workflowGrid|camera" ZhengZhengStudioApp/ZhengZhengGlasses/app/src/main/java/com/zzsys/zhengzhengglasses/{NativeMainActivity,NativeTryOnActivity}.java
```

预期：定位所有需要按窗口宽度调整的固定布局。

- [ ] **Step 2: 增加紧凑宽度布局策略**

在 `NativeMainActivity` 中使用当前窗口 dp 宽度决定按钮行、工作流列数和内容边距；小屏使用纵向或可滚动操作区，大屏保持双列。

- [ ] **Step 3: 稳定试戴页相机与操作栏**

在 `NativeTryOnActivity` 中让预览区域由可用高度计算，控制区允许横向滚动或分组换行，切换镜头和识别状态不改变按钮尺寸，并在退出时解绑 CameraX。

- [ ] **Step 4: 构建 Android**

```bash
./gradlew :app:assembleDebug
```

工作目录：`ZhengZhengStudioApp/ZhengZhengGlasses`

预期：`BUILD SUCCESSFUL`，生成 debug APK。

### Task 3: HarmonyOS 自适应页面骨架

**Files:**
- Modify: `HarmonyOS-App/ZhengZhengGlassesHarmony/entry/src/main/ets/pages/Index.ets`

**Interfaces:**
- Consumes: 现有 `activeTab`、`HomePage()`、`FitPage()`、`WishPage()`、`ChatPage()` 和 `MePage()`。
- Produces: 按窗口宽度切换的内容宽度、页面间距和底部导航。

- [ ] **Step 1: 检查 ArkUI 固定布局**

```bash
rg -n "\.width\(|\.height\(|\.padding\(|activeTab|Bottom|Button\(" HarmonyOS-App/ZhengZhengGlassesHarmony/entry/src/main/ets/pages/Index.ets
```

预期：列出底栏、卡片和配镜页的固定尺寸。

- [ ] **Step 2: 增加 phone、tablet、2in1 响应式约束**

使用可用窗口宽度设置内容最大宽度和边距；小屏底部导航保持单行并尊重安全区，大屏居中内容，配镜区可采用双列但不得留下无意义的半屏空白。

- [ ] **Step 3: 稳定导航和文本布局**

为底部导航项目设置相同宽度与固定字体范围，动态状态只改变颜色和内容，不改变结构；长文本在卡片内自然换行，不挤压操作按钮。

- [ ] **Step 4: 构建或校验 HarmonyOS 项目**

```bash
./hvigorw assembleHap --mode module -p product=default
```

工作目录：`HarmonyOS-App/ZhengZhengGlassesHarmony`

预期：SDK 可用时构建成功；若本机缺少 HarmonyOS SDK，记录明确缺失项并完成 JSON5/ArkTS 静态检查。

### Task 4: 跨端回归与收尾

**Files:**
- Verify only: 上述所有修改文件

**Interfaces:**
- Consumes: Task 1 至 Task 3 的可构建结果。
- Produces: 可发布前的验证结论。

- [ ] **Step 1: Web 六档视口检查**

在 `360x800`、`390x844`、`768x1024`、`1024x768`、`1440x900` 和 `2000x1200` 检查步骤条、摄像头工具栏、步骤操作栏和产品底栏，无重叠或页面横向溢出。

- [ ] **Step 2: 检查账户和流程行为未回归**

确认全局通行证参数仍保留、临时用户入口仍可用、步骤切换不会自动打开摄像头、离开摄像头步骤会停止设备。

- [ ] **Step 3: 汇总构建产物与未验证风险**

报告 Web 静态检查、Android 构建、HarmonyOS 构建结果和实际未能运行的设备测试，不宣称未执行的测试已通过。
