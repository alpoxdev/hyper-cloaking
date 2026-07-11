// Reddit post lookup (read).

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';
import { assertPostRef, normalizeCommentRef } from './ids.mjs';

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
  const limit = positiveLimit(opts.commentLimit, positiveLimit(opts.comments, 100));

  await session.navigateGuarded(post.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const title = await resolveRedditSelector(session.page, redditSelectors.post.title);
  const score = await resolveRedditSelector(session.page, redditSelectors.post.score);
  const author = await resolveRedditSelector(session.page, redditSelectors.post.author);
  const article = await resolveRedditSelector(session.page, redditSelectors.post.article);
  const data = await session.page.evaluate((selectors) => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
    return {
      title: text(selectors.title), score: text(selectors.score), author: text(selectors.author),
      body: text(selectors.article)
    };
  }, { title, score, author, article });

  let visibleComments = [];
  if (includeComments) {
    const comment = await resolveRedditSelector(session.page, redditSelectors.post.comment, {
      emptyState: redditSelectors.post.emptyComments,
      surface: 'post comments'
    });
    const extraction = {
      ...redditSelectors.post.extraction,
      commentBody: comment ? await resolveRedditSelector(session.page, redditSelectors.post.extraction.commentBody) : null
    };
    visibleComments = comment ? await session.page.evaluate((selectors) => [...document.querySelectorAll(selectors.comment)].map((node) => {
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

  const seen = new Set();
  const commentHandles = [];
  for (const raw of visibleComments) {
    const href = raw.hrefs.find((candidate) => commentRefFromHref(candidate));
    const ref = commentRefFromHref(href);
    if (!ref || seen.has(ref.commentId)) continue;
    seen.add(ref.commentId);
    commentHandles.push({ ...ref, author: raw.author, text: raw.text, timestamp: raw.timestamp });
    if (commentHandles.length === limit) break;
  }

  return wrapReadPayload({
    url: post.url,
    content: { ...post, title: data.title, score: parseScore(data.score), author: data.author, timestamp: null, text: data.body, comments: commentHandles },
    kind: 'reddit-post'
  });
}
