const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listFeedback,
  summarizeFeedback,
  updateFeedback,
  softDeleteFeedback,
  restoreFeedback,
  purgeFeedback
} = require('../website/api/lib/admin_feedback_store');

const records = () => [
  {
    id: 'fb_new',
    product: 'manager-portal',
    status: 'new',
    message: 'Cannot sign in',
    createdAt: '2026-07-20T08:00:00.000Z'
  },
  {
    id: 'fb_reviewing',
    product: 'battery-organizer',
    status: 'reviewing',
    message: 'Sync is slow',
    createdAt: '2026-07-20T07:00:00.000Z'
  },
  {
    id: 'fb_deleted',
    product: 'manager-portal',
    status: 'resolved',
    message: 'Old issue',
    createdAt: '2026-07-19T07:00:00.000Z',
    deletedAt: '2026-07-20T09:00:00.000Z',
    deletedBy: 'root'
  }
];

test('active and recycled feedback are isolated', () => {
  assert.deepEqual(listFeedback(records(), {}).map(item => item.id), [
    'fb_new',
    'fb_reviewing'
  ]);
  assert.deepEqual(listFeedback(records(), { trash: true }).map(item => item.id), [
    'fb_deleted'
  ]);
  assert.deepEqual(
    listFeedback(records(), { product: 'manager', status: 'new' }).map(item => item.id),
    ['fb_new']
  );
});

test('summary reports the active workflow and recycle bin separately', () => {
  assert.deepEqual(summarizeFeedback(records()), {
    total: 2,
    new: 1,
    reviewing: 1,
    resolved: 0,
    archived: 0,
    trash: 1
  });
});

test('feedback can be handled, moved to recycle bin, and restored', () => {
  const handled = updateFeedback(
    records(),
    'fb_new',
    { status: 'reviewing', note: 'Reproduced on Android' },
    'operator',
    '2026-07-20T10:00:00.000Z'
  );
  assert.equal(handled.item.status, 'reviewing');
  assert.equal(handled.item.note, 'Reproduced on Android');
  assert.equal(handled.item.handledBy, 'operator');

  const deleted = softDeleteFeedback(
    handled.records,
    'fb_new',
    'operator',
    '2026-07-20T10:05:00.000Z'
  );
  assert.equal(deleted.item.deletedBy, 'operator');
  assert.equal(deleted.item.previousStatus, 'reviewing');
  assert.equal(listFeedback(deleted.records, {}).length, 1);

  const restored = restoreFeedback(
    deleted.records,
    'fb_new',
    'super',
    '2026-07-20T10:10:00.000Z'
  );
  assert.equal(restored.item.status, 'reviewing');
  assert.equal(restored.item.deletedAt, undefined);
  assert.equal(restored.item.restoredBy, 'super');
});

test('permanent deletion only accepts feedback already in the recycle bin', () => {
  assert.throws(
    () => purgeFeedback(records(), 'fb_new'),
    /recycle bin/i
  );

  const purged = purgeFeedback(records(), 'fb_deleted');
  assert.equal(purged.item.id, 'fb_deleted');
  assert.equal(purged.records.some(item => item.id === 'fb_deleted'), false);
});

test('feedback mutations reject invalid identifiers, status, and oversized notes', () => {
  assert.throws(
    () => updateFeedback(records(), '../fb_new', { status: 'new' }, 'operator'),
    /identifier/i
  );
  assert.throws(
    () => updateFeedback(records(), 'fb_new', { status: 'deleted' }, 'operator'),
    /status/i
  );
  assert.throws(
    () => updateFeedback(records(), 'fb_new', { note: 'x'.repeat(2001) }, 'operator'),
    /note/i
  );
});
