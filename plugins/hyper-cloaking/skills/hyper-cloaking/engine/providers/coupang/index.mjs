/**
 * Public Coupang provider surface: metadata, guarded sessions, selectors,
 * read execution, and action handlers.
 */
export { coupangProvider } from './metadata.mjs';
export { buildCoupangSession } from './session.mjs';
export { coupangSelectors, COUPANG_SELECTORS_VERSION } from './selectors.mjs';
export { coupangReadPromotions, executeCoupangRead } from './network.mjs';

import { analyzeProducts } from './actions/analyze.mjs';
import {
  assertCartLineRef,
  assertOrderItemRef,
  assertProductRef,
  normalizeCartLineRef,
  normalizeOrderItemRef,
  normalizeProductRef
} from './actions/ids.mjs';
import { getProduct, searchProducts } from './actions/reads.mjs';
import {
  addToCart,
  blockedCoupangAction,
  removeCartItem,
  setCartQuantity,
  setSavedState,
  submitOwnOrderReview
} from './actions/writes.mjs';

/**
 * Canonical action registry. Handlers return action results or throw
 * provider safety and validation errors when rejected.
 */
export const coupangActions = {
  searchProducts,
  getProduct,
  analyzeProducts,
  addToCart,
  setCartQuantity,
  removeCartItem,
  setSavedState,
  submitOwnOrderReview,
  blockedCoupangAction,
  normalizeProductRef,
  normalizeCartLineRef,
  normalizeOrderItemRef
};

export {
  addToCart,
  analyzeProducts,
  assertCartLineRef,
  assertOrderItemRef,
  assertProductRef,
  blockedCoupangAction,
  getProduct,
  normalizeCartLineRef,
  normalizeOrderItemRef,
  normalizeProductRef,
  removeCartItem,
  searchProducts,
  setCartQuantity,
  setSavedState,
  submitOwnOrderReview
};
