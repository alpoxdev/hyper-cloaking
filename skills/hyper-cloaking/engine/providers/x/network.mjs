import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

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

export function executeXRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(xReadPromotions, action)) {
    throw new TypeError(`unsupported X read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? xReadPromotions[action]
  });
}
