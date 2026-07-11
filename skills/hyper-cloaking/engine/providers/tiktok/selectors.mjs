// Centralized TikTok DOM selectors. Drift must fail closed in action code.

export const TIKTOK_SELECTORS_VERSION = '2026-07-11';

export const tiktokSelectors = {
  user: {
    profile: 'main [data-e2e="user-page"], main [data-testid="user-profile"]',
    videoLink: 'main a[href*="/video/"]',
    emptyState: 'main [role="status"]:has-text("No videos"), main [role="status"]:has-text("게시물이 없습니다")'
  },
  video: {
    article: 'main [data-e2e="browse-video"], main article[data-video-id]',
    author: 'main a[href^="/@"]',
    description: 'main [data-e2e="browse-video-desc"], main [data-testid="video-description"]',
    like: 'main button[data-e2e="like-icon"]',
    unlike: 'main button[data-e2e="like-icon"][aria-pressed="true"]',
    save: 'main button[aria-label*="Add to Favorites"], main button[aria-label*="Save"]',
    unsave: 'main button[aria-label*="Remove from Favorites"], main button[aria-label*="Unsave"]',
    follow: 'main button[data-e2e="follow-button"]',
    following: 'main button[data-e2e="following-button"]',
    repost: 'main button[aria-label*="Repost"]',
    unrepost: 'main button[aria-label*="Remove repost"]',
    comment: 'main textarea[data-e2e="comment-input"], main [contenteditable="true"][data-e2e="comment-input"]',
    commentSubmit: 'main button[data-e2e="comment-post"]',
    commentText: 'main [data-e2e="comment-level-1"] [data-e2e="comment-text"]',
    commentEmptyState: 'main [role="status"]:has-text("No comments"), main [role="status"]:has-text("댓글이 없습니다")',
    reply: 'button[data-e2e="comment-reply"]'
  },
  search: {
    videoLink: 'main a[href*="/video/"]',
    emptyState: 'main [role="status"]:has-text("No results"), main [role="status"]:has-text("검색 결과가 없습니다")'
  },
  dm: {
    inboxUrl: 'https://www.tiktok.com/messages',
    threadLink: 'main a[href^="/messages/"]',
    message: 'main [data-message-id]',
    emptyInbox: 'main [role="status"]:has-text("No messages")',
    emptyThread: 'main [role="status"]:has-text("No messages yet")',
    composer: 'main [contenteditable="true"][data-e2e="message-input"], main textarea[placeholder*="message"]',
    send: 'main button[data-e2e="message-send"], main button:has-text("Send")'
  },
  upload: {
    input: 'main input[type="file"]',
    draft: 'main [data-draft-id]',
    publish: 'main button[data-e2e="post_video_button"], main button:has-text("Post")'
  }
};
