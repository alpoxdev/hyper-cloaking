import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { runDiagnostics } from '../../../../packages/mcp-engine/src/agents/diagnostics-agent.mjs';

function setupEnvelope(
  failure = {
    code: 'missing-binary',
    phase: 'setup',
    retryable: true,
    observedSignal: 'binary missing'
  }
) {
  return {
    schemaVersion: 1,
    agent: 'setup',
    status: 'blocked',
    executionMode: 'parent',
    failure,
    result: {
      agentType: 'setup',
      setupStatus: 'needs_install',
      mcpConfig: null,
      executablePath: null,
      blockers: []
    }
  };
}

test('classifies setup failures and returns in-memory reports', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  await fsp.writeFile(path.join(stateDir, 'run.log'), 'Authorization: Bearer secret-token-value\n');
  const result = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: setupEnvelope(),
    logPaths: ['run.log'],
    screenshotPaths: [],
    stateDir
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.result.layer, 'setup');
  assert.equal(result.result.nextAuthorizedStep, 'retry_setup');
  assert.doesNotMatch(JSON.stringify(result.result.report.json), /secret-token-value/);
  assert.match(result.result.report.markdown, /Diagnostics/);
});

test('maps target safety to clarification and WAF to manual review', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  const target = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: setupEnvelope({
      code: 'origin-not-allowed',
      phase: 'target-safety',
      retryable: false,
      observedSignal: 'off origin'
    }),
    logPaths: [],
    screenshotPaths: [],
    stateDir
  });
  assert.equal(target.result.nextAuthorizedStep, 'clarify_scope');
  const waf = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: setupEnvelope({
      code: 'waf-challenge',
      phase: 'browser',
      retryable: false,
      observedSignal: 'challenge'
    }),
    logPaths: [],
    screenshotPaths: [],
    stateDir
  });
  assert.equal(waf.result.layer, 'waf_challenge');
  assert.equal(waf.result.nextAuthorizedStep, 'manual_review');
});

test('rejects traversal and unknown input without writing', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  const result = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: setupEnvelope(),
    logPaths: ['../secret'],
    screenshotPaths: [],
    stateDir
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.result.nextAuthorizedStep, 'stop');
});

test('requires a complete verified prior role envelope', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  const result = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: { agent: 'setup' },
    logPaths: [],
    screenshotPaths: [],
    stateDir
  });
  assert.equal(result.status, 'failed');
  assert.match(result.failure.observedSignal, /complete verified/);
});

test('rejects parent-directory symlink escapes without reading outside state', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-outside-'));
  await fsp.writeFile(path.join(outside, 'secret.log'), 'outside secret\n');
  await fsp.symlink(outside, path.join(stateDir, 'linked'));
  const result = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: setupEnvelope(),
    logPaths: ['linked/secret.log'],
    screenshotPaths: [],
    stateDir
  });
  const [observation] = result.result.report.json.observations;
  assert.match(observation.error, /escaped stateDir/);
  assert.equal(observation.content, undefined);
});

test('reports bounded screenshot metadata without decoding binary as text', async () => {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
  await fsp.writeFile(
    path.join(stateDir, 'page.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff])
  );
  const result = await runDiagnostics({
    schemaVersion: 1,
    lastAgentOutput: setupEnvelope(),
    logPaths: [],
    screenshotPaths: ['page.png'],
    stateDir
  });
  const [observation] = result.result.report.json.observations;
  assert.equal(observation.kind, 'screenshot');
  assert.equal(observation.size, 6);
  assert.match(observation.sha256, /^[0-9a-f]{64}$/);
  assert.equal(observation.content, undefined);
});
