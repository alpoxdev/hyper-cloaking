import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, runBenchmark } from '../bench.mjs';

test('benchmark harness contract is deterministic and semantic', async () => {
  assert.deepEqual(SCENARIOS, [
    'registry-list',
    'schema-error',
    'fifo-queue',
    'snapshot-target',
    'provider-capability-read',
    'stdio-handshake'
  ]);
  const report = await runBenchmark({
    samples: 2,
    warmup: 0,
    scenarios: SCENARIOS,
    repositoryRevision: 'contract-revision',
    repositoryRef: 'contract-ref',
    repositoryDirty: false
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.samples, 2);
  assert.equal(report.warmup, 0);
  for (const name of SCENARIOS) {
    const result = report.results[name];
    assert.ok(result);
    assert.equal(result.samples, 2);
    assert.equal(result.rawSamples.length, 2);
    for (const value of result.rawSamples) assert.equal(typeof value, 'number');
    for (const key of ['minMs', 'medianMs', 'p95Ms', 'maxMs'])
      assert.equal(typeof result[key], 'number');
    assert.ok(result.statistics);
    for (const key of ['minMs', 'medianMs', 'p95Ms', 'maxMs'])
      assert.equal(typeof result.statistics[key], 'number');
    assert.ok(result.correctness);
  }
  assert.equal(report.environment.os, report.platform);
  assert.equal(
    typeof report.environment.lockDigest === 'string' || report.environment.lockDigest === null,
    true
  );
  assert.equal(typeof report.environment.cpu === 'string' || report.environment.cpu === null, true);
  assert.equal(report.results['snapshot-target'].correctness.truncated, true);
  assert.equal(
    report.results['snapshot-target'].correctness.totalChars >
      report.results['snapshot-target'].correctness.maxChars,
    true
  );
  assert.match(report.results['snapshot-target'].correctness.prefix, /^\S/);
  assert.equal(report.results['fifo-queue'].correctness.order.join(','), '1,2,3');
  assert.deepEqual(report.results['fifo-queue'].correctness.startOrder, [1, 2, 3]);
  assert.deepEqual(report.results['fifo-queue'].correctness.finishOrder, [1, 2, 3]);
  assert.equal(report.results['fifo-queue'].correctness.active, 0);
  assert.equal(report.results['fifo-queue'].correctness.maxActive, 1);
  assert.equal(report.results['fifo-queue'].correctness.concurrency, 1);
  assert.equal(report.environment.repository.revision, 'contract-revision');
  assert.equal(report.environment.repository.ref, 'contract-ref');
  assert.equal(report.environment.repository.dirty, false);
  assert.equal(report.environment.repository.source, 'caller');
  assert.equal(report.results['schema-error'].correctness.invalidStatus, 'invalid-args');
  assert.equal(
    report.results['provider-capability-read'].correctness.refusedCode,
    'unsupported-read-action'
  );
});
