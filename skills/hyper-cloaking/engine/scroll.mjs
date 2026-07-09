import {
  DEFAULT_HUMAN_SCROLL_PAUSE_JITTER,
  DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND,
  jitterNumber
} from './input-core.mjs';

export {
  DEFAULT_HUMAN_SCROLL_PAUSE_JITTER,
  DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND
} from './input-core.mjs';

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
