import { createReadPromotionDefaults, executeNormalizedReadStrategy } from '../network.mjs';

const ACTIONS = Object.freeze([
  'getUser',
  'getUserVideos',
  'getVideo',
  'searchVideos',
  'listDMThreads',
  'readDMThread'
]);

/**
 * Supported TikTok read actions and their normalized network promotions.
 * Unknown actions fail synchronously with `TypeError`; strategy failures are
 * propagated so callers can distinguish transport, origin, and safety errors.
 */
export const tiktokReadPromotions = createReadPromotionDefaults(ACTIONS);
/**
 * Execute one normalized TikTok read.
 *
 * Returns the shared read-strategy result for the selected action and
 * promotion; malformed or unsupported actions throw `TypeError`.
 */

export function executeTikTokRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(tiktokReadPromotions, action)) {
    throw new TypeError(`unsupported TikTok read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? tiktokReadPromotions[action]
  });
}
