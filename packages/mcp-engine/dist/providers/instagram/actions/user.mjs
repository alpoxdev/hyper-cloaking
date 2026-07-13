/**
 * Instagram profile read actions.
 *
 * Inputs are normalized usernames (optional leading `@`); reads navigate to the
 * canonical profile URL and return a wrapped, bounded profile snapshot. Invalid
 * usernames throw/return validation errors before network access. The read lane
 * may perform browser navigation and state observation, but does not mutate the
 * account; navigation, selector drift, and unproven profile state surface as
 * errors.
 */

import { instagramSelectors } from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { executeInstagramRead } from '../network.mjs';

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

export class InvalidUsernameError extends Error {
  constructor(username) {
    super(`Invalid Instagram username: ${JSON.stringify(username)}`);
    this.name = 'InvalidUsernameError';
    this.code = 'invalid-username';
    this.username = username;
  }
}

export function normalizeUsername(username) {
  const raw = String(username ?? '')
    .trim()
    .replace(/^@/, '');
  return USERNAME_RE.test(raw) ? raw : null;
}

export function profileUrl(username) {
  const u = normalizeUsername(username);
  if (!u) throw new InvalidUsernameError(username);
  return `https://www.instagram.com/${u}/`;
}

function boundedText(value, field, maxLength, { nullable = true } = {}) {
  if (value == null && nullable) return null;
  const text = String(value);
  if (text.length > maxLength)
    throw new TypeError(`Instagram ${field} exceeds ${maxLength} characters`);
  return text;
}

function normalizeProfileContent(value, { username, url }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Instagram profile content must be an object');
  }
  if (!Array.isArray(value.rawStats) || value.rawStats.length > 100) {
    throw new TypeError('Instagram profile rawStats must be a bounded array');
  }
  return {
    username,
    url,
    displayName: boundedText(value.displayName, 'displayName', 300),
    verified: value.verified === true,
    private: value.private === true,
    rawStats: value.rawStats.map((entry) =>
      boundedText(entry, 'profile statistic', 1_000, { nullable: false })
    )
  };
}

/**
 * Looks up a user's public profile header (read).
 *
 * @param {object} session Instagram session (JS-driver lane).
 * @param {string} username
 * @returns {Promise<object>} Untrusted-wrapped profile payload.
 */
export async function getUser(session, username, opts = {}) {
  const normalizedUsername = normalizeUsername(username);
  const url = profileUrl(username);
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const data = await session.page.evaluate((sel) => {
      const pick = (selector) => document.querySelector(selector);
      const text = (element) => (element?.textContent ? element.textContent.trim() : null);
      const header = pick(sel.header);
      const stats = header
        ? [...header.querySelectorAll('li')].map((item) => (item.textContent || '').trim())
        : [];
      return {
        displayName: text(pick(sel.displayName)),
        stats,
        verified: Boolean(pick(sel.verifiedBadge)),
        private: /This account is private/i.test(document.body?.innerText || ''),
        present: Boolean(header)
      };
    }, instagramSelectors.profile);
    if (!data.present) throw new Error('Instagram profile state could not be proven');
    return {
      displayName: data.displayName,
      verified: data.verified,
      private: data.private,
      rawStats: data.stats
    };
  };
  const { value } = await executeInstagramRead({
    action: 'getUser',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) =>
      normalizeProfileContent(content, {
        username: normalizedUsername,
        url
      })
  });
  return wrapReadPayload({ url, content: value, kind: 'instagram-profile' });
}
