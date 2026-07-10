// Instagram user posts / reels listing (read).

import { instagramSelectors } from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { profileUrl, normalizeUsername } from './user.mjs';

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
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 12;
  const includeReels = opts.includeReels !== false;
  const url = profileUrl(username);

  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.requireInstagramOrigin();
  const bodyText = await session.page.evaluate(() => document.body?.innerText || '').catch(() => '');
  session.throwOnChallenge({ text: bodyText });

  // Scroll to load more grid items up to the requested limit.
  let hrefs = [];
  for (let pass = 0; pass < 6; pass += 1) {
    hrefs = await session.page.$$eval(
      instagramSelectors.posts.gridLink,
      (nodes) => nodes.map((n) => n.getAttribute('href')).filter(Boolean)
    ).catch(() => []);
    if (hrefs.length >= limit) break;
    await session.humanScroll({ steps: 3 }).catch(() => {});
  }

  const seen = new Set();
  const posts = [];
  for (const href of hrefs) {
    const isReel = /\/reel\//.test(href);
    if (isReel && !includeReels) continue;
    const key = String(href);
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = key.startsWith('http') ? key : `https://www.instagram.com${key}`;
    posts.push({
      url: abs,
      type: isReel ? 'reel' : 'post',
      shortcode: (key.match(/\/(?:p|reel)\/([^/]+)/) || [])[1] || null,
      likeCount: null,
      commentCount: null,
      timestamp: null,
      hashtags: []
    });
    if (posts.length >= limit) break;
  }

  return wrapReadPayload({
    url,
    content: { username: normalizeUsername(username), count: posts.length, posts },
    kind: 'instagram-posts'
  });
}
