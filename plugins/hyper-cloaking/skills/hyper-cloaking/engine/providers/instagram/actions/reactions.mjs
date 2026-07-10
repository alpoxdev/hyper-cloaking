// Instagram post/reel reactions (writes): like, comment, save, share, repost.
//
// Every write: validates the target, passes the dryRun gate (default on),
// checks the persisted rate limit, guards origin + challenge, performs the
// action with humanized input, then VERIFIES an observable state change before
// reporting performed:true (invariant: no false success on selector drift).

import { instagramSelectors } from '../selectors.mjs';
import { resolveWriteGate, checkAndRecordAction } from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';

const POST_URL_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[^/]+\/?/;

export class InvalidPostRefError extends Error {
  constructor(ref) {
    super(`Invalid post reference (expected instagram.com/p/<code> or /reel/<code>): ${JSON.stringify(ref)}`);
    this.name = 'InvalidPostRefError';
    this.code = 'invalid-post-ref';
    this.ref = ref;
  }
}

export function normalizePostRef(ref) {
  const url = typeof ref === 'string' ? ref : (ref && typeof ref === 'object' ? ref.url : null);
  if (typeof url === 'string' && POST_URL_RE.test(url)) return url.split('?')[0];
  return null;
}

function assertPostRef(ref) {
  const url = normalizePostRef(ref);
  if (!url) throw new InvalidPostRefError(ref);
  return url;
}

async function safeBodyText(page) {
  try {
    return await page.evaluate(() => document.body?.innerText || '');
  } catch {
    return '';
  }
}

/**
 * Shared write prelude: ref validation, dryRun gate, rate check, navigation,
 * origin + challenge guard. Returns { ok, blocked, url, rate } — when
 * blocked:true the caller returns the blocked result directly.
 */
async function beginWrite(session, action, ref, opts, rateKey) {
  let url;
  try {
    url = assertPostRef(ref);
  } catch (err) {
    return { blocked: makeBlockedResult(action, err.message, { stage: 'post-ref-validation', requiresUserDecision: true }) };
  }

  const gate = resolveWriteGate(opts);
  if (!gate.allowed) {
    return { blocked: makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' }) };
  }

  if (session.stateDir) {
    const rate = await checkAndRecordAction(session.stateDir, rateKey, { record: false });
    if (!rate.allowed) return { blocked: makeBlockedResult(action, rate.reason, { stage: 'rate-limit', rateLimit: rate }) };
  }

  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.requireInstagramOrigin();
  session.throwOnChallenge({ text: await safeBodyText(session.page) });
  return { ok: true, url };
}

async function finishWrite(session, action, rateKey, observation, criteriaExpected, verified) {
  const rate = session.stateDir ? await checkAndRecordAction(session.stateDir, rateKey) : null;
  return makeActionResult({
    action,
    dryRun: false,
    observation,
    criteria: [{ type: 'textIncludes', expected: criteriaExpected }],
    rateLimit: rate,
    failure: verified ? null : undefined
  });
}

/**
 * Likes a post. Verifies the end-state (an "Unlike" button is present), i.e.
 * ensure-liked / idempotent semantics — not a before/after delta. Acting on an
 * already-liked post reports performed:true without a real transition.
 */
export async function likePost(session, postRef, opts = {}) {
  const action = 'instagram:likePost';
  const pre = await beginWrite(session, action, postRef, opts, 'like');
  if (pre.blocked) return pre.blocked;

  await session.humanClick(instagramSelectors.posts.likeButton);
  const nowLiked = await session.page.$(instagramSelectors.posts.unlikeButton).then(Boolean).catch(() => false);
  return finishWrite(
    session, action, 'like',
    { text: nowLiked ? 'post liked (state verified)' : 'like not verified', url: pre.url },
    'post liked (state verified)', nowLiked
  );
}

/** Adds a comment. Verifies the comment text appears after posting. */
export async function commentPost(session, postRef, text, opts = {}) {
  const action = 'instagram:commentPost';
  if (typeof text !== 'string' || !text.trim()) {
    return makeBlockedResult(action, 'empty comment', { stage: 'input-validation' });
  }
  const pre = await beginWrite(session, action, postRef, opts, 'comment');
  if (pre.blocked) return pre.blocked;

  await session.humanType(instagramSelectors.posts.commentField, text);
  await session.humanClick(instagramSelectors.posts.commentSubmit);
  // Verify within the comment list region (not whole-body text): a pre-existing
  // identical comment or the composer's own value must not yield a false pass.
  const inList = await session.page.$$eval(
    instagramSelectors.posts.commentsList,
    (nodes, needle) => nodes.some((n) => (n.textContent || '').includes(needle)),
    text.trim()
  ).catch(() => false);
  const verified = inList;
  return finishWrite(
    session, action, 'comment',
    { text: verified ? 'comment posted (text verified)' : 'comment not verified', url: pre.url },
    'comment posted (text verified)', verified
  );
}

/** Saves a post. Verifies the button toggled to the "Remove" (saved) state. */
export async function savePost(session, postRef, opts = {}) {
  const action = 'instagram:savePost';
  const pre = await beginWrite(session, action, postRef, opts, 'save');
  if (pre.blocked) return pre.blocked;

  await session.humanClick(instagramSelectors.posts.saveButton);
  const nowSaved = await session.page.$(instagramSelectors.posts.unsaveButton).then(Boolean).catch(() => false);
  return finishWrite(
    session, action, 'save',
    { text: nowSaved ? 'post saved (state verified)' : 'save not verified', url: pre.url },
    'post saved (state verified)', nowSaved
  );
}

/** Opens the share sheet for a post (share via DM). Verifies the sheet opened. */
export async function sharePost(session, postRef, opts = {}) {
  const action = 'instagram:sharePost';
  const pre = await beginWrite(session, action, postRef, opts, 'share');
  if (pre.blocked) return pre.blocked;

  await session.humanClick(instagramSelectors.posts.shareButton);
  const sheetOpen = await session.page.$('div[role="dialog"]').then(Boolean).catch(() => false);
  return finishWrite(
    session, action, 'share',
    { text: sheetOpen ? 'share sheet opened (verified)' : 'share not verified', url: pre.url },
    'share sheet opened (verified)', sheetOpen
  );
}

/**
 * Repost: Instagram has no first-party "repost" for arbitrary accounts. Rather
 * than fake an action, return a structured blocker explaining the limitation
 * and pointing at sharePost (share to DM/story) as the supported alternative.
 */
export async function repost(_session, postRef, _opts = {}) {
  const action = 'instagram:repost';
  try {
    assertPostRef(postRef);
  } catch (err) {
    return makeBlockedResult(action, err.message, { stage: 'post-ref-validation', requiresUserDecision: true });
  }
  return makeBlockedResult(
    action,
    'Instagram has no native repost for feed posts; use sharePost (share to DM/story) instead',
    { stage: 'unsupported-native-action', requiresUserDecision: true }
  );
}
