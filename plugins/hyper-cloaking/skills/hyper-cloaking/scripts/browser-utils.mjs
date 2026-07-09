#!/usr/bin/env node
/**
 * Runtime utilities for the `hyper-cloaking` skill.
 *
 * This module owns runtime workspace setup and CloakBrowser launch wrappers.
 * Humanized input behavior lives in `engine/input-core.mjs`, `engine/mouse.mjs`,
 * `engine/keyboard.mjs`, and `engine/scroll.mjs`; this file re-exports those
 * helpers for browser-oriented consumers. Cookie normalization and injection live in
 * `scripts/cookie.mjs` and are re-exported here for backward compatibility.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COOKIE_TEMPLATE,
  resolveWorkspace,
  workspacePaths,
  loadCookieConfig,
  selectCookieRecords,
  cookiesForUrl,
  redactCookies
} from './cookie.mjs';

export {
  DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS,
  DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS,
  DEFAULT_HUMAN_MOVE_MAX_STEPS,
  DEFAULT_HUMAN_MOVE_MIN_STEPS,
  DEFAULT_HUMAN_TARGET_MAX_RATIO,
  DEFAULT_HUMAN_TARGET_MIN_RATIO,
  findByXPath,
  resolveHumanRange,
  resolveTarget
} from '../engine/input-core.mjs';
export {
  humanClick,
  humanMove
} from '../engine/mouse.mjs';
export {
  DEFAULT_HUMAN_TYPE_MAX_CPM,
  DEFAULT_HUMAN_TYPE_MIN_CPM,
  humanType,
  humanTypeDelayMs
} from '../engine/keyboard.mjs';
export {
  DEFAULT_HUMAN_SCROLL_PAUSE_JITTER,
  DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND,
  humanScroll
} from '../engine/scroll.mjs';
export {
  assertNavigationAllowed,
  classifyRedirect,
  classifyTargetUrl,
  normalizeOrigin as normalizeTargetOrigin
} from '../engine/target-safety.mjs';
export {
  evaluateOutcome,
  makeOutcomeReport
} from '../engine/outcome.mjs';
export {
  classifyChallengeObservation,
  makeFailureDiagnostic
} from '../engine/diagnostics.mjs';
export {
  markUntrustedBrowserContent,
  redactEvidenceText,
  summarizeEvidenceRef
} from '../engine/evidence-boundary.mjs';
export {
  classifyEvidenceScope,
  isOriginApproved,
  isSameOrigin,
  makeEvidencePlan,
  normalizeOrigin as normalizeEvidenceOrigin
} from '../engine/recon-scope.mjs';
export {
  appendRunShape,
  clearRunShapes,
  sanitizeRunShape
} from '../engine/run-shapes.mjs';

export {
  COOKIE_TEMPLATE,
  DEFAULT_WORKSPACE,
  cookiesForUrl,
  cookiesFromJsonPayload,
  domainMatches,
  expandHome,
  importJsonCookies,
  inferSiteForUrl,
  loadCookieConfig,
  loadCookiesIntoContext,
  normalizeCookie,
  normalizeSameSite,
  parseCookieYaml,
  redactCookies,
  resolveWorkspace,
  selectCookieRecords,
  serializeCookieConfig,
  withDefaultSite,
  workspacePaths
} from './cookie.mjs';

/**
 * Creates the runtime workspace and a starter `cookie.yml` when missing.
 *
 * This function is intentionally non-destructive: existing cookie files are not
 * rewritten or migrated because they may contain sensitive user-provided values.
 *
 * @param {string | undefined} workspace Optional workspace override.
 * @returns {Promise<ReturnType<typeof workspacePaths>>} Runtime path set.
 */
export async function ensureWorkspace(workspace) {
  const paths = workspacePaths(workspace);
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  await Promise.all([
    fs.mkdir(paths.profilesDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.defaultProfileDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.downloadsDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.evidenceDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.logsDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.stateDir, { recursive: true, mode: 0o700 })
  ]);
  try {
    await fs.access(paths.cookieFile);
  } catch {
    await fs.writeFile(paths.cookieFile, COOKIE_TEMPLATE, { mode: 0o600 });
  }
  return paths;
}

/**
 * Imports CloakBrowser from the normal module graph, then from the runtime
 * workspace used by this skill. This lets agents install `cloakbrowser` into
 * `~/.hyper-cloaking` without modifying the repository that owns the skill.
 *
 * @param {string | undefined} workspace Optional runtime workspace override.
 * @returns {Promise<Record<string, any>>} CloakBrowser module exports.
 */
async function importCloakBrowser(workspace) {
  try {
    return await import('cloakbrowser');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const fallback = path.join(resolveWorkspace(workspace), 'node_modules', 'cloakbrowser', 'dist', 'index.js');
    try {
      return await import(pathToFileURL(fallback).href);
    } catch (fallbackError) {
      fallbackError.message = `${fallbackError.message}\nTried fallback CloakBrowser module path: ${fallback}`;
      throw fallbackError;
    }
  }
}

/**
 * Launches CloakBrowser through the JS API with mandatory humanization.
 *
 * @param {{ workspace?: string, headless?: boolean, cloakOptions?: Record<string, any> }} [options] Launch options.
 * @returns {Promise<{ browser: any, paths: ReturnType<typeof workspacePaths> }>} Browser and runtime paths.
 */
export async function launchCloakBrowser(options = {}) {
  const paths = await ensureWorkspace(options.workspace);
  const { launch } = await importCloakBrowser(options.workspace);
  const browser = await launch({
    ...options.cloakOptions,
    humanize: true,
    headless: options.headless ?? true,
    launchOptions: {
      downloadsPath: paths.downloadsDir,
      ...(options.cloakOptions?.launchOptions || {})
    }
  });
  return { browser, paths };
}

/**
 * Launches a persistent CloakBrowser context using the runtime profile folder.
 *
 * @param {{ workspace?: string, userDataDir?: string, headless?: boolean, cloakOptions?: Record<string, any> }} [options] Launch options.
 * @returns {Promise<{ context: any, paths: ReturnType<typeof workspacePaths> }>} Context and runtime paths.
 */
export async function launchPersistentCloakContext(options = {}) {
  const paths = await ensureWorkspace(options.workspace);
  const { launchPersistentContext } = await importCloakBrowser(options.workspace);
  const context = await launchPersistentContext({
    ...options.cloakOptions,
    userDataDir: options.userDataDir || paths.defaultProfileDir,
    humanize: true,
    headless: options.headless ?? true,
    contextOptions: {
      acceptDownloads: true,
      ...(options.cloakOptions?.contextOptions || {})
    }
  });
  return { context, paths };
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
 * CLI entry point for workspace and cookie inspection commands.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  if (command === 'help' || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node scripts/browser-utils.mjs init [--workspace DIR] [--json]
  node scripts/browser-utils.mjs cookies --url URL [--site SITE] [--account ACCOUNT] [--workspace DIR] [--json]

Purpose:
  Manage the Hyper Cloaking runtime workspace and provide reusable browser
  helpers for humanized movement, typing, scrolling, XPath lookup, and cookies.`);
    return;
  }
  const workspace = argValue(args, '--workspace');
  const json = args.includes('--json');
  if (command === 'init') {
    const paths = await ensureWorkspace(workspace);
    const output = { ok: true, paths };
    console.log(json ? JSON.stringify(output, null, 2) : `Initialized ${paths.root}`);
    return;
  }
  if (command === 'cookies') {
    const paths = await ensureWorkspace(workspace);
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
  throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
