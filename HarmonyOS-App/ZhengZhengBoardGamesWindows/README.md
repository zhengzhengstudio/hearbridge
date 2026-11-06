# 铮铮桌游合集 · Windows 桌面版 v1.5.0

17 种棋牌的单机桌面版，内置 AI 对手，无需联网。界面为 WinUI 2 / Fluent 原生风格（NavigationView 左侧分栏 + 亚克力命令栏）。

## 一、直接玩（免安装）

双击 `index.html` 用任意浏览器打开即可开始；或双击 `铮铮桌游合集-Windows-单文件版.html`（全部资源内联的单文件版）。

## 二、打包成 Windows 可执行程序

需要 Node.js 18+，**建议在 Windows 机器上打包**（MSI 安装包依赖 WiX，跨平台打包 macOS 上不可用）。

```bash
npm install
npm run dist          # x64 + x86(ia32)，免安装 exe + 安装版 msi
npm run dist:win64    # 只出 64 位
npm run dist:win32    # 只出 32 位
npm run singlefile    # 重新生成单文件 HTML（版本号自动取 package.json）
```

产物在 `dist/`：

- `ZhengZhengBoardGames-Windows-v1.5.0-x64-portable.exe` —— 免安装单文件（64 位）
- `ZhengZhengBoardGames-Windows-v1.5.0-ia32-portable.exe` —— 免安装单文件（32 位）
- `ZhengZhengBoardGames-Windows-v1.5.0-x64.msi` —— 安装版（64 位，含开始菜单/桌面快捷方式）
- `ZhengZhengBoardGames-Windows-v1.5.0-ia32.msi` —— 安装版（32 位）

> 版本号只需改 `package.json` 的 `version`：窗口标题、关于弹窗、侧栏角标、单文件版全部自动跟随。

## 三、上传到手机 Termux / 官网下载中心

在 TRAE 根目录执行 `sync_to_termux.js`：

```bash
node sync_to_termux.js --exe          # 只定向上传 dist/ 里的 .exe/.msi，不做全量同步
node sync_to_termux.js --exe=portable # 只上传文件名含 portable 的包
node sync_to_termux.js                # 默认全量同步，最后也会定向补传一次 .exe/.msi
node sync_to_termux.js --watch        # 监听模式：website 变化照常同步，
                                      # 同时轮询 Windows 构建产物目录，新 .exe/.msi 自动上传
```

上传目标为 `zhengzhengstudio.cn/api/apps/`；官网下载中心会把同一版本的
EXE/MSI × x64/x86 四个包合并成一张卡片，用「选择版本下载 ▾」二级菜单
（一级选免安装/安装版，二级选 x64/x86）选择下载。

## 四、开发模式

```bash
npm start
```

## 五、游戏清单

| 分类 | 游戏 |
| --- | --- |
| 棋类 | 五子棋、黑白棋、井字棋、围棋（9 路）、中国象棋、国际象棋、中国跳棋（六角星）、陆战棋（暗棋） |
| 休闲 | 扫雷、飞行棋、拉密（Rummikub）、大富翁 |
| 牌类 | 斗地主、麻将、扑克（炸金花） |
| 聚会 | 狼人杀、谁是卧底 |

## 六、玩法要点

- **陆战棋**：你是红方，自家棋子全部明牌；蓝方棋子显示「暗子」，只有发生交战时双方子力才互相亮明。工兵可沿铁路任意行进并挖地雷，夺得军旗即胜。
- **中国跳棋**：六角星 121 孔，三人对弈（红=顶部、黄=左下、蓝=右下），目标是正对面的营地，支持单步与连续跳跃。
- **飞行棋**：掷 6 起飞并再掷一次；落在敌机格撞回基地；落在己方同色格再跳 4 格；超过终点会反弹。可切换 2/3/4 人。
- **拉密**：106 张标准牌组（含 2 张百搭），3 张以上同色连续为顺子，3-4 张同数字不同色为刻子，首次出牌需 ≥30 分。
- **大富翁**：24 格中国城市，经过起点领工资，可买地、盖房（最高 3 级）、抵押，现金跌破 0 即破产。
- **斗地主**：完整牌型（单张/对子/三带/顺子/连对/飞机/四带二/炸弹/王炸），叫地主拿底牌，炸弹翻倍。
- **麻将**：万筒条 108 张，摸打、吃、碰、杠、胡（含七对/清一色/碰碰胡判定），三家 AI。
- **扑克（炸金花）**：豹子 > 顺金 > 金花 > 顺子 > 对子 > 散牌，可跟注、加注、开牌、弃牌。

## 七、目录结构

```
main.js               Electron 主进程（标题/关于菜单读 package.json 版本）
preload.js            向渲染进程暴露版本号与运行架构
index.html            界面骨架（NavigationView）
assets/style.css      WinUI 2 / Fluent 样式
build_single_file.py  生成单文件 HTML 版
src/core.js           工具、版本号、游戏注册
src/app.js            大厅路由 + 侧栏导航
src/games/board.js    五子棋/黑白棋/井字棋/围棋/跳棋/扫雷
src/games/chess.js    中国象棋/国际象棋
src/games/junqi.js    陆战棋
src/games/ludo.js     飞行棋
src/games/rummy.js    拉密
src/games/monopoly.js 大富翁
src/games/cards.js    斗地主/麻将/扑克
src/games/party.js    狼人杀/谁是卧底
```
