import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  finalizeGuardedAction,
  reserveGuardedAction,
  resolveWriteGate
} from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';
import { makeFailureDiagnostic } from '../../../diagnostics.mjs';
import { xSelectors } from '../selectors.mjs';
import { assertPostRef, assertThreadRef, assertUserRef } from './ids.mjs';

const SAFE_RUN_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const FORBIDDEN_ACTIONS = new Set([
  'account',
  'security',
  'ads',
  'moderation',
  'delete',
  'followerScraping',
  'protectedBypass',
  'bulk',
  'coldDM'
]);
const REPLY_AUDIENCE = new Set(['everyone', 'following', 'mentioned', 'verified']);
const TEXT_MAX = 280;
const IMAGE_EXTENSIONS = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const GIF_EXTENSIONS = { '.gif': 'image/gif' };
const VIDEO_EXTENSIONS = { '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_COUNT = 4;
const GIF_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
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
  if (!gate.allowed)
    return makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' });
  if (opts[enableKey] !== true) return block(action, `${action} requires ${enableKey}:true`);
  if (typeof session.stateDir !== 'string' || !session.stateDir.trim())
    return block(action, 'persistent stateDir is required', 'state-required');
  if (typeof opts.runId !== 'string' || !SAFE_RUN_ID_RE.test(opts.runId))
    return block(action, 'a safe explicit runId is required', 'run-id-required');
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
        layer: 'x-actions',
        attempted: ['dispatch once and verify an immutable ID or exact desired state'],
        blockers: [error?.message || 'postcondition not proven'],
        remainingChecks: [],
        requiresUserDecision: true
      }),
      cause: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        code: error?.code || null
      }
    }
  });
}

async function guarded(
  session,
  { action, rateKey, maxPerWindow, target, content, runId, dispatch, verify, successText }
) {
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
    if (session.targetSafety?.disposition !== 'ok')
      throw new Error('target safety was not approved');
    if (!(await verify())) throw new Error('X postcondition was not proven');
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
      return uncertain(
        session,
        action,
        target,
        reservation.rateLimit,
        new AggregateError([error, finalizeError], 'dispatch and ambiguity persistence failed')
      );
    }
    return uncertain(session, action, target, reservation.rateLimit, error);
  }
}

async function activeState(page, selector) {
  return (await page.locator(selector).count()) === 1;
}

async function waitFor(page, check, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt + 1 < attempts) await page.waitForTimeout(200);
  }
  return false;
}

async function desiredToggle(
  session,
  {
    action,
    target,
    desired,
    opts,
    enableKey,
    rateKey,
    maxPerWindow,
    offSelector,
    onSelector,
    content
  }
) {
  if (typeof desired !== 'boolean')
    return block(action, 'desired state must be boolean', 'input-validation');
  const blocked = validateLive(session, action, opts, enableKey);
  if (blocked) return blocked;
  await session.navigateGuardedForWrite(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const isOn = () => activeState(session.page, onSelector);
  if ((await isOn()) === desired)
    return success(session, action, 'desired state already satisfied', target, null, {
      alreadySatisfied: true
    });
  const selector = desired ? offSelector : onSelector;
  if ((await session.page.locator(selector).count()) !== 1)
    return block(action, 'owned X transition control is not unique', 'selector-ownership');
  return guarded(session, {
    action,
    rateKey,
    maxPerWindow,
    target,
    content: { ...content, desired },
    runId: opts.runId,
    dispatch: () => session.humanClick(session.page.locator(selector).first()),
    verify: () => waitFor(session.page, async () => (await isOn()) === desired),
    successText: 'desired state updated (state verified)'
  });
}

export async function setLiked(session, postRef, liked, opts = {}) {
  const action = 'x:setLiked';
  let post;
  try {
    post = assertPostRef(postRef);
  } catch (error) {
    return invalid(action, error, 'post-ref-validation');
  }
  return desiredToggle(session, {
    action,
    target: post.url,
    desired: liked,
    opts,
    enableKey: 'enableLike',
    rateKey: 'x-like',
    maxPerWindow: 10,
    offSelector: xSelectors.post.like,
    onSelector: xSelectors.post.unlike,
    content: { postId: post.postId }
  });
}

export async function setBookmarked(session, postRef, bookmarked, opts = {}) {
  const action = 'x:setBookmarked';
  let post;
  try {
    post = assertPostRef(postRef);
  } catch (error) {
    return invalid(action, error, 'post-ref-validation');
  }
  return desiredToggle(session, {
    action,
    target: post.url,
    desired: bookmarked,
    opts,
    enableKey: 'enableBookmark',
    rateKey: 'x-bookmark',
    maxPerWindow: 10,
    offSelector: xSelectors.post.bookmark,
    onSelector: xSelectors.post.unbookmark,
    content: { postId: post.postId }
  });
}

export async function setFollowing(session, userRef, following, opts = {}) {
  const action = 'x:setFollowing';
  let user;
  try {
    user = assertUserRef(userRef);
  } catch (error) {
    return invalid(action, error, 'user-ref-validation');
  }
  return desiredToggle(session, {
    action,
    target: user.url,
    desired: following,
    opts,
    enableKey: 'enableFollow',
    rateKey: 'x-follow',
    maxPerWindow: 5,
    offSelector: xSelectors.post.follow,
    onSelector: xSelectors.post.following,
    content: { handle: user.handle }
  });
}

export async function setReposted(session, postRef, reposted, opts = {}) {
  const action = 'x:setReposted';
  let post;
  try {
    post = assertPostRef(postRef);
  } catch (error) {
    return invalid(action, error, 'post-ref-validation');
  }
  return desiredToggle(session, {
    action,
    target: post.url,
    desired: reposted,
    opts,
    enableKey: 'enableRepost',
    rateKey: 'x-repost',
    maxPerWindow: 5,
    offSelector: xSelectors.post.repost,
    onSelector: xSelectors.post.unrepost,
    content: { postId: post.postId }
  });
}

function normalizeText(value, field, maximum) {
  const text = String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text || text.length > maximum)
    throw new TypeError(`${field} must contain 1-${maximum} characters`);
  return text;
}

function normalizeReplyAudience(value) {
  const audience = value == null ? 'everyone' : String(value);
  if (!REPLY_AUDIENCE.has(audience)) {
    throw new TypeError(`X reply audience must be one of ${[...REPLY_AUDIENCE].join(', ')}`);
  }
  return audience;
}

function classifyExtension(extension) {
  if (Object.hasOwn(IMAGE_EXTENSIONS, extension))
    return { kind: 'image', mimeType: IMAGE_EXTENSIONS[extension] };
  if (Object.hasOwn(GIF_EXTENSIONS, extension))
    return { kind: 'gif', mimeType: GIF_EXTENSIONS[extension] };
  if (Object.hasOwn(VIDEO_EXTENSIONS, extension))
    return { kind: 'video', mimeType: VIDEO_EXTENSIONS[extension] };
  return null;
}

function verifyMagicBytes(kind, extension, buffer) {
  if (kind === 'image') {
    if (extension === '.png') {
      return (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    }
    if (extension === '.webp') {
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (kind === 'gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (kind === 'video') {
    return buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  return false;
}

async function validateMediaFile(file) {
  if (typeof file !== 'string' || file.includes('://')) {
    throw new TypeError('X media must be a local file path; remote URLs are not permitted');
  }
  const absolute = path.resolve(file);
  const pathStat = await fs.lstat(absolute);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1) {
    throw new TypeError('X media must be a regular non-symlink single-link file');
  }
  const extension = path.extname(absolute).toLowerCase();
  const classified = classifyExtension(extension);
  if (!classified)
    throw new TypeError('X media extension must be jpg, jpeg, png, webp, gif, mp4, or mov');

  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new TypeError('X media validation requires O_NOFOLLOW support');
  }
  const handle = await fs.open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const descriptorStat = await handle.stat();
    if (
      !descriptorStat.isFile() ||
      descriptorStat.nlink !== 1 ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino ||
      descriptorStat.size !== pathStat.size
    ) {
      throw new TypeError('X media path identity changed during validation');
    }
    const buffer = await handle.readFile();
    if (!verifyMagicBytes(classified.kind, extension, buffer)) {
      throw new TypeError('X media extension and file signature do not match');
    }
    return {
      path: absolute,
      dev: descriptorStat.dev,
      ino: descriptorStat.ino,
      buffer,
      size: buffer.length,
      fileHash: createHash('sha256').update(buffer).digest('hex'),
      mimeType: classified.mimeType,
      kind: classified.kind,
      name: path.basename(absolute)
    };
  } finally {
    await handle.close();
  }
}

/**
 * Validates the closed X media schema: 1-4 images (<=5MiB each, <=20MiB
 * total), OR one GIF (<=15MiB), OR one MP4/MOV (<=100MiB). Mixed modes are
 * rejected structurally.
 */
async function validatePostMedia(media) {
  const files = Array.isArray(media) ? media : [];
  if (files.length === 0) return { mode: 'none', items: [] };
  if (files.length > IMAGE_MAX_COUNT)
    throw new TypeError(`X posts accept at most ${IMAGE_MAX_COUNT} media items`);

  const items = [];
  for (const file of files) items.push(await validateMediaFile(file));

  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.size > 1) throw new TypeError('X posts do not support mixed media modes');
  const mode = items[0].kind;

  if (mode === 'image') {
    for (const item of items) {
      if (item.size > IMAGE_MAX_BYTES)
        throw new TypeError(`X image "${item.name}" exceeds ${IMAGE_MAX_BYTES} bytes`);
    }
    const total = items.reduce((sum, item) => sum + item.size, 0);
    if (total > IMAGE_TOTAL_MAX_BYTES)
      throw new TypeError(`X image set exceeds ${IMAGE_TOTAL_MAX_BYTES} bytes total`);
  } else if (mode === 'gif') {
    if (items.length !== 1) throw new TypeError('X posts accept exactly one GIF');
    if (items[0].size > GIF_MAX_BYTES) throw new TypeError(`X GIF exceeds ${GIF_MAX_BYTES} bytes`);
  } else if (mode === 'video') {
    if (items.length !== 1) throw new TypeError('X posts accept exactly one MP4/MOV');
    if (items[0].size > VIDEO_MAX_BYTES)
      throw new TypeError(`X video exceeds ${VIDEO_MAX_BYTES} bytes`);
  }

  return { mode, items };
}

/**
 * Pre-dispatch TOCTOU re-check: re-opens each validated media file with
 * O_NOFOLLOW immediately before dispatch and confirms identity (dev/ino/size)
 * and content hash still match the originally validated snapshot.
 */
async function revalidateMedia(items) {
  for (const item of items) {
    const fresh = await validateMediaFile(item.path);
    if (fresh.dev !== item.dev || fresh.ino !== item.ino || fresh.fileHash !== item.fileHash) {
      throw new TypeError(
        `X media "${item.name}" changed identity between validation and dispatch`
      );
    }
  }
}

async function setComposerFiles(session, items) {
  if (items.length === 0) return;
  await session.page.locator(xSelectors.compose.mediaInput).setInputFiles(
    items.map((item) => ({
      name: item.name,
      mimeType: item.mimeType,
      buffer: item.buffer
    }))
  );
}

async function newConfirmedPostId(session, before) {
  const ids = await session.page
    .locator('main [data-testid="toast"] [data-post-id]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-post-id')).filter((id) => /^\d{1,32}$/.test(id))
    );
  return ids.find((id) => !before.has(id)) || null;
}

export async function createPost(session, text, opts = {}) {
  const action = 'x:createPost';
  let expected;
  try {
    expected = normalizeText(text, 'X post text', TEXT_MAX);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  let audience;
  try {
    audience = normalizeReplyAudience(opts.replyAudience);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  const blocked = validateLive(session, action, opts, 'enablePost');
  if (blocked) return blocked;
  let media;
  try {
    media = await validatePostMedia(opts.media);
  } catch (error) {
    return block(action, error.message, 'media-validation');
  }
  await session.navigateGuardedForWrite(xSelectors.compose.url, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });

  const textArea = session.page.locator(xSelectors.compose.textArea);
  const submit = session.page.locator(xSelectors.compose.submit);
  if ((await textArea.count()) !== 1 || (await submit.count()) !== 1) {
    return block(action, 'owned X compose controls are not unique', 'selector-ownership');
  }

  const before = new Set(
    await session.page
      .locator('main [data-testid="toast"] [data-post-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-post-id')).filter((id) => /^\d{1,32}$/.test(id))
      )
  );

  return guarded(session, {
    action,
    rateKey: 'x-post',
    maxPerWindow: 5,
    target: xSelectors.compose.url,
    content: { text: expected, audience, mediaHashes: media.items.map((item) => item.fileHash) },
    runId: opts.runId,
    dispatch: async () => {
      await session.humanType(textArea.first(), expected);
      if (media.items.length > 0) {
        await revalidateMedia(media.items);
        await setComposerFiles(session, media.items);
      }
      await session.humanClick(submit.first());
    },
    verify: () =>
      waitFor(session.page, async () => (await newConfirmedPostId(session, before)) !== null),
    successText: 'post created (immutable ID verified)'
  });
}

export async function replyToPost(session, postRef, text, opts = {}) {
  const action = 'x:replyToPost';
  let post;
  try {
    post = assertPostRef(postRef);
  } catch (error) {
    return invalid(action, error, 'post-ref-validation');
  }
  let expected;
  try {
    expected = normalizeText(text, 'X reply text', TEXT_MAX);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  let audience;
  try {
    audience = normalizeReplyAudience(opts.replyAudience);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  const blocked = validateLive(session, action, opts, 'enableReply');
  if (blocked) return blocked;
  let media;
  try {
    media = await validatePostMedia(opts.media);
  } catch (error) {
    return block(action, error.message, 'media-validation');
  }
  await session.navigateGuardedForWrite(post.url, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });

  const field = session.page.locator(xSelectors.post.reply);
  const submit = session.page.locator(xSelectors.post.replySubmit);
  if ((await field.count()) !== 1 || (await submit.count()) !== 1) {
    return block(action, 'owned X reply controls are not unique', 'selector-ownership');
  }

  const before = await exactTextCount(session.page, xSelectors.post.replyText, expected);
  return guarded(session, {
    action,
    rateKey: 'x-reply',
    maxPerWindow: 5,
    target: post.url,
    content: {
      postId: post.postId,
      text: expected,
      audience,
      mediaHashes: media.items.map((item) => item.fileHash)
    },
    runId: opts.runId,
    dispatch: async () => {
      await session.humanType(field.first(), expected);
      if (media.items.length > 0) {
        await revalidateMedia(media.items);
        await setComposerFiles(session, media.items);
      }
      await session.humanClick(submit.first());
    },
    verify: () =>
      waitFor(
        session.page,
        async () =>
          (await exactTextCount(session.page, xSelectors.post.replyText, expected)) > before
      ),
    successText: 'reply created (state verified)'
  });
}

async function exactTextCount(page, selector, text) {
  return page.$$eval(
    selector,
    (nodes, expectedText) =>
      nodes.filter(
        (node) =>
          (node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim() === expectedText
      ).length,
    text
  );
}

export async function quotePost(session, postRef, text, opts = {}) {
  const action = 'x:quotePost';
  let post;
  try {
    post = assertPostRef(postRef);
  } catch (error) {
    return invalid(action, error, 'post-ref-validation');
  }
  let expected;
  try {
    expected = normalizeText(text, 'X quote text', TEXT_MAX);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  let audience;
  try {
    audience = normalizeReplyAudience(opts.replyAudience);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  const blocked = validateLive(session, action, opts, 'enableQuote');
  if (blocked) return blocked;
  let media;
  try {
    media = await validatePostMedia(opts.media);
  } catch (error) {
    return block(action, error.message, 'media-validation');
  }
  await session.navigateGuardedForWrite(post.url, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });

  const trigger = session.page.locator(xSelectors.post.quoteTrigger);
  if ((await trigger.count()) !== 1)
    return block(action, 'owned X quote trigger is not unique', 'selector-ownership');

  const before = new Set(
    await session.page
      .locator('main [data-testid="toast"] [data-post-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-post-id')).filter((id) => /^\d{1,32}$/.test(id))
      )
  );

  return guarded(session, {
    action,
    rateKey: 'x-quote',
    maxPerWindow: 5,
    target: post.url,
    content: {
      quotedPostId: post.postId,
      text: expected,
      audience,
      mediaHashes: media.items.map((item) => item.fileHash)
    },
    runId: opts.runId,
    dispatch: async () => {
      await session.humanClick(trigger.first());
      const textArea = session.page.locator(xSelectors.compose.textArea);
      const submit = session.page.locator(xSelectors.compose.submit);
      if ((await textArea.count()) !== 1 || (await submit.count()) !== 1) {
        throw new Error('owned X quote composer controls are not unique');
      }
      await session.humanType(textArea.first(), expected);
      if (media.items.length > 0) {
        await revalidateMedia(media.items);
        await setComposerFiles(session, media.items);
      }
      await session.humanClick(submit.first());
    },
    verify: () =>
      waitFor(session.page, async () => (await newConfirmedPostId(session, before)) !== null),
    successText: 'quote post created (immutable ID verified)'
  });
}

async function messageRows(page) {
  return page.$$eval(xSelectors.dm.message, (nodes) =>
    nodes
      .slice(-100)
      .map((node) => ({
        messageId: node.getAttribute('data-message-id'),
        direction: node.getAttribute('data-outgoing') === 'true' ? 'out' : 'in',
        text: (node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      }))
      .filter((message) => message.text)
  );
}

export async function replyToDM(session, threadRef, text, opts = {}) {
  const action = 'x:replyToDM';
  const accountId = String(session.accountId ?? '');
  let thread;
  try {
    thread = assertThreadRef(threadRef, { accountId });
  } catch (error) {
    return invalid(action, error, 'thread-ref-validation');
  }
  let expected;
  try {
    expected = normalizeText(text, 'X DM', 10_000);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  const blocked = validateLive(session, action, opts, 'enableDMReply');
  if (blocked) return blocked;
  await session.navigateGuardedForWrite(thread.url, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });
  const before = await messageRows(session.page);
  if (!before.some((message) => message.direction === 'in'))
    return block(
      action,
      'thread has no inbound message; cold outreach is blocked',
      'inbound-required'
    );
  const beforeLastId = before.at(-1)?.messageId || null;
  const composer = session.page.locator(xSelectors.dm.composer);
  const send = session.page.locator(xSelectors.dm.send);
  if ((await composer.count()) !== 1 || (await send.count()) !== 1) {
    return block(action, 'owned X DM controls are not unique', 'selector-ownership');
  }
  return guarded(session, {
    action,
    rateKey: 'x-dm',
    maxPerWindow: 5,
    target: thread.url,
    content: { threadId: thread.threadId, text: expected },
    runId: opts.runId,
    dispatch: async () => {
      await session.humanType(composer.first(), expected);
      await session.humanClick(send.first());
    },
    verify: () =>
      waitFor(session.page, async () => {
        const after = await messageRows(session.page);
        const last = after.at(-1);
        return Boolean(
          last?.messageId &&
          last.messageId !== beforeLastId &&
          last.direction === 'out' &&
          last.text === expected
        );
      }),
    successText: 'inbound-thread DM reply created (state verified)'
  });
}

export function blockedXAction(actionName) {
  const name = String(actionName ?? '');
  if (!FORBIDDEN_ACTIONS.has(name))
    throw new TypeError(`unsupported X structural blocker: ${name}`);
  return block(
    `x:${name}`,
    `${name} is structurally blocked for X automation`,
    'structural-blocker'
  );
}
