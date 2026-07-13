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
export async function resolveTarget(page, target, options = {}) {
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
export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Returns a random integer in a closed range.
 *
 * @param {number} min Minimum value.
 * @param {number} max Maximum value.
 * @returns {number} Random integer between `min` and `max`.
 */
export function randomInteger(min, max) {
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
export function resolveHumanRange(exact, min, max, defaultMin, defaultMax, options = {}) {
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
export function jitterNumber(value, jitter) {
  const ratio = Math.max(0, Number(jitter));
  if (!ratio) return value;
  return value * randomBetween(1 - ratio, 1 + ratio);
}
