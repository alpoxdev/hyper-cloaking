// Reddit post lookup (read).

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';
import { assertPostRef, normalizeCommentRef } from './ids.mjs';
import { executeRedditRead } from '../network.mjs';

function normalizePostContent(value, { post, includeComments, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.comments) || value.comments.length > 400) {
    throw new TypeError('Reddit post content must contain at most 400 comments');
  }
  if (includeComments && value.comments.length === 0 && value.commentsEmptyState !== true) {
    throw new TypeError('Reddit empty comment content requires explicit empty-state evidence');
  }
  const seen = new Set();
  const comments = [];
  if (includeComments) {
    for (const entry of value.comments) {
      if (!entry || typeof entry !== 'object') throw new TypeError('Reddit comment entries must be objects');
      const ref = normalizeCommentRef(entry);
      if (!ref || ref.postId !== post.postId || ref.subreddit !== post.subreddit) {
        throw new TypeError('Reddit comments must belong to the requested post');
      }
      if (seen.has(ref.commentId)) continue;
      seen.add(ref.commentId);
      comments.push({
        ...ref,
        author: entry.author == null ? null : String(entry.author),
        text: entry.text == null ? null : String(entry.text),
        timestamp: entry.timestamp == null ? null : String(entry.timestamp)
      });
      if (comments.length >= limit) break;
    }
  }
  return {
    ...post,
    title: value.title == null ? null : String(value.title),
    score: Number.isFinite(value.score) ? value.score : parseScore(value.score),
    author: value.author == null ? null : String(value.author),
    timestamp: value.timestamp == null ? null : String(value.timestamp),
    text: value.text == null ? null : String(value.text),
    comments
  };
}

const positiveLimit = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback;

function parseScore(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([km])?/i);
  if (!match) return 0;
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  const score = Number(match[1]) * multiplier;
  return Number.isFinite(score) ? score : 0;
}

function commentRefFromHref(href) {
  return normalizeCommentRef(href);
}

/** Gets a post and, optionally, its visible comments. Returned text is untrusted. */
export async function getPost(session, postRef, opts = {}) {
  const post = assertPostRef(postRef);
  const includeComments = opts.comments !== false;
  const limit = Math.min(positiveLimit(opts.commentLimit, positiveLimit(opts.comments, 100)), 100);
  const dom = async () => {
    await session.navigateGuardedForRead(post.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const title = await resolveRedditSelector(session.page, redditSelectors.post.title);
    const score = await resolveRedditSelector(session.page, redditSelectors.post.score);
    const author = await resolveRedditSelector(session.page, redditSelectors.post.author);
    const article = await resolveRedditSelector(session.page, redditSelectors.post.article);
    const data = await session.page.evaluate((selectors) => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
      return {
        title: text(selectors.title),
        score: text(selectors.score),
        author: text(selectors.author),
        body: text(selectors.article)
      };
    }, { title, score, author, article });

    let visibleComments = [];
    let commentsEmptyState = false;
    if (includeComments) {
      const comment = await resolveRedditSelector(session.page, redditSelectors.post.comment, {
        emptyState: redditSelectors.post.emptyComments,
        surface: 'post comments'
      });
      commentsEmptyState = comment === null;
      const extraction = {
        ...redditSelectors.post.extraction,
        commentBody: comment ? await resolveRedditSelector(session.page, redditSelectors.post.extraction.commentBody) : null
      };
      visibleComments = comment ? await session.page.evaluate((selectors) => [...document.querySelectorAll(selectors.comment)].slice(0, 400).map((node) => {
        const hrefs = [...node.querySelectorAll(selectors.extraction.commentPermalink)]
          .map((link) => link.getAttribute('href'));
        const time = node.querySelector(selectors.extraction.time);
        return {
          hrefs,
          author: node.querySelector(selectors.extraction.commentAuthor)?.textContent?.trim() || null,
          text: node.querySelector(selectors.extraction.commentBody)?.textContent?.trim() || node.textContent?.trim() || null,
          timestamp: time?.getAttribute('datetime') || time?.textContent?.trim() || null
        };
      }), { comment, extraction }) : [];
    }

    const comments = [];
    for (const raw of visibleComments) {
      const href = raw.hrefs.find((candidate) => commentRefFromHref(candidate));
      const ref = commentRefFromHref(href);
      if (!ref) continue;
      comments.push({ ...ref, author: raw.author, text: raw.text, timestamp: raw.timestamp });
    }
    return {
      ...post,
      title: data.title,
      score: parseScore(data.score),
      author: data.author,
      timestamp: null,
      text: data.body,
      comments,
      commentsEmptyState,
    };
  };
  const { value } = await executeRedditRead({
    action: 'getPost',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizePostContent(content, {
      post,
      includeComments,
      limit
    })
  });
  return wrapReadPayload({
    url: post.url,
    content: value,
    kind: 'reddit-post'
  });
}
