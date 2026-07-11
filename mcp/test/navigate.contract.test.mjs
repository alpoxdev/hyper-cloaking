import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../src/session-manager.mjs';
import { makeNavigateTool } from '../src/tools/navigate.mjs';

/** Parses an MCP CallTool result payload. */
function payload(result) {
  return JSON.parse(result.content[0].text);
}

/** Fake page recording goto calls and returning a controllable final URL. */
function fakePage(finalUrl) {
  const calls = [];
  return {
    calls,
    page: {
      async goto(url) {
        calls.push(url);
        return { status: () => 200 };
      },
      url: () => finalUrl
    }
  };
}

test('cloak_navigate proceeds only on an ok target-safety disposition', async () => {
  const manager = createSessionManager();
  const { page, calls } = fakePage('https://example.com/');
  await manager.launch(async () => ({ browser: { close: async () => {} }, page }));
  const nav = makeNavigateTool(manager);

  const result = payload(await nav.handler({ url: 'https://example.com/' }));
  assert.equal(result.status, 'ok');
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(calls, ['https://example.com/']);
});

test('cloak_navigate refuses an unsafe scheme with needs-preflight and performs NO navigation', async () => {
  const manager = createSessionManager();
  const { page, calls } = fakePage('about:blank');
  await manager.launch(async () => ({ browser: { close: async () => {} }, page }));
  const nav = makeNavigateTool(manager);

  const result = payload(await nav.handler({ url: 'file:///etc/passwd' }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(calls.length, 0, 'no navigation attempted for a blocked target');
});

test('cloak_navigate requires approval for insecure http (approvalRequired) with no navigation', async () => {
  const manager = createSessionManager();
  const { page, calls } = fakePage('http://example.com/');
  await manager.launch(async () => ({ browser: { close: async () => {} }, page }));
  const nav = makeNavigateTool(manager);

  const result = payload(await nav.handler({ url: 'http://example.com/' }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.disposition, 'approvalRequired');
  assert.equal(calls.length, 0);
});

test('cloak_navigate flags an off-origin unsafe redirect after load', async () => {
  const manager = createSessionManager();
  // Requested a safe https URL, but the page ends up on an unsafe scheme.
  const { page } = fakePage('file:///tmp/evil');
  await manager.launch(async () => ({ browser: { close: async () => {} }, page }));
  const nav = makeNavigateTool(manager);

  const result = payload(await nav.handler({ url: 'https://example.com/' }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.code, 'unsafe-redirect');
});

test('cloak_navigate before launch returns needs-preflight (no-session)', async () => {
  const manager = createSessionManager();
  const nav = makeNavigateTool(manager);
  const result = payload(await nav.handler({ url: 'https://example.com/' }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.code, 'no-session');
});
