// Instagram session compatibility wrapper.

import {
  buildProviderSession,
  OffOriginError,
  ChallengeBlockedError,
  TargetSafetyError
} from '../session.mjs';
import { instagramProvider } from './metadata.mjs';

export { OffOriginError, ChallengeBlockedError, TargetSafetyError };

/**
 * Builds a guarded Instagram session around a Playwright `page`.
 *
 * @param {object} page Playwright page (JS-driver lane).
 * @param {object} [opts]
 * @returns {object} Session handle.
 */
export function buildInstagramSession(page, opts = {}) {
  const session = buildProviderSession(page, {
    ...opts,
    provider: instagramProvider
  });

  session.requireInstagramOrigin = (url = session.currentUrl()) => session.requireOnOrigin(url);
  return session;
}
