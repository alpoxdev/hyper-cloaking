// Instagram Direct Message actions.
//
// Enforced invariants (mechanical, not comments):
//   1. `threadRef` MUST be an opaque existing-thread handle (/direct/t/<id>)
//      produced by listDMThreads/readDMThread. Usernames and /direct/new/ refs
//      are rejected — this is what makes "reply to existing conversations only,
//      never cold outreach" real (P3).
//   2. Before a real send, the thread must contain >=1 inbound message.
//   3. After a send, the sent text is verified as the last outbound message
//      before `performed:true` is reported.
//   4. replyToMany is capped + human-confirmed + rate-limited + resumable
//      (idempotent via a per-run ledger) so an interrupted bulk run never
//      re-sends.

import { instagramSelectors } from '../selectors.mjs';
import {
  resolveWriteGate,
  resolveConfirmationGate,
  enforceBulkCap,
  checkAndRecordAction,
  loadBulkLedger,
  recordBulkProgress
} from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult, wrapReadPayload } from '../../../action-runtime/action-result.mjs';

const THREAD_URL_RE = /^https:\/\/(www\.)?instagram\.com\/direct\/t\/\d+\/?$/;
const THREAD_ID_RE = /^\d+$/;

export class InvalidThreadRefError extends Error {
  constructor(ref) {
    super(`Invalid thread reference: replies are only allowed to existing threads (/direct/t/<id>), got ${JSON.stringify(ref)}`);
    this.name = 'InvalidThreadRefError';
    this.code = 'invalid-thread-ref';
    this.ref = ref;
  }
}

/**
 * A valid thread ref is either a resolved handle object {threadId, url} or a
 * canonical /direct/t/<id> URL string. Usernames, arbitrary strings, and
 * /direct/new/ deeplinks are rejected — no cold outreach.
 *
 * @param {unknown} ref
 * @returns {{ threadId: string, url: string } | null}
 */
export function normalizeThreadRef(ref) {
  if (ref && typeof ref === 'object') {
    const id = ref.threadId != null ? String(ref.threadId) : null;
    const url = typeof ref.url === 'string' ? ref.url : null;
    if (id && THREAD_ID_RE.test(id)) {
      return { threadId: id, url: url && THREAD_URL_RE.test(url) ? url : `https://www.instagram.com/direct/t/${id}/` };
    }
    if (url && THREAD_URL_RE.test(url)) {
      const m = url.match(/\/direct\/t\/(\d+)/);
      return m ? { threadId: m[1], url } : null;
    }
    return null;
  }
  if (typeof ref === 'string' && THREAD_URL_RE.test(ref)) {
    const m = ref.match(/\/direct\/t\/(\d+)/);
    return m ? { threadId: m[1], url: ref } : null;
  }
  return null;
}

export function isValidThreadRef(ref) {
  return normalizeThreadRef(ref) !== null;
}

export function assertExistingThreadRef(ref) {
  const normalized = normalizeThreadRef(ref);
  if (!normalized) throw new InvalidThreadRefError(ref);
  return normalized;
}

/**
 * Lists existing DM threads (read). Returns opaque handles usable as threadRefs.
 */
export async function listDMThreads(session, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 20;
  await session.page.goto(instagramSelectors.dm.inboxUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.requireInstagramOrigin();
  session.throwOnChallenge({ text: await safeBodyText(session.page) });

  const hrefs = await session.page.$$eval(
    instagramSelectors.dm.threadLink,
    (nodes) => nodes.map((n) => n.getAttribute('href')).filter(Boolean)
  );
  const seen = new Set();
  const threads = [];
  for (const href of hrefs) {
    const m = String(href).match(/\/direct\/t\/(\d+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    threads.push({ threadId: m[1], url: `https://www.instagram.com/direct/t/${m[1]}/` });
    if (threads.length >= limit) break;
  }
  return wrapReadPayload({ url: instagramSelectors.dm.inboxUrl, content: threads, kind: 'instagram-dm-threads' });
}

/**
 * Reads a single existing thread (read). Rejects non-existing-thread refs.
 */
export async function readDMThread(session, threadRef, opts = {}) {
  const thread = assertExistingThreadRef(threadRef);
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 30;
  await session.page.goto(thread.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.requireInstagramOrigin();
  session.throwOnChallenge({ text: await safeBodyText(session.page) });

  const rows = await session.page.$$eval(
    instagramSelectors.dm.incomingMessage,
    (nodes) => nodes.slice(-200).map((n) => ({
      text: (n.textContent || '').trim(),
      // A message the current user sent is typically right-aligned; expose a best-effort direction hint.
      outgoing: n.getAttribute('data-outgoing') === 'true'
    }))
  ).catch(() => []);
  const messages = rows.filter((r) => r.text).slice(-limit).map((r) => ({
    direction: r.outgoing ? 'out' : 'in',
    text: r.text
  }));
  return wrapReadPayload({ url: thread.url, content: { threadId: thread.threadId, messages }, kind: 'instagram-dm-thread' });
}

async function safeBodyText(page) {
  try {
    return await page.evaluate(() => document.body?.innerText || '');
  } catch {
    return '';
  }
}

/**
 * Confirms the thread has >=1 inbound message (invariant #2). Reuses readDMThread.
 */
async function threadHasInbound(session, thread) {
  const read = await readDMThread(session, thread, { limit: 50 });
  const messages = read?.content?.messages || [];
  return messages.some((m) => m.direction === 'in');
}

/**
 * Sends a message and verifies it appears as the last outbound message
 * (invariant #3) before reporting performed:true.
 */
async function sendAndVerify(session, thread, message) {
  await session.humanType(instagramSelectors.dm.composer, message);
  await session.humanClick(instagramSelectors.dm.sendButton);
  // Post-action verification: the sent text must appear as the last message.
  const read = await readDMThread(session, thread, { limit: 5 });
  const messages = read?.content?.messages || [];
  const last = messages[messages.length - 1];
  return Boolean(last && last.text && last.text.includes(message.trim()));
}

/**
 * Replies to ONE existing thread. dryRun-default; rate-limited; verified.
 */
export async function replyToDM(session, threadRef, message, opts = {}) {
  const action = 'instagram:replyToDM';
  let thread;
  try {
    thread = assertExistingThreadRef(threadRef);
  } catch (err) {
    return makeBlockedResult(action, err.message, { stage: 'thread-ref-validation', requiresUserDecision: true });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return makeBlockedResult(action, 'empty message', { stage: 'input-validation' });
  }

  const gate = resolveWriteGate(opts);
  if (!gate.allowed) {
    return makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' });
  }

  if (session.stateDir) {
    const rate = await checkAndRecordAction(session.stateDir, 'dm-reply', { record: false });
    if (!rate.allowed) return makeBlockedResult(action, rate.reason, { stage: 'rate-limit', rateLimit: rate });
  }

  await session.page.goto(thread.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.requireInstagramOrigin();
  session.throwOnChallenge({ text: await safeBodyText(session.page) });

  if (!(await threadHasInbound(session, thread))) {
    return makeBlockedResult(action, 'thread has no inbound message; refusing to send (no cold outreach)', { stage: 'existing-thread-check', requiresUserDecision: true });
  }

  const verified = await sendAndVerify(session, thread, message);
  const rate = session.stateDir ? await checkAndRecordAction(session.stateDir, 'dm-reply') : null;
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text: verified ? 'dm reply sent and verified' : 'dm reply not verified', threadId: thread.threadId },
    criteria: [{ type: 'textIncludes', expected: 'dm reply sent and verified' }],
    rateLimit: rate,
    failure: verified ? null : undefined
  });
}

/**
 * Replies to MANY existing threads. Highest abuse surface, so:
 *   - each item's threadRef must be an existing-thread handle (no cold outreach)
 *   - count is capped
 *   - a human confirmation gate that cannot be satisfied non-interactively
 *   - per-recipient rate limiting
 *   - a resume ledger so an interrupted run never re-sends (idempotent)
 *
 * @param {object} session
 * @param {Array<{threadRef: unknown, message: string}>} items
 * @param {{ dryRun?: boolean, cap?: number, confirmed?: boolean, runId?: string }} [opts]
 */
export async function replyToMany(session, items, opts = {}) {
  const action = 'instagram:replyToMany';
  const list = Array.isArray(items) ? items : [];

  const bulk = enforceBulkCap(list, { cap: opts.cap });
  if (!bulk.allowed) return makeBlockedResult(action, bulk.reason, { stage: 'bulk-cap', requiresUserDecision: true });

  // Validate every ref up front; one bad ref blocks the whole batch.
  const normalized = [];
  for (const item of list) {
    const t = normalizeThreadRef(item?.threadRef);
    if (!t) return makeBlockedResult(action, `invalid thread ref in batch: ${JSON.stringify(item?.threadRef)}`, { stage: 'thread-ref-validation', requiresUserDecision: true });
    if (typeof item.message !== 'string' || !item.message.trim()) {
      return makeBlockedResult(action, `empty message for thread ${t.threadId}`, { stage: 'input-validation' });
    }
    normalized.push({ thread: t, message: item.message });
  }

  const gate = resolveWriteGate(opts);
  if (!gate.allowed) {
    return makeBlockedResult(action, `${gate.reason} (${normalized.length} recipients validated)`, { dryRun: true, stage: 'dry-run' });
  }

  const confirm = resolveConfirmationGate({ interactive: session.interactive, confirmed: opts.confirmed });
  if (!confirm.allowed) {
    return makeBlockedResult(action, confirm.reason, { stage: 'confirmation-gate', requiresUserDecision: true });
  }

  const runId = opts.runId || `replyToMany-${normalized.length}`;
  const ledger = session.stateDir ? await loadBulkLedger(session.stateDir, runId) : { done: new Set() };
  const results = [];
  for (const { thread, message } of normalized) {
    if (ledger.done.has(thread.threadId)) {
      results.push({ threadId: thread.threadId, skipped: 'already-sent' });
      continue;
    }
    const single = await replyToDM(session, thread, message, { dryRun: false });
    results.push({ threadId: thread.threadId, ok: single.ok, performed: single.performed, blocked: single.blocked || false });
    if (single.blocked || !single.performed) {
      // Stop the batch on the first failure/challenge; ledger preserves progress.
      return makeActionResult({
        action,
        dryRun: false,
        observation: { text: 'bulk reply aborted mid-run', results, aborted: true },
        criteria: [{ type: 'textIncludes', expected: 'bulk reply completed' }]
      });
    }
    if (session.stateDir) await recordBulkProgress(session.stateDir, runId, thread.threadId);
  }

  return makeActionResult({
    action,
    dryRun: false,
    observation: { text: 'bulk reply completed', results },
    criteria: [{ type: 'textIncludes', expected: 'bulk reply completed' }]
  });
}
