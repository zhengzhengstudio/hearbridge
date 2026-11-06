# 铮铮调试助手（ZhengZheng Debug Assistant）

不联网App 的完整调试闭环：**手机上浏览/编辑代码 → 一键触发 Mac 构建 → 产物回传手机安装调试**。
git 的角色由「Mac 工作区目录」替代——代码仓库就在 Mac 上，手机直接对 Mac 工作区读写。

```
ZhengZhengDebugAssistant/
├── mac-service/          Mac 侧构建服务（零依赖 Node，端口 8124，仅局域网）
│   ├── server.mjs        服务本体
│   ├── config.json       工作区/ token / 各项目构建命令
│   └── workspace/        手机端可见的项目目录（把代码放这里）
├── android/              Android 端（Kotlin，com.zzsys.debugassistant，v0.1.0 build 1）
└── ../HarmonyOS-App/DebugAssistantHarmony/   鸿蒙端（ArkTS，cn.zhengzhengstudio.debugassistant，v0.1.0 build 1）
```

## 快速开始

### 1. Mac 侧（每次开发前）

```bash
cd ZhengZhengDebugAssistant/mac-service
node server.mjs
```

- 第一次先编辑 `config.json`：`token` 换成自己的，`builds` 里给每个项目配构建命令。
- 构建命令在项目目录内用 bash 执行。示例（Android 项目）：
  ```json
  "builds": {
    "MyApp": "JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' gradle assembleDebug",
    "*": "echo 没配置构建命令"
  }
  ```
- 构建成功后服务自动在项目目录里找新产出的 `.apk/.apks/.hap/.app` 回传。
- 防火墙第一次启动会弹窗，允许「局域网传入连接」。

### 2. 手机端

- 两端 App 首页填 Mac 的局域网 IP + 端口（8124）+ token → 保存并连接。
- 点项目 → 浏览文件 → 点文件进编辑器 → 保存回推 Mac。
- 点「构建并取包」→ 等 Mac 构建完 → 产物自动下载。
  - **Android 端**：`.apk` 调起系统安装器（首次需允许「安装未知应用」）；`.apks` 走
    PackageInstaller 分包会话直装。
  - **鸿蒙端**：产物下载到应用沙箱 `cache/installs/`。三方应用**没有**静默安装 hap 的系统
    权限，用 `hdc app install <路径>` 或 DevEco 装（README 下方有取文件命令）。

## 权限与安全边界

- 服务只监听局域网，所有接口（除 ping）要求 `X-Debug-Token` 头。
- 文件读写锁定在 workspace 目录内，路径穿越（`..`、`.git`）一律拒绝（已测试）。
- 单文件限 2MB（手机编辑场景足够；大文件请在 Mac 上改）。
- token 别提交到任何公开仓库。

## 鸿蒙产物安装（取沙箱文件）

```bash
# 手机连电脑后：
hdc shell "ls /data/app/el2/100/base/cn.zhengzhengstudio.debugassistant/haps/entry/cache/installs/"
hdc file recv <沙箱里的文件> ./out.hap
hdc app install ./out.hap
```

## 关于「鸿蒙开发者官网登录拿证书」（yy 的问题）

**不是**浏览器登一下、抓个 session 就能拿证书。DevEco 自动签名的原理是：
1. 在 [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html)
   （AGC 控制台）里用华为账号开通「证书/APP ID/Profile」管理。
2. DevEco 登录账号后，后台走的是 **AGC REST API**（不是网页 session）：
   申请调试/发布证书 `.cer` → 注册设备 UDID → 生成 Profile `.p7b` → 连同本地 `.p12` 密钥
   一起写进 `build-profile.json5` 的 `signingConfigs`。
3. 想脱离 DevEco 全自动出签名包，走 AGC API 密钥方案：AGC 控制台创建
   **API Client（client_id + client_secret）**，之后 token 申请、证书创建、Profile 生成
   全部可以脚本化——这套就是给 CI 用的，比抓 session 稳定得多。
4. 注意：调试证书绑定设备 UDID，新手机要先在 AGC 注册设备；一个调试证书最多挂 100 台设备。

本工作区现状：SpaceFight offline 工程已有 Release Profile 签名材料；调试助手鸿蒙端目前
`signingConfigs: []`，出的是 unsigned 包，装真机前需要在 DevEco 里配一次自动签名（或
参照 SpaceFight 的签名材料结构）。

## 已知边界（骨架版 v0.1.0）

- 无 git：代码以 Mac 工作区为唯一真源，手机只做读写。
- 编辑器是纯文本（无语法高亮/行号），适合小改动。
- 鸿蒙端不能静默装 hap（系统权限限制，见上）。
- mac-service 一次跑一个构建任务（多任务并发会混日志，骨架版未排队）。
- `.app`（鸿蒙上架容器）与 `.haps` 已列入产物识别，但安装动作端上不做——`.app` 是给
  AppGallery 上架的，`.haps` 是免安装包，两者走 DevEco 流程。
