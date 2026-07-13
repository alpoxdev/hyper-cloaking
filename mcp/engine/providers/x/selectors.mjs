// Centralized X (Twitter) DOM selectors. Drift must fail closed in action code.

/**
 * Versioned DOM selector contract for X provider actions.
 * Selectors are centralized so UI drift can fail closed consistently.
 */
export const X_SELECTORS_VERSION = '2026-07-11';

export const xSelectors = {
  user: {
    profile: 'main [data-testid="UserName"], main [data-testid="UserProfileHeader_Items"]',
    postLink: 'main article a[href*="/status/"]',
    emptyState: 'main [data-testid="emptyState"], main [role="status"]:has-text("has not Tweeted")'
  },
  post: {
    article: 'main article[data-testid="tweet"], main article[data-testid="tweetDetail"]',
    author: 'main article a[href^="/"][role="link"]',
    text: 'main article [data-testid="tweetText"]',
    like: 'main article [data-testid="like"]',
    unlike: 'main article [data-testid="unlike"]',
    bookmark: 'main article [data-testid="bookmark"]',
    unbookmark: 'main article [data-testid="removeBookmark"]',
    repost: 'main article [data-testid="retweet"]',
    unrepost: 'main article [data-testid="unretweet"]',
    follow: 'main article [data-testid$="-follow"]',
    following: 'main article [data-testid$="-unfollow"]',
    reply: 'main [data-testid="tweetTextarea_0"], main [contenteditable="true"][data-testid^="tweetTextarea"]',
    replySubmit: 'main [data-testid="tweetButton"]',
    replyText: 'main article [data-testid="tweetText"]',
    replyEmptyState: 'main [data-testid="emptyState"]',
    quoteTrigger: 'main [data-testid="retweetConfirm"]',
    composerMediaInput: 'main input[data-testid="fileInput"]',
    audienceControl: 'main [data-testid="ScrollSnap-List"] [role="radiogroup"]'
  },
  search: {
    postLink: 'main article a[href*="/status/"]',
    emptyState: 'main [data-testid="empty_state_header_text"]'
  },
  thread: {
    article: 'main article[data-testid="tweet"]',
    emptyState: 'main [data-testid="emptyState"]'
  },
  dm: {
    inboxUrl: 'https://x.com/messages',
    threadLink: 'main a[href^="/messages/"]',
    message: 'main [data-testid="messageEntry"]',
    emptyInbox: 'main [data-testid="emptyState"]',
    emptyThread: 'main [data-testid="emptyState"]',
    composer: 'main [data-testid="dmComposerTextInput"]',
    send: 'main [data-testid="dmComposerSendButton"]'
  },
  compose: {
    url: 'https://x.com/compose/post',
    textArea: 'main [data-testid="tweetTextarea_0"]',
    mediaInput: 'main input[data-testid="fileInput"]',
    submit: 'main [data-testid="tweetButton"]',
    replyAudience: 'main [data-testid="settingsIcon"]'
  }
};
