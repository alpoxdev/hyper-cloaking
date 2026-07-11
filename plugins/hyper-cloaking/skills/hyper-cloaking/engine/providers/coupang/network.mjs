import {
  createReadPromotionDefaults,
  executeNormalizedReadStrategy
} from '../network.mjs';

const ACTIONS = Object.freeze(['searchProducts', 'getProduct']);

export const coupangReadPromotions = createReadPromotionDefaults(ACTIONS);

export function executeCoupangRead({ action, promotion, ...options } = {}) {
  if (!Object.hasOwn(coupangReadPromotions, action)) {
    throw new TypeError(`unsupported Coupang read action: ${action}`);
  }
  return executeNormalizedReadStrategy({
    ...options,
    promotion: promotion ?? coupangReadPromotions[action]
  });
}
