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
import { executeInstagramRead } from '../network.mjs';

const THREAD_ID_RE = /^\d{1,64}$/;
const THREAD_PATH_RE = /^\/direct\/t\/(\d{1,64})\/?$/;

function threadFromUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(THREAD_PATH_RE);
    if (
      parsed.protocol !== 'https:'
      || !['instagram.com', 'www.instagram.com'].includes(parsed.hostname)
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash
      || !match
    ) {
      return null;
    }
    return {
      threadId: match[1],
      url: `https://www.instagram.com/direct/t/${match[1]}/`
    };
  } catch {
    return null;
  }
}

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
    const id = ref.threadId == null ? null : String(ref.threadId);
    if (id !== null && !THREAD_ID_RE.test(id)) return null;

    if (ref.url !== undefined) {
      const fromUrl = threadFromUrl(ref.url);
      if (!fromUrl || (id !== null && fromUrl.threadId !== id)) return null;
      return fromUrl;
    }

    return id === null
      ? null
      : { threadId: id, url: `https://www.instagram.com/direct/t/${id}/` };
  }
  return threadFromUrl(ref);
}

export function isValidThreadRef(ref) {
  return normalizeThreadRef(ref) !== null;
}

export function assertExistingThreadRef(ref) {
  const normalized = normalizeThreadRef(ref);
  if (!normalized) throw new InvalidThreadRefError(ref);
  return normalized;
}

function normalizeThreadList(value, limit) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.threads) || value.threads.length > 100) {
    throw new TypeError('Instagram DM thread content must contain at most 100 threads');
  }
  if (value.threads.length === 0 && value.emptyState !== true) {
    throw new TypeError('Instagram empty DM thread content requires explicit empty-state evidence');
  }
  const seen = new Set();
  const threads = [];
  for (const entry of value.threads) {
    const normalized = normalizeThreadRef(entry);
    if (!normalized || seen.has(normalized.threadId)) {
      if (!normalized) throw new TypeError('Instagram DM thread content contains an invalid thread');
      continue;
    }
    seen.add(normalized.threadId);
    threads.push(normalized);
    if (threads.length >= limit) break;
  }
  return threads;
}

function normalizeThreadContent(value, { thread, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.messages) || value.messages.length > 100) {
    throw new TypeError('Instagram DM message content must contain at most 100 messages');
  }
  if (value.messages.length === 0 && value.emptyState !== true) {
    throw new TypeError('Instagram empty DM message content requires explicit empty-state evidence');
  }
  const messages = value.messages
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !['in', 'out'].includes(entry.direction)) {
        throw new TypeError('Instagram DM messages require an in/out direction');
      }
      const text = String(entry.text ?? '').trim();
      if (!text || text.length > 10_000) throw new TypeError('Instagram DM message text is invalid');
      return { direction: entry.direction, text };
    })
    .slice(-limit);
  return { threadId: thread.threadId, messages };
}

/**
 * Lists existing DM threads (read). Returns opaque handles usable as threadRefs.
 */
export async function listDMThreads(session, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 100) : 20;
  const dom = async () => {
    await session.navigateGuardedForRead(instagramSelectors.dm.inboxUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const hrefs = await session.page.$$eval(
      instagramSelectors.dm.threadLink,
      (nodes) => nodes.slice(0, 100).map((node) => node.getAttribute('href')).filter(Boolean)
    );
    if (hrefs.length === 0) {
      const emptyCount = await session.page.locator(instagramSelectors.dm.emptyInboxState).count();
      if (emptyCount === 0) throw new Error('Instagram DM inbox state could not be proven');
    }
    return {
      emptyState: hrefs.length === 0,
      threads: hrefs.map((href) => ({
        url: String(href).startsWith('http')
          ? String(href)
          : `https://www.instagram.com${href}`
      }))
    };
  };
  const { value } = await executeInstagramRead({
    action: 'listDMThreads',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeThreadList(content, limit)
  });
  return wrapReadPayload({
    url: instagramSelectors.dm.inboxUrl,
    content: value,
    kind: 'instagram-dm-threads'
  });
}

async function extractThreadMessages(session, { limit = 100 } = {}) {
  const rows = await session.page.$$eval(
    instagramSelectors.dm.incomingMessage,
    (nodes, rowLimit) => nodes.slice(-rowLimit).map((node) => ({
      messageId: node.getAttribute('data-message-id'),
      text: (node.textContent || '').trim(),
      outgoing: node.getAttribute('data-outgoing') === 'true'
    })),
    limit
  );
  const messages = rows.filter((row) => row.text).map((row) => ({
    messageId: row.messageId || null,
    direction: row.outgoing ? 'out' : 'in',
    text: row.text
  }));
  if (messages.length === 0) {
    const emptyCount = await session.page.locator(instagramSelectors.dm.emptyThreadState).count();
    if (emptyCount === 0) throw new Error('Instagram DM thread state could not be proven');
  }
  return messages;
}

/**
 * Reads a single existing thread (read). Rejects non-existing-thread refs.
 */
export async function readDMThread(session, threadRef, opts = {}) {
  const thread = assertExistingThreadRef(threadRef);
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 100) : 30;
  const dom = async () => {
    await session.navigateGuardedForRead(thread.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const messages = (await extractThreadMessages(session)).map(({ direction, text }) => ({
      direction,
      text
    }));
    return { threadId: thread.threadId, emptyState: messages.length === 0, messages };
  };
  const { value } = await executeInstagramRead({
    action: 'readDMThread',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeThreadContent(content, { thread, limit })
  });
  return wrapReadPayload({
    url: thread.url,
    content: value,
    kind: 'instagram-dm-thread'
  });
}

/**
 * Confirms the already-open thread has >=1 inbound message (invariant #2).
 */
async function threadHasInbound(session) {
  const messages = await extractThreadMessages(session, { limit: 100 });
  return messages.some((message) => message.direction === 'in');
}

/**
 * Sends a message and proves a newly appended exact outbound message before
 * reporting success. Bulk callers persist an uncertain marker before dispatch,
 * so a crash cannot leave an untracked possible send.
 */
async function sendAndVerify(session, message, { beforeDispatch } = {}) {
  const expected = message.trim();
  const before = await extractThreadMessages(session, { limit: 101 });
  await session.humanType(instagramSelectors.dm.composer, message);
  if (beforeDispatch) await beforeDispatch();
  await session.humanClick(instagramSelectors.dm.sendButton);

  const after = await extractThreadMessages(session, { limit: 101 });
  const previousLast = before[before.length - 1];
  const last = after[after.length - 1];
  const sameMessage = (left, right) => Boolean(
    left
    && right
    && (
      (left.messageId && right.messageId && left.messageId === right.messageId)
      || (!left.messageId && !right.messageId && left.direction === right.direction && left.text === right.text)
    )
  );
  const changedTail = Boolean(
    last
    && (
      (last.messageId && last.messageId !== previousLast?.messageId)
      || (
        !last.messageId
        && after.length > before.length
        && before.every((entry, index) => sameMessage(entry, after[index]))
      )
    )
  );
  return changedTail && last.direction === 'out' && last.text === expected;
}

async function replyToDMPrepared(session, thread, message, { beforeDispatch } = {}) {
  const action = 'instagram:replyToDM';
  if (session.stateDir) {
    const rate = await checkAndRecordAction(session.stateDir, 'dm-reply', { record: false });
    if (!rate.allowed) return makeBlockedResult(action, rate.reason, { stage: 'rate-limit', rateLimit: rate });
  }

  await session.navigateGuardedForWrite(thread.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (!(await threadHasInbound(session))) {
    return makeBlockedResult(action, 'thread has no inbound message; refusing to send (no cold outreach)', {
      stage: 'existing-thread-check',
      requiresUserDecision: true
    });
  }

  // Reserve the persisted rate slot before dispatch so verification failures
  // cannot bypass the rolling limit.
  const rate = session.stateDir ? await checkAndRecordAction(session.stateDir, 'dm-reply') : null;
  if (rate && !rate.allowed) {
    return makeBlockedResult(action, rate.reason, { stage: 'rate-limit', rateLimit: rate });
  }
  const verified = await sendAndVerify(session, message, { beforeDispatch });
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text: verified ? 'dm reply sent and verified' : 'dm reply not verified', threadId: thread.threadId },
    criteria: [{ type: 'textIncludes', expected: 'dm reply sent and verified' }],
    rateLimit: rate,
    failure: null
  });
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

  return replyToDMPrepared(session, thread, message);
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

  // Validate every ref up front; one bad or duplicate target blocks the batch.
  const normalized = [];
  const recipientIds = new Set();
  for (const item of list) {
    const thread = normalizeThreadRef(item?.threadRef);
    if (!thread) return makeBlockedResult(action, `invalid thread ref in batch: ${JSON.stringify(item?.threadRef)}`, { stage: 'thread-ref-validation', requiresUserDecision: true });
    if (recipientIds.has(thread.threadId)) {
      return makeBlockedResult(action, `duplicate thread ref in batch: ${thread.threadId}`, {
        stage: 'thread-ref-validation',
        requiresUserDecision: true
      });
    }
    if (typeof item.message !== 'string' || !item.message.trim()) {
      return makeBlockedResult(action, `empty message for thread ${thread.threadId}`, { stage: 'input-validation' });
    }
    recipientIds.add(thread.threadId);
    normalized.push({ thread, message: item.message });
  }

  const gate = resolveWriteGate(opts);
  if (!gate.allowed) {
    return makeBlockedResult(action, `${gate.reason} (${normalized.length} recipients validated)`, { dryRun: true, stage: 'dry-run' });
  }

  const confirm = resolveConfirmationGate({ interactive: session.interactive, confirmed: opts.confirmed });
  if (!confirm.allowed) {
    return makeBlockedResult(action, confirm.reason, { stage: 'confirmation-gate', requiresUserDecision: true });
  }

  const runId = opts.runId;
  if (!session.stateDir) {
    return makeBlockedResult(action, 'live bulk replies require durable stateDir', {
      stage: 'bulk-state',
      requiresUserDecision: true
    });
  }
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
    return makeBlockedResult(action, 'live bulk replies require an explicit safe runId', {
      stage: 'bulk-run-id',
      requiresUserDecision: true
    });
  }

  const ledger = await loadBulkLedger(session.stateDir, runId);
  const results = [];
  for (const { thread, message } of normalized) {
    if (ledger.done.has(thread.threadId)) {
      results.push({ threadId: thread.threadId, skipped: 'already-verified' });
      continue;
    }
    const uncertainKey = `uncertain:${thread.threadId}`;
    if (ledger.done.has(uncertainKey)) {
      return makeBlockedResult(action, `thread ${thread.threadId} has an unresolved prior dispatch`, {
        stage: 'dispatch-uncertain',
        requiresUserDecision: true
      });
    }

    const single = await replyToDMPrepared(session, thread, message, {
      beforeDispatch: () => recordBulkProgress(session.stateDir, runId, uncertainKey)
    });
    results.push({ threadId: thread.threadId, ok: single.ok, performed: single.performed, blocked: single.blocked || false });
    if (single.blocked || !single.performed) {
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
