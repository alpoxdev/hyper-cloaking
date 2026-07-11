/**
 * Instagram read execution helpers backed by the normalized provider strategy.
 */
import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze([
  'getUser',
  'getUserPosts',
  'listDMThreads',
  'readDMThread'
]);

/**
 * Default promotion settings for the supported Instagram read actions.
 */
export const instagramReadPromotions = createReadPromotionDefaults(ACTIONS);

/**
 * Execute a supported Instagram read action with its default or supplied
 * promotion settings.
 *
 * @param {object} [options] Read request options.
 * @param {string} [options.action] Action name validated against the promotion map.
 * @param {object} [options.promotion] Optional promotion override.
 * @returns {*} The normalized read strategy result.
 * @throws {TypeError} If `action` is not a supported Instagram read action.
 */
export function executeInstagramRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(instagramReadPromotions, action)) {
    throw new TypeError(`unsupported Instagram read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? instagramReadPromotions[action]
  });
}
