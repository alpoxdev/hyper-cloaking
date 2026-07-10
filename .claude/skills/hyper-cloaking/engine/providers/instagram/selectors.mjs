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

export const SELECTORS_VERSION = '2026-07-10';

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
    reelLink: 'main a[href*="/reel/"]',
    article: 'article',
    likeButton: 'article [aria-label="Like"], svg[aria-label="Like"]',
    unlikeButton: 'article [aria-label="Unlike"], svg[aria-label="Unlike"]',
    commentField: 'article textarea[aria-label="Add a comment…"], textarea[aria-label="Add a comment…"]',
    commentSubmit: 'div[role="button"]:has-text("Post"), button[type="submit"]',
    // Comment list region — used to verify a posted comment appears (not whole-body text).
    commentsList: 'article ul ul, article [role="list"]',
    saveButton: 'article [aria-label="Save"], svg[aria-label="Save"]',
    unsaveButton: 'article [aria-label="Remove"], svg[aria-label="Remove"]',
    shareButton: 'article [aria-label="Share Post"], svg[aria-label="Share Post"]'
  },
  dm: {
    inboxUrl: 'https://www.instagram.com/direct/inbox/',
    threadListItem: 'div[role="listitem"] a[href*="/direct/t/"], a[href*="/direct/t/"]',
    threadLink: 'a[href*="/direct/t/"]',
    messageList: 'div[role="grid"], div[aria-label*="Messages"]',
    incomingMessage: 'div[role="row"]',
    composer: 'div[role="textbox"][contenteditable="true"], textarea[placeholder="Message…"]',
    sendButton: 'div[role="button"]:has-text("Send")'
  }
};
