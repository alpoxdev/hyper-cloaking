import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ensureWorkspace,
  workspacePaths,
  serializeCookieConfig
} from 'hyper-cloaking-engine';
import { setupTool, makeStatusTool } from '../src/tools/setup.mjs';
import { createSessionManager } from '../src/session-manager.mjs';
import { cookiesListTool, cookiesStatusTool } from '../src/tools/cookies.mjs';

const SECRET_ALICE = 'SECRET-ALICE-VALUE-do-not-leak';
const SECRET_BOB = 'SECRET-BOB-VALUE-do-not-leak';

/** Parses an MCP CallTool result's single text payload. @param {object} result MCP result. @returns {object} Parsed payload. */
function payload(result) {
  return JSON.parse(result.content[0].text);
}

/** Creates an isolated workspace with a two-account cookie site. @returns {Promise<string>} Workspace path. */
async function makeWorkspace() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-mcp-'));
  const paths = await ensureWorkspace(ws);
  const config = {
    sites: {
      example: {
        domain: 'example.com',
        accounts: {
          alice: { cookies: [{ name: 'sid', value: SECRET_ALICE, domain: 'example.com', path: '/' }] },
          bob: { cookies: [{ name: 'sid', value: SECRET_BOB, domain: 'example.com', path: '/' }] }
        }
      }
    }
  };
  await fs.writeFile(paths.cookieFile, serializeCookieConfig(config));
  return ws;
}

test('cloak_setup creates the workspace and reports availability without launching', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-mcp-setup-'));
  const result = payload(await setupTool.handler({ workspace: ws }));
  assert.ok(['ready', 'needs-install'].includes(result.status));
  assert.equal(result.workspace, workspacePaths(ws).root);
  // Directory tree exists after setup.
  await assert.doesNotReject(fs.access(workspacePaths(ws).stateDir));
});

test('cloak_status reports an inactive session and guardrail-store presence', async () => {
  const ws = await makeWorkspace();
  const result = payload(await makeStatusTool(createSessionManager()).handler({ workspace: ws }));
  assert.equal(result.status, 'ok');
  assert.equal(result.session, null);
  assert.equal(result.queue.active, false);
  assert.equal(result.guardrailStore.present, false);
});

test('cloak_cookies_list returns needs-account when a multi-account site has no account chosen', async () => {
  const ws = await makeWorkspace();
  const result = payload(await cookiesListTool.handler({ url: 'https://example.com/', workspace: ws }));
  assert.equal(result.status, 'needs-account');
  assert.equal(result.site, 'example');
  assert.deepEqual(result.availableAccounts.sort(), ['alice', 'bob']);
});

test('cloak_cookies_list redacts every cookie value and never leaks secrets', async () => {
  const ws = await makeWorkspace();
  const result = await cookiesListTool.handler({ url: 'https://example.com/', account: 'alice', workspace: ws });
  const parsed = payload(result);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.account, 'alice');
  assert.ok(parsed.cookies.length >= 1);
  for (const cookie of parsed.cookies) {
    assert.equal(cookie.value, '[redacted]');
  }
  // The raw secret must not appear anywhere in the serialized tool output.
  assert.doesNotMatch(result.content[0].text, new RegExp(SECRET_ALICE));
  assert.doesNotMatch(result.content[0].text, new RegExp(SECRET_BOB));
});

test('cloak_cookies_status summarizes counts without listing values', async () => {
  const ws = await makeWorkspace();
  const result = await cookiesStatusTool.handler({ url: 'https://example.com/', account: 'bob', workspace: ws });
  const parsed = payload(result);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.cookieCount, 1);
  assert.doesNotMatch(result.content[0].text, new RegExp(SECRET_BOB));
});

test('invalid input is rejected as a structured signal, not a throw', async () => {
  const result = payload(await cookiesListTool.handler({ workspace: 42 }));
  assert.equal(result.status, 'invalid-args');
});
