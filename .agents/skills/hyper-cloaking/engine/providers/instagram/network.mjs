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

export const instagramReadPromotions = createReadPromotionDefaults(ACTIONS);

export function executeInstagramRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(instagramReadPromotions, action)) {
    throw new TypeError(`unsupported Instagram read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? instagramReadPromotions[action]
  });
}
