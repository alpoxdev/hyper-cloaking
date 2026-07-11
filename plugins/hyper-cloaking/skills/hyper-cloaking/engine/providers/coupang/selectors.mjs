/**
 * Canonical Coupang DOM selector contract. Action modules must fail closed
 * when required page structure or state drifts.
 */
// Centralized Coupang DOM selectors. Drift must fail closed in action code.

/**
 * Selector contract version; update when selectors change.
 */
export const COUPANG_SELECTORS_VERSION = '2026-07-11';

export const coupangSelectors = {
  search: {
    productLink: 'main a[href*="/vp/products/"]',
    productCard: 'main li.search-product, main [data-product-id]',
    title: '.name, [data-testid="product-title"]',
    price: '.price-value, [data-testid="product-price"]',
    emptyState: 'main [role="status"]:has-text("검색 결과가 없습니다"), main [role="status"]:has-text("No results")'
  },
  product: {
    title: 'main h1, main [data-testid="product-title"]',
    price: 'main .total-price strong, main [data-testid="product-price"]',
    review: 'main [data-review-id], main article.sdp-review__article__list',
    reviewEmptyState: 'main [role="status"]:has-text("상품평이 없습니다"), main [role="status"]:has-text("No reviews")',
    addToCart: 'main button:has-text("장바구니 담기"), main button:has-text("Add to Cart")',
    save: 'main button[aria-label*="찜"], main button[aria-label*="Save"]',
    unsave: 'main button[aria-pressed="true"][aria-label*="찜"], main button[aria-pressed="true"][aria-label*="Save"]'
  },
  cart: {
    url: 'https://www.coupang.com/cartView.pang',
    item: 'main [data-cart-item-id]',
    quantity: 'input[name="quantity"], [data-testid="cart-quantity"]',
    increment: 'button[aria-label*="증가"], button[aria-label*="Increase"]',
    decrement: 'button[aria-label*="감소"], button[aria-label*="Decrease"]',
    remove: 'button:has-text("삭제"), button:has-text("Remove")',
    emptyState: 'main [role="status"]:has-text("장바구니가 비어"), main [role="status"]:has-text("cart is empty")'
  },
  review: {
    eligible: 'main [data-review-eligible="true"]',
    orderItem: 'main [data-order-item-id]',
    text: 'main textarea[name="review"], main textarea[aria-label*="상품평"]',
    rating: 'main button[data-rating]',
    submit: 'main button:has-text("상품평 등록"), main button:has-text("Submit review")'
  }
};
