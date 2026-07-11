import { createHash } from 'node:crypto';
import {
  finalizeGuardedAction,
  reserveGuardedAction,
  resolveConfirmationGate,
  resolveWriteGate
} from '../../../action-runtime/guardrails.mjs';
import { makeActionResult, makeBlockedResult } from '../../../action-runtime/action-result.mjs';
import { makeFailureDiagnostic } from '../../../diagnostics.mjs';
import { coupangSelectors } from '../selectors.mjs';
import { assertCartLineRef, assertOrderItemRef, assertProductRef } from './ids.mjs';

const FORBIDDEN_ACTIONS = new Set([
  'checkout', 'placeOrder', 'purchase', 'pay', 'payment', 'address', 'credential',
  'account', 'cancelOrder', 'returnOrder', 'couponAbuse', 'sellerOperation'
]);
const SAFE_RUN_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function invalidRef(action, error, stage) {
  return makeBlockedResult(action, error.message, { stage, requiresUserDecision: true });
}

function policyBlock(action, reason, stage = 'policy-disabled') {
  return makeBlockedResult(action, reason, { stage, requiresUserDecision: true });
}

function validateLiveWrite(session, action, opts, enableKey) {
  const gate = resolveWriteGate(opts);
  if (!gate.allowed) return makeBlockedResult(action, gate.reason, { dryRun: true, stage: 'dry-run' });
  if (opts[enableKey] !== true) return policyBlock(action, `${action} requires ${enableKey}:true`);
  if (typeof session.stateDir !== 'string' || !session.stateDir.trim()) {
    return policyBlock(action, 'persistent stateDir is required for real writes', 'state-required');
  }
  if (typeof opts.runId !== 'string' || !SAFE_RUN_ID_RE.test(opts.runId)) {
    return policyBlock(action, 'a safe explicit runId is required for real writes', 'run-id-required');
  }
  return null;
}

function successfulResult(session, action, text, url, rateLimit, { alreadySatisfied = false } = {}) {
  if (session.targetSafety?.disposition !== 'ok') {
    return policyBlock(action, 'target safety was not approved', 'target-safety');
  }
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text, url },
    criteria: [{ type: 'textIncludes', expected: text }],
    rateLimit,
    targetSafety: session.targetSafety,
    alreadySatisfied
  });
}

function uncertainResult(session, action, url, rateLimit, error) {
  return makeActionResult({
    action,
    dryRun: false,
    observation: { text: `${action} outcome uncertain`, url },
    criteria: [],
    rateLimit,
    targetSafety: session.targetSafety,
    performed: false,
    changed: false,
    failure: {
      ...makeFailureDiagnostic({
        stage: 'post-dispatch-uncertainty',
        layer: 'coupang-actions',
        attempted: ['dispatch once and verify the exact Coupang postcondition'],
        blockers: [error?.message || 'postcondition not proven'],
        remainingChecks: [],
        requiresUserDecision: true
      }),
      cause: { name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null }
    }
  });
}

async function reserve(session, { action, rateKey, maxPerWindow, target, content, runId }) {
  const targetHash = sha(target);
  const contentHash = sha(canonicalJson(content));
  const idempotencyHash = sha(canonicalJson({ action, contentHash, runId, targetHash }));
  const reservation = await reserveGuardedAction(session.stateDir, {
    actionType: rateKey,
    maxPerWindow,
    idempotencyHash,
    targetHash,
    contentHash,
    runId
  });
  return { ...reservation, idempotencyHash };
}

async function guardedDispatch(session, {
  action,
  rateKey,
  maxPerWindow,
  target,
  content,
  runId,
  dispatch,
  verify,
  successText
}) {
  if (session.targetSafety?.disposition !== 'ok') {
    return policyBlock(action, 'target safety was not approved', 'target-safety');
  }
  const reservation = await reserve(session, { action, rateKey, maxPerWindow, target, content, runId });
  if (!reservation.allowed) {
    return makeBlockedResult(action, `guarded write blocked: ${reservation.status}`, {
      stage: 'guarded-reservation',
      rateLimit: reservation.rateLimit,
      requiresUserDecision: reservation.status !== 'already-verified'
    });
  }
  try {
    await dispatch();
    const verified = await verify();
    if (!verified) throw new Error('Coupang postcondition was not proven');
    if (session.targetSafety?.disposition !== 'ok') throw new Error('target safety was not approved');
    const evidenceIdHash = sha(canonicalJson({ action, successText, target, verified: true }));
    await finalizeGuardedAction(session.stateDir, {
      idempotencyHash: reservation.idempotencyHash,
      state: 'verified',
      evidenceIdHash
    });
    return successfulResult(session, action, successText, target, reservation.rateLimit);
  } catch (error) {
    try {
      await finalizeGuardedAction(session.stateDir, {
        idempotencyHash: reservation.idempotencyHash,
        state: 'ambiguous'
      });
    } catch (finalizeError) {
      return uncertainResult(session, action, target, reservation.rateLimit, new AggregateError([error, finalizeError], 'dispatch and ambiguity persistence failed'));
    }
    return uncertainResult(session, action, target, reservation.rateLimit, error);
  }
}

async function count(page, selector) {
  return page.locator(selector).count();
}

async function waitForState(page, check, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (attempt + 1 < attempts) await page.waitForTimeout(200);
  }
  return false;
}

async function cartLineState(session, productId) {
  await session.navigateGuardedForWrite(coupangSelectors.cart.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const line = session.page.locator(`main [data-product-id="${productId}"]`);
  const lineCount = await line.count();
  if (lineCount > 1) throw new Error('Coupang cart product identity is ambiguous');
  if (lineCount === 0) return null;
  const cartLineId = await line.first().getAttribute('data-cart-item-id');
  const quantityLocator = line.first().locator(coupangSelectors.cart.quantity);
  if (await quantityLocator.count() !== 1) throw new Error('Coupang cart quantity identity is ambiguous');
  const quantityText = await quantityLocator.first().inputValue();
  const quantity = Number(quantityText);
  if (!cartLineId || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Coupang cart line state is malformed');
  return { cartLineId, quantity };
}

export async function addToCart(session, productRef, quantity = 1, opts = {}) {
  const action = 'coupang:addToCart';
  let product;
  try { product = assertProductRef(productRef); } catch (error) { return invalidRef(action, error, 'product-ref-validation'); }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return policyBlock(action, 'cart quantity must be an integer from 1 to 99', 'input-validation');
  const blocked = validateLiveWrite(session, action, opts, 'enableAddToCart');
  if (blocked) return blocked;
  const existing = await cartLineState(session, product.productId);
  if (existing?.quantity === quantity) {
    return successfulResult(session, action, 'cart already has desired product quantity', coupangSelectors.cart.url, null, { alreadySatisfied: true });
  }
  if (existing) return policyBlock(action, 'cart line exists with a different quantity; use setCartQuantity', 'quantity-routing');
  if (quantity !== 1) return policyBlock(action, 'non-atomic add quantity is unsupported; add one then use setCartQuantity', 'quantity-routing');
  await session.navigateGuardedForWrite(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const addControl = session.page.locator(coupangSelectors.product.addToCart);
  if (await addControl.count() !== 1) return policyBlock(action, 'owned add-to-cart control is not unique', 'selector-ownership');
  return guardedDispatch(session, {
    action, rateKey: 'coupang-cart', maxPerWindow: 20, target: product.url,
    content: { productId: product.productId, quantity }, runId: opts.runId,
    dispatch: () => session.humanClick(addControl.first()),
    verify: () => waitForState(session.page, async () => (await cartLineState(session, product.productId))?.quantity === 1),
    successText: 'product added to cart (state verified)'
  });
}

export async function setCartQuantity(session, cartLineRef, quantity, opts = {}) {
  const action = 'coupang:setCartQuantity';
  let line;
  try { line = assertCartLineRef(cartLineRef); } catch (error) { return invalidRef(action, error, 'cart-line-ref-validation'); }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return policyBlock(action, 'cart quantity must be an integer from 1 to 99', 'input-validation');
  const blocked = validateLiveWrite(session, action, opts, 'enableSetCartQuantity');
  if (blocked) return blocked;
  const existing = await cartLineState(session, line.productId);
  if (!existing || existing.cartLineId !== line.cartLineId) return policyBlock(action, 'owned cart line could not be proven', 'cart-line-state');
  if (existing.quantity === quantity) return successfulResult(session, action, 'cart quantity already satisfied', line.url, null, { alreadySatisfied: true });
  const direction = quantity > existing.quantity ? 'increment' : 'decrement';
  const steps = Math.abs(quantity - existing.quantity);
  if (steps !== 1) return policyBlock(action, 'multi-step quantity mutation is non-atomic; request one-unit transitions', 'non-atomic-quantity');
  const root = session.page.locator(`main [data-cart-item-id="${line.cartLineId}"]`).first();
  const quantityControl = root.locator(coupangSelectors.cart[direction]);
  if (await quantityControl.count() !== 1) return policyBlock(action, 'owned cart quantity control is not unique', 'selector-ownership');
  return guardedDispatch(session, {
    action, rateKey: 'coupang-cart', maxPerWindow: 20, target: line.url,
    content: { cartLineId: line.cartLineId, quantity }, runId: opts.runId,
    dispatch: () => session.humanClick(quantityControl.first()),
    verify: () => waitForState(session.page, async () => (await cartLineState(session, line.productId))?.quantity === quantity),
    successText: 'cart quantity updated (state verified)'
  });
}

export async function removeCartItem(session, cartLineRef, opts = {}) {
  const action = 'coupang:removeCartItem';
  let line;
  try { line = assertCartLineRef(cartLineRef); } catch (error) { return invalidRef(action, error, 'cart-line-ref-validation'); }
  const blocked = validateLiveWrite(session, action, opts, 'enableRemoveCartItem');
  if (blocked) return blocked;
  const existing = await cartLineState(session, line.productId);
  if (!existing) return successfulResult(session, action, 'cart item already absent', line.url, null, { alreadySatisfied: true });
  if (existing.cartLineId !== line.cartLineId) return policyBlock(action, 'owned cart line identity mismatch', 'cart-line-state');
  const root = session.page.locator(`main [data-cart-item-id="${line.cartLineId}"]`).first();
  const removeControl = root.locator(coupangSelectors.cart.remove);
  if (await removeControl.count() !== 1) return policyBlock(action, 'owned cart remove control is not unique', 'selector-ownership');
  return guardedDispatch(session, {
    action, rateKey: 'coupang-cart', maxPerWindow: 20, target: line.url,
    content: { cartLineId: line.cartLineId, absent: true }, runId: opts.runId,
    dispatch: () => session.humanClick(removeControl.first()),
    verify: () => waitForState(session.page, async () => (await cartLineState(session, line.productId)) === null),
    successText: 'cart item removed (state verified)'
  });
}

export async function setSavedState(session, productRef, saved, opts = {}) {
  const action = 'coupang:setSavedState';
  let product;
  try { product = assertProductRef(productRef); } catch (error) { return invalidRef(action, error, 'product-ref-validation'); }
  if (typeof saved !== 'boolean') return policyBlock(action, 'saved must be boolean', 'input-validation');
  const blocked = validateLiveWrite(session, action, opts, 'enableSetSavedState');
  if (blocked) return blocked;
  await session.navigateGuardedForWrite(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const isSaved = async () => count(session.page, coupangSelectors.product.unsave).then((value) => value === 1);
  if (await isSaved() === saved) return successfulResult(session, action, 'saved state already satisfied', product.url, null, { alreadySatisfied: true });
  const savedControl = session.page.locator(saved ? coupangSelectors.product.save : coupangSelectors.product.unsave);
  if (await savedControl.count() !== 1) return policyBlock(action, 'owned saved-state control is not unique', 'selector-ownership');
  return guardedDispatch(session, {
    action, rateKey: 'coupang-save', maxPerWindow: 20, target: product.url,
    content: { productId: product.productId, saved }, runId: opts.runId,
    dispatch: () => session.humanClick(savedControl.first()),
    verify: () => waitForState(session.page, async () => (await isSaved()) === saved),
    successText: 'saved state updated (state verified)'
  });
}

export async function submitOwnOrderReview(session, orderItemRef, review, opts = {}) {
  const action = 'coupang:submitOwnOrderReview';
  let item;
  try { item = assertOrderItemRef(orderItemRef); } catch (error) { return invalidRef(action, error, 'order-item-ref-validation'); }
  const text = String(review?.text ?? '').trim();
  const rating = Number(review?.rating);
  if (!text || text.length > 5_000 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return policyBlock(action, 'review requires text up to 5000 characters and an integer rating from 1 to 5', 'input-validation');
  }
  const blocked = validateLiveWrite(session, action, opts, 'enableSubmitOwnOrderReview');
  if (blocked) return blocked;
  const confirm = resolveConfirmationGate({ interactive: session.interactive, confirmed: opts.confirmed });
  if (!confirm.allowed) return policyBlock(action, confirm.reason, 'confirmation-gate');
  await session.navigateGuardedForWrite(item.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const eligible = session.page.locator(`${coupangSelectors.review.eligible}[data-order-item-id="${item.orderItemId}"]`);
  if (await eligible.count() !== 1) return policyBlock(action, 'eligible own-order review target could not be proven', 'review-eligibility');
  const reviewSelector = `[data-review-order-item-id="${item.orderItemId}"][data-review-id]`;
  const beforeReviewIds = new Set(
    await session.page.locator(reviewSelector).evaluateAll((nodes) => nodes
      .map((node) => node.getAttribute('data-review-id'))
      .filter(Boolean))
  );
  const ratingControl = session.page.locator(`${coupangSelectors.review.rating}[data-rating="${rating}"]`);
  const textControl = session.page.locator(coupangSelectors.review.text);
  const submitControl = session.page.locator(coupangSelectors.review.submit);
  if (await ratingControl.count() !== 1 || await textControl.count() !== 1 || await submitControl.count() !== 1) {
    return policyBlock(action, 'owned review controls are not unique', 'selector-ownership');
  }
  return guardedDispatch(session, {
    action, rateKey: 'coupang-review', maxPerWindow: 2, target: item.url,
    content: { orderItemId: item.orderItemId, rating, text }, runId: opts.runId,
    dispatch: async () => {
      await session.humanClick(ratingControl.first());
      await session.humanType(textControl.first(), text);
      await session.humanClick(submitControl.first());
    },
    verify: () => waitForState(session.page, async () => {
      const reviewIds = await session.page.locator(reviewSelector).evaluateAll((nodes) => nodes
        .map((node) => node.getAttribute('data-review-id'))
        .filter(Boolean));
      return reviewIds.some((reviewId) => !beforeReviewIds.has(reviewId));
    }),
    successText: 'own-order review submitted (state verified)'
  });
}

export function blockedCoupangAction(actionName) {
  const name = String(actionName ?? '');
  if (!FORBIDDEN_ACTIONS.has(name)) throw new TypeError(`unsupported Coupang structural blocker: ${name}`);
  return policyBlock(`coupang:${name}`, `${name} is structurally blocked for Coupang automation`, 'structural-blocker');
}
