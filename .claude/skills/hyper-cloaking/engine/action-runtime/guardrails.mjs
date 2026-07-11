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

async function removeDeadStaleRateLock(lockFile) {
  let metadata;
  let stat;

  try {
    [metadata, stat] = await Promise.all([
      fs.readFile(lockFile, 'utf8'),
      fs.stat(lockFile)
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  if (Date.now() - stat.mtimeMs < RATE_LOCK_STALE_MS) {
    return false;
  }

  let owner;
  try {
    owner = JSON.parse(metadata);
  } catch {
    return false;
  }

  if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || isProcessAlive(owner.pid)) {
    return false;
  }

  const staleFile = `${lockFile}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fs.rename(lockFile, staleFile);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  await fs.unlink(staleFile);
  return true;
}

async function acquireRateLock(stateDir) {
  await fs.mkdir(stateDir, { recursive: true });
  const lockFile = rateLockPath(stateDir);
  const deadline = Date.now() + RATE_LOCK_TIMEOUT_MS;

  while (true) {
    let ownsLock = false;

    try {
      const handle = await fs.open(lockFile, 'wx');
      ownsLock = true;
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
      } finally {
        await handle.close();
      }

      return async () => {
        await fs.unlink(lockFile);
      };
    } catch (error) {
      if (ownsLock) {
        try {
          await fs.unlink(lockFile);
        } catch (cleanupError) {
          if (cleanupError?.code !== 'ENOENT') {
            throw new AggregateError([error, cleanupError], 'action-rate lock initialization and cleanup failed');
          }
        }
        throw error;
      }

      if (error?.code !== 'EEXIST') {
        throw error;
      }

      await removeDeadStaleRateLock(lockFile);
      if (Date.now() >= deadline) {
        throw new Error(`timed out acquiring action-rate lock at ${lockFile}`);
      }
      await sleep(RATE_LOCK_RETRY_MS);
    }
  }
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

async function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
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
  const stored = await readJsonSafe(file, { done: [] });
  const done = new Set(Array.isArray(stored.done) ? stored.done : []);
  return { done, file };
}

/**
 * Marks one recipient key as completed and persists the ledger so a resumed
 * run skips it. Callers must use a stable key (e.g. the thread id).
 */
export async function recordBulkProgress(stateDir, runId, recipientKey) {
  const { done, file } = await loadBulkLedger(stateDir, runId);
  done.add(String(recipientKey));
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ done: [...done] }), 'utf8');
  return done;
}
