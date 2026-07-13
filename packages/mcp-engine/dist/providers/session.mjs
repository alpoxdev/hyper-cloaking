// Provider action session: the single guarded entry every provider action goes through.
//
// This is a JS-driver (`live` lane) helper: it needs a real Playwright `page`.
// In Playwright-MCP mode there is no `page` handle, so this session is not
// usable there.

import { isOriginApproved } from '../recon-scope.mjs';
import { classifyTargetUrl } from '../target-safety.mjs';
import { classifyChallengeObservation } from '../diagnostics.mjs';
import { humanClick } from '../mouse.mjs';
import { humanType } from '../keyboard.mjs';
import { humanScroll } from '../scroll.mjs';

export class OffOriginError extends Error {
  constructor(url, allowedOrigins, provider) {
    const label = provider?.label || 'Provider';
    super(`Refusing to act: "${url}" is not within ${label} allowed origins`);
    this.name = 'OffOriginError';
    this.code = 'off-origin';
    this.url = url;
    this.allowedOrigins = allowedOrigins;
  }
}

export class ChallengeBlockedError extends Error {
  constructor(labels, { code = 'challenge-blocked', stage = 'challenge-observed', cause } = {}) {
    super(`Challenge detected (${labels.join(', ')}); stopping automated interaction`, { cause });
    this.name = 'ChallengeBlockedError';
    this.code = code;
    this.stage = stage;
    this.labels = labels;
  }
}
export class TargetSafetyError extends Error {
  constructor(url, classification, phase = 'target') {
    super(
      `Refusing to navigate: "${url}" target safety is ${classification.disposition} (${classification.reason})`
    );
    this.name = 'TargetSafetyError';
    this.code = 'HYPER_CLOAKING_TARGET_SAFETY';
    this.url = url;
    this.classification = classification;
    this.phase = phase;
  }
}

export class StrictNavigationError extends Error {
  constructor(
    url,
    { code = 'strict-navigation-failed', phase = 'strict-navigation', status = null, cause } = {}
  ) {
    super(
      `Strict provider navigation failed for "${url}"${status == null ? '' : ` (HTTP ${status})`}`,
      { cause }
    );
    this.name = 'StrictNavigationError';
    this.code = code;
    this.phase = phase;
    this.status = status;
    this.url = url;
  }
}

/**
 * Builds a guarded provider session around a Playwright `page`.
 *
 * @param {object} page Playwright page (JS-driver lane).
 * @param {object} opts
 * @param {object} opts.provider Provider metadata.
 * @param {string[]} [opts.allowedOrigins] Override allowed origins (defaults to provider metadata when omitted).
 * @param {object} [opts.targetSafety] Target-safety classification established for the requested target.
 * @param {string} [opts.stateDir] Runtime workspace state dir for guardrail persistence.
 * @param {boolean} [opts.interactive] Whether an interactive confirmation surface exists.
 * @returns {object} Session handle.
 */
export function buildProviderSession(
  page,
  { provider, allowedOrigins, targetSafety, stateDir, interactive } = {}
) {
  const resolvedAllowedOrigins = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : provider?.domains?.allowedOrigins || [];
  const strictOriginPolicy = resolveStrictOriginPolicy(provider, allowedOrigins);

  const session = {
    page,
    provider,
    allowedOrigins: resolvedAllowedOrigins,
    strictAllowedOrigins: strictOriginPolicy.origins,
    stateDir: stateDir || null,
    interactive: interactive === true,
    targetSafety: null,

    /** Current page URL, or '' if the page cannot report one. */
    currentUrl() {
      try {
        return typeof page?.url === 'function' ? page.url() : '';
      } catch {
        return '';
      }
    },

    /**
     * Asserts the given URL (defaults to the live page URL) is within the
     * provider's allowed origins. Throws OffOriginError otherwise.
     */
    requireOnOrigin(url = session.currentUrl()) {
      if (!isOriginApproved(url, resolvedAllowedOrigins)) {
        throw new OffOriginError(url, resolvedAllowedOrigins, provider);
      }

      return url;
    },

    requireOnStrictOrigin(url = session.currentUrl()) {
      if (
        strictOriginPolicy.invalidOverride ||
        !isOriginApproved(url, strictOriginPolicy.origins)
      ) {
        throw new OffOriginError(url, strictOriginPolicy.origins, provider);
      }
      return url;
    },
    /**
     * Navigates only to an explicitly approved, safe target and verifies the
     * final redirected destination before exposing it to provider actions.
     */
    async navigateGuarded(targetUrl, gotoOpts) {
      session.requireOnOrigin(targetUrl);

      const intrinsicTargetSafety = classifyTargetUrl(targetUrl);
      if (intrinsicTargetSafety.disposition !== 'ok') {
        throw new TargetSafetyError(targetUrl, intrinsicTargetSafety);
      }

      if (targetSafety) {
        if (targetSafety.disposition !== 'ok') {
          throw new TargetSafetyError(targetUrl, targetSafety);
        }

        if (!isSafetyBoundToTarget(targetSafety, intrinsicTargetSafety)) {
          throw new TargetSafetyError(targetUrl, invalidSuppliedSafety(targetSafety));
        }
      }

      const response = await page.goto(targetUrl, gotoOpts);
      const finalUrl = page.url();
      session.requireOnOrigin(finalUrl);

      const finalSafety = classifyTargetUrl(finalUrl);
      if (finalSafety.disposition !== 'ok') {
        throw new TargetSafetyError(finalUrl, finalSafety, 'redirect');
      }

      session.targetSafety = finalSafety;
      try {
        const evidence = await captureChallengeEvidence(page, response);
        session.throwOnChallenge({ url: finalUrl, ...evidence });
      } catch (error) {
        if (error instanceof ChallengeBlockedError) throw error;
        throw new ChallengeBlockedError(['challenge-evidence-unavailable'], {
          code: 'challenge-evidence-unavailable',
          stage: 'challenge-evidence',
          cause: error
        });
      }
      return finalUrl;
    },

    async navigateGuardedForRead(targetUrl, gotoOpts) {
      return navigateStrict(page, session, {
        provider,
        targetSafety,
        strictAllowedOrigins: strictOriginPolicy.origins,
        targetUrl,
        gotoOpts,
        phase: 'read'
      });
    },

    async navigateGuardedForWrite(targetUrl, gotoOpts) {
      return navigateStrict(page, session, {
        provider,
        targetSafety,
        strictAllowedOrigins: strictOriginPolicy.origins,
        targetUrl,
        gotoOpts,
        phase: 'write'
      });
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

function normalizeExactHttpsOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

function resolveStrictOriginPolicy(provider, override) {
  const metadataOrigins = Array.isArray(provider?.domains?.allowedOrigins)
    ? provider.domains.allowedOrigins.map(normalizeExactHttpsOrigin).filter(Boolean)
    : [];
  if (override === undefined) {
    return { origins: [...metadataOrigins], invalidOverride: false };
  }
  if (!Array.isArray(override)) {
    return { origins: [], invalidOverride: true };
  }

  const requested = override.map(normalizeExactHttpsOrigin);
  const invalidOverride = requested.some((origin) => !origin || !metadataOrigins.includes(origin));
  return {
    origins: invalidOverride ? [] : [...new Set(requested)],
    invalidOverride
  };
}

function assertBoundTargetSafety(targetUrl, targetSafety) {
  const intrinsic = classifyTargetUrl(targetUrl);
  if (intrinsic.disposition !== 'ok') throw new TargetSafetyError(targetUrl, intrinsic);
  if (!targetSafety) return intrinsic;
  if (targetSafety.disposition !== 'ok') throw new TargetSafetyError(targetUrl, targetSafety);
  if (!isSafetyBoundToTarget(targetSafety, intrinsic)) {
    throw new TargetSafetyError(targetUrl, invalidSuppliedSafety(targetSafety));
  }
  return intrinsic;
}

async function assertNoServiceWorker(page, targetUrl, phase) {
  const context = typeof page?.context === 'function' ? page.context() : null;
  if (!context || typeof context.serviceWorkers !== 'function') {
    throw new StrictNavigationError(targetUrl, {
      code: 'strict-navigation-service-worker-inspection-unavailable',
      phase
    });
  }
  const workers = context.serviceWorkers();
  if (!Array.isArray(workers)) {
    throw new StrictNavigationError(targetUrl, {
      code: 'strict-navigation-service-worker-inspection-unavailable',
      phase
    });
  }
  if (workers.length > 0) {
    throw new StrictNavigationError(targetUrl, {
      code: 'strict-navigation-service-worker',
      phase
    });
  }
}

function isMainNavigationRequest(request, page) {
  if (!request) return false;
  const navigation =
    typeof request.isNavigationRequest === 'function'
      ? request.isNavigationRequest()
      : request.resourceType?.() === 'document';
  if (!navigation) return false;
  if (typeof request.frame !== 'function' || typeof page?.mainFrame !== 'function')
    return navigation;
  return request.frame() === page.mainFrame();
}

function strictStatusError(url, status, phase) {
  if (status === 401)
    return new StrictNavigationError(url, { code: 'network-auth', phase, status });
  if (status === 429)
    return new StrictNavigationError(url, { code: 'network-rate-limit', phase, status });
  if (status === 204 || status === 205) {
    return new StrictNavigationError(url, { code: 'empty-navigation-response', phase, status });
  }
  return new StrictNavigationError(url, { code: 'network-http-status', phase, status });
}

async function navigateStrict(
  page,
  session,
  { provider, targetSafety, strictAllowedOrigins, targetUrl, gotoOpts, phase }
) {
  session.requireOnStrictOrigin(targetUrl);
  assertBoundTargetSafety(targetUrl, targetSafety);
  await assertNoServiceWorker(page, targetUrl, phase);

  if (
    typeof page?.route !== 'function' ||
    typeof page?.unroute !== 'function' ||
    typeof page?.goto !== 'function'
  ) {
    throw new StrictNavigationError(targetUrl, {
      code: 'strict-navigation-interception-unavailable',
      phase
    });
  }

  const pattern = '**/*';
  let blockedError = null;
  const handler = async (route) => {
    const request = typeof route?.request === 'function' ? route.request() : null;
    if (!isMainNavigationRequest(request, page)) {
      if (typeof route?.fallback !== 'function') {
        blockedError = new StrictNavigationError(targetUrl, {
          code: 'strict-navigation-fallback-unavailable',
          phase
        });
        await route?.abort?.('blockedbyclient');
        return;
      }
      await route.fallback();
      return;
    }

    const requestUrl = typeof request?.url === 'function' ? request.url() : '';
    if (!isOriginApproved(requestUrl, strictAllowedOrigins)) {
      blockedError = new OffOriginError(requestUrl, strictAllowedOrigins, provider);
      await route.abort('blockedbyclient');
      return;
    }
    const safety = classifyTargetUrl(requestUrl);
    if (safety.disposition !== 'ok') {
      blockedError = new TargetSafetyError(requestUrl, safety, 'redirect');
      await route.abort('blockedbyclient');
      return;
    }
    if (typeof route.fallback !== 'function') {
      blockedError = new StrictNavigationError(requestUrl, {
        code: 'strict-navigation-fallback-unavailable',
        phase
      });
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  };

  let installed = false;
  let result;
  let operationError = null;
  try {
    await page.route(pattern, handler);
    installed = true;
    let response;
    try {
      response = await page.goto(targetUrl, gotoOpts);
    } catch (error) {
      throw blockedError || error;
    }
    if (blockedError) throw blockedError;

    const finalUrl = page.url();
    session.requireOnStrictOrigin(finalUrl);
    const finalSafety = classifyTargetUrl(finalUrl);
    if (finalSafety.disposition !== 'ok')
      throw new TargetSafetyError(finalUrl, finalSafety, 'redirect');

    let evidence;
    try {
      evidence = await captureChallengeEvidence(page, response);
      session.throwOnChallenge({ url: finalUrl, ...evidence });
    } catch (error) {
      if (error instanceof ChallengeBlockedError) throw error;
      throw new ChallengeBlockedError(['challenge-evidence-unavailable'], {
        code: 'challenge-evidence-unavailable',
        stage: 'challenge-evidence',
        cause: error
      });
    }

    const status = response && typeof response.status === 'function' ? response.status() : null;
    if (!Number.isInteger(status)) {
      throw new StrictNavigationError(finalUrl, {
        code: 'strict-navigation-status-unavailable',
        phase
      });
    }
    if (status < 200 || status > 299 || status === 204 || status === 205) {
      throw strictStatusError(finalUrl, status, phase);
    }

    session.targetSafety = finalSafety;
    result = { url: finalUrl, status };
  } catch (error) {
    operationError = error;
  }

  if (installed) {
    try {
      await page.unroute(pattern, handler);
    } catch (cleanupError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, cleanupError],
          'strict navigation and route cleanup failed'
        );
      }
      throw new StrictNavigationError(targetUrl, {
        code: 'strict-navigation-cleanup-failed',
        phase,
        cause: cleanupError
      });
    }
  }

  if (operationError) throw operationError;
  return result;
}
function isSafetyBoundToTarget(suppliedSafety, intrinsicSafety) {
  try {
    return (
      (typeof suppliedSafety.href === 'string' && suppliedSafety.href === intrinsicSafety.href) ||
      (typeof suppliedSafety.input === 'string' && suppliedSafety.input === intrinsicSafety.input)
    );
  } catch {
    return false;
  }
}

function invalidSuppliedSafety(suppliedSafety) {
  return {
    disposition: 'blocker',
    reason: 'unbound-supplied-target-safety',
    detail: 'Supplied target safety must bind to the requested target URL.',
    suppliedSafety
  };
}

async function captureChallengeEvidence(page, response) {
  const status = response && typeof response.status === 'function' ? response.status() : null;
  const statusText =
    response && typeof response.statusText === 'function' ? response.statusText() : '';
  const ui = await page.evaluate(() => {
    const selectors = [
      'iframe[src*="captcha" i]',
      '[data-testid*="captcha" i], [data-testid*="challenge" i], [data-testid*="rate-limit" i]',
      '[id*="captcha" i], [id*="challenge" i], [id*="login-wall" i], [id*="login-modal" i], [id*="rate-limit" i]',
      '[class*="captcha" i], [class*="challenge" i], [class*="login-wall" i], [class*="login-modal" i], [class*="rate-limit" i]',
      '[role="dialog"][aria-label*="login" i], [role="dialog"][data-testid*="login" i], [role="alert"][aria-label*="login" i], [role="alert"][data-testid*="login" i], [role="alert"][aria-label*="rate" i], [role="alert"][data-testid*="rate" i]'
    ];
    const elements = document.querySelectorAll(selectors.join(', '));
    const labels = [...elements].map((element) =>
      [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('alt'),
        element.innerText,
        element.textContent
      ]
        .filter(Boolean)
        .join(' ')
    );

    return { title: document.title || '', labels };
  });
  if (!ui || typeof ui !== 'object' || typeof ui.title !== 'string' || !Array.isArray(ui.labels)) {
    throw new Error('Challenge evidence was malformed');
  }

  return {
    statusText: [status, statusText].filter((value) => value !== '' && value != null).join(' '),
    title: ui.title,
    messages: ui.labels
  };
}
