/**
 * Reddit read-promotion defaults and normalized read execution.
 */
import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze(['getSubreddit', 'getUserProfile', 'getPost']);

/** Read-action promotion policy keyed by the supported Reddit action name. */
export const redditReadPromotions = createReadPromotionDefaults(ACTIONS);

/**
 * Execute a normalized Reddit read using its action's promotion defaults.
 * @param {object} [options] Read options, including a supported `action` and
 * optional promotion override.
 * @returns {Promise<object>} Normalized read result from the shared strategy.
 * @throws {TypeError} When `action` is not a supported Reddit read action.
 */
export function executeRedditRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(redditReadPromotions, action)) {
    throw new TypeError(`unsupported Reddit read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? redditReadPromotions[action]
  });
}
