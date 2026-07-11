// Reddit write reactions. Writes validate refs before any gate or navigation and
// report performed:true only after an observable Reddit UI state is confirmed.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  redditCommentByIdSelector,
  redditCommentOwnedSelectors,
  redditPostByIdSelector,
  redditPostOwnedSelectors
} from '../selectors.mjs';
import { resolveWriteGate, checkAndRecordAction } from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';
import { makeFailureDiagnostic } from '../../../diagnostics.mjs';
import { assertPostRef, assertExistingCommentRef } from './ids.mjs';

const VERIFY_ATTEMPTS = 5;
const VERIFY_DELAY_MS = 250;

function normalizeCommentText(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

async function uniqueSelectorLocator(page, entry) {
  const primary = page.locator(entry.primary);
  const primaryCount = await primary.count();
  if (primaryCount > 0) return primaryCount === 1 ? { locator: primary, tier: 'primary' } : null;

  const fallback = page.locator(entry.fallback);
  const fallbackCount = await fallback.count();
  return fallbackCount === 1 ? { locator: fallback, tier: 'fallback' } : null;
}

async function uniqueLocator(page, entry) {
  return (await uniqueSelectorLocator(page, entry))?.locator ?? null;
}

async function isPresent(scope, entry) {
  if (await scope.locator(entry.primary).count() > 0) return true;
  return await scope.locator(entry.fallback).count() > 0;
}

async function pollVerification(page, check) {
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    if (await check()) return true;
    if (attempt + 1 < VERIFY_ATTEMPTS && typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(VERIFY_DELAY_MS);
    }
  }
  return false;
}

const ERROR_EVIDENCE_MAX_DEPTH = 3;
const ERROR_EVIDENCE_MAX_LENGTH = 500;

function boundedErrorText(value) {
  try {
    return String(value).slice(0, ERROR_EVIDENCE_MAX_LENGTH);
  } catch {
    return '[unserializable error value]';
  }
}

function errorField(error, field) {
  try {
    return error != null && (typeof error === 'object' || typeof error === 'function')
      ? error[field]
      : undefined;
  } catch {
    return undefined;
  }
}

function errorEvidence(error, depth = 0) {
  const name = errorField(error, 'name');
  const message = errorField(error, 'message');
  const code = errorField(error, 'code');
  const cause = errorField(error, 'cause');

  return {
    name: name == null ? 'Error' : boundedErrorText(name),
    message: message == null ? boundedErrorText(error) : boundedErrorText(message),
    code: code == null ? null : boundedErrorText(code),
    cause: cause == null || depth >= ERROR_EVIDENCE_MAX_DEPTH ? null : errorEvidence(cause, depth + 1)
  };
}

function boundedErrorMessage(error) {
  return errorEvidence(error).message;
}

function verificationFailure(action, blocker, attempted, error = null) {
  const failure = makeFailureDiagnostic({ stage: 'verification', layer: action, attempted, blockers: [blocker], remainingChecks: [] });
  if (error !== null) failure.error = errorEvidence(error);
  return failure;
}

function interactionFailure(action, error, attempted) {
  const failure = makeFailureDiagnostic({
    stage: 'interaction',
    layer: action,
    attempted,
    blockers: [`interaction outcome is uncertain: ${boundedErrorMessage(error)}`],
    remainingChecks: [],
    requiresUserDecision: true
  });
  failure.error = errorEvidence(error);
  return failure;
}

async function verify(page, action, check, attempted) {
  try {
    return { verified: await pollVerification(page, check), failure: null };
  } catch (error) {
    return { verified: false, failure: verificationFailure(action, `verification runtime failure: ${boundedErrorMessage(error)}`, attempted, error) };
  }
}

async function matchingCommentCountInLocator(locator, text) {
  const contents = await locator.allTextContents();
  const expected = normalizeCommentText(text);
  return contents.filter((content) => normalizeCommentText(content) === expected).length;
}


function rateStateRequired(action) {
  return makeBlockedResult(action, 'persistent rate state is required for real writes', {
    stage: 'rate-state-required',
    requiresUserDecision: true
  });
}

async function requirePersistentRateState(session, action) {
  if (typeof session.stateDir !== 'string' || !session.stateDir.trim()) {
    return rateStateRequired(action);
  }

  try {
    await fs.mkdir(session.stateDir, { recursive: true });
    await fs.access(session.stateDir, fs.constants.R_OK | fs.constants.W_OK);
    const rateFile = path.join(session.stateDir, 'action-rate.json');
    await fs.readFile(rateFile, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  } catch (error) {
    return makeBlockedResult(action, `persistent rate state is unavailable: ${error.message}`, {
      stage: 'rate-state-error',
      requiresUserDecision: true
    });
  }
  return null;
}

async function beginWrite(session, action, ref, opts, rateKey, assertRef = assertPostRef) {
  let target;
  try {
    target = assertRef(ref);
  } catch (error) {
    return { blocked: makeBlockedResult(action, error.message, { stage: 'ref-validation', requiresUserDecision: true }) };
  }
  const gate = resolveWriteGate(opts);
  if (!gate.allowed) return { blocked: makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' }) };

  const stateBlocker = await requirePersistentRateState(session, action);
  if (stateBlocker) return { blocked: stateBlocker };

  try {
    const rate = await checkAndRecordAction(session.stateDir, rateKey, { record: false });
    if (!rate.allowed) return { blocked: makeBlockedResult(action, rate.reason, { stage: 'rate-limit', rateLimit: rate }) };
  } catch (error) {
    return {
      blocked: makeBlockedResult(action, `persistent rate state is unavailable: ${error.message}`, {
        stage: 'rate-state-error',
        requiresUserDecision: true
      })
    };
  }
  await session.navigateGuarded(target.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { url: target.url, target };
}

async function reserveAttempt(session, action, rateKey) {
  try {
    const rateLimit = await checkAndRecordAction(session.stateDir, rateKey);
    if (!rateLimit.allowed) {
      return {
        blocked: makeBlockedResult(action, rateLimit.reason, {
          stage: 'rate-limit',
          rateLimit
        })
      };
    }
    return { rateLimit };
  } catch (error) {
    return {
      blocked: makeBlockedResult(action, `persistent rate state is unavailable: ${error.message}`, {
        stage: 'rate-state-error',
        requiresUserDecision: true
      })
    };
  }
}

function unverifiedResult(session, action, observation, expected, failure, rateLimit = null) {
  return makeActionResult({
    action, dryRun: false, observation, criteria: [{ type: 'textIncludes', expected }], rateLimit,
    targetSafety: session.targetSafety, failure, performed: false, changed: false
  });
}

async function afterReservation(session, action, observation, expected, rateLimit, attempted, run) {
  try {
    return await run();
  } catch (error) {
    return unverifiedResult(
      session,
      action,
      observation,
      expected,
      interactionFailure(action, error, attempted),
      rateLimit
    );
  }
}

function finishWrite(session, action, observation, expected, verification, rateLimit) {
  const failure = verification.verified
    ? null
    : verification.failure || verificationFailure(action, 'desired UI state was not observed', ['polled desired UI state']);
  return makeActionResult({
    action, dryRun: false, observation, criteria: [{ type: 'textIncludes', expected }], rateLimit,
    targetSafety: session.targetSafety, failure, performed: verification.verified, changed: verification.verified
  });
}

function verifiedNoop(session, action, observation, expected) {
  return makeActionResult({
    action, dryRun: false, observation, criteria: [{ type: 'textIncludes', expected }],
    targetSafety: session.targetSafety, performed: false, changed: false, alreadySatisfied: true
  });
}

async function postRoot(page, postId) {
  return uniqueLocator(page, redditPostByIdSelector(postId));
}

async function requirePostControls(page, postId, names) {
  const owned = redditPostOwnedSelectors(postId);
  const controls = {};
  for (const name of names) {
    controls[name] = await uniqueLocator(page, owned[name]);
    if (!controls[name]) return null;
  }
  return { owned, controls };
}

async function requireCommentControls(page, commentId, names) {
  const owned = redditCommentOwnedSelectors(commentId);
  const controls = {};
  for (const name of names) {
    controls[name] = await uniqueLocator(page, owned[name]);
    if (!controls[name]) return null;
  }
  return { owned, controls };
}

function ownershipFailure(session, action, url, expected, target) {
  return unverifiedResult(session, action, { text: `${target} target not uniquely proven`, url }, expected,
    verificationFailure(action, `requested ${target} ownership region or control was not uniquely found`, [`located canonical ${target} root and owned controls`]));
}

export async function upvotePost(session, postRef, opts = {}) {
  const action = 'reddit:upvotePost';
  try { assertPostRef(postRef); } catch (error) {
    return makeBlockedResult(action, error.message, { stage: 'ref-validation', requiresUserDecision: true });
  }
  if (opts.enableUpvote !== true || opts.dryRun !== false) {
    return makeBlockedResult(action, 'Reddit upvote is disabled by default; pass enableUpvote:true and dryRun:false to act', { stage: 'policy-disabled', dryRun: opts.dryRun !== false, requiresUserDecision: true });
  }
  const pre = await beginWrite(session, action, postRef, opts, 'reddit-upvote');
  if (pre.blocked) return pre.blocked;
  if (!await postRoot(session.page, pre.target.postId)) return ownershipFailure(session, action, pre.url, 'post upvoted (state verified)', 'post');
  const owned = await requirePostControls(session.page, pre.target.postId, ['actionBar', 'upvote']);
  if (!owned) return ownershipFailure(session, action, pre.url, 'post upvoted (state verified)', 'post');
  if (await isPresent(session.page, owned.owned.upvoted)) return verifiedNoop(session, action, { text: 'post already upvoted (state verified)', url: pre.url }, 'post already upvoted (state verified)');
  const reservation = await reserveAttempt(session, action, 'reddit-upvote');
  if (reservation.blocked) return reservation.blocked;
  return afterReservation(
    session,
    action,
    { text: 'upvote outcome uncertain after click attempt', url: pre.url },
    'post upvoted (state verified)',
    reservation.rateLimit,
    ['attempted uniquely owned post upvote click'],
    async () => {
      await session.humanClick(owned.controls.upvote);
      const verification = await verify(session.page, action, () => isPresent(session.page, owned.owned.upvoted), ['checked uniquely owned post upvote selected state']);
      return finishWrite(session, action, { text: verification.verified ? 'post upvoted (state verified)' : 'upvote not verified', url: pre.url }, 'post upvoted (state verified)', verification, reservation.rateLimit);
    }
  );
}

export async function commentPost(session, postRef, text, opts = {}) {
  const action = 'reddit:commentPost';
  if (typeof text !== 'string' || !text.trim()) return makeBlockedResult(action, 'empty comment', { stage: 'input-validation' });
  const pre = await beginWrite(session, action, postRef, opts, 'reddit-comment');
  if (pre.blocked) return pre.blocked;
  const post = await uniqueSelectorLocator(session.page, redditPostByIdSelector(pre.target.postId));
  if (!post) return ownershipFailure(session, action, pre.url, 'comment posted (new exact text verified)', 'post');
  const owned = await requirePostControls(session.page, pre.target.postId, ['composer', 'commentField', 'commentSubmit']);
  if (!owned) return ownershipFailure(session, action, pre.url, 'comment posted (new exact text verified)', 'post');
  const commentBodies = session.page.locator(owned.owned.commentBodies[post.tier]);
  const before = await matchingCommentCountInLocator(commentBodies, text);
  const reservation = await reserveAttempt(session, action, 'reddit-comment');
  if (reservation.blocked) return reservation.blocked;
  return afterReservation(
    session,
    action,
    { text: 'comment outcome uncertain after submission attempt', url: pre.url },
    'comment posted (new exact text verified)',
    reservation.rateLimit,
    ['froze the uniquely owned post comment-body selector tier before submission', 'attempted comment entry and submission'],
    async () => {
      await session.humanType(owned.controls.commentField, text);
      await session.humanClick(owned.controls.commentSubmit);
      const verification = await verify(session.page, action, async () => (await matchingCommentCountInLocator(commentBodies, text)) > before, ['counted exact text only in the frozen selector tier of the owned post comment tree before and after submit']);
      return finishWrite(session, action, { text: verification.verified ? 'comment posted (new exact text verified)' : 'comment not verified', url: pre.url }, 'comment posted (new exact text verified)', verification, reservation.rateLimit);
    }
  );
}

export async function replyToComment(session, commentRef, text, opts = {}) {
  const action = 'reddit:replyToComment';
  if (typeof text !== 'string' || !text.trim()) return makeBlockedResult(action, 'empty reply', { stage: 'input-validation' });
  const pre = await beginWrite(session, action, commentRef, opts, 'reddit-reply', assertExistingCommentRef);
  if (pre.blocked) return pre.blocked;
  const commentRoot = await uniqueSelectorLocator(session.page, redditCommentByIdSelector(pre.target.commentId));
  if (!commentRoot) return ownershipFailure(session, action, pre.url, 'reply posted (new exact child text verified)', 'comment');
  let owned = await requireCommentControls(session.page, pre.target.commentId, ['actionRow', 'reply']);
  if (!owned) return ownershipFailure(session, action, pre.url, 'reply posted (new exact child text verified)', 'comment');
  const replyBodies = session.page.locator(owned.owned.childReplyBodies[commentRoot.tier]);
  const before = await matchingCommentCountInLocator(replyBodies, text);
  const reservation = await reserveAttempt(session, action, 'reddit-reply');
  if (reservation.blocked) return reservation.blocked;
  return afterReservation(
    session,
    action,
    { text: 'reply outcome uncertain after submission attempt', url: pre.url },
    'reply posted (new exact child text verified)',
    reservation.rateLimit,
    ['attempted uniquely owned comment reply interaction'],
    async () => {
      await session.humanClick(owned.controls.reply);
      owned = await requireCommentControls(session.page, pre.target.commentId, ['composer', 'commentField', 'commentSubmit']);
      if (!owned) return finishWrite(session, action, { text: 'reply composer not uniquely proven', url: pre.url }, 'reply posted (new exact child text verified)', { verified: false, failure: verificationFailure(action, 'requested comment reply composer was not uniquely found after Reply was clicked', ['located canonical comment action row', 'clicked owned Reply control']) }, reservation.rateLimit);
      await session.humanType(owned.controls.commentField, text);
      await session.humanClick(owned.controls.commentSubmit);
      const verification = await verify(session.page, action, async () => (await matchingCommentCountInLocator(replyBodies, text)) > before, ['counted exact text only in the frozen selector tier of the owned direct child-reply collection before and after submit']);
      return finishWrite(session, action, { text: verification.verified ? 'reply posted (new exact child text verified)' : 'reply not verified', url: pre.url }, 'reply posted (new exact child text verified)', verification, reservation.rateLimit);
    }
  );
}

export async function savePost(session, postRef, opts = {}) {
  const action = 'reddit:savePost';
  const pre = await beginWrite(session, action, postRef, opts, 'reddit-save');
  if (pre.blocked) return pre.blocked;
  if (!await postRoot(session.page, pre.target.postId)) return ownershipFailure(session, action, pre.url, 'post saved (state verified)', 'post');
  const ownedSelectors = redditPostOwnedSelectors(pre.target.postId);
  if (await isPresent(session.page, ownedSelectors.saved)) {
    return verifiedNoop(session, action, { text: 'post already saved (state verified)', url: pre.url }, 'post already saved (state verified)');
  }
  const owned = await requirePostControls(session.page, pre.target.postId, ['actionBar', 'save']);
  if (!owned) return ownershipFailure(session, action, pre.url, 'post saved (state verified)', 'post');
  const reservation = await reserveAttempt(session, action, 'reddit-save');
  if (reservation.blocked) return reservation.blocked;
  return afterReservation(
    session,
    action,
    { text: 'save outcome uncertain after click attempt', url: pre.url },
    'post saved (state verified)',
    reservation.rateLimit,
    ['attempted uniquely owned post save click'],
    async () => {
      await session.humanClick(owned.controls.save);
      const verification = await verify(session.page, action, () => isPresent(session.page, owned.owned.saved), ['checked uniquely owned post Unsave state']);
      return finishWrite(session, action, { text: verification.verified ? 'post saved (state verified)' : 'save not verified', url: pre.url }, 'post saved (state verified)', verification, reservation.rateLimit);
    }
  );
}
