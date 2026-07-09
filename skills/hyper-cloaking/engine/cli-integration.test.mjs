import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './cli.mjs';

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
