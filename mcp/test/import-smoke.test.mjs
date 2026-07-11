import { test } from 'node:test';
import assert from 'node:assert/strict';

// P0-b: prove the mcp package can import every deep engine module it needs
// through the `hyper-cloaking-engine` package name (no relative `../../` climb).
test('mcp imports deep engine modules by package name', async () => {
  const engine = await import('hyper-cloaking-engine');
  assert.equal(typeof engine.launchCloakBrowser, 'function');
  assert.equal(typeof engine.humanClick, 'function');
  assert.equal(typeof engine.humanType, 'function');
  assert.equal(typeof engine.humanScroll, 'function');
  assert.equal(typeof engine.ensureWorkspace, 'function');

  const guardrails = await import('hyper-cloaking-engine/action-runtime/guardrails.mjs');
  assert.equal(typeof guardrails.reserveGuardedAction, 'function');
  assert.equal(typeof guardrails.finalizeGuardedAction, 'function');
  assert.equal(typeof guardrails.enforceBulkCap, 'function');
  assert.equal(guardrails.DEFAULT_BULK_CAP, 20);

  const providers = await import('hyper-cloaking-engine/providers/index.mjs');
  assert.equal(typeof providers.resolveProviderForUrl, 'function');
  assert.equal(typeof providers.getProvider, 'function');

  const targetSafety = await import('hyper-cloaking-engine/target-safety.mjs');
  assert.equal(typeof targetSafety.classifyTargetUrl, 'function');
  assert.equal(typeof targetSafety.assertNavigationAllowed, 'function');
});
