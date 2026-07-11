import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze([
  'searchWeb',
  'searchBlog',
  'searchCafe',
  'getBlogPost',
  'getBlogList',
  'getCafePost',
  'getCafeList'
]);

export const naverReadPromotions = createReadPromotionDefaults(ACTIONS);

export function executeNaverRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(naverReadPromotions, action)) {
    throw new TypeError(`unsupported Naver read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? naverReadPromotions[action]
  });
}
