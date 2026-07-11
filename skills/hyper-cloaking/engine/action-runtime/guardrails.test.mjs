import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveWriteGate,
  resolveConfirmationGate,
  enforceBulkCap,
  checkAndRecordAction,
  loadBulkLedger,
  recordBulkProgress,
  DEFAULT_BULK_CAP
} from './guardrails.mjs';

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hc-guardrails-'));
}

test('resolveWriteGate defaults to dry run (no write)', () => {
  const def = resolveWriteGate();
  assert.equal(def.dryRun, true);
  assert.equal(def.allowed, false);

  const explicit = resolveWriteGate({ dryRun: false });
  assert.equal(explicit.dryRun, false);
  assert.equal(explicit.allowed, true);
});

test('confirmation gate cannot be satisfied non-interactively', () => {
  assert.equal(resolveConfirmationGate({ interactive: false, confirmed: true }).blocked, true);
  assert.equal(resolveConfirmationGate({ interactive: true, confirmed: false }).blocked, true);
  assert.equal(resolveConfirmationGate({ interactive: true, confirmed: true }).allowed, true);
});

test('bulk cap rejects oversized requests', () => {
  const under = enforceBulkCap(new Array(3), { cap: 5 });
  assert.equal(under.allowed, true);
  const over = enforceBulkCap(new Array(6), { cap: 5 });
  assert.equal(over.allowed, false);
  assert.equal(enforceBulkCap(new Array(DEFAULT_BULK_CAP + 1)).allowed, false);
});

test('rate window persists across calls and blocks at the cap', async () => {
  const dir = await tmpStateDir();
  const now = 1_000_000_000_000;
  // Record up to the cap.
  for (let i = 0; i < 3; i += 1) {
    const r = await checkAndRecordAction(dir, 'like', { maxPerWindow: 3, windowMs: 1000, now: now + i });
    assert.equal(r.allowed, true);
  }
  // 4th within the window is blocked — proving persistence across separate calls.
  const blocked = await checkAndRecordAction(dir, 'like', { maxPerWindow: 3, windowMs: 1000, now: now + 4 });
  assert.equal(blocked.allowed, false);
  // Outside the window it recovers.
  const recovered = await checkAndRecordAction(dir, 'like', { maxPerWindow: 3, windowMs: 1000, now: now + 5000 });
  assert.equal(recovered.allowed, true);
});
test('rate preflight does not consume an event', async () => {
  const dir = await tmpStateDir();
  const options = { maxPerWindow: 1, windowMs: 1000, now: 1_000_000_000_000 };

  const preflight = await checkAndRecordAction(dir, 'like', { ...options, record: false });
  assert.equal(preflight.allowed, true);
  assert.equal(preflight.count, 0);

  const reservation = await checkAndRecordAction(dir, 'like', options);
  assert.equal(reservation.allowed, true);
  assert.equal(reservation.count, 1);
});

test('rate state rejects corrupt JSON and invalid shapes', async () => {
  const corruptDir = await tmpStateDir();
  await fs.writeFile(path.join(corruptDir, 'action-rate.json'), '{not json', 'utf8');
  await assert.rejects(
    checkAndRecordAction(corruptDir, 'like'),
    SyntaxError
  );

  const invalidDir = await tmpStateDir();
  await fs.writeFile(path.join(invalidDir, 'action-rate.json'), JSON.stringify({ like: 'not-an-array' }), 'utf8');
  await assert.rejects(
    checkAndRecordAction(invalidDir, 'like'),
    /invalid action-rate state/
  );
});

test('concurrent rate reservations cannot exceed the cap or lose events', async () => {
  const dir = await tmpStateDir();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => checkAndRecordAction(dir, 'like', {
      maxPerWindow: 3,
      windowMs: 1000,
      now: 1_000_000_000_000 + index
    }))
  );

  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(results.filter((result) => !result.allowed).length, 5);

  const store = JSON.parse(await fs.readFile(path.join(dir, 'action-rate.json'), 'utf8'));
  assert.equal(store.like.length, 3);
});

test('atomic rate persistence preserves concurrent action-type events', async () => {
  const dir = await tmpStateDir();
  const actions = Array.from({ length: 12 }, (_, index) => checkAndRecordAction(
    dir,
    index % 2 === 0 ? 'like' : 'comment',
    { maxPerWindow: 10, windowMs: 1000, now: 1_000_000_000_000 + index }
  ));

  const results = await Promise.all(actions);
  assert.equal(results.every((result) => result.allowed), true);

  const store = JSON.parse(await fs.readFile(path.join(dir, 'action-rate.json'), 'utf8'));
  assert.equal(store.like.length, 6);
  assert.equal(store.comment.length, 6);
});

test('rate state and persistence failures propagate', async () => {
  const dir = await tmpStateDir();
  const statePath = path.join(dir, 'not-a-directory');
  await fs.writeFile(statePath, 'file', 'utf8');

  await assert.rejects(
    checkAndRecordAction(statePath, 'like'),
    (error) => error?.code === 'EEXIST' || error?.code === 'ENOTDIR'
  );
});
test('bulk ledger makes resume idempotent (skip already-sent)', async () => {
  const dir = await tmpStateDir();
  const runId = 'batch-1';
  let ledger = await loadBulkLedger(dir, runId);
  assert.equal(ledger.done.size, 0);
  await recordBulkProgress(dir, runId, '111');
  await recordBulkProgress(dir, runId, '222');
  // Reload as a fresh "resumed" process would.
  ledger = await loadBulkLedger(dir, runId);
  assert.equal(ledger.done.has('111'), true);
  assert.equal(ledger.done.has('222'), true);
  assert.equal(ledger.done.has('333'), false);
});
