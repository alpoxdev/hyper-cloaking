import { test } from 'node:test';
import assert from 'node:assert/strict';

// This source-local test verifies MCP implementation imports only. Public export
// coverage belongs to the installed-package consumer test.
test('mcp source-local engine modules provide required implementation symbols', async () => {
  const browserUtils = await import('../engine/browser-utils.mjs');
  assert.equal(typeof browserUtils.launchCloakBrowser, 'function');
  assert.equal(typeof browserUtils.ensureWorkspace, 'function');

  const mouse = await import('../engine/mouse.mjs');
  const keyboard = await import('../engine/keyboard.mjs');
  const scroll = await import('../engine/scroll.mjs');
  assert.equal(typeof mouse.humanClick, 'function');
  assert.equal(typeof keyboard.humanType, 'function');
  assert.equal(typeof scroll.humanScroll, 'function');

  const guardrails = await import('../engine/action-runtime/guardrails.mjs');
  assert.equal(typeof guardrails.reserveGuardedAction, 'function');
  assert.equal(typeof guardrails.finalizeGuardedAction, 'function');
  assert.equal(typeof guardrails.enforceBulkCap, 'function');
  assert.equal(guardrails.DEFAULT_BULK_CAP, 20);

  const providers = await import('../engine/providers/index.mjs');
  assert.equal(typeof providers.resolveProviderForUrl, 'function');
  assert.equal(typeof providers.getProvider, 'function');

  const targetSafety = await import('../engine/target-safety.mjs');
  assert.equal(typeof targetSafety.classifyTargetUrl, 'function');
  assert.equal(typeof targetSafety.assertNavigationAllowed, 'function');
});
