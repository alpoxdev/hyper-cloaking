// YouTube provider session wrapper.

import {
  buildProviderSession,
  OffOriginError,
  ChallengeBlockedError,
  TargetSafetyError
} from '../session.mjs';
import { youtubeProvider } from './metadata.mjs';

export { OffOriginError, ChallengeBlockedError, TargetSafetyError };

/**
 * Builds a guarded YouTube session around a Playwright `page`.
 *
 * @param {object} page Playwright page (JS-driver lane).
 * @param {object} [opts]
 * @returns {object} Session handle.
 */
export function buildYouTubeSession(page, opts = {}) {
  return buildProviderSession(page, {
    ...opts,
    provider: youtubeProvider
  });
}
