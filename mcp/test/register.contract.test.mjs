import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  SERVER_ID,
  normalizeClient,
  generateServerRegistration,
  generateAllServerRegistrations,
  serverCommand
} from '../register.mjs';
const EXPECTED_REGISTRATION_KEYS = [
  'direct',
  'codex',
  'json',
  'claudeCode',
  'gajaeCode',
  'openclaw',
  'hermes',
  'hermesAgent'
];

const EXPECTED_REGISTRATION_TYPES = {
  direct: 'direct-command',
  codex: 'codex-toml',
  json: 'json-mcpServers',
  claudeCode: 'claude-code-cli',
  gajaeCode: 'gajae-code-guidance',
  openclaw: 'openclaw-managed-outbound',
  hermes: 'hermes-config-yaml',
  hermesAgent: 'hermes-config-yaml'
};
test('source registration default resolves to the package dist server', () => {
  const expectedServerPath = fileURLToPath(new URL('../dist/server.mjs', import.meta.url));
  const defaultCommand = serverCommand();

  assert.deepEqual(defaultCommand, {
    command: process.execPath,
    args: [expectedServerPath]
  });
  assert.deepEqual(generateServerRegistration('direct').command, [
    defaultCommand.command,
    ...defaultCommand.args
  ]);
});

test('all 8 client targets render a runnable local registration', () => {
  const all = generateAllServerRegistrations();
  const keys = Object.keys(all);
  assert.equal(keys.length, 8);
  for (const reg of Object.values(all)) {
    assert.equal(reg.serverId, SERVER_ID);
  }
  const direct = all.direct.command;
  assert.equal(direct[0], process.execPath);
  assert.match(direct[1], /mcp[/\\]dist[/\\]server\.mjs$/);
});
test('registration catalog preserves authoritative target order and coverage', () => {
  const all = generateAllServerRegistrations();
  assert.deepEqual(Object.keys(all), EXPECTED_REGISTRATION_KEYS);
  assert.deepEqual(
    Object.fromEntries(Object.entries(all).map(([key, value]) => [key, value.type])),
    EXPECTED_REGISTRATION_TYPES
  );
  for (const key of EXPECTED_REGISTRATION_KEYS) {
    const registration = all[key];
    assert.deepEqual(registration.serverId, SERVER_ID);
    assert.equal(typeof registration.type, 'string');
    if (key === 'direct' || key === 'claudeCode') {
      assert.ok(Array.isArray(registration.command));
      assert.equal(typeof registration.shellCommand, 'string');
    }
    if (key === 'json' || key === 'openclaw' || key === 'gajaeCode') {
      const config =
        key === 'openclaw'
          ? registration.config.mcp.servers[SERVER_ID]
          : registration.config.mcpServers[SERVER_ID];
      assert.deepEqual(Object.keys(config).sort(), ['args', 'command']);
      assert.equal(config.command, process.execPath);
      assert.ok(Array.isArray(config.args));
    }
    if (key === 'codex')
      assert.match(registration.config, new RegExp(`\\[mcp_servers\\.${SERVER_ID}\\]`));
    if (key === 'hermes' || key === 'hermesAgent') {
      assert.equal(registration.configPath, '~/.hermes/config.yaml');
      assert.match(registration.config, /idle_timeout_seconds: 300/);
    }
  }
});

test('codex renders TOML, json renders mcpServers, hermes renders idle_timeout', () => {
  assert.match(generateServerRegistration('codex').config, /\[mcp_servers\.hyper-cloaking-mcp\]/);
  assert.ok(generateServerRegistration('json').config.mcpServers[SERVER_ID]);
  assert.match(generateServerRegistration('hermes').config, /idle_timeout_seconds: 300/);
  assert.equal(
    generateServerRegistration('openclaw').config.mcp.servers[SERVER_ID].command,
    process.execPath
  );
});

test('client aliases resolve (claude->claude-code, gjc->gajae-code)', () => {
  assert.equal(normalizeClient('claude'), 'claude-code');
  assert.equal(normalizeClient('gjc'), 'gajae-code');
});

test('unsupported client is rejected', () => {
  assert.throws(() => generateServerRegistration('notaclient'), /Unsupported MCP client/);
});

test('command override is honored (e.g. node dist path)', () => {
  const reg = generateServerRegistration('json', {
    command: 'node',
    args: ['/opt/hyper-cloaking-mcp/dist/server.mjs']
  });
  assert.equal(reg.config.mcpServers[SERVER_ID].command, 'node');
  assert.deepEqual(reg.config.mcpServers[SERVER_ID].args, [
    '/opt/hyper-cloaking-mcp/dist/server.mjs'
  ]);
});

test('shellCommand uses POSIX-safe quoting for expansion characters and apostrophes', () => {
  const reg = generateServerRegistration('direct', {
    command: '/opt/node $HOME',
    args: ["$(touch /tmp/pwned)'quote"]
  });
  assert.deepEqual(reg.command, ['/opt/node $HOME', "$(touch /tmp/pwned)'quote"]);
  assert.equal(reg.shellCommand, "'/opt/node $HOME' '$(touch /tmp/pwned)'\"'\"'quote'");
});
