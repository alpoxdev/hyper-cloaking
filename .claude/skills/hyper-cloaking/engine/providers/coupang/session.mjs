// Coupang provider session wrapper.

import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { coupangProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

export function buildCoupangSession(page, opts = {}) {
  return buildProviderSession(page, {
    ...opts,
    provider: coupangProvider
  });
}
