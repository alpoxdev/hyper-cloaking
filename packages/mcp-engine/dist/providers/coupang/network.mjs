/**
 * Read-only network contract: promotions select normalized strategies, while
 * execution returns a read result or throws on unsupported or unsafe requests.
 */
import { createReadPromotionDefaults, executeNormalizedReadStrategy } from '../network.mjs';

const ACTIONS = Object.freeze(['searchProducts', 'getProduct']);

/**
 * Default promotion settings for supported read actions.
 */
export const coupangReadPromotions = createReadPromotionDefaults(ACTIONS);

/**
 * Execute a promoted Coupang read.
 *
 * @param {object} [options] Read options.
 * @param {string} options.action Supported read action name.
 * @param {object} [options.promotion] Promotion override.
 * @returns {Promise<*>} Normalized read result.
 * @throws {TypeError} When the action is unsupported.
 * @throws {Error} When transport or safety rejects the read.
 */
export function executeCoupangRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(coupangReadPromotions, action)) {
    throw new TypeError(`unsupported Coupang read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? coupangReadPromotions[action]
  });
}
