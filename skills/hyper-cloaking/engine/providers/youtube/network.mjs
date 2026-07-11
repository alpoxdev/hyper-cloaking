import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze(['searchVideos', 'getChannel', 'getVideo']);

export const youtubeReadPromotions = createReadPromotionDefaults(ACTIONS);

export function executeYouTubeRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(youtubeReadPromotions, action)) {
    throw new TypeError(`unsupported YouTube read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? youtubeReadPromotions[action]
  });
}
