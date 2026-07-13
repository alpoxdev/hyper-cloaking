import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runSetup } from '../../packages/mcp-engine/src/agents/setup-agent.mjs';
import { runBrowserTask } from '../../packages/mcp-engine/src/agents/browser-task-agent.mjs';
import { runDiagnostics } from '../../packages/mcp-engine/src/agents/diagnostics-agent.mjs';
import { dispatchParent } from '../../packages/mcp-engine/src/agents/parent-dispatcher.mjs';
import { guardAllowedOrigin } from '../../packages/mcp-engine/src/agents/lib/allowed-origin-guard.mjs';
import { startMockMcpServer } from './fixtures/agent-workflow/mock-mcp-server.mjs';

const fixtures = new URL('./fixtures/agent-workflow/', import.meta.url);
const readFixture = async (name) => JSON.parse(await fsp.readFile(new URL(name, fixtures), 'utf8'));

function setupCli() {
  return async (argv, io) => {
    const value =
      argv[0] === 'validate'
        ? { ok: true }
        : {
            ok: true,
            client: 'direct',
            home: '/tmp/hyper-cloaking-e2e',
            executablePath: '/tmp/mock-chromium',
            config: {
              command: 'npx',
              args: [
                '@playwright/mcp@latest',
                '--headless',
                '--sandbox',
                '--executable-path',
                '/tmp/mock-chromium'
              ]
            }
          };
    io.stdout.write(`${JSON.stringify(value)}\n`);
    return 0;
  };
}

test('full setup-to-verification workflow stays truthful without network or browser launch', async () => {
  const setup = await runSetup(await readFixture('setup-ready.json'), { runCli: setupCli() });
  assert.equal(setup.status, 'succeeded');

  const browserInput = await readFixture('browser-allowed.json');
  const browser = await runBrowserTask(browserInput, {
    runLiveVerification: async () => ({
      ok: false,
      finalUrl: browserInput.targetUrl,
      navigationTargetSafety: { disposition: 'ok' },
      publicNavigation: {
        finalUrl: browserInput.targetUrl,
        documentUrls: ['about:blank', browserInput.targetUrl],
        violations: []
      },
      humanization: {
        ok: false,
        configured: true,
        evidence: 'humanize:true configured',
        blocker: 'runtime humanization telemetry unavailable'
      },
      cleanup: { ok: true, closed: true, timedOut: false, blocker: null },
      evidenceRefs: [],
      blockers: ['runtime humanization telemetry unavailable']
    })
  });
  assert.equal(browser.status, 'blocked');
  assert.equal(browser.failure.code, 'humanization-proof-unavailable');
});

test('refused origin blocks before live implementation', async () => {
  const input = await readFixture('browser-refused.json');
  let calls = 0;
  const result = await runBrowserTask(input, {
    runLiveVerification: async () => {
      calls += 1;
      const guarded = guardAllowedOrigin({
        url: input.targetUrl,
        allowedOrigins: input.allowedOrigins,
        classify: () => ({ disposition: 'ok' })
      });
      if (!guarded.ok) throw new Error(guarded.reason);
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'blocked');
  assert.match(result.failure.observedSignal, /origin-not-in-allowlist/);
});

test('WAF result routes to read-only diagnostics without retry', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-e2e-'));
  const failure = await readFixture('waf-diagnostics.json');
  const prior = {
    schemaVersion: 1,
    agent: 'browser-task',
    status: 'blocked',
    executionMode: 'parent',
    failure,
    result: {
      agentType: 'browser-task',
      taskMode: 'verification-only',
      targetSafety: 'allowed',
      outcome: 'blocked',
      finalUrl: null,
      contentBoundary: {
        allowedOrigins: ['https://example.com'],
        observedOrigin: null,
        redirects: [],
        violations: []
      },
      humanizationProof: {
        enabled: true,
        telemetryAvailable: false,
        source: null,
        blocker: 'challenge'
      },
      cleanup: { ok: true, closed: true, timedOut: false, blocker: null },
      evidenceRefs: [],
      learning: { summary: '', limitations: [] }
    }
  };
  const result = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: prior,
    logPaths: [],
    screenshotPaths: [],
    stateDir
  });
  assert.equal(result.result.layer, 'waf_challenge');
  assert.equal(result.result.nextAuthorizedStep, 'manual_review');
});

test('malformed output becomes contract_failure and native unavailable does not run parent role', async () => {
  const malformed = await readFixture('malformed-output.json');
  const contract = await dispatchParent(
    {
      schemaVersion: 1,
      trigger: 'browser-task',
      executionMode: 'parent',
      input: {},
      evidence: { enabled: false }
    },
    { runBrowserTask: async () => malformed }
  );
  assert.equal(contract.route, 'contract_failure');
  let parentCalls = 0;
  const native = await dispatchParent(
    {
      schemaVersion: 1,
      trigger: 'setup',
      executionMode: 'subagent',
      input: {},
      evidence: { enabled: false }
    },
    {
      runSetup: async () => {
        parentCalls += 1;
      }
    }
  );
  assert.equal(native.route, 'native_unavailable');
  assert.equal(parentCalls, 0);
});

test('mock MCP fixture is bounded to loopback', async () => {
  const server = await startMockMcpServer();
  try {
    const response = await fetch(`${server.origin}/health`);
    assert.deepEqual(await response.json(), { ok: true, path: '/health' });
  } finally {
    await server.close();
  }
});
