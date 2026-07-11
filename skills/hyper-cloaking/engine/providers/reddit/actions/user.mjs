// Reddit user profile lookup (read).

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';
import { normalizeCommentRef, normalizePostRef, normalizeRedditUser, userUrl } from './ids.mjs';

const positiveLimit = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback;

function activityRef(href) {
  return normalizeCommentRef(href) || normalizePostRef(href);
}

function parseScore(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([km])?/i);
  if (!match) return 0;
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  const score = Number(match[1]) * multiplier;
  return Number.isFinite(score) ? score : 0;
}
function parseCommentCount(value) {
  return /\d/.test(String(value ?? '')) ? parseScore(value) : null;
}

/** Gets a Reddit user's public profile and visible activity. Returned text is untrusted. */
export async function getUserProfile(session, username, opts = {}) {
  const user = normalizeRedditUser(username);
  const limit = positiveLimit(opts.limit, 25);
  const url = userUrl(user);

  await session.navigateGuarded(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const displayName = await resolveRedditSelector(session.page, redditSelectors.user.name);
  const karma = await resolveRedditSelector(session.page, redditSelectors.user.karma);
  const header = await resolveRedditSelector(session.page, redditSelectors.user.header);
  const activityItem = await resolveRedditSelector(session.page, redditSelectors.user.activityItem, {
    emptyState: redditSelectors.user.emptyActivity,
    surface: 'profile activity'
  });
  const extraction = {
    ...redditSelectors.user.extraction,
    activityScore: activityItem ? await resolveRedditSelector(session.page, redditSelectors.user.extraction.activityScore) : null
  };
  const data = await session.page.evaluate((selectors) => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
    const nodeText = (node) => node?.textContent?.trim() || null;
    return {
      displayName: text(selectors.displayName), karma: text(selectors.karma), about: text(selectors.header),
      activity: selectors.activityItem ? [...document.querySelectorAll(selectors.activityItem)].map((node) => {
        const link = node.querySelector(selectors.extraction.activityPermalink);
        const time = node.querySelector(selectors.extraction.time);
        return {
          href: link?.getAttribute('href') || null,
          text: nodeText(node),
          score: nodeText(node.querySelector(selectors.extraction.activityScore)),
          commentCount: nodeText(node.querySelector(selectors.extraction.activityPermalink)),
          timestamp: time?.getAttribute('datetime') || time?.textContent?.trim() || null
        };
      }) : []
    };
  }, { displayName, karma, header, activityItem, extraction });

  const seen = new Set();
  const activity = [];
  for (const item of data.activity) {
    const ref = activityRef(item.href);
    const key = ref?.commentId || ref?.postId;
    if (!ref || seen.has(key)) continue;
    seen.add(key);
    activity.push({
      ...ref,
      text: item.text,
      score: parseScore(item.score),
      commentCount: parseCommentCount(item.commentCount),
      timestamp: item.timestamp
    });
    if (activity.length === limit) break;
  }

  return wrapReadPayload({ url, content: { username: user, displayName: data.displayName, karma: data.karma, about: data.about, activity }, kind: 'reddit-user-profile' });
}
