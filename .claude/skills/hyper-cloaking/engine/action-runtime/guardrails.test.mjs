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
  reserveGuardedAction,
  finalizeGuardedAction,
  inspectGuardedAction,
  reconcileGuardedAction,
  loadBulkLedger,
  recordBulkProgress,
  DEFAULT_BULK_CAP
} from './guardrails.mjs';
import { makeActionResult } from './action-result.mjs';

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
test('bulk ledger fails closed on corruption and preserves concurrent progress', async () => {
  const corruptDir = await tmpStateDir();
  await fs.writeFile(path.join(corruptDir, 'bulk-ledger-run.json'), '{bad json', 'utf8');
  await assert.rejects(loadBulkLedger(corruptDir, 'run'), SyntaxError);

  const concurrentDir = await tmpStateDir();
  const keys = Array.from({ length: 12 }, (_, index) => `recipient-${index}`);
  await Promise.all(keys.map((key) => recordBulkProgress(concurrentDir, 'run', key)));
  const ledger = await loadBulkLedger(concurrentDir, 'run');
  assert.deepEqual([...ledger.done].sort(), [...keys].sort());
});

const hash = (character) => character.repeat(64);

function reservationInput(index = 0, overrides = {}) {
  const digit = (index % 10).toString(16);
  return {
    actionType: 'fixture-write',
    maxPerWindow: 3,
    windowMs: 1000,
    idempotencyHash: hash(digit),
    targetHash: hash('a'),
    contentHash: hash('b'),
    runId: 'run-1',
    now: 1_000_000_000_000 + index,
    ...overrides
  };
}

test('action results enforce exclusive terminal states and sanitized transport evidence', () => {
  const base = {
    action: 'fixture:write',
    dryRun: false,
    observation: { text: 'verified' },
    criteria: [{ type: 'textIncludes', expected: 'verified' }]
  };
  const already = makeActionResult({
    ...base,
    performed: false,
    changed: false,
    alreadySatisfied: true,
    transport: { kind: 'dom', provider: 'fixture', action: 'write' }
  });
  assert.equal(already.performed, false);
  assert.equal(already.changed, false);
  assert.equal(already.alreadySatisfied, true);
  assert.deepEqual(already.transport, { kind: 'dom', provider: 'fixture', action: 'write' });
  assert.throws(() => makeActionResult({ ...base, action: '' }), /action/);
  assert.throws(() => makeActionResult({ ...base, dryRun: 0 }), /dryRun/);
  assert.throws(() => makeActionResult({
    ...base,
    transport: { kind: 'official', provider: 'fixture', action: 'write', authorization: 'secret' }
  }), /unsupported fields/);

  assert.throws(() => makeActionResult({ ...base, alreadySatisfied: true, performed: true }), /alreadySatisfied/);
  assert.throws(() => makeActionResult({ ...base, performed: false, changed: true }), /changed/);
  assert.throws(() => makeActionResult({
    ...base,
    dryRun: true,
    performed: true
  }), /performed/);
  assert.throws(() => makeActionResult({
    ...base,
    transport: { kind: 'private', provider: 'fixture', action: 'write' }
  }), /transport.kind/);
});

test('atomic guarded reservations enforce both rate and idempotency under concurrency', async () => {
  const dir = await tmpStateDir();
  const rateResults = await Promise.all(
    Array.from({ length: 8 }, (_, index) => reserveGuardedAction(dir, reservationInput(index)))
  );
  assert.equal(rateResults.filter((result) => result.status === 'reserved').length, 3);
  assert.equal(rateResults.filter((result) => result.status === 'rate-limited').length, 5);

  const sameDir = await tmpStateDir();
  const sameClaim = await Promise.all(
    Array.from({ length: 8 }, (_, index) => reserveGuardedAction(
      sameDir,
      reservationInput(index, { idempotencyHash: hash('c'), maxPerWindow: 10 })
    ))
  );
  assert.equal(sameClaim.filter((result) => result.status === 'reserved').length, 1);
  assert.equal(sameClaim.filter((result) => result.status === 'claim-pending').length, 7);

  const store = JSON.parse(await fs.readFile(path.join(sameDir, 'guarded-actions-v1.json'), 'utf8'));
  assert.equal(store.rates['fixture-write'].length, 1);
  assert.equal(store.claims[hash('c')].state, 'pending');

  const rateStore = JSON.parse(await fs.readFile(path.join(dir, 'guarded-actions-v1.json'), 'utf8'));
  assert.equal(rateStore.rates['fixture-write'].length, 3);
  assert.deepEqual(
    Object.keys(rateStore.claims).sort(),
    rateResults.filter((result) => result.status === 'reserved').map((result) => result.claim.createdAt - 1_000_000_000_000)
      .map((index) => hash((index % 10).toString(16)))
      .sort()
  );

  const mixedDir = await tmpStateDir();
  await Promise.all([
    reserveGuardedAction(mixedDir, reservationInput(1, { actionType: 'like', idempotencyHash: hash('1') })),
    reserveGuardedAction(mixedDir, reservationInput(2, { actionType: 'comment', idempotencyHash: hash('2') }))
  ]);
  const mixedStore = JSON.parse(await fs.readFile(path.join(mixedDir, 'guarded-actions-v1.json'), 'utf8'));
  assert.equal(mixedStore.rates.like.length, 1);
  assert.equal(mixedStore.rates.comment.length, 1);
  assert.deepEqual(Object.keys(mixedStore.claims).sort(), [hash('1'), hash('2')]);
});

test('guarded claims finalize, block replay, and require interactive reconciliation', async () => {
  const dir = await tmpStateDir();
  const input = reservationInput(1, { idempotencyHash: hash('d') });
  assert.equal((await reserveGuardedAction(dir, input)).status, 'reserved');

  await finalizeGuardedAction(dir, {
    idempotencyHash: input.idempotencyHash,
    state: 'ambiguous',
    now: input.now + 1
  });
  assert.equal((await inspectGuardedAction(dir, input.idempotencyHash)).state, 'ambiguous');
  assert.equal((await reserveGuardedAction(dir, { ...input, now: input.now + 2 })).status, 'claim-ambiguous');
  await assert.rejects(
    reconcileGuardedAction(dir, {
      idempotencyHash: input.idempotencyHash,
      resolution: 'clear',
      interactive: false,
      confirmed: true
    }),
    /interactive confirmation/
  );
  await assert.rejects(
    reconcileGuardedAction(dir, {
      idempotencyHash: input.idempotencyHash,
      resolution: 'verified',
      evidenceIdHash: hash('f'),
      interactive: true,
      confirmed: true,
      now: Number.NaN
    }),
    /now must be finite/
  );
  assert.equal((await inspectGuardedAction(dir, input.idempotencyHash)).state, 'ambiguous');
  assert.equal(await reconcileGuardedAction(dir, {
    idempotencyHash: input.idempotencyHash,
    resolution: 'clear',
    interactive: true,
    confirmed: true
  }), null);
  assert.equal(await inspectGuardedAction(dir, input.idempotencyHash), null);
});

test('verified guarded claims require evidence and remain distinguishable on replay', async () => {
  const dir = await tmpStateDir();
  const input = reservationInput(2, { idempotencyHash: hash('e') });
  await reserveGuardedAction(dir, input);
  await assert.rejects(
    finalizeGuardedAction(dir, { idempotencyHash: input.idempotencyHash, state: 'verified' }),
    /evidenceIdHash/
  );
  await finalizeGuardedAction(dir, {
    idempotencyHash: input.idempotencyHash,
    state: 'verified',
    evidenceIdHash: hash('f'),
    now: input.now + 1
  });
  const replay = await reserveGuardedAction(dir, { ...input, now: input.now + 2 });
  assert.equal(replay.status, 'already-verified');
  assert.equal(replay.claim.evidenceIdHash, hash('f'));
});

test('guarded-action store corruption fails closed', async () => {
  const dir = await tmpStateDir();
  await fs.writeFile(path.join(dir, 'guarded-actions-v1.json'), JSON.stringify({
    version: 1,
    rates: { 'fixture-write': ['not-a-number'] },
    claims: {}
  }));
  await assert.rejects(
    reserveGuardedAction(dir, reservationInput()),
    /invalid guarded-action rate state/
  );
});
