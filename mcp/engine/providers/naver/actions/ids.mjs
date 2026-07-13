/**
 * Validates and normalizes canonical Naver blog, cafe, post, comment, and draft references.
 * @module naver/actions/ids
 */
 
const BLOG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOG_NO_RE = /^\d{1,32}$/;
const ARTICLE_ID_RE = /^\d{1,32}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const BLOG_HOSTS = ['blog.naver.com'];
const CAFE_HOSTS = ['cafe.naver.com'];

function parseOwnedUrl(value, allowedHosts) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, `https://${allowedHosts[0]}`);
    if (
      url.protocol !== 'https:'
      || !allowedHosts.includes(url.hostname)
      || url.username
      || url.password
      || url.port
    ) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Error raised when a Naver reference fails validation.
 * @extends Error
 */
 
export class InvalidNaverRefError extends Error {
  constructor(kind, ref) {
    super(`Invalid Naver ${kind} reference: ${JSON.stringify(ref)}`);
    this.name = 'InvalidNaverRefError';
    this.code = `invalid-naver-${kind}-ref`;
    this.ref = ref;
  }
}

export function normalizeBlogRef(ref) {
  const suppliedId = ref && typeof ref === 'object' && ref.blogId != null
    ? String(ref.blogId)
    : typeof ref === 'string' && !ref.includes('://') && !ref.includes('/')
      ? ref
      : null;
  const rawUrl = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.url || ref.href
      : null;
  const url = parseOwnedUrl(rawUrl, BLOG_HOSTS);
  const match = url?.pathname.match(/^\/([A-Za-z0-9_-]{1,64})\/?$/);
  const blogId = suppliedId || match?.[1];
  if (!blogId || !BLOG_ID_RE.test(blogId) || (suppliedId && match?.[1] && suppliedId !== match[1])) return null;
  if (rawUrl != null && !match) return null;
  return { blogId, url: `https://blog.naver.com/${blogId}` };
}

export function assertBlogRef(ref) {
  const value = normalizeBlogRef(ref);
  if (!value) throw new InvalidNaverRefError('blog', ref);
  return value;
}

export function normalizeBlogPostRef(ref) {
  const suppliedBlogId = ref && typeof ref === 'object' && ref.blogId != null ? String(ref.blogId) : null;
  const suppliedLogNo = ref && typeof ref === 'object' && ref.logNo != null ? String(ref.logNo) : null;
  const rawUrl = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.url || ref.href
      : null;
  const url = parseOwnedUrl(rawUrl, BLOG_HOSTS);
  const match = url?.pathname.match(/^\/([A-Za-z0-9_-]{1,64})\/(\d{1,32})\/?$/);
  const blogId = suppliedBlogId || match?.[1];
  const logNo = suppliedLogNo || match?.[2];
  if (!blogId || !BLOG_ID_RE.test(blogId) || !logNo || !LOG_NO_RE.test(logNo)) return null;
  if (suppliedBlogId && match?.[1] && suppliedBlogId !== match[1]) return null;
  if (suppliedLogNo && match?.[2] && suppliedLogNo !== match[2]) return null;
  if (rawUrl != null && !match) return null;
  return { blogId, logNo, url: `https://blog.naver.com/${blogId}/${logNo}` };
}

export function assertBlogPostRef(ref) {
  const value = normalizeBlogPostRef(ref);
  if (!value) throw new InvalidNaverRefError('blog-post', ref);
  return value;
}

export function normalizeBlogCommentRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const commentId = String(ref.commentId ?? '');
  const post = normalizeBlogPostRef(ref);
  return OPAQUE_ID_RE.test(commentId) && post ? { ...post, commentId } : null;
}

export function assertBlogCommentRef(ref) {
  const value = normalizeBlogCommentRef(ref);
  if (!value) throw new InvalidNaverRefError('blog-comment', ref);
  return value;
}

export function normalizeDraftRef(ref) {
  const draftId = ref && typeof ref === 'object' ? String(ref.draftId ?? '') : String(ref ?? '');
  return OPAQUE_ID_RE.test(draftId) ? { draftId } : null;
}

export function assertDraftRef(ref) {
  const value = normalizeDraftRef(ref);
  if (!value) throw new InvalidNaverRefError('draft', ref);
  return value;
}

export function normalizeCafeRef(ref) {
  const suppliedId = ref && typeof ref === 'object' && ref.cafeId != null
    ? String(ref.cafeId)
    : typeof ref === 'string' && !ref.includes('://') && !ref.includes('/')
      ? ref
      : null;
  const rawUrl = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.url || ref.href
      : null;
  const url = parseOwnedUrl(rawUrl, CAFE_HOSTS);
  const match = url?.pathname.match(/^\/([A-Za-z0-9_-]{1,64})\/?$/);
  const cafeId = suppliedId || match?.[1];
  if (!cafeId || !CAFE_ID_RE.test(cafeId) || (suppliedId && match?.[1] && suppliedId !== match[1])) return null;
  if (rawUrl != null && !match) return null;
  return { cafeId, url: `https://cafe.naver.com/${cafeId}` };
}

export function assertCafeRef(ref) {
  const value = normalizeCafeRef(ref);
  if (!value) throw new InvalidNaverRefError('cafe', ref);
  return value;
}

export function normalizeCafePostRef(ref) {
  const suppliedCafeId = ref && typeof ref === 'object' && ref.cafeId != null ? String(ref.cafeId) : null;
  const suppliedArticleId = ref && typeof ref === 'object' && ref.articleId != null ? String(ref.articleId) : null;
  const rawUrl = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.url || ref.href
      : null;
  const url = parseOwnedUrl(rawUrl, CAFE_HOSTS);
  const match = url?.pathname.match(/^\/([A-Za-z0-9_-]{1,64})\/(\d{1,32})\/?$/);
  const cafeId = suppliedCafeId || match?.[1];
  const articleId = suppliedArticleId || match?.[2];
  if (!cafeId || !CAFE_ID_RE.test(cafeId) || !articleId || !ARTICLE_ID_RE.test(articleId)) return null;
  if (suppliedCafeId && match?.[1] && suppliedCafeId !== match[1]) return null;
  if (suppliedArticleId && match?.[2] && suppliedArticleId !== match[2]) return null;
  if (rawUrl != null && !match) return null;
  return { cafeId, articleId, url: `https://cafe.naver.com/${cafeId}/${articleId}` };
}

export function assertCafePostRef(ref) {
  const value = normalizeCafePostRef(ref);
  if (!value) throw new InvalidNaverRefError('cafe-post', ref);
  return value;
}

export function normalizeCafeCommentRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const commentId = String(ref.commentId ?? '');
  const post = normalizeCafePostRef(ref);
  return OPAQUE_ID_RE.test(commentId) && post ? { ...post, commentId } : null;
}

export function assertCafeCommentRef(ref) {
  const value = normalizeCafeCommentRef(ref);
  if (!value) throw new InvalidNaverRefError('cafe-comment', ref);
  return value;
}
