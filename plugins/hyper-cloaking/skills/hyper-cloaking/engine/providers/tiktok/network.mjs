import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze([
  'getUser',
  'getUserVideos',
  'getVideo',
  'searchVideos',
  'listDMThreads',
  'readDMThread'
]);

export const tiktokReadPromotions = createReadPromotionDefaults(ACTIONS);

export function executeTikTokRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(tiktokReadPromotions, action)) {
    throw new TypeError(`unsupported TikTok read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? tiktokReadPromotions[action]
  });
}
