/**
 * @module navigate
 *
 * Navigation tool (Phase 2): cloak_navigate.
 *
 * target-safety is a precondition enforced with the NON-throwing classifyTargetUrl
 * (assertNavigationAllowed throws, so it is never used on the client path). Only an
 * `ok` disposition navigates; anything else returns a structured needs-preflight
 * signal with no navigation. Redirects are re-classified after load.
 */
import { classifyTargetUrl, classifyRedirect } from '@mcp/engine';
import { defineTool } from '../runtime/error-signal.mjs';

/**
 * Builds the navigate tool bound to a session manager.
 *
 * @param {ReturnType<import('../runtime/session-manager.mjs').createSessionManager>} manager Session manager.
 * @returns {object} Navigate tool descriptor.
 */
export function makeNavigateTool(manager) {
  return defineTool({
    name: 'cloak_navigate',
    description:
      'Navigate the session page to a URL after a target-safety precondition. Off-origin/unsafe/approval-required URLs return needs-preflight with no navigation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string' } }
    },
    handler(input) {
      return manager.withSession(async (session) => {
        const classification = classifyTargetUrl(input.url);
        if (classification.disposition !== 'ok') {
          return {
            status: 'needs-preflight',
            code: classification.reason,
            disposition: classification.disposition,
            url: input.url,
            message: `Navigation requires preflight: ${classification.reason}`
          };
        }
        const response = await session.page.goto(input.url, { waitUntil: 'domcontentloaded' });
        const finalUrl = session.page.url();
        const redirect = classifyRedirect(input.url, finalUrl);
        if (redirect.disposition !== 'ok') {
          return {
            status: 'needs-preflight',
            code: 'unsafe-redirect',
            requestedUrl: input.url,
            finalUrl,
            redirectReason: redirect.reason
          };
        }
        return {
          status: 'ok',
          url: finalUrl,
          httpStatus: response ? response.status() : null
        };
      });
    }
  });
}
