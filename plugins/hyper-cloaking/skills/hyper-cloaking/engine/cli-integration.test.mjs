import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './cli.mjs';
import { generateMcpConfig, mcpCommand } from './mcp-config.mjs';
import { buildNoSandboxWarningSafeCloakOptions } from './browser-utils.mjs';


async function runJson(args) {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli([...args, '--json'], {
    stdout: { write: (chunk) => { stdout += String(chunk); } },
    stderr: { write: (chunk) => { stderr += String(chunk); } }
  });
  assert.equal(stderr, '');
  return { exitCode, json: JSON.parse(stdout) };
}

function assertCompletionShape(payload) {
  for (const key of ['targetSafety', 'outcome', 'failure', 'contentBoundary', 'learning']) {
    assert.ok(Object.hasOwn(payload, key), `missing ${key}`);
  }
}

test('validate --json reports helper metadata and mandatory completion shape without launch', async () => {
  const { exitCode, json } = await runJson(['validate']);

  assert.equal(exitCode, 0);
  assert.equal(json.command, 'validate');
  assert.equal(json.network, 'not-used');
  assert.equal(json.sideEffects, 'none');
  assert.ok(json.helperMetadata.some((check) => check.name === 'classifyTargetUrl' && check.ok));
  assertCompletionShape(json);
});

test('smoke --json reports samples and mandatory completion shape without live launch', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-cli-test-'));
  const { exitCode, json } = await runJson(['smoke', '--home', home]);

  assert.equal(exitCode, 0);
  assert.equal(json.command, 'smoke');
  assert.equal(json.network, 'not-used');
  assert.equal(json.liveLaunch, 'not-attempted');
  assert.ok(json.targetSafetySample);
  assert.ok(json.outcomeReportSample);
  assert.ok(json.diagnosticSample);
  assert.ok(json.contentBoundarySample);
  assert.ok(json.evidenceScopePlan);
  assertCompletionShape(json);
});

test('mcp-config --json blocked path reports diagnostics and mandatory completion shape', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-mcp-test-'));
  const { exitCode, json } = await runJson(['mcp-config', '--home', home, '--client', 'json']);

  assert.equal(exitCode, 1);
  assert.equal(json.command, 'mcp-config');
  assert.equal(json.status, 'blocked');
  assert.equal(json.network, 'not-used');
  assert.ok(Array.isArray(json.blockers));
  assert.ok(json.failure);
  assertCompletionShape(json);
});
test('mcp-config commands enable sandbox by default', () => {
  const command = mcpCommand(process.execPath, { headless: false });
  assert.ok(command.args.includes('--sandbox'));
  assert.equal(command.args.includes('--headless'), false);
  assert.equal(command.args.includes('--no-sandbox'), false);
});

test('OpenClaw MCP config uses managed outbound mcp.servers shape and preserves command args', () => {
  const config = generateMcpConfig({ client: 'openclaw', executablePath: process.execPath });
  const server = config.config.mcp.servers['hyper-cloaking'];

  assert.equal(config.type, 'openclaw-managed-outbound');
  assert.equal(server.command, 'npx');
  assert.equal(server.args[0], '@playwright/mcp@latest');
  assert.ok(server.args.includes('--headless'));
  assert.ok(server.args.includes('--sandbox'));
  assert.ok(server.args.includes('--executable-path'));
  assert.equal(server.args[server.args.indexOf('--executable-path') + 1], process.execPath);
});

test('Hermes MCP config renders config.yaml-compatible mcp_servers YAML and preserves command args', () => {
  const config = generateMcpConfig({ client: 'hermes-agent', executablePath: process.execPath });

  assert.equal(config.type, 'hermes-config-yaml');
  assert.equal(config.configPath, '~/.hermes/config.yaml');
  assert.match(config.config, /^mcp_servers:\n  hyper-cloaking:\n/m);
  assert.match(config.config, /    command: "npx"\n/);
  assert.match(config.config, /    args:\n      - "@playwright\/mcp@latest"\n      - "--headless"\n      - "--sandbox"\n      - "--executable-path"\n/);
  assert.match(config.config, new RegExp(`      - ${JSON.stringify(process.execPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`));
  assert.match(config.config, /    idle_timeout_seconds: 300\n/);
});

test('CloakBrowser JS options suppress no-sandbox warning flag', () => {
  const options = buildNoSandboxWarningSafeCloakOptions(
    {
      getDefaultStealthArgs: () => ['--no-sandbox', '--fingerprint=12345', '--fingerprint-platform=macos']
    },
    {
      cloakOptions: {
        args: ['--no-sandbox', '--window-size=1200,900'],
        launchOptions: { ignoreDefaultArgs: ['--enable-automation'] }
      }
    },
    { downloadsPath: '/tmp/downloads' }
  );

  assert.equal(options.stealthArgs, false);
  assert.deepEqual(options.args, ['--fingerprint=12345', '--fingerprint-platform=macos', '--window-size=1200,900']);
  assert.deepEqual(options.launchOptions.ignoreDefaultArgs, ['--enable-automation', '--enable-unsafe-swiftshader', '--no-sandbox']);
  assert.equal(options.launchOptions.downloadsPath, '/tmp/downloads');
});

test('live --json blocks without fake success and still reports completion shape', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-live-test-'));
  const { exitCode, json } = await runJson(['live', '--home', home, '--target', 'about:blank']);

  assert.equal(exitCode, 1);
  assert.equal(json.command, 'live');
  assert.equal(json.ok, false);
  assert.equal(json.status, 'blocked');
  assert.equal(json.liveLaunch, 'not-attempted');
  assert.ok(Array.isArray(json.blockers));
  assertCompletionShape(json);
});
