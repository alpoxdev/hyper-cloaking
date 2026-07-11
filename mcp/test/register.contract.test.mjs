import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVER_ID,
  normalizeClient,
  generateServerRegistration,
  generateAllServerRegistrations
} from '../src/register.mjs';

test('all 8 client targets render a registration for hyper-cloaking-mcp', () => {
  const all = generateAllServerRegistrations();
  const keys = Object.keys(all);
  assert.equal(keys.length, 8);
  for (const reg of Object.values(all)) {
    assert.equal(reg.serverId, SERVER_ID);
  }
});

test('codex renders TOML, json renders mcpServers, hermes renders idle_timeout', () => {
  assert.match(generateServerRegistration('codex').config, /\[mcp_servers\.hyper-cloaking-mcp\]/);
  assert.ok(generateServerRegistration('json').config.mcpServers[SERVER_ID]);
  assert.match(generateServerRegistration('hermes').config, /idle_timeout_seconds: 300/);
  assert.equal(generateServerRegistration('openclaw').config.mcp.servers[SERVER_ID].command, 'npx');
});

test('client aliases resolve (claude->claude-code, gjc->gajae-code)', () => {
  assert.equal(normalizeClient('claude'), 'claude-code');
  assert.equal(normalizeClient('gjc'), 'gajae-code');
});

test('unsupported client is rejected', () => {
  assert.throws(() => generateServerRegistration('notaclient'), /Unsupported MCP client/);
});

test('command override is honored (e.g. node dist path)', () => {
  const reg = generateServerRegistration('json', { command: 'node', args: ['/opt/hyper-cloaking-mcp/dist/server.mjs'] });
  assert.equal(reg.config.mcpServers[SERVER_ID].command, 'node');
  assert.deepEqual(reg.config.mcpServers[SERVER_ID].args, ['/opt/hyper-cloaking-mcp/dist/server.mjs']);
});
