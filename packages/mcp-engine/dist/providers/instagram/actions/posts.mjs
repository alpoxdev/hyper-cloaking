/**
 * Instagram profile-grid post and reel read actions.
 *
 * Reads accept a username plus bounded pagination options and perform guarded
 * navigation/scrolling. Results are wrapped normalized post records with
 * canonical owned-origin URLs; empty grids require explicit DOM evidence.
 * Network/navigation failures and malformed or unbounded provider content throw;
 * reads do not mutate account state.
 */

import { instagramSelectors } from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { profileUrl, normalizeUsername } from './user.mjs';
import { executeInstagramRead } from '../network.mjs';

function normalizePostsContent(value, { username, limit, includeReels }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.posts) ||
    value.posts.length > 400
  ) {
    throw new TypeError('Instagram posts content must contain at most 400 posts');
  }
  if (value.posts.length === 0 && value.emptyState !== true) {
    throw new TypeError('Instagram empty post content requires explicit empty-state evidence');
  }
  const seen = new Set();
  const posts = [];
  for (const entry of value.posts) {
    if (!entry || typeof entry !== 'object')
      throw new TypeError('Instagram post entries must be objects');
    let parsed;
    try {
      parsed = new URL(String(entry.url));
    } catch {
      throw new TypeError('Instagram post URL must be a canonical owned-origin post or reel URL');
    }
    const match = parsed.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/);
    if (parsed.origin !== 'https://www.instagram.com' || parsed.search || parsed.hash || !match) {
      throw new TypeError('Instagram post URL must be a canonical owned-origin post or reel URL');
    }
    const type = match[1] === 'reel' ? 'reel' : 'post';
    if (type === 'reel' && !includeReels) continue;
    const canonicalUrl = `${parsed.origin}/${match[1]}/${match[2]}/`;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    if (Array.isArray(entry.hashtags) && entry.hashtags.length > 100) {
      throw new TypeError('Instagram post hashtags must contain at most 100 entries');
    }
    const hashtags = Array.isArray(entry.hashtags)
      ? entry.hashtags.map((tag) => {
          const text = String(tag);
          if (text.length > 100) throw new TypeError('Instagram hashtag exceeds 100 characters');
          return text;
        })
      : [];
    posts.push({
      url: canonicalUrl,
      type,
      shortcode: match[2],
      likeCount: Number.isFinite(entry.likeCount) ? entry.likeCount : null,
      commentCount: Number.isFinite(entry.commentCount) ? entry.commentCount : null,
      timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : null,
      hashtags
    });
    if (posts.length >= limit) break;
  }
  return { username, count: posts.length, posts };
}

/**
 * Lists a user's recent posts/reels from their profile grid (read).
 * Extracts stable href shapes; per-post like/comment counts are best-effort and
 * may be absent on the grid (they require opening each post).
 *
 * @param {object} session
 * @param {string} username
 * @param {{ limit?: number, includeReels?: boolean }} [opts]
 * @returns {Promise<object>} Untrusted-wrapped Post[] payload.
 */
export async function getUserPosts(session, username, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 100) : 12;
  const includeReels = opts.includeReels !== false;
  const normalizedUsername = normalizeUsername(username);
  const url = profileUrl(username);
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    let hrefs = [];
    for (let pass = 0; pass < 6; pass += 1) {
      hrefs = await session.page.$$eval(instagramSelectors.posts.gridLink, (nodes) =>
        nodes
          .slice(0, 400)
          .map((node) => node.getAttribute('href'))
          .filter(Boolean)
      );
      if (hrefs.length >= limit) break;
      if (hrefs.length === 0) {
        const emptyCount = await session.page.locator(instagramSelectors.posts.emptyState).count();
        if (emptyCount > 0) break;
      }
      await session.humanScroll({ steps: 3 });
    }
    if (hrefs.length === 0) {
      const emptyCount = await session.page.locator(instagramSelectors.posts.emptyState).count();
      if (emptyCount === 0) throw new Error('Instagram post list state could not be proven');
    }
    return {
      username: normalizedUsername,
      emptyState: hrefs.length === 0,
      posts: hrefs.map((href) => ({
        url: String(href).startsWith('http') ? String(href) : `https://www.instagram.com${href}`,
        likeCount: null,
        commentCount: null,
        timestamp: null,
        hashtags: []
      }))
    };
  };
  const { value } = await executeInstagramRead({
    action: 'getUserPosts',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) =>
      normalizePostsContent(content, {
        username: normalizedUsername,
        limit,
        includeReels
      })
  });
  return wrapReadPayload({
    url,
    content: value,
    kind: 'instagram-posts'
  });
}
