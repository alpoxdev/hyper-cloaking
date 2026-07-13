const HANDLE_RE = /^[A-Za-z0-9._-]{2,30}$/;
const VIDEO_ID_RE = /^\d{1,32}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);

function ownedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://www.tiktok.com');
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

export class InvalidTikTokRefError extends Error {
  constructor(kind, ref) {
    super(`Invalid TikTok ${kind} reference: ${JSON.stringify(ref)}`);
    this.name = 'InvalidTikTokRefError';
    this.code = `invalid-tiktok-${kind}-ref`;
    this.ref = ref;
  }
}

/** Normalize a user handle or owned TikTok profile URL; returns null for invalid or external references. */
export function normalizeUserRef(ref) {
  const raw = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.handle || ref.url
      : null;
  if (typeof raw !== 'string') return null;
  const direct = raw.trim().replace(/^@/, '');
  if (HANDLE_RE.test(direct) && !direct.includes('/')) {
    return { handle: direct, url: `https://www.tiktok.com/@${direct}` };
  }
  const url = ownedUrl(raw);
  const match = url?.pathname.match(/^\/@([A-Za-z0-9._-]{2,30})\/?$/);
  return match ? { handle: match[1], url: `https://www.tiktok.com/@${match[1]}` } : null;
}

/** Validate and normalize a user reference, throwing a typed error when invalid. */
export function assertUserRef(ref) {
  const value = normalizeUserRef(ref);
  if (!value) throw new InvalidTikTokRefError('user', ref);
  return value;
}

/** Normalize a TikTok video ID/URL reference while enforcing the owned TikTok origin. */
export function normalizeVideoRef(ref) {
  const suppliedId = ref && typeof ref === 'object' && ref.videoId != null ? String(ref.videoId) : null;
  const rawUrl = typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? ref.url || ref.href : null;
  const url = ownedUrl(rawUrl);
  const match = url?.pathname.match(/^\/@([A-Za-z0-9._-]{2,30})\/video\/(\d{1,32})\/?$/);
  const handle = ref && typeof ref === 'object' && ref.handle != null ? String(ref.handle).replace(/^@/, '') : match?.[1];
  const videoId = suppliedId || match?.[2];
  if (!handle || !HANDLE_RE.test(handle) || !videoId || !VIDEO_ID_RE.test(videoId)) return null;
  if (suppliedId && match?.[2] && suppliedId !== match[2]) return null;
  if (rawUrl != null && !match) return null;
  return { handle, videoId, url: `https://www.tiktok.com/@${handle}/video/${videoId}` };
}

/** Validate and normalize a video reference, throwing a typed error when invalid. */
export function assertVideoRef(ref) {
  const value = normalizeVideoRef(ref);
  if (!value) throw new InvalidTikTokRefError('video', ref);
  return value;
}

/** Normalize a comment reference and its parent video reference. */
export function normalizeCommentRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const commentId = String(ref.commentId ?? '');
  const video = normalizeVideoRef(ref);
  return OPAQUE_ID_RE.test(commentId) && video ? { ...video, commentId } : null;
}

/** Validate and normalize a comment reference, throwing a typed error when invalid. */
export function assertCommentRef(ref) {
  const value = normalizeCommentRef(ref);
  if (!value) throw new InvalidTikTokRefError('comment', ref);
  return value;
}

/** Normalize a current-account DM thread reference and verify its URL binding. */
export function normalizeThreadRef(ref, { accountId } = {}) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const threadId = String(ref.threadId ?? '');
  const boundAccount = String(ref.accountId ?? '');
  const expectedAccount = String(accountId ?? boundAccount);
  const url = ownedUrl(ref.url);
  const match = url?.pathname.match(/^\/messages\/([A-Za-z0-9_-]{1,128})\/?$/);
  if (
    !OPAQUE_ID_RE.test(threadId)
    || !OPAQUE_ID_RE.test(boundAccount)
    || !OPAQUE_ID_RE.test(expectedAccount)
    || boundAccount !== expectedAccount
    || !match
    || match[1] !== threadId
  ) return null;
  return {
    threadId,
    accountId: expectedAccount,
    url: `https://www.tiktok.com/messages/${threadId}`
  };
}

/** Validate and normalize a DM thread reference, throwing a typed error when invalid. */
export function assertThreadRef(ref, options) {
  const value = normalizeThreadRef(ref, options);
  if (!value) throw new InvalidTikTokRefError('thread', ref);
  return value;
}

/** Normalize an opaque TikTok draft identifier; returns null for malformed IDs. */
export function normalizeDraftRef(ref) {
  const draftId = ref && typeof ref === 'object' ? String(ref.draftId ?? '') : String(ref ?? '');
  return OPAQUE_ID_RE.test(draftId) ? { draftId } : null;
}

/** Validate and normalize a draft reference, throwing a typed error when invalid. */
export function assertDraftRef(ref) {
  const value = normalizeDraftRef(ref);
  if (!value) throw new InvalidTikTokRefError('draft', ref);
  return value;
}
