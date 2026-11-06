# LifeDiary 发布策略

LifeDiary 跨端（Web / Android / iOS / macOS / HarmonyOS Online / HarmonyOS Offline）共用同一套版本号与发布流程。

## 版本号规则（x = 任意非负整数）

- 普通更新：x.x.A —— 仅缺陷修复与小幅体验调整，A 单调递增
- 中型更新：x.B.x —— 新增功能或可见体验改动，B 单调递增
- 超大型更新：C.x.x —— 架构或平台级变更，C 单调递增

## 当前源码版本

- 当前源码版本：0.3.1
- 各端源码（Android build.gradle / iOS Info.plist / HarmonyOS app.json5 / release 脚本）必须与上述版本对齐。

## 一致性要求

- 四份分发清单（两份 manifest.json + 两份 client-downloads.json）中的 lifediary 条目版本、build、size、sha256 必须与已发布产物一致。
- 原生包重新发布后必须同步刷新 `latest` 别名与 changelog。
- 换签名证书时必须在清单 `notes` 中注明旧包需卸载重装。
