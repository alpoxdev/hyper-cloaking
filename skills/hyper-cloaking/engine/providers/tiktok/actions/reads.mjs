import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { executeTikTokRead } from '../network.mjs';
import { tiktokSelectors } from '../selectors.mjs';
import {
  assertThreadRef,
  assertUserRef,
  assertVideoRef,
  normalizeThreadRef,
  normalizeVideoRef
} from './ids.mjs';

const DEFAULT_LIMIT = 20;
const MAX_OUTPUT = 100;
const MAX_RAW = 400;

function limitFor(value, fallback = DEFAULT_LIMIT) {
  return Math.min(Number.isInteger(value) && value > 0 ? value : fallback, MAX_OUTPUT);
}

function boundedText(value, field, maximum) {
  if (value == null) return null;
  const text = String(value).normalize('NFKC').trim();
  if (text.length > maximum) throw new TypeError(`TikTok ${field} exceeds ${maximum} characters`);
  return text || null;
}

function numberOrNull(value) {
  if (Number.isFinite(value)) return Number(value);
  const text = String(value ?? '').replace(/,/g, '').trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase()] || 1;
  const number = Number(match[1]) * multiplier;
  return Number.isFinite(number) ? Math.round(number) : null;
}

function normalizeVideoEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('TikTok video entries must be objects');
  const ref = normalizeVideoRef(entry);
  if (!ref) throw new TypeError('TikTok video entry contains an invalid owned-origin video reference');
  const hashtags = Array.isArray(entry.hashtags) ? entry.hashtags : [];
  if (hashtags.length > 100) throw new TypeError('TikTok video hashtags must contain at most 100 entries');
  return {
    ...ref,
    description: boundedText(entry.description, 'video description', 10_000),
    author: boundedText(entry.author ?? ref.handle, 'video author', 100),
    viewCount: numberOrNull(entry.viewCount),
    likeCount: numberOrNull(entry.likeCount),
    commentCount: numberOrNull(entry.commentCount),
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : null,
    hashtags: hashtags.map((tag) => boundedText(tag, 'hashtag', 100)).filter(Boolean)
  };
}

function normalizeVideoList(value, { owner = null, query = null, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.videos) || value.videos.length > MAX_RAW) {
    throw new TypeError(`TikTok video list must contain at most ${MAX_RAW} videos`);
  }
  const seen = new Set();
  const videos = [];
  for (const entry of value.videos) {
    const video = normalizeVideoEntry(entry);
    if (owner && video.handle !== owner.handle) throw new TypeError('TikTok user video does not belong to the requested user');
    if (seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    videos.push(video);
    if (videos.length >= limit) break;
  }
  if (videos.length === 0 && value.emptyState !== true) {
    throw new TypeError('TikTok empty video list requires explicit empty-state evidence');
  }
  return { ...(owner ? { user: owner } : {}), ...(query !== null ? { query } : {}), count: videos.length, videos };
}

function readOptions(opts, action, dom, normalize) {
  return executeTikTokRead({
    action,
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize
  });
}

async function extractVideoLinks(session, selector) {
  return session.page.$$eval(selector, (nodes) => nodes.slice(0, 400).map((node) => ({
    url: node.getAttribute('href'),
    description: node.getAttribute('aria-label') || node.textContent?.trim() || null,
    author: node.closest('[data-e2e="user-post-item"]')?.getAttribute('data-author') || null,
    viewCount: node.closest('[data-e2e="user-post-item"]')?.getAttribute('data-view-count') || null
  })));
}

export async function getUser(session, userRef, opts = {}) {
  const user = assertUserRef(userRef);
  const dom = async () => {
    await session.navigateGuardedForRead(user.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const profile = session.page.locator(tiktokSelectors.user.profile);
    if (await profile.count() !== 1) throw new Error('TikTok profile state could not be proven');
    return profile.first().evaluate((node) => ({
      displayName: node.querySelector('h1, h2')?.textContent?.trim() || null,
      bio: node.querySelector('[data-e2e="user-bio"]')?.textContent?.trim() || null,
      followerCount: node.getAttribute('data-followers'),
      followingCount: node.getAttribute('data-following'),
      likeCount: node.getAttribute('data-likes'),
      present: true
    }));
  };
  const { value } = await readOptions(opts, 'getUser', dom, (content) => {
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new TypeError('TikTok user content must be an object');
    if (content.present !== true) throw new TypeError('TikTok user content requires explicit presence evidence');
    return {
      ...user,
      displayName: boundedText(content.displayName, 'display name', 1_000),
      bio: boundedText(content.bio, 'bio', 10_000),
      followerCount: numberOrNull(content.followerCount),
      followingCount: numberOrNull(content.followingCount),
      likeCount: numberOrNull(content.likeCount)
    };
  });
  return wrapReadPayload({ url: user.url, kind: 'tiktok-user', content: value });
}

export async function getUserVideos(session, userRef, opts = {}) {
  const user = assertUserRef(userRef);
  const limit = limitFor(opts.limit);
  const dom = async () => {
    await session.navigateGuardedForRead(user.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const videos = await extractVideoLinks(session, tiktokSelectors.user.videoLink);
    if (videos.length === 0 && await session.page.locator(tiktokSelectors.user.emptyState).count() === 0) {
      throw new Error('TikTok user video state could not be proven');
    }
    return { videos, emptyState: videos.length === 0 };
  };
  const { value } = await readOptions(opts, 'getUserVideos', dom, (content) => normalizeVideoList(content, { owner: user, limit }));
  return wrapReadPayload({ url: user.url, kind: 'tiktok-user-videos', content: value });
}

export async function getVideo(session, videoRef, opts = {}) {
  const video = assertVideoRef(videoRef);
  const limit = limitFor(opts.commentLimit);
  const includeComments = opts.comments !== false;
  const dom = async () => {
    await session.navigateGuardedForRead(video.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const article = session.page.locator(tiktokSelectors.video.article);
    if (await article.count() !== 1) throw new Error('TikTok video state could not be proven');
    const base = await article.first().evaluate((node) => ({
      description: node.querySelector('[data-e2e="browse-video-desc"], [data-testid="video-description"]')?.textContent?.trim() || null,
      viewCount: node.getAttribute('data-view-count'),
      likeCount: node.getAttribute('data-like-count'),
      commentCount: node.getAttribute('data-comment-count'),
      timestamp: Number(node.getAttribute('data-create-time')) || null
    }));
    const comments = includeComments
      ? await session.page.$$eval(tiktokSelectors.video.commentText, (nodes) => nodes.slice(0, 400).map((node) => node.textContent?.trim()).filter(Boolean))
      : [];
    const commentsEmptyState = !includeComments || (
      comments.length === 0
      && await session.page.locator(tiktokSelectors.video.commentEmptyState).count() > 0
    );
    if (includeComments && comments.length === 0 && !commentsEmptyState) {
      throw new Error('TikTok comment state could not be proven');
    }
    return { ...base, comments, commentsEmptyState, present: true };
  };
  const { value } = await readOptions(opts, 'getVideo', dom, (content) => {
    if (!content || typeof content !== 'object' || !Array.isArray(content.comments) || content.comments.length > MAX_RAW) {
      throw new TypeError(`TikTok video content must contain at most ${MAX_RAW} comments`);
    }
    if (content.present !== true) throw new TypeError('TikTok video content requires explicit presence evidence');
    if (includeComments && content.comments.length === 0 && content.commentsEmptyState !== true) {
      throw new TypeError('TikTok empty comments require explicit empty-state evidence');
    }
    return {
      ...normalizeVideoEntry({ ...content, ...video }),
      comments: includeComments
        ? content.comments.slice(0, limit).map((comment) => boundedText(comment, 'comment', 10_000)).filter(Boolean)
        : []
    };
  });
  return wrapReadPayload({ url: video.url, kind: 'tiktok-video', content: value });
}

export async function searchVideos(session, query, opts = {}) {
  const searchQuery = String(query ?? '').trim();
  if (!searchQuery || searchQuery.length > 500) throw new TypeError('TikTok search query must contain 1-500 characters');
  const limit = limitFor(opts.limit);
  const url = `https://www.tiktok.com/search?q=${encodeURIComponent(searchQuery)}`;
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const videos = await extractVideoLinks(session, tiktokSelectors.search.videoLink);
    if (videos.length === 0 && await session.page.locator(tiktokSelectors.search.emptyState).count() === 0) {
      throw new Error('TikTok search state could not be proven');
    }
    return { videos, emptyState: videos.length === 0 };
  };
  const { value } = await readOptions(opts, 'searchVideos', dom, (content) => normalizeVideoList(content, { query: searchQuery, limit }));
  return wrapReadPayload({ url, kind: 'tiktok-search', content: value });
}

function accountFor(session, opts) {
  const accountId = String(session?.accountId ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
    throw new TypeError('TikTok current session account ID is required for DM reads');
  }
  if (opts.accountId != null && String(opts.accountId) !== accountId) {
    throw new TypeError('TikTok DM account override does not match the current session');
  }
  return accountId;
}

export async function listDMThreads(session, opts = {}) {
  const accountId = accountFor(session, opts);
  const limit = limitFor(opts.limit);
  const dom = async () => {
    await session.navigateGuardedForRead(tiktokSelectors.dm.inboxUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const hrefs = await session.page.$$eval(tiktokSelectors.dm.threadLink, (nodes) => nodes.slice(0, 400).map((node) => node.getAttribute('href')).filter(Boolean));
    if (hrefs.length === 0 && await session.page.locator(tiktokSelectors.dm.emptyInbox).count() === 0) {
      throw new Error('TikTok DM inbox state could not be proven');
    }
    return {
      emptyState: hrefs.length === 0,
      threads: hrefs.map((url) => ({ accountId, threadId: String(url).split('/').filter(Boolean).at(-1), url }))
    };
  };
  const { value } = await readOptions(opts, 'listDMThreads', dom, (content) => {
    if (!content || typeof content !== 'object' || !Array.isArray(content.threads) || content.threads.length > MAX_RAW) {
      throw new TypeError(`TikTok DM list must contain at most ${MAX_RAW} threads`);
    }
    const seen = new Set();
    const threads = [];
    for (const entry of content.threads) {
      const thread = normalizeThreadRef(entry, { accountId });
      if (!thread) throw new TypeError('TikTok DM list contains an invalid current-account thread');
      if (seen.has(thread.threadId)) continue;
      seen.add(thread.threadId);
      threads.push(thread);
      if (threads.length >= limit) break;
    }
    if (threads.length === 0 && content.emptyState !== true) throw new TypeError('TikTok empty DM list requires explicit empty-state evidence');
    return { accountId, threads };
  });
  return wrapReadPayload({ url: tiktokSelectors.dm.inboxUrl, kind: 'tiktok-dm-threads', content: value });
}

export async function readDMThread(session, threadRef, opts = {}) {
  const accountId = accountFor(session, opts);
  const thread = assertThreadRef(threadRef, { accountId });
  const limit = limitFor(opts.limit, 30);
  const dom = async () => {
    await session.navigateGuardedForRead(thread.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const messages = await session.page.$$eval(tiktokSelectors.dm.message, (nodes) => nodes.slice(-100).map((node) => ({
      messageId: node.getAttribute('data-message-id'),
      direction: node.getAttribute('data-outgoing') === 'true' ? 'out' : 'in',
      text: node.textContent?.trim() || null
    })).filter((message) => message.text));
    if (messages.length === 0 && await session.page.locator(tiktokSelectors.dm.emptyThread).count() === 0) {
      throw new Error('TikTok DM thread state could not be proven');
    }
    return { messages, emptyState: messages.length === 0 };
  };
  const { value } = await readOptions(opts, 'readDMThread', dom, (content) => {
    if (!content || typeof content !== 'object' || !Array.isArray(content.messages) || content.messages.length > 100) {
      throw new TypeError('TikTok DM thread must contain at most 100 messages');
    }
    if (content.messages.length === 0 && content.emptyState !== true) throw new TypeError('TikTok empty DM thread requires explicit empty-state evidence');
    const messages = content.messages.map((message) => {
      if (!message || typeof message !== 'object' || !['in', 'out'].includes(message.direction)) {
        throw new TypeError('TikTok DM messages require an in/out direction');
      }
      return {
        messageId: boundedText(message.messageId, 'message ID', 128),
        direction: message.direction,
        text: boundedText(message.text, 'message text', 10_000)
      };
    }).filter((message) => message.text).slice(-limit);
    return { ...thread, messages };
  });
  return wrapReadPayload({ url: thread.url, kind: 'tiktok-dm-thread', content: value });
}
