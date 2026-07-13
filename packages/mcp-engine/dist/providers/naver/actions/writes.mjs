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
import { naverSelectors } from '../selectors.mjs';
import {
  assertBlogPostRef,
  assertBlogCommentRef,
  assertCafePostRef,
  assertCafeCommentRef,
  assertCafeRef,
  assertDraftRef
} from './ids.mjs';

const SAFE_RUN_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const FORBIDDEN_ACTIONS = new Set([
  'cafeJoin',
  'cafeAdmin',
  'moderation',
  'mail',
  'message',
  'account',
  'login',
  'shopping',
  'payment',
  'order',
  'ads',
  'bulkDelete',
  'bulkEdit',
  'restrictedBypass'
]);

const BLOG_WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver';
const POST_CONTENT_KEYS = new Set(['title', 'body', 'visibility', 'media']);
const VISIBILITY_VALUES = new Set(['public', 'neighbor', 'private']);
// Applied option values for the visibility control on each write surface. The
// validated `visibility` is selected and read back during dispatch so a
// requested `private`/`neighbor` is never silently swallowed into the account
// default (which could over-expose content).
const BLOG_VISIBILITY_OPTION = Object.freeze({ public: '0', neighbor: '2', private: '6' });
const CAFE_VISIBILITY_OPTION = Object.freeze({
  public: 'all',
  neighbor: 'member',
  private: 'private'
});

async function applyVisibility(control, optionValue) {
  await control.first().selectOption(optionValue);
  const applied = await control.first().inputValue();
  if (applied !== optionValue) throw new Error('Naver post visibility could not be applied');
}

const IMAGE_MAX_COUNT = 10;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif'
};

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function block(action, reason, stage = 'policy-disabled') {
  return makeBlockedResult(action, reason, { stage, requiresUserDecision: true });
}

function invalid(action, error, stage) {
  return block(action, error.message, stage);
}

function validateLiveWrite(session, action, opts, enableKey) {
  const gate = resolveWriteGate(opts);
  if (!gate.allowed)
    return makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' });
  if (opts[enableKey] !== true) return block(action, `${action} requires ${enableKey}:true`);
  if (typeof session.stateDir !== 'string' || !session.stateDir.trim()) {
    return block(action, 'persistent stateDir is required for real writes', 'state-required');
  }
  if (typeof opts.runId !== 'string' || !SAFE_RUN_ID_RE.test(opts.runId)) {
    return block(action, 'a safe explicit runId is required for real writes', 'run-id-required');
  }
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
        layer: 'naver-actions',
        attempted: ['dispatch once and verify the exact Naver postcondition'],
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

async function guardedDispatch(
  session,
  { action, rateKey, maxPerWindow, target, content, runId, dispatch, verify, successText }
) {
  if (session.targetSafety?.disposition !== 'ok') {
    return block(action, 'target safety was not approved', 'target-safety');
  }
  const targetHash = sha(target);
  const contentHash = sha(canonicalJson(content));
  const idempotencyHash = sha(canonicalJson({ action, contentHash, runId, targetHash }));
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
    if (!(await verify())) throw new Error('Naver postcondition was not proven');
    if (session.targetSafety?.disposition !== 'ok')
      throw new Error('target safety was not approved');
    await finalizeGuardedAction(session.stateDir, {
      idempotencyHash,
      state: 'verified',
      evidenceIdHash: sha(canonicalJson({ action, successText, target, verified: true }))
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

async function waitFor(page, check, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt + 1 < attempts) await page.waitForTimeout(200);
  }
  return false;
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

function validateCommentPayload(value) {
  let text = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'text')
      throw new TypeError('Naver comment payload must contain only a text field');
    text = value.text;
  }
  return normalizeText(text, 'Naver comment', 2_200);
}

/** Closed post-content schema: only title/body/visibility/media are accepted. */
function validatePostContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new TypeError('Naver post content must be an object');
  }
  for (const key of Object.keys(content)) {
    if (!POST_CONTENT_KEYS.has(key))
      throw new TypeError(`Naver post content has unsupported field "${key}"`);
  }
  const title = normalizeText(content.title, 'Naver post title', 100);
  const body = normalizeText(content.body, 'Naver post body', 50_000);
  const visibility = content.visibility === undefined ? 'public' : content.visibility;
  if (!VISIBILITY_VALUES.has(visibility)) {
    throw new TypeError('Naver post visibility must be one of public, neighbor, private');
  }
  const media = content.media === undefined ? [] : content.media;
  if (!Array.isArray(media))
    throw new TypeError('Naver post media must be an array of local file paths');
  return { title, body, visibility, media };
}

function detectImageSignature(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')))
    return 'image/gif';
  return null;
}

/** Validates local media: bounded count/size, regular non-symlink files, O_NOFOLLOW opens, extension+magic match. */
async function validateLocalImages(files) {
  if (!Array.isArray(files))
    throw new TypeError('Naver media must be an array of local file paths');
  if (files.length > IMAGE_MAX_COUNT)
    throw new TypeError(`Naver media must contain at most ${IMAGE_MAX_COUNT} images`);
  if (files.length === 0) return [];
  if (!Number.isInteger(fsConstants.O_NOFOLLOW))
    throw new TypeError('Naver media upload requires O_NOFOLLOW support');

  let total = 0;
  const validated = [];
  for (const file of files) {
    const absolute = path.resolve(String(file ?? ''));
    const pathStat = await fs.lstat(absolute);
    if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1) {
      throw new TypeError('Naver media file must be a regular non-symlink single-link file');
    }
    if (pathStat.size <= 0 || pathStat.size > IMAGE_MAX_BYTES) {
      throw new TypeError(`Naver media file must contain 1-${IMAGE_MAX_BYTES} bytes`);
    }
    total += pathStat.size;
    if (total > IMAGE_TOTAL_MAX_BYTES) {
      throw new TypeError(`Naver media total size must not exceed ${IMAGE_TOTAL_MAX_BYTES} bytes`);
    }
    const extension = path.extname(absolute).toLowerCase();
    if (!Object.hasOwn(IMAGE_MIME, extension)) {
      throw new TypeError('Naver media extension must be jpg, jpeg, png, or gif');
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
        throw new TypeError('Naver media path identity changed during validation');
      }
      const buffer = await handle.readFile();
      const signature = detectImageSignature(buffer);
      if (signature !== IMAGE_MIME[extension]) {
        throw new TypeError('Naver media extension and file signature do not match');
      }
      validated.push({
        name: path.basename(absolute),
        mimeType: IMAGE_MIME[extension],
        buffer,
        fileHash: sha(buffer)
      });
    } finally {
      await handle.close();
    }
  }
  return validated;
}

/** Requires the current session to prove active cafe membership and write permission before any cafe write. */
async function requireCafeMembership(session, action, cafeUrl) {
  await session.navigateGuardedForWrite(cafeUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });
  const membership = session.page.locator(naverSelectors.cafe.membershipBadge);
  if ((await membership.count()) !== 1)
    return block(
      action,
      'current Naver cafe membership could not be proven',
      'membership-required'
    );
  const writePermission = session.page.locator(naverSelectors.cafe.writePermission);
  if ((await writePermission.count()) !== 1)
    return block(action, 'Naver cafe write permission could not be proven', 'membership-required');
  return null;
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
    content,
    membershipUrl
  }
) {
  if (typeof desired !== 'boolean')
    return block(action, 'desired state must be boolean', 'input-validation');
  const blocked = validateLiveWrite(session, action, opts, enableKey);
  if (blocked) return blocked;
  if (membershipUrl) {
    const membershipBlock = await requireCafeMembership(session, action, membershipUrl);
    if (membershipBlock) return membershipBlock;
  }
  await session.navigateGuardedForWrite(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const isOn = async () => (await session.page.locator(onSelector).count()) === 1;
  if ((await isOn()) === desired)
    return success(session, action, 'desired state already satisfied', target, null, {
      alreadySatisfied: true
    });
  const selector = desired ? offSelector : onSelector;
  if ((await session.page.locator(selector).count()) !== 1)
    return block(action, 'owned Naver transition control is not unique', 'selector-ownership');
  return guardedDispatch(session, {
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

export async function setBlogPostLiked(session, blogPostRef, liked, opts = {}) {
  const action = 'naver:setBlogPostLiked';
  let post;
  try {
    post = assertBlogPostRef(blogPostRef);
  } catch (error) {
    return invalid(action, error, 'blog-post-ref-validation');
  }
  return desiredToggle(session, {
    action,
    target: post.url,
    desired: liked,
    opts,
    enableKey: 'enableBlogLike',
    rateKey: 'naver-reaction',
    maxPerWindow: 10,
    offSelector: naverSelectors.blog.like,
    onSelector: naverSelectors.blog.unlike,
    content: { blogId: post.blogId, logNo: post.logNo }
  });
}

export async function setCafePostLiked(session, cafePostRef, liked, opts = {}) {
  const action = 'naver:setCafePostLiked';
  let post;
  try {
    post = assertCafePostRef(cafePostRef);
  } catch (error) {
    return invalid(action, error, 'cafe-post-ref-validation');
  }
  return desiredToggle(session, {
    action,
    target: post.url,
    desired: liked,
    opts,
    enableKey: 'enableCafeLike',
    rateKey: 'naver-reaction',
    maxPerWindow: 10,
    offSelector: naverSelectors.cafe.like,
    onSelector: naverSelectors.cafe.unlike,
    content: { cafeId: post.cafeId, articleId: post.articleId },
    membershipUrl: `https://cafe.naver.com/${post.cafeId}`
  });
}

async function exactTextCount(page, selector, text) {
  return page.$$eval(
    selector,
    (nodes, expected) =>
      nodes.filter(
        (node) =>
          (node.textContent || '').normalize('NFKC').replace(/\s+/gu, ' ').trim() === expected
      ).length,
    text
  );
}

async function createComment(
  session,
  {
    action,
    target,
    parentId,
    expected,
    opts,
    enableKey,
    commentField,
    commentSubmit,
    replyControl,
    commentText,
    membershipUrl
  }
) {
  const blocked = validateLiveWrite(session, action, opts, enableKey);
  if (blocked) return blocked;
  if (membershipUrl) {
    const membershipBlock = await requireCafeMembership(session, action, membershipUrl);
    if (membershipBlock) return membershipBlock;
  }
  await session.navigateGuardedForWrite(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const field = session.page.locator(commentField);
  const submit = session.page.locator(commentSubmit);
  if ((await field.count()) !== 1 || (await submit.count()) !== 1) {
    return block(action, 'owned Naver comment controls are not unique', 'selector-ownership');
  }
  let replyLocator = null;
  if (parentId) {
    const reply = session.page.locator(`${replyControl}[data-comment-id="${parentId}"]`);
    if ((await reply.count()) !== 1)
      return block(action, 'owned Naver reply control is not unique', 'selector-ownership');
    replyLocator = reply;
  }

  const before = await exactTextCount(session.page, commentText, expected);
  return guardedDispatch(session, {
    action,
    rateKey: 'naver-comment',
    maxPerWindow: 5,
    target,
    content: { parentId, text: expected },
    runId: opts.runId,
    dispatch: async () => {
      if (replyLocator) await session.humanClick(replyLocator.first());
      await session.humanType(field.first(), expected);
      await session.humanClick(submit.first());
    },
    verify: () =>
      waitFor(
        session.page,
        async () => (await exactTextCount(session.page, commentText, expected)) > before
      ),
    successText: parentId
      ? 'comment reply created (state verified)'
      : 'comment created (state verified)'
  });
}

export async function commentBlogPost(session, blogPostRef, text, opts = {}) {
  const action = 'naver:commentBlogPost';
  let post;
  try {
    post = assertBlogPostRef(blogPostRef);
  } catch (error) {
    return invalid(action, error, 'blog-post-ref-validation');
  }
  let expected;
  try {
    expected = validateCommentPayload(text);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  return createComment(session, {
    action,
    target: post.url,
    parentId: null,
    expected,
    opts,
    enableKey: 'enableBlogComment',
    commentField: naverSelectors.blog.commentField,
    commentSubmit: naverSelectors.blog.commentSubmit,
    replyControl: naverSelectors.blog.replyControl,
    commentText: naverSelectors.blog.commentText
  });
}

export async function replyToBlogComment(session, blogCommentRef, text, opts = {}) {
  const action = 'naver:replyToBlogComment';
  let comment;
  try {
    comment = assertBlogCommentRef(blogCommentRef);
  } catch (error) {
    return invalid(action, error, 'blog-comment-ref-validation');
  }
  let expected;
  try {
    expected = validateCommentPayload(text);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  return createComment(session, {
    action,
    target: comment.url,
    parentId: comment.commentId,
    expected,
    opts,
    enableKey: 'enableBlogReply',
    commentField: naverSelectors.blog.commentField,
    commentSubmit: naverSelectors.blog.commentSubmit,
    replyControl: naverSelectors.blog.replyControl,
    commentText: naverSelectors.blog.commentText
  });
}

export async function commentCafePost(session, cafePostRef, text, opts = {}) {
  const action = 'naver:commentCafePost';
  let post;
  try {
    post = assertCafePostRef(cafePostRef);
  } catch (error) {
    return invalid(action, error, 'cafe-post-ref-validation');
  }
  let expected;
  try {
    expected = validateCommentPayload(text);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  return createComment(session, {
    action,
    target: post.url,
    parentId: null,
    expected,
    opts,
    enableKey: 'enableCafeComment',
    commentField: naverSelectors.cafe.commentField,
    commentSubmit: naverSelectors.cafe.commentSubmit,
    replyControl: naverSelectors.cafe.replyControl,
    commentText: naverSelectors.cafe.commentText,
    membershipUrl: `https://cafe.naver.com/${post.cafeId}`
  });
}

export async function replyToCafeComment(session, cafeCommentRef, text, opts = {}) {
  const action = 'naver:replyToCafeComment';
  let comment;
  try {
    comment = assertCafeCommentRef(cafeCommentRef);
  } catch (error) {
    return invalid(action, error, 'cafe-comment-ref-validation');
  }
  let expected;
  try {
    expected = validateCommentPayload(text);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  return createComment(session, {
    action,
    target: comment.url,
    parentId: comment.commentId,
    expected,
    opts,
    enableKey: 'enableCafeReply',
    commentField: naverSelectors.cafe.commentField,
    commentSubmit: naverSelectors.cafe.commentSubmit,
    replyControl: naverSelectors.cafe.replyControl,
    commentText: naverSelectors.cafe.commentText,
    membershipUrl: `https://cafe.naver.com/${comment.cafeId}`
  });
}

export async function createBlogDraft(session, content, opts = {}) {
  const action = 'naver:createBlogDraft';
  let post;
  try {
    post = validatePostContent(content);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  const blocked = validateLiveWrite(session, action, opts, 'enableBlogDraft');
  if (blocked) return blocked;
  let media;
  try {
    media = await validateLocalImages(post.media);
  } catch (error) {
    return block(action, error.message, 'media-validation');
  }

  await session.navigateGuardedForWrite(BLOG_WRITE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });
  const titleField = session.page.locator(naverSelectors.blog.write.titleField);
  const bodyField = session.page.locator(naverSelectors.blog.write.bodyField);
  const saveDraftButton = session.page.locator(naverSelectors.blog.write.saveDraftButton);
  const visibilityControl = session.page.locator(naverSelectors.blog.write.visibilitySelect);
  if (
    (await titleField.count()) !== 1 ||
    (await bodyField.count()) !== 1 ||
    (await saveDraftButton.count()) !== 1 ||
    (await visibilityControl.count()) !== 1
  ) {
    return block(action, 'owned Naver blog write controls are not unique', 'selector-ownership');
  }
  if (
    media.length > 0 &&
    (await session.page.locator(naverSelectors.blog.write.fileInput).count()) !== 1
  ) {
    return block(
      action,
      'owned Naver blog media upload control is not unique',
      'selector-ownership'
    );
  }

  const before = new Set(
    await session.page
      .locator(naverSelectors.blog.write.draftItem)
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-draft-id')).filter(Boolean)
      )
  );
  return guardedDispatch(session, {
    action,
    rateKey: 'naver-blog-publish',
    maxPerWindow: 2,
    target: BLOG_WRITE_URL,
    content: {
      title: post.title,
      body: post.body,
      visibility: post.visibility,
      mediaHashes: media.map((file) => file.fileHash)
    },
    runId: opts.runId,
    dispatch: async () => {
      await session.humanType(titleField.first(), post.title);
      await session.humanType(bodyField.first(), post.body);
      await applyVisibility(visibilityControl, BLOG_VISIBILITY_OPTION[post.visibility]);
      if (media.length > 0) {
        await session.page.locator(naverSelectors.blog.write.fileInput).setInputFiles(
          media.map((file) => ({
            name: file.name,
            mimeType: file.mimeType,
            buffer: file.buffer
          }))
        );
      }
      await session.humanClick(saveDraftButton.first());
    },
    verify: () =>
      waitFor(session.page, async () => {
        const ids = await session.page
          .locator(naverSelectors.blog.write.draftItem)
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('data-draft-id')).filter(Boolean)
          );
        return ids.some((id) => !before.has(id));
      }),
    successText: 'blog draft created (immutable ID verified)'
  });
}

export async function publishBlogDraft(session, draftRef, opts = {}) {
  const action = 'naver:publishBlogDraft';
  let draft;
  try {
    draft = assertDraftRef(draftRef);
  } catch (error) {
    return invalid(action, error, 'draft-ref-validation');
  }
  const blocked = validateLiveWrite(session, action, opts, 'enableBlogPublish');
  if (blocked) return blocked;
  const confirmation = resolveConfirmationGate({
    interactive: session.interactive,
    confirmed: opts.confirmed
  });
  if (!confirmation.allowed) return block(action, confirmation.reason, 'confirmation-gate');

  await session.navigateGuardedForWrite(BLOG_WRITE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });
  const draftNode = session.page.locator(
    `${naverSelectors.blog.write.draftItem}[data-draft-id="${draft.draftId}"]`
  );
  if ((await draftNode.count()) !== 1)
    return block(action, 'existing owned Naver blog draft could not be proven', 'draft-state');
  const publishedSelector = `[data-published-from-draft-id="${draft.draftId}"][data-log-no]`;
  const beforeLogNos = new Set(
    await session.page
      .locator(publishedSelector)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-log-no')).filter(Boolean))
  );
  return guardedDispatch(session, {
    action,
    rateKey: 'naver-blog-publish',
    maxPerWindow: 2,
    target: BLOG_WRITE_URL,
    content: { draftId: draft.draftId, publish: true },
    runId: opts.runId,
    dispatch: async () => {
      const publishControl = draftNode.first().locator(naverSelectors.blog.write.publishButton);
      if ((await publishControl.count()) !== 1)
        throw new Error('owned Naver blog publish control is not unique');
      await session.humanClick(publishControl.first());
    },
    verify: () =>
      waitFor(session.page, async () => {
        const logNos = await session.page
          .locator(publishedSelector)
          .evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute('data-log-no'))
              .filter((logNo) => /^\d{1,32}$/.test(logNo))
          );
        return logNos.some((logNo) => !beforeLogNos.has(logNo));
      }),
    successText: 'blog draft published (immutable log number verified)'
  });
}

export async function createCafePost(session, cafeRef, content, opts = {}) {
  const action = 'naver:createCafePost';
  let cafe;
  try {
    cafe = assertCafeRef(cafeRef);
  } catch (error) {
    return invalid(action, error, 'cafe-ref-validation');
  }
  let post;
  try {
    post = validatePostContent(content);
  } catch (error) {
    return block(action, error.message, 'input-validation');
  }
  const blocked = validateLiveWrite(session, action, opts, 'enableCafePost');
  if (blocked) return blocked;
  const confirmation = resolveConfirmationGate({
    interactive: session.interactive,
    confirmed: opts.confirmed
  });
  if (!confirmation.allowed) return block(action, confirmation.reason, 'confirmation-gate');
  let media;
  try {
    media = await validateLocalImages(post.media);
  } catch (error) {
    return block(action, error.message, 'media-validation');
  }

  const membershipBlock = await requireCafeMembership(session, action, cafe.url);
  if (membershipBlock) return membershipBlock;

  const writeUrl = `${cafe.url}/write`;
  await session.navigateGuardedForWrite(writeUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  });
  const titleField = session.page.locator(naverSelectors.cafe.write.titleField);
  const bodyField = session.page.locator(naverSelectors.cafe.write.bodyField);
  const submitButton = session.page.locator(naverSelectors.cafe.write.submitButton);
  const visibilityControl = session.page.locator(naverSelectors.cafe.write.visibilitySelect);
  if (
    (await titleField.count()) !== 1 ||
    (await bodyField.count()) !== 1 ||
    (await submitButton.count()) !== 1 ||
    (await visibilityControl.count()) !== 1
  ) {
    return block(action, 'owned Naver cafe write controls are not unique', 'selector-ownership');
  }
  if (
    media.length > 0 &&
    (await session.page.locator(naverSelectors.cafe.write.fileInput).count()) !== 1
  ) {
    return block(
      action,
      'owned Naver cafe media upload control is not unique',
      'selector-ownership'
    );
  }

  const before = new Set(
    await session.page
      .locator(naverSelectors.cafe.write.articleItem)
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-article-id')).filter(Boolean)
      )
  );
  return guardedDispatch(session, {
    action,
    rateKey: 'naver-cafe-post',
    maxPerWindow: 2,
    target: writeUrl,
    content: {
      cafeId: cafe.cafeId,
      title: post.title,
      body: post.body,
      visibility: post.visibility,
      mediaHashes: media.map((file) => file.fileHash)
    },
    runId: opts.runId,
    dispatch: async () => {
      await session.humanType(titleField.first(), post.title);
      await session.humanType(bodyField.first(), post.body);
      await applyVisibility(visibilityControl, CAFE_VISIBILITY_OPTION[post.visibility]);
      if (media.length > 0) {
        await session.page.locator(naverSelectors.cafe.write.fileInput).setInputFiles(
          media.map((file) => ({
            name: file.name,
            mimeType: file.mimeType,
            buffer: file.buffer
          }))
        );
      }
      await session.humanClick(submitButton.first());
    },
    verify: () =>
      waitFor(session.page, async () => {
        const ids = await session.page
          .locator(naverSelectors.cafe.write.articleItem)
          .evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute('data-article-id'))
              .filter((id) => /^\d{1,32}$/.test(id))
          );
        return ids.some((id) => !before.has(id));
      }),
    successText: 'cafe post created (immutable article ID verified)'
  });
}

export function blockedNaverAction(actionName) {
  const name = String(actionName ?? '');
  if (!FORBIDDEN_ACTIONS.has(name))
    throw new TypeError(`unsupported Naver structural blocker: ${name}`);
  return block(
    `naver:${name}`,
    `${name} is structurally blocked for Naver automation`,
    'structural-blocker'
  );
}
