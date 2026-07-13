// TikTok provider session wrapper.

import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { tiktokProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

/**
 * Build a TikTok provider session bound to the supplied page.
 *
 * The returned session applies TikTok origin and safety checks. `accountId`
 * is normalized to a string (or `null`); navigation, challenge, and target
 * violations surface as the re-exported typed errors. Session construction
 * preserves provider errors rather than converting them into success-like
 * results; callers must handle challenge and off-origin failures before
 * reading or writing.
 */
export function buildTikTokSession(page, opts = {}) {
  const session = buildProviderSession(page, {
    ...opts,
    provider: tiktokProvider
  });
  session.accountId = opts.accountId == null ? null : String(opts.accountId);
  return session;
}
