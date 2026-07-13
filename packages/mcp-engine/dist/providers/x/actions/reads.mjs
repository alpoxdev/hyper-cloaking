/** Read and normalize user, post, search, thread, and DM data from X. */
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { executeXRead } from '../network.mjs';
import { xSelectors } from '../selectors.mjs';
import {
  assertPostRef,
  assertThreadRef,
  assertUserRef,
  normalizePostRef,
  normalizeThreadRef
} from './ids.mjs';

const MAX_OUTPUT = 100;
const MAX_RAW = 400;

function limitFor(value, fallback) {
  return Math.min(Number.isInteger(value) && value > 0 ? value : fallback, MAX_OUTPUT);
}

function boundedText(value, field, maximum) {
  if (value == null) return null;
  const text = String(value).normalize('NFKC').trim();
  if (text.length > maximum) throw new TypeError(`X ${field} exceeds ${maximum} characters`);
  return text || null;
}

function numberOrNull(value) {
  if (Number.isFinite(value)) return Number(value);
  const text = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase()] || 1;
  const number = Number(match[1]) * multiplier;
  return Number.isFinite(number) ? Math.round(number) : null;
}

function normalizePostEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    throw new TypeError('X post entries must be objects');
  const ref = normalizePostRef(entry);
  if (!ref) throw new TypeError('X post entry contains an invalid owned-origin post reference');
  return {
    ...ref,
    text: boundedText(entry.text, 'post text', 10_000),
    author: boundedText(entry.author ?? ref.handle, 'post author', 100),
    replyCount: numberOrNull(entry.replyCount),
    repostCount: numberOrNull(entry.repostCount),
    likeCount: numberOrNull(entry.likeCount),
    bookmarkCount: numberOrNull(entry.bookmarkCount),
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : null
  };
}

function normalizePostList(value, { owner = null, query = null, limit, dedupe = true }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.posts) ||
    value.posts.length > MAX_RAW
  ) {
    throw new TypeError(`X post list must contain at most ${MAX_RAW} posts`);
  }
  const seen = new Set();
  const posts = [];
  for (const entry of value.posts) {
    const post = normalizePostEntry(entry);
    if (owner && post.handle !== owner.handle)
      throw new TypeError('X user post does not belong to the requested user');
    if (dedupe) {
      if (seen.has(post.postId)) continue;
      seen.add(post.postId);
    }
    posts.push(post);
    if (posts.length >= limit) break;
  }
  if (posts.length === 0 && value.emptyState !== true) {
    throw new TypeError('X empty post list requires explicit empty-state evidence');
  }
  return {
    ...(owner ? { user: owner } : {}),
    ...(query !== null ? { query } : {}),
    count: posts.length,
    posts
  };
}

function readOptions(opts, action, dom, normalize) {
  return executeXRead({
    action,
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize
  });
}

async function extractPostLinks(session, selector) {
  return session.page.$$eval(selector, (nodes) =>
    nodes.slice(0, 400).map((node) => ({
      url: node.getAttribute('href'),
      text:
        node.closest('article')?.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ||
        null,
      author: node.closest('article')?.getAttribute('data-author') || null
    }))
  );
}

/** Read a validated X user profile. */
export async function getUser(session, userRef, opts = {}) {
  const user = assertUserRef(userRef);
  const dom = async () => {
    await session.navigateGuardedForRead(user.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const profile = session.page.locator(xSelectors.user.profile);
    if ((await profile.count()) !== 1) throw new Error('X profile state could not be proven');
    return profile.first().evaluate((node) => ({
      displayName: node.querySelector('div[dir="ltr"] span')?.textContent?.trim() || null,
      bio: node.querySelector('[data-testid="UserDescription"]')?.textContent?.trim() || null,
      followerCount: node.getAttribute('data-followers'),
      followingCount: node.getAttribute('data-following'),
      present: true
    }));
  };
  const { value } = await readOptions(opts, 'getUser', dom, (content) => {
    if (!content || typeof content !== 'object' || Array.isArray(content))
      throw new TypeError('X user content must be an object');
    if (content.present !== true)
      throw new TypeError('X user content requires explicit presence evidence');
    return {
      ...user,
      displayName: boundedText(content.displayName, 'display name', 1_000),
      bio: boundedText(content.bio, 'bio', 10_000),
      followerCount: numberOrNull(content.followerCount),
      followingCount: numberOrNull(content.followingCount)
    };
  });
  return wrapReadPayload({ url: user.url, kind: 'x-user', content: value });
}

/** Read recent posts belonging to a validated X user. */
export async function getUserPosts(session, userRef, opts = {}) {
  const user = assertUserRef(userRef);
  const limit = limitFor(opts.limit, 20);
  const dom = async () => {
    await session.navigateGuardedForRead(user.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const posts = await extractPostLinks(session, xSelectors.user.postLink);
    if (
      posts.length === 0 &&
      (await session.page.locator(xSelectors.user.emptyState).count()) === 0
    ) {
      throw new Error('X user post state could not be proven');
    }
    return { posts, emptyState: posts.length === 0 };
  };
  const { value } = await readOptions(opts, 'getUserPosts', dom, (content) =>
    normalizePostList(content, { owner: user, limit })
  );
  return wrapReadPayload({ url: user.url, kind: 'x-user-posts', content: value });
}

/** Read a validated X post and, optionally, its replies. */
export async function getPost(session, postRef, opts = {}) {
  const post = assertPostRef(postRef);
  const limit = limitFor(opts.replyLimit, 50);
  const includeReplies = opts.replies !== false;
  const dom = async () => {
    await session.navigateGuardedForRead(post.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const article = session.page.locator(xSelectors.post.article);
    if ((await article.count()) < 1) throw new Error('X post state could not be proven');
    const base = await article.first().evaluate((node) => ({
      text: node.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || null,
      replyCount: node.getAttribute('data-reply-count'),
      repostCount: node.getAttribute('data-repost-count'),
      likeCount: node.getAttribute('data-like-count'),
      bookmarkCount: node.getAttribute('data-bookmark-count'),
      timestamp: Number(node.getAttribute('data-create-time')) || null
    }));
    const replies = includeReplies
      ? await session.page.$$eval(xSelectors.post.replyText, (nodes) =>
          nodes
            .slice(1, 401)
            .map((node) => node.textContent?.trim())
            .filter(Boolean)
        )
      : [];
    const repliesEmptyState =
      !includeReplies ||
      (replies.length === 0 &&
        (await session.page.locator(xSelectors.post.replyEmptyState).count()) > 0);
    if (includeReplies && replies.length === 0 && !repliesEmptyState) {
      throw new Error('X reply state could not be proven');
    }
    return { ...base, replies, repliesEmptyState, present: true };
  };
  const { value } = await readOptions(opts, 'getPost', dom, (content) => {
    if (
      !content ||
      typeof content !== 'object' ||
      !Array.isArray(content.replies) ||
      content.replies.length > MAX_RAW
    ) {
      throw new TypeError(`X post content must contain at most ${MAX_RAW} replies`);
    }
    if (content.present !== true)
      throw new TypeError('X post content requires explicit presence evidence');
    if (includeReplies && content.replies.length === 0 && content.repliesEmptyState !== true) {
      throw new TypeError('X empty replies require explicit empty-state evidence');
    }
    return {
      ...normalizePostEntry({ ...content, ...post }),
      replies: includeReplies
        ? content.replies
            .slice(0, limit)
            .map((reply) => boundedText(reply, 'reply', 10_000))
            .filter(Boolean)
        : []
    };
  });
  return wrapReadPayload({ url: post.url, kind: 'x-post', content: value });
}

/** Search X posts for a bounded query. */
export async function searchPosts(session, query, opts = {}) {
  const searchQuery = String(query ?? '').trim();
  if (!searchQuery || searchQuery.length > 500)
    throw new TypeError('X search query must contain 1-500 characters');
  const limit = limitFor(opts.limit, 20);
  const url = `https://x.com/search?q=${encodeURIComponent(searchQuery)}`;
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const posts = await extractPostLinks(session, xSelectors.search.postLink);
    if (
      posts.length === 0 &&
      (await session.page.locator(xSelectors.search.emptyState).count()) === 0
    ) {
      throw new Error('X search state could not be proven');
    }
    return { posts, emptyState: posts.length === 0 };
  };
  const { value } = await readOptions(opts, 'searchPosts', dom, (content) =>
    normalizePostList(content, { query: searchQuery, limit })
  );
  return wrapReadPayload({ url, kind: 'x-search', content: value });
}

/** Read posts in the thread containing a validated X post. */
export async function getThread(session, postRef, opts = {}) {
  const post = assertPostRef(postRef);
  const limit = limitFor(opts.limit, 50);
  const dom = async () => {
    await session.navigateGuardedForRead(post.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const posts = await extractPostLinks(
      session,
      xSelectors.thread.article + ' a[href*="/status/"]'
    );
    if (
      posts.length === 0 &&
      (await session.page.locator(xSelectors.thread.emptyState).count()) === 0
    ) {
      throw new Error('X thread state could not be proven');
    }
    return { posts, emptyState: posts.length === 0 };
  };
  const { value } = await readOptions(opts, 'getThread', dom, (content) =>
    normalizePostList(content, { owner: post, limit })
  );
  return wrapReadPayload({ url: post.url, kind: 'x-thread', content: value });
}

function accountFor(session, opts) {
  const accountId = String(session?.accountId ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
    throw new TypeError('X current session account ID is required for DM reads');
  }
  if (opts.accountId != null && String(opts.accountId) !== accountId) {
    throw new TypeError('X DM account override does not match the current session');
  }
  return accountId;
}

/** List DM threads for the current authenticated X account. */
export async function listDMThreads(session, opts = {}) {
  const accountId = accountFor(session, opts);
  const limit = limitFor(opts.limit, 20);
  const dom = async () => {
    await session.navigateGuardedForRead(xSelectors.dm.inboxUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const hrefs = await session.page.$$eval(xSelectors.dm.threadLink, (nodes) =>
      nodes
        .slice(0, 400)
        .map((node) => node.getAttribute('href'))
        .filter(Boolean)
    );
    if (
      hrefs.length === 0 &&
      (await session.page.locator(xSelectors.dm.emptyInbox).count()) === 0
    ) {
      throw new Error('X DM inbox state could not be proven');
    }
    return {
      emptyState: hrefs.length === 0,
      threads: hrefs.map((url) => ({
        accountId,
        threadId: String(url).split('/').filter(Boolean).at(-1),
        url
      }))
    };
  };
  const { value } = await readOptions(opts, 'listDMThreads', dom, (content) => {
    if (
      !content ||
      typeof content !== 'object' ||
      !Array.isArray(content.threads) ||
      content.threads.length > MAX_RAW
    ) {
      throw new TypeError(`X DM list must contain at most ${MAX_RAW} threads`);
    }
    const seen = new Set();
    const threads = [];
    for (const entry of content.threads) {
      const thread = normalizeThreadRef(entry, { accountId });
      if (!thread) throw new TypeError('X DM list contains an invalid current-account thread');
      if (seen.has(thread.threadId)) continue;
      seen.add(thread.threadId);
      threads.push(thread);
      if (threads.length >= limit) break;
    }
    if (threads.length === 0 && content.emptyState !== true)
      throw new TypeError('X empty DM list requires explicit empty-state evidence');
    return { accountId, threads };
  });
  return wrapReadPayload({ url: xSelectors.dm.inboxUrl, kind: 'x-dm-threads', content: value });
}

/** Read bounded messages from a validated X DM thread. */
export async function readDMThread(session, threadRef, opts = {}) {
  const accountId = accountFor(session, opts);
  const thread = assertThreadRef(threadRef, { accountId });
  const limit = limitFor(opts.limit, 30);
  const dom = async () => {
    await session.navigateGuardedForRead(thread.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const messages = await session.page.$$eval(xSelectors.dm.message, (nodes) =>
      nodes
        .slice(-100)
        .map((node) => ({
          messageId: node.getAttribute('data-message-id'),
          direction: node.getAttribute('data-outgoing') === 'true' ? 'out' : 'in',
          text: node.textContent?.trim() || null
        }))
        .filter((message) => message.text)
    );
    if (
      messages.length === 0 &&
      (await session.page.locator(xSelectors.dm.emptyThread).count()) === 0
    ) {
      throw new Error('X DM thread state could not be proven');
    }
    return { messages, emptyState: messages.length === 0 };
  };
  const { value } = await readOptions(opts, 'readDMThread', dom, (content) => {
    if (
      !content ||
      typeof content !== 'object' ||
      !Array.isArray(content.messages) ||
      content.messages.length > 100
    ) {
      throw new TypeError('X DM thread must contain at most 100 messages');
    }
    if (content.messages.length === 0 && content.emptyState !== true)
      throw new TypeError('X empty DM thread requires explicit empty-state evidence');
    const messages = content.messages
      .map((message) => {
        if (!message || typeof message !== 'object' || !['in', 'out'].includes(message.direction)) {
          throw new TypeError('X DM messages require an in/out direction');
        }
        return {
          messageId: boundedText(message.messageId, 'message ID', 128),
          direction: message.direction,
          text: boundedText(message.text, 'message text', 10_000)
        };
      })
      .filter((message) => message.text)
      .slice(-limit);
    return { ...thread, messages };
  });
  return wrapReadPayload({ url: thread.url, kind: 'x-dm-thread', content: value });
}
