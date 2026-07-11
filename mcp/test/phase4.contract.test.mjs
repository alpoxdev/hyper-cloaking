import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reserveGuardedAction } from 'hyper-cloaking-engine/action-runtime/guardrails.mjs';
import { initCredentialStore } from 'hyper-cloaking-engine/credentials.mjs';
import { createSessionManager } from '../src/session-manager.mjs';
import { makeProviderWriteTool } from '../src/tools/providers.mjs';
import { credentialsTool } from '../src/tools/credentials.mjs';
import { buildWriteOpts, classifyWriteResult, hashHex } from '../src/guardrail-bridge.mjs';

function payload(result) {
  return JSON.parse(result.content[0].text);
}

// --- guardrail-bridge units ------------------------------------------------

test('buildWriteOpts defaults dryRun TRUE and clamps cap to the bulk cap', () => {
  assert.equal(buildWriteOpts({}).dryRun, true);
  assert.equal(buildWriteOpts({ dryRun: false }).dryRun, false);
  assert.equal(buildWriteOpts({ dryRun: true }).dryRun, true);
  assert.equal(buildWriteOpts({ cap: 999 }).cap, 20);
  assert.equal(buildWriteOpts({ cap: 5 }).cap, 5);
  assert.equal(buildWriteOpts({ runId: 'r1', confirmed: true }).runId, 'r1');
});

test('classifyWriteResult maps engine envelopes to typed signals', () => {
  assert.equal(classifyWriteResult({ blocked: true, failure: { stage: 'dry-run' } }).status, 'dry-run');
  assert.equal(classifyWriteResult({ blocked: true, failure: { stage: 'confirmation-gate' } }).status, 'needs-confirmation');
  assert.equal(classifyWriteResult({ blocked: true, failure: { stage: 'rate-limit' } }).status, 'rate-limited');
  assert.equal(classifyWriteResult({ blocked: true, failure: { stage: 'bulk-cap' } }).status, 'refused');
  assert.equal(classifyWriteResult({ ok: true }).status, 'ok');
  assert.equal(classifyWriteResult({ ok: true, alreadySatisfied: true }).status, 'already-verified');
  assert.equal(classifyWriteResult({ ok: false }).status, 'ambiguous');
});

// --- fail-closed write allowlist -------------------------------------------

const writeTool = makeProviderWriteTool(createSessionManager());

test('unknown provider is refused at the write boundary', async () => {
  const r = payload(await writeTool.handler({ provider: 'nope', action: 'likePost' }));
  assert.equal(r.status, 'refused');
});

test('removed provider is refused at the write boundary', async () => {
  const r = payload(await writeTool.handler({ provider: 'reddit', action: 'upvotePost' }));
  assert.equal(r.status, 'refused');
  assert.equal(r.code, 'unknown-provider');
});

test('a READ action is refused via the write tool', async () => {
  const r = payload(await writeTool.handler({ provider: 'instagram', action: 'getUser' }));
  assert.equal(r.status, 'refused');
  assert.equal(r.code, 'unsupported-write-action');
});

// --- dryRun default at the tool boundary (no dispatch) ----------------------

test('cloak_provider_write defaults to dryRun and performs NO navigation', async () => {
  let navigated = false;
  const manager = createSessionManager();
  await manager.launch(async () => ({
    browser: { close: async () => {} },
    page: {
      url: () => 'https://www.instagram.com/p/ABC123/',
      goto: async () => { navigated = true; }
    }
  }));
  const tool = makeProviderWriteTool(manager);
  const r = payload(await tool.handler({
    provider: 'instagram',
    action: 'likePost',
    args: ['https://www.instagram.com/p/ABC123/']
  }));
  assert.equal(r.status, 'dry-run');
  assert.equal(navigated, false, 'dryRun default performed no navigation');
});

// --- guarded reservation invariant (no dispatch on non-reserved) ------------

test('a duplicate guarded reservation is never reserved twice (idempotency)', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-guard-'));
  const common = {
    actionType: 'test-write',
    idempotencyHash: hashHex('run1:key1'),
    targetHash: hashHex('target'),
    contentHash: hashHex('content'),
    runId: 'run1'
  };
  const first = await reserveGuardedAction(stateDir, common);
  assert.equal(first.status, 'reserved');
  const second = await reserveGuardedAction(stateDir, common);
  assert.notEqual(second.status, 'reserved', 'second reservation must not re-reserve');
  assert.equal(second.allowed, false);
});

test('concurrent reservations with the same key admit exactly one', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-guard-'));
  const common = {
    actionType: 'test-write',
    idempotencyHash: hashHex('runX:keyX'),
    targetHash: hashHex('t'),
    contentHash: hashHex('c'),
    runId: 'runX'
  };
  const results = await Promise.all([
    reserveGuardedAction(stateDir, common),
    reserveGuardedAction(stateDir, common)
  ]);
  const reserved = results.filter((r) => r.status === 'reserved');
  assert.equal(reserved.length, 1, 'exactly one concurrent reservation is admitted');
});

// --- credentials: redacted reads, host-only reveal --------------------------

test('cloak_credentials reveal is refused with needs-confirmation (never cleartext)', async () => {
  const r = payload(await credentialsTool.handler({ op: 'reveal', profileId: 'p1' }));
  assert.equal(r.status, 'needs-confirmation');
  assert.equal(r.code, 'reveal-host-only');
});

test('cloak_credentials list delegates to the store and returns redacted profiles', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-cred-'));
  await initCredentialStore({ home });
  const r = payload(await credentialsTool.handler({ op: 'list', workspace: home }));
  assert.equal(r.status, 'ok');
  assert.ok(Array.isArray(r.profiles));
});
