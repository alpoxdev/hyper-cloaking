/**
 * Naver read actions: guarded search and post/list extraction with bounded output.
 * @module naver/actions/reads
 */

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { executeNaverRead } from '../network.mjs';
import { naverSelectors } from '../selectors.mjs';
import {
  assertBlogRef,
  assertCafeRef,
  assertBlogPostRef,
  assertCafePostRef,
  normalizeBlogPostRef,
  normalizeCafePostRef
} from './ids.mjs';

const DEFAULT_LIMIT = 20;
const MAX_OUTPUT = 100;
const MAX_RAW = 400;

function limitFor(value, fallback = DEFAULT_LIMIT) {
  return Math.min(Number.isInteger(value) && value > 0 ? value : fallback, MAX_OUTPUT);
}

function boundedText(value, field, maximum) {
  if (value == null) return null;
  const text = String(value).normalize('NFKC').trim();
  if (text.length > maximum) throw new TypeError(`Naver ${field} exceeds ${maximum} characters`);
  return text || null;
}

function numberOrNull(value) {
  if (Number.isFinite(value)) return Number(value);
  const text = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function readOptions(opts, action, dom, normalize) {
  return executeNaverRead({
    action,
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize
  });
}

async function optionalText(session, selector) {
  const control = session.page.locator(selector);
  if ((await control.count()) === 0) return null;
  const text = await control.first().textContent();
  return text?.trim() || null;
}

function normalizeSearchResults(value, { kind, query, limit, refNormalizer }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.results) ||
    value.results.length > MAX_RAW
  ) {
    throw new TypeError(`Naver ${kind} search content must contain at most ${MAX_RAW} results`);
  }
  const seen = new Set();
  const results = [];
  for (const entry of value.results) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`Naver ${kind} search entries must be objects`);
    }
    let url = null;
    let ref = null;
    if (refNormalizer) {
      ref = refNormalizer(entry);
      if (!ref)
        throw new TypeError(
          `Naver ${kind} search entry contains an invalid owned-origin reference`
        );
      url = ref.url;
    } else {
      try {
        const parsed = new URL(String(entry.url ?? ''));
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
          throw new Error('unsupported protocol');
        url = parsed.href;
      } catch {
        throw new TypeError(`Naver ${kind} search entry contains an invalid URL`);
      }
    }
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      ...(ref || {}),
      url,
      title: boundedText(entry.title, `${kind} search title`, 2_000),
      snippet: boundedText(entry.snippet, `${kind} search snippet`, 4_000)
    });
    if (results.length >= limit) break;
  }
  if (results.length === 0 && value.emptyState !== true) {
    throw new TypeError(
      `Naver empty ${kind} search content requires explicit empty-state evidence`
    );
  }
  return { query, count: results.length, results };
}

async function extractSearchLinks(session, selector) {
  return session.page.$$eval(selector, (nodes) =>
    nodes.slice(0, 400).map((node) => ({
      url: node.getAttribute('href'),
      title: node.getAttribute('aria-label') || node.textContent?.trim() || null,
      snippet:
        node
          .closest('li, div')
          ?.querySelector('.dsc, .api_txt_lines:not(.total_tit)')
          ?.textContent?.trim() || null
    }))
  );
}

async function search(session, { kind, query, url, selectors, limit, refNormalizer }, opts) {
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const results = await extractSearchLinks(session, selectors.link);
    if (results.length === 0 && (await session.page.locator(selectors.emptyState).count()) === 0) {
      throw new Error(`Naver ${kind} search state could not be proven`);
    }
    return { results, emptyState: results.length === 0 };
  };
  const { value } = await readOptions(
    opts,
    `search${kind[0].toUpperCase()}${kind.slice(1)}`,
    dom,
    (content) => normalizeSearchResults(content, { kind, query, limit, refNormalizer })
  );
  return wrapReadPayload({ url, kind: `naver-${kind}-search`, content: value });
}

/** Search Naver's web index and return bounded, normalized results. */

export async function searchWeb(session, query, opts = {}) {
  const searchQuery = String(query ?? '').trim();
  if (!searchQuery || searchQuery.length > 500)
    throw new TypeError('Naver search query must contain 1-500 characters');
  const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(searchQuery)}`;
  return search(
    session,
    {
      kind: 'web',
      query: searchQuery,
      url,
      selectors: naverSelectors.search.web,
      limit: limitFor(opts.limit)
    },
    opts
  );
}

/** Search Naver blog posts and return canonical owned references. */

export async function searchBlog(session, query, opts = {}) {
  const searchQuery = String(query ?? '').trim();
  if (!searchQuery || searchQuery.length > 500)
    throw new TypeError('Naver search query must contain 1-500 characters');
  const url = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(searchQuery)}`;
  return search(
    session,
    {
      kind: 'blog',
      query: searchQuery,
      url,
      selectors: naverSelectors.search.blog,
      limit: limitFor(opts.limit),
      refNormalizer: normalizeBlogPostRef
    },
    opts
  );
}

/** Search Naver cafe articles and return canonical owned references. */

export async function searchCafe(session, query, opts = {}) {
  const searchQuery = String(query ?? '').trim();
  if (!searchQuery || searchQuery.length > 500)
    throw new TypeError('Naver search query must contain 1-500 characters');
  const url = `https://search.naver.com/search.naver?where=article&query=${encodeURIComponent(searchQuery)}`;
  return search(
    session,
    {
      kind: 'cafe',
      query: searchQuery,
      url,
      selectors: naverSelectors.search.cafe,
      limit: limitFor(opts.limit),
      refNormalizer: normalizeCafePostRef
    },
    opts
  );
}

function normalizePostContent(value, { post, kind, includeComments, limit }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.comments) ||
    value.comments.length > MAX_RAW
  ) {
    throw new TypeError(`Naver ${kind} content must contain at most ${MAX_RAW} comments`);
  }
  if (value.present !== true) {
    throw new TypeError(`Naver ${kind} content requires explicit presence evidence`);
  }
  if (includeComments && value.comments.length === 0 && value.commentsEmptyState !== true) {
    throw new TypeError(`Naver empty ${kind} comments require explicit empty-state evidence`);
  }
  const comments = includeComments
    ? value.comments
        .slice(0, limit)
        .map((comment) => boundedText(comment, `${kind} comment`, 10_000))
        .filter(Boolean)
    : [];
  return {
    ...post,
    title: boundedText(value.title, `${kind} title`, 2_000),
    body: boundedText(value.body, `${kind} body`, 100_000),
    author: boundedText(value.author, `${kind} author`, 500),
    timestamp: boundedText(value.timestamp, `${kind} timestamp`, 100),
    commentCount: numberOrNull(value.commentCount),
    comments
  };
}

/** Read one Naver blog post, optionally including comments. */

export async function getBlogPost(session, blogPostRef, opts = {}) {
  const post = assertBlogPostRef(blogPostRef);
  const includeComments = opts.comments !== false;
  const limit = limitFor(opts.commentLimit);
  const dom = async () => {
    await session.navigateGuardedForRead(post.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const title = await session.page.locator(naverSelectors.blog.postTitle).first().textContent();
    if (!title?.trim()) throw new Error('Naver blog post state could not be proven');
    const body = await session.page.locator(naverSelectors.blog.postBody).first().textContent();
    const author = await session.page.locator(naverSelectors.blog.author).first().textContent();
    const timestamp = await optionalText(session, naverSelectors.blog.timestamp);
    const commentCount = await optionalText(session, naverSelectors.blog.commentCount);
    let comments = [];
    let commentsEmptyState = !includeComments;
    if (includeComments) {
      comments = await session.page.$$eval(naverSelectors.blog.commentText, (nodes) =>
        nodes
          .slice(0, 400)
          .map((node) => node.textContent?.trim())
          .filter(Boolean)
      );
      commentsEmptyState =
        comments.length === 0 &&
        (await session.page.locator(naverSelectors.blog.commentEmptyState).count()) > 0;
      if (comments.length === 0 && !commentsEmptyState)
        throw new Error('Naver blog comment state could not be proven');
    }
    return {
      title,
      body,
      author,
      timestamp,
      commentCount,
      comments,
      commentsEmptyState,
      present: true
    };
  };
  const { value } = await readOptions(opts, 'getBlogPost', dom, (content) =>
    normalizePostContent(content, { post, kind: 'blog', includeComments, limit })
  );
  return wrapReadPayload({ url: post.url, kind: 'naver-blog-post', content: value });
}

/** Read one Naver cafe post, optionally including comments. */

export async function getCafePost(session, cafePostRef, opts = {}) {
  const post = assertCafePostRef(cafePostRef);
  const includeComments = opts.comments !== false;
  const limit = limitFor(opts.commentLimit);
  const dom = async () => {
    await session.navigateGuardedForRead(post.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const title = await session.page.locator(naverSelectors.cafe.postTitle).first().textContent();
    if (!title?.trim()) throw new Error('Naver cafe post state could not be proven');
    const body = await session.page.locator(naverSelectors.cafe.postBody).first().textContent();
    const author = await session.page.locator(naverSelectors.cafe.author).first().textContent();
    const timestamp = await optionalText(session, naverSelectors.cafe.timestamp);
    let comments = [];
    let commentsEmptyState = !includeComments;
    if (includeComments) {
      comments = await session.page.$$eval(naverSelectors.cafe.commentText, (nodes) =>
        nodes
          .slice(0, 400)
          .map((node) => node.textContent?.trim())
          .filter(Boolean)
      );
      commentsEmptyState =
        comments.length === 0 &&
        (await session.page.locator(naverSelectors.cafe.commentEmptyState).count()) > 0;
      if (comments.length === 0 && !commentsEmptyState)
        throw new Error('Naver cafe comment state could not be proven');
    }
    return {
      title,
      body,
      author,
      timestamp,
      commentCount: null,
      comments,
      commentsEmptyState,
      present: true
    };
  };
  const { value } = await readOptions(opts, 'getCafePost', dom, (content) =>
    normalizePostContent(content, { post, kind: 'cafe', includeComments, limit })
  );
  return wrapReadPayload({ url: post.url, kind: 'naver-cafe-post', content: value });
}

function normalizePostList(value, { owner, ownerKey, refNormalizer, limit }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.posts) ||
    value.posts.length > MAX_RAW
  ) {
    throw new TypeError(`Naver ${ownerKey} list content must contain at most ${MAX_RAW} posts`);
  }
  const seen = new Set();
  const posts = [];
  for (const entry of value.posts) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new TypeError(`Naver ${ownerKey} list entries must be objects`);
    const ref = refNormalizer(entry);
    if (!ref || ref[ownerKey] !== owner[ownerKey])
      throw new TypeError(`Naver ${ownerKey} list entry does not belong to the requested owner`);
    const key = ref.url;
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push({
      ...ref,
      title: boundedText(entry.title, `${ownerKey} list title`, 2_000),
      timestamp: boundedText(entry.timestamp, `${ownerKey} list timestamp`, 100)
    });
    if (posts.length >= limit) break;
  }
  if (posts.length === 0 && value.emptyState !== true) {
    throw new TypeError(
      `Naver empty ${ownerKey} list content requires explicit empty-state evidence`
    );
  }
  return { [ownerKey]: owner[ownerKey], count: posts.length, posts };
}

async function extractListLinks(session, selector) {
  return session.page.$$eval(selector, (nodes) =>
    nodes.slice(0, 400).map((node) => ({
      url: node.getAttribute('href'),
      title: node.textContent?.trim() || null
    }))
  );
}

/** Read a bounded list of posts belonging to a Naver blog. */

export async function getBlogList(session, blogRef, opts = {}) {
  const blog = assertBlogRef(blogRef);
  const limit = limitFor(opts.limit);
  const dom = async () => {
    await session.navigateGuardedForRead(blog.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const posts = await extractListLinks(session, naverSelectors.blog.listItem);
    if (
      posts.length === 0 &&
      (await session.page.locator(naverSelectors.blog.listEmptyState).count()) === 0
    ) {
      throw new Error('Naver blog list state could not be proven');
    }
    return { posts, emptyState: posts.length === 0 };
  };
  const { value } = await readOptions(opts, 'getBlogList', dom, (content) =>
    normalizePostList(content, {
      owner: blog,
      ownerKey: 'blogId',
      refNormalizer: normalizeBlogPostRef,
      limit
    })
  );
  return wrapReadPayload({ url: blog.url, kind: 'naver-blog-list', content: value });
}

/** Read a bounded list of posts belonging to a Naver cafe. */

export async function getCafeList(session, cafeRef, opts = {}) {
  const cafe = assertCafeRef(cafeRef);
  const limit = limitFor(opts.limit);
  const dom = async () => {
    await session.navigateGuardedForRead(cafe.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const posts = await extractListLinks(session, naverSelectors.cafe.listItem);
    if (
      posts.length === 0 &&
      (await session.page.locator(naverSelectors.cafe.listEmptyState).count()) === 0
    ) {
      throw new Error('Naver cafe list state could not be proven');
    }
    return { posts, emptyState: posts.length === 0 };
  };
  const { value } = await readOptions(opts, 'getCafeList', dom, (content) =>
    normalizePostList(content, {
      owner: cafe,
      ownerKey: 'cafeId',
      refNormalizer: normalizeCafePostRef,
      limit
    })
  );
  return wrapReadPayload({ url: cafe.url, kind: 'naver-cafe-list', content: value });
}
