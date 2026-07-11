// TikTok provider session wrapper.

import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { tiktokProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

export function buildTikTokSession(page, opts = {}) {
  const session = buildProviderSession(page, {
    ...opts,
    provider: tiktokProvider
  });
  session.accountId = opts.accountId == null ? null : String(opts.accountId);
  return session;
}
