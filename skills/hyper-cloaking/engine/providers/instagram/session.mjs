// Instagram action session: the single guarded entry every action goes through.
//
// It reuses existing engine primitives (recon-scope / target-safety /
// diagnostics) instead of re-deriving origin or challenge logic, binds the
// humanized input helpers to the page, and carries the runtime state dir used by
// the guardrails for persisted rate limits and bulk ledgers.
//
// These are JS-driver (`live` lane) helpers: they need a real Playwright `page`.
// In Playwright-MCP mode there is no `page` handle, so this session is not
// usable there.

import { isOriginApproved } from '../../recon-scope.mjs';
import { classifyChallengeObservation } from '../../diagnostics.mjs';
import { humanClick } from '../../mouse.mjs';
import { humanType } from '../../keyboard.mjs';
import { humanScroll } from '../../scroll.mjs';
import { instagramProvider } from './metadata.mjs';

export class OffOriginError extends Error {
  constructor(url, allowedOrigins) {
    super(`Refusing to act: "${url}" is not within Instagram allowed origins`);
    this.name = 'OffOriginError';
    this.code = 'off-origin';
    this.url = url;
    this.allowedOrigins = allowedOrigins;
  }
}

export class ChallengeBlockedError extends Error {
  constructor(labels) {
    super(`Challenge detected (${labels.join(', ')}); stopping automated interaction`);
    this.name = 'ChallengeBlockedError';
    this.code = 'challenge-blocked';
    this.labels = labels;
  }
}

/**
 * Builds a guarded Instagram session around a Playwright `page`.
 *
 * @param {object} page Playwright page (JS-driver lane).
 * @param {object} [opts]
 * @param {string[]} [opts.allowedOrigins] Override allowed origins (defaults to provider metadata).
 * @param {string} [opts.stateDir] Runtime workspace state dir for guardrail persistence.
 * @param {boolean} [opts.interactive] Whether an interactive confirmation surface exists.
 * @returns {object} Session handle.
 */
export function buildInstagramSession(page, opts = {}) {
  const allowedOrigins = Array.isArray(opts.allowedOrigins) && opts.allowedOrigins.length > 0
    ? opts.allowedOrigins
    : instagramProvider.domains.allowedOrigins;

  const session = {
    page,
    allowedOrigins,
    stateDir: opts.stateDir || null,
    interactive: opts.interactive === true,

    /** Current page URL, or '' if the page cannot report one. */
    currentUrl() {
      try {
        return typeof page?.url === 'function' ? page.url() : '';
      } catch {
        return '';
      }
    },

    /**
     * Asserts the given URL (defaults to the live page URL) is within Instagram
     * allowed origins. Throws OffOriginError otherwise. This is the origin gate
     * every action calls before touching the DOM.
     */
    requireInstagramOrigin(url = session.currentUrl()) {
      if (!isOriginApproved(url, allowedOrigins)) {
        throw new OffOriginError(url, allowedOrigins);
      }
      return url;
    },

    /**
     * Classifies an observation (page text, status, labels) for challenge
     * signals; when a blocker is detected it raises ChallengeBlockedError so
     * callers stop and report rather than push through.
     */
    throwOnChallenge(observation = {}) {
      const result = classifyChallengeObservation(observation);
      if (result.blocker) throw new ChallengeBlockedError(result.labels);
      return result;
    },

    // Humanized input helpers bound to this page.
    humanClick: (target, clickOpts) => humanClick(page, target, clickOpts),
    humanType: (target, text, typeOpts) => humanType(page, target, text, typeOpts),
    humanScroll: (scrollOpts) => humanScroll(page, scrollOpts)
  };

  return session;
}
