// Centralized Instagram DOM selectors — the ONE place selectors live (P5).
//
// Instagram's DOM is obfuscated and changes frequently. These selectors are
// EXPECTED to drift; treat this file as scheduled maintenance, not a stable
// contract. Strategy, in priority order:
//   1. role/aria and accessible names (most stable across builds)
//   2. stable href/url shapes (e.g. /direct/t/<id>)
//   3. structural fallbacks (least stable — last resort)
//
// Selector correctness has NO CI coverage; it is validated only by the `live`
// smoke path. The `SELECTORS_VERSION` bumps whenever a selector is changed so
// drift is auditable.

/**
 * Version marker for the selector set, bumped when a selector changes.
 *
 * @type {string}
 */
export const SELECTORS_VERSION = '2026-07-10';

/**
 * Centralized DOM selectors for Instagram profile, post, and direct-message
 * surfaces. Selectors prioritize accessible attributes and stable URL shapes,
 * with structural fallbacks for less stable markup.
 */
export const instagramSelectors = {
  profile: {
    // Header region of a profile page.
    header: 'header section',
    // Follower/following/post counts live in the header list.
    statsList: 'header section ul',
    displayName: 'header section h2, header section h1',
    bio: 'header section h1 ~ span, header section > div span',
    verifiedBadge: 'header [aria-label="Verified"], header svg[aria-label="Verified"]',
    privateNotice: 'article h2'
  },
  posts: {
    // Post/reel thumbnails on a profile grid are anchors to /p/ or /reel/.
    gridLink: 'main a[href*="/p/"], main a[href*="/reel/"]',
    emptyState: 'main h2:has-text("No Posts Yet"), main [role="status"]:has-text("No Posts Yet")',
    reelLink: 'main a[href*="/reel/"]',
    article: 'main article',
    likeButton: 'main article [aria-label="Like"]',
    unlikeButton: 'main article [aria-label="Unlike"]',
    commentField: 'main article textarea[aria-label="Add a comment…"]',
    commentSubmit: 'main article div[role="button"]:has-text("Post"), main article button[type="submit"]:has-text("Post")',
    // Exact comment-text descendants, excluding author headings.
    commentText: 'main article ul ul li > span, main article [role="listitem"] > span',
    saveButton: 'main article [aria-label="Save"]',
    unsaveButton: 'main article [aria-label="Remove"]',
    shareButton: 'main article [aria-label="Share Post"]',
    shareDialog: 'div[role="dialog"][aria-label*="Share"]'
  },
  dm: {
    inboxUrl: 'https://www.instagram.com/direct/inbox/',
    threadListItem: 'div[role="listitem"] a[href*="/direct/t/"], a[href*="/direct/t/"]',
    threadLink: 'a[href*="/direct/t/"]',
    emptyInboxState: 'main h2:has-text("No messages"), main [role="status"]:has-text("No messages")',
    emptyThreadState: 'main h2:has-text("No messages yet"), main [role="status"]:has-text("No messages yet")',
    messageList: 'div[role="grid"], div[aria-label*="Messages"]',
    incomingMessage: 'div[role="row"]',
    composer: 'div[role="textbox"][contenteditable="true"], textarea[placeholder="Message…"]',
    sendButton: 'div[role="button"]:has-text("Send")'
  }
};
