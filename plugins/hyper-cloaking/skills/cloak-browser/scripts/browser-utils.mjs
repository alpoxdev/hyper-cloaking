#!/usr/bin/env node
/**
 * Runtime utilities for the `cloak-browser` skill.
 *
 * This module owns the deterministic pieces that are easier to verify in code
 * than prose: runtime workspace setup, CloakBrowser launch wrappers, and
 * human-like browser actions. Cookie normalization and injection live in
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

export const DEFAULT_HUMAN_TYPE_MIN_CPM = 250;
export const DEFAULT_HUMAN_TYPE_MAX_CPM = 270;
export const DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND = 900;
export const DEFAULT_HUMAN_MOVE_MIN_STEPS = 28;
export const DEFAULT_HUMAN_MOVE_MAX_STEPS = 44;
export const DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS = 180;
export const DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS = 420;
export const DEFAULT_HUMAN_TARGET_MIN_RATIO = 0.35;
export const DEFAULT_HUMAN_TARGET_MAX_RATIO = 0.65;
export const DEFAULT_HUMAN_SCROLL_PAUSE_JITTER = 0.25;

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
 * `~/.hypercore-business` without modifying the repository that owns the skill.
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
 * Finds an element with XPath and returns the first Playwright locator.
 *
 * @param {any} page Playwright page.
 * @param {string} xpath XPath expression.
 * @param {{ wait?: boolean, state?: "attached" | "detached" | "visible" | "hidden", timeout?: number }} [options] Wait options.
 * @returns {Promise<any>} First matching locator.
 */
export async function findByXPath(page, xpath, options = {}) {
  const locator = page.locator(`xpath=${xpath}`).first();
  if (options.wait !== false) {
    await locator.waitFor({ state: options.state || 'visible', timeout: options.timeout || 10000 });
  }
  return locator;
}

/**
 * Resolves a CSS selector, XPath, coordinate, locator, or handle-like target.
 *
 * @param {any} page Playwright page.
 * @param {string | { click?: Function } | { x: number, y: number }} target Target descriptor.
 * @param {Record<string, any>} [options] Wait options.
 * @returns {Promise<any>} Locator or target object.
 */
async function resolveTarget(page, target, options = {}) {
  if (target && typeof target.click === 'function') return target;
  if (typeof target !== 'string') return target;
  if (target.startsWith('/') || target.startsWith('(')) return findByXPath(page, target, options);
  const locator = page.locator(target).first();
  if (options.wait !== false) {
    await locator.waitFor({ state: options.state || 'visible', timeout: options.timeout || 10000 });
  }
  return locator;
}

/**
 * Returns a random number in a closed range.
 *
 * @param {number} min Minimum value.
 * @param {number} max Maximum value.
 * @returns {number} Random value between `min` and `max`.
 */
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Returns a random integer in a closed range.
 *
 * @param {number} min Minimum value.
 * @param {number} max Maximum value.
 * @returns {number} Random integer between `min` and `max`.
 */
function randomInteger(min, max) {
  return Math.round(randomBetween(min, max));
}

/**
 * Resolves either an exact number or a randomized numeric range.
 *
 * @param {number | undefined} exact Exact override.
 * @param {number | undefined} min Minimum override.
 * @param {number | undefined} max Maximum override.
 * @param {number} defaultMin Default minimum.
 * @param {number} defaultMax Default maximum.
 * @param {{ integer?: boolean }} [options] Range options.
 * @returns {number} Resolved number.
 */
function resolveHumanRange(exact, min, max, defaultMin, defaultMax, options = {}) {
  if (exact != null) return Number(exact);
  const lowerInput = Number(min ?? defaultMin);
  const upperInput = Number(max ?? defaultMax);
  const lower = Math.min(lowerInput, upperInput);
  const upper = Math.max(lowerInput, upperInput);
  return options.integer ? randomInteger(lower, upper) : randomBetween(lower, upper);
}

/**
 * Applies symmetric jitter to a timing value.
 *
 * @param {number} value Base value.
 * @param {number} jitter Ratio, such as 0.25 for +/-25%.
 * @returns {number} Jittered value.
 */
function jitterNumber(value, jitter) {
  const ratio = Math.max(0, Number(jitter));
  if (!ratio) return value;
  return value * randomBetween(1 - ratio, 1 + ratio);
}

/**
 * Moves the mouse in multiple steps to a coordinate or element interior.
 *
 * @param {any} page Playwright page.
 * @param {string | any | { x: number, y: number }} target CSS selector, XPath, locator, or coordinates.
 * @param {{ steps?: number, minSteps?: number, maxSteps?: number, ratioX?: number, ratioY?: number, minRatio?: number, maxRatio?: number, timeout?: number }} [options] Movement options.
 * @returns {Promise<{ x: number, y: number }>} Final pointer coordinates.
 */
export async function humanMove(page, target, options = {}) {
  const steps = Math.max(1, resolveHumanRange(
    options.steps,
    options.minSteps,
    options.maxSteps,
    DEFAULT_HUMAN_MOVE_MIN_STEPS,
    DEFAULT_HUMAN_MOVE_MAX_STEPS,
    { integer: true }
  ));
  if (typeof target === 'object' && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    await page.mouse.move(target.x, target.y, { steps });
    return { x: target.x, y: target.y };
  }
  const locator = await resolveTarget(page, target, options);
  const box = await locator.boundingBox();
  if (!box) throw new Error('Target has no bounding box');
  const minRatio = options.minRatio ?? DEFAULT_HUMAN_TARGET_MIN_RATIO;
  const maxRatio = options.maxRatio ?? DEFAULT_HUMAN_TARGET_MAX_RATIO;
  const ratioX = options.ratioX ?? resolveHumanRange(undefined, minRatio, maxRatio, minRatio, maxRatio);
  const ratioY = options.ratioY ?? resolveHumanRange(undefined, minRatio, maxRatio, minRatio, maxRatio);
  const x = box.x + box.width * ratioX;
  const y = box.y + box.height * ratioY;
  await page.mouse.move(x, y, { steps });
  return { x, y };
}

/**
 * Moves to and clicks a target using the humanized pointer path.
 *
 * @param {any} page Playwright page.
 * @param {string | any} target CSS selector, XPath, or locator.
 * @param {{ beforeClickMs?: number, minBeforeClickMs?: number, maxBeforeClickMs?: number, button?: "left" | "right" | "middle", timeout?: number }} [options] Click options.
 * @returns {Promise<any>} Clicked locator.
 */
export async function humanClick(page, target, options = {}) {
  const locator = await resolveTarget(page, target, options);
  await humanMove(page, locator, options);
  const beforeClickMs = Math.max(0, resolveHumanRange(
    options.beforeClickMs,
    options.minBeforeClickMs,
    options.maxBeforeClickMs,
    DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS,
    DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS,
    { integer: true }
  ));
  if (beforeClickMs > 0) await page.waitForTimeout(beforeClickMs);
  await locator.click({ button: options.button || 'left', timeout: options.timeout || 10000 });
  return locator;
}

/**
 * Computes a per-character typing delay from a characters-per-minute range.
 *
 * @param {{ delayMs?: number, minCpm?: number, maxCpm?: number }} [options] Typing speed options.
 * @returns {number} Delay in milliseconds.
 */
export function humanTypeDelayMs(options = {}) {
  if (options.delayMs != null) return Math.max(0, Number(options.delayMs));
  const minCpm = Number(options.minCpm ?? DEFAULT_HUMAN_TYPE_MIN_CPM);
  const maxCpm = Number(options.maxCpm ?? DEFAULT_HUMAN_TYPE_MAX_CPM);
  const lower = Math.max(1, Math.min(minCpm, maxCpm));
  const upper = Math.max(lower, Math.max(minCpm, maxCpm));
  return Math.round(60000 / randomBetween(lower, upper));
}

/**
 * Clicks a target and types text with a human-paced per-character delay.
 *
 * The default speed is randomized between 250 and 270 characters per minute.
 * Pass `delayMs` for a fixed per-character delay or `minCpm`/`maxCpm` for a
 * different randomized typing range.
 *
 * @param {any} page Playwright page.
 * @param {string | any} target CSS selector, XPath, or locator.
 * @param {string} text Text to type.
 * @param {{ clear?: boolean, submit?: boolean, delayMs?: number, minCpm?: number, maxCpm?: number, timeout?: number }} [options] Typing options.
 * @returns {Promise<any>} Typed-into locator.
 */
export async function humanType(page, target, text, options = {}) {
  const locator = await resolveTarget(page, target, options);
  await humanClick(page, locator, options);
  if (options.clear) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  }
  for (const character of Array.from(String(text))) {
    await page.keyboard.type(character, { delay: 0 });
    const delayMs = humanTypeDelayMs(options);
    if (delayMs > 0) await page.waitForTimeout(delayMs);
  }
  if (options.submit) await page.keyboard.press('Enter');
  return locator;
}

/**
 * Scrolls the page with small wheel increments at a configurable pace.
 *
 * @param {any} page Playwright page.
 * @param {{ distance?: number, steps?: number, pauseMs?: number, pixelsPerSecond?: number, pauseJitter?: number }} [options] Scroll options.
 * @returns {Promise<void>}
 */
export async function humanScroll(page, options = {}) {
  const distance = options.distance ?? 700;
  const steps = options.steps || 7;
  const pixelsPerSecond = Math.max(1, Number(options.pixelsPerSecond ?? DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND));
  const pauseMs = options.pauseMs ?? Math.round((Math.abs(distance) / pixelsPerSecond * 1000) / steps);
  const pauseJitter = options.pauseMs == null ? (options.pauseJitter ?? DEFAULT_HUMAN_SCROLL_PAUSE_JITTER) : 0;
  const delta = distance / steps;
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, delta);
    const stepPauseMs = Math.round(jitterNumber(pauseMs, pauseJitter));
    if (stepPauseMs > 0) await page.waitForTimeout(stepPauseMs);
  }
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
  Manage the Cloak Browser runtime workspace and provide reusable browser
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
