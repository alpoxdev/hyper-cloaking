import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchParent } from '../../../../mcp/engine/agents/parent-dispatcher.mjs';

const request = {
  schemaVersion: 1,
  trigger: 'setup',
  executionMode: 'parent',
  input: {},
  evidence: { enabled: false }
};

const setupEnvelope = {
  schemaVersion: 1,
  agent: 'setup',
  status: 'succeeded',
  executionMode: 'parent',
  failure: null,
  result: {
    agentType: 'setup',
    setupStatus: 'ready',
    mcpConfig: { type: 'direct', config: {} },
    executablePath: '/tmp/chromium',
    blockers: []
  }
};

test('parent_default invokes exactly one role and maps success', async () => {
  let calls = 0;
  const result = await dispatchParent(request, {
    runSetup: async () => {
      calls += 1;
      return setupEnvelope;
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.route, 'parent_default');
  assert.equal(result.exitCode, 0);
});

test('native_unavailable never falls back to parent', async () => {
  let calls = 0;
  const result = await dispatchParent(
    { ...request, executionMode: 'subagent' },
    {
      runSetup: async () => {
        calls += 1;
        return setupEnvelope;
      }
    }
  );
  assert.equal(result.route, 'native_unavailable');
  assert.equal(result.exitCode, 1);
  assert.equal(calls, 0);
});

test('spawn_failed does not retry', async () => {
  let calls = 0;
  const result = await dispatchParent(
    { ...request, executionMode: 'subagent' },
    {
      nativeAdapter: {
        spawn: async () => {
          calls += 1;
          throw new Error('transport');
        }
      }
    }
  );
  assert.equal(result.route, 'spawn_failed');
  assert.equal(calls, 1);
});

test('malformed output becomes contract_failure', async () => {
  const result = await dispatchParent(request, { runSetup: async () => ({ malformed: true }) });
  assert.equal(result.route, 'contract_failure');
  assert.equal(result.exitCode, 1);
});

test('verified role output must match the requested trigger', async () => {
  const diagnosticsEnvelope = {
    schemaVersion: 1,
    agent: 'diagnostics',
    status: 'succeeded',
    executionMode: 'parent',
    failure: null,
    result: {
      agentType: 'diagnostics',
      layer: 'unknown',
      observedSignal: 'none',
      lastSafeAction: null,
      nextAuthorizedStep: 'stop',
      report: { json: {}, markdown: '# Diagnostics' }
    }
  };
  const result = await dispatchParent(request, {
    runSetup: async () => diagnosticsEnvelope
  });
  assert.equal(result.route, 'contract_failure');
  assert.equal(result.status, 'failed');
  assert.equal(result.envelope, diagnosticsEnvelope);
  assert.equal(result.failure.code, 'agent-trigger-mismatch');
  assert.match(result.failure.observedSignal, /setup.*diagnostics/);
});

test('verified invalid role input routes contract failure and preserves evidence', async () => {
  let publishes = 0;
  const invalidEnvelope = {
    ...setupEnvelope,
    status: 'blocked',
    failure: {
      code: 'setup-input-invalid',
      phase: 'setup-input',
      retryable: false,
      observedSignal: 'sandbox must be true'
    },
    result: {
      agentType: 'setup',
      setupStatus: 'blocked',
      mcpConfig: null,
      executablePath: null,
      blockers: [{ code: 'permission', message: 'sandbox must be true', recoverable: false }]
    }
  };
  const result = await dispatchParent(
    { ...request, evidence: { enabled: true, homeDir: '/tmp/home', publication: {} } },
    {
      runSetup: async () => invalidEnvelope,
      persistEvidence: async () => {
        publishes += 1;
      }
    }
  );
  assert.equal(result.route, 'contract_failure');
  assert.equal(result.envelope, invalidEnvelope);
  assert.equal(result.failure.code, 'setup-input-invalid');
  assert.equal(publishes, 0);
});

test('dispatcher-generated route failures retain their observed signal', async () => {
  const result = await dispatchParent({ ...request, executionMode: 'subagent' });
  assert.equal(result.failure.code, 'native_unavailable');
  assert.match(result.failure.observedSignal, /adapter/);
});

test('role throws once and becomes contract failure', async () => {
  let calls = 0;
  const result = await dispatchParent(request, {
    runSetup: async () => {
      calls += 1;
      throw new Error('boom');
    }
  });
  assert.equal(result.route, 'contract_failure');
  assert.equal(calls, 1);
});

test('browser cleanup failure prevents evidence publisher invocation', async () => {
  let publishes = 0;
  const browserEnvelope = {
    schemaVersion: 1,
    agent: 'browser-task',
    status: 'blocked',
    executionMode: 'parent',
    failure: {
      code: 'browser-cleanup-unverified',
      phase: 'browser-live',
      retryable: false,
      observedSignal: 'close timeout'
    },
    result: {
      agentType: 'browser-task',
      taskMode: 'verification-only',
      targetSafety: 'allowed',
      outcome: 'blocked',
      finalUrl: 'https://example.com/',
      contentBoundary: {
        allowedOrigins: ['https://example.com'],
        observedOrigin: 'https://example.com',
        redirects: [],
        violations: []
      },
      humanizationProof: {
        enabled: true,
        telemetryAvailable: false,
        source: null,
        blocker: 'unavailable'
      },
      cleanup: { ok: false, closed: false, timedOut: true, blocker: 'close timeout' },
      evidenceRefs: [],
      learning: { summary: '', limitations: [] }
    }
  };
  const result = await dispatchParent(
    {
      ...request,
      trigger: 'browser-task',
      evidence: { enabled: true, homeDir: '/tmp/home', publication: {} }
    },
    {
      runBrowserTask: async () => browserEnvelope,
      persistEvidence: async () => {
        publishes += 1;
      }
    }
  );
  assert.equal(result.exitCode, 1);
  assert.equal(publishes, 0);
  assert.equal(result.failure.code, 'browser-cleanup-unverified');
  assert.match(result.failure.observedSignal, /close timeout/);
});
