# 生活日记全端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付生活日记 Web、Android、iOS、macOS、HarmonyOS 联机版与单机版，以及通行证、个人日记、健康记录、陪伴助手、社区、好友聊天、更新安装、下载中心、商店素材和 Cloudflare 站点。

**Architecture:** 共享的 Web 产品核心使用本机优先数据层，联机端通过独立 LifeDiary API 同步；Android 与 Apple 客户端内置共享资源并桥接系统能力，HarmonyOS 双版本使用 ArkUI。服务端按个人数据、社区、助手、好友聊天和碰一碰令牌拆分独立模块，客户端永远不能靠提交 UID 获得权限。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js 22/Express 5/node:test、Android Kotlin/Gradle、SwiftUI/Swift Package Manager、HarmonyOS ArkTS/ArkUI/Hvigor、Cloudflare DNS、SHA-256 发布清单。

## Global Constraints

- 首发版本固定为 `0.1.0`、build `1`。
- 包名：Android `cn.zhengzhengstudio.lifediary`；iOS `cn.zhengzhengstudio.lifediary.ios`；macOS `cn.zhengzhengstudio.lifediary.macos`；HarmonyOS 联机 `cn.zhengzhengstudio.lifediary.hmos`；HarmonyOS 单机 `cn.zhengzhengstudio.lifediary.offline.hmos`。
- Web、Android、iOS、macOS、HarmonyOS 联机版首次使用必须绑定铮铮通行证；HarmonyOS 单机版不得包含联网权限或在线代码。
- 个人日记、健康记录、助手记忆、社区、好友聊天使用独立数据域；社区发布创建副本，不直接公开个人原文。
- 经期记录与戒烟日记由用户主动开启，不根据性别自动分配。
- 社区不支持匿名发布。
- 未成年人模式不自动开启；提示支持开启、稍后再说、7 天不提示、永久不提示；HarmonyOS 双版本适配系统未成年人模式。
- UI 实施前执行 taste-skill 设计预检；字体不得使用 Inter；主色只保留低饱和苔绿色；所有页面提供加载、空数据、错误、焦点和减少动态效果状态。
- 新增依赖前先检查现有依赖；能用平台标准库和现有依赖时不新增依赖。
- 所有网站非敏感变更写入 `website/api/data/changelogs.json`；历史补录只写可由 Git、包、清单或发布文档证明的内容。
- 只有通过签名工具验证的产物才可在清单标记 `signed: true` 或 `storeReady: true`。

## 文件结构

- `website/life.zhengzhengstudio.cn/`：Web 页面、共享样式、共享业务核心和静态资源。
- `website/api/lib/life_diary_*.js`：个人数据、社交、助手与好友聊天的原子存储模块。
- `website/api/routes/life_diary_*.js`：按数据域划分的 Express 路由。
- `website/api/test/life_diary_*.test.js`：服务端、前端契约、发布与隐私测试。
- `apps/LifeDiary-Android/`：Android 原生壳、内置 Web 资源和更新安装桥。
- `apps/LifeDiary-iOS/`：iOS SwiftUI 容器与系统安装入口。
- `apps/LifeDiary-macOS/`：macOS SwiftUI 容器与 DMG 更新入口。
- `apps/LifeDiary-HarmonyOS-Online/`：HarmonyOS 联机 ArkUI 应用。
- `apps/LifeDiary-HarmonyOS-Offline/`：HarmonyOS 单机 ArkUI 应用。
- `apps/build_lifediary_apps.sh`：全端构建、签名验证、复制和清单生成。
- `apps/LifeDiary-HarmonyOS-Offline/store-assets/`：商店文案、截图与宣传效果图。

---

### Task 1: 共享领域模型与健康计算

**Files:**
- Create: `website/life.zhengzhengstudio.cn/assets/js/life-models.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/health.js`
- Test: `website/api/test/life_diary_health.test.js`

**Interfaces:**
- Produces: `window.LifeModels.createEntry(input)`、`window.LifeHealth.predictPeriod(records, today)`、`window.LifeHealth.calculateQuitStats(profile, events, now)`。
- `predictPeriod` returns `{ status, predictedStart, rangeStart, rangeEnd, averageCycle, confidence }`。
- `calculateQuitStats` returns `{ smokeFreeMs, avoidedCigarettes, savedMoney, currentStreakMs }`。

- [ ] **Step 1: 写健康计算失败测试**

```js
test('period prediction returns a range only after two complete cycles', () => {
  assert.equal(health.predictPeriod([{ start: '2026-06-01' }], '2026-07-01').status, 'insufficient');
  const result = health.predictPeriod([
    { start: '2026-05-01', end: '2026-05-05' },
    { start: '2026-05-30', end: '2026-06-03' },
    { start: '2026-06-28', end: '2026-07-02' }
  ], '2026-07-10');
  assert.equal(result.predictedStart, '2026-07-27');
  assert.ok(result.rangeStart < result.rangeEnd);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd website/api && node --test test/life_diary_health.test.js`
Expected: FAIL，提示 `life-models.js` 或 `health.js` 不存在。

- [ ] **Step 3: 实现纯函数模型、经期范围预测与戒烟统计**

```js
function calculateQuitStats(profile, events, now = new Date()) {
  const relapseCount = events.filter(item => item.type === 'smoked').reduce((sum, item) => sum + item.count, 0);
  const elapsedDays = Math.max(0, (new Date(now) - new Date(profile.startedAt)) / 86400000);
  const baseline = elapsedDays * profile.cigarettesPerDay;
  return {
    smokeFreeMs: Math.max(0, new Date(now) - new Date(profile.startedAt)),
    avoidedCigarettes: Math.max(0, Math.floor(baseline - relapseCount)),
    savedMoney: Math.max(0, (baseline - relapseCount) * profile.pricePerCigarette),
    currentStreakMs: currentStreak(events, profile.startedAt, now)
  };
}
```

- [ ] **Step 4: 运行领域测试**

Run: `cd website/api && node --test test/life_diary_health.test.js`
Expected: PASS，覆盖历史不足、闰日、异常输入、复吸不清零历史、金额舍入。

- [ ] **Step 5: 提交**

```bash
git add website/life.zhengzhengstudio.cn/assets/js/life-models.js website/life.zhengzhengstudio.cn/assets/js/health.js website/api/test/life_diary_health.test.js
git commit -m "feat(lifediary): add diary and health domain models"
```

### Task 2: 私密数据存储、通行证鉴权与同步冲突

**Files:**
- Create: `website/api/lib/life_diary_store.js`
- Create: `website/api/routes/life_diary.js`
- Create: `website/api/data/life_diary/.gitkeep`
- Test: `website/api/test/life_diary_store.test.js`
- Test: `website/api/test/life_diary_routes.test.js`
- Modify: `website/api/server.js`

**Interfaces:**
- Consumes: 与 `routes/reading.js` 相同的 HMAC 通行证 Bearer 令牌格式。
- Produces: `createLifeDiaryStore({ dataDir, now })`、`createLifeDiaryRouter({ getUser, store })`。
- Routes: `GET /api/life/me`、`POST /api/life/sync`、`POST /api/life/export`、`DELETE /api/life/me`。
- Sync request: `{ cursor, operations: [{ id, domain, type, baseRevision, payload }] }`。

- [ ] **Step 1: 写鉴权隔离和冲突失败测试**

```js
test('sync derives uid from bearer token and preserves both conflicting versions', async () => {
  const response = await request('/api/life/sync', jsonRequest({
    operations: [{ id: 'op-2', domain: 'diary', type: 'upsert', baseRevision: 1,
      payload: { id: 'entry-1', revision: 2, title: '第二台设备' } }]
  }, 'reader-1'));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.conflicts[0].local.id, 'entry-1');
  assert.equal(body.conflicts[0].incoming.title, '第二台设备');
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd website/api && node --test test/life_diary_store.test.js test/life_diary_routes.test.js`
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现每用户原子文件、域白名单、修订号和幂等操作 ID**

```js
const PRIVATE_DOMAINS = new Set(['diary', 'health', 'minor-settings', 'assistant-memory']);
async function syncUser(uid, request) {
  return withUserLock(uid, async () => {
    const record = await readUser(uid);
    const unseen = request.operations.filter(op => !record.appliedOperationIds.includes(op.id));
    return applyOperations(record, unseen, { allowedDomains: PRIVATE_DOMAINS });
  });
}
```

- [ ] **Step 4: 挂载路由并运行测试**

Run: `cd website/api && node --test test/life_diary_store.test.js test/life_diary_routes.test.js`
Expected: PASS，覆盖无令牌、伪造 UID、跨用户读取、冲突副本、幂等重放、彻底删除。

- [ ] **Step 5: 提交**

```bash
git add website/api/lib/life_diary_store.js website/api/routes/life_diary.js website/api/data/life_diary/.gitkeep website/api/test/life_diary_store.test.js website/api/test/life_diary_routes.test.js website/api/server.js
git commit -m "feat(lifediary): add authenticated private sync"
```

### Task 3: 社区、好友、聊天与碰一碰令牌

**Files:**
- Create: `website/api/lib/life_diary_social_store.js`
- Create: `website/api/lib/life_diary_friend_store.js`
- Create: `website/api/routes/life_diary_social.js`
- Create: `website/api/routes/life_diary_friends.js`
- Test: `website/api/test/life_diary_social.test.js`
- Test: `website/api/test/life_diary_friends.test.js`
- Modify: `website/api/server.js`

**Interfaces:**
- Produces: community routes under `/api/life/community` and friend routes under `/api/life/friends`。
- Tap token shape stored server-side: `{ tokenHash, issuerUid, expiresAt, consumedAt: null }`；原始令牌只返回一次。
- Message shape: `{ id, conversationId, senderUid, body, createdAt, clientMessageId }`。

- [ ] **Step 1: 写社区副本、无匿名和一次性令牌失败测试**

```js
test('tap invite can be consumed once and needs receiver confirmation', async () => {
  const issued = await post('/api/life/friends/tap-tokens', {}, 'reader-1');
  const token = (await issued.json()).token;
  assert.equal((await post('/api/life/friends/tap-tokens/consume', { token }, 'reader-2')).status, 201);
  assert.equal((await post('/api/life/friends/tap-tokens/consume', { token }, 'reader-3')).status, 410);
  assert.equal((await get('/api/life/friends', 'reader-2').json()).friends.length, 0);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd website/api && node --test test/life_diary_social.test.js test/life_diary_friends.test.js`
Expected: FAIL，提示路由模块不存在。

- [ ] **Step 3: 实现社区副本、互动、审核状态、好友状态机和聊天幂等**

```js
function publicAuthor(user) {
  return { uid: String(user.uid), nickname: String(user.nickname || user.username), avatar: user.avatar || '' };
}
function issueTapToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
}
```

- [ ] **Step 4: 运行社交测试**

Run: `cd website/api && node --test test/life_diary_social.test.js test/life_diary_friends.test.js`
Expected: PASS，覆盖伪造作者、匿名字段拒绝、举报/拉黑、未成年人限制、令牌过期/重放、消息去重。

- [ ] **Step 5: 提交**

```bash
git add website/api/lib/life_diary_social_store.js website/api/lib/life_diary_friend_store.js website/api/routes/life_diary_social.js website/api/routes/life_diary_friends.js website/api/test/life_diary_social.test.js website/api/test/life_diary_friends.test.js website/api/server.js
git commit -m "feat(lifediary): add community friends and chat"
```

### Task 4: 陪伴助手授权、记忆与危机边界

**Files:**
- Create: `website/api/lib/life_diary_companion.js`
- Create: `website/api/routes/life_diary_companion.js`
- Test: `website/api/test/life_diary_companion.test.js`
- Modify: `website/api/server.js`

**Interfaces:**
- Produces: `createLifeDiaryCompanionRouter({ getUser, privateStore, provider })`。
- Route: `POST /api/life/companion/chat` consumes `{ message, style, selectedEntryIds, remember }`。
- Response: `{ answer, usedEntryIds, safety, memoryDrafts }`。

- [ ] **Step 1: 写未授权读取和危机响应失败测试**

```js
test('companion only receives explicitly selected entries', async () => {
  await chat({ message: '回顾今天', selectedEntryIds: ['entry-allowed'] }, 'reader-1');
  assert.deepEqual(provider.lastContext.entries.map(item => item.id), ['entry-allowed']);
  assert.equal(provider.lastContext.entries.some(item => item.id === 'entry-private'), false);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd website/api && node --test test/life_diary_companion.test.js`
Expected: FAIL，提示 companion 模块不存在。

- [ ] **Step 3: 实现授权筛选、风格、记忆草稿、每周回望和本地安全分流**

```js
const STYLES = new Set(['quiet', 'gentle', 'direct']);
const selected = await privateStore.readEntries(uid, uniqueIds(body.selectedEntryIds).slice(0, 20));
const safety = detectImmediateRisk(body.message);
if (safety.level === 'urgent') return res.json({ answer: safety.message, usedEntryIds: [], safety, memoryDrafts: [] });
```

- [ ] **Step 4: 运行助手测试**

Run: `cd website/api && node --test test/life_diary_companion.test.js`
Expected: PASS，覆盖无授权、跨用户 ID、三种风格、记忆确认/删除、提供商不可用和危机提示。

- [ ] **Step 5: 提交**

```bash
git add website/api/lib/life_diary_companion.js website/api/routes/life_diary_companion.js website/api/test/life_diary_companion.test.js website/api/server.js
git commit -m "feat(lifediary): add consent-based companion"
```

### Task 5: Web 设计系统、通行证与本机优先存储

**Files:**
- Create: `website/life.zhengzhengstudio.cn/index.html`
- Create: `website/life.zhengzhengstudio.cn/diary.html`
- Create: `website/life.zhengzhengstudio.cn/health.html`
- Create: `website/life.zhengzhengstudio.cn/community.html`
- Create: `website/life.zhengzhengstudio.cn/companion.html`
- Create: `website/life.zhengzhengstudio.cn/friends.html`
- Create: `website/life.zhengzhengstudio.cn/settings.html`
- Create: `website/life.zhengzhengstudio.cn/assets/css/life.css`
- Create: `website/life.zhengzhengstudio.cn/assets/js/auth.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/store.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/shell.js`
- Create: `website/life.zhengzhengstudio.cn/assets/icon.svg`
- Modify: `website/zhengzhengstudio.cn/passport/reading_return.js`
- Test: `website/api/test/life_diary_frontend_contract.test.js`

**Interfaces:**
- Produces: `window.LifeAuth.getSession()`、`window.LifeAuth.authFetch()`、`window.LifeStore.enqueue(operation)`、`window.LifeStore.sync()`。

- [ ] **Step 1: 运行确定性选择并输出 taste-skill 设计预检**

```bash
python3 - <<'PY'
from pathlib import Path
import random
prompt = Path('docs/superpowers/specs/2026-07-26-life-diary-cross-platform-design.md').read_text()
random.seed(len(prompt) % 10000)
print(random.choice(['Cinematic Center', 'Artistic Asymmetry', 'Editorial Split']))
print(random.choice(['Satoshi', 'Cabinet Grotesk', 'Outfit', 'Geist']))
print(random.sample(['Inline Typography Images', 'Horizontal Accordions', 'Infinite Marquee', 'Feedback Carousel'], 3))
print(random.sample(['Scroll Pinning', 'Image Scale & Fade', 'Scrubbing Text Reveals', 'Card Stacking'], 2))
PY
```

Expected: 把四行实际输出写进实施时的 `<design_plan>`；应用内数据页只采用不影响可用性的动效子集，并尊重 reduced-motion。

- [ ] **Step 2: 写页面结构、无 Inter、状态与通行证深链失败测试**

```js
for (const page of PAGES) {
  assert.match(read(page), /<meta\s+name=["']viewport["']/i);
  assert.match(read(page), /data-state=["']loading["']/i);
  assert.match(read(page), /data-state=["']empty["']/i);
  assert.match(read(page), /data-state=["']error["']/i);
}
assert.doesNotMatch(read('assets/css/life.css'), /\bInter\b/);
```

- [ ] **Step 3: 运行失败测试**

Run: `cd website/api && node --test test/life_diary_frontend_contract.test.js`
Expected: FAIL，提示 LifeDiary 页面不存在。

- [ ] **Step 4: 实现共享导航、苔绿/暖米白设计系统、通行证回跳和 IndexedDB 同步队列**

```js
window.LifeAuth = Object.freeze({ getSession, authFetch, login, logout });
window.LifeStore = Object.freeze({ list, get, save, remove, enqueue, sync, resolveConflict });
```

同时在 `reading_return.js` 的受信站点映射中新增 `life: 'https://life.zhengzhengstudio.cn/'`，复用现有哈希令牌清理逻辑，禁止令牌落入查询参数或持久化用户对象。

- [ ] **Step 5: 运行前端契约与可访问性检查**

Run: `cd website/api && node --test test/life_diary_frontend_contract.test.js`
Expected: PASS，七页导航一致、每页一个 H1、焦点可见、无 emoji 按钮、无横向溢出、支持 reduced-motion。

- [ ] **Step 6: 提交**

```bash
git add website/life.zhengzhengstudio.cn website/api/test/life_diary_frontend_contract.test.js
git commit -m "feat(lifediary): add premium web shell and offline store"
```

### Task 6: Web 个人日记、健康与隐私保险箱

**Files:**
- Create: `website/life.zhengzhengstudio.cn/assets/js/today.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/diary.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/health-ui.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/settings.js`
- Modify: `website/life.zhengzhengstudio.cn/index.html`
- Modify: `website/life.zhengzhengstudio.cn/diary.html`
- Modify: `website/life.zhengzhengstudio.cn/health.html`
- Modify: `website/life.zhengzhengstudio.cn/settings.html`
- Test: `website/api/test/life_diary_private_ui.test.js`

**Interfaces:**
- Consumes: `LifeModels`、`LifeHealth`、`LifeStore`。
- Produces: quick note, calendar timeline, templates, capsule, period, quit diary, minor prompt and export flows。

- [ ] **Step 1: 写隐私与计算 UI 失败测试**

```js
assert.match(read('health.html'), /主动开启经期记录/);
assert.match(read('health.html'), /主动开启戒烟日记/);
assert.doesNotMatch(read('health.html'), /女性专属|男性专属/);
assert.match(read('settings.html'), /7 天内不再提示/);
assert.match(read('settings.html'), /永久不再提示/);
```

- [ ] **Step 2: 运行失败测试并实现页面交互**

Run: `cd website/api && node --test test/life_diary_private_ui.test.js`
Expected before implementation: FAIL；实现后 PASS。

- [ ] **Step 3: 验证断网、导出和冲突体验**

Run: `cd website/api && node --test test/life_diary_health.test.js test/life_diary_private_ui.test.js test/life_diary_frontend_contract.test.js`
Expected: PASS；网络请求失败不会清空编辑器，冲突页显示两份内容和合并动作。

- [ ] **Step 4: 提交**

```bash
git add website/life.zhengzhengstudio.cn website/api/test/life_diary_private_ui.test.js
git commit -m "feat(lifediary): add private diary and health journeys"
```

### Task 7: Web 社区、助手、好友和聊天

**Files:**
- Create: `website/life.zhengzhengstudio.cn/assets/js/community.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/companion.js`
- Create: `website/life.zhengzhengstudio.cn/assets/js/friends.js`
- Modify: `website/life.zhengzhengstudio.cn/community.html`
- Modify: `website/life.zhengzhengstudio.cn/companion.html`
- Modify: `website/life.zhengzhengstudio.cn/friends.html`
- Test: `website/api/test/life_diary_social_ui.test.js`

**Interfaces:**
- Consumes: Task 3 and Task 4 APIs through `LifeAuth.authFetch`。
- Produces: explicit community copy editor, companion source picker, friend requests and one-to-one message UI。

- [ ] **Step 1: 写“无匿名、发布前确认、助手来源可见”失败测试**

```js
assert.doesNotMatch(read('community.html'), /匿名发布/);
assert.match(read('community.html'), /这将出现在社区/);
assert.match(read('companion.html'), /本次使用的日记/);
assert.match(read('friends.html'), /删除好友/);
assert.match(read('friends.html'), /拉黑/);
```

- [ ] **Step 2: 运行失败测试、实现并复测**

Run: `cd website/api && node --test test/life_diary_social_ui.test.js`
Expected before implementation: FAIL；实现后 PASS。

- [ ] **Step 3: 运行全套 LifeDiary Web/API 测试**

Run: `cd website/api && node --test test/life_diary_*.test.js`
Expected: PASS，无跨用户读取、匿名发布或未授权助手上下文。

- [ ] **Step 4: 提交**

```bash
git add website/life.zhengzhengstudio.cn website/api/test/life_diary_social_ui.test.js
git commit -m "feat(lifediary): add community companion and messaging UI"
```

### Task 8: Android 客户端与安装更新

**Files:**
- Create: `apps/LifeDiary-Android/settings.gradle.kts`
- Create: `apps/LifeDiary-Android/build.gradle.kts`
- Create: `apps/LifeDiary-Android/app/build.gradle.kts`
- Create: `apps/LifeDiary-Android/app/src/main/AndroidManifest.xml`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/MainActivity.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/LifeBridge.kt`
- Create: `apps/LifeDiary-Android/app/src/main/java/cn/zhengzhengstudio/lifediary/UpdateChecker.kt`
- Create: `apps/LifeDiary-Android/app/src/main/res/xml/file_paths.xml`
- Test: `website/api/test/life_diary_android_contract.test.js`

**Interfaces:**
- Bridge actions: `passportLogin`、`setPrivacyShield`、`exportFile`、`share`、`checkUpdate`、`installDownloadedUpdate`。
- Update entry ID: `lifediary-android`。

- [ ] **Step 1: 写包名、内置资源、FileProvider、版本/build 比较和 SHA-256 失败测试**

Run: `cd website/api && node --test test/life_diary_android_contract.test.js`
Expected: FAIL，Android 工程不存在。

- [ ] **Step 2: 创建 Android 工程并复制共享 Web 资源到 assets**

```kotlin
webView.loadUrl("file:///android_asset/life/index.html")
webView.settings.allowFileAccessFromFileURLs = true
webView.addJavascriptInterface(LifeBridge(this), "LifeDiaryApp")
```

- [ ] **Step 3: 实现更新下载、哈希校验与系统安装器**

```kotlin
val intent = Intent(Intent.ACTION_VIEW).apply {
  setDataAndType(fileUri, "application/vnd.android.package-archive")
  addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
}
startActivity(intent)
```

- [ ] **Step 4: 测试并构建 release APK**

Run: `cd apps/LifeDiary-Android && ./gradlew test lint assembleRelease`
Expected: BUILD SUCCESSFUL；输出 `app-release.apk`，包内 versionName `0.1.0`、versionCode `1`。

- [ ] **Step 5: 提交**

```bash
git add apps/LifeDiary-Android website/api/test/life_diary_android_contract.test.js
git commit -m "feat(lifediary): add Android client"
```

### Task 9: iOS 与 macOS 客户端

**Files:**
- Create: `apps/LifeDiary-iOS/Package.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/LifeDiaryApp.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/LifeWebView.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/UpdateChecker.swift`
- Create: `apps/LifeDiary-iOS/Sources/LifeDiary/Resources/Info.plist`
- Create: `apps/LifeDiary-macOS/Package.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/LifeDiaryApp.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/LifeWebView.swift`
- Create: `apps/LifeDiary-macOS/Sources/LifeDiary/UpdateChecker.swift`
- Test: `website/api/test/life_diary_apple_contract.test.js`

**Interfaces:**
- iOS update entry ID: `lifediary-ios`; macOS: `lifediary-macos`。
- Native messages mirror Android bridge names, with iOS using `itms-services`/system-supported installation and macOS opening verified DMG。

- [ ] **Step 1: 写 bundle ID、版本、资源内置和更新语义失败测试**

Run: `cd website/api && node --test test/life_diary_apple_contract.test.js`
Expected: FAIL，Apple 工程不存在。

- [ ] **Step 2: 实现 SwiftUI 容器、WKWebView 消息桥和隐私遮挡**

```swift
configuration.userContentController.add(coordinator, name: "LifeDiaryApp")
webView.loadFileURL(indexURL, allowingReadAccessTo: resourcesURL)
```

- [ ] **Step 3: 实现版本/build 比较、下载、SHA-256 和安装入口**

```swift
guard remote.version > current.version ||
  (remote.version == current.version && remote.build > current.build) else { return }
```

- [ ] **Step 4: 构建验证**

Run: `cd apps/LifeDiary-iOS && swift build`
Run: `cd apps/LifeDiary-macOS && swift test && swift build -c release`
Expected: 两个命令成功；Info.plist 版本和 bundle ID 正确。

- [ ] **Step 5: 提交**

```bash
git add apps/LifeDiary-iOS apps/LifeDiary-macOS website/api/test/life_diary_apple_contract.test.js
git commit -m "feat(lifediary): add Apple clients"
```

### Task 10: HarmonyOS 联机版、系统未成年人模式与碰一碰

**Files:**
- Create: `apps/LifeDiary-HarmonyOS-Online/AppScope/app.json5`
- Create: `apps/LifeDiary-HarmonyOS-Online/build-profile.json5`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/module.json5`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/pages/Index.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/model/LifeStore.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/service/PassportService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/service/UpdateService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/service/TapFriendService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Online/entry/src/main/ets/service/MinorModeService.ets`
- Test: `website/api/test/life_diary_harmony_online_contract.test.js`

**Interfaces:**
- Bundle: `cn.zhengzhengstudio.lifediary.hmos`。
- Tap service issues a server token, sends only the token through the system-supported near-device capability, then consumes it through Task 3 API。

- [ ] **Step 1: 查验当前 HarmonyOS SDK 的系统未成年人和碰一碰正式 API**

Run: `rg -n "minor|child|tap|碰一碰|continuation|distributed" "$DEVECO_SDK_HOME" apps/PerfectCalendar-HarmonyOS-Online 2>/dev/null`
Expected: 记录实际可编译的 SDK API；若 SDK 未提供专用未成年人状态或碰一碰发送 API，使用系统公开的近场分享/协同入口，不伪造不存在的接口。

- [ ] **Step 2: 写联机/单机隔离、包名、权限与令牌失败测试**

Run: `cd website/api && node --test test/life_diary_harmony_online_contract.test.js`
Expected: FAIL，联机工程不存在。

- [ ] **Step 3: 实现 ArkUI 页面、通行证、同步、聊天、系统模式提示和碰一碰确认流**

```ts
async issueAndShareTapInvite(): Promise<void> {
  const token = await this.friendApi.issueTapToken()
  await this.systemShare.shareText(token)
  this.status = '好友申请已发送，等待对方确认'
}
```

- [ ] **Step 4: 构建与测试**

Run: `cd apps/LifeDiary-HarmonyOS-Online && ./build-hap.sh`
Expected: 生成 `0.1.0` build `1` 的 HAP/APP；合同测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/LifeDiary-HarmonyOS-Online website/api/test/life_diary_harmony_online_contract.test.js
git commit -m "feat(lifediary): add HarmonyOS online client"
```

### Task 11: HarmonyOS 单机版与应用市场隔离

**Files:**
- Create: `apps/LifeDiary-HarmonyOS-Offline/AppScope/app.json5`
- Create: `apps/LifeDiary-HarmonyOS-Offline/build-profile.json5`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/module.json5`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/pages/Index.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/model/OfflineStore.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/service/MinorModeService.ets`
- Create: `apps/LifeDiary-HarmonyOS-Offline/entry/src/main/ets/service/ExportService.ets`
- Test: `website/api/test/life_diary_harmony_offline_contract.test.js`

**Interfaces:**
- Bundle: `cn.zhengzhengstudio.lifediary.offline.hmos`。
- No network permission, URL literal, Passport, community, friend, chat, remote assistant or manifest update symbol is allowed。

- [ ] **Step 1: 写离线纯净失败测试**

```js
assert.doesNotMatch(allSource, /ohos\.permission\.INTERNET|https?:\/\/|Passport|WebSocket|manifest\.json/);
assert.match(appJson, /cn\.zhengzhengstudio\.lifediary\.offline\.hmos/);
```

- [ ] **Step 2: 运行失败测试并实现 ArkUI 单机功能**

Run: `cd website/api && node --test test/life_diary_harmony_offline_contract.test.js`
Expected before implementation: FAIL；实现后 PASS。

- [ ] **Step 3: 构建签名 HAP 与 APP**

Run: `cd apps/LifeDiary-HarmonyOS-Offline && ./build-hap.sh`
Expected: 生成签名的 HAP 和应用市场 APP；若签名材料缺失，构建脚本明确退出且不产生 `signed` 命名文件。

- [ ] **Step 4: 提交**

```bash
git add apps/LifeDiary-HarmonyOS-Offline website/api/test/life_diary_harmony_offline_contract.test.js
git commit -m "feat(lifediary): add HarmonyOS offline edition"
```

### Task 12: 发布自动化、下载中心、更新日志与 DNS

**Files:**
- Create: `apps/build_lifediary_apps.sh`
- Create: `apps/scripts/update_lifediary_manifest.js`
- Create: `website/api/test/life_diary_release_contract.test.js`
- Modify: `website/api/apps/manifest.json`
- Modify: `website/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/manifest.json`
- Modify: `website/zhengzhengstudio.cn/api/apps/client-downloads.json`
- Modify: `website/zhengzhengstudio.cn/downloads.html`
- Modify: `website/api/data/changelogs.json`

**Interfaces:**
- Manifest IDs: `lifediary-web`、`lifediary-android`、`lifediary-ios`、`lifediary-macos`、`lifediary-harmonyos-online`、`lifediary-harmonyos-offline-hap`、`lifediary-harmonyos-offline-app`。

- [ ] **Step 1: 写发布一致性失败测试**

```js
for (const entry of LIFE_ENTRIES) {
  assert.equal(entry.version, '0.1.0');
  assert.equal(entry.build, 1);
  assert.equal(fs.statSync(resolveArtifact(entry)).size, entry.size);
  assert.equal(sha256(resolveArtifact(entry)), entry.sha256);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd website/api && node --test test/life_diary_release_contract.test.js`
Expected: FAIL，清单中没有 LifeDiary 条目。

- [ ] **Step 3: 构建、验证签名、复制版本包/latest 包并原子更新两套清单**

```bash
node apps/scripts/update_lifediary_manifest.js \
  --version 0.1.0 --build 1 --apps-dir website/api/apps
```

构建脚本必须调用 `apksigner verify`、`codesign --verify --deep --strict`、`security cms`/描述文件检查和 HarmonyOS 签名验证工具；任一验证失败则停止发布。

- [ ] **Step 4: 补齐公开更新日志**

Run: `git -C website log --since=2026-07-01 --name-status --pretty=format:'%H %ad %s' --date=iso`
Expected: 将可由历史、发布包和清单证明且未出现在 `changelogs.json` 的公开改动补录；跳过管理员、高危漏洞、后端敏感信息。

- [ ] **Step 5: 配置 Cloudflare DNS 并验证站点**

Read-only first: 查询 `zhengzhengstudio.cn` 区域现有 `life` 记录和同类子域目标。
Mutation: 创建或更新 `life.zhengzhengstudio.cn`，使用与现有独立站点相同的代理策略。
Verify: `curl -fsS https://life.zhengzhengstudio.cn/` 返回 LifeDiary 首页，`curl -fsS https://life.zhengzhengstudio.cn/api/health` 或现有健康检查路径成功。

- [ ] **Step 6: 运行完整发布测试并提交**

Run: `cd website/api && node --test test/life_diary_*.test.js`
Expected: PASS；清单、文件、下载中心、更新日志和包内版本一致。

```bash
git add apps/build_lifediary_apps.sh apps/scripts/update_lifediary_manifest.js website/api/apps website/zhengzhengstudio.cn/api/apps website/zhengzhengstudio.cn/downloads.html website/api/data/changelogs.json website/api/test/life_diary_release_contract.test.js
git commit -m "release(lifediary): publish cross-platform 0.1.0"
```

### Task 13: 鸿蒙应用市场图文素材与最终验收

**Files:**
- Create: `apps/LifeDiary-HarmonyOS-Offline/store-assets/store-listing.md`
- Create: `apps/LifeDiary-HarmonyOS-Offline/store-assets/privacy-notes.md`
- Create: `apps/LifeDiary-HarmonyOS-Offline/store-assets/screenshots/`
- Create: `apps/LifeDiary-HarmonyOS-Offline/store-assets/promo/`
- Create: `apps/LifeDiary-HarmonyOS-Offline/RELEASE_CHECKLIST.md`

**Interfaces:**
- Store copy must describe the offline edition only and must not claim community, online AI, diagnosis, treatment or guaranteed smoking cessation。

- [ ] **Step 1: 在 HarmonyOS 模拟器或设备捕获真实界面截图**

Capture: 今天、个人日记、经期范围、戒烟日记、时光胶囊、隐私保险箱、未成年人模式设置。
Expected: 无测试账号、真实姓名、日记正文、通知内容或设备品牌水印。

- [ ] **Step 2: 使用 imagegen 生成无品牌设备场景效果图**

Prompt must state: “使用提供的真实 App 截图作为屏幕内容；无品牌、无型号、无商标的通用手机；暖米白桌面与自然晨光；图片为宣传效果图，不添加设备名称，不改变 App UI 文字。”

- [ ] **Step 3: 写商店文案与隐私说明**

```text
短描述：把日常、心情与健康变化安心留在自己的设备里。
版本说明：首个正式版本，包含个人日记、经期记录、戒烟日记、时光胶囊、隐私保险箱与未成年人模式适配。
```

- [ ] **Step 4: 最终全端验证**

Run: `cd website/api && npm test -- --test-name-pattern=life_diary`
Run: `cd apps/LifeDiary-Android && ./gradlew test lint assembleRelease`
Run: `cd apps/LifeDiary-macOS && swift test && swift build -c release`
Run: `cd apps/LifeDiary-HarmonyOS-Online && ./build-hap.sh`
Run: `cd apps/LifeDiary-HarmonyOS-Offline && ./build-hap.sh`
Expected: 全部成功；离线扫描无联网能力；所有发布包签名、版本、build、大小、SHA-256 与清单一致。

- [ ] **Step 5: 提交**

```bash
git add apps/LifeDiary-HarmonyOS-Offline/store-assets apps/LifeDiary-HarmonyOS-Offline/RELEASE_CHECKLIST.md
git commit -m "docs(lifediary): add HarmonyOS store assets"
```
