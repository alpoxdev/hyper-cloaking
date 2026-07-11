import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../src/session-manager.mjs';
import { makeProviderReadTool } from '../src/tools/providers.mjs';

function payload(result) {
  return JSON.parse(result.content[0].text);
}

const tool = makeProviderReadTool(createSessionManager());

test('unknown explicit provider id is refused fail-closed', async () => {
  const result = payload(await tool.handler({ provider: 'not-a-provider', action: 'getUser' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unknown-provider');
});

test('unknown host resolves to generic and is refused (no read actions)', async () => {
  const result = payload(await tool.handler({ url: 'https://totally-unknown-host.example/', action: 'getUser' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'no-read-actions');
  assert.equal(result.provider, 'generic');
});

test('invalid url is refused fail-closed', async () => {
  const result = payload(await tool.handler({ url: 'not a url', action: 'getUser' }));
  assert.equal(result.status, 'refused');
});

test('a write action is refused at the read boundary', async () => {
  const result = payload(await tool.handler({ provider: 'instagram', action: 'likePost', args: [] }));
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unsupported-read-action');
});

test('a helper/normalize function is not dispatchable as a read', async () => {
  const result = payload(await tool.handler({ provider: 'x', action: 'normalizeUserRef', args: [] }));
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unsupported-read-action');
});

test('a valid read action passes the allowlist and reaches the session gate', async () => {
  // No live session -> needs-preflight proves resolution + allowlist passed and
  // the tool would dispatch against a session (without needing a browser here).
  const result = payload(await tool.handler({ provider: 'instagram', action: 'getUser', args: ['someuser'] }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.code, 'no-session');
});

test('provider resolved by URL passes the allowlist for a real host', async () => {
  const result = payload(await tool.handler({ url: 'https://www.reddit.com/r/node', action: 'getSubreddit', args: ['node'] }));
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.code, 'no-session');
});
