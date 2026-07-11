import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import {
  persistEvidence,
  recoverEvidencePublication
} from '../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/agents/evidence-writer.mjs';

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hyper-evidence-'));
  const agentStagingRoot = path.join(root, 'agent');
  const parentPrivateStagingRoot = path.join(root, 'private');
  const homeDir = path.join(root, 'home');
  await Promise.all([
    fsp.mkdir(agentStagingRoot),
    fsp.mkdir(parentPrivateStagingRoot),
    fsp.mkdir(homeDir)
  ]);
  await fsp.writeFile(path.join(agentStagingRoot, 'page.log'), 'safe log\n');
  return {
    root,
    agentStagingRoot,
    parentPrivateStagingRoot,
    homeDir,
    cleanup: { ok: true, closed: true, timedOut: false }
  };
}

test('publishes agent and generated evidence under a unique complete namespace', async () => {
  const f = await fixture();
  const evidenceId = crypto.randomUUID();
  const invocationToken = crypto.randomUUID();
  const receipt = await persistEvidence({
    ...f,
    evidenceId,
    invocationToken,
    evidenceRefs: [{ type: 'log', relPath: 'page.log', description: 'page log' }],
    diagnosticReport: { signal: 'ok' },
    failure: { code: 'none' },
    cleanupStaging: false
  });
  assert.equal(receipt.evidenceId, evidenceId);
  assert.equal(receipt.persistedPaths.length, 3);
  const marker = JSON.parse(
    await fsp.readFile(path.join(f.homeDir, 'evidence', evidenceId, '.publication.json'), 'utf8')
  );
  assert.equal(marker.state, 'complete');
  assert.equal(
    (
      await recoverEvidencePublication({
        finalDir: path.join(f.homeDir, 'evidence', evidenceId),
        invocationToken
      })
    ).status,
    'complete'
  );
});

test('same id rejects while distinct ids both succeed', async () => {
  const first = await fixture();
  const evidenceId = crypto.randomUUID();
  await persistEvidence({
    ...first,
    evidenceId,
    invocationToken: crypto.randomUUID(),
    cleanupStaging: false
  });
  await assert.rejects(
    () =>
      persistEvidence({
        ...first,
        evidenceId,
        invocationToken: crypto.randomUUID(),
        cleanupStaging: false
      }),
    /exist/i
  );
  const second = await fixture();
  await persistEvidence({
    ...second,
    evidenceId: crypto.randomUUID(),
    invocationToken: crypto.randomUUID(),
    cleanupStaging: false
  });
});

test('browser evidence requires verified cleanup', async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      persistEvidence({
        ...f,
        evidenceRefs: [{ type: 'log', relPath: 'page.log', description: 'x' }],
        cleanup: { ok: false, closed: false, timedOut: true }
      }),
    /cleanup/
  );
});

test('rejects traversal, duplicate, reserved and credential evidence', async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      persistEvidence({
        ...f,
        evidenceRefs: [{ type: 'log', relPath: '../escape', description: 'x' }]
      }),
    /unsafe|relative/
  );
  await assert.rejects(
    () =>
      persistEvidence({
        ...f,
        evidenceRefs: [{ type: 'cookie', relPath: 'page.log', description: 'x' }]
      }),
    /unsupported/
  );
  await assert.rejects(
    () =>
      persistEvidence({
        ...f,
        evidenceRefs: [
          { type: 'log', relPath: 'page.log', destination: '.git/x', description: 'x' }
        ]
      }),
    /unsafe/
  );
  await assert.rejects(
    () =>
      persistEvidence({
        ...f,
        evidenceRefs: [
          { type: 'log', relPath: 'page.log', description: 'x' },
          { type: 'log', relPath: 'page.log', description: 'y' }
        ]
      }),
    /duplicate/
  );
});

test('rejects static source symlinks and token-mismatched recovery', async () => {
  const f = await fixture();
  await fsp.symlink(
    path.join(f.agentStagingRoot, 'page.log'),
    path.join(f.agentStagingRoot, 'linked.log')
  );
  await assert.rejects(
    () =>
      persistEvidence({
        ...f,
        evidenceRefs: [{ type: 'log', relPath: 'linked.log', description: 'x' }]
      }),
    /symlink/
  );
  const second = await fixture();
  const evidenceId = crypto.randomUUID();
  const invocationToken = crypto.randomUUID();
  await persistEvidence({ ...second, evidenceId, invocationToken, cleanupStaging: false });
  await assert.rejects(
    () =>
      recoverEvidencePublication({
        finalDir: path.join(second.homeDir, 'evidence', evidenceId),
        invocationToken: crypto.randomUUID()
      }),
    /token mismatch/
  );
});

test('redacts generated secrets and supports empty refs', async () => {
  const f = await fixture();
  const receipt = await persistEvidence({
    ...f,
    diagnosticReport: { token: 'secret', message: 'authorization=abc' },
    failure: { code: 'blocked' },
    cleanupStaging: false
  });
  assert.equal(receipt.persistedPaths.length, 2);
  const content = await fsp.readFile(
    receipt.persistedPaths.find((item) => item.endsWith('diagnostics-report.json')),
    'utf8'
  );
  assert.doesNotMatch(content, /secret|abc/);
  assert.match(content, /REDACTED/);
});

test('complete recovery verifies the marker manifest and published bytes', async () => {
  const manifestFixture = await fixture();
  const manifestReceipt = await persistEvidence({
    ...manifestFixture,
    evidenceId: crypto.randomUUID(),
    invocationToken: crypto.randomUUID(),
    cleanupStaging: false
  });
  const manifestDir = path.dirname(
    manifestReceipt.persistedPaths[0] ||
      path.join(manifestFixture.homeDir, 'evidence', manifestReceipt.evidenceId, 'placeholder')
  );
  const publicationDir =
    manifestReceipt.persistedPaths.length > 0
      ? manifestDir
      : path.join(manifestFixture.homeDir, 'evidence', manifestReceipt.evidenceId);
  const markerPath = path.join(publicationDir, '.publication.json');
  const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  marker.manifestSha256 = '0'.repeat(64);
  await fsp.writeFile(markerPath, `${JSON.stringify(marker)}\n`);
  await assert.rejects(
    () =>
      recoverEvidencePublication({
        finalDir: publicationDir,
        invocationToken: manifestReceipt.invocationToken
      }),
    /manifest digest/
  );

  const bytesFixture = await fixture();
  const bytesReceipt = await persistEvidence({
    ...bytesFixture,
    evidenceId: crypto.randomUUID(),
    invocationToken: crypto.randomUUID(),
    evidenceRefs: [{ type: 'log', relPath: 'page.log', description: 'page log' }],
    cleanupStaging: false
  });
  await fsp.writeFile(bytesReceipt.persistedPaths[0], 'tampered\n');
  await assert.rejects(
    () =>
      recoverEvidencePublication({
        finalDir: path.dirname(bytesReceipt.persistedPaths[0]),
        invocationToken: bytesReceipt.invocationToken
      }),
    /hash or size mismatch/
  );
});

test('token-scoped incomplete recovery removes verified nested publications', async () => {
  const f = await fixture();
  await fsp.mkdir(path.join(f.agentStagingRoot, 'nested'));
  await fsp.writeFile(path.join(f.agentStagingRoot, 'nested', 'page.log'), 'nested evidence\n');
  const evidenceId = crypto.randomUUID();
  const invocationToken = crypto.randomUUID();
  const receipt = await persistEvidence({
    ...f,
    evidenceId,
    invocationToken,
    evidenceRefs: [
      {
        type: 'log',
        relPath: 'page.log',
        description: 'root page log'
      },
      {
        type: 'log',
        relPath: 'nested/page.log',
        description: 'nested page log'
      }
    ],
    cleanupStaging: false
  });
  const finalDir = path.join(f.homeDir, 'evidence', evidenceId);
  const markerPath = path.join(finalDir, '.publication.json');
  const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  marker.state = 'publishing';
  await fsp.writeFile(markerPath, `${JSON.stringify(marker)}\n`);
  await fsp.rm(path.join(finalDir, 'page.log'));
  assert.equal(
    (
      await recoverEvidencePublication({
        finalDir,
        invocationToken,
        removeIncomplete: true
      })
    ).status,
    'removed'
  );
  await assert.rejects(() => fsp.lstat(finalDir), { code: 'ENOENT' });
  assert.equal(receipt.persistedPaths.length, 2);
});

test('successful publication removes both owned staging roots by default', async () => {
  const f = await fixture();
  await persistEvidence({
    ...f,
    evidenceId: crypto.randomUUID(),
    invocationToken: crypto.randomUUID()
  });
  await assert.rejects(() => fsp.lstat(f.agentStagingRoot), { code: 'ENOENT' });
  await assert.rejects(() => fsp.lstat(f.parentPrivateStagingRoot), { code: 'ENOENT' });
});
