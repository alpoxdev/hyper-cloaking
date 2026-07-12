import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureWorkspace, workspacePaths, serializeCookieConfig } from 'hyper-cloaking-engine';
import { setupTool, makeStatusTool } from '../src/tools/setup.mjs';
import { createSessionManager } from '../src/session-manager.mjs';
import { cookiesListTool, cookiesStatusTool } from '../src/tools/cookies.mjs';
import { allTools, sessionManager } from '../src/tools/index.mjs';

const SECRET_ALICE = 'SECRET-ALICE-VALUE-do-not-leak';
const SECRET_BOB = 'SECRET-BOB-VALUE-do-not-leak';

/** Parses an MCP CallTool result's single text payload. @param {object} result MCP result. @returns {object} Parsed payload. */
function payload(result) {
  return JSON.parse(result.content[0].text);
}
const EXPECTED_TOOL_NAMES = [
  'cloak_setup',
  'cloak_status',
  'cloak_cookies_list',
  'cloak_cookies_status',
  'cloak_provider_capabilities',
  'cloak_launch',
  'cloak_teardown',
  'cloak_navigate',
  'cloak_snapshot',
  'cloak_click',
  'cloak_type',
  'cloak_scroll',
  'cloak_screenshot',
  'cloak_provider_read',
  'cloak_provider_write',
  'cloak_credentials'
];

const EXPECTED_INPUT_SCHEMAS = {
  cloak_setup: {
    type: 'object',
    additionalProperties: false,
    properties: { workspace: { type: 'string', description: 'Optional workspace override.' } }
  },
  cloak_status: {
    type: 'object',
    additionalProperties: false,
    properties: { workspace: { type: 'string' } }
  },
  cloak_cookies_list: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Target URL used to select the cookie site.' },
      site: { type: 'string', description: 'Explicit cookie site override.' },
      account: { type: 'string', description: 'Explicit account within the site.' },
      workspace: { type: 'string' }
    }
  },
  cloak_cookies_status: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Target URL used to select the cookie site.' },
      site: { type: 'string', description: 'Explicit cookie site override.' },
      account: { type: 'string', description: 'Explicit account within the site.' },
      workspace: { type: 'string' }
    }
  },
  cloak_provider_capabilities: { type: 'object', additionalProperties: false, properties: {} },
  cloak_launch: {
    type: 'object',
    additionalProperties: false,
    properties: {
      headless: { type: 'boolean', default: true },
      account: { type: 'string' },
      persistent: { type: 'boolean', default: false },
      workspace: { type: 'string' }
    }
  },
  cloak_teardown: {
    type: 'object',
    additionalProperties: false,
    properties: { force: { type: 'boolean', default: false } }
  },
  cloak_navigate: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: { url: { type: 'string' } }
  },
  cloak_snapshot: {
    type: 'object',
    additionalProperties: false,
    properties: { maxChars: { type: 'integer', minimum: 500 } }
  },
  cloak_click: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref: { type: 'string', description: 'Bare aria-ref id (eXX) from cloak_snapshot.' },
      selector: { type: 'string', description: 'CSS or XPath selector alternative to ref.' }
    },
    anyOf: [{ required: ['ref'] }, { required: ['selector'] }]
  },
  cloak_type: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      ref: { type: 'string' },
      selector: { type: 'string' },
      text: { type: 'string' },
      clear: { type: 'boolean' },
      submit: { type: 'boolean' }
    },
    anyOf: [{ required: ['ref'] }, { required: ['selector'] }]
  },
  cloak_scroll: {
    type: 'object',
    additionalProperties: false,
    properties: { distance: { type: 'number' }, steps: { type: 'integer', minimum: 1 } }
  },
  cloak_screenshot: {
    type: 'object',
    additionalProperties: false,
    properties: { fullPage: { type: 'boolean' }, workspace: { type: 'string' } }
  },
  cloak_provider_read: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      provider: { type: 'string', description: 'Explicit provider id (else resolved from url).' },
      url: { type: 'string', description: 'Target URL used to resolve the provider.' },
      action: {
        type: 'string',
        description: 'Read action name (must be on the provider read allowlist).'
      },
      args: { type: 'array', description: 'Positional args passed after the session.' }
    }
  },
  cloak_provider_write: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      provider: { type: 'string' },
      url: { type: 'string' },
      action: {
        type: 'string',
        description: 'Write action name (must be on the provider write allowlist).'
      },
      args: {
        type: 'array',
        description: 'Positional args passed after the session, before opts.'
      },
      dryRun: { type: 'boolean', description: 'Defaults true; pass false to actually write.' },
      runId: { type: 'string' },
      confirmed: { type: 'boolean' },
      cap: { type: 'integer', minimum: 1 },
      opts: {
        type: 'object',
        additionalProperties: true,
        description: 'Extra action opts (e.g. per-action enable flag).'
      }
    }
  },
  cloak_credentials: {
    type: 'object',
    additionalProperties: false,
    required: ['op'],
    properties: {
      op: { type: 'string', enum: ['list', 'inspect', 'reveal'] },
      provider: { type: 'string' },
      profileId: { type: 'string' },
      workspace: {
        type: 'string',
        description: 'Credential home (defaults to the runtime workspace).'
      }
    }
  }
};

/** Creates an isolated workspace with a two-account cookie site. @returns {Promise<string>} Workspace path. */
async function makeWorkspace() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-mcp-'));
  const paths = await ensureWorkspace(ws);
  const config = {
    sites: {
      example: {
        domain: 'example.com',
        accounts: {
          alice: {
            cookies: [{ name: 'sid', value: SECRET_ALICE, domain: 'example.com', path: '/' }]
          },
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
  const result = payload(
    await cookiesListTool.handler({ url: 'https://example.com/', workspace: ws })
  );
  assert.equal(result.status, 'needs-account');
  assert.equal(result.site, 'example');
  assert.deepEqual(result.availableAccounts.sort(), ['alice', 'bob']);
});

test('cloak_cookies_list redacts every cookie value and never leaks secrets', async () => {
  const ws = await makeWorkspace();
  const result = await cookiesListTool.handler({
    url: 'https://example.com/',
    account: 'alice',
    workspace: ws
  });
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
  const result = await cookiesStatusTool.handler({
    url: 'https://example.com/',
    account: 'bob',
    workspace: ws
  });
  const parsed = payload(result);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.cookieCount, 1);
  assert.doesNotMatch(result.content[0].text, new RegExp(SECRET_BOB));
});

test('invalid input is rejected as a structured signal, not a throw', async () => {
  const result = payload(await cookiesListTool.handler({ workspace: 42 }));
  assert.equal(result.status, 'invalid-args');
});
test('catalog has an authoritative order and exact descriptor schemas', () => {
  assert.deepEqual(
    allTools.map(({ name }) => name),
    EXPECTED_TOOL_NAMES
  );
  for (const tool of allTools) {
    assert.deepEqual(Object.keys(tool).sort(), ['description', 'handler', 'inputSchema', 'name']);
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.handler, 'function');
    assert.deepEqual(tool.inputSchema, EXPECTED_INPUT_SCHEMAS[tool.name]);
  }
});

test('catalog stateful tools observe the one shared session manager seam', async () => {
  const status = allTools.find(({ name }) => name === 'cloak_status');
  const teardown = allTools.find(({ name }) => name === 'cloak_teardown');
  const originalSnapshot = sessionManager.snapshot;
  const originalTeardown = sessionManager.teardown;
  try {
    sessionManager.snapshot = () => ({
      active: false,
      account: null,
      createdAt: null,
      lastUsedAt: null,
      pendingClaims: 0,
      queueDepth: 7
    });
    sessionManager.teardown = async () => ({ status: 'observed-shared-manager' });
    assert.equal((await payload(await status.handler({}))).queue.depth, 7);
    assert.equal((await payload(await teardown.handler({}))).status, 'observed-shared-manager');
  } finally {
    sessionManager.snapshot = originalSnapshot;
    sessionManager.teardown = originalTeardown;
  }
});
