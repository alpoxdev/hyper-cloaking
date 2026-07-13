/**
 * Read-only Coupang product data with bounded normalization and evidence checks.
 */
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { executeCoupangRead } from '../network.mjs';
import { coupangSelectors } from '../selectors.mjs';
import { assertProductRef, normalizeProductRef } from './ids.mjs';

const DEFAULT_LIMIT = 20;
const MAX_OUTPUT = 100;
const MAX_RAW = 400;

function limitFor(value, fallback = DEFAULT_LIMIT) {
  return Math.min(Number.isInteger(value) && value > 0 ? value : fallback, MAX_OUTPUT);
}

function boundedText(value, field, maximum) {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length > maximum) throw new TypeError(`Coupang ${field} exceeds ${maximum} characters`);
  return text || null;
}

function parseNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  if (Number.isFinite(value)) return Number(value);
  const normalized = String(value).replace(/[^0-9.-]/g, '');
  if (!normalized || !/[0-9]/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeProductEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Coupang product entries must be objects');
  }
  const ref = normalizeProductRef(entry);
  if (!ref)
    throw new TypeError('Coupang product entry contains an invalid owned-origin product reference');
  return {
    ...ref,
    title: boundedText(entry.title, 'product title', 2_000),
    price: parseNumber(entry.price),
    rating: parseNumber(entry.rating),
    reviewCount: parseNumber(entry.reviewCount),
    category: boundedText(entry.category, 'product category', 500)
  };
}

function normalizeSearchContent(value, { query, limit }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.products) ||
    value.products.length > MAX_RAW
  ) {
    throw new TypeError(`Coupang search content must contain at most ${MAX_RAW} products`);
  }
  const seen = new Set();
  const products = [];
  for (const entry of value.products) {
    const product = normalizeProductEntry(entry);
    if (seen.has(product.productId)) continue;
    seen.add(product.productId);
    products.push(product);
    if (products.length >= limit) break;
  }
  if (products.length === 0 && value.emptyState !== true) {
    throw new TypeError('Coupang empty search content requires explicit empty-state evidence');
  }
  return { query, count: products.length, products };
}

function normalizeProductContent(value, { product, includeReviews, limit }) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.reviews) ||
    value.reviews.length > MAX_RAW
  ) {
    throw new TypeError(`Coupang product content must contain at most ${MAX_RAW} reviews`);
  }
  if (value.present !== true) {
    throw new TypeError('Coupang product content requires explicit presence evidence');
  }
  if (includeReviews && value.reviews.length === 0 && value.reviewsEmptyState !== true) {
    throw new TypeError('Coupang empty review content requires explicit empty-state evidence');
  }
  const reviews = includeReviews
    ? value.reviews.slice(0, limit).map((review) => {
        if (!review || typeof review !== 'object' || Array.isArray(review)) {
          throw new TypeError('Coupang review entries must be objects');
        }
        return {
          reviewId: boundedText(review.reviewId, 'review ID', 128),
          author: boundedText(review.author, 'review author', 500),
          text: boundedText(review.text, 'review text', 20_000),
          rating: parseNumber(review.rating),
          timestamp: boundedText(review.timestamp, 'review timestamp', 100)
        };
      })
    : [];
  return {
    ...product,
    title: boundedText(value.title, 'product title', 2_000),
    price: parseNumber(value.price),
    rating: parseNumber(value.rating),
    reviewCount: parseNumber(value.reviewCount),
    category: boundedText(value.category, 'product category', 500),
    reviews
  };
}

/** Search Coupang products and return a normalized, bounded read payload. */
export async function searchProducts(session, query, opts = {}) {
  const searchQuery = String(query ?? '').trim();
  if (!searchQuery || searchQuery.length > 500)
    throw new TypeError('Coupang search query must contain 1-500 characters');
  const limit = limitFor(opts.limit);
  const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(searchQuery)}`;
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const rows = await session.page.$$eval(
      coupangSelectors.search.productLink,
      (nodes, selectors) =>
        nodes.slice(0, 400).map((link) => {
          const card = link.closest(selectors.productCard) || link;
          return {
            url: link.getAttribute('href'),
            title:
              card.querySelector(selectors.title)?.textContent?.trim() ||
              link.textContent?.trim() ||
              null,
            price: card.querySelector(selectors.price)?.textContent?.trim() || null
          };
        }),
      coupangSelectors.search
    );
    if (
      rows.length === 0 &&
      (await session.page.locator(coupangSelectors.search.emptyState).count()) === 0
    ) {
      throw new Error('Coupang search state could not be proven');
    }
    return { products: rows, emptyState: rows.length === 0 };
  };
  const { value } = await executeCoupangRead({
    action: 'searchProducts',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeSearchContent(content, { query: searchQuery, limit })
  });
  return wrapReadPayload({ url, kind: 'coupang-product-search', content: value });
}

/** Read one owned Coupang product and optionally include bounded reviews. */
export async function getProduct(session, productRef, opts = {}) {
  const product = assertProductRef(productRef);
  const includeReviews = opts.reviews !== false;
  const limit = limitFor(opts.reviewLimit);
  const dom = async () => {
    await session.navigateGuardedForRead(product.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    const title = await session.page.locator(coupangSelectors.product.title).first().textContent();
    if (!title?.trim()) throw new Error('Coupang product state could not be proven');
    const price = await session.page.locator(coupangSelectors.product.price).first().textContent();
    let reviews = [];
    let reviewsEmptyState = !includeReviews;
    if (includeReviews) {
      reviews = await session.page.$$eval(coupangSelectors.product.review, (nodes) =>
        nodes.slice(0, 400).map((node) => ({
          reviewId: node.getAttribute('data-review-id'),
          author:
            node
              .querySelector('[data-author], .sdp-review__article__list__info__user__name')
              ?.textContent?.trim() || null,
          text:
            node
              .querySelector('[data-review-text], .sdp-review__article__list__review__content')
              ?.textContent?.trim() ||
            node.textContent?.trim() ||
            null,
          rating: node.getAttribute('data-rating'),
          timestamp: node.querySelector('time')?.getAttribute('datetime') || null
        }))
      );
      reviewsEmptyState =
        reviews.length === 0 &&
        (await session.page.locator(coupangSelectors.product.reviewEmptyState).count()) > 0;
      if (reviews.length === 0 && !reviewsEmptyState)
        throw new Error('Coupang review state could not be proven');
    }
    return { title, price, reviews, reviewsEmptyState, present: true };
  };
  const { value } = await executeCoupangRead({
    action: 'getProduct',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeProductContent(content, { product, includeReviews, limit })
  });
  return wrapReadPayload({ url: product.url, kind: 'coupang-product', content: value });
}
