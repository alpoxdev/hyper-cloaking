import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  finalizeGuardedAction,
  reserveGuardedAction,
  resolveConfirmationGate,
  resolveWriteGate
} from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';
import { makeFailureDiagnostic } from '../../../diagnostics.mjs';
import { tiktokSelectors } from '../selectors.mjs';
import {
  assertCommentRef,
  assertDraftRef,
  assertThreadRef,
  assertUserRef,
  assertVideoRef
} from './ids.mjs';

const SAFE_RUN_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const FORBIDDEN_ACTIONS = new Set([
  'coldDM', 'bulkDM', 'bulkEngagement', 'account', 'ads', 'liveCommerce',
  'delete', 'moderation', 'unverifiableShare'
]);
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_URL = 'https://www.tiktok.com/upload';

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function block(action, reason, stage = 'policy-disabled') {
  return makeBlockedResult(action, reason, { stage, requiresUserDecision: true });
}

function invalid(action, error, stage) {
  return block(action, error.message, stage);
}

function validateLive(session, action, opts, enableKey) {
  const gate = resolveWriteGate(opts);
  if (!gate.allowed) return makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' });
  if (opts[enableKey] !== true) return block(action, `${action} requires ${enableKey}:true`);
  if (typeof session.stateDir !== 'string' || !session.stateDir.trim()) return block(action, 'persistent stateDir is required', 'state-required');
  if (typeof opts.runId !== 'string' || !SAFE_RUN_ID_RE.test(opts.runId)) return block(action, 'a safe explicit runId is required', 'run-id-required');
  return null;
}

function success(session, action, text, url, rateLimit, { alreadySatisfied = false } = {}) {
  if (session.targetSafety?.disposition !== 'ok') {
    return block(action, 'target safety was not approved', 'target-safety');
  }
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text, url },
    criteria: [{ type: 'textIncludes', expected: text }],
    rateLimit,
    targetSafety: session.targetSafety,
    alreadySatisfied
  });
}

function uncertain(session, action, url, rateLimit, error) {
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text: `${action} outcome uncertain`, url },
    criteria: [],
    rateLimit,
    targetSafety: session.targetSafety,
    performed: false,
    changed: false,
    failure: {
      ...makeFailureDiagnostic({
        stage: 'post-dispatch-uncertainty',
        layer: 'tiktok-actions',
        attempted: ['dispatch once and verify an immutable ID or exact desired state'],
        blockers: [error?.message || 'postcondition not proven'],
        remainingChecks: [],
        requiresUserDecision: true
      }),
      cause: { name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null }
    }
  });
}

async function guarded(session, {
  action, rateKey, maxPerWindow, target, content, runId, dispatch, verify, successText
}) {
  if (session.targetSafety?.disposition !== 'ok') {
    return block(action, 'target safety was not approved', 'target-safety');
  }
  const targetHash = sha(target);
  const contentHash = sha(stable(content));
  const idempotencyHash = sha(stable({ action, contentHash, runId, targetHash }));
  const reservation = await reserveGuardedAction(session.stateDir, {
    actionType: rateKey,
    maxPerWindow,
    idempotencyHash,
    targetHash,
    contentHash,
    runId
  });
  if (!reservation.allowed) {
    return makeBlockedResult(action, `guarded write blocked: ${reservation.status}`, {
      stage: 'guarded-reservation',
      rateLimit: reservation.rateLimit,
      requiresUserDecision: reservation.status !== 'already-verified'
    });
  }
  try {
    await dispatch();
    if (!await verify()) throw new Error('TikTok postcondition was not proven');
    if (session.targetSafety?.disposition !== 'ok') throw new Error('target safety was not approved');
    await finalizeGuardedAction(session.stateDir, {
      idempotencyHash,
      state: 'verified',
      evidenceIdHash: sha(stable({ action, successText, target, verified: true }))
    });
    return success(session, action, successText, target, reservation.rateLimit);
  } catch (error) {
    try {
      await finalizeGuardedAction(session.stateDir, { idempotencyHash, state: 'ambiguous' });
    } catch (finalizeError) {
      return uncertain(session, action, target, reservation.rateLimit, new AggregateError([error, finalizeError], 'dispatch and ambiguity persistence failed'));
    }
    return uncertain(session, action, target, reservation.rateLimit, error);
  }
}

async function activeState(page, selector) {
  return await page.locator(selector).count() === 1;
}

async function waitFor(page, check, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt + 1 < attempts) await page.waitForTimeout(200);
  }
  return false;
}

async function desiredToggle(session, {
  action, target, desired, opts, enableKey, rateKey, maxPerWindow, offSelector, onSelector, content
}) {
  if (typeof desired !== 'boolean') return block(action, 'desired state must be boolean', 'input-validation');
  const blocked = validateLive(session, action, opts, enableKey);
  if (blocked) return blocked;
  await session.navigateGuardedForWrite(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const isOn = () => activeState(session.page, onSelector);
  if (await isOn() === desired) return success(session, action, 'desired state already satisfied', target, null, { alreadySatisfied: true });
  const selector = desired ? offSelector : onSelector;
  if (await session.page.locator(selector).count() !== 1) return block(action, 'owned TikTok transition control is not unique', 'selector-ownership');
  return guarded(session, {
    action, rateKey, maxPerWindow, target, content: { ...content, desired }, runId: opts.runId,
    dispatch: () => session.humanClick(session.page.locator(selector).first()),
    verify: () => waitFor(session.page, async () => (await isOn()) === desired),
    successText: 'desired state updated (state verified)'
  });
}

export async function setLiked(session, videoRef, liked, opts = {}) {
  const action = 'tiktok:setLiked';
  let video;
  try { video = assertVideoRef(videoRef); } catch (error) { return invalid(action, error, 'video-ref-validation'); }
  return desiredToggle(session, {
    action, target: video.url, desired: liked, opts, enableKey: 'enableLike',
    rateKey: 'tiktok-like', maxPerWindow: 10,
    offSelector: tiktokSelectors.video.like, onSelector: tiktokSelectors.video.unlike,
    content: { videoId: video.videoId }
  });
}

export async function setSaved(session, videoRef, saved, opts = {}) {
  const action = 'tiktok:setSaved';
  let video;
  try { video = assertVideoRef(videoRef); } catch (error) { return invalid(action, error, 'video-ref-validation'); }
  return desiredToggle(session, {
    action, target: video.url, desired: saved, opts, enableKey: 'enableSave',
    rateKey: 'tiktok-save', maxPerWindow: 10,
    offSelector: tiktokSelectors.video.save, onSelector: tiktokSelectors.video.unsave,
    content: { videoId: video.videoId }
  });
}

export async function setFollowing(session, userRef, following, opts = {}) {
  const action = 'tiktok:setFollowing';
  let user;
  try { user = assertUserRef(userRef); } catch (error) { return invalid(action, error, 'user-ref-validation'); }
  return desiredToggle(session, {
    action, target: user.url, desired: following, opts, enableKey: 'enableFollow',
    rateKey: 'tiktok-follow', maxPerWindow: 5,
    offSelector: tiktokSelectors.video.follow, onSelector: tiktokSelectors.video.following,
    content: { handle: user.handle }
  });
}

export async function setReposted(session, videoRef, reposted, opts = {}) {
  const action = 'tiktok:setReposted';
  let video;
  try { video = assertVideoRef(videoRef); } catch (error) { return invalid(action, error, 'video-ref-validation'); }
  return desiredToggle(session, {
    action, target: video.url, desired: reposted, opts, enableKey: 'enableRepost',
    rateKey: 'tiktok-repost', maxPerWindow: 5,
    offSelector: tiktokSelectors.video.repost, onSelector: tiktokSelectors.video.unrepost,
    content: { videoId: video.videoId }
  });
}

function normalizeText(value, field, maximum) {
  const text = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > maximum) throw new TypeError(`${field} must contain 1-${maximum} characters`);
  return text;
}

async function exactTextCount(page, selector, text) {
  return page.$$eval(selector, (nodes, expected) => nodes.filter((node) => (node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim() === expected).length, text);
}

async function createComment(session, { action, target, parentId, expected, opts, enableKey }) {
  const blocked = validateLive(session, action, opts, enableKey);
  if (blocked) return blocked;
  await session.navigateGuardedForWrite(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const field = session.page.locator(tiktokSelectors.video.comment);
  const submit = session.page.locator(tiktokSelectors.video.commentSubmit);
  if (await field.count() !== 1 || await submit.count() !== 1) {
    return block(action, 'owned TikTok comment controls are not unique', 'selector-ownership');
  }
  let replyControl = null;
  if (parentId) {
    const root = session.page.locator(`[data-comment-id="${parentId}"]`);
    if (await root.count() !== 1) return block(action, 'TikTok parent comment is not unique', 'selector-ownership');
    replyControl = root.first().locator(tiktokSelectors.video.reply);
    if (await replyControl.count() !== 1) return block(action, 'owned TikTok reply control is not unique', 'selector-ownership');
  }

  const before = await exactTextCount(session.page, tiktokSelectors.video.commentText, expected);
  return guarded(session, {
    action, rateKey: 'tiktok-comment', maxPerWindow: 5, target,
    content: { parentId, text: expected }, runId: opts.runId,
    dispatch: async () => {
      if (replyControl) await session.humanClick(replyControl.first());
      await session.humanType(field.first(), expected);
      await session.humanClick(submit.first());
    },
    verify: () => waitFor(session.page, async () => await exactTextCount(session.page, tiktokSelectors.video.commentText, expected) > before),
    successText: parentId ? 'comment reply created (state verified)' : 'comment created (state verified)'
  });
}

export async function commentVideo(session, videoRef, text, opts = {}) {
  const action = 'tiktok:commentVideo';
  let video;
  try { video = assertVideoRef(videoRef); } catch (error) { return invalid(action, error, 'video-ref-validation'); }
  let expected;
  try { expected = normalizeText(text, 'TikTok comment', 2_200); } catch (error) { return block(action, error.message, 'input-validation'); }
  return createComment(session, { action, target: video.url, parentId: null, expected, opts, enableKey: 'enableComment' });
}

export async function replyToComment(session, commentRef, text, opts = {}) {
  const action = 'tiktok:replyToComment';
  let comment;
  try { comment = assertCommentRef(commentRef); } catch (error) { return invalid(action, error, 'comment-ref-validation'); }
  let expected;
  try { expected = normalizeText(text, 'TikTok comment', 2_200); } catch (error) { return block(action, error.message, 'input-validation'); }
  return createComment(session, { action, target: comment.url, parentId: comment.commentId, expected, opts, enableKey: 'enableReply' });
}

async function messageRows(page) {
  return page.$$eval(tiktokSelectors.dm.message, (nodes) => nodes.slice(-100).map((node) => ({
    messageId: node.getAttribute('data-message-id'),
    direction: node.getAttribute('data-outgoing') === 'true' ? 'out' : 'in',
    text: (node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  })).filter((message) => message.text));
}

export async function replyToDM(session, threadRef, text, opts = {}) {
  const action = 'tiktok:replyToDM';
  const accountId = String(session.accountId ?? '');
  let thread;
  try { thread = assertThreadRef(threadRef, { accountId }); } catch (error) { return invalid(action, error, 'thread-ref-validation'); }
  let expected;
  try { expected = normalizeText(text, 'TikTok DM', 10_000); } catch (error) { return block(action, error.message, 'input-validation'); }
  const blocked = validateLive(session, action, opts, 'enableDMReply');
  if (blocked) return blocked;
  await session.navigateGuardedForWrite(thread.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const before = await messageRows(session.page);
  if (!before.some((message) => message.direction === 'in')) return block(action, 'thread has no inbound message; cold outreach is blocked', 'inbound-required');
  const beforeLastId = before.at(-1)?.messageId || null;
  const composer = session.page.locator(tiktokSelectors.dm.composer);
  const send = session.page.locator(tiktokSelectors.dm.send);
  if (await composer.count() !== 1 || await send.count() !== 1) {
    return block(action, 'owned TikTok DM controls are not unique', 'selector-ownership');
  }
  return guarded(session, {
    action, rateKey: 'tiktok-dm', maxPerWindow: 5, target: thread.url,
    content: { threadId: thread.threadId, text: expected }, runId: opts.runId,
    dispatch: async () => {
      await session.humanType(composer.first(), expected);
      await session.humanClick(send.first());
    },
    verify: () => waitFor(session.page, async () => {
      const after = await messageRows(session.page);
      const last = after.at(-1);
      return Boolean(last?.messageId && last.messageId !== beforeLastId && last.direction === 'out' && last.text === expected);
    }),
    successText: 'inbound-thread DM reply created (state verified)'
  });
}

async function validateUploadFile(file) {
  const absolute = path.resolve(String(file ?? ''));
  const pathStat = await fs.lstat(absolute);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1) {
    throw new TypeError('TikTok upload must be a regular non-symlink single-link file');
  }
  if (pathStat.size <= 0 || pathStat.size > UPLOAD_MAX_BYTES) {
    throw new TypeError(`TikTok upload must contain 1-${UPLOAD_MAX_BYTES} bytes`);
  }
  const extension = path.extname(absolute).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm'
  };
  if (!Object.hasOwn(mimeTypes, extension)) {
    throw new TypeError('TikTok upload extension must be mp4, mov, or webm');
  }

  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new TypeError('TikTok upload requires O_NOFOLLOW support');
  }
  const handle = await fs.open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorStat = await handle.stat();
    if (
      !descriptorStat.isFile()
      || descriptorStat.nlink !== 1
      || descriptorStat.dev !== pathStat.dev
      || descriptorStat.ino !== pathStat.ino
      || descriptorStat.size !== pathStat.size
    ) {
      throw new TypeError('TikTok upload path identity changed during validation');
    }
    const buffer = await handle.readFile();
    const mp4 = buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    const webm = buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if ((extension === '.webm' && !webm) || (extension !== '.webm' && !mp4)) {
      throw new TypeError('TikTok upload extension and file signature do not match');
    }
    return {
      buffer,
      fileHash: createHash('sha256').update(buffer).digest('hex'),
      mimeType: mimeTypes[extension],
      name: path.basename(absolute)
    };
  } finally {
    await handle.close();
  }
}

export async function createUploadDraft(session, file, opts = {}) {
  const action = 'tiktok:createUploadDraft';
  const blocked = validateLive(session, action, opts, 'enableUploadDraft');
  if (blocked) return blocked;
  let upload;
  try { upload = await validateUploadFile(file); } catch (error) { return block(action, error.message, 'upload-validation'); }
  await session.navigateGuardedForWrite(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const before = new Set(await session.page.locator(tiktokSelectors.upload.draft).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-draft-id')).filter(Boolean)));
  return guarded(session, {
    action, rateKey: 'tiktok-upload', maxPerWindow: 2, target: UPLOAD_URL,
    content: { fileHash: upload.fileHash }, runId: opts.runId,
    dispatch: () => session.page.locator(tiktokSelectors.upload.input).setInputFiles({
      name: upload.name,
      mimeType: upload.mimeType,
      buffer: upload.buffer
    }),
    verify: () => waitFor(session.page, async () => {
      const ids = await session.page.locator(tiktokSelectors.upload.draft).evaluateAll((nodes) => nodes
        .map((node) => node.getAttribute('data-draft-id'))
        .filter(Boolean));
      return ids.some((id) => !before.has(id));
    }),
    successText: 'upload draft created (immutable ID verified)'
  });
}

export async function publishDraft(session, draftRef, opts = {}) {
  const action = 'tiktok:publishDraft';
  let draft;
  try { draft = assertDraftRef(draftRef); } catch (error) { return invalid(action, error, 'draft-ref-validation'); }
  const blocked = validateLive(session, action, opts, 'enablePublish');
  if (blocked) return blocked;
  const confirmation = resolveConfirmationGate({ interactive: session.interactive, confirmed: opts.confirmed });
  if (!confirmation.allowed) return block(action, confirmation.reason, 'confirmation-gate');
  await session.navigateGuardedForWrite(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const draftNode = session.page.locator(`${tiktokSelectors.upload.draft}[data-draft-id="${draft.draftId}"]`);
  if (await draftNode.count() !== 1) return block(action, 'existing owned draft could not be proven', 'draft-state');
  const publishedSelector = `[data-published-from-draft-id="${draft.draftId}"][data-video-id]`;
  const beforeVideoIds = new Set(
    await session.page.locator(publishedSelector).evaluateAll((nodes) => nodes
      .map((node) => node.getAttribute('data-video-id'))
      .filter(Boolean))
  );
  return guarded(session, {
    action, rateKey: 'tiktok-publish', maxPerWindow: 1, target: UPLOAD_URL,
    content: { draftId: draft.draftId, publish: true }, runId: opts.runId,
    dispatch: async () => {
      const publishControl = draftNode.first().locator('button[data-e2e="post_video_button"], button:has-text("Post")');
      if (await publishControl.count() !== 1) throw new Error('owned draft publish control is not unique');
      await session.humanClick(publishControl.first());
    },
    verify: () => waitFor(session.page, async () => {
      const videoIds = await session.page.locator(publishedSelector).evaluateAll((nodes) => nodes
        .map((node) => node.getAttribute('data-video-id'))
        .filter((id) => /^\d{1,32}$/.test(id)));
      return videoIds.some((videoId) => !beforeVideoIds.has(videoId));
    }),
    successText: 'draft published (immutable video ID verified)'
  });
}

export function blockedTikTokAction(actionName) {
  const name = String(actionName ?? '');
  if (!FORBIDDEN_ACTIONS.has(name)) throw new TypeError(`unsupported TikTok structural blocker: ${name}`);
  return block(`tiktok:${name}`, `${name} is structurally blocked for TikTok automation`, 'structural-blocker');
}
