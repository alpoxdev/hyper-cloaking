import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze(['getSubreddit', 'getUserProfile', 'getPost']);

export const redditReadPromotions = createReadPromotionDefaults(ACTIONS);

export function executeRedditRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(redditReadPromotions, action)) {
    throw new TypeError(`unsupported Reddit read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? redditReadPromotions[action]
  });
}
