// YouTube writes: like, comment, subscribe, share, and save-to-playlist.
//
// Real writes validate targets before policy gates, default to dry-run, apply a
// persisted rate check, then navigate through the guarded session before
// interacting.

import fs from 'node:fs/promises';
import path from 'node:path';
import { youtubeSelectors, resolveYouTubeSelector } from '../selectors.mjs';
import { watchUrl, channelUrl } from './ids.mjs';
import { resolveWriteGate, checkAndRecordAction } from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';
import { makeFailureDiagnostic } from '../../../diagnostics.mjs';

async function selectorFor(session, entry) {
  return resolveYouTubeSelector(session.page, entry);
}

async function isPressed(page, selector) {
  if ((await page.locator(selector).count()) !== 1) return false;
  return page.$eval(selector, (element) => {
    const pressed = element.getAttribute('aria-pressed');
    const label = element.getAttribute('aria-label') || '';
    return pressed === 'true' || /^unlike\b/i.test(label) || /liked/i.test(label);
  });
}

async function isSubscribed(page, selector) {
  if ((await page.locator(selector).count()) === 0) return false;
  return page.$eval(selector, (element) => {
    const label = element.getAttribute('aria-label') || '';
    return /subscribed/i.test(label) && !/^subscribe(?:\s|$)/i.test(label);
  });
}
async function uniqueSelectorFor(session, entry) {
  const selector = await selectorFor(session, entry);
  const count = await session.page.locator(selector).count();
  if (count !== 1) {
    throw new Error(`Expected exactly one owned YouTube control, found ${count}`);
  }
  return selector;
}

async function commentBaselineSelector(session) {
  return resolveYouTubeSelector(session.page, youtubeSelectors.video.commentText, {
    emptyState: youtubeSelectors.actions.commentEmptyState
  });
}

async function firstAppearingCommentSelector(session) {
  const { primary, fallback } = youtubeSelectors.video.commentText;
  if ((await session.page.locator(primary).count()) > 0) return primary;
  if ((await session.page.locator(fallback).count()) > 0) return fallback;
  return null;
}

function serializableCause(error, depth = 0) {
  if (depth >= 3 || error == null || (typeof error !== 'object' && typeof error !== 'function')) {
    return error == null
      ? null
      : { name: 'NonErrorCause', message: String(error), code: null, cause: null };
  }

  return {
    name: typeof error.name === 'string' ? error.name : 'Error',
    message: typeof error.message === 'string' ? error.message : String(error),
    code: error.code == null ? null : String(error.code),
    cause: serializableCause(error.cause, depth + 1)
  };
}

function uncertainWrite(session, action, target, rateLimit, error) {
  const cause = serializableCause(error);
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text: `${action} outcome uncertain`, url: target },
    criteria: [],
    rateLimit,
    targetSafety: session.targetSafety,
    performed: false,
    changed: false,
    failure: {
      ...makeFailureDiagnostic({
        stage: 'post-interaction-uncertainty',
        layer: 'youtube-actions',
        attempted: ['perform and verify target-specific YouTube action'],
        blockers: [`${cause.name}: ${cause.message}`],
        remainingChecks: [],
        requiresUserDecision: true
      }),
      cause
    }
  });
}

function normalizeCommentText(text) {
  return String(text).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

async function exactCommentCount(page, selector, expected) {
  return page.$$eval(
    selector,
    (nodes, needle) =>
      nodes.filter(
        (node) => (node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim() === needle
      ).length,
    expected
  );
}

async function waitForState(page, check, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt + 1 < attempts) await page.waitForTimeout(200);
  }
  return false;
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

async function beginWrite(session, action, target, opts, rateKey) {
  const gate = resolveWriteGate(opts);
  if (!gate.allowed) {
    return { blocked: makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' }) };
  }

  const stateBlocker = await requirePersistentRateState(session, action);
  if (stateBlocker) return { blocked: stateBlocker };

  try {
    const rate = await checkAndRecordAction(session.stateDir, rateKey, { record: false });
    if (!rate.allowed) {
      return {
        blocked: makeBlockedResult(action, rate.reason, { stage: 'rate-limit', rateLimit: rate })
      };
    }
  } catch (error) {
    return {
      blocked: makeBlockedResult(action, `persistent rate state is unavailable: ${error.message}`, {
        stage: 'rate-state-error',
        requiresUserDecision: true
      })
    };
  }

  await session.navigateGuarded(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return { target };
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

async function finishWrite(session, action, observation, expected, verified, rateLimit) {
  const targetSafety = session.targetSafety;
  const safe = targetSafety?.disposition === 'ok';
  const passed = verified && safe;
  return makeActionResult({
    action,
    dryRun: false,
    observation,
    criteria: [{ type: 'textIncludes', expected }],
    rateLimit,
    targetSafety,
    performed: passed,
    changed: passed,
    failure: passed
      ? null
      : makeFailureDiagnostic({
          stage: 'write-verification',
          layer: 'youtube-actions',
          attempted: ['verify target-specific YouTube state'],
          blockers: [safe ? `Unable to verify ${action}` : 'target safety was not approved'],
          remainingChecks: [],
          requiresUserDecision: !safe
        })
  });
}

function invalidRef(action, error, stage) {
  return makeBlockedResult(action, error.message, { stage, requiresUserDecision: true });
}

/** Likes a video and verifies YouTube exposes its pressed/liked state. */
export async function likeVideo(session, videoRef, opts = {}) {
  const action = 'youtube:likeVideo';
  let target;
  try {
    target = watchUrl(videoRef);
  } catch (error) {
    return invalidRef(action, error, 'video-ref-validation');
  }

  const pre = await beginWrite(session, action, target, opts, 'yt-like');
  if (pre.blocked) return pre.blocked;

  let selector;
  try {
    selector = await uniqueSelectorFor(session, youtubeSelectors.actions.likeButton);
  } catch (error) {
    return makeBlockedResult(action, error.message, {
      stage: 'selector-ownership',
      requiresUserDecision: true
    });
  }
  const alreadyLiked = await isPressed(session.page, selector);
  if (alreadyLiked) {
    return makeActionResult({
      action,
      dryRun: false,
      observation: { text: 'video liked (state verified)', url: target },
      criteria: [{ type: 'textIncludes', expected: 'video liked (state verified)' }],
      targetSafety: session.targetSafety,
      performed: false,
      changed: false,
      alreadySatisfied: true
    });
  }
  const reservation = await reserveAttempt(session, action, 'yt-like');
  if (reservation.blocked) return reservation.blocked;
  try {
    await session.humanClick(session.page.locator(selector));
    const verified = await waitForState(session.page, () => isPressed(session.page, selector));
    return finishWrite(
      session,
      action,
      { text: verified ? 'video liked (state verified)' : 'like not verified', url: target },
      'video liked (state verified)',
      verified,
      reservation.rateLimit
    );
  } catch (error) {
    return uncertainWrite(session, action, target, reservation.rateLimit, error);
  }
}

/** Posts a non-empty comment and verifies it in the rendered comment threads. */
export async function commentVideo(session, videoRef, text, opts = {}) {
  const action = 'youtube:commentVideo';
  let target;
  try {
    target = watchUrl(videoRef);
  } catch (error) {
    return invalidRef(action, error, 'video-ref-validation');
  }
  if (typeof text !== 'string' || !text.trim()) {
    return makeBlockedResult(action, 'empty comment', { stage: 'input-validation' });
  }

  const pre = await beginWrite(session, action, target, opts, 'yt-comment');
  if (pre.blocked) return pre.blocked;

  const field = await selectorFor(session, youtubeSelectors.actions.commentField);
  const submit = await selectorFor(session, youtubeSelectors.actions.commentSubmit);
  let threads = await commentBaselineSelector(session);
  const expected = normalizeCommentText(text);
  const before = threads ? await exactCommentCount(session.page, threads, expected) : 0;
  const reservation = await reserveAttempt(session, action, 'yt-comment');
  if (reservation.blocked) return reservation.blocked;
  try {
    await session.humanType(session.page.locator(field), text);
    await session.humanClick(session.page.locator(submit));
    const verified = await waitForState(session.page, async () => {
      if (!threads) threads = await firstAppearingCommentSelector(session);
      return threads ? (await exactCommentCount(session.page, threads, expected)) > before : false;
    });
    return finishWrite(
      session,
      action,
      { text: verified ? 'comment posted (text verified)' : 'comment not verified', url: target },
      'comment posted (text verified)',
      verified,
      reservation.rateLimit
    );
  } catch (error) {
    return uncertainWrite(session, action, target, reservation.rateLimit, error);
  }
}

/**
 * Subscription is a high-abuse structural blocker by default. It is enabled
 * only for this action, with both explicit enableSubscribe and dryRun:false.
 */
export async function subscribeChannel(session, channelRef, opts = {}) {
  const action = 'youtube:subscribeChannel';
  let target;
  try {
    target = channelUrl(channelRef);
  } catch (error) {
    return invalidRef(action, error, 'channel-ref-validation');
  }
  if (opts.enableSubscribe !== true || opts.dryRun !== false) {
    return makeBlockedResult(
      action,
      'YouTube subscribe is disabled by default; pass enableSubscribe:true and dryRun:false to act',
      {
        dryRun: opts.dryRun !== false,
        stage: 'policy-disabled',
        requiresUserDecision: true
      }
    );
  }

  const pre = await beginWrite(session, action, target, opts, 'yt-subscribe');
  if (pre.blocked) return pre.blocked;

  const selector = await selectorFor(session, youtubeSelectors.actions.subscribeButton);
  const alreadySubscribed = await isSubscribed(session.page, selector);
  if (alreadySubscribed) {
    return makeActionResult({
      action,
      dryRun: false,
      observation: { text: 'channel subscribed (state verified)', url: target },
      criteria: [{ type: 'textIncludes', expected: 'channel subscribed (state verified)' }],
      targetSafety: session.targetSafety,
      performed: false,
      changed: false,
      alreadySatisfied: true
    });
  }
  const reservation = await reserveAttempt(session, action, 'yt-subscribe');
  if (reservation.blocked) return reservation.blocked;
  try {
    await session.humanClick(session.page.locator(selector));
    const verified = await waitForState(session.page, () => isSubscribed(session.page, selector));
    return finishWrite(
      session,
      action,
      {
        text: verified ? 'channel subscribed (state verified)' : 'subscription not verified',
        url: target
      },
      'channel subscribed (state verified)',
      verified,
      reservation.rateLimit
    );
  } catch (error) {
    return uncertainWrite(session, action, target, reservation.rateLimit, error);
  }
}

/** Validates the target but does not fake a native share action. */
export async function shareVideo(_session, videoRef, _opts = {}) {
  const action = 'youtube:shareVideo';
  try {
    watchUrl(videoRef);
  } catch (error) {
    return invalidRef(action, error, 'video-ref-validation');
  }
  return makeBlockedResult(
    action,
    'YouTube share is unsupported: recipient and destination require an explicit user decision',
    {
      stage: 'unsupported-native-action',
      requiresUserDecision: true
    }
  );
}

/** Validates the target but does not fake playlist selection or saving. */
export async function saveToPlaylist(_session, videoRef, _opts = {}) {
  const action = 'youtube:saveToPlaylist';
  try {
    watchUrl(videoRef);
  } catch (error) {
    return invalidRef(action, error, 'video-ref-validation');
  }
  return makeBlockedResult(
    action,
    'YouTube save to playlist is unsupported: playlist selection requires an explicit user decision',
    {
      stage: 'unsupported-native-action',
      requiresUserDecision: true
    }
  );
}
