# TRAE 工作区长期记忆（精简版，细节见 topics/）

## 🚨 三条绝对红线
1. **`~/Downloads` 不许动**（yy 2026-10-12 明确）。其他删除**先列清单确认**。
   不删废纸篓、不删 iCloud 占位符（`.icloud`）、不删冲突副本（`* 2.*`）——会破坏同步引用/丢版本；要腾空间先问。
2. **绝不在 `website/` 下写临时文件**（sync 守护进程会把 `.part` 当分发包同步上线）。
3. **大批量写文件/构建/同步前先 `df -h /System/Volumes/Data`**，低于 20Gi 先清理。

## 主题索引（按需读，别一次全读）
| 文件 | 内容 |
|---|---|
| `topics/01-磁盘与iCloud.md` | 磁盘红线、git 快照恢复优先级、只判存在不判版本的陷阱 |
| `topics/02-部署与临时文件铁律.md` | 暂存区模式、content-length 校验、`latest` 别名陷阱 |
| `topics/03-环境与工具坑.md` | grep/curl/xcodebuild/Swift 部署目标/pbxproj 注册 |
| `topics/04-Android原生包构建.md` | Cocos headless wrapper、NATIVE_DIR、drawable 位置 |
| `topics/05-部署与同步.md` | 判定上线标准、sync 定向参数 |
| `topics/06-项目现状.md` | 各产品端数与合规改造要点 |
| `topics/07-工作方式.md` | yy 说「全部/全端」= 不排优先级，全做完 |
| `topics/08-棋盘底图与坐标同源.md` | 飞行棋/跳棋底图唯一真源、gen_ludo_board.py |
| `topics/09-生存日记动物生态.md` | 动物规则唯一真源、bundle 生成器、夜行性 |
| `topics/10-spacefight-android-cocos-build.md` | 两阶段构建、safe-delete EPERM 坑、产物改名 |

## 🚨 发版四件套（少改一样，某端/下载中心就不显示新版）
1. `build.gradle.kts` versionCode/versionName
2. `ZhengZhengGlasses-build.json`（`packages[].fileName/latestFileName`，不改→线上 404）
3. 两份 `manifest.json`（`zhengzhengstudio.cn/api/apps/` 与 `api/apps/`）
4. 两份 `client-downloads.json`（**最易漏**，下载中心 `/api/downloads`→`readClientAppDownloads` 读它）

- 同步：`node sync_to_termux.js --glasses-apps` 只投 `zhengzhengstudio.cn/api/apps/`。**无 `--help`/`dry-run`，任何参数都会真同步。**
- 重启：文件同步≠生效，8110 需 `pm2 restart zhengzheng-api`（报 socket hang up 属正常）；`client-downloads.json` 实时读文件不用重启。
- 远程执行：`POST /api/admin/termux/command`（HMAC key `H3CXiangshan=`，见 `signAdminToken()`），命令需 <600 字符。
  单文件：`POST /api/internal/sync-file`，头 `X-Sync-Secret: zhengzheng_sync_secret_2026`。
- `/api/glasses` 路由在 `website/zhengzhengstudio.cn/server/routes/glasses.js`。

## 🚨 `latest.apk` CDN 缓存坑（2026-11-05 实锤）
- CDN 对 `…-latest.apk` 设 `max-age=14400`，裸 URL 返回**上一版**；必须带 `?v=` 或用版本化路径。
- 根治：清单里所有 `latest*`/`download*` URL（约 30 处）指向 `…-vX.Y.Z.apk`。
- 发版判定：**下载裸 URL 的 sha256 == 本地 APK sha256**，别只看版本号/200。

## 🚨 Android 构建链路（本机可跑通）
- gradle 用缓存二进制：`~/.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle`。
- 必须 `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`（默认 Java8 不认 AGP8）。
- `gradlew` 无执行权 → `sh gradlew`；flavor `website`/`store`，`assembleWebsiteRelease`。
- `configChanges` 无 `smallestWidth`，正确是 `smallestScreenSize`（写错 AAPT 直接失败）。
- 图标：**别把 `@mipmap/ic_launcher_foreground` 改成 `@drawable/`**（那是默认绿机器人）。
  正确做法：从线上旧 apk `aapt2 dump badging/resources` 定位 PNG → `unzip` 回填 `mipmap-*`。新版 apk 资源名会混淆，按 badging 找。
- 眼镜签名材料在工程内：`ZhengZhengGlasses/app/manual-build/release-key.jks` + `signingConfigs.releaseLocal`
  （密码明文 `zhengzheng`，alias `zhenzhengglasses`），指纹与线上 v0.1.17 一致 ⇒ 可覆盖安装。

## 🚨 棋盘底图与坐标表必须同源（飞行棋血泪）
唯一真源 `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/scripts/gen_ludo_board.py`（吐 coords.json/coords.ts.txt）。
改底图必须重跑 → `bash scripts/sync_board_artworks.sh`。坐标表四处同改：鸿蒙在线/离线 `Index.ets`、Android `MainActivity.java`、Windows `ludo.js`。

## SpaceFight 现状
- 三端对齐 **0.13.9 / build 73**（线上 manifest + client-downloads 已确认，APK 112332727 B，sha `cb88830f…`）。
- 鸿蒙 online 工程 `HarmonyOS-App/SpaceFightHarmony/`（`signingConfigs:[]` 空 → 只能出 unsigned HAP）；offline 在 `SpaceFightHarmonyOffline/`。
- **原生 HUD 必须按帧同步**：`dispatchCombatState()` 里 native 分支已改为 0.05s 节流调 `nativeHud.syncCombat`；
  加原生 HUD 元素必须确认走这条（否则返航环/血条不刷新）。
- 舰模被 iCloud 驱逐的根治：6 个 `models-low/ships/*.glb` 已入 git 分支 `spacefight-0.13.9`(8ff9fbc7)，
  丢了就 `git checkout spacefight-0.13.9 -- <path>`。`brctl` 在沙箱内被拦，恢复只能 yy 手动。
- 本沙箱 GET 大文件会截断，核 sha 必须 `curl -C -` 续传。

## 🚨 本地站点验证坑
- 8114 是 catch-all 兜底（不存在的路径也 200），判活比 `<title>` 指纹。
- 沙箱有 `HTTP_PROXY`，curl 加 `--noproxy '*'`；站点按 Host 头分发（`server.js` ~2023 行）。
- 8110 不要擅自起（会话结束即消失），需先问 yy。
- 改 CSS/JS 必须换 `?v=` 内容哈希（`md5 -q f.css | cut -c1-8`）并回写 HTML，否则浏览器拿旧版。
- Chrome 无头 `--window-size=412,780` 不真模拟手机视口（伪影，别当 bug 修）；须带 `--host-resolver-rules` 映射域名。

## 内容与产出的口味（yy 明确要求）
- 介绍类内容：**不编数据**（先搜证）、**不写后台词**（"××说…""有意思的是"这类作者视角话术全删）、不混英文。
  他要"读的东西"不是"学的东西"。
- 生图必带"AI生成"水印：`sips -c 880 1024` 裁底 → `sips -s format jpeg -s formatOptions 82` 转小图。

## 其他
- 黄金 git 快照：`19c4e285` / `4752d91a` / `53c7b00d`(SpaceFight)。根 `.gitignore` 不存在，HEAD 只跟踪 docs，查**分支**。
- 可复用发布 skill：`~/.workbuddy/skills/multiplatform-release-ops/`（preflight / stamp-release / verify-artifacts）。
- 当前日期：2026-11-06

## 当前待决（等 yy 拍板）
- 生活日记 Android 无 release 证书（一直 debug 签名）
- 桌游鸿蒙 `signingConfigs:[]` 且无签名材料
- 其余 12 个产品是否统一把 URL 改到 `/api/apps/`
- 眼镜 macOS 是 adhoc 签名，公发需 Developer ID + 公证
- **磁盘长期贴 98%（2026-11-06 只有 8.8G 空闲），大件：Steam 40G / Downloads 54G / Desktop 44G / Parallels 27G / WPS 容器 25G / Notion 17G / WeChat 11G / .codex sessions 12G**
