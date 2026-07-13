/** Validate and normalize X user, post, and DM-thread references. */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const POST_ID_RE = /^\d{1,32}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com'
]);

function ownedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://x.com');
    if (
      url.protocol !== 'https:' ||
      !HOSTS.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/** Error thrown when an X resource reference fails validation. */
export class InvalidXRefError extends Error {
  constructor(kind, ref) {
    super(`Invalid X ${kind} reference: ${JSON.stringify(ref)}`);
    this.name = 'InvalidXRefError';
    this.code = `invalid-x-${kind}-ref`;
    this.ref = ref;
  }
}

/** Normalize a user handle or owned X profile URL. */
export function normalizeUserRef(ref) {
  const raw =
    typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? ref.handle || ref.url : null;
  if (typeof raw !== 'string') return null;
  const direct = raw.trim().replace(/^@/, '');
  if (HANDLE_RE.test(direct) && !direct.includes('/')) {
    return { handle: direct, url: `https://x.com/${direct}` };
  }
  const url = ownedUrl(raw);
  const match = url?.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  return match ? { handle: match[1], url: `https://x.com/${match[1]}` } : null;
}

/** Normalize a user reference, throwing on invalid input. */
export function assertUserRef(ref) {
  const value = normalizeUserRef(ref);
  if (!value) throw new InvalidXRefError('user', ref);
  return value;
}

/** Normalize a post handle/ID or owned X status URL. */
export function normalizePostRef(ref) {
  const suppliedId =
    ref && typeof ref === 'object' && ref.postId != null ? String(ref.postId) : null;
  const rawUrl =
    typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? ref.url || ref.href : null;
  const url = ownedUrl(rawUrl);
  const match = url?.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,32})\/?$/);
  const handle =
    ref && typeof ref === 'object' && ref.handle != null
      ? String(ref.handle).replace(/^@/, '')
      : match?.[1];
  const postId = suppliedId || match?.[2];
  if (!handle || !HANDLE_RE.test(handle) || !postId || !POST_ID_RE.test(postId)) return null;
  if (suppliedId && match?.[2] && suppliedId !== match[2]) return null;
  if (rawUrl != null && !match) return null;
  return { handle, postId, url: `https://x.com/${handle}/status/${postId}` };
}

/** Normalize a post reference, throwing on invalid input. */
export function assertPostRef(ref) {
  const value = normalizePostRef(ref);
  if (!value) throw new InvalidXRefError('post', ref);
  return value;
}

/** Normalize a DM thread reference bound to an account. */
export function normalizeThreadRef(ref, { accountId } = {}) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const threadId = String(ref.threadId ?? '');
  const boundAccount = String(ref.accountId ?? '');
  const expectedAccount = String(accountId ?? boundAccount);
  const url = ownedUrl(ref.url);
  const match = url?.pathname.match(/^\/messages\/([A-Za-z0-9_-]{1,128})\/?$/);
  if (
    !OPAQUE_ID_RE.test(threadId) ||
    !OPAQUE_ID_RE.test(boundAccount) ||
    !OPAQUE_ID_RE.test(expectedAccount) ||
    boundAccount !== expectedAccount ||
    !match ||
    match[1] !== threadId
  )
    return null;
  return {
    threadId,
    accountId: expectedAccount,
    url: `https://x.com/messages/${threadId}`
  };
}

/** Normalize a DM thread reference, throwing on invalid input. */
export function assertThreadRef(ref, options) {
  const value = normalizeThreadRef(ref, options);
  if (!value) throw new InvalidXRefError('dm-thread', ref);
  return value;
}
