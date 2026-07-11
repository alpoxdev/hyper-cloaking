// Centralized Reddit selectors. Prefer accessible role/aria selectors; fall back
// to Shreddit custom elements and CSS only when the accessible surface drifts.

export const SELECTORS_VERSION = '2026-07-10';

export const redditSelectors = {
  subreddit: {
    postLink: { primary: '[role="main"] a[aria-label*="comments"]', fallback: 'shreddit-post a[href*="/comments/"]' },
    emptyState: {
      primary: '[role="main"] [data-testid="empty-feed"]',
      fallback: 'shreddit-post-listing[empty], shreddit-post-listing [slot="empty"]'
    },
    extraction: {
      postRoot: { primary: 'article', fallback: 'shreddit-post' },
      time: ':scope time',
      commentPermalink: ':scope a[href*="/comments/"]'
    }
  },
  post: {
    article: { primary: '[role="article"]', fallback: 'shreddit-post, [data-testid="post-container"]' },
    title: { primary: '[role="article"] [role="heading"]', fallback: 'shreddit-post h1, shreddit-post h2, h1' },
    score: { primary: '[aria-label*="upvote"]', fallback: 'shreddit-post [slot="score"], .score' },
    author: { primary: 'a[aria-label^="u/"]', fallback: 'shreddit-post a[href^="/user/"]' },
    comment: { primary: '[role="article"][aria-label*="comment"]', fallback: 'shreddit-comment' },
    emptyComments: {
      primary: '[data-testid="post-comment-tree"] [data-testid="empty-state"]',
      fallback: 'shreddit-comment-tree[empty], shreddit-comment-tree [slot="empty"]'
    },
    extraction: {
      time: ':scope time',
      commentPermalink: ':scope a[href*="/comments/"]',
      commentAuthor: ':scope a[href*="/user/"]',
      commentBody: { primary: ':scope [data-testid="comment"]', fallback: ':scope div[slot="comment"]' }
    }
  },
  user: {
    header: { primary: '[role="banner"]', fallback: 'shreddit-profile-header, header' },
    name: { primary: '[role="heading"][aria-level="1"]', fallback: 'shreddit-profile-header h1, h1' },
    karma: { primary: '[aria-label*="karma"]', fallback: 'shreddit-profile-header [slot="karma"], .karma' },
    activityItem: {
      primary: 'shreddit-profile-page [role="article"]',
      fallback: 'shreddit-profile-page :is(shreddit-post, shreddit-comment)'
    },
    emptyActivity: {
      primary: '[data-testid="profile-content"] [data-testid="empty-state"]',
      fallback: 'shreddit-profile-page [slot="empty"]'
    },
    extraction: {
      time: ':scope time',
      activityPermalink: ':scope a[href*="/comments/"]',
      activityScore: { primary: ':scope [aria-label*="upvote"]', fallback: ':scope [slot="score"]' }
    }
  },
};
/**
 * Returns selectors that identify one canonical Reddit comment root. Comment
 * ids are validated before this is called, so interpolation cannot widen scope.
 * @param {string} commentId Canonical base36 Reddit comment id.
 * @returns {{primary: string, fallback: string}} Exact comment-root selectors.
 */
export function redditCommentByIdSelector(commentId) {
  const thingId = `t1_${String(commentId).toLowerCase()}`;
  return {
    primary: `[id="${thingId}"], [data-testid="comment"][id="${thingId}"]`,
    fallback: `shreddit-comment[thingid="${thingId}"], shreddit-comment[data-comment-id="${commentId}"]`
  };
}
/**
 * Returns selectors that identify one canonical Reddit post root. Post ids are
 * validated before this is called, so interpolation cannot widen scope.
 * @param {string} postId Canonical base36 Reddit post id.
 * @returns {{primary: string, fallback: string}} Exact post-root selectors.
 */
export function redditPostByIdSelector(postId) {
  const thingId = `t3_${String(postId).toLowerCase()}`;
  return {
    primary: `[id="${thingId}"], [data-testid="post-container"][id="${thingId}"]`,
    fallback: `shreddit-post[thingid="${thingId}"], shreddit-post[data-post-id="${postId}"]`
  };
}
/**
 * Builds selectors for controls and collections owned by one canonical post.
 * Every selector remains anchored to the post thing id so comment descendants
 * cannot be mistaken for post controls.
 */
export function redditPostOwnedSelectors(postId) {
  const thingId = `t3_${String(postId).toLowerCase()}`;
  const root = `[id="${thingId}"]`;
  const fallbackRoot = `shreddit-post[thingid="${thingId}"]`;
  return {
    actionBar: {
      primary: `${root} > [data-testid="post-action-bar"]`,
      fallback: `${fallbackRoot} > [slot="action-row"]`
    },
    upvote: {
      primary: `${root} > [data-testid="post-action-bar"] button[aria-label^="upvote"]`,
      fallback: `${fallbackRoot} > [slot="action-row"] button[slot="upvote-button"]`
    },
    upvoted: {
      primary: `${root} > [data-testid="post-action-bar"] button[aria-pressed="true"][aria-label^="upvote"]`,
      fallback: `${fallbackRoot} > [slot="action-row"] button[slot="upvote-button"][aria-pressed="true"]`
    },
    save: {
      primary: `${root} > [data-testid="post-action-bar"] button[aria-label^="save"]`,
      fallback: `${fallbackRoot} > [slot="action-row"] button[slot="save-button"]`
    },
    saved: {
      primary: `${root} > [data-testid="post-action-bar"] button[aria-label^="Unsave"]`,
      fallback: `${fallbackRoot} > [slot="action-row"] button[slot="save-button"][aria-label^="Unsave"]`
    },
    composer: {
      primary: `${root} > [data-testid="post-composer"]`,
      fallback: `${fallbackRoot} > shreddit-comment-composer`
    },
    commentField: {
      primary: `${root} > [data-testid="post-composer"] [role="textbox"][aria-label*="comment"]`,
      fallback: `${fallbackRoot} > shreddit-comment-composer textarea`
    },
    commentSubmit: {
      primary: `${root} > [data-testid="post-composer"] button[aria-label="Comment"]`,
      fallback: `${fallbackRoot} > shreddit-comment-composer button[type="submit"]`
    },
    commentBodies: {
      primary: `${root} > [data-testid="post-comment-tree"] > [data-testid="comment"] [data-testid="comment-body"]`,
      fallback: `${fallbackRoot} > shreddit-comment-tree > shreddit-comment [slot="comment"]`
    }
  };
}

/**
 * Builds selectors for controls and direct child replies owned by one canonical
 * comment. They deliberately exclude nested comment action rows and composers.
 */
export function redditCommentOwnedSelectors(commentId) {
  const thingId = `t1_${String(commentId).toLowerCase()}`;
  const root = `[id="${thingId}"]`;
  const fallbackRoot = `shreddit-comment[thingid="${thingId}"]`;
  return {
    actionRow: {
      primary: `${root} > [data-testid="comment-action-row"]`,
      fallback: `${fallbackRoot} > [slot="action-row"]`
    },
    reply: {
      primary: `${root} > [data-testid="comment-action-row"] button[aria-label^="Reply"]`,
      fallback: `${fallbackRoot} > [slot="action-row"] button[slot="reply-button"]`
    },
    composer: {
      primary: `${root} > [data-testid="comment-reply-composer"]`,
      fallback: `${fallbackRoot} > shreddit-comment-composer`
    },
    commentField: {
      primary: `${root} > [data-testid="comment-reply-composer"] [role="textbox"][aria-label*="comment"]`,
      fallback: `${fallbackRoot} > shreddit-comment-composer textarea`
    },
    commentSubmit: {
      primary: `${root} > [data-testid="comment-reply-composer"] button[aria-label="Comment"]`,
      fallback: `${fallbackRoot} > shreddit-comment-composer button[type="submit"]`
    },
    childReplyBodies: {
      primary: `${root} > [data-testid="comment-child-replies"] > [data-testid="comment"] > [data-testid="comment-body"]`,
      fallback: `${fallbackRoot} > shreddit-comment-replies > shreddit-comment > [slot="comment"]`
    }
  };
}

/**
 * Resolves a selector entry against a Playwright page, trying primary first.
 * An exhausted entry is only a legitimate empty surface when an explicit
 * provider empty-state selector matches.
 * @param {object} page Playwright page.
 * @param {{primary: string, fallback: string}} entry Selector pair.
 * @param {{emptyState?: {primary: string, fallback: string}, surface?: string}} [options]
 * @returns {Promise<string|null>} The matching selector, or null for a proven empty surface.
 */
export async function resolveRedditSelector(page, entry, options = {}) {
  if (!page || typeof page.locator !== 'function') {
    throw new TypeError('resolveRedditSelector requires a Playwright page');
  }
  if (!entry || typeof entry.primary !== 'string' || typeof entry.fallback !== 'string') {
    throw new TypeError('resolveRedditSelector requires a { primary, fallback } selector entry');
  }

  const primaryCount = await page.locator(entry.primary).count();
  if (primaryCount > 0) return entry.primary;

  const fallbackCount = await page.locator(entry.fallback).count();
  if (fallbackCount > 0) return entry.fallback;

  const emptyState = options.emptyState;
  let emptyPrimaryCount = 0;
  let emptyFallbackCount = 0;
  if (emptyState) {
    emptyPrimaryCount = await page.locator(emptyState.primary).count();
    if (emptyPrimaryCount > 0) return null;
    emptyFallbackCount = await page.locator(emptyState.fallback).count();
    if (emptyFallbackCount > 0) return null;
  }

  const surface = options.surface ? ` for ${options.surface}` : '';
  throw new RedditSelectorExhaustedError(
    `Reddit selector exhaustion${surface}: neither primary nor fallback matched`,
    {
      entry,
      emptyState,
      surface: options.surface || null,
      counts: { primary: primaryCount, fallback: fallbackCount, emptyPrimary: emptyPrimaryCount, emptyFallback: emptyFallbackCount }
    }
  );
}

export class RedditSelectorExhaustedError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = 'RedditSelectorExhaustedError';
    this.code = 'reddit-selector-exhausted';
    this.diagnostics = diagnostics;
  }
}
