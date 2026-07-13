import {
  DEFAULT_HUMAN_TYPE_MAX_CPM,
  DEFAULT_HUMAN_TYPE_MIN_CPM,
  randomBetween,
  resolveTarget
} from './input-core.mjs';
import { humanClick } from './mouse.mjs';

export { DEFAULT_HUMAN_TYPE_MAX_CPM, DEFAULT_HUMAN_TYPE_MIN_CPM } from './input-core.mjs';

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
