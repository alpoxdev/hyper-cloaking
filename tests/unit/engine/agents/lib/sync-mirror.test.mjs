import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  applyMirrorSync,
  captureMirrorBaseline,
  prepareMirrorSync,
  recoverMirrorSync
} from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/agents/lib/sync-mirror.mjs';

async function trees() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirror-sync-'));
  const canonicalDir = path.join(root, 'canonical');
  const mirrorDirs = [0, 1, 2].map((index) => path.join(root, `mirror-${index}`));
  for (const dir of [canonicalDir, ...mirrorDirs]) {
    await fsp.mkdir(path.join(dir, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'owned.txt'), 'before\n');
    await fsp.writeFile(path.join(dir, 'untouched.txt'), 'same\n');
    await fsp.writeFile(path.join(dir, 'nested', 'value.txt'), 'nested\n');
  }
  await fsp.mkdir(path.join(canonicalDir, '.omc'), { recursive: true });
  await fsp.writeFile(path.join(canonicalDir, '.omc', 'local.json'), '{}');
  return {
    root,
    canonicalDir,
    mirrorDirs,
    recoveryRoot: path.join(root, 'recovery'),
    manifest: ['owned.txt', 'new.txt']
  };
}

test('excluded canonical-local state does not break initial parity', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  assert.equal(baseline.managedInventories.canonical['.omc/local.json'], undefined);
});

test('prepares and applies owned copies with a durable pre-write journal', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
  await fsp.writeFile(path.join(f.canonicalDir, 'new.txt'), 'new\n');
  const prepared = await prepareMirrorSync({ baseline });
  assert.equal(prepared.operations.length, 6);
  const result = await applyMirrorSync({
    baseline,
    prepared,
    recoveryRoot: f.recoveryRoot,
    lockPath: path.join(f.root, 'sync.lock')
  });
  assert.equal(result.ok, true);
  const journal = await fsp.readFile(result.journalPath, 'utf8');
  assert.match(journal.split('\n')[0], /"event":"header"/);
  for (const mirror of f.mirrorDirs) {
    assert.equal(await fsp.readFile(path.join(mirror, 'owned.txt'), 'utf8'), 'after\n');
    assert.equal(await fsp.readFile(path.join(mirror, 'new.txt'), 'utf8'), 'new\n');
  }
});

test('mirror drift aborts during prepare with zero writes', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
  await fsp.writeFile(path.join(f.mirrorDirs[0], 'owned.txt'), 'user drift\n');
  await assert.rejects(() => prepareMirrorSync({ baseline }), /drift/);
  assert.equal(await fsp.readFile(path.join(f.mirrorDirs[1], 'owned.txt'), 'utf8'), 'before\n');
});

test('canonical change outside manifest aborts', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'untouched.txt'), 'changed\n');
  await assert.rejects(() => prepareMirrorSync({ baseline }), /outside owned manifest/);
});

test('prepared record tampering is rejected before writes', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
  const prepared = await prepareMirrorSync({ baseline });
  await assert.rejects(
    () =>
      applyMirrorSync({
        baseline,
        prepared: { ...prepared, manifestSha256: 'bad' },
        recoveryRoot: f.recoveryRoot,
        lockPath: path.join(f.root, 'sync.lock')
      }),
    /does not match/
  );
});

test('recovery refuses token mismatch', async () => {
  const f = await trees();
  await fsp.mkdir(f.recoveryRoot, { recursive: true });
  const journalPath = path.join(f.recoveryRoot, 'mirror.jsonl');
  await fsp.writeFile(
    journalPath,
    `${JSON.stringify({ event: 'header', invocationToken: 'expected', operations: [], mirrorRealpaths: [] })}\n`
  );
  await assert.rejects(
    () => recoverMirrorSync({ journalPath, invocationToken: 'other' }),
    /token mismatch/
  );
});

test('manifest rejects globs and duplicates', async () => {
  const f = await trees();
  await assert.rejects(
    () =>
      captureMirrorBaseline({
        canonicalDir: f.canonicalDir,
        mirrorDirs: f.mirrorDirs,
        ownedManifest: ['*.mjs']
      }),
    /invalid/
  );
  await assert.rejects(
    () =>
      captureMirrorBaseline({
        canonicalDir: f.canonicalDir,
        mirrorDirs: f.mirrorDirs,
        ownedManifest: ['owned.txt', 'owned.txt']
      }),
    /duplicate/
  );
});

test('applies owned deletions without touching unowned files', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.rm(path.join(f.canonicalDir, 'owned.txt'));
  const prepared = await prepareMirrorSync({ baseline });
  await applyMirrorSync({
    baseline,
    prepared,
    recoveryRoot: f.recoveryRoot,
    lockPath: path.join(f.root, 'sync.lock')
  });
  for (const mirror of f.mirrorDirs) {
    await assert.rejects(() => fsp.lstat(path.join(mirror, 'owned.txt')), { code: 'ENOENT' });
    assert.equal(await fsp.readFile(path.join(mirror, 'untouched.txt'), 'utf8'), 'same\n');
  }
});

test('in-process interruption cleans up safely after every journal event', async () => {
  for (const faultEvent of [
    'backup-intent',
    'backup-complete',
    'stage-intent',
    'stage-complete',
    'commit-intent',
    'commit-complete',
    'complete'
  ]) {
    const f = await trees();
    const baseline = await captureMirrorBaseline({
      canonicalDir: f.canonicalDir,
      mirrorDirs: f.mirrorDirs,
      ownedManifest: f.manifest
    });
    await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
    const prepared = await prepareMirrorSync({ baseline });
    let faulted = false;
    await assert.rejects(
      () =>
        applyMirrorSync({
          baseline,
          prepared,
          recoveryRoot: f.recoveryRoot,
          lockPath: path.join(f.root, 'sync.lock'),
          testFaultAfterEvent(event) {
            if (!faulted && event.event === faultEvent) {
              faulted = true;
              throw new Error(`injected interruption after ${faultEvent}`);
            }
          }
        }),
      new RegExp(`injected interruption after ${faultEvent}`)
    );
    assert.equal(faulted, true);
    for (const mirror of f.mirrorDirs) {
      assert.equal(await fsp.readFile(path.join(mirror, 'owned.txt'), 'utf8'), 'before\n');
      assert.equal(
        (await fsp.readdir(mirror)).some((entry) => entry.startsWith('.hyper-sync-')),
        false
      );
    }
    await assert.rejects(() => fsp.lstat(path.join(f.root, 'sync.lock')), { code: 'ENOENT' });
  }
});

test('explicit recovery handles commit-intent interruption and verified stale lock', async () => {
  const f = await trees();
  const lockPath = path.join(f.root, 'sync.lock');
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
  const prepared = await prepareMirrorSync({ baseline });
  const applied = await applyMirrorSync({
    baseline,
    prepared,
    recoveryRoot: f.recoveryRoot,
    lockPath
  });
  const events = (await fsp.readFile(applied.journalPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const interrupted = events.filter(
    (event) => !['commit-complete', 'complete'].includes(event.event)
  );
  await fsp.writeFile(
    applied.journalPath,
    `${interrupted.map((event) => JSON.stringify(event)).join('\n')}\n`
  );
  await fsp.writeFile(
    lockPath,
    `${JSON.stringify({
      version: 1,
      invocationToken: baseline.invocationToken,
      canonicalRealpath: baseline.canonicalRealpath,
      journalPath: applied.journalPath,
      pid: 999999,
      createdAt: new Date().toISOString()
    })}\n`
  );
  const recovered = await recoverMirrorSync({
    journalPath: applied.journalPath,
    invocationToken: baseline.invocationToken
  });
  assert.equal(recovered.status, 'rolled-back');
  for (const mirror of f.mirrorDirs) {
    assert.equal(await fsp.readFile(path.join(mirror, 'owned.txt'), 'utf8'), 'before\n');
  }
  await assert.rejects(() => fsp.lstat(lockPath), { code: 'ENOENT' });
});

test('recovery preserves mismatched user bytes and reports manual recovery', async () => {
  const f = await trees();
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
  const prepared = await prepareMirrorSync({ baseline });
  const applied = await applyMirrorSync({
    baseline,
    prepared,
    recoveryRoot: f.recoveryRoot,
    lockPath: path.join(f.root, 'sync.lock')
  });
  await fsp.writeFile(path.join(f.mirrorDirs[0], 'owned.txt'), 'user changed after commit\n');
  const recovered = await recoverMirrorSync({
    journalPath: applied.journalPath,
    invocationToken: baseline.invocationToken
  });
  assert.equal(recovered.status, 'needs-manual-recovery');
  assert.match(await fsp.readFile(path.join(f.mirrorDirs[0], 'owned.txt'), 'utf8'), /user changed/);
  assert.ok(recovered.entries.some((entry) => entry.status === 'refused'));
});

test('recovery refuses to act while the matching lock owner is alive', async () => {
  const f = await trees();
  const lockPath = path.join(f.root, 'sync.lock');
  const baseline = await captureMirrorBaseline({
    canonicalDir: f.canonicalDir,
    mirrorDirs: f.mirrorDirs,
    ownedManifest: f.manifest
  });
  await fsp.writeFile(path.join(f.canonicalDir, 'owned.txt'), 'after\n');
  const prepared = await prepareMirrorSync({ baseline });
  const applied = await applyMirrorSync({
    baseline,
    prepared,
    recoveryRoot: f.recoveryRoot,
    lockPath
  });
  await fsp.writeFile(
    lockPath,
    `${JSON.stringify({
      version: 1,
      invocationToken: baseline.invocationToken,
      canonicalRealpath: baseline.canonicalRealpath,
      journalPath: applied.journalPath,
      pid: process.pid,
      createdAt: new Date().toISOString()
    })}\n`
  );
  await assert.rejects(
    () =>
      recoverMirrorSync({
        journalPath: applied.journalPath,
        invocationToken: baseline.invocationToken
      }),
    /still active/
  );
  assert.equal(await fsp.readFile(path.join(f.mirrorDirs[0], 'owned.txt'), 'utf8'), 'after\n');
  await fsp.rm(lockPath);
});
