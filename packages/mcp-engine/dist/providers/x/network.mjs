/**
 * X read-operation promotions and normalized read execution entry point.
 * This module rejects actions outside the provider's explicitly supported list.
 */
import { createReadPromotionDefaults, executeNormalizedReadStrategy } from '../network.mjs';

const ACTIONS = Object.freeze([
  'searchPosts',
  'getPost',
  'getUser',
  'getUserPosts',
  'getThread',
  'listDMThreads',
  'readDMThread'
]);

export const xReadPromotions = createReadPromotionDefaults(ACTIONS);

/**
 * Execute one supported X read using its default or caller-supplied promotion.
 * @param {object} [options]
 * @param {string} options.action Supported read action name.
 * @returns {*} The normalized read strategy result.
 */
export function executeXRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(xReadPromotions, action)) {
    throw new TypeError(`unsupported X read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? xReadPromotions[action]
  });
}
