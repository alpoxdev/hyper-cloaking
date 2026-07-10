// Instagram profile lookup (read).

import { instagramSelectors } from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';

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
  const raw = String(username ?? '').trim().replace(/^@/, '');
  return USERNAME_RE.test(raw) ? raw : null;
}

export function profileUrl(username) {
  const u = normalizeUsername(username);
  if (!u) throw new InvalidUsernameError(username);
  return `https://www.instagram.com/${u}/`;
}

/**
 * Looks up a user's public profile header (read).
 *
 * @param {object} session Instagram session (JS-driver lane).
 * @param {string} username
 * @returns {Promise<object>} Untrusted-wrapped profile payload.
 */
export async function getUser(session, username) {
  const url = profileUrl(username);
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.requireInstagramOrigin();

  const bodyText = await session.page.evaluate(() => document.body?.innerText || '').catch(() => '');
  session.throwOnChallenge({ text: bodyText });

  const data = await session.page.evaluate((sel) => {
    const pick = (s) => document.querySelector(s);
    const text = (el) => (el && el.textContent ? el.textContent.trim() : null);
    const header = pick(sel.header);
    const stats = header ? [...header.querySelectorAll('li')].map((li) => (li.textContent || '').trim()) : [];
    return {
      displayName: text(pick(sel.displayName)),
      stats,
      verified: Boolean(pick(sel.verifiedBadge)),
      private: /This account is private/i.test(document.body?.innerText || '')
    };
  }, instagramSelectors.profile).catch(() => ({ displayName: null, stats: [], verified: false, private: false }));

  const profile = {
    username: normalizeUsername(username),
    url,
    displayName: data.displayName,
    verified: data.verified,
    private: data.private,
    rawStats: data.stats
  };
  return wrapReadPayload({ url, content: profile, kind: 'instagram-profile' });
}
