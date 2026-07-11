// Reddit provider session wrapper.

import {
  buildProviderSession,
  OffOriginError,
  ChallengeBlockedError,
  TargetSafetyError
} from '../session.mjs';
import { redditProvider } from './metadata.mjs';

export { OffOriginError, ChallengeBlockedError, TargetSafetyError };

/** Builds a guarded Reddit session around a Playwright page. */
export function buildRedditSession(page, opts = {}) {
  return buildProviderSession(page, {
    ...opts,
    provider: redditProvider
  });
}
