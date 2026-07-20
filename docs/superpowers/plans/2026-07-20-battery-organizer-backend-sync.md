# Battery Organizer Backend Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-destructive, idempotent incremental sync and account presets while preserving legacy clients.

**Architecture:** Move battery record normalization and operation application into a tested module. The server stores a per-user revision, entity versions, tombstones, presets, and a bounded operation-id history; legacy arrays remain readable.

**Tech Stack:** Node.js, CommonJS, Express, `node:test`, `fs-extra`.

## Global Constraints

- Never replace the complete production JSON file during migration.
- Authenticate every battery route with `getZzPassUserFromRequest`.
- Accept duplicate operation IDs without applying them twice.
- Keep the existing GET/PUT routes.

---

### Task 1: Pure Sync Store

**Files:**
- Create: `website/api/lib/battery_organizer_store.js`
- Create: `website/api/test/battery_organizer_store.test.js`

**Interfaces:**
- Produces: `normalizeRecord(record)`, `applySync(record, request, nowISO)`, and `legacyPayload(record)`.
- `request` is `{ cursor: number, operations: SyncOperation[] }`.
- `SyncOperation` is `{ id, entityType, entityId, action, baseVersion, payload, clientUpdatedAt }`.

- [ ] **Step 1: Write failing normalization and idempotency tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecord, applySync } = require('../lib/battery_organizer_store');

test('normalizes a legacy record without losing batteries', () => {
  const record = normalizeRecord({ batteries: [{ id: 'b1', name: '南孚 5号', quantity: 4 }] });
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.batteries.b1.quantity, 4);
});

test('applies an operation only once', () => {
  const operation = {
    id: 'op-1', entityType: 'battery', entityId: 'b1', action: 'upsert',
    baseVersion: 0, clientUpdatedAt: '2026-07-20T00:00:00.000Z',
    payload: { id: 'b1', name: '南孚 5号', quantity: 4 }
  };
  const first = applySync(normalizeRecord({}), { cursor: 0, operations: [operation] }, '2026-07-20T00:00:01.000Z');
  const second = applySync(first.record, { cursor: first.response.cursor, operations: [operation] }, '2026-07-20T00:00:02.000Z');
  assert.equal(second.record.revision, first.record.revision);
  assert.equal(second.record.batteries.b1.quantity, 4);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd website/api && node --test test/battery_organizer_store.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement record normalization and operation application**

Use this record shape:

```js
{
  schemaVersion: 2,
  revision: 0,
  batteries: {},
  presets: {},
  tombstones: {},
  changes: [],
  appliedOperationIds: [],
  updatedAt: null
}
```

Every accepted operation increments `revision`, assigns the entity `version`, appends `{ revision, entityType, entityId, action, entity }` to `changes`, and retains only the newest 1000 changes and 2000 operation IDs.

- [ ] **Step 4: Add conflict and preset tests**

Test that a lower `baseVersion` returns a conflict while preserving both the server entity and the rejected operation, and test preset upsert/delete with the same operation protocol.

- [ ] **Step 5: Run module tests**

Run: `cd website/api && node --test test/battery_organizer_store.test.js`

Expected: PASS.

### Task 2: Authenticated Sync Route

**Files:**
- Modify: `website/api/server.js:1917`
- Test: `website/api/test/battery_organizer_store.test.js`

**Interfaces:**
- Consumes: `applySync` and `legacyPayload`.
- Produces: `POST /api/battery-organizer/sync`.

- [ ] **Step 1: Add route contract test fixtures**

Add assertions for this response:

```json
{
  "schemaVersion": 2,
  "cursor": 3,
  "changes": [],
  "conflicts": [],
  "serverTime": "2026-07-20T00:00:00.000Z"
}
```

- [ ] **Step 2: Add a serialized write queue**

Create a module-level `batteryWriteQueue = Promise.resolve()` and enqueue each read-modify-write cycle so two devices cannot overwrite one another.

- [ ] **Step 3: Add the route**

The route must authenticate, normalize only `data[user.uid]`, apply operations, atomically write the complete JSON object through a temporary file and rename, then return the sync response.

- [ ] **Step 4: Adapt legacy GET/PUT**

Legacy GET returns `legacyPayload(normalizeRecord(record))`. Legacy PUT converts incoming arrays to versioned upsert/tombstone operations instead of replacing the record.

- [ ] **Step 5: Run the API suite**

Run: `cd website/api && npm test`

Expected: PASS with the new battery store tests included.

- [ ] **Step 6: Commit**

```bash
git add website/api/lib/battery_organizer_store.js website/api/test/battery_organizer_store.test.js website/api/server.js
git commit -m "feat: add offline-safe battery sync API"
```

