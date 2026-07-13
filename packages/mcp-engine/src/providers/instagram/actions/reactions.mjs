/**
 * Instagram post/reel reaction actions.
 *
 * Write APIs accept canonical HTTPS post or reel references and return
 * structured action results rather than claiming success optimistically.
 * Unless explicitly enabled by write options, the dry-run gate blocks mutation.
 * Live actions navigate through guarded writes, reserve persisted rate-limit
 * state immediately before dispatch, humanize input, and verify resulting DOM
 * state; validation, gate, navigation, challenge, rate, and verification
 * failures are represented as blocked/failed results. Repost is intentionally
 * unsupported and never mutates state.
 */

import { instagramSelectors } from '../selectors.mjs';
import { resolveWriteGate, checkAndRecordAction } from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';

const POST_PATH_RE = /^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/;

export class InvalidPostRefError extends Error {
  constructor(ref) {
    super(
      `Invalid post reference (expected instagram.com/p/<code> or /reel/<code>): ${JSON.stringify(ref)}`
    );
    this.name = 'InvalidPostRefError';
    this.code = 'invalid-post-ref';
    this.ref = ref;
  }
}

export function normalizePostRef(ref) {
  const value = typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? ref.url : null;
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(POST_PATH_RE);
    if (
      parsed.protocol !== 'https:' ||
      !['instagram.com', 'www.instagram.com'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !match
    ) {
      return null;
    }
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  } catch {
    return null;
  }
}

function assertPostRef(ref) {
  const url = normalizePostRef(ref);
  if (!url) throw new InvalidPostRefError(ref);
  return url;
}

/**
 * Shared write prelude: validate, apply the dry-run gate, and navigate through
 * the strict write guard. Rate reservation happens later, immediately before a
 * real transition, so verified ensure-state no-ops never consume quota.
 */
async function beginWrite(session, action, ref, opts) {
  let url;
  try {
    url = assertPostRef(ref);
  } catch (err) {
    return {
      blocked: makeBlockedResult(action, err.message, {
        stage: 'post-ref-validation',
        requiresUserDecision: true
      })
    };
  }

  const gate = resolveWriteGate(opts);
  if (!gate.allowed) {
    return { blocked: makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' }) };
  }

  await session.navigateGuardedForWrite(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { ok: true, url };
}

async function reserveWriteRate(session, action, rateKey) {
  const rate = session.stateDir ? await checkAndRecordAction(session.stateDir, rateKey) : null;
  if (rate && !rate.allowed) {
    return {
      blocked: makeBlockedResult(action, rate.reason, {
        stage: 'rate-limit',
        rateLimit: rate
      })
    };
  }
  return { rate };
}

async function waitForPresence(page, selector) {
  await page.waitForSelector(selector, { state: 'attached', timeout: 5_000 });
  return Boolean(await page.$(selector));
}

function finishWrite(
  action,
  observation,
  criteriaExpected,
  { rate = null, alreadySatisfied = false } = {}
) {
  return makeActionResult({
    action,
    dryRun: false,
    observation,
    criteria: [{ type: 'textIncludes', expected: criteriaExpected }],
    rateLimit: rate,
    failure: null,
    alreadySatisfied
  });
}

/**
 * Likes a post with ensure-liked semantics. A verified existing liked state is
 * returned as an explicit successful no-op; otherwise one transition is made.
 */
export async function likePost(session, postRef, opts = {}) {
  const action = 'instagram:likePost';
  const pre = await beginWrite(session, action, postRef, opts);
  if (pre.blocked) return pre.blocked;

  const alreadyLiked = Boolean(await session.page.$(instagramSelectors.posts.unlikeButton));
  if (alreadyLiked) {
    return finishWrite(
      action,
      { text: 'post liked (state verified)', url: pre.url },
      'post liked (state verified)',
      { alreadySatisfied: true }
    );
  }

  const reservation = await reserveWriteRate(session, action, 'like');
  if (reservation.blocked) return reservation.blocked;
  await session.humanClick(instagramSelectors.posts.likeButton);
  const nowLiked = await waitForPresence(session.page, instagramSelectors.posts.unlikeButton);
  return finishWrite(
    action,
    { text: nowLiked ? 'post liked (state verified)' : 'like not verified', url: pre.url },
    'post liked (state verified)',
    { rate: reservation.rate }
  );
}

/** Adds a comment and verifies a newly appended exact comment. */
export async function commentPost(session, postRef, text, opts = {}) {
  const action = 'instagram:commentPost';
  if (typeof text !== 'string' || !text.trim()) {
    return makeBlockedResult(action, 'empty comment', { stage: 'input-validation' });
  }
  const pre = await beginWrite(session, action, postRef, opts);
  if (pre.blocked) return pre.blocked;

  const expected = text.trim();
  const matchingCount = () =>
    session.page.$$eval(
      instagramSelectors.posts.commentText,
      (nodes, needle) => nodes.filter((node) => (node.textContent || '').trim() === needle).length,
      expected
    );
  const beforeCount = await matchingCount();
  const reservation = await reserveWriteRate(session, action, 'comment');
  if (reservation.blocked) return reservation.blocked;
  await session.humanType(instagramSelectors.posts.commentField, text);
  await session.humanClick(instagramSelectors.posts.commentSubmit);
  await session.page.waitForFunction(
    ({ selector, needle, baseline }) =>
      [...document.querySelectorAll(selector)].filter(
        (node) => (node.textContent || '').trim() === needle
      ).length > baseline,
    {
      selector: instagramSelectors.posts.commentText,
      needle: expected,
      baseline: beforeCount
    },
    { timeout: 5_000 }
  );
  const afterCount = await matchingCount();
  const verified = afterCount > beforeCount;
  return finishWrite(
    action,
    { text: verified ? 'comment posted (text verified)' : 'comment not verified', url: pre.url },
    'comment posted (text verified)',
    { rate: reservation.rate }
  );
}

/** Saves a post with ensure-saved semantics. */
export async function savePost(session, postRef, opts = {}) {
  const action = 'instagram:savePost';
  const pre = await beginWrite(session, action, postRef, opts);
  if (pre.blocked) return pre.blocked;

  const alreadySaved = Boolean(await session.page.$(instagramSelectors.posts.unsaveButton));
  if (alreadySaved) {
    return finishWrite(
      action,
      { text: 'post saved (state verified)', url: pre.url },
      'post saved (state verified)',
      { alreadySatisfied: true }
    );
  }

  const reservation = await reserveWriteRate(session, action, 'save');
  if (reservation.blocked) return reservation.blocked;
  await session.humanClick(instagramSelectors.posts.saveButton);
  const nowSaved = await waitForPresence(session.page, instagramSelectors.posts.unsaveButton);
  return finishWrite(
    action,
    { text: nowSaved ? 'post saved (state verified)' : 'save not verified', url: pre.url },
    'post saved (state verified)',
    { rate: reservation.rate }
  );
}

/** Opens the share sheet for a post (share via DM). Verifies the sheet opened. */
export async function sharePost(session, postRef, opts = {}) {
  const action = 'instagram:sharePost';
  const pre = await beginWrite(session, action, postRef, opts);
  if (pre.blocked) return pre.blocked;

  const dialogBaseline = await session.page.locator(instagramSelectors.posts.shareDialog).count();
  const reservation = await reserveWriteRate(session, action, 'share');
  if (reservation.blocked) return reservation.blocked;
  await session.humanClick(instagramSelectors.posts.shareButton);
  await session.page.waitForFunction(
    ({ selector, baseline }) => document.querySelectorAll(selector).length > baseline,
    { selector: instagramSelectors.posts.shareDialog, baseline: dialogBaseline },
    { timeout: 5_000 }
  );
  const sheetOpen =
    (await session.page.locator(instagramSelectors.posts.shareDialog).count()) > dialogBaseline;
  return finishWrite(
    action,
    { text: sheetOpen ? 'share sheet opened (verified)' : 'share not verified', url: pre.url },
    'share sheet opened (verified)',
    { rate: reservation.rate }
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
    return makeBlockedResult(action, err.message, {
      stage: 'post-ref-validation',
      requiresUserDecision: true
    });
  }
  return makeBlockedResult(
    action,
    'Instagram has no native repost for feed posts; use sharePost (share to DM/story) instead',
    { stage: 'unsupported-native-action', requiresUserDecision: true }
  );
}
