// X provider session wrapper.

import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { xProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

export function buildXSession(page, opts = {}) {
  const session = buildProviderSession(page, {
    ...opts,
    provider: xProvider
  });
  session.accountId = opts.accountId == null ? null : String(opts.accountId);
  return session;
}
