/**
 * Normalize and validate Coupang-owned product, cart-line, and order-item
 * references before they reach browser actions.
 */
const PRODUCT_ID_RE = /^\d{1,32}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const COUPANG_HOSTS = new Set(['coupang.com', 'www.coupang.com', 'm.coupang.com']);

function ownedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://www.coupang.com');
    if (
      url.protocol !== 'https:'
      || !COUPANG_HOSTS.has(url.hostname)
      || url.username
      || url.password
      || url.port
    ) return null;
    return url;
  } catch {
    return null;
  }
}

/** Error raised when a Coupang reference fails ownership or shape validation. */
export class InvalidCoupangRefError extends Error {
  constructor(kind, ref) {
    super(`Invalid Coupang ${kind} reference: ${JSON.stringify(ref)}`);
    this.name = 'InvalidCoupangRefError';
    this.code = `invalid-coupang-${kind}-ref`;
    this.ref = ref;
  }
}

/** Return a canonical product reference, or null when the input is invalid. */
export function normalizeProductRef(ref) {
  const suppliedId = ref && typeof ref === 'object' && ref.productId != null
    ? String(ref.productId)
    : null;
  const rawUrl = typeof ref === 'string'
    ? ref
    : ref && typeof ref === 'object'
      ? ref.url || ref.href
      : null;
  const parsed = ownedUrl(rawUrl);
  const match = parsed?.pathname.match(/^\/vp\/products\/(\d{1,32})\/?$/);
  const urlId = match?.[1] || null;
  const productId = suppliedId || urlId;
  if (!productId || !PRODUCT_ID_RE.test(productId) || (suppliedId && urlId && suppliedId !== urlId)) return null;
  if (rawUrl != null && !urlId) return null;
  return {
    productId,
    url: `https://www.coupang.com/vp/products/${productId}`
  };
}

/** Require and return a canonical product reference. */
export function assertProductRef(ref) {
  const value = normalizeProductRef(ref);
  if (!value) throw new InvalidCoupangRefError('product', ref);
  return value;
}

/** Return a canonical cart-line reference, or null when the input is invalid. */
export function normalizeCartLineRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const cartLineId = String(ref.cartLineId ?? '');
  const product = normalizeProductRef({ productId: ref.productId });
  if (!OPAQUE_ID_RE.test(cartLineId) || !product) return null;
  if (ref.url != null) {
    const url = ownedUrl(ref.url);
    if (!url || url.pathname !== '/cartView.pang') return null;
  }
  return {
    cartLineId,
    productId: product.productId,
    url: 'https://www.coupang.com/cartView.pang'
  };
}

/** Require and return a canonical cart-line reference. */
export function assertCartLineRef(ref) {
  const value = normalizeCartLineRef(ref);
  if (!value) throw new InvalidCoupangRefError('cart-line', ref);
  return value;
}

/** Return a canonical order-item reference, or null when the input is invalid. */
export function normalizeOrderItemRef(ref) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const orderItemId = String(ref.orderItemId ?? '');
  const product = normalizeProductRef({ productId: ref.productId });
  const url = ownedUrl(ref.url);
  if (!OPAQUE_ID_RE.test(orderItemId) || !product || !url || !/^\/my-orders(?:\/|$)/.test(url.pathname)) return null;
  return {
    orderItemId,
    productId: product.productId,
    url: `https://www.coupang.com${url.pathname}`
  };
}

/** Require and return a canonical order-item reference. */
export function assertOrderItemRef(ref) {
  const value = normalizeOrderItemRef(ref);
  if (!value) throw new InvalidCoupangRefError('order-item', ref);
  return value;
}
