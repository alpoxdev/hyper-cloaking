import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

/**
 * Read operations supported by the normalized YouTube read strategy.
 *
 * This allowlist is also used to create per-action promotion defaults, keeping
 * unsupported action names from silently inheriting a generic read policy.
 */
const ACTIONS = Object.freeze(['searchVideos', 'getChannel', 'getVideo']);

/**
 * Default promotion policy for each supported YouTube read action.
 *
 * The defaults are generated centrally so YouTube uses the same normalized
 * read behavior as other providers.
 */
export const youtubeReadPromotions = createReadPromotionDefaults(ACTIONS);

/**
 * Execute a supported YouTube read with its action-specific default policy.
 *
 * @param {object} [options]
 * @param {string} options.action Read action name.
 * @param {object} [options.promotion] Override for the generated promotion.
 * @returns {*} The normalized read strategy result.
 * @throws {TypeError} If `action` is not in the YouTube read allowlist.
 */
export function executeYouTubeRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(youtubeReadPromotions, action)) {
    throw new TypeError(`unsupported YouTube read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? youtubeReadPromotions[action]
  });
}
