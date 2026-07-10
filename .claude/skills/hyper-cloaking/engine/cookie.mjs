#!/usr/bin/env node
/**
 * Cookie utilities for the `hyper-cloaking` skill.
 *
 * This module is the single normalization and injection path for user-supplied
 * cookies. It accepts the skill's `cookie.yml` schema, legacy flat `cookies:`
 * lists, Chrome cookie export JSON, and Playwright-compatible cookie arrays.
 * It never prints raw cookie values from the CLI; values are redacted in all
 * machine-readable output.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WORKSPACE = '~/.hyper-cloaking';

export const COOKIE_TEMPLATE = `# Hyper Cloaking cookie jar.
# Runtime default path: ~/.hyper-cloaking/cookie.yml
#
# Add only cookies that the user is authorized to use. Do not commit real
# session cookies, secrets, or account tokens to a repository.

sites:
  default:
    description: Fallback cookies used when a requested site has no dedicated entry.
    defaultAccount: default
    accounts:
      default:
        label: Default fallback account
        cookies:
          - domain: .example.com
            path: /
            name: replace_me
            value: replace_me
            httpOnly: false
            secure: true
            sameSite: Lax

  coupang:
    description: Example site-specific multi-account cookie set.
    domain: .coupang.com
    defaultAccount: personal
    accounts:
      personal:
        label: Personal account
        cookies:
          - path: /
            name: replace_me
            value: replace_me
            httpOnly: true
            secure: true
            sameSite: Lax
      work:
        label: Work account
        cookies: []
`;

/**
 * Expands a leading `~` in a user-provided path.
 *
 * @param {string | undefined} input Path that may start with `~`.
 * @returns {string | undefined} Expanded path, or the original falsy value.
 */
export function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

/**
 * Resolves the Hyper Cloaking runtime workspace.
 *
 * @param {string | undefined} workspace Optional workspace override.
 * @returns {string} Absolute workspace path.
 */
export function resolveWorkspace(workspace) {
  return path.resolve(expandHome(
    workspace ||
    process.env.HYPER_CLOAKING_HOME ||
    DEFAULT_WORKSPACE
  ));
}

/**
 * Builds the standard runtime path set for a workspace.
 *
 * @param {string | undefined} workspace Optional workspace override.
 * @returns {{
 *   root: string,
 *   cookieFile: string,
 *   profilesDir: string,
 *   defaultProfileDir: string,
 *   downloadsDir: string,
 *   evidenceDir: string,
 *   logsDir: string,
 *   stateDir: string
 * }} Runtime paths used by this skill.
 */
export function workspacePaths(workspace) {
  const root = resolveWorkspace(workspace);
  return {
    root,
    cookieFile: path.join(root, 'cookie.yml'),
    profilesDir: path.join(root, 'profiles'),
    defaultProfileDir: path.join(root, 'profiles', 'default'),
    downloadsDir: path.join(root, 'downloads'),
    evidenceDir: path.join(root, 'evidence'),
    logsDir: path.join(root, 'logs'),
    stateDir: path.join(root, 'state')
  };
}

/**
 * Removes unquoted inline YAML comments from a line.
 *
 * @param {string} line Raw YAML line.
 * @returns {string} Line without an unquoted trailing comment.
 */
function stripInlineComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
    }
    if (char === '#' && !quote) return line.slice(0, i);
  }
  return line;
}

/**
 * Parses a small YAML scalar subset used by `cookie.yml`.
 *
 * @param {string} value Raw scalar text.
 * @returns {string | number | boolean | null} Parsed scalar value.
 */
function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Assigns a `key: value` pair to a plain object.
 *
 * @param {Record<string, unknown>} target Object receiving the pair.
 * @param {string} source Raw `key: value` text.
 */
function assignPair(target, source) {
  const index = source.indexOf(':');
  if (index === -1) return;
  const key = source.slice(0, index).trim();
  const value = source.slice(index + 1);
  if (key) target[key] = parseScalar(value);
}

/**
 * Parses `cookie.yml`.
 *
 * Supported formats:
 * - New site/account schema under `sites.<site>.accounts.<account>.cookies`.
 * - Legacy flat schema under top-level `cookies`.
 *
 * @param {string} text Cookie YAML text.
 * @returns {{ cookies: Array<Record<string, unknown>>, sites: Record<string, any> }} Parsed cookie config.
 */
export function parseCookieYaml(text) {
  const cookies = [];
  const sites = {};
  let inCookies = false;
  let current = null;
  let inSites = false;
  let siteName = null;
  let accountName = null;
  let inAccounts = false;
  let inAccountCookies = false;
  let currentCookie = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const trimmed = line.trim();
    const indent = rawLine.length - rawLine.trimStart().length;
    if (/^[A-Za-z0-9_-]+:/.test(trimmed) && !rawLine.startsWith(' ')) {
      inCookies = trimmed === 'cookies:';
      inSites = trimmed === 'sites:';
      siteName = null;
      accountName = null;
      inAccounts = false;
      inAccountCookies = false;
      continue;
    }

    if (inSites) {
      if (indent === 2 && trimmed.endsWith(':')) {
        siteName = trimmed.slice(0, -1).trim();
        sites[siteName] = sites[siteName] || { accounts: {} };
        accountName = null;
        inAccounts = false;
        inAccountCookies = false;
        continue;
      }
      if (!siteName) continue;
      const site = sites[siteName];
      if (indent === 4 && trimmed === 'accounts:') {
        site.accounts = site.accounts || {};
        inAccounts = true;
        accountName = null;
        inAccountCookies = false;
        continue;
      }
      if (indent === 4 && !inAccounts) {
        assignPair(site, trimmed);
        continue;
      }
      if (indent === 4 && inAccounts && trimmed.includes(':')) {
        assignPair(site, trimmed);
        continue;
      }
      if (indent === 6 && inAccounts && trimmed.endsWith(':')) {
        accountName = trimmed.slice(0, -1).trim();
        site.accounts[accountName] = site.accounts[accountName] || { cookies: [] };
        inAccountCookies = false;
        continue;
      }
      if (!accountName) continue;
      const account = site.accounts[accountName];
      if (indent === 8 && trimmed === 'cookies:') {
        account.cookies = account.cookies || [];
        inAccountCookies = true;
        currentCookie = null;
        continue;
      }
      if (indent === 8 && !inAccountCookies) {
        assignPair(account, trimmed);
        continue;
      }
      if (indent === 10 && inAccountCookies && trimmed.startsWith('- ')) {
        currentCookie = {};
        account.cookies.push(currentCookie);
        const rest = trimmed.slice(2).trim();
        if (rest) assignPair(currentCookie, rest);
        continue;
      }
      if (indent >= 12 && inAccountCookies && currentCookie) {
        assignPair(currentCookie, trimmed);
      }
      continue;
    }

    if (!inCookies) continue;
    if (trimmed.startsWith('- ')) {
      current = {};
      cookies.push(current);
      const rest = trimmed.slice(2).trim();
      if (rest) assignPair(current, rest);
      continue;
    }
    if (current) assignPair(current, trimmed);
  }

  return { cookies, sites };
}

/**
 * Ensures a parsed cookie config always has a `sites.default` entry.
 *
 * @param {ReturnType<typeof parseCookieYaml>} config Parsed cookie config.
 * @returns {ReturnType<typeof parseCookieYaml>} Config with `sites.default`.
 */
export function withDefaultSite(config) {
  const next = {
    cookies: Array.isArray(config.cookies) ? config.cookies : [],
    sites: config.sites || {}
  };
  if (!next.sites.default) {
    next.sites.default = {
      defaultAccount: 'default',
      accounts: {
        default: {
          label: 'Default fallback account',
          cookies: next.cookies
        }
      }
    };
  }
  return next;
}

/**
 * Normalizes Playwright's `sameSite` casing across common export formats.
 *
 * Chrome extension exports often use `no_restriction` or `unspecified`, while
 * Playwright accepts `Strict`, `Lax`, or `None`.
 *
 * @param {unknown} value YAML or JSON cookie value.
 * @returns {"Strict" | "Lax" | "None" | undefined} Playwright cookie `sameSite`.
 */
export function normalizeSameSite(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'none' || normalized === 'no_restriction') return 'None';
  if (normalized === 'unspecified') return undefined;
  return 'Lax';
}

/**
 * Normalizes a cookie object into a Playwright-compatible cookie.
 *
 * Accepted inputs include this skill's YAML schema, Chrome cookie export JSON,
 * and Playwright-style cookie records. Chrome `expirationDate`, `expiry`, and
 * YAML `expires` all become integer Playwright `expires`.
 *
 * @param {Record<string, unknown>} raw Raw cookie object.
 * @param {{ site?: string, account?: string, domain?: string, url?: string }} [defaults] Site/account defaults.
 * @returns {Record<string, unknown> | null} Playwright cookie or null when incomplete.
 */
export function normalizeCookie(raw, defaults = {}) {
  if (!raw || !raw.name || raw.value == null) return null;
  const cookie = {
    name: String(raw.name),
    value: String(raw.value),
    path: raw.path ? String(raw.path) : '/'
  };
  if (raw.url || defaults.url) cookie.url = String(raw.url || defaults.url);
  if (raw.domain || defaults.domain) cookie.domain = String(raw.domain || defaults.domain);
  const expires = raw.expires ?? raw.expirationDate ?? raw.expiry;
  if (expires != null && expires !== '') cookie.expires = Math.floor(Number(expires));
  if (raw.httpOnly != null) cookie.httpOnly = Boolean(raw.httpOnly);
  if (raw.secure != null) cookie.secure = Boolean(raw.secure);
  const sameSite = normalizeSameSite(raw.sameSite);
  if (sameSite) cookie.sameSite = sameSite;
  if (!cookie.url && !cookie.domain) return null;
  return cookie;
}

/**
 * Checks whether a normalized cookie applies to a target URL.
 *
 * @param {Record<string, unknown>} cookie Normalized cookie.
 * @param {string | undefined} targetUrl Target URL.
 * @returns {boolean} True when the cookie should be considered for the target.
 */
export function domainMatches(cookie, targetUrl) {
  if (!targetUrl) return true;
  if (cookie.url) {
    try {
      const cookieUrl = new URL(cookie.url);
      const target = new URL(targetUrl);
      return cookieUrl.origin === target.origin;
    } catch {
      return false;
    }
  }
  if (!cookie.domain) return false;
  const host = new URL(targetUrl).hostname;
  const domain = String(cookie.domain).replace(/^\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Loads and parses a cookie config file.
 *
 * @param {string} cookieFile Cookie file path.
 * @returns {Promise<ReturnType<typeof parseCookieYaml>>} Parsed config.
 */
export async function loadCookieConfig(cookieFile) {
  try {
    const text = await fs.readFile(cookieFile, 'utf8');
    return withDefaultSite(parseCookieYaml(text));
  } catch (error) {
    if (error && error.code === 'ENOENT') return withDefaultSite({ cookies: [], sites: {} });
    throw error;
  }
}

/**
 * Infers the most specific site entry for a target URL.
 *
 * @param {{ sites: Record<string, any> }} config Parsed cookie config.
 * @param {string | undefined} targetUrl Target URL.
 * @returns {string | null} Matching site name, `default`, or null.
 */
export function inferSiteForUrl(config, targetUrl) {
  if (!config?.sites) return null;
  for (const [name, site] of Object.entries(config.sites)) {
    if (name === 'default') continue;
    const marker = normalizeCookie({ name: '_', value: '_', domain: site.domain, url: site.url });
    if (marker && domainMatches(marker, targetUrl)) return name;
  }
  return config.sites.default ? 'default' : null;
}

/**
 * Selects cookie records for a target URL, site, and account.
 *
 * @param {ReturnType<typeof parseCookieYaml>} config Parsed cookie config.
 * @param {string | undefined} targetUrl Target URL.
 * @param {{ site?: string, account?: string }} [options] Selection options.
 * @returns {{
 *   cookies: Array<Record<string, unknown>>,
 *   site: string | null,
 *   account: string | null,
 *   availableAccounts: string[],
 *   needsAccount: boolean,
 *   fallbackUsed: boolean
 * }} Selection result.
 */
export function selectCookieRecords(config, targetUrl, options = {}) {
  const requestedSite = options.site;
  const explicitSite = requestedSite && config.sites?.[requestedSite] ? requestedSite : null;
  const inferredSite = explicitSite || (requestedSite ? (config.sites?.default ? 'default' : null) : inferSiteForUrl(config, targetUrl));
  const siteName = inferredSite || null;
  const fallbackUsed = Boolean(requestedSite && requestedSite !== siteName && siteName === 'default');
  const site = siteName ? config.sites[siteName] : null;

  if (site?.accounts && Object.keys(site.accounts).length > 0) {
    const availableAccounts = Object.keys(site.accounts);
    const selectedAccount = options.account || site.defaultAccount || (availableAccounts.length === 1 ? availableAccounts[0] : null);
    if (!selectedAccount || !site.accounts[selectedAccount]) {
      return { cookies: [], site: siteName, account: null, availableAccounts, needsAccount: true, fallbackUsed };
    }
    const account = site.accounts[selectedAccount];
    const siteCookies = Array.isArray(site.cookies) ? site.cookies : [];
    const accountCookies = Array.isArray(account.cookies) ? account.cookies : [];
    return {
      cookies: [...siteCookies, ...accountCookies],
      site: siteName,
      account: selectedAccount,
      availableAccounts,
      needsAccount: false,
      fallbackUsed
    };
  }

  const legacyCookies = Array.isArray(config.cookies) ? config.cookies : [];
  return {
    cookies: legacyCookies,
    site: siteName,
    account: null,
    availableAccounts: [],
    needsAccount: false,
    fallbackUsed
  };
}

/**
 * Returns Playwright cookies for a target URL.
 *
 * @param {string} targetUrl URL whose matching cookies should be loaded.
 * @param {{ workspace?: string, cookieFile?: string, site?: string, account?: string }} [options] Cookie selection options.
 * @returns {Promise<Array<Record<string, unknown>>>} Normalized cookies.
 */
export async function cookiesForUrl(targetUrl, options = {}) {
  const paths = workspacePaths(options.workspace);
  const config = await loadCookieConfig(options.cookieFile || paths.cookieFile);
  const selection = selectCookieRecords(config, targetUrl, options);
  if (selection.needsAccount) {
    throw new Error(`Multiple cookie accounts are available for site "${selection.site}". Choose one with --account. Available: ${selection.availableAccounts.join(', ')}`);
  }
  const siteDefaults = selection.site ? config.sites?.[selection.site] || {} : {};
  return selection.cookies
    .map((cookie) => normalizeCookie(cookie, {
      site: selection.site || cookie.site,
      account: selection.account || cookie.account,
      domain: siteDefaults.domain,
      url: siteDefaults.url
    }))
    .filter(Boolean)
    .filter((cookie) => domainMatches(cookie, targetUrl));
}

/**
 * Loads matching cookies into a Playwright BrowserContext.
 *
 * @param {{ addCookies(cookies: Array<Record<string, unknown>>): Promise<void> }} context Playwright context.
 * @param {string} targetUrl URL used to select cookies.
 * @param {{ workspace?: string, cookieFile?: string, site?: string, account?: string }} [options] Cookie selection options.
 * @returns {Promise<Array<Record<string, unknown>>>} Cookies added to the context.
 */
export async function loadCookiesIntoContext(context, targetUrl, options = {}) {
  const cookies = await cookiesForUrl(targetUrl, options);
  if (cookies.length > 0) await context.addCookies(cookies);
  return cookies;
}

/**
 * Redacts cookie values for logs and CLI output.
 *
 * @param {Array<Record<string, unknown>>} cookies Cookies to redact.
 * @returns {Array<Record<string, unknown>>} Cookies with `value` replaced.
 */
export function redactCookies(cookies) {
  return cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    url: cookie.url,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    value: '[redacted]'
  }));
}

/**
 * Extracts cookie records from supported JSON payload shapes.
 *
 * Supported shapes:
 * - `[{ name, value, ... }]`
 * - `{ cookies: [{ name, value, ... }] }`
 * - Playwright storage state `{ cookies, origins }`
 *
 * @param {unknown} payload Parsed JSON payload.
 * @returns {Array<Record<string, unknown>>} Raw cookie records.
 */
export function cookiesFromJsonPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.cookies)) return payload.cookies;
  return [];
}

/**
 * Quotes a scalar for the limited YAML emitted by this script.
 *
 * @param {unknown} value Value to render.
 * @returns {string} YAML scalar.
 */
function yamlScalar(value) {
  if (value === true || value === false) return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.floor(value));
  return JSON.stringify(String(value));
}

/**
 * Serializes a cookie config using the supported site/account schema.
 *
 * @param {ReturnType<typeof parseCookieYaml>} config Cookie config.
 * @returns {string} YAML text.
 */
export function serializeCookieConfig(config) {
  const normalized = withDefaultSite(config);
  const lines = ['sites:'];
  for (const [siteName, site] of Object.entries(normalized.sites)) {
    lines.push(`  ${siteName}:`);
    if (site.description) lines.push(`    description: ${yamlScalar(site.description)}`);
    if (site.domain) lines.push(`    domain: ${yamlScalar(site.domain)}`);
    if (site.url) lines.push(`    url: ${yamlScalar(site.url)}`);
    if (site.defaultAccount) lines.push(`    defaultAccount: ${yamlScalar(site.defaultAccount)}`);
    lines.push('    accounts:');
    const accounts = site.accounts || {};
    for (const [accountName, account] of Object.entries(accounts)) {
      lines.push(`      ${accountName}:`);
      if (account.label) lines.push(`        label: ${yamlScalar(account.label)}`);
      lines.push('        cookies:');
      const cookies = Array.isArray(account.cookies) ? account.cookies : [];
      if (cookies.length === 0) {
        lines.push('          []');
        continue;
      }
      for (const cookie of cookies) {
        const normalizedCookie = normalizeCookie(cookie, { domain: site.domain, url: site.url }) || cookie;
        const entries = Object.entries(normalizedCookie).filter(([, value]) => value !== undefined && value !== null && value !== '');
        const [firstKey, firstValue] = entries.shift() || ['name', ''];
        lines.push(`          - ${firstKey}: ${yamlScalar(firstValue)}`);
        for (const [key, value] of entries) {
          lines.push(`            ${key}: ${yamlScalar(value)}`);
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Imports raw JSON cookies into one site/account in `cookie.yml`.
 *
 * @param {unknown} payload Parsed JSON payload.
 * @param {{
 *   workspace?: string,
 *   cookieFile?: string,
 *   targetUrl?: string,
 *   site: string,
 *   account?: string,
 *   label?: string,
 *   domain?: string,
 *   url?: string
 * }} options Import options.
 * @returns {Promise<{ cookieFile: string, site: string, account: string, count: number, cookies: Array<Record<string, unknown>> }>} Import summary.
 */
export async function importJsonCookies(payload, options) {
  if (!options?.site) throw new Error('--site is required when importing cookies');
  const paths = workspacePaths(options.workspace);
  const cookieFile = options.cookieFile || paths.cookieFile;
  const config = await loadCookieConfig(cookieFile);
  const account = options.account || 'default';
  const rawCookies = cookiesFromJsonPayload(payload);
  const domain = options.domain || (options.targetUrl ? `.${new URL(options.targetUrl).hostname.replace(/^www\./, '')}` : undefined);
  const url = options.url;
  const normalized = rawCookies
    .map((cookie) => normalizeCookie(cookie, { domain, url }))
    .filter(Boolean);

  config.sites[options.site] = config.sites[options.site] || { accounts: {} };
  const site = config.sites[options.site];
  if (domain && !site.domain && !site.url) site.domain = domain;
  if (url && !site.url) site.url = url;
  site.defaultAccount = site.defaultAccount || account;
  site.accounts = site.accounts || {};
  site.accounts[account] = {
    ...(site.accounts[account] || {}),
    label: options.label || site.accounts[account]?.label || `${options.site} ${account}`,
    cookies: normalized
  };

  await fs.mkdir(path.dirname(cookieFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(cookieFile, serializeCookieConfig(config), { mode: 0o600 });
  return {
    cookieFile,
    site: options.site,
    account,
    count: normalized.length,
    cookies: normalized
  };
}

/**
 * Reads JSON from a file or stdin.
 *
 * @param {string | undefined} file Optional input file.
 * @returns {Promise<unknown>} Parsed JSON payload.
 */
async function readJsonInput(file) {
  const text = file
    ? await fs.readFile(expandHome(file), 'utf8')
    : await new Promise((resolve, reject) => {
        let input = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { input += chunk; });
        process.stdin.on('error', reject);
        process.stdin.on('end', () => resolve(input));
      });
  if (!String(text).trim()) throw new Error('No JSON input was provided');
  return JSON.parse(String(text));
}

/**
 * Reads a positional CLI argument value.
 *
 * @param {string[]} args CLI argument list.
 * @param {string} flag Flag name.
 * @returns {string | undefined} Flag value.
 */
function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

/**
 * CLI entry point for cookie inspection and import.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const json = args.includes('--json');
  if (command === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node engine/cookie.mjs inspect --url URL [--site SITE] [--account ACCOUNT] [--workspace DIR] [--json]
  node engine/cookie.mjs import-json --site SITE [--account ACCOUNT] [--url URL] [--from FILE] [--workspace DIR] [--json]

Purpose:
  Normalize, inspect, and import user-supplied cookies for Hyper Cloaking runs.
  Supports cookie.yml, Chrome cookie export JSON, and Playwright cookie arrays.
  CLI output always redacts cookie values.`);
    return;
  }

  const workspace = argValue(args, '--workspace');
  const paths = workspacePaths(workspace);
  if (command === 'inspect') {
    const targetUrl = argValue(args, '--url');
    const site = argValue(args, '--site');
    const account = argValue(args, '--account');
    const config = await loadCookieConfig(paths.cookieFile);
    const selection = selectCookieRecords(config, targetUrl, { site, account });
    if (selection.needsAccount) {
      const output = {
        ok: false,
        cookieFile: paths.cookieFile,
        needsAccount: true,
        site: selection.site,
        availableAccounts: selection.availableAccounts,
        message: `Choose one account with --account for site "${selection.site}".`
      };
      console.log(json ? JSON.stringify(output, null, 2) : output.message);
      process.exitCode = 3;
      return;
    }
    const cookies = await cookiesForUrl(targetUrl, { workspace: paths.root, site, account });
    const output = {
      ok: true,
      cookieFile: paths.cookieFile,
      site: selection.site,
      account: selection.account,
      fallbackUsed: selection.fallbackUsed,
      count: cookies.length,
      cookies: redactCookies(cookies)
    };
    console.log(json ? JSON.stringify(output, null, 2) : `${cookies.length} cookies from ${paths.cookieFile}`);
    return;
  }

  if (command === 'import-json') {
    const payload = await readJsonInput(argValue(args, '--from'));
    const result = await importJsonCookies(payload, {
      workspace,
      targetUrl: argValue(args, '--url'),
      site: argValue(args, '--site'),
      account: argValue(args, '--account'),
      label: argValue(args, '--label'),
      domain: argValue(args, '--domain'),
      url: argValue(args, '--cookie-url')
    });
    const output = {
      ok: true,
      cookieFile: result.cookieFile,
      site: result.site,
      account: result.account,
      count: result.count,
      cookies: redactCookies(result.cookies)
    };
    console.log(json ? JSON.stringify(output, null, 2) : `Imported ${result.count} cookies into ${result.cookieFile}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
