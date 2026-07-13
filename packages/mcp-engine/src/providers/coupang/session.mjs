/**
 * Coupang session contract: binds a page to provider origin and safety policy.
 * Operations return guarded results or throw exported safety errors.
 */
// Coupang provider session wrapper.

import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { coupangProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

/**
 * Build a provider-bound Coupang session.
 *
 * @param {import('playwright').Page} page Browser page to guard.
 * @param {object} [opts] Options forwarded to the provider wrapper.
 * @returns {object} Guarded provider session.
 * @throws {OffOriginError} When navigation leaves an allowed origin.
 * @throws {ChallengeBlockedError} When a challenge blocks safe progress.
 * @throws {TargetSafetyError} When an operation is disallowed.
 */
export function buildCoupangSession(page, opts = {}) {
  return buildProviderSession(page, {
    ...opts,
    provider: coupangProvider
  });
}
