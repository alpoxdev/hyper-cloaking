// Canonical Reddit identifiers. These helpers accept public account names and
// existing post/comment handles, but never turn a username into a reply target.

const REDDIT_HOSTS = new Set([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'oauth.reddit.com'
]);
const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;
const USER_RE = /^[A-Za-z0-9_-]{3,20}$/;
const POST_ID_RE = /^[A-Za-z0-9]{3,10}$/;
const COMMENT_ID_RE = /^[A-Za-z0-9]{3,10}$/;

export class InvalidPostRefError extends Error {
  constructor(ref) {
    super(`Invalid post reference: expected an existing Reddit post permalink or handle, got ${JSON.stringify(ref)}`);
    this.name = 'InvalidPostRefError';
    this.code = 'invalid-post-ref';
    this.ref = ref;
  }
}

export class InvalidCommentRefError extends Error {
  constructor(ref) {
    super(`Invalid comment reference: replies are only allowed to existing comments (/comment/<id>), got ${JSON.stringify(ref)}`);
    this.name = 'InvalidCommentRefError';
    this.code = 'invalid-comment-ref';
    this.ref = ref;
  }
}

/** Returns a canonical subreddit name, or null when invalid. */
export function normalizeSubreddit(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/^\/?r\//i, '').replace(/^@/, '');
  return SUBREDDIT_RE.test(name) ? name : null;
}

export function subredditUrl(value) {
  const subreddit = normalizeSubreddit(value);
  if (!subreddit) throw new TypeError(`Invalid subreddit: ${String(value)}`);
  return `https://www.reddit.com/r/${subreddit}/`;
}

/** Returns a canonical Reddit username, or null when invalid. */
export function normalizeRedditUser(value) {
  if (typeof value !== 'string') return null;
  const user = value.trim().replace(/^\/?(?:u|user)\//i, '').replace(/^@/, '');
  return USER_RE.test(user) ? user : null;
}

export function userUrl(value) {
  const user = normalizeRedditUser(value);
  if (!user) throw new TypeError(`Invalid Reddit user: ${String(value)}`);
  return `https://www.reddit.com/user/${user}/`;
}

function parsePermalink(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim(), 'https://www.reddit.com');
    if (url.protocol !== 'https:' || !REDDIT_HOSTS.has(url.hostname)) return null;
    const match = url.pathname.match(
      /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([A-Za-z0-9]{3,10})(?:\/[^/?#]+)?(?:\/([A-Za-z0-9]{3,10}))?\/?$/i
    );
    if (!match) return null;
    const subreddit = normalizeSubreddit(match[1]);
    if (!subreddit) return null;
    return {
      subreddit,
      postId: match[2].toLowerCase(),
      commentId: match[3]?.toLowerCase() || null
    };
  } catch {
    return null;
  }
}

function parseHandle(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const subreddit = normalizeSubreddit(ref.subreddit);
  const postId = String(ref.postId ?? '').trim().toLowerCase();
  const commentId = ref.commentId == null ? null : String(ref.commentId).trim().toLowerCase();
  if (!subreddit || !POST_ID_RE.test(postId)) return null;
  if (commentId !== null && !COMMENT_ID_RE.test(commentId)) return null;
  return { subreddit, postId, commentId };
}

function partsFromRef(ref) {
  const direct = parseHandle(ref);
  if (direct) return direct;
  const permalink = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.permalink || ref.url || ref.href
      : null;
  return parsePermalink(permalink);
}

function postResult(parts) {
  const permalink = `/r/${parts.subreddit}/comments/${parts.postId}/`;
  return {
    subreddit: parts.subreddit,
    postId: parts.postId,
    commentId: null,
    permalink,
    url: `https://www.reddit.com${permalink}`
  };
}

function commentResult(parts) {
  const permalink = `/r/${parts.subreddit}/comments/${parts.postId}/_/${parts.commentId}/`;
  return { ...parts, permalink, url: `https://www.reddit.com${permalink}` };
}

/** Returns a canonical existing-post handle, or null when invalid. */
export function normalizePostRef(ref) {
  const parts = partsFromRef(ref);
  return parts ? postResult(parts) : null;
}

export function assertPostRef(ref) {
  const post = normalizePostRef(ref);
  if (!post) throw new InvalidPostRefError(ref);
  return post;
}

/** Returns a canonical existing-comment handle, or null when invalid. */
export function normalizeCommentRef(ref) {
  const parts = partsFromRef(ref);
  return parts?.commentId ? commentResult(parts) : null;
}

/** Ensures a reply target is an existing comment, never a username. */
export function assertExistingCommentRef(ref) {
  const comment = normalizeCommentRef(ref);
  if (!comment) throw new InvalidCommentRefError(ref);
  return comment;
}