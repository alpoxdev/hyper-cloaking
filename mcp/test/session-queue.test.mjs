import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../src/session-manager.mjs';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal fake browser/page pair with a close spy. */
function fakeLaunch() {
  const state = { closed: false };
  return {
    factory: async () => ({
      browser: { close: async () => { state.closed = true; } },
      page: { url: () => 'about:blank' },
      account: 'acct'
    }),
    state
  };
}

test('every session-touching call is serialized in arrival order (FIFO)', async () => {
  const manager = createSessionManager();
  const { factory } = fakeLaunch();
  await manager.launch(factory);

  const order = [];
  const a = manager.withSession(async () => {
    await delay(40);
    order.push('a');
    return { status: 'ok' };
  });
  const b = manager.withSession(async () => {
    order.push('b');
    return { status: 'ok' };
  });
  await Promise.all([a, b]);
  // b must not run mid-a: it waits its turn, so a snapshot can never see a raced page.
  assert.deepEqual(order, ['a', 'b']);
});

test('calls past the queue depth bound get a structured busy signal, not a raced page', async () => {
  const manager = createSessionManager({ maxQueueDepth: 1 });
  const { factory } = fakeLaunch();
  await manager.launch(factory);

  const first = manager.withSession(async () => {
    await delay(30);
    return { status: 'ok', tag: 'first' };
  });
  const second = await manager.withSession(async () => ({ status: 'ok', tag: 'second' }));
  assert.equal(second.status, 'busy');
  assert.equal((await first).tag, 'first');
});

test('withSession before launch returns needs-preflight (no-session)', async () => {
  const manager = createSessionManager();
  const result = await manager.withSession(async () => ({ status: 'ok' }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.code, 'no-session');
});

test('teardown refuses on pending claims unless forced', async () => {
  const manager = createSessionManager();
  const { factory, state } = fakeLaunch();
  await manager.launch(factory);
  manager._addClaim('claim-1');

  const gated = await manager.teardown({ force: false });
  assert.equal(gated.status, 'needs-confirmation');
  assert.deepEqual(gated.pendingClaims, ['claim-1']);
  assert.equal(state.closed, false, 'session stays open while claims are pending');

  const forced = await manager.teardown({ force: true });
  assert.equal(forced.status, 'torn-down');
  assert.equal(state.closed, true);
  assert.equal(manager.isActive(), false);
});

test('idle timeout tears the session down through the queue with claim-gating', async () => {
  const manager = createSessionManager({ idleTimeoutMs: 40 });
  const { factory, state } = fakeLaunch();
  await manager.launch(factory);
  assert.equal(manager.isActive(), true);
  await delay(120);
  assert.equal(state.closed, true, 'idle expiry closed the session');
  assert.equal(manager.isActive(), false);
});

test('idle timeout does NOT force-close a session with pending claims', async () => {
  const manager = createSessionManager({ idleTimeoutMs: 40 });
  const { factory, state } = fakeLaunch();
  await manager.launch(factory);
  manager._addClaim('claim-1');
  await delay(120);
  assert.equal(state.closed, false, 'idle teardown respects claim-gating');
  assert.equal(manager.isActive(), true);
});

test('launch is idempotent for a single session (already-active)', async () => {
  const manager = createSessionManager();
  const { factory } = fakeLaunch();
  assert.equal((await manager.launch(factory)).status, 'launched');
  assert.equal((await manager.launch(factory)).status, 'already-active');
});
