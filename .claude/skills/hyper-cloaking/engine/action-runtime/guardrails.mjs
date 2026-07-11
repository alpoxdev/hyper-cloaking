// Provider-agnostic write-action guardrails.
//
// This module is engine-level behavior, not provider metadata, so it lives
// beside outcome.mjs/diagnostics.mjs rather than under providers/. It turns the
// plan's abuse-resistance principles into mechanical, testable contracts:
//   - writes are dryRun by default (P2)
//   - bulk writes need an explicit, capped, human-confirmed opt-in (P3)
//   - rate counters persist across processes so autonomous loops cannot reset a
//     per-process cap by restarting (P3)
//   - a resume ledger makes interrupted bulk runs idempotent (no re-send)
//
// No timers, network, or browser access. All time is injected via `now` so the
// logic is deterministic under test.

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const DEFAULT_BULK_CAP = 20;
export const DEFAULT_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
export const DEFAULT_RATE_MAX = 60; // writes per window per action type

/**
 * Resolves whether a single write action may proceed.
 *
 * dryRun defaults to true: a caller must explicitly pass `dryRun: false` to
 * perform a real write. This is the first gate every write action passes.
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ dryRun: boolean, allowed: boolean, reason: string | null }}
 */
export function resolveWriteGate(opts = {}) {
  const dryRun = opts.dryRun !== false;
  if (dryRun) {
    return { dryRun: true, allowed: false, reason: 'dry-run: no write performed (pass dryRun:false to act)' };
  }
  return { dryRun: false, allowed: true, reason: null };
}

/**
 * Human-in-the-loop confirmation gate for bulk / high-risk writes.
 *
 * The gate can only be satisfied interactively: `confirmed` must be true AND an
 * interactive surface must be present. In a headless/agent-loop context
 * (`interactive: false`) it always blocks, so an autonomous loop can never
 * auto-confirm a bulk send.
 *
 * @param {{ interactive?: boolean, confirmed?: boolean }} [opts]
 * @returns {{ allowed: boolean, blocked: boolean, reason: string | null }}
 */
export function resolveConfirmationGate(opts = {}) {
  const interactive = opts.interactive === true;
  const confirmed = opts.confirmed === true;
  if (!interactive) {
    return { allowed: false, blocked: true, reason: 'blocked: bulk write confirmation cannot be satisfied non-interactively' };
  }
  if (!confirmed) {
    return { allowed: false, blocked: true, reason: 'blocked: bulk write not confirmed by user' };
  }
  return { allowed: true, blocked: false, reason: null };
}

/**
 * Rejects an oversized bulk request. The cap is a hard ceiling; raising it
 * requires the caller to pass an explicit larger `cap`, which is itself only
 * reachable behind the confirmation gate.
 *
 * @param {unknown[]} items
 * @param {{ cap?: number }} [opts]
 * @returns {{ allowed: boolean, count: number, cap: number, reason: string | null }}
 */
export function enforceBulkCap(items, opts = {}) {
  const cap = Number.isInteger(opts.cap) && opts.cap > 0 ? opts.cap : DEFAULT_BULK_CAP;
  const count = Array.isArray(items) ? items.length : 0;
  if (count > cap) {
    return { allowed: false, count, cap, reason: `bulk request of ${count} exceeds cap ${cap}` };
  }
  return { allowed: true, count, cap, reason: null };
}

function rateFilePath(stateDir) {
  return path.join(stateDir, 'action-rate.json');
}

const RATE_LOCK_RETRY_MS = 10;
const RATE_LOCK_TIMEOUT_MS = 2_000;
const RATE_LOCK_STALE_MS = 30_000;

function rateLockPath(stateDir) {
  return path.join(stateDir, 'action-rate.lock');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateRateStore(store) {
  if (store === null || Array.isArray(store) || typeof store !== 'object') {
    throw new TypeError('invalid action-rate state: expected an object');
  }

  for (const [actionType, events] of Object.entries(store)) {
    if (!Array.isArray(events) || events.some((timestamp) => !Number.isFinite(timestamp))) {
      throw new TypeError(`invalid action-rate state for "${actionType}": expected finite timestamps`);
    }
  }

  return store;
}

async function readRateStore(file) {
  try {
    return validateRateStore(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const LOCK_OWNER_FILE = 'owner.json';
const LOCK_REAP_DIR = '.reap';

async function readLockOwner(lockFile) {
  const owner = JSON.parse(await fs.readFile(path.join(lockFile, LOCK_OWNER_FILE), 'utf8'));
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || owner.token === '') {
    throw new TypeError(`invalid action lock owner at ${lockFile}`);
  }
  return owner;
}

async function removeDeadStaleRateLock(lockFile) {
  let stat;

  try {
    stat = await fs.lstat(lockFile);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new TypeError(`action lock is not an owned directory: ${lockFile}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }

  if (Date.now() - stat.mtimeMs < RATE_LOCK_STALE_MS) return false;

  const owner = await readLockOwner(lockFile);
  if (isProcessAlive(owner.pid)) return false;

  const reapPath = path.join(lockFile, LOCK_REAP_DIR);
  try {
    await fs.mkdir(reapPath);
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOENT') return false;
    throw error;
  }

  const quarantine = `${lockFile}.stale-${process.pid}-${owner.token}`;
  try {
    const current = await readLockOwner(lockFile);
    if (current.pid !== owner.pid || current.token !== owner.token || isProcessAlive(current.pid)) {
      throw new Error(`action lock ownership changed before stale reclamation: ${lockFile}`);
    }
    await fs.rename(lockFile, quarantine);
    const quarantinedOwner = await readLockOwner(quarantine);
    if (quarantinedOwner.pid !== owner.pid || quarantinedOwner.token !== owner.token) {
      throw new Error(`quarantined action lock ownership mismatch: ${quarantine}`);
    }
    await fs.rm(quarantine, { recursive: true });
    return true;
  } catch (error) {
    try {
      await fs.rmdir(reapPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw new AggregateError([error, cleanupError], 'stale action lock verification and cleanup failed');
      }
    }
    throw error;
  }
}

async function acquireFileLock(stateDir, lockFile) {
  await fs.mkdir(stateDir, { recursive: true });
  const deadline = Date.now() + RATE_LOCK_TIMEOUT_MS;

  while (true) {
    const token = randomUUID();
    const candidate = `${lockFile}.candidate-${process.pid}-${token}`;
    await fs.mkdir(candidate, { mode: 0o700 });
    try {
      await fs.writeFile(
        path.join(candidate, LOCK_OWNER_FILE),
        JSON.stringify({ pid: process.pid, token }),
        { encoding: 'utf8', mode: 0o600, flag: 'wx' }
      );
    } catch (error) {
      try {
        await fs.rm(candidate, { recursive: true });
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError], 'action lock candidate initialization and cleanup failed');
        }
      }
      throw error;
    }

    try {
      await fs.rename(candidate, lockFile);
    } catch (error) {
      try {
        await fs.rm(candidate, { recursive: true });
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError], 'action lock contention and candidate cleanup failed');
        }
      }

      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      await removeDeadStaleRateLock(lockFile);
      if (Date.now() >= deadline) {
        throw new Error(`timed out acquiring action lock at ${lockFile}`);
      }
      await sleep(RATE_LOCK_RETRY_MS);
      continue;
    }

    return async () => {
      const quarantine = `${lockFile}.release-${process.pid}-${token}`;
      await fs.rename(lockFile, quarantine);
      const owner = await readLockOwner(quarantine);
      if (owner.pid !== process.pid || owner.token !== token) {
        throw new Error(`refusing to release action lock owned by another process: ${quarantine}`);
      }
      await fs.rm(quarantine, { recursive: true });
    };
  }
}

async function acquireRateLock(stateDir) {
  return acquireFileLock(stateDir, rateLockPath(stateDir));
}

async function writeRateStoreAtomically(file, store) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporary, JSON.stringify(store), 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    try {
      await fs.unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw cleanupError;
      }
    }
    throw error;
  }
}

function validateBulkLedger(stored, file) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !Array.isArray(stored.done)) {
    throw new TypeError(`invalid bulk ledger at ${file}`);
  }
  if (stored.done.some((key) => typeof key !== 'string' || key === '')) {
    throw new TypeError(`invalid bulk ledger recipient key at ${file}`);
  }
  return stored;
}

async function readBulkLedger(file) {
  try {
    return validateBulkLedger(JSON.parse(await fs.readFile(file, 'utf8')), file);
  } catch (error) {
    if (error?.code === 'ENOENT') return { done: [] };
    throw error;
  }
}

/**
 * Persisted rolling-window rate check. Reads the dated counter file, drops
 * events older than the window, and — when allowed — records the new event.
 * Because state lives on disk under the runtime workspace, a process restart
 * (e.g. a ralph/autopilot iteration) does not reset the ceiling.
 *
 * @param {string} stateDir Runtime workspace state directory.
 * @param {string} actionType e.g. 'like', 'comment', 'dm-reply'.
 * @param {{ maxPerWindow?: number, windowMs?: number, now?: number, record?: boolean }} [opts]
 * @returns {Promise<{ allowed: boolean, count: number, remaining: number, windowMs: number, reason: string | null }>}
 */
export async function checkAndRecordAction(stateDir, actionType, opts = {}) {
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : DEFAULT_RATE_WINDOW_MS;
  const maxPerWindow = Number.isInteger(opts.maxPerWindow) ? opts.maxPerWindow : DEFAULT_RATE_MAX;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const record = opts.record !== false;

  const file = rateFilePath(stateDir);
  const releaseLock = await acquireRateLock(stateDir);
  let result;
  let operationError;

  try {
    const store = await readRateStore(file);
    const cutoff = now - windowMs;
    const recent = (store[actionType] ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= maxPerWindow) {
      result = {
        allowed: false,
        count: recent.length,
        remaining: 0,
        windowMs,
        reason: `rate limit: ${recent.length}/${maxPerWindow} "${actionType}" actions in window`
      };
    } else {
      if (record) {
        recent.push(now);
        store[actionType] = recent;
        await writeRateStoreAtomically(file, store);
      }

      result = {
        allowed: true,
        count: recent.length,
        remaining: maxPerWindow - recent.length,
        windowMs,
        reason: null
      };
    }
  } catch (error) {
    operationError = error;
  }

  try {
    await releaseLock();
  } catch (releaseError) {
    if (operationError) {
      throw new AggregateError([operationError, releaseError], 'action-rate operation and lock cleanup failed');
    }
    throw releaseError;
  }

  if (operationError) {
    throw operationError;
  }

  return result;
}

const GUARDED_STORE_VERSION = 1;
const HASH_RE = /^[a-f0-9]{64}$/;
const CLAIM_STATES = new Set(['pending', 'verified', 'ambiguous']);

function guardedStoreFilePath(stateDir) {
  return path.join(stateDir, 'guarded-actions-v1.json');
}

function guardedStoreLockPath(stateDir) {
  return path.join(stateDir, 'guarded-actions-v1.lock');
}

function emptyGuardedStore() {
  return { version: GUARDED_STORE_VERSION, rates: {}, claims: {} };
}

function requireHash(value, field, { optional = false } = {}) {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw new TypeError(`${field} must be a lowercase 64-character sha256 hex digest`);
  }
  return value;
}

function requireSafeLabel(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) {
    throw new TypeError(`${field} must be a non-empty safe label`);
  }
  return value;
}

function validateGuardedStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store) || store.version !== GUARDED_STORE_VERSION) {
    throw new TypeError('invalid guarded-action state: unsupported root or version');
  }
  if (!store.rates || typeof store.rates !== 'object' || Array.isArray(store.rates)) {
    throw new TypeError('invalid guarded-action state: rates must be an object');
  }
  if (!store.claims || typeof store.claims !== 'object' || Array.isArray(store.claims)) {
    throw new TypeError('invalid guarded-action state: claims must be an object');
  }

  for (const [actionType, events] of Object.entries(store.rates)) {
    requireSafeLabel(actionType, 'stored actionType');
    if (!Array.isArray(events) || events.some((timestamp) => !Number.isFinite(timestamp))) {
      throw new TypeError(`invalid guarded-action rate state for "${actionType}"`);
    }
  }

  for (const [idempotencyHash, claim] of Object.entries(store.claims)) {
    requireHash(idempotencyHash, 'stored idempotencyHash');
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) || !CLAIM_STATES.has(claim.state)) {
      throw new TypeError(`invalid guarded-action claim for "${idempotencyHash}"`);
    }
    requireSafeLabel(claim.actionType, 'stored claim actionType');
    requireHash(claim.targetHash, 'stored targetHash');
    requireHash(claim.contentHash, 'stored contentHash');
    requireSafeLabel(claim.runId, 'stored runId');
    requireHash(claim.evidenceIdHash, 'stored evidenceIdHash', { optional: true });
    if (!Number.isFinite(claim.createdAt) || !Number.isFinite(claim.updatedAt)) {
      throw new TypeError(`invalid guarded-action claim timestamps for "${idempotencyHash}"`);
    }
  }

  return store;
}

async function readGuardedStore(file) {
  try {
    return validateGuardedStore(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyGuardedStore();
    throw error;
  }
}

function cloneClaim(claim) {
  return claim ? { ...claim } : null;
}

function guardedRateSnapshot(recent, maxPerWindow, windowMs) {
  return {
    allowed: recent.length <= maxPerWindow,
    count: recent.length,
    remaining: Math.max(0, maxPerWindow - recent.length),
    windowMs,
    reason: recent.length > maxPerWindow
      ? `rate limit: ${recent.length - 1}/${maxPerWindow} actions already in window`
      : null
  };
}

/**
 * Atomically reserves one persisted rate slot and one idempotency claim.
 * No provider write may dispatch unless this returns status "reserved".
 */
export async function reserveGuardedAction(stateDir, {
  actionType,
  maxPerWindow = DEFAULT_RATE_MAX,
  windowMs = DEFAULT_RATE_WINDOW_MS,
  idempotencyHash,
  targetHash,
  contentHash,
  runId,
  now = Date.now()
} = {}) {
  if (typeof stateDir !== 'string' || stateDir.length === 0) throw new TypeError('stateDir is required');
  requireSafeLabel(actionType, 'actionType');
  requireHash(idempotencyHash, 'idempotencyHash');
  requireHash(targetHash, 'targetHash');
  requireHash(contentHash, 'contentHash');
  requireSafeLabel(runId, 'runId');
  if (!Number.isInteger(maxPerWindow) || maxPerWindow <= 0) throw new TypeError('maxPerWindow must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be positive');
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');

  const file = guardedStoreFilePath(stateDir);
  const release = await acquireFileLock(stateDir, guardedStoreLockPath(stateDir));
  try {
    const store = await readGuardedStore(file);
    const cutoff = now - windowMs;
    const recent = (store.rates[actionType] ?? []).filter((timestamp) => timestamp > cutoff);
    const existing = store.claims[idempotencyHash];

    if (existing) {
      return {
        allowed: false,
        status: existing.state === 'verified' ? 'already-verified' : `claim-${existing.state}`,
        claim: cloneClaim(existing),
        rateLimit: guardedRateSnapshot(recent, maxPerWindow, windowMs)
      };
    }
    if (recent.length >= maxPerWindow) {
      return {
        allowed: false,
        status: 'rate-limited',
        claim: null,
        rateLimit: {
          allowed: false,
          count: recent.length,
          remaining: 0,
          windowMs,
          reason: `rate limit: ${recent.length}/${maxPerWindow} "${actionType}" actions in window`
        }
      };
    }

    recent.push(now);
    const claim = {
      state: 'pending',
      actionType,
      targetHash,
      contentHash,
      runId,
      createdAt: now,
      updatedAt: now,
      evidenceIdHash: null
    };
    store.rates[actionType] = recent;
    store.claims[idempotencyHash] = claim;
    await fs.mkdir(stateDir, { recursive: true });
    await writeRateStoreAtomically(file, store);

    return {
      allowed: true,
      status: 'reserved',
      claim: cloneClaim(claim),
      rateLimit: guardedRateSnapshot(recent, maxPerWindow, windowMs)
    };
  } finally {
    await release();
  }
}

/** Finalizes a pending guarded-action claim after a possible dispatch. */
export async function finalizeGuardedAction(stateDir, {
  idempotencyHash,
  state,
  evidenceIdHash = null,
  now = Date.now()
} = {}) {
  requireHash(idempotencyHash, 'idempotencyHash');
  if (!['verified', 'ambiguous'].includes(state)) {
    throw new TypeError('final guarded-action state must be verified or ambiguous');
  }
  requireHash(evidenceIdHash, 'evidenceIdHash', { optional: state !== 'verified' });
  if (state === 'verified' && evidenceIdHash == null) {
    throw new TypeError('verified guarded-action state requires evidenceIdHash');
  }
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');

  const file = guardedStoreFilePath(stateDir);
  const release = await acquireFileLock(stateDir, guardedStoreLockPath(stateDir));
  try {
    const store = await readGuardedStore(file);
    const claim = store.claims[idempotencyHash];
    if (!claim) throw new Error('guarded-action claim not found');
    if (claim.state !== 'pending') {
      throw new Error(`guarded-action claim is already ${claim.state}`);
    }

    claim.state = state;
    claim.updatedAt = now;
    claim.evidenceIdHash = evidenceIdHash;
    await writeRateStoreAtomically(file, store);
    return cloneClaim(claim);
  } finally {
    await release();
  }
}

/** Returns a sanitized persisted claim snapshot, or null when absent. */
export async function inspectGuardedAction(stateDir, idempotencyHash) {
  requireHash(idempotencyHash, 'idempotencyHash');
  const release = await acquireFileLock(stateDir, guardedStoreLockPath(stateDir));
  try {
    const store = await readGuardedStore(guardedStoreFilePath(stateDir));
    return cloneClaim(store.claims[idempotencyHash]);
  } finally {
    await release();
  }
}

/**
 * Human-confirmed reconciliation for pending/ambiguous claims.
 * "verified" requires a fresh evidence hash; "clear" only removes the claim.
 * Rate reservations are intentionally retained.
 */
export async function reconcileGuardedAction(stateDir, {
  idempotencyHash,
  resolution,
  evidenceIdHash = null,
  interactive = false,
  confirmed = false,
  now = Date.now()
} = {}) {
  requireHash(idempotencyHash, 'idempotencyHash');
  if (!interactive || !confirmed) throw new Error('guarded-action reconciliation requires interactive confirmation');
  if (!['verified', 'clear'].includes(resolution)) throw new TypeError('resolution must be verified or clear');
  requireHash(evidenceIdHash, 'evidenceIdHash', { optional: resolution !== 'verified' });
  if (resolution === 'verified' && evidenceIdHash == null) {
    throw new TypeError('verified reconciliation requires evidenceIdHash');
  }
  if (!Number.isFinite(now)) throw new TypeError('now must be finite');

  const file = guardedStoreFilePath(stateDir);
  const release = await acquireFileLock(stateDir, guardedStoreLockPath(stateDir));
  try {
    const store = await readGuardedStore(file);
    const claim = store.claims[idempotencyHash];
    if (!claim) throw new Error('guarded-action claim not found');
    if (!['pending', 'ambiguous'].includes(claim.state)) {
      throw new Error(`guarded-action claim is already ${claim.state}`);
    }

    if (resolution === 'clear') {
      delete store.claims[idempotencyHash];
      await writeRateStoreAtomically(file, store);
      return null;
    }

    claim.state = 'verified';
    claim.updatedAt = now;
    claim.evidenceIdHash = evidenceIdHash;
    await writeRateStoreAtomically(file, store);
    return cloneClaim(claim);
  } finally {
    await release();
  }
}

function ledgerFilePath(stateDir, runId) {
  const safe = String(runId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(stateDir, `bulk-ledger-${safe}.json`);
}

/**
 * Loads the per-run bulk ledger: the set of recipient keys already completed in
 * a prior (possibly interrupted) invocation of the same `runId`.
 *
 * @returns {Promise<{ done: Set<string>, file: string }>}
 */
export async function loadBulkLedger(stateDir, runId) {
  const file = ledgerFilePath(stateDir, runId);
  const stored = await readBulkLedger(file);
  return { done: new Set(stored.done), file };
}

/**
 * Marks one recipient key as completed and persists the ledger so a resumed
 * run skips it. Callers must use a stable key (e.g. the thread id).
 */
export async function recordBulkProgress(stateDir, runId, recipientKey) {
  const file = ledgerFilePath(stateDir, runId);
  const release = await acquireFileLock(stateDir, `${file}.lock`);
  try {
    const stored = await readBulkLedger(file);
    const done = new Set(stored.done);
    done.add(String(recipientKey));
    await writeRateStoreAtomically(file, { done: [...done] });
    return done;
  } finally {
    await release();
  }
}
