// X provider session wrapper.

/**
 * X provider session construction with origin, challenge, and target-safety guards.
 * The wrapper also normalizes the optional account identifier.
 */
import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { xProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

/**
 * Build a provider-bound X session for a browser page.
 * @param {object} page Browser page/session target.
 * @param {object} [opts] Session options, including optional accountId.
 * @returns {object} Provider session with normalized accountId.
 */
export function buildXSession(page, opts = {}) {
  const session = buildProviderSession(page, {
    ...opts,
    provider: xProvider
  });
  session.accountId = opts.accountId == null ? null : String(opts.accountId);
  return session;
}
