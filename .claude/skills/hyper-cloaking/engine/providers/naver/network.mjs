import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

/**
 * Read actions eligible for Naver's normalized network execution strategy.
 */
const ACTIONS = Object.freeze([
  'searchWeb',
  'searchBlog',
  'searchCafe',
  'getBlogPost',
  'getBlogList',
  'getCafePost',
  'getCafeList'
]);

/**
 * Default promotion configuration for supported Naver read actions.
 */
export const naverReadPromotions = createReadPromotionDefaults(ACTIONS);

/**
 * Execute one supported Naver read action with its default or supplied
 * promotion settings.
 *
 * @param {object} [options] Read execution options.
 * @param {string} options.action Supported action name.
 * @param {object} [options.promotion] Action-specific promotion override.
 * @returns {*} Result from the normalized read strategy.
 * @throws {TypeError} When `action` is not supported by this provider.
 */
export function executeNaverRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(naverReadPromotions, action)) {
    throw new TypeError(`unsupported Naver read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? naverReadPromotions[action]
  });
}
