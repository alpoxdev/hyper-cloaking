// Reddit user profile lookup (read).

import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';
import { normalizeCommentRef, normalizePostRef, normalizeRedditUser, userUrl } from './ids.mjs';
import { executeRedditRead } from '../network.mjs';

function normalizeUserContent(value, { user, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.activity) || value.activity.length > 400) {
    throw new TypeError('Reddit user content must contain at most 400 activity entries');
  }
  if (value.activity.length === 0 && value.emptyState !== true) {
    throw new TypeError('Reddit empty user activity requires explicit empty-state evidence');
  }
  const seen = new Set();
  const activity = [];
  for (const entry of value.activity) {
    if (!entry || typeof entry !== 'object') throw new TypeError('Reddit activity entries must be objects');
    const ref = activityRef(entry);
    if (!ref) throw new TypeError('Reddit activity entry contains an invalid post or comment reference');
    const key = ref.commentId ? `comment:${ref.commentId}` : `post:${ref.postId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    activity.push({
      ...ref,
      text: entry.text == null ? null : String(entry.text),
      score: Number.isFinite(entry.score) ? entry.score : parseScore(entry.score),
      commentCount: entry.commentCount == null
        ? null
        : Number.isFinite(entry.commentCount) ? entry.commentCount : parseCommentCount(entry.commentCount),
      timestamp: entry.timestamp == null ? null : String(entry.timestamp)
    });
    if (activity.length >= limit) break;
  }
  if (activity.length === 0 && value.emptyState !== true) {
    throw new TypeError('Reddit normalized empty user activity requires explicit empty-state evidence');
  }
  return {
    username: user,
    displayName: value.displayName == null ? null : String(value.displayName),
    karma: value.karma == null ? null : String(value.karma),
    about: value.about == null ? null : String(value.about),
    activity
  };
}

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
  const limit = Math.min(positiveLimit(opts.limit, 25), 100);
  const url = userUrl(user);
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
        displayName: text(selectors.displayName),
        karma: text(selectors.karma),
        about: text(selectors.header),
        activity: selectors.activityItem
          ? [...document.querySelectorAll(selectors.activityItem)].slice(0, 400).map((node) => {
            const link = node.querySelector(selectors.extraction.activityPermalink);
            const time = node.querySelector(selectors.extraction.time);
            return {
              href: link?.getAttribute('href') || null,
              text: nodeText(node),
              score: nodeText(node.querySelector(selectors.extraction.activityScore)),
              commentCount: nodeText(node.querySelector(selectors.extraction.activityPermalink)),
              timestamp: time?.getAttribute('datetime') || time?.textContent?.trim() || null
            };
          })
          : [],
        emptyState: selectors.activityItem === null
      };
    }, { displayName, karma, header, activityItem, extraction });
    return data;
  };
  const { value } = await executeRedditRead({
    action: 'getUserProfile',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeUserContent(content, {
      user,
      limit
    })
  });
  return wrapReadPayload({
    url,
    content: value,
    kind: 'reddit-user-profile'
  });
}
