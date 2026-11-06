# Survival Diary Online Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide authoritative islands, Passport-linked preferences, friends, privacy controls, cloud saves, reconnect-safe commands, tap tokens, and optional Kimi diary assistance.

**Architecture:** Extend the existing Express service with explicit stores and versioned protocol validation. The server owns multiplayer truth; local play remains usable without the service, and AI output never mutates authoritative game state.

**Tech Stack:** Node.js, Express, `ws`, file-backed stores for local/test use, JSON Schema, Node test runner.

## Global Constraints

- Permanent friends and cloud sync require a verified Passport session.
- Local guests cannot silently become permanent friend identities.
- Every mutation has an `eventId` and is idempotent.
- Island permissions are `visit`, `gather`, `openStorage`, `use`, `place`, `dismantle`, and `invite`.
- Tap tokens expire in 60 seconds and are single use.
- AI has no authority over inventory, damage, placement, permissions, or milestones.

---

### Task 1: Validate Protocol v2 and Authoritative Commands

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/protocol-v2.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/test/server.test.js`

**Interfaces:**
- Produces: `validateMessage(message)`, `applyCommand(islandId, actor, command)`.
- Commands include `{ eventId, baseRevision, type, payload }`.

- [ ] **Step 1: Write failing idempotency and permission tests**

```js
test('duplicate eventId returns one committed result', async () => {
  const first = await command('evt-1', 'gather', { resourceId: 'fiber-1' });
  const second = await command('evt-1', 'gather', { resourceId: 'fiber-1' });
  assert.equal(second.revision, first.revision);
  assert.deepEqual(second.world, first.world);
});
```

- [ ] **Step 2: Verify failure**

Run `npm test` in `website/survival-diary.zhengzhengstudio.cn/server`.

- [ ] **Step 3: Implement schema validation and event ledger**

Store the last 2,000 event results per island. Reject stale conflicting revisions with `{ code: 'revision_conflict', revision, snapshot }`; return cached results for duplicate IDs.

- [ ] **Step 4: Run tests and commit**

```bash
cd website/survival-diary.zhengzhengstudio.cn/server
npm test
git add server.js world-store.js protocol-v2.js test/server.test.js
git commit -m "feat: add authoritative Survival Diary commands"
```

### Task 2: Sync Play Mode and Cloud Saves Without Silent Overwrite

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/server/preference-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/cloud-save.test.js`

**Interfaces:**
- Produces: `getPreferences(uid)`, `putPreferences(uid, { playMode })`, `putSave(uid, slot, { baseRevision, save })`.

- [ ] **Step 1: Write failing first-login and conflict tests**

```js
test('new passport preferences default to guided', () => {
  assert.deepEqual(store.get('new-user'), { playMode: 'guided', revision: 0 });
});

test('stale cloud save creates a conflict instead of overwriting', () => {
  assert.throws(() => saves.putSave('u1', 'main', { baseRevision: 1, save }), /revision conflict/);
});
```

- [ ] **Step 2: Implement revisioned preferences and saves**

New Passport and local identities default to guided. `PUT /preferences` accepts only `guided` or `free`. Save conflict responses include both server and submitted metadata, never an automatic winner.

- [ ] **Step 3: Run and commit**

```bash
node --test test/cloud-save.test.js test/server.test.js
git add preference-store.js world-store.js server.js test/cloud-save.test.js
git commit -m "feat: add safe cloud saves and play preferences"
```

### Task 3: Complete Friend Lifecycle, Visibility, Blocks, and Island ACL

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/friend-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/friends-acl.test.js`

**Interfaces:**
- Produces: request, accept, reject, withdraw, remove, block, unblock, list, presence preference, and `authorizeIslandAction`.

- [ ] **Step 1: Write failing lifecycle tests**

Test rejection, withdrawal, deletion, block cleanup, hidden presence, private diary denial, and per-action island ACL.

- [ ] **Step 2: Implement explicit endpoints**

```text
POST   /friends/requests
POST   /friends/requests/:id/accept
POST   /friends/requests/:id/reject
DELETE /friends/requests/:id
DELETE /friends/:uid
PUT    /blocks/:uid
DELETE /blocks/:uid
PUT    /presence/preferences
PUT    /islands/:id/permissions/:uid
```

- [ ] **Step 3: Run and commit**

```bash
node --test test/friends-acl.test.js test/server.test.js
git add friend-store.js world-store.js server.js test/friends-acl.test.js
git commit -m "feat: complete Survival Diary friends and ACL"
```

### Task 4: Harden Tap Friend and Island Invites

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/tap-tokens.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/tap-tokens-v2.test.js`

**Interfaces:**
- Produces: preview `{ kind, sender, island, permissions, expiresAt }` and confirmed redemption.

- [ ] **Step 1: Write failing preview/confirm tests**

Verify public or explicitly shareable non-personal islands only, sender/receiver block checks, 60-second expiry, preview without consumption, confirmation with consumption, and second redemption rejection.

- [ ] **Step 2: Implement two-stage redemption**

Add `GET /tap-tokens/:token/preview` and keep `POST /tap-tokens/:token/redeem` as the confirmation action. Friend tokens create a pending friend request; island tokens create a scoped invitation, not permanent ownership.

- [ ] **Step 3: Run and commit**

```bash
node --test test/tap-tokens-v2.test.js test/server.test.js
git add tap-tokens.js server.js test/tap-tokens-v2.test.js
git commit -m "feat: secure Survival Diary tap invitations"
```

### Task 5: Reconnect Queue and Snapshot Recovery

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/world-store.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/reconnect.test.js`

**Interfaces:**
- WebSocket messages: `join`, `resume`, `command`, `ack`, `snapshot`, `error`.

- [ ] **Step 1: Write failing reconnect tests**

Open a socket, commit two commands, disconnect, commit another actor’s change, resume from the old revision, and assert the server returns missing acknowledgements plus the current snapshot without duplicating commands.

- [ ] **Step 2: Implement bounded event replay**

Keep revision-indexed acknowledgements and snapshots. `resume` returns replay when available and a full snapshot when the requested revision has aged out.

- [ ] **Step 3: Run and commit**

```bash
node --test test/reconnect.test.js test/server.test.js
git add server.js world-store.js test/reconnect.test.js
git commit -m "feat: add Survival Diary reconnect recovery"
```

### Task 6: Keep Kimi Optional, Private, and Non-Authoritative

**Files:**
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/kimi-director.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/narrative-fallback.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/test/kimi-director.test.js`

**Interfaces:**
- Produces: `{ source: 'kimi'|'local', text, usedFactIds, rejectedFields }`.

- [ ] **Step 1: Write failing authority and fallback tests**

Reject AI fields named `inventory`, `damage`, `reward`, `entityMutation`, or `milestoneMutation`. Verify timeout, invalid JSON, missing key, and filtered content all return a local narrative.

- [ ] **Step 2: Implement minimal structured summaries**

Send only player-selected diary text and fact IDs needed for the requested operation. Strip account identifiers and private island ACL data. Do not persist user-provided Kimi keys on the server.

- [ ] **Step 3: Run all service tests and commit**

```bash
cd website/survival-diary.zhengzhengstudio.cn/server
npm test
git add kimi-director.js narrative-fallback.js test/kimi-director.test.js
git commit -m "feat: constrain Survival Diary AI narration"
```

### Task 7: Register Devices and Push Verified Release Notices

**Files:**
- Create: `website/survival-diary.zhengzhengstudio.cn/server/push-store.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/release-notifier.js`
- Modify: `website/survival-diary.zhengzhengstudio.cn/server/server.js`
- Create: `website/survival-diary.zhengzhengstudio.cn/server/test/release-notifier.test.js`

**Interfaces:**
- Produces: `registerSubscription(uid, { platform, channel, token, currentBuild })` and `notifyRelease({ version, build, manifestUrl })`.
- Supported platforms are `web`, `android`, `ios`, `macos`, and `harmonyos`.

- [ ] **Step 1: Write failing subscription and notification tests**

```js
test('only newer builds receive a minimal release notice', async () => {
  store.register('u1', { platform: 'android', channel: 'website', token: 't1', currentBuild: 2 });
  store.register('u2', { platform: 'android', channel: 'website', token: 't2', currentBuild: 3 });
  await notifier.notifyRelease({ version: '0.3.0', build: 3, manifestUrl: '/api/apps/manifest.json' });
  assert.deepEqual(adapter.sent.map(item => item.token), ['t1']);
  assert.deepEqual(adapter.sent[0].data, { type: 'release', version: '0.3.0', build: '3' });
});
```

- [ ] **Step 2: Verify failure**

Run `node --test test/release-notifier.test.js`.

- [ ] **Step 3: Implement opt-in subscription storage and adapters**

`POST /push/subscriptions` requires a session and explicit consent. Store a token hash for logs, encrypt the token at rest, delete it on logout/opt-out, and route to Web Push, FCM, APNs, or Huawei Push adapters selected by platform. Push data contains only version/build; every client re-reads the manifest before offering an update.

- [ ] **Step 4: Run and commit**

```bash
node --test test/release-notifier.test.js test/server.test.js
git add push-store.js release-notifier.js server.js test/release-notifier.test.js
git commit -m "feat: push verified Survival Diary releases"
```
