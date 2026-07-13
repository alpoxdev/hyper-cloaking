// Centralized YouTube DOM selectors — the ONE place selectors live (P5).
// Prefer accessible role/name selectors; ytd-* and CSS selectors are fallbacks
// because YouTube's component markup changes independently of its UI labels.

export const SELECTORS_VERSION = '2026-07-10';

export const youtubeSelectors = {
  search: {
    resultLinks: {
      primary: 'a[aria-label][href^="/watch?v="]',
      fallback: 'ytd-video-renderer a#video-title[href^="/watch?v="]'
    },
    // These are semantic layout alternatives, not a combined collection. Rich
    // item renderers wrap rich-grid media, so they are deliberately excluded.
    extraction: {
      primary: {
        resultCard: 'ytd-video-renderer',
        channelLink: 'ytd-channel-name a'
      },
      // These card types are intentionally heterogeneous and non-nesting.
      fallback: {
        resultCard: ':is(ytd-rich-grid-media, ytd-compact-video-renderer)',
        channelLink: '#channel-name a'
      }
    },
    emptyState: {
      primary: 'ytd-search-no-results-renderer',
      fallback: 'ytd-search ytd-message-renderer'
    }
  },
  video: {
    title: {
      primary: 'h1[role="heading"]',
      fallback: 'ytd-watch-metadata h1'
    },
    channelLink: {
      primary: 'a[aria-label][href^="/@"]',
      fallback: 'ytd-video-owner-renderer a[href^="/@"], ytd-channel-name a'
    },
    description: {
      primary: '[role="main"] #description',
      fallback:
        'ytd-watch-metadata #description-inline-expander, ytd-text-inline-expander#description-inline-expander'
    },
    viewCount: {
      primary: '[aria-label*="views" i]',
      fallback: 'ytd-watch-info-text #info #count'
    },
    likeButton: {
      primary: 'button[aria-label^="like this video" i], button[aria-label^="Like" i]',
      fallback: 'ytd-segmented-like-dislike-button-renderer button[aria-pressed]'
    },
    commentThreads: {
      primary: '[role="article"][aria-label*="comment" i]',
      fallback: 'ytd-comment-thread-renderer'
    },
    commentText: {
      primary:
        '[role="article"][aria-label*="comment" i] #content-text, [role="article"] [data-testid="comment"]',
      fallback: 'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text'
    },
    extraction: {
      publishedAt: 'meta[itemprop="datePublished"]',
      tags: {
        primary: 'meta[property="og:video:tag"]',
        fallback: 'meta[itemprop="keywords"]'
      }
    }
  },
  channel: {
    name: {
      primary: 'h1[role="heading"]',
      fallback:
        'ytd-channel-name #text, ytd-c4-tabbed-header-renderer #channel-header-container #text'
    },
    handle: {
      primary: '[aria-label^="Handle" i]',
      fallback: 'ytd-c4-tabbed-header-renderer #channel-handle'
    },
    subscriberCount: {
      primary: '[aria-label*="subscribers"]',
      fallback: 'ytd-c4-tabbed-header-renderer #subscriber-count'
    },
    description: {
      primary: '[role="main"] #description',
      fallback: 'ytd-channel-about-metadata-renderer #description-container'
    },
    videoLinks: {
      primary: 'a[aria-label][href^="/watch?v="]',
      fallback:
        'ytd-rich-grid-media a#video-title-link[href^="/watch?v="], ytd-grid-video-renderer a#video-title'
    },
    emptyState: {
      primary: 'ytd-browse[page-subtype="channels"] ytd-message-renderer',
      fallback: 'ytd-browse[page-subtype="channels"] ytd-rich-grid-renderer #contents:empty'
    },
    // Resolve one layout tier before extraction. The fallback's card types are
    // intentional non-nesting alternatives, so one video cannot yield wrappers
    // from both tiers.
    extraction: {
      primary: {
        videoCard: 'ytd-rich-grid-media',
        metadataLine: '#metadata-line',
        publishedAt: 'time[datetime]'
      },
      fallback: {
        videoCard: ':is(ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer)',
        metadataLine: '#metadata-line',
        publishedAt: 'time[datetime]'
      }
    }
  },
  actions: {
    likeButton: {
      primary:
        'ytd-watch-metadata ytd-segmented-like-dislike-button-renderer button[aria-label^="Like this video" i], ytd-watch-metadata ytd-segmented-like-dislike-button-renderer button[aria-label^="Unlike" i]',
      fallback:
        'ytd-watch-flexy ytd-segmented-like-dislike-button-renderer button[aria-label^="Like this video" i], ytd-watch-flexy ytd-segmented-like-dislike-button-renderer button[aria-label^="Unlike" i]'
    },
    commentField: {
      primary:
        'ytd-comments ytd-comment-simplebox-renderer [role="textbox"][aria-label*="comment" i]',
      fallback: 'ytd-comments ytd-comment-simplebox-renderer #contenteditable-root'
    },
    commentSubmit: {
      primary: 'ytd-comments ytd-comment-simplebox-renderer button[aria-label="Comment"]',
      fallback: 'ytd-comments ytd-comment-simplebox-renderer #submit-button button'
    },
    commentEmptyState: {
      primary: 'ytd-comments #contents:empty',
      fallback:
        'ytd-comments #contents:not(:has(ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer))'
    },
    subscribeButton: {
      primary:
        'ytd-c4-tabbed-header-renderer ytd-subscribe-button-renderer button[aria-label^="Subscribe" i], ytd-c4-tabbed-header-renderer ytd-subscribe-button-renderer [role="button"][aria-label^="Subscribe" i]',
      fallback: 'ytd-page-header-renderer ytd-subscribe-button-renderer button'
    }
  }
};

/**
 * Resolves a selector entry without weakening accessible-selector priority.
 *
 * @param {object} page Playwright page.
 * @param {{primary: string, fallback: string}} entry Selector entry.
 * @param {{emptyState?: {primary: string, fallback: string}, allowAbsent?: boolean}} [opts]
 *   Explicit evidence that an otherwise absent read collection is empty. Optional
 *   metadata may instead set allowAbsent and resolve to null; it does not alter
 *   collection exhaustion behavior.
 * @returns {Promise<string|null>} The matching selector, or null when explicitly absent.
 */
export async function resolveYouTubeSelector(page, entry, opts = {}) {
  if (!page || typeof page.locator !== 'function') {
    throw new TypeError('resolveYouTubeSelector requires a Playwright page');
  }
  if (!entry || typeof entry.primary !== 'string' || typeof entry.fallback !== 'string') {
    throw new TypeError('resolveYouTubeSelector requires a { primary, fallback } selector entry');
  }

  if ((await page.locator(entry.primary).count()) > 0) return entry.primary;
  if ((await page.locator(entry.fallback).count()) > 0) return entry.fallback;

  const emptyState = opts.emptyState;
  if (emptyState) {
    if (typeof emptyState.primary !== 'string' || typeof emptyState.fallback !== 'string') {
      throw new TypeError('emptyState must provide primary and fallback selectors');
    }
    if ((await page.locator(emptyState.primary).count()) > 0) return null;
    if ((await page.locator(emptyState.fallback).count()) > 0) return null;
  }
  if (opts.allowAbsent === true) return null;

  throw new Error(
    `YouTube selector extraction failed: neither primary "${entry.primary}" nor fallback "${entry.fallback}" matched`
  );
}
/**
 * Resolves a composite extraction tier before passing it to browser evaluation.
 *
 * @param {object} page Playwright page.
 * @param {{primary: {resultCard?: string, videoCard?: string}, fallback: {resultCard?: string, videoCard?: string}}} entry
 * @returns {Promise<object>} The selected serialization-safe extraction tier.
 */
export async function resolveYouTubeExtractionTier(page, entry) {
  if (!page || typeof page.locator !== 'function') {
    throw new TypeError('resolveYouTubeExtractionTier requires a Playwright page');
  }
  if (!entry || !entry.primary || !entry.fallback) {
    throw new TypeError('resolveYouTubeExtractionTier requires primary and fallback tiers');
  }

  const cardSelector = (tier) => tier.resultCard || tier.videoCard;
  const primary = cardSelector(entry.primary);
  const fallback = cardSelector(entry.fallback);
  if (typeof primary !== 'string' || typeof fallback !== 'string') {
    throw new TypeError('Each extraction tier must provide a card selector');
  }

  if ((await page.locator(primary).count()) > 0) return entry.primary;
  if ((await page.locator(fallback).count()) > 0) return entry.fallback;

  throw new Error(
    `YouTube extraction tier failed: neither primary "${primary}" nor fallback "${fallback}" matched`
  );
}
