import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { compileAgentEnvelopeValidator, runParentVerifyCli, verifyAgentEnvelope } from './parent-verify.mjs';

const setupResult = {
  agentType: 'setup',
  setupStatus: 'ready',
  mcpConfig: { type: 'direct', config: { command: 'npx', args: ['--sandbox'] } },
  executablePath: '/tmp/chromium',
  blockers: []
};

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    agent: 'setup',
    status: 'succeeded',
    executionMode: 'parent',
    failure: null,
    result: setupResult,
    ...overrides
  };
}

test('strict Ajv2020 verifier accepts a complete setup envelope', () => {
  assert.equal(compileAgentEnvelopeValidator()(envelope()), true);
  assert.deepEqual(verifyAgentEnvelope(envelope()), { ok: true, value: envelope() });
});

test('blocked status requires a complete result and non-null failure', () => {
  const value = envelope({
    status: 'blocked',
    failure: { code: 'missing-binary', phase: 'setup', retryable: true, observedSignal: 'binary missing' },
    result: { ...setupResult, setupStatus: 'needs_install', mcpConfig: null, executablePath: null }
  });
  assert.equal(verifyAgentEnvelope(value).ok, true);
  assert.equal(verifyAgentEnvelope({ ...value, failure: null }).ok, false);
  assert.equal(verifyAgentEnvelope({ ...value, result: {} }).ok, false);
});

test('unknown fields are contract failures', () => {
  const result = verifyAgentEnvelope(envelope({ surprise: true }));
  assert.equal(result.ok, false);
  assert.equal(result.route, 'contract_failure');
  assert.equal(result.verifierCode, 'unknown-field');
});

test('missing required fields are classified', () => {
  const value = envelope();
  delete value.result;
  assert.equal(verifyAgentEnvelope(value).verifierCode, 'missing-required');
});

test('agent/result mismatch is rejected', () => {
  const value = envelope({ agent: 'diagnostics' });
  const result = verifyAgentEnvelope(value);
  assert.equal(result.ok, false);
  assert.equal(result.route, 'contract_failure');
});

test('succeeded status requires null failure', () => {
  assert.equal(verifyAgentEnvelope(envelope({ failure: { code: 'x', phase: 'x', retryable: false, observedSignal: 'x' } })).ok, false);
});

test('semantic success invariants reject contradictory setup and browser results', () => {
  assert.equal(
    verifyAgentEnvelope(envelope({
      result: {
        ...setupResult,
        setupStatus: 'blocked',
        mcpConfig: null,
        executablePath: null
      }
    })).ok,
    false
  );

  const browser = {
    schemaVersion: 1,
    agent: 'browser-task',
    status: 'succeeded',
    executionMode: 'parent',
    failure: null,
    result: {
      agentType: 'browser-task',
      taskMode: 'verification-only',
      targetSafety: 'allowed',
      outcome: 'verified',
      finalUrl: 'https://example.com/',
      contentBoundary: {
        allowedOrigins: ['https://example.com'],
        observedOrigin: 'https://example.com',
        redirects: ['https://example.com/'],
        violations: []
      },
      humanizationProof: {
        enabled: true,
        telemetryAvailable: false,
        source: null,
        blocker: 'telemetry unavailable'
      },
      cleanup: {
        ok: true,
        closed: true,
        timedOut: false,
        blocker: null
      },
      evidenceRefs: [],
      learning: {
        summary: 'Blocked truthfully.',
        limitations: ['telemetry unavailable']
      }
    }
  };
  assert.equal(verifyAgentEnvelope(browser).ok, false);
  browser.result.humanizationProof = {
    enabled: true,
    telemetryAvailable: true,
    source: 'runtime telemetry',
    blocker: null
  };
  browser.result.cleanup = {
    ok: false,
    closed: false,
    timedOut: true,
    blocker: 'close timed out'
  };
  assert.equal(verifyAgentEnvelope(browser).ok, false);
});

test('internal CLI emits one JSON line and exit codes 0/1/2', async () => {
  const stdin = PassThrough.from([JSON.stringify(envelope())]);
  let output = '';
  const code = await runParentVerifyCli(['--input-stdin', '--json'], { stdin, stdout: { write: (value) => { output += value; } }, stderr: { write() {} } });
  assert.equal(code, 0);
  assert.equal(output.trim().split('\n').length, 1);
  assert.equal(JSON.parse(output).ok, true);
  assert.equal(await runParentVerifyCli([], { stderr: { write() {} } }), 2);
});
