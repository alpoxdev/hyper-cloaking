import {
  DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS,
  DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS,
  DEFAULT_HUMAN_MOVE_MAX_STEPS,
  DEFAULT_HUMAN_MOVE_MIN_STEPS,
  DEFAULT_HUMAN_TARGET_MAX_RATIO,
  DEFAULT_HUMAN_TARGET_MIN_RATIO,
  resolveHumanRange,
  resolveTarget
} from './input-core.mjs';

export {
  DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS,
  DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS,
  DEFAULT_HUMAN_MOVE_MAX_STEPS,
  DEFAULT_HUMAN_MOVE_MIN_STEPS,
  DEFAULT_HUMAN_TARGET_MAX_RATIO,
  DEFAULT_HUMAN_TARGET_MIN_RATIO
} from './input-core.mjs';

/**
 * Moves the mouse in multiple steps to a coordinate or element interior.
 *
 * @param {any} page Playwright page.
 * @param {string | any | { x: number, y: number }} target CSS selector, XPath, locator, or coordinates.
 * @param {{ steps?: number, minSteps?: number, maxSteps?: number, ratioX?: number, ratioY?: number, minRatio?: number, maxRatio?: number, timeout?: number }} [options] Movement options.
 * @returns {Promise<{ x: number, y: number }>} Final pointer coordinates.
 */
export async function humanMove(page, target, options = {}) {
  const steps = Math.max(
    1,
    resolveHumanRange(
      options.steps,
      options.minSteps,
      options.maxSteps,
      DEFAULT_HUMAN_MOVE_MIN_STEPS,
      DEFAULT_HUMAN_MOVE_MAX_STEPS,
      { integer: true }
    )
  );
  if (typeof target === 'object' && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    await page.mouse.move(target.x, target.y, { steps });
    return { x: target.x, y: target.y };
  }
  const locator = await resolveTarget(page, target, options);
  const box = await locator.boundingBox();
  if (!box) throw new Error('Target has no bounding box');
  const minRatio = options.minRatio ?? DEFAULT_HUMAN_TARGET_MIN_RATIO;
  const maxRatio = options.maxRatio ?? DEFAULT_HUMAN_TARGET_MAX_RATIO;
  const ratioX =
    options.ratioX ?? resolveHumanRange(undefined, minRatio, maxRatio, minRatio, maxRatio);
  const ratioY =
    options.ratioY ?? resolveHumanRange(undefined, minRatio, maxRatio, minRatio, maxRatio);
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
  const beforeClickMs = Math.max(
    0,
    resolveHumanRange(
      options.beforeClickMs,
      options.minBeforeClickMs,
      options.maxBeforeClickMs,
      DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS,
      DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS,
      { integer: true }
    )
  );
  if (beforeClickMs > 0) await page.waitForTimeout(beforeClickMs);
  await locator.click({ button: options.button || 'left', timeout: options.timeout || 10000 });
  return locator;
}
