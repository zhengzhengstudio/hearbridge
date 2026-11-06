# 铮铮单机桌游 HarmonyOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有鸿蒙桌游中心副本改造成包名为 `cn.zhengzhengstudio.boardgames.offline.hmos`、不声明网络权限、全部桌游可离线游玩的独立应用。

**Architecture:** 保留现有 ArkUI 三入口框架，但从 3331 行 `Index.ets` 中抽离游戏目录、本地存档和各类规则引擎。页面只渲染 `GameSession` 并派发动作；每个规则模块独立校验、推进和结算，彻底删除房间与网络状态机。

**Tech Stack:** HarmonyOS 6.0.2, ArkTS, ArkUI, Preferences/File APIs, Hypium, Hvigor, SDK HAP signing tool.

## Global Constraints

- 应用名固定为“铮铮单机桌游”。
- bundle name 固定为 `cn.zhengzhengstudio.boardgames.offline.hmos`。
- `module.json5` 不声明 `ohos.permission.INTERNET`、麦克风、相机或附近设备权限。
- 不保留房间、匹配、排行榜、通行证、反馈、聊天、语音、扫码、碰一碰、网页续玩或联网更新。
- 全部状态和统计仅存本机；飞行模式必须完成完整游玩链条。
- 支持 HarmonyOS phone、tablet、2in1。
- 使用旧版桌游中心 1024×1024 图标。
- 每种游戏使用自己的规则和终局条件，围棋绝不能按五连判胜。
- 发布包必须使用 bundle name 与新包名完全匹配的发布 profile。

---

## File Structure

- `entry/src/main/ets/catalog/GameCatalog.ets`: 游戏元数据、分类、人数和 AI 能力。
- `entry/src/main/ets/domain/GameTypes.ets`: `GameSession`、`GameAction`、`GameResult` 和规则接口。
- `entry/src/main/ets/domain/grid/*.ets`: 五子棋、井字棋、黑白棋、围棋规则。
- `entry/src/main/ets/domain/chess/*.ets`: 中国象棋、国际象棋、国际跳棋、动物棋与跳棋规则。
- `entry/src/main/ets/domain/table/*.ets`: 拉密、飞行棋、大富翁、斗地主、麻将和扑克牌规则。
- `entry/src/main/ets/domain/party/*.ets`: 狼人杀、谁是卧底和扫雷本地主持流程。
- `entry/src/main/ets/domain/ai/*.ets`: AI 难度、合法动作选择和搜索预算。
- `entry/src/main/ets/storage/LocalGameStore.ets`: 偏好、进行中对局和统计持久化。
- `entry/src/main/ets/pages/*.ets`: 大厅、游戏库、设置、开局配置和对局页面。
- `tests/boardgame_harmony_offline.test.js`: 构建产物与无网络契约测试。
- `entry/src/test/*.test.ets`: 规则与存档单元测试。

---

### Task 1: 独立应用身份与零网络契约

**Files:**
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/AppScope/app.json5`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/AppScope/resources/base/element/string.json`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/resources/base/element/string.json`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/module.json5`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/oh-package.json5`
- Test: `tests/boardgame_harmony_offline.test.js`

**Interfaces:**
- Produces: application identity `cn.zhengzhengstudio.boardgames.offline.hmos`; no permission array entries.

- [ ] **Step 1: Write the failing package contract test**

```js
test('offline Harmony app has independent identity and zero network surface', () => {
  const app = readJson5('HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/AppScope/app.json5').app;
  const module = readJson5('HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/module.json5').module;
  assert.equal(app.bundleName, 'cn.zhengzhengstudio.boardgames.offline.hmos');
  assert.deepEqual(module.requestPermissions || [], []);
  assert.deepEqual(module.deviceTypes, ['phone', 'tablet', '2in1']);
  assert.equal(app.icon, '$media:app_icon');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/boardgame_harmony_offline.test.js`  
Expected: FAIL because the project still uses `cn.zhengzhengstudio.boardgames.hmos`.

- [ ] **Step 3: Apply the independent product metadata**

Set version `1.0.0`, versionCode `1000000`, vendor `铮铮实验室`, app/ability labels `铮铮单机桌游`, and description `无需网络的原生桌游合集`.

- [ ] **Step 4: Run contract test and debug build**

Run: `node --test tests/boardgame_harmony_offline.test.js && cd HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw assembleHap --mode module -p product=default -p module=entry@default -p buildMode=debug --no-daemon`  
Expected: PASS and build exit 0.

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline tests/boardgame_harmony_offline.test.js
git commit -m "feat(boardgames): establish HarmonyOS offline app identity"
```

### Task 2: 删除联网状态机并建立离线目录

**Files:**
- Delete: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/model/RoomInvite.ets`
- Delete: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test/RoomInvite.test.ets`
- Create: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/catalog/GameCatalog.ets`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/pages/Index.ets`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test/List.test.ets`
- Test: `tests/boardgame_harmony_offline.test.js`

**Interfaces:**
- Produces: `GameInfo`, `GAME_CATALOG`, `gamesInCategory(category: GameCategory): GameInfo[]`.

- [ ] **Step 1: Extend the failing test to inspect the compiled HAP**

Build a debug HAP, unzip `module.json` and `modules.abc`, then assert permission names and the strings `WebSocket`, `房间号`, `铮铮通行证`, `公开房间`, `碰一碰` are absent.

- [ ] **Step 2: Run the test and verify RED**

Expected: FAIL because `Index.ets` still imports networking, Share Kit and room invitation code.

- [ ] **Step 3: Create the complete catalog**

```ts
export type GameCategory = 'board' | 'cards' | 'party' | 'puzzle'
export interface GameInfo {
  id: string
  title: string
  subtitle: string
  category: GameCategory
  minPlayers: number
  maxPlayers: number
  supportsAi: boolean
  estimatedMinutes: number
  icon: Resource
}
export const GAME_CATALOG: GameInfo[] = [
  game('gobang', '五子棋', 'board', 1, 2, true),
  game('reversi', '黑白棋', 'board', 1, 2, true),
  game('tictactoe', '井字棋', 'board', 1, 2, true),
  game('go', '围棋', 'board', 1, 2, true),
  game('chinese-chess', '中国象棋', 'board', 1, 2, true),
  game('chess', '国际象棋', 'board', 1, 2, true),
  game('checkers', '国际跳棋', 'board', 1, 2, true),
  game('chinese-checkers', '中国跳棋', 'board', 2, 6, true),
  game('animal-chess', '动物棋', 'board', 1, 2, true),
  game('rummy', '拉密', 'cards', 1, 4, true),
  game('ludo', '飞行棋', 'board', 1, 4, true),
  game('monopoly', '大富翁', 'board', 1, 4, true),
  game('landlord', '斗地主', 'cards', 1, 3, true),
  game('mahjong', '国标麻将', 'cards', 1, 4, true),
  game('poker', '德州扑克', 'cards', 1, 6, true),
  game('minesweeper', '扫雷', 'puzzle', 1, 1, false),
  game('werewolf', '狼人杀', 'party', 6, 12, false),
  game('spy', '谁是卧底', 'party', 4, 10, false)
]
```

- [ ] **Step 4: Remove all online imports, state, methods and builders**

Delete room IDs, socket polling, HTTP helpers, public room/leaderboard/passport/feedback panels, chat, voice, invitation, scan and web continuation. Keep only lobby, catalog, local setup, game, preferences and about.

- [ ] **Step 5: Run contract test and build**

Run the Task 1 test/build command. Expected: all assertions pass and HAP builds.

- [ ] **Step 6: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline tests/boardgame_harmony_offline.test.js
git commit -m "refactor(boardgames): remove HarmonyOS online surface"
```

### Task 3: 规则接口与本地会话

**Files:**
- Create: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/GameTypes.ets`
- Create: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/GameRegistry.ets`
- Create: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test/GameRegistry.test.ets`
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test/List.test.ets`

**Interfaces:**
- Produces: `GameAction`, `GameSession`, `GameResult`, `RuleEngine`, `createSession(gameId, settings)`, `applyAction(session, action)`.

- [ ] **Step 1: Write failing registry tests**

```ts
it('creates a game-specific session for every catalog entry', 0, () => {
  GAME_CATALOG.forEach((game: GameInfo) => {
    const session = createSession(game.id, { playerCount: game.minPlayers, aiLevel: 'normal' })
    expect(session.gameId).assertEqual(game.id)
    expect(session.status).assertEqual('playing')
  })
})
it('rejects an action for the wrong game', 0, () => {
  const session = createSession('go', { playerCount: 2, aiLevel: 'normal' })
  expect(applyAction(session, { gameId: 'gobang', kind: 'place', index: 0 }).ok).assertFalse()
})
```

- [ ] **Step 2: Run Hypium and verify RED**

Run: `cd HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline && /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw test --no-daemon`  
Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement explicit engine registration**

```ts
export interface RuleEngine {
  create(settings: GameSettings): GameSession
  legalActions(session: GameSession): GameAction[]
  apply(session: GameSession, action: GameAction): ActionResult
}
const ENGINES: Map<string, RuleEngine> = new Map()
```

No engine may fall back to the Gomoku engine. Missing registration throws a user-facing unsupported-game error during development and fails the catalog test.

- [ ] **Step 4: Run Hypium and build**

Expected: all registry tests pass with temporary minimal engines returning only their correct game ID; no UI wiring yet.

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src
git commit -m "feat(boardgames): add offline rule engine boundary"
```

### Task 4: 完成网格棋类规则

**Files:**
- Create: `entry/src/main/ets/domain/grid/GomokuRules.ets`
- Create: `entry/src/main/ets/domain/grid/TicTacToeRules.ets`
- Create: `entry/src/main/ets/domain/grid/ReversiRules.ets`
- Create: `entry/src/main/ets/domain/grid/GoRules.ets`
- Create: `entry/src/test/GridRules.test.ets`
- Modify: `entry/src/main/ets/domain/GameRegistry.ets`

**Interfaces:**
- Consumes: `RuleEngine`, `GameSession`, `GameAction`, `ActionResult`.
- Produces: four registered engines with immutable state transitions.

- [ ] **Step 1: Write literal rule fixtures**

Cover occupied-cell rejection, Gomoku five-in-row, Tic-tac-toe three-in-row, Reversi eight-direction capture/pass/end, and Go capture/suicide/ko/pass/scoring.

```ts
it('does not end Go when five black stones are consecutive', 0, () => {
  const session = goFixtureWithFiveConsecutiveBlackStones()
  expect(session.status).assertEqual('playing')
  expect(session.result).assertNull()
})
```

- [ ] **Step 2: Run Hypium and verify RED**

Expected: FAIL because the engines are still minimal.

- [ ] **Step 3: Implement the four engines**

Use 15×15 intersections for Gomoku, 3×3 cells for Tic-tac-toe, 8×8 cells for Reversi, and 19×19 intersections plus previous-position hash for Go ko.

- [ ] **Step 4: Run all grid tests**

Expected: every literal fixture passes, including Go five-in-row regression.

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/grid HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test
git commit -m "feat(boardgames): implement offline grid game rules"
```

### Task 5: 完成棋类移动、吃子与终局

**Files:**
- Create: `entry/src/main/ets/domain/chess/XiangqiRules.ets`
- Create: `entry/src/main/ets/domain/chess/ChessRules.ets`
- Create: `entry/src/main/ets/domain/chess/CheckersRules.ets`
- Create: `entry/src/main/ets/domain/chess/ChineseCheckersRules.ets`
- Create: `entry/src/main/ets/domain/chess/AnimalChessRules.ets`
- Create: `entry/src/test/ChessRules.test.ets`
- Modify: `entry/src/main/ets/domain/GameRegistry.ets`

**Interfaces:**
- Produces: legal move lists, capture transitions, promotion and terminal results for each chess-family game.

- [ ] **Step 1: Write failing move fixtures**

Include Xiangqi horse-leg/elephant-eye/palace/flying-general, chess castling/en-passant/promotion/checkmate, checkers forced capture/king, Chinese checkers hops, and Animal Chess rank/river/trap rules.

- [ ] **Step 2: Run Hypium and verify RED**

- [ ] **Step 3: Implement legal move generation and immutable apply**

Reject selection of the opponent's piece and any move absent from `legalActions(session)`; determine wins from each game's king/home/remaining-piece rules.

- [ ] **Step 4: Run chess-family tests and complete build**

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/chess HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test
git commit -m "feat(boardgames): implement chess-family captures and endings"
```

### Task 6: 完成牌桌与骰子游戏

**Files:**
- Create: `entry/src/main/ets/domain/table/RummyRules.ets`
- Create: `entry/src/main/ets/domain/table/LudoRules.ets`
- Create: `entry/src/main/ets/domain/table/MonopolyRules.ets`
- Create: `entry/src/main/ets/domain/table/LandlordRules.ets`
- Create: `entry/src/main/ets/domain/table/MahjongRules.ets`
- Create: `entry/src/main/ets/domain/table/PokerRules.ets`
- Create: `entry/src/main/ets/domain/RandomSource.ets`
- Create: `entry/src/test/TableRules.test.ets`

**Interfaces:**
- Produces: seeded `RandomSource.nextInt(max)` so shuffle/dice tests are deterministic; game-specific table engines.

- [ ] **Step 1: Write failing deck and rule tests**

Assert Rummy has exactly two copies of four colors × values 1-13 plus two jokers; shuffling changes order for a fixed seed; first meld is at least 30; groups/runs are validated. Cover Ludo launch/reroll/collision/configurable rules, Monopoly movement/economy, Landlord bidding/combinations, 国标麻将 wall/deal/win shape, and 德州扑克 blinds/deal/betting/showdown.

- [ ] **Step 2: Run Hypium and verify RED**

- [ ] **Step 3: Implement deterministic rule engines**

Do not generate a random tile on each Rummy draw; remove the next tile from one shuffled 106-tile deck. Store all hidden hands inside the local session and expose only the active player's view.

- [ ] **Step 4: Run table tests and build**

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/table HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test
git commit -m "feat(boardgames): implement offline table game rules"
```

### Task 7: 完成扫雷与聚会主持流程

**Files:**
- Create: `entry/src/main/ets/domain/party/MinesweeperRules.ets`
- Create: `entry/src/main/ets/domain/party/WerewolfRules.ets`
- Create: `entry/src/main/ets/domain/party/SpyRules.ets`
- Create: `entry/src/test/PartyRules.test.ets`

**Interfaces:**
- Produces: first-click-safe mine board; private reveal phases; speech/vote/result phase transitions.

- [ ] **Step 1: Write failing phase tests**

Assert Minesweeper first click and neighbors are safe, flags do not reveal, zero-cell flood reveal stops at numbered cells; Werewolf/Spy roles are hidden until the named player holds the device and votes cannot be cast twice.

- [ ] **Step 2: Run Hypium and verify RED**

- [ ] **Step 3: Implement local-only phase machines**

No fake AI participants for party games. Provide explicit `handoff`, `reveal`, `hide`, `speak`, `vote`, and `resolve` actions.

- [ ] **Step 4: Run party tests and build**

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/party HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test
git commit -m "feat(boardgames): add offline puzzle and party flows"
```

### Task 8: AI 难度与防非法动作

**Files:**
- Create: `entry/src/main/ets/domain/ai/AiPlayer.ets`
- Create: `entry/src/main/ets/domain/ai/GridSearch.ets`
- Create: `entry/src/main/ets/domain/ai/ChessSearch.ets`
- Create: `entry/src/test/AiPlayer.test.ets`

**Interfaces:**
- Produces: `chooseAction(engine, session, level, budgetMs): GameAction | null`.

- [ ] **Step 1: Write failing AI tests**

Use literal positions where AI must take an immediate win, block an immediate loss, make only a legal capture, and return within 80/300/900 ms budgets for easy/normal/hard.

- [ ] **Step 2: Run Hypium and verify RED**

- [ ] **Step 3: Implement legal-action-first AI**

Easy selects weighted legal actions; normal uses shallow minimax/heuristics; hard uses iterative deepening within budget. Every returned action must come from `engine.legalActions(session)`.

- [ ] **Step 4: Run AI tests repeatedly**

Run the suite 20 times to catch timing and randomness instability; expect zero illegal moves and zero timeout overruns beyond a small test tolerance.

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/domain/ai HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test
git commit -m "feat(boardgames): add bounded offline AI"
```

### Task 9: 本地存档、偏好与统计

**Files:**
- Create: `entry/src/main/ets/storage/LocalGameStore.ets`
- Create: `entry/src/main/ets/storage/StoredModels.ets`
- Create: `entry/src/test/LocalGameStore.test.ets`
- Modify: `entry/src/main/ets/pages/Index.ets`

**Interfaces:**
- Produces: `loadPreferences()`, `savePreferences(value)`, `loadSession()`, `saveSession(session)`, `clearSession()`, `recordResult(result)`, `exportLocalData()`, `importLocalData(payload)`.

- [ ] **Step 1: Write failing round-trip and corruption tests**

Use an in-memory adapter with the same `KeyValueStore` interface. Assert round-trip equality, schema version migration, corrupted snapshot fallback, per-game statistics, exported JSON round-trip and rejection of an import with the wrong product ID or unsupported schema version.

- [ ] **Step 2: Run Hypium and verify RED**

- [ ] **Step 3: Implement adapter-backed storage**

Write an atomic current/previous snapshot pair. Save after every accepted action and in `onBackground`; never serialize Resource objects or UI state.

- [ ] **Step 4: Run storage and domain tests**

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/storage HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/test HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src/main/ets/pages/Index.ets
git commit -m "feat(boardgames): persist offline sessions and statistics"
```

### Task 10: 原生页面与响应式棋盘

**Files:**
- Create: `entry/src/main/ets/pages/LobbyPage.ets`
- Create: `entry/src/main/ets/pages/GameLibraryPage.ets`
- Create: `entry/src/main/ets/pages/GameSetupPage.ets`
- Create: `entry/src/main/ets/pages/GamePage.ets`
- Create: `entry/src/main/ets/pages/ProfilePage.ets`
- Create: `entry/src/main/ets/pages/PreferencesPage.ets`
- Create: `entry/src/main/ets/components/boards/*.ets`
- Create: `entry/src/main/ets/components/tables/*.ets`
- Modify: `entry/src/main/ets/pages/Index.ets`
- Test: `tests/boardgame_harmony_offline.test.js`

**Interfaces:**
- Consumes: catalog, registry, AI and storage APIs.
- Produces: stable lobby → setup → game → result → replay flow.

- [ ] **Step 1: Add failing UI structure assertions and screenshot matrix**

The contract test builds the app and checks all catalog IDs have a dedicated renderer registration. Manual matrix: 390×844, 844×390, 673×841 foldable, 1024×1366 tablet, 1440×900 2in1.

- [ ] **Step 2: Run test and verify RED**

- [ ] **Step 3: Implement page split and game-first layout**

Use maximum content widths and adaptive two-column layouts. Grid boards use stable aspect ratio, `columnsGap(0)`, `rowsGap(0)` and correct intersection/cell anchor. Card/party screens use private handoff overlays. Settings include appearance, double-tap placement, vibration, sound, coordinates, AI, local data and version.

- [ ] **Step 4: Build and capture every viewport**

Verify no clipping, overflow, invisible black/white stones, board-text overlap or controls outside safe areas. Fix before proceeding.

- [ ] **Step 5: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/entry/src tests/boardgame_harmony_offline.test.js
git commit -m "feat(boardgames): deliver responsive HarmonyOS offline UI"
```

### Task 11: 签名、安装验证与下载中心发布

**Files:**
- Modify: `HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline/build-hap.sh`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/api/data/changelogs.json`
- Test: `tests/boardgame_harmony_offline.test.js`

**Interfaces:**
- Produces: versioned and latest signed HAP/APP with independent download-center ID.

- [ ] **Step 1: Add failing release assertions**

Assert compiled bundle name, release mode, zero permissions, `app_icon` presence, signed status, manifest SHA-256/size equality and coexistence with `cn.zhengzhengstudio.boardgames.hmos`.

- [ ] **Step 2: Run release test and verify RED**

Expected: FAIL until the new package and manifest entry exist.

- [ ] **Step 3: Harden build preflight**

Before signing, parse the chosen `.p7b` and require `"bundle-name":"cn.zhengzhengstudio.boardgames.offline.hmos"`. Refuse unsigned publication and refuse the online profile. Build names:

```text
ZhengZhengOfflineBoardGames-HarmonyOS-v1.0.0-signed.hap
ZhengZhengOfflineBoardGames-HarmonyOS-v1.0.0-signed.app
```

- [ ] **Step 4: Build and verify signatures**

Run `build-hap.sh` with release certificate, keystore, alias/password and the new profile. Verify the final HAP/APP with the Harmony SDK signing tool and inspect compiled `module.json`.

- [ ] **Step 5: Install on a connected HarmonyOS device**

Enable flight mode, install over USB, launch, complete one board game and one card/party flow, background/restore the app, and verify no permission prompt or network status appears.

- [ ] **Step 6: Publish without overwriting online edition**

Copy versioned HAP/APP and latest aliases to both app directories. Add ID `cn.zhengzhengstudio.boardgames.offline.hmos`; update `website/api/data/changelogs.json`; sync and compare online SHA-256 values.

- [ ] **Step 7: Run final verification**

Run:

```bash
node --test tests/boardgame_harmony_offline.test.js
cd HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline
/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw test --no-daemon
```

Expected: zero failures. Confirm downloaded versioned/latest files match local release hashes.

- [ ] **Step 8: Commit**

```bash
git add HarmonyOS-App/ZhengZhengBoardGamesHarmonyOffline website/api/apps website/zhengzhengstudio.cn/api/apps website/api/data/changelogs.json tests/boardgame_harmony_offline.test.js
git commit -m "release(boardgames): publish HarmonyOS offline edition 1.0.0"
```
