// Reddit subreddit listing (read).

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';
import { normalizePostRef, normalizeSubreddit, subredditUrl } from './ids.mjs';
import { executeRedditRead } from '../network.mjs';

function normalizeSubredditContent(value, { subreddit, sort, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.posts) || value.posts.length > 400) {
    throw new TypeError('Reddit listing content must contain at most 400 posts');
  }
  if (value.posts.length === 0 && value.emptyState !== true) {
    throw new TypeError('Reddit empty listing content requires explicit empty-state evidence');
  }
  const seen = new Set();
  const posts = [];
  for (const entry of value.posts) {
    if (!entry || typeof entry !== 'object') throw new TypeError('Reddit listing entries must be objects');
    const post = normalizePostRef(entry) || postFromHref(entry.href || entry.url);
    if (!post) throw new TypeError('Reddit listing entry contains an invalid post reference');
    if (seen.has(post.postId)) continue;
    seen.add(post.postId);
    posts.push({
      ...post,
      title: entry.title == null ? null : String(entry.title),
      score: Number.isFinite(entry.score) ? entry.score : parseScore(entry.score),
      commentCount: entry.commentCount == null
        ? null
        : Number.isFinite(entry.commentCount) ? entry.commentCount : parseCommentCount(entry.commentCount),
      timestamp: entry.timestamp == null ? null : String(entry.timestamp),
      author: entry.author == null ? null : String(entry.author)
    });
    if (posts.length >= limit) break;
  }
  if (posts.length === 0 && value.emptyState !== true) {
    throw new TypeError('Reddit normalized empty listing content requires explicit empty-state evidence');
  }
  return { subreddit, sort, count: posts.length, posts };
}

const positiveLimit = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback;

function postFromHref(href) {
  return normalizePostRef(href);
}

function parseScore(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([km])?/i);
  if (!match) return 0;
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  const score = Number(match[1]) * multiplier;
  return Number.isFinite(score) ? score : 0;
}
function parseCommentCount(value) {
  return /\d/.test(String(value ?? '')) ? parseScore(value) : null;
}

/** Lists recent posts from a subreddit. Returned page content is untrusted. */
export async function getSubreddit(session, name, opts = {}) {
  const subreddit = normalizeSubreddit(name);
  const sort = ['hot', 'new', 'top', 'rising'].includes(opts.sort) ? opts.sort : 'hot';
  const limit = Math.min(positiveLimit(opts.limit, 25), 100);
  const url = `${subredditUrl(subreddit)}${sort === 'hot' ? '' : `${sort}/`}`;
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const postLink = await resolveRedditSelector(session.page, redditSelectors.subreddit.postLink, {
      emptyState: redditSelectors.subreddit.emptyState,
      surface: 'subreddit posts'
    });
    if (!postLink) return { subreddit, sort, emptyState: true, posts: [] };
    const postTitle = await resolveRedditSelector(session.page, redditSelectors.post.title);
    const postScore = await resolveRedditSelector(session.page, redditSelectors.post.score);
    const postAuthor = await resolveRedditSelector(session.page, redditSelectors.post.author);
    const extraction = {
      ...redditSelectors.subreddit.extraction,
      postRoot: await resolveRedditSelector(session.page, redditSelectors.subreddit.extraction.postRoot)
    };
    const rows = await session.page.evaluate((selectors) => {
      const text = (node) => node?.textContent?.trim() || null;
      return [...document.querySelectorAll(selectors.postLink)].slice(0, 400).map((link) => {
        const root = link.closest(selectors.extraction.postRoot) || link.parentElement;
        const time = root?.querySelector(selectors.extraction.time);
        return {
          href: link.getAttribute('href'),
          title: text(root?.querySelector(selectors.postTitle)) || text(link),
          score: text(root?.querySelector(selectors.postScore)),
          commentCount: text(root?.querySelector(selectors.extraction.commentPermalink)),
          timestamp: time?.getAttribute('datetime') || time?.textContent?.trim() || null,
          author: text(root?.querySelector(selectors.postAuthor))
        };
      });
    }, { postLink, postTitle, postScore, postAuthor, extraction });
    return { subreddit, sort, emptyState: false, posts: rows };
  };
  const { value } = await executeRedditRead({
    action: 'getSubreddit',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeSubredditContent(content, {
      subreddit,
      sort,
      limit
    })
  });
  return wrapReadPayload({
    url,
    content: value,
    kind: 'reddit-subreddit'
  });
}
