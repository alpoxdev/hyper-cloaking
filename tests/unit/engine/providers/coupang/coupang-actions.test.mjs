import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProviderSchema } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/schema.mjs';
import { NetworkReadError } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/network.mjs';
import { coupangProvider } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/coupang/metadata.mjs';
import { coupangReadPromotions } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/coupang/network.mjs';
import { analyzeProducts } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/coupang/actions/analyze.mjs';
import {
  normalizeCartLineRef,
  normalizeOrderItemRef,
  normalizeProductRef
} from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/coupang/actions/ids.mjs';
import {
  getProduct,
  searchProducts
} from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/coupang/actions/reads.mjs';
import {
  addToCart,
  blockedCoupangAction,
  setSavedState,
  submitOwnOrderReview
} from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/coupang/actions/writes.mjs';

function safety() {
  return { disposition: 'ok', reason: 'public-https', risks: [] };
}

function savedSession(stateDir, { saved = false, clickError = null } = {}) {
  let current = saved;
  let navigations = 0;
  const locator = (selector) => ({
    async count() {
      return selector.includes('aria-pressed="true"') ? (current ? 1 : 0) : 1;
    },
    first() {
      return this;
    }
  });
  return {
    stateDir,
    targetSafety: safety(),
    get navigations() {
      return navigations;
    },
    page: { locator },
    async navigateGuardedForWrite() {
      navigations += 1;
      this.targetSafety = safety();
    },
    async humanClick() {
      if (clickError) throw clickError;
      current = !current;
    }
  };
}

test('Coupang metadata stays schema-valid and separates short-link navigation', () => {
  assert.equal(validateProviderSchema(coupangProvider).ok, true);
  assert.deepEqual(coupangProvider.domains.allowedOrigins, [
    'https://www.coupang.com',
    'https://m.coupang.com'
  ]);
  assert.deepEqual(coupangProvider.domains.navigationOnlyAliases, ['link.coupang.com']);
  assert.equal(Object.hasOwn(coupangProvider, 'actions'), false);
});

test('Coupang IDs canonicalize owned refs and reject off-origin or incoherent handles', () => {
  assert.deepEqual(normalizeProductRef('https://m.coupang.com/vp/products/123?itemId=9'), {
    productId: '123',
    url: 'https://www.coupang.com/vp/products/123'
  });
  assert.equal(normalizeProductRef('https://evil.example/vp/products/123'), null);
  assert.equal(
    normalizeProductRef({ productId: '1', url: 'https://www.coupang.com/vp/products/2' }),
    null
  );
  assert.deepEqual(normalizeCartLineRef({ cartLineId: 'line-1', productId: '123' }), {
    cartLineId: 'line-1',
    productId: '123',
    url: 'https://www.coupang.com/cartView.pang'
  });
  assert.equal(
    normalizeOrderItemRef({
      orderItemId: 'order-1',
      productId: '123',
      url: 'https://evil.example/my-orders/1'
    }),
    null
  );
});

test('Coupang forced reads normalize whole bounded envelopes and explicit empties', async () => {
  const search = await searchProducts({}, 'laptop', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ products: [{ productId: '123', title: 'Laptop', price: '1,000원' }] })
    }
  });
  assert.deepEqual(search.content, {
    query: 'laptop',
    count: 1,
    products: [
      {
        productId: '123',
        url: 'https://www.coupang.com/vp/products/123',
        title: 'Laptop',
        price: 1000,
        rating: null,
        reviewCount: null,
        category: null
      }
    ]
  });

  const product = await getProduct(
    {},
    { productId: '123' },
    {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          title: 'Laptop',
          price: 1000,
          reviews: [],
          reviewsEmptyState: true,
          present: true
        })
      }
    }
  );
  assert.equal(product.content.productId, '123');
  assert.deepEqual(product.content.reviews, []);

  await assert.rejects(
    searchProducts({}, 'laptop', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ products: [] }) }
    }),
    /explicit empty-state/
  );
});

test('Coupang promotion defaults stay frozen-false and forced dispatch never falls back', async () => {
  assert.equal(Object.isFrozen(coupangReadPromotions), true);
  assert.deepEqual(coupangReadPromotions.searchProducts, {
    sanitizedFixtures: false,
    offlineParity: false,
    authorizedLiveReplay: false
  });
  await assert.rejects(
    searchProducts(
      {
        async navigateGuardedForRead() {
          assert.fail('DOM must not run');
        }
      },
      'fixture',
      {
        readStrategy: 'direct',
        readHandlers: {
          direct: async () => {
            throw new NetworkReadError('coupang-direct-failed', 'failed', { dispatched: true });
          }
        }
      }
    ),
    (error) => error.code === 'coupang-direct-failed'
  );
});

test('Coupang analysis remains bounded and truthful', () => {
  const analysis = analyzeProducts([
    { productId: '1', price: 100, rating: 4, reviewCount: 2, category: 'Tech' },
    { productId: '2', price: 300, rating: 5, reviewCount: 10, category: 'Tech' }
  ]);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.averagePrice, 200);
  assert.equal(analysis.averageRating, 4.5);
  assert.equal(analysis.topReviewed.productId, '2');
  assert.deepEqual(analysis.categories, [{ category: 'tech', count: 2 }]);
});

test('Coupang writes block before navigation unless dry-run, enable, and state gates pass', async () => {
  const session = {
    async navigateGuardedForWrite() {
      assert.fail('must not navigate');
    }
  };
  const dry = await setSavedState(session, { productId: '123' }, true);
  assert.equal(dry.blocked, true);
  assert.match(dry.reason, /dry-run/);

  const disabled = await setSavedState(session, { productId: '123' }, true, { dryRun: false });
  assert.equal(disabled.blocked, true);
  assert.match(disabled.reason, /enableSetSavedState/);

  const missingState = await setSavedState(session, { productId: '123' }, true, {
    dryRun: false,
    enableSetSavedState: true,
    runId: 'test'
  });
  assert.equal(missingState.blocked, true);
  assert.match(missingState.reason, /stateDir/);
});

test('Coupang desired saved writes reserve atomically and block ambiguous replay', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coupang-write-'));
  try {
    const session = savedSession(stateDir);
    const result = await setSavedState(session, { productId: '123' }, true, {
      dryRun: false,
      enableSetSavedState: true,
      runId: 'save-success'
    });
    assert.equal(result.performed, true);
    assert.equal(result.changed, true);

    const noOp = await setSavedState(session, { productId: '123' }, true, {
      dryRun: false,
      enableSetSavedState: true,
      runId: 'save-success'
    });
    assert.equal(noOp.alreadySatisfied, true);
    assert.equal(noOp.performed, false);

    const uncertainSession = savedSession(stateDir, { clickError: new Error('click uncertain') });
    const uncertain = await setSavedState(uncertainSession, { productId: '456' }, true, {
      dryRun: false,
      enableSetSavedState: true,
      runId: 'save-ambiguous'
    });
    assert.equal(uncertain.performed, false);
    assert.equal(uncertain.failure.stage, 'post-dispatch-uncertainty');

    const replay = await setSavedState(uncertainSession, { productId: '456' }, true, {
      dryRun: false,
      enableSetSavedState: true,
      runId: 'save-ambiguous'
    });
    assert.equal(replay.blocked, true);
    assert.match(replay.reason, /claim-ambiguous/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

function cartStateSession(stateDir, quantity) {
  const quantityLocator = {
    async count() {
      return 1;
    },
    first() {
      return this;
    },
    async inputValue() {
      return String(quantity);
    }
  };
  const line = {
    async count() {
      return quantity == null ? 0 : 1;
    },
    first() {
      return this;
    },
    async getAttribute(name) {
      return name === 'data-cart-item-id' ? 'line-1' : null;
    },
    locator() {
      return quantityLocator;
    }
  };
  return {
    stateDir,
    targetSafety: safety(),
    page: {
      locator(selector) {
        if (selector.includes('data-product-id')) return line;
        throw new Error(`unexpected selector: ${selector}`);
      }
    },
    async navigateGuardedForWrite() {
      this.targetSafety = safety();
    }
  };
}

test('Coupang add-to-cart routes existing and non-atomic quantities without dispatch', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coupang-cart-routing-'));
  try {
    const existing = await addToCart(cartStateSession(stateDir, 2), { productId: '123' }, 1, {
      dryRun: false,
      enableAddToCart: true,
      runId: 'cart-existing'
    });
    assert.match(existing.reason, /setCartQuantity/);

    const nonAtomic = await addToCart(cartStateSession(stateDir, null), { productId: '123' }, 2, {
      dryRun: false,
      enableAddToCart: true,
      runId: 'cart-non-atomic'
    });
    assert.match(nonAtomic.reason, /non-atomic/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('Coupang cart/review safety branches and structural blockers are exact', async () => {
  const noState = {
    async navigateGuardedForWrite() {
      assert.fail('must not navigate');
    }
  };
  const add = await addToCart(noState, { productId: '123' }, 2, {
    dryRun: false,
    enableAddToCart: true,
    runId: 'cart'
  });
  assert.equal(add.blocked, true);
  assert.match(add.reason, /stateDir/);

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coupang-review-'));
  try {
    let navigated = false;
    const review = await submitOwnOrderReview(
      {
        stateDir,
        interactive: false,
        async navigateGuardedForWrite() {
          navigated = true;
        }
      },
      {
        orderItemId: 'order-1',
        productId: '123',
        url: 'https://www.coupang.com/my-orders/1'
      },
      { text: 'Owned review', rating: 5 },
      {
        dryRun: false,
        enableSubmitOwnOrderReview: true,
        runId: 'review'
      }
    );
    assert.equal(review.blocked, true);
    assert.match(review.reason, /non-interactively/);
    assert.equal(navigated, false);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }

  const checkout = blockedCoupangAction('checkout');
  assert.equal(checkout.blocked, true);
  assert.match(checkout.reason, /structurally blocked/);
  assert.throws(() => blockedCoupangAction('searchProducts'), /unsupported/);
});
