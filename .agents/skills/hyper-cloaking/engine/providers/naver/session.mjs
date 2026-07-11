// Naver provider session wrapper.

import {
  buildProviderSession,
  ChallengeBlockedError,
  OffOriginError,
  TargetSafetyError
} from '../session.mjs';
import { naverProvider } from './metadata.mjs';

export { ChallengeBlockedError, OffOriginError, TargetSafetyError };

/** Builds a guarded Naver session around a Playwright page. */
export function buildNaverSession(page, opts = {}) {
  return buildProviderSession(page, {
    ...opts,
    provider: naverProvider
  });
}
