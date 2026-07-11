import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const MANAGED_EXCLUDED_SEGMENTS = Object.freeze(['.git', '.gjc', '.impeccable', '.omc', '.omx', 'node_modules']);
export const OWNED_CANONICAL_MANIFEST = Object.freeze([
  'SKILL.ko.md',
  'SKILL.md',
  'engine/agents/browser-task-agent.mjs',
  'engine/agents/diagnostics-agent.mjs',
  'engine/agents/evidence-writer.mjs',
  'engine/agents/lib/allowed-origin-guard.mjs',
  'engine/agents/lib/sync-mirror.mjs',
  'engine/agents/parent-dispatcher.mjs',
  'engine/agents/parent-verify.mjs',
  'engine/agents/schemas/hyper-cloaking-agent-output.ko.md',
  'engine/agents/schemas/hyper-cloaking-agent-output.schema.json',
  'engine/agents/setup-agent.mjs',
  'engine/cli.mjs',
  'references/runtime-workspace.ko.md',
  'references/runtime-workspace.md',
  'rules/agents/browser-task-agent.ko.md',
  'rules/agents/browser-task-agent.md',
  'rules/agents/diagnostics-agent.ko.md',
  'rules/agents/diagnostics-agent.md',
  'rules/agents/setup-agent.ko.md',
  'rules/agents/setup-agent.md',
  'rules/hyper-cloaking-workflow.ko.md',
  'rules/hyper-cloaking-workflow.md'
].sort());

/**
 * Capture a parity-checked mirror baseline and owned-file manifest.
 * @param {{canonicalDir:string,mirrorDirs:string[],ownedManifest?:string[],excludedSegments?:string[],invocationToken?:string,dirtyLedgerSha256?:string|null}} options
 * @returns {Promise<object>} Frozen baseline with paths, inventories, manifests, and baselineSha256.
 * @throws {Error} If directories, topology, manifest, or initial managed parity is invalid.
 * @sideeffects Reads canonical/mirror trees and computes file metadata/digests.
 */
export async function captureMirrorBaseline({ canonicalDir, mirrorDirs, ownedManifest = OWNED_CANONICAL_MANIFEST, excludedSegments = MANAGED_EXCLUDED_SEGMENTS, invocationToken = crypto.randomUUID(), dirtyLedgerSha256 = null }) {
  validateManifest(ownedManifest);
  const canonicalRealpath = await secureDirectory(canonicalDir);
  const mirrorRealpaths = [];
  for (const mirror of mirrorDirs) mirrorRealpaths.push(await secureDirectory(mirror));
  if (mirrorRealpaths.includes(canonicalRealpath) || new Set(mirrorRealpaths).size !== mirrorRealpaths.length) {
    throw new Error('canonical and mirror topology must contain distinct directories');
  }
  const canonicalInventory = await inventory(canonicalRealpath, excludedSegments);
  const mirrorInventories = [];
  for (const mirror of mirrorRealpaths) mirrorInventories.push(await inventory(mirror, excludedSegments));
  for (let index = 0; index < mirrorInventories.length; index += 1) {
    if (stableStringify(mirrorInventories[index]) !== stableStringify(canonicalInventory)) throw new Error(`initial managed parity mismatch: ${mirrorRealpaths[index]}`);
  }
  const ownedBaseline = {};
  for (const relativePath of ownedManifest) {
    ownedBaseline[relativePath] = {
      canonical: canonicalInventory[relativePath] || absent(),
      mirrors: mirrorInventories.map((item) => item[relativePath] || absent())
    };
  }
  const baseline = {
    version: 1,
    invocationToken,
    canonicalRealpath,
    mirrorRealpaths,
    excludedSegments: [...excludedSegments].sort(),
    exclusionPolicySha256: digestJson([...excludedSegments].sort()),
    ownedManifest: [...ownedManifest].sort(),
    manifestSha256: digestJson([...ownedManifest].sort()),
    managedInventories: { canonical: canonicalInventory, mirrors: mirrorInventories },
    ownedBaseline,
    dirtyLedgerSha256,
    createdAt: new Date().toISOString()
  };
  return Object.freeze({ ...baseline, baselineSha256: digestJson(baseline) });
}

/**
 * Prepare a deterministic set of copy/remove operations from a validated baseline.
 * @param {{baseline:object}} options
 * @returns {Promise<object>} Frozen prepared transaction with canonicalFinal, operations, and preparedSha256.
 * @throws {Error} If mirror drift or unowned canonical changes are detected.
 * @sideeffects Reads canonical and mirror trees; does not mutate them.
 */
export async function prepareMirrorSync({ baseline }) {
  validateBaseline(baseline);
  const canonical = await inventory(baseline.canonicalRealpath, baseline.excludedSegments);
  const mirrors = [];
  for (const mirror of baseline.mirrorRealpaths) mirrors.push(await inventory(mirror, baseline.excludedSegments));
  for (let index = 0; index < mirrors.length; index += 1) {
    if (stableStringify(mirrors[index]) !== stableStringify(baseline.managedInventories.mirrors[index])) throw new Error(`mirror drift detected: ${baseline.mirrorRealpaths[index]}`);
  }
  const owned = new Set(baseline.ownedManifest);
  const allPaths = new Set([...Object.keys(canonical), ...Object.keys(baseline.managedInventories.canonical)]);
  for (const relativePath of allPaths) {
    const before = baseline.managedInventories.canonical[relativePath] || absent();
    const after = canonical[relativePath] || absent();
    if (!sameState(before, after) && !owned.has(relativePath)) throw new Error(`canonical change outside owned manifest: ${relativePath}`);
  }
  const operations = [];
  for (let mirrorIndex = 0; mirrorIndex < baseline.mirrorRealpaths.length; mirrorIndex += 1) {
    for (const relativePath of baseline.ownedManifest) {
      const before = mirrors[mirrorIndex][relativePath] || absent();
      const final = canonical[relativePath] || absent();
      if (sameState(before, final)) continue;
      const opId = `${mirrorIndex}:${relativePath}`;
      operations.push({
        opId,
        mirrorIndex,
        relativePath,
        kind: final.type === 'absent' ? 'remove' : 'copy',
        baseline: before,
        final,
        stagedName: `.hyper-sync-${baseline.invocationToken}-${sha256(Buffer.from(opId)).slice(0, 12)}.stage`,
        backupName: `.hyper-sync-${baseline.invocationToken}-${sha256(Buffer.from(opId)).slice(0, 12)}.backup`
      });
    }
  }
  const prepared = {
    version: 1,
    invocationToken: baseline.invocationToken,
    baselineSha256: baseline.baselineSha256,
    canonicalRealpath: baseline.canonicalRealpath,
    mirrorRealpaths: baseline.mirrorRealpaths,
    exclusionPolicySha256: baseline.exclusionPolicySha256,
    manifestSha256: baseline.manifestSha256,
    canonicalFinal: Object.fromEntries(baseline.ownedManifest.map((item) => [item, canonical[item] || absent()])),
    operations,
    createdAt: new Date().toISOString()
  };
  return Object.freeze({ ...prepared, preparedSha256: digestJson(prepared) });
}

/**
 * Apply a prepared mirror transaction with lock, journal, staging, backup, rollback, and parity verification.
 * @param {{baseline:object,prepared:object,recoveryRoot:string,lockPath?:string,testFaultAfterEvent?:Function|null}} options
 * @returns {Promise<{ok:boolean,journalPath:string,operations:number}>} Commit result.
 * @throws {Error|AggregateError} On lock, validation, copy, parity, rollback, or cleanup failure.
 * @sideeffects Mutates mirror files, creates recovery journal/backups, and removes temporary stages.
 */
export async function applyMirrorSync({
  baseline,
  prepared,
  recoveryRoot,
  lockPath = defaultLockPath(baseline.canonicalRealpath),
  testFaultAfterEvent = null
}) {
  validatePrepared(baseline, prepared);
  if (!recoveryRoot || !path.isAbsolute(recoveryRoot)) throw new Error('recoveryRoot must be an absolute path');
  await fsp.mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  const recoveryRealpath = await secureDirectory(recoveryRoot);
  const journalPath = path.join(recoveryRealpath, 'mirror.jsonl');
  const lockRecord = {
    version: 1,
    invocationToken: baseline.invocationToken,
    canonicalRealpath: baseline.canonicalRealpath,
    baselineSha256: baseline.baselineSha256,
    preparedSha256: prepared.preparedSha256,
    journalPath,
    pid: process.pid,
    createdAt: new Date().toISOString()
  };
  const lock = await exclusiveJson(lockPath, lockRecord);
  let journal;
  const committed = [];
  let primaryError = null;
  let result = null;
  try {
    await revalidatePrepared(baseline, prepared);
    journal = await createJournal(journalPath, baseline, prepared, {
      lockPath,
      lockPid: process.pid
    });
    for (const operation of prepared.operations) {
      const mirrorRoot = baseline.mirrorRealpaths[operation.mirrorIndex];
      const destination = path.join(mirrorRoot, operation.relativePath);
      const parent = path.dirname(destination);
      await fsp.mkdir(parent, { recursive: true });
      await syncDirectory(parent);
      const backupPath = path.join(recoveryRealpath, 'backups', String(operation.mirrorIndex), operation.relativePath);
      await fsp.mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
      await syncDirectory(path.dirname(backupPath));
      const stagedPath = path.join(parent, operation.stagedName);
      await recordApplyEvent(journal, {
        event: 'backup-intent',
        opId: operation.opId,
        destination,
        expected: operation.baseline
      }, testFaultAfterEvent);
      if (operation.baseline.type === 'regular') {
        await assertState(destination, operation.baseline);
        await fsp.copyFile(destination, backupPath, fs.constants.COPYFILE_EXCL);
        await syncFile(backupPath);
        await syncDirectory(path.dirname(backupPath));
        await assertState(backupPath, operation.baseline);
      }
      await recordApplyEvent(journal, {
        event: 'backup-complete',
        opId: operation.opId,
        backupPath,
        backup: operation.baseline
      }, testFaultAfterEvent);
      if (operation.kind === 'copy') {
        await recordApplyEvent(journal, {
          event: 'stage-intent',
          opId: operation.opId,
          stagedPath,
          final: operation.final
        }, testFaultAfterEvent);
        const source = path.join(baseline.canonicalRealpath, operation.relativePath);
        await assertState(source, operation.final);
        await fsp.copyFile(source, stagedPath, fs.constants.COPYFILE_EXCL);
        await syncFile(stagedPath);
        await syncDirectory(parent);
        await assertState(stagedPath, operation.final);
        await recordApplyEvent(journal, {
          event: 'stage-complete',
          opId: operation.opId,
          stagedPath,
          final: operation.final
        }, testFaultAfterEvent);
      }
      await recordApplyEvent(journal, {
        event: 'commit-intent',
        opId: operation.opId,
        destination,
        final: operation.final
      }, testFaultAfterEvent);
      await assertState(destination, operation.baseline);
      if (operation.kind === 'copy') await fsp.rename(stagedPath, destination);
      else await fsp.rm(destination);
      committed.push({ operation, destination, backupPath });
      await syncDirectory(parent);
      await assertState(destination, operation.final);
      await recordApplyEvent(journal, {
        event: 'commit-complete',
        opId: operation.opId,
        destination,
        final: operation.final
      }, testFaultAfterEvent);
    }
    await verifyFinalParity(baseline);
    await recordApplyEvent(journal, {
      event: 'complete',
      completedAt: new Date().toISOString()
    }, testFaultAfterEvent);
    result = { ok: true, journalPath, operations: prepared.operations.length };
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
    if (journal) {
      const recoveryErrors = [];
      try {
        await rollbackCommitted(journal, committed);
      } catch (rollbackError) {
        recoveryErrors.push(rollbackError);
      }
      try {
        await cleanupPreparedStages(journal, baseline, prepared);
      } catch (stageCleanupError) {
        recoveryErrors.push(stageCleanupError);
      }
      if (recoveryErrors.length > 0) {
        primaryError = new AggregateError(
          [primaryError, ...recoveryErrors],
          'mirror sync failed and rollback cleanup did not complete',
          { cause: primaryError }
        );
      }
    }
  }

  const cleanupErrors = [];
  if (journal) {
    try {
      await journal.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await lock.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await releaseOwnedLock(lockPath, lockRecord);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'mirror sync failed and cleanup did not complete',
      { cause: primaryError }
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'mirror sync cleanup failed');
  }
  return result;
}

export async function recoverMirrorSync({ journalPath, invocationToken }) {
  const lines = (await fsp.readFile(journalPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const header = lines[0];
  await validateRecoveryHeader(header, invocationToken);
  const staleLock = await inspectRecoveryLock(header, journalPath);
  const completed = new Set(lines.filter((event) => event.event === 'commit-complete').map((event) => event.opId));
  const commitIntents = new Set(lines.filter((event) => event.event === 'commit-intent').map((event) => event.opId));
  const backups = new Map(lines.filter((event) => event.event === 'backup-complete').map((event) => [event.opId, event.backupPath]));
  const journal = await fsp.open(journalPath, 'a', 0o600);
  const entries = [];
  let recoveryError = null;
  try {
    for (const operation of [...header.operations].reverse()) {
      const mirrorRoot = header.mirrorRealpaths[operation.mirrorIndex];
      const destination = path.join(mirrorRoot, operation.relativePath);
      const parent = path.dirname(destination);
      const stagedPath = path.join(parent, operation.stagedName);
      if (completed.has(operation.opId) || commitIntents.has(operation.opId)) {
        const current = await fileState(destination);
        if (sameState(current, operation.final)) {
          const backupPath = backups.get(operation.opId);
          await appendEvent(journal, {
            event: 'recovery-intent',
            opId: operation.opId,
            destination,
            expectedCurrent: operation.final,
            restore: operation.baseline
          });
          if (operation.baseline.type === 'regular') {
            if (!backupPath) throw new Error(`missing recovery backup: ${operation.opId}`);
            await assertState(backupPath, operation.baseline);
            const staged = `${destination}.recover-${invocationToken}`;
            await fsp.copyFile(backupPath, staged, fs.constants.COPYFILE_EXCL);
            await syncFile(staged);
            await syncDirectory(parent);
            await fsp.rename(staged, destination);
          } else {
            await fsp.rm(destination);
          }
          await syncDirectory(parent);
          await assertState(destination, operation.baseline);
          await appendEvent(journal, {
            event: 'recovery-complete',
            opId: operation.opId,
            destination
          });
          entries.push({ opId: operation.opId, status: 'rolled-back' });
        } else if (sameState(current, operation.baseline)) {
          entries.push({ opId: operation.opId, status: 'already-baseline' });
        } else {
          await appendEvent(journal, {
            event: 'recovery-refused',
            opId: operation.opId,
            destination,
            reason: 'current hash mismatch'
          });
          entries.push({ opId: operation.opId, status: 'refused', reason: 'current hash mismatch' });
        }
      }

      const stagedState = await fileState(stagedPath);
      if (stagedState.type !== 'absent') {
        if (sameState(stagedState, operation.final)) {
          await appendEvent(journal, {
            event: 'recovery-stage-cleanup-intent',
            opId: operation.opId,
            stagedPath,
            expected: operation.final
          });
          await fsp.rm(stagedPath);
          await syncDirectory(parent);
          await appendEvent(journal, {
            event: 'recovery-stage-cleanup-complete',
            opId: operation.opId,
            stagedPath
          });
        } else {
          await appendEvent(journal, {
            event: 'recovery-refused',
            opId: operation.opId,
            stagedPath,
            reason: 'staged hash mismatch'
          });
          entries.push({ opId: operation.opId, status: 'refused', reason: 'staged hash mismatch' });
        }
      }
    }
  } catch (error) {
    recoveryError = error instanceof Error ? error : new Error(String(error));
  }
  let closeError = null;
  try {
    await journal.close();
  } catch (error) {
    closeError = error instanceof Error ? error : new Error(String(error));
  }
  if (recoveryError && closeError) {
    throw new AggregateError(
      [recoveryError, closeError],
      'mirror recovery failed and journal close did not complete',
      { cause: recoveryError }
    );
  }
  if (recoveryError) throw recoveryError;
  if (closeError) throw closeError;

  if (staleLock) await removeVerifiedStaleLock(header.lockPath, staleLock, journalPath);
  return {
    status: entries.some((item) => item.status === 'refused')
      ? 'needs-manual-recovery'
      : 'rolled-back',
    entries
  };
}

async function revalidatePrepared(baseline, prepared) {
  if (prepared.preparedSha256 !== digestJson(stripDigest(prepared, 'preparedSha256'))) throw new Error('prepared digest mismatch');
  const next = await prepareMirrorSync({ baseline });
  if (stableStringify(next.canonicalFinal) !== stableStringify(prepared.canonicalFinal)
    || stableStringify(next.operations) !== stableStringify(prepared.operations)
    || next.baselineSha256 !== prepared.baselineSha256
    || next.manifestSha256 !== prepared.manifestSha256
    || next.exclusionPolicySha256 !== prepared.exclusionPolicySha256) {
    throw new Error('prepared state drifted');
  }
}

async function verifyFinalParity(baseline) {
  const canonical = await inventory(baseline.canonicalRealpath, baseline.excludedSegments);
  for (const mirror of baseline.mirrorRealpaths) {
    const current = await inventory(mirror, baseline.excludedSegments);
    if (stableStringify(current) !== stableStringify(canonical)) throw new Error(`final managed parity mismatch: ${mirror}`);
  }
}

async function rollbackCommitted(journal, committed) {
  const refused = [];
  for (const item of [...committed].reverse()) {
    const { operation, destination, backupPath } = item;
    const parent = path.dirname(destination);
    await appendEvent(journal, {
      event: 'rollback-intent',
      opId: operation.opId,
      destination,
      expectedCurrent: operation.final,
      restore: operation.baseline
    });
    const current = await fileState(destination);
    if (!sameState(current, operation.final)) {
      await appendEvent(journal, {
        event: 'rollback-refused',
        opId: operation.opId,
        reason: 'current hash mismatch'
      });
      refused.push(operation.opId);
      continue;
    }
    if (operation.baseline.type === 'regular') {
      await assertState(backupPath, operation.baseline);
      const staged = `${destination}.rollback-${sha256(Buffer.from(operation.opId)).slice(0, 12)}`;
      await fsp.copyFile(backupPath, staged, fs.constants.COPYFILE_EXCL);
      await syncFile(staged);
      await syncDirectory(parent);
      await fsp.rename(staged, destination);
    } else {
      await fsp.rm(destination);
    }
    await syncDirectory(parent);
    await assertState(destination, operation.baseline);
    await appendEvent(journal, {
      event: 'rollback-complete',
      opId: operation.opId,
      destination
    });
  }
  if (refused.length > 0) throw new Error(`rollback refused for: ${refused.join(', ')}`);
}

async function cleanupPreparedStages(journal, baseline, prepared) {
  const refused = [];
  for (const operation of prepared.operations) {
    if (operation.kind !== 'copy') continue;
    const mirrorRoot = baseline.mirrorRealpaths[operation.mirrorIndex];
    const stagedPath = path.join(
      path.dirname(path.join(mirrorRoot, operation.relativePath)),
      operation.stagedName
    );
    const current = await fileState(stagedPath);
    if (current.type === 'absent') continue;
    await appendEvent(journal, {
      event: 'stage-cleanup-intent',
      opId: operation.opId,
      stagedPath,
      expected: operation.final
    });
    if (!sameState(current, operation.final)) {
      await appendEvent(journal, {
        event: 'stage-cleanup-refused',
        opId: operation.opId,
        stagedPath,
        reason: 'staged hash mismatch'
      });
      refused.push(operation.opId);
      continue;
    }
    await fsp.rm(stagedPath);
    await syncDirectory(path.dirname(stagedPath));
    await appendEvent(journal, {
      event: 'stage-cleanup-complete',
      opId: operation.opId,
      stagedPath
    });
  }
  if (refused.length > 0) throw new Error(`stage cleanup refused for: ${refused.join(', ')}`);
}

async function inventory(root, excludedSegments) {
  const excluded = new Set(excludedSegments);
  const result = {};
  async function walk(directory, prefix = '') {
    const entries = (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`managed symlink is forbidden: ${relativePath}`);
      if (entry.isDirectory()) await walk(absolute, relativePath);
      else if (entry.isFile()) result[relativePath] = await fileState(absolute);
      else throw new Error(`unsupported managed type: ${relativePath}`);
    }
  }
  await walk(root);
  return result;
}

async function createJournal(journalPath, baseline, prepared, { lockPath, lockPid }) {
  const handle = await fsp.open(journalPath, 'wx', 0o600);
  const header = {
    event: 'header',
    version: 1,
    invocationToken: baseline.invocationToken,
    canonicalRealpath: baseline.canonicalRealpath,
    mirrorRealpaths: baseline.mirrorRealpaths,
    excludedSegments: baseline.excludedSegments,
    ownedManifest: baseline.ownedManifest,
    exclusionPolicySha256: baseline.exclusionPolicySha256,
    manifestSha256: baseline.manifestSha256,
    baselineSha256: baseline.baselineSha256,
    preparedSha256: prepared.preparedSha256,
    managedBaseline: baseline.managedInventories,
    canonicalFinal: prepared.canonicalFinal,
    operations: prepared.operations,
    lockPath,
    lockPid,
    createdAt: new Date().toISOString()
  };
  try {
    await handle.writeFile(`${JSON.stringify(header)}\n`);
    await handle.sync();
    await syncDirectory(path.dirname(journalPath));
    return handle;
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'mirror journal initialization failed and handle close did not complete',
        { cause: error }
      );
    }
    throw error;
  }
}

async function appendEvent(handle, event) {
  await handle.writeFile(`${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`);
  await handle.sync();
}

async function recordApplyEvent(handle, event, testFaultAfterEvent) {
  await appendEvent(handle, event);
  if (testFaultAfterEvent) await testFaultAfterEvent(event);
}

async function exclusiveJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const handle = await fsp.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
    await syncDirectory(path.dirname(file));
    return handle;
  } catch (error) {
    const cleanupErrors = [];
    try {
      await handle.close();
    } catch (closeError) {
      cleanupErrors.push(closeError);
    }
    try {
      await fsp.rm(file);
      await syncDirectory(path.dirname(file));
    } catch (removeError) {
      cleanupErrors.push(removeError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'exclusive record initialization failed and cleanup did not complete',
        { cause: error }
      );
    }
    throw error;
  }
}

async function releaseOwnedLock(lockPath, expected) {
  const stat = await fsp.lstat(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('mirror lock is not a regular file');
  const current = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  if (stableStringify(current) !== stableStringify(expected)) {
    throw new Error('mirror lock ownership changed before release');
  }
  await fsp.rm(lockPath);
  await syncDirectory(path.dirname(lockPath));
}

async function validateRecoveryHeader(header, invocationToken) {
  if (header?.event !== 'header' || header.version !== 1 || header.invocationToken !== invocationToken) {
    throw new Error('mirror recovery token mismatch');
  }
  validateManifest(header.ownedManifest);
  if (header.manifestSha256 !== digestJson([...header.ownedManifest].sort())) {
    throw new Error('mirror recovery manifest digest mismatch');
  }
  if (!Array.isArray(header.excludedSegments)
    || header.exclusionPolicySha256 !== digestJson([...header.excludedSegments].sort())) {
    throw new Error('mirror recovery exclusion policy mismatch');
  }
  if (!path.isAbsolute(header.canonicalRealpath)
    || !Array.isArray(header.mirrorRealpaths)
    || header.mirrorRealpaths.length === 0
    || header.mirrorRealpaths.some((item) => !path.isAbsolute(item))) {
    throw new Error('mirror recovery topology is invalid');
  }
  if (await secureDirectory(header.canonicalRealpath) !== header.canonicalRealpath) {
    throw new Error('mirror recovery canonical topology changed');
  }
  for (const mirror of header.mirrorRealpaths) {
    if (await secureDirectory(mirror) !== mirror) throw new Error(`mirror recovery topology changed: ${mirror}`);
  }
  if (!header.managedBaseline
    || !Array.isArray(header.managedBaseline.mirrors)
    || !header.canonicalFinal
    || !Array.isArray(header.operations)) {
    throw new Error('mirror recovery header is incomplete');
  }
  const owned = new Set(header.ownedManifest);
  const operationIds = new Set();
  for (const operation of header.operations) {
    if (!operation || !Number.isInteger(operation.mirrorIndex)
      || operation.mirrorIndex < 0
      || operation.mirrorIndex >= header.mirrorRealpaths.length
      || !owned.has(operation.relativePath)
      || operation.opId !== `${operation.mirrorIndex}:${operation.relativePath}`
      || operationIds.has(operation.opId)) {
      throw new Error('mirror recovery operation identity is invalid');
    }
    operationIds.add(operation.opId);
    validateFileState(operation.baseline);
    validateFileState(operation.final);
    if (!sameState(
      operation.baseline,
      header.managedBaseline.mirrors[operation.mirrorIndex]?.[operation.relativePath] || absent()
    ) || !sameState(
      operation.final,
      header.canonicalFinal[operation.relativePath] || absent()
    )) {
      throw new Error(`mirror recovery operation state mismatch: ${operation.opId}`);
    }
    if (operation.kind !== (operation.final.type === 'absent' ? 'remove' : 'copy')) {
      throw new Error(`mirror recovery operation kind mismatch: ${operation.opId}`);
    }
    for (const name of [operation.stagedName, operation.backupName]) {
      if (typeof name !== 'string' || !name || path.basename(name) !== name) {
        throw new Error(`mirror recovery temporary name is invalid: ${operation.opId}`);
      }
    }
    const destination = path.join(
      header.mirrorRealpaths[operation.mirrorIndex],
      operation.relativePath
    );
    if (!isInside(header.mirrorRealpaths[operation.mirrorIndex], destination)) {
      throw new Error(`mirror recovery destination escapes mirror: ${operation.opId}`);
    }
  }
  if (header.lockPath !== undefined && !path.isAbsolute(header.lockPath)) {
    throw new Error('mirror recovery lock path is invalid');
  }
}

function validateFileState(state) {
  if (state?.type === 'absent') {
    if (state.sha256 !== null || state.size !== null || state.mode !== null) {
      throw new Error('invalid absent file state');
    }
    return;
  }
  if (state?.type !== 'regular'
    || !/^[0-9a-f]{64}$/i.test(state.sha256)
    || !Number.isSafeInteger(state.size)
    || state.size < 0
    || !Number.isInteger(state.mode)
    || state.mode < 0) {
    throw new Error('invalid regular file state');
  }
}

async function inspectRecoveryLock(header, journalPath) {
  if (!header.lockPath) return null;
  let stat;
  try {
    stat = await fsp.lstat(header.lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('stale mirror lock is not a regular file');
  const record = JSON.parse(await fsp.readFile(header.lockPath, 'utf8'));
  if (record.invocationToken !== header.invocationToken
    || path.resolve(record.journalPath || '') !== path.resolve(journalPath)
    || record.canonicalRealpath !== header.canonicalRealpath) {
    throw new Error('stale mirror lock does not match recovery journal');
  }
  if (!Number.isInteger(record.pid) || record.pid <= 0) throw new Error('stale mirror lock pid is invalid');
  if (isProcessAlive(record.pid)) throw new Error(`mirror lock owner is still active: ${record.pid}`);
  return record;
}

async function removeVerifiedStaleLock(lockPath, expected, journalPath) {
  const stat = await fsp.lstat(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('stale mirror lock changed type');
  const current = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  if (stableStringify(current) !== stableStringify(expected)
    || path.resolve(current.journalPath || '') !== path.resolve(journalPath)
    || isProcessAlive(current.pid)) {
    throw new Error('stale mirror lock changed before removal');
  }
  await fsp.rm(lockPath);
  await syncDirectory(path.dirname(lockPath));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function syncFile(file) {
  const handle = await fsp.open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function secureDirectory(directory) {
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`directory must be a non-symlink: ${directory}`);
  return fsp.realpath(directory);
}

async function fileState(file) {
  try {
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`expected regular file: ${file}`);
    const bytes = await fsp.readFile(file);
    return { type: 'regular', sha256: sha256(bytes), size: stat.size, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return absent();
    throw error;
  }
}

async function assertState(file, expected) {
  const actual = await fileState(file);
  if (!sameState(actual, expected)) throw new Error(`file state mismatch: ${file}`);
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('owned manifest is required');
  const seen = new Set();
  for (const item of manifest) {
    const normalized = typeof item === 'string' ? path.normalize(item) : null;
    if (typeof item !== 'string'
      || !item
      || normalized !== item
      || path.isAbsolute(item)
      || item.includes('*')
      || item === '..'
      || item.startsWith(`..${path.sep}`)) {
      throw new Error(`invalid owned manifest path: ${item}`);
    }
    if (seen.has(item)) throw new Error(`duplicate owned manifest path: ${item}`);
    seen.add(item);
  }
}

function validateBaseline(baseline) {
  if (!baseline || baseline.version !== 1 || !baseline.baselineSha256) throw new Error('invalid baseline');
  if (baseline.baselineSha256 !== digestJson(stripDigest(baseline, 'baselineSha256'))) throw new Error('baseline digest mismatch');
  validateManifest(baseline.ownedManifest);
}

function validatePrepared(baseline, prepared) {
  validateBaseline(baseline);
  if (!prepared
    || prepared.version !== 1
    || prepared.invocationToken !== baseline.invocationToken
    || prepared.baselineSha256 !== baseline.baselineSha256
    || prepared.manifestSha256 !== baseline.manifestSha256
    || prepared.exclusionPolicySha256 !== baseline.exclusionPolicySha256
    || prepared.canonicalRealpath !== baseline.canonicalRealpath
    || stableStringify(prepared.mirrorRealpaths) !== stableStringify(baseline.mirrorRealpaths)) {
    throw new Error('prepared record does not match baseline');
  }
  if (prepared.preparedSha256 !== digestJson(stripDigest(prepared, 'preparedSha256'))) {
    throw new Error('prepared digest mismatch');
  }
}

function absent() { return { type: 'absent', sha256: null, size: null, mode: null }; }
function sameState(left, right) { return left.type === right.type && left.sha256 === right.sha256 && left.size === right.size && left.mode === right.mode; }
function stripDigest(value, key) { const clone = { ...value }; delete clone[key]; return clone; }
function digestJson(value) { return sha256(Buffer.from(stableStringify(value))); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableStringify(value) { if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function defaultLockPath(canonicalRealpath) { return path.join(os.tmpdir(), 'hyper-cloaking-sync', `${sha256(Buffer.from(canonicalRealpath))}.lock`); }
async function syncDirectory(directory) { const handle = await fsp.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
