/**
 * @module cookies
 *
 * Read-only, session-less cookie inspection tools (Phase 1).
 *
 * Cookie VALUES are never returned: every record is passed through the engine's
 * `redactCookies` before it leaves the server. Account ambiguity is surfaced as
 * a structured `needs-account` signal, never a thrown error.
 */
import {
  workspacePaths,
  loadCookieConfig,
  selectCookieRecords,
  redactCookies
} from 'hyper-cloaking-engine';
import { defineTool } from '../error-signal.mjs';

/**
 * Shared input schema for URL-based cookie selection and status tools.
 *
 * @type {object}
 * @private
 */
const SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'Target URL used to select the cookie site.' },
    site: { type: 'string', description: 'Explicit cookie site override.' },
    account: { type: 'string', description: 'Explicit account within the site.' },
    workspace: { type: 'string' }
  }
};

/**
 * Loads the workspace cookie config and selects records for a URL.
 *
 * @param {{ url: string, site?: string, account?: string, workspace?: string }} input Selection input.
 * @returns {Promise<ReturnType<typeof selectCookieRecords>>} Selection result, including a fail-closed account ambiguity signal.
 * @private
 */
async function selectFor(input) {
  const paths = workspacePaths(input.workspace);
  const config = await loadCookieConfig(paths.cookieFile);
  return selectCookieRecords(config, input.url, { site: input.site, account: input.account });
}

/**
 * Lists selected cookie records with values redacted before returning them.
 *
 * @type {object}
 */
export const cookiesListTool = defineTool({
  name: 'cloak_cookies_list',
  description:
    'List cookie records configured for a target URL, with values redacted. Returns needs-account when a site has multiple accounts and none was chosen.',
  inputSchema: SELECTION_SCHEMA,
  async handler(input) {
    const selection = await selectFor(input);
    if (selection.needsAccount) {
      return {
        status: 'needs-account',
        site: selection.site,
        availableAccounts: selection.availableAccounts
      };
    }
    return {
      status: 'ok',
      site: selection.site,
      account: selection.account,
      cookies: redactCookies(selection.cookies)
    };
  }
});

/**
 * Summarizes selected cookie coverage without returning individual records.
 *
 * @type {object}
 */
export const cookiesStatusTool = defineTool({
  name: 'cloak_cookies_status',
  description:
    'Summarize cookie coverage for a target URL (counts + available accounts) without listing individual records. Returns needs-account on account ambiguity.',
  inputSchema: SELECTION_SCHEMA,
  async handler(input) {
    const selection = await selectFor(input);
    if (selection.needsAccount) {
      return {
        status: 'needs-account',
        site: selection.site,
        availableAccounts: selection.availableAccounts
      };
    }
    return {
      status: 'ok',
      site: selection.site,
      account: selection.account,
      cookieCount: selection.cookies.length,
      availableAccounts: selection.availableAccounts
    };
  }
});
