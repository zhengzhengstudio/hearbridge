# 声桥 HearBridge 过程文档

声桥 HearBridge 是一款帮助听障人士在真实生活场景中用文字、大字卡片和闯关训练更顺畅沟通的多端辅助工具。

## 文档规则

这个文件是声桥的过程文档。以后每次修改声桥，都要同步更新这里。

每次改动至少补三件事：

1. 在「过程记录」追加一条记录，写清楚为什么改、改了什么、验证了什么。
2. 如果改动在 `website` 目录内，同步更新 `website/api/data/changelogs.json`。
3. 如果新增页面、资源、安装包、server、manifest 或同步白名单，同步检查 `sync_to_termux.js`、`start_termux.js`、`website/api/apps` 与线上下载中心 manifest。

## 当前产品边界

声桥不是一个单页大杂烩。页面职责按用户任务拆开：

| 页面 | 职责 |
| --- | --- |
| `index.html` | 现场沟通台，负责字幕、打字、大字卡片和常用语。 |
| `challenge.html` | 闯关训练，负责打字、录音、情境练习、XP 和训练反馈。 |
| `training.html` | 本地训练数据，负责热词、错词、录音样本和本地 AI 准备。 |
| `passport.html` | 沟通通行证，负责用户身份、听障说明和登录入口。 |
| `reminders.html` | 提醒，负责震动、备忘和照护提醒。 |
| `ppt.html` | 项目说明材料，只保留 Explain、PPT 预览和 PPT 下载。 |

## 固定改动流程

每次开改前先写一句目标：

> 本次改动要让谁在什么场景下更容易完成什么事。

然后按下面顺序做：

1. **收敛范围**：确认本次是沟通台、闯关、训练、通行证、下载中心、server 还是全端包。
2. **改页面或服务**：优先保持多页面结构，不把新功能塞回首页。
3. **同步数据与文档**：更新 `PROCESS.md` 和 `website/api/data/changelogs.json`；涉及下载包时更新 manifest。
4. **验证**：至少检查页面能打开、核心按钮可用、移动端不横向溢出；涉及 JS 时跑语法检查。
5. **同步 Termux**：声桥站点改动用 `node sync_to_termux.js --hear --web`。
6. **同步开源仓库**：公开 H5、PPT、文档等同步到 `hearbridge-open-source/public` 后提交推送。

## 伙伴计划归档

伙伴提供的《多邻国风格 UI、音效与学习机器人实现计划》用于指导声桥闯关训练体验，但需要按声桥当前架构改造：

| 伙伴计划 | 声桥落点 |
| --- | --- |
| Duolingo 风格按钮、进度、卡片视觉 | 优先落在 `challenge.html`、`challenge.js` 和 `style.css`，不要把首页改成长游戏页。 |
| 连胜天数、今日 XP、每日 10 关 | 放在闯关训练状态里，并和 `training.html` 的样本沉淀打通。 |
| Web Audio 点击、成功、失败、完成音效 | 封装为可静默失败的前端工具，先用于闯关，再决定是否扩展到沟通台。 |
| 学习机器人“小听” | 作为闯关页教练出现，负责鼓励、提示和复盘，不遮挡提交、录音、下一关按钮。 |
| 单文件 `vocabulary-collection.html` | 不照搬。声桥保持多页面，必要时拆出公共状态与 UI helper。 |

## 体验原则

- 听障用户优先：先让沟通不断线，再逐步接入 AI。
- 无 API key 也能用：在线识别失败时，保留打字、常用语、本地录音和训练样本。
- 角色分明：听障本人、沟通对象、照护者看到的默认话术和入口不应混在一起。
- 介绍页要短：对外 Explain 放在 `ppt.html`，产品操作留在各功能页。
- 训练要自然：闯关可以游戏化，但训练样本必须来自真实沟通、用户确认和可复盘记录。

## 验证清单

每次修改按影响范围勾选：

- 页面：桌面和手机宽度能打开，无横向溢出，文字不遮挡按钮。
- 录音：无麦克风权限、无 API key、network 失败时都有可用降级路径。
- 闯关：提交、完成、下一关、重置和每日状态不互相打断。
- 训练：热词、错词、录音样本能保存，用户能理解这些数据如何用于本地 AI。
- 下载中心：安装包、版本号、build、SHA-256、简介和 `client-downloads.json` 同步。
- 服务端：`hear_server.js`、PM2 条目、Cloudflare Tunnel 和 `HEAR_ROOT` 路径一致。
- 同步：`node sync_to_termux.js --hear --web` 成功，没有漏掉新增文件。

## 过程记录

| 日期 | 改动 | 关键文件 | 验证 | 状态 |
| --- | --- | --- | --- | --- |
| 2026-07-11 | 在保留沟通台、闯关、训练库、通行证、提醒和 PPT 的前提下，重排首页为“今日主线 / 功能分区 / 沟通工作台”，并统一顶部与移动端底部主导航。 | `index.html`, `challenge.html`, `training.html`, `passport.html`, `reminders.html`, `style.css` | 桌面 1365px 与手机 390px 首页、闯关页均无横向溢出；移动端隐藏顶部 nav，仅保留底部主导航。 | 完成 |
| 2026-07-11 | 修复声桥专用同步漏传 `assets/` 的问题，确保 PPT、预览图、后续图标和音效资源会随 `--hear --web` 递归上传。 | `sync_to_termux.js`, `PROCESS.md` | 发现线上 PPT 链接返回 HTML 后定位到同步目录跳过 assets，已改为声桥同步显式 `includeAssets`。 | 完成 |
| 2026-07-11 | 新增过程文档，把伙伴的 Duolingo 风格、音效和“小听”机器人计划归档为声桥多页面改造规则，并要求每次修改都更新本文档。 | `PROCESS.md` | 已确认文档落在声桥站点目录，后续会随 `--hear --web` 同步。 | 完成 |
| 2026-07-11 | 新增项目说明 PPT 页，解决 Explain 不清晰和页面太杂的问题。 | `ppt.html`, `assets/hearbridge-intro.pptx`, `assets/ppt-preview/*` | `ppt.html`、PPT 下载、预览图均返回 200；桌面和 390px 手机宽度无横向溢出。 | 完成 |
| 2026-07-11 | 首页收敛为三模式沟通工作台，不再把访谈说明、闯关、训练、通行证全部堆在首屏。 | `index.html`, `style.css`, `app.js` | 线上 `hear.zhengzhengstudio.cn` 可打开，`/api/status` 显示 `exists:true`。 | 完成 |
| 2026-07-10 | 声桥拆成多页面，并补齐闯关训练、本地训练、沟通通行证、提醒与全端安装包。 | `challenge.html`, `training.html`, `passport.html`, `reminders.html`, `website/api/apps/*` | 下载中心 manifest、client-downloads 和安装包已同步。 | 完成 |
| 2026-07-10 | 增加无 API key 本地训练模式和识别失败降级路径。 | `app.js`, `hear_server.js` | ASR 未配置时前端进入本地模式，保留打字、录音样本和常用语。 | 完成 |
| 2026-07-09 | 声桥 H5 原型上线，创建独立子站、独立 `hear_server.js` 和 PM2 条目。 | `index.html`, `hear_server.js`, `start_termux.js`, `sync_to_termux.js` | `hear.zhengzhengstudio.cn` 通过独立 HEAR_ROOT 提供静态站点。 | 完成 |
