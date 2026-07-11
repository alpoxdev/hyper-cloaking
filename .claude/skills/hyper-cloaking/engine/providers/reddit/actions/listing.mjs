// Reddit subreddit listing (read).

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';
import { normalizePostRef, normalizeSubreddit, subredditUrl } from './ids.mjs';

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
  const limit = positiveLimit(opts.limit, 25);
  const url = `${subredditUrl(subreddit)}${sort === 'hot' ? '' : `${sort}/`}`;

  await session.navigateGuarded(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const postLink = await resolveRedditSelector(session.page, redditSelectors.subreddit.postLink, {
    emptyState: redditSelectors.subreddit.emptyState,
    surface: 'subreddit posts'
  });
  if (!postLink) {
    return wrapReadPayload({ url, content: { subreddit, sort, count: 0, posts: [] }, kind: 'reddit-subreddit' });
  }

  const postTitle = await resolveRedditSelector(session.page, redditSelectors.post.title);
  const postScore = await resolveRedditSelector(session.page, redditSelectors.post.score);
  const postAuthor = await resolveRedditSelector(session.page, redditSelectors.post.author);
  const extraction = {
    ...redditSelectors.subreddit.extraction,
    postRoot: await resolveRedditSelector(session.page, redditSelectors.subreddit.extraction.postRoot)
  };
  const rows = await session.page.evaluate((selectors) => {
    const text = (node) => node?.textContent?.trim() || null;
    return [...document.querySelectorAll(selectors.postLink)].map((link) => {
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

  const seen = new Set();
  const posts = [];
  for (const row of rows) {
    const post = postFromHref(row.href);
    if (!post || seen.has(post.postId)) continue;
    seen.add(post.postId);
    posts.push({
      ...post,
      title: row.title,
      score: parseScore(row.score),
      commentCount: parseCommentCount(row.commentCount),
      timestamp: row.timestamp,
      author: row.author
    });
    if (posts.length === limit) break;
  }

  return wrapReadPayload({ url, content: { subreddit, sort, count: posts.length, posts }, kind: 'reddit-subreddit' });
}
