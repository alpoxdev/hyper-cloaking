import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NetworkReadError,
  canUseDomFallback,
  captureObservedPrivateResponse,
  chooseReadStrategy,
  createReadPromotionDefaults,
  executeNormalizedReadStrategy,
  executeReadStrategy,
  extractBoundedCursor,
  isolatedJsonGet,
  qualifyObservedPrivateRequest,
  readPromotionQualified,
  standardReadEnvelope,
  validateObservedPrivateCapability,
  withObservedPrivateReplay
} from '../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/network.mjs';
import {
  executeInstagramRead,
  instagramReadPromotions
} from '../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/instagram/network.mjs';
import {
  executeYouTubeRead,
  youtubeReadPromotions
} from '../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/youtube/network.mjs';

const promoted = {
  sanitizedFixtures: true,
  offlineParity: true,
  authorizedLiveReplay: true
};

function apiFixture({
  payload = { items: [{ id: 1 }] },
  status = 200,
  finalUrl = 'https://api.example.test/data',
  headers = {},
  body,
  getError,
  disposeError
} = {}) {
  const state = { contextDisposed: 0, responseDisposed: 0, options: null, requestOptions: null };
  const response = {
    url: () => finalUrl,
    status: () => status,
    headers: () => headers,
    body: async () => body ?? Buffer.from(JSON.stringify(payload)),
    async dispose() {
      state.responseDisposed += 1;
      if (disposeError === 'response') throw new Error('response dispose failed');
    }
  };
  const requestFactory = async (options) => {
    state.options = options;
    return {
      async get(url, requestOptions) {
        state.requestOptions = { url, ...requestOptions };
        if (getError) throw new Error(getError);
        return response;
      },
      async dispose() {
        state.contextDisposed += 1;
        if (disposeError === 'context') throw new Error('context dispose failed');
      }
    };
  };
  return { state, requestFactory };
}

function capability(overrides = {}) {
  return {
    provider: 'fixture',
    action: 'list',
    origin: 'https://api.example.test',
    path: '/data',
    query: {
      fixed: { mode: 'fixed', fixed: 'yes', required: true, maxLength: 10 },
      cursor: { mode: 'cursor', maxLength: 8 }
    },
    headers: {
      authorization: { mode: 'param', required: true, sensitive: true, maxLength: 100 }
    },
    limits: { ttlMs: 1000, maxUses: 2, maxBytes: 1024, maxRecords: 20 },
    cursorExtractor: (value) => value?.next ?? null,
    ...overrides
  };
}

function replayBinding(overrides = {}) {
  return {
    session: {},
    page: {},
    context: {},
    account: 'account-1',
    origin: 'https://api.example.test',
    provider: 'fixture',
    action: 'list',
    ...overrides
  };
}

test('read strategy remains DOM-default until all promotion evidence is present', async () => {
  assert.equal(readPromotionQualified(promoted), true);
  assert.equal(chooseReadStrategy({ available: { direct: true, dom: true } }), 'dom');
  assert.equal(
    chooseReadStrategy({ promotion: promoted, available: { direct: true, dom: true } }),
    'direct'
  );
  assert.throws(
    () => chooseReadStrategy({ requested: 'official', available: { dom: true } }),
    (error) => error.code === 'strategy-unavailable' && error.fallbackEligible === false
  );

  const fallback = new NetworkReadError('capability-absent', 'absent', {
    phase: 'pre-dispatch',
    fallbackEligible: true
  });
  assert.equal(canUseDomFallback(fallback), true);
  const result = await executeReadStrategy({
    promotion: promoted,
    handlers: {
      direct: async () => {
        throw fallback;
      },
      dom: async () => 'dom-result'
    }
  });
  assert.deepEqual(result, { strategy: 'dom', value: 'dom-result' });

  await assert.rejects(
    executeReadStrategy({
      promotion: promoted,
      handlers: {
        direct: async () => {
          throw new NetworkReadError('auth', 'auth failed', { dispatched: true });
        },
        dom: async () => 'must-not-run'
      }
    }),
    (error) => error.code === 'auth'
  );
});

test('normalized read strategies keep immutable DOM-default promotion and normalize every handler', async () => {
  const defaults = createReadPromotionDefaults(['fixture']);
  assert.equal(Object.isFrozen(defaults), true);
  assert.deepEqual(defaults.fixture, {
    sanitizedFixtures: false,
    offlineParity: false,
    authorizedLiveReplay: false
  });
  let domCalls = 0;
  let directCalls = 0;
  const fallback = await executeNormalizedReadStrategy({
    promotion: defaults.fixture,
    handlers: {
      direct: async () => {
        directCalls += 1;
        return { rows: ['direct'] };
      }
    },
    dom: async () => {
      domCalls += 1;
      return { rows: ['dom'] };
    },
    normalize: (value) => ({ rows: [...value.rows] })
  });
  assert.deepEqual(fallback, { strategy: 'dom', value: { rows: ['dom'] } });
  assert.equal(domCalls, 1);
  assert.equal(directCalls, 0);

  const forced = await executeNormalizedReadStrategy({
    requested: 'direct',
    handlers: { direct: async () => ({ rows: ['direct'] }) },
    dom: async () => ({ rows: ['dom'] }),
    normalize: (value, { strategy }) => ({ rows: value.rows, strategy })
  });
  assert.deepEqual(forced, {
    strategy: 'direct',
    value: { rows: ['direct'], strategy: 'direct' }
  });
  await assert.rejects(
    executeNormalizedReadStrategy({
      requested: 'direct',
      handlers: {
        direct: async () => {
          throw new NetworkReadError('direct-failed', 'failed', { dispatched: true });
        }
      },
      dom: async () => ({ rows: ['must-not-run'] }),
      normalize: (value) => value
    }),
    (error) => error.code === 'direct-failed'
  );
  await assert.rejects(
    executeNormalizedReadStrategy({
      handlers: { typo: async () => ({}) },
      dom: async () => ({}),
      normalize: (value) => value
    }),
    /unsupported read handler/
  );
});

test('provider dispatchers freeze false defaults, forward observers, and reject unsupported actions', async () => {
  const providers = [
    {
      execute: executeInstagramRead,
      promotions: instagramReadPromotions,
      actions: ['getUser', 'getUserPosts', 'listDMThreads', 'readDMThread']
    },
    {
      execute: executeYouTubeRead,
      promotions: youtubeReadPromotions,
      actions: ['searchVideos', 'getChannel', 'getVideo']
    }
  ];

  for (const provider of providers) {
    assert.equal(Object.isFrozen(provider.promotions), true);
    assert.deepEqual(Object.keys(provider.promotions), provider.actions);
    for (const action of provider.actions) {
      assert.equal(Object.isFrozen(provider.promotions[action]), true);
      assert.deepEqual(provider.promotions[action], {
        sanitizedFixtures: false,
        offlineParity: false,
        authorizedLiveReplay: false
      });

      const events = [];
      const result = await provider.execute({
        action,
        dom: async () => ({ source: action }),
        normalize: (value, context) => ({ ...value, strategy: context.strategy }),
        observer: (event) => events.push(event)
      });
      assert.deepEqual(result, {
        strategy: 'dom',
        value: { source: action, strategy: 'dom' }
      });
      assert.deepEqual(events, [
        { phase: 'dispatch', strategy: 'dom', status: 'started', code: null },
        { phase: 'dispatch', strategy: 'dom', status: 'passed', code: null }
      ]);

      for (const promotion of [
        {},
        { sanitizedFixtures: true },
        { sanitizedFixtures: true, offlineParity: true }
      ]) {
        const incomplete = await provider.execute({
          action,
          promotion,
          handlers: { direct: async () => ({ source: 'direct' }) },
          dom: async () => ({ source: 'dom' }),
          normalize: (value) => value
        });
        assert.equal(incomplete.strategy, 'dom');
      }

      const qualified = await provider.execute({
        action,
        promotion: promoted,
        handlers: { direct: async () => ({ source: 'direct' }) },
        dom: async () => ({ source: 'dom' }),
        normalize: (value) => value
      });
      assert.deepEqual(qualified, {
        strategy: 'direct',
        value: { source: 'direct' }
      });
    }

    for (let index = 1; index < provider.actions.length; index += 1) {
      assert.notEqual(
        provider.promotions[provider.actions[index - 1]],
        provider.promotions[provider.actions[index]]
      );
    }

    assert.throws(
      () =>
        provider.execute({
          action: 'unsupported',
          dom: async () => ({}),
          normalize: (value) => value
        }),
      /unsupported .* read action/i
    );
  }
});

test('every allowlisted normalized network handler passes through the action normalizer', async () => {
  for (const strategy of ['official', 'direct', 'private-replay', 'capture']) {
    const result = await executeNormalizedReadStrategy({
      requested: strategy,
      handlers: {
        [strategy]: async () => ({ raw: strategy })
      },
      dom: async () => ({ raw: 'dom' }),
      normalize: (value, context) => ({
        value: value.raw,
        normalizedBy: context.strategy
      })
    });
    assert.deepEqual(result, {
      strategy,
      value: { value: strategy, normalizedBy: strategy }
    });
  }
});

test('standard read envelope preserves the provider-neutral content contract', () => {
  assert.deepEqual(
    standardReadEnvelope({ url: 'https://example.test', kind: 'fixture-read', content: [1] }),
    {
      trusted: false,
      instructionAuthority: 'none',
      source: { url: 'https://example.test', kind: 'fixture-read' },
      content: [1]
    }
  );
});

test('isolated GET uses a module-owned context with exact cookies, headers, and disposal', async () => {
  const fixture = apiFixture();
  const output = await isolatedJsonGet({
    requestFactory: fixture.requestFactory,
    url: 'https://api.example.test/data/items',
    allowedOrigins: ['https://api.example.test'],
    cookies: [
      { name: 'exact', value: 'one', domain: '.api.example.test' },
      { name: 'urlExact', value: 'four', url: 'https://api.example.test/data/login' },
      { name: 'parent', value: 'two', domain: '.example.test' },
      { name: 'other', value: 'three', url: 'https://other.test' }
    ],
    staticHeaders: { accept: 'application/json' },
    copiedHeaders: { authorization: 'Bearer private' },
    allowedCopiedHeaders: ['authorization']
  });

  assert.deepEqual(output, { items: [{ id: 1 }] });
  assert.deepEqual(
    fixture.state.options.storageState.cookies.map((cookie) => cookie.name),
    ['exact', 'urlExact']
  );
  assert.deepEqual(fixture.state.options.storageState.cookies[0], {
    name: 'exact',
    value: 'one',
    domain: 'api.example.test',
    path: '/'
  });
  assert.deepEqual(fixture.state.options.storageState.cookies[1], {
    name: 'urlExact',
    value: 'four',
    domain: 'api.example.test',
    path: '/data/'
  });
  assert.equal(fixture.state.options.extraHTTPHeaders.authorization, 'Bearer private');
  assert.deepEqual(fixture.state.requestOptions, {
    url: 'https://api.example.test/data/items',
    timeout: 15_000,
    maxRedirects: 0
  });
  assert.equal(fixture.state.responseDisposed, 1);
  assert.equal(fixture.state.contextDisposed, 1);
});

test('isolated GET applies RFC cookie path boundaries', async () => {
  const fixture = apiFixture();
  await isolatedJsonGet({
    requestFactory: fixture.requestFactory,
    url: 'https://api.example.test/database',
    allowedOrigins: ['https://api.example.test'],
    cookies: [
      { name: 'sibling', value: 'must-not-send', domain: 'api.example.test', path: '/data' },
      { name: 'parent', value: 'send', domain: 'api.example.test', path: '/' }
    ]
  });
  assert.deepEqual(
    fixture.state.options.storageState.cookies.map((cookie) => cookie.name),
    ['parent']
  );
  const trailingFixture = apiFixture();
  await isolatedJsonGet({
    requestFactory: trailingFixture.requestFactory,
    url: 'https://api.example.test/unrelated/path',
    allowedOrigins: ['https://api.example.test'],
    cookies: [
      { name: 'private', value: 'must-not-send', domain: 'api.example.test', path: '/private/' },
      { name: 'root', value: 'send', domain: 'api.example.test', path: '/' }
    ]
  });
  assert.deepEqual(
    trailingFixture.state.options.storageState.cookies.map((cookie) => cookie.name),
    ['root']
  );
});

test('isolated GET is independent of page fetch and service workers', async () => {
  const page = {
    evaluate() {
      throw new Error('page fetch must not run');
    },
    context() {
      return { serviceWorkers: () => [{ active: true }] };
    }
  };
  const fixture = apiFixture({ payload: { pageIndependent: true } });
  const value = await isolatedJsonGet({
    requestFactory: fixture.requestFactory,
    url: 'https://api.example.test/data',
    allowedOrigins: ['https://api.example.test']
  });
  assert.equal(value.pageIndependent, true);
  assert.equal(typeof page.evaluate, 'function');
});

test('isolated GET rejects origins, redirects, status, size, UTF-8, JSON and structure caps', async () => {
  await assert.rejects(
    isolatedJsonGet({
      requestFactory: apiFixture().requestFactory,
      url: 'https://outside.test/data',
      allowedOrigins: ['https://api.example.test']
    }),
    (error) => error.code === 'origin-not-allowed' && error.dispatched === false
  );
  for (const [fixtureOptions, expected, options = {}] of [
    [{ finalUrl: 'https://outside.test/data' }, 'redirect-disallowed'],
    [{ status: 401 }, 'network-auth'],
    [{ status: 429 }, 'network-rate-limit'],
    [{ headers: { 'content-length': '999' } }, 'response-size-advisory', { maxBytes: 20 }],
    [{ body: Buffer.alloc(30) }, 'response-size-cap', { maxBytes: 20 }],
    [{ body: Buffer.from([0xff]) }, 'response-utf8-invalid'],
    [{ body: Buffer.from('{bad') }, 'response-json-invalid'],
    [
      { payload: { rows: Array.from({ length: 10 }, () => ({ id: 1 })) } },
      'response-record-cap',
      { maxRecords: 5 }
    ]
  ]) {
    await assert.rejects(
      isolatedJsonGet({
        requestFactory: apiFixture(fixtureOptions).requestFactory,
        url: 'https://api.example.test/data',
        allowedOrigins: ['https://api.example.test'],
        ...options
      }),
      (error) => error.code === expected && error.dispatched === true,
      expected
    );
  }
});

test('isolated GET rejects undeclared/hop headers and surfaces cleanup failures', async () => {
  await assert.rejects(
    isolatedJsonGet({
      requestFactory: apiFixture().requestFactory,
      url: 'https://api.example.test/data',
      allowedOrigins: ['https://api.example.test'],
      copiedHeaders: { authorization: 'secret' }
    }),
    /not allowlisted/
  );
  await assert.rejects(
    isolatedJsonGet({
      requestFactory: apiFixture().requestFactory,
      url: 'https://api.example.test/data',
      allowedOrigins: ['https://api.example.test'],
      staticHeaders: { connection: 'close' }
    }),
    /forbidden static header/
  );
  await assert.rejects(
    isolatedJsonGet({
      requestFactory: apiFixture({ disposeError: 'context' }).requestFactory,
      url: 'https://api.example.test/data',
      allowedOrigins: ['https://api.example.test']
    }),
    AggregateError
  );
});

test('private capability validates exact path, bounded lease, query and headers', () => {
  const validated = validateObservedPrivateCapability(capability());
  assert.equal(validated.origin, 'https://api.example.test');
  assert.equal(validated.limits.maxUses, 2);
  const qualified = qualifyObservedPrivateRequest({
    capability: validated,
    method: 'GET',
    url: 'https://api.example.test/data?fixed=yes',
    headers: { authorization: 'Bearer sensitive', connection: 'ignored' }
  });
  assert.equal(qualified.url, 'https://api.example.test/data?fixed=yes');
  assert.equal(qualified.copiedHeaders.authorization, 'Bearer sensitive');
  assert.throws(
    () => validateObservedPrivateCapability(capability({ limits: { ttlMs: 60_001 } })),
    /at most 60000/
  );
  assert.throws(
    () =>
      qualifyObservedPrivateRequest({
        capability: validated,
        method: 'POST',
        url: qualified.url,
        headers: { authorization: 'x' }
      }),
    (error) => error.code === 'private-method-disallowed'
  );
  assert.throws(
    () =>
      qualifyObservedPrivateRequest({
        capability: validated,
        method: 'GET',
        url: `${qualified.url}&extra=1`,
        headers: { authorization: 'x' }
      }),
    (error) => error.code === 'private-query-undeclared'
  );
});
test('fixed private headers, cursor cardinality, and page-one cursor absence are enforced', () => {
  const fixed = capability({
    headers: {
      'x-tenant': { mode: 'fixed', fixed: 'owned', required: true, maxLength: 20 }
    }
  });
  assert.equal(
    qualifyObservedPrivateRequest({
      capability: fixed,
      method: 'GET',
      url: 'https://api.example.test/data?fixed=yes',
      headers: { 'x-tenant': 'owned' }
    }).copiedHeaders['x-tenant'],
    'owned'
  );
  assert.throws(
    () =>
      qualifyObservedPrivateRequest({
        capability: fixed,
        method: 'GET',
        url: 'https://api.example.test/data',
        headers: { 'x-tenant': 'owned' }
      }),
    (error) => error.code === 'private-query-required'
  );
  assert.throws(
    () =>
      qualifyObservedPrivateRequest({
        capability: fixed,
        method: 'GET',
        url: 'https://api.example.test/data?fixed=yes',
        headers: { 'x-tenant': 'other' }
      }),
    (error) => error.code === 'private-header-fixed-mismatch'
  );
  assert.throws(
    () =>
      validateObservedPrivateCapability(
        capability({
          headers: { page: { mode: 'cursor' } }
        })
      ),
    /mode is invalid/
  );
  assert.throws(
    () =>
      validateObservedPrivateCapability(
        capability({
          query: {
            first: { mode: 'cursor' },
            second: { mode: 'cursor' }
          }
        })
      ),
    /at most one cursor/
  );
  assert.throws(
    () =>
      qualifyObservedPrivateRequest({
        capability: capability(),
        method: 'GET',
        url: 'https://api.example.test/data?fixed=yes&cursor=next',
        headers: { authorization: 'x' },
        pageOne: true
      }),
    (error) => error.code === 'private-page-one-cursor'
  );
  assert.throws(
    () =>
      validateObservedPrivateCapability(
        capability({
          query: { fixed: { mode: 'fixed', required: true, maxLength: 10 } }
        })
      ),
    /fixed must be a non-empty/
  );
  assert.throws(
    () =>
      validateObservedPrivateCapability(
        capability({
          headers: { 'x-fixed': { mode: 'fixed', fixed: 'too-long', maxLength: 3 } }
        })
      ),
    /exceeds maxLength/
  );
});

test('observed-private lease binds identity, expiry, use count, and outer lifetime', async () => {
  const binding = replayBinding();
  const cap = capability();
  const fixture = apiFixture({ payload: { page: 2 } });
  let clock = 100;
  let escaped;
  const sourceTemplate = {
    method: 'GET',
    url: 'https://api.example.test/data?fixed=yes',
    headers: { authorization: 'Bearer sensitive' },
    page1: { page: 1 }
  };
  await assert.rejects(
    withObservedPrivateReplay(
      {
        binding: replayBinding(),
        capability: cap,
        template: Object.freeze({
          method: 'GET',
          url: 'https://api.example.test/data?fixed=yes',
          headers: Object.freeze({ authorization: 'frozen-secret' })
        }),
        requestFactory: fixture.requestFactory,
        now: () => clock
      },
      async () => 'never'
    ),
    /must be mutable/
  );
  await withObservedPrivateReplay(
    {
      binding,
      capability: cap,
      template: sourceTemplate,
      requestFactory: fixture.requestFactory,
      now: () => clock
    },
    async (client) => {
      escaped = client;
      assert.equal(sourceTemplate.url, null);
      assert.equal(sourceTemplate.headers, null);
      await assert.rejects(
        withObservedPrivateReplay(
          {
            binding: { ...binding },
            capability: cap,
            template: {
              method: 'GET',
              url: 'https://api.example.test/data?fixed=yes',
              headers: { authorization: 'nested-secret' }
            },
            requestFactory: fixture.requestFactory,
            now: () => clock
          },
          async () => 'never'
        ),
        /already owns/
      );
      assert.deepEqual(client.page1, { page: 1 });
      assert.deepEqual(await client.replay(), { page: 2 });
      assert.equal(client.usesRemaining, 1);
      await assert.rejects(
        client.replay({ binding: { ...binding, account: 'other' } }),
        (error) => error.code === 'private-lease-binding'
      );
      assert.deepEqual(await client.replay(), { page: 2 });
      await assert.rejects(client.replay(), (error) => error.code === 'private-lease-exhausted');
    }
  );
  await assert.rejects(escaped.replay(), (error) => error.code === 'private-lease-inactive');
  await assert.rejects(
    withObservedPrivateReplay(
      {
        binding: replayBinding(),
        capability: cap,
        template: {
          method: 'GET',
          url: 'https://api.example.test/data?fixed=yes&cursor=page2',
          headers: { authorization: 'x' }
        },
        requestFactory: fixture.requestFactory
      },
      async () => 'never'
    ),
    (error) => error.code === 'private-page-one-cursor'
  );

  clock = 5000;
  await assert.rejects(
    withObservedPrivateReplay(
      {
        binding: replayBinding(),
        capability: cap,
        template: {
          method: 'GET',
          url: 'https://api.example.test/data?fixed=yes',
          headers: { authorization: 'x' }
        },
        requestFactory: fixture.requestFactory,
        now: (() => {
          let call = 0;
          return () => (call++ === 0 ? 0 : clock);
        })()
      },
      (client) => client.replay()
    ),
    (error) => error.code === 'private-lease-expired'
  );
  const boundaryBinding = replayBinding();
  let boundaryClock = 100;
  await assert.rejects(
    withObservedPrivateReplay(
      {
        binding: boundaryBinding,
        capability: cap,
        template: {
          method: 'GET',
          url: 'https://api.example.test/data?fixed=yes',
          headers: { authorization: 'x' }
        },
        requestFactory: fixture.requestFactory,
        now: () => boundaryClock
      },
      async (client) => {
        boundaryClock = 1100;
        return client.replay();
      }
    ),
    (error) => error.code === 'private-lease-expired'
  );
  const rollbackBinding = replayBinding();
  let rollbackClock = 100;
  await assert.rejects(
    withObservedPrivateReplay(
      {
        binding: rollbackBinding,
        capability: cap,
        template: {
          method: 'GET',
          url: 'https://api.example.test/data?fixed=yes',
          headers: { authorization: 'x' }
        },
        requestFactory: fixture.requestFactory,
        now: () => rollbackClock
      },
      async (client) => {
        rollbackClock = 99;
        return client.replay();
      }
    ),
    (error) => error.code === 'private-lease-expired'
  );

  const partialRollbackBinding = replayBinding();
  let partialClock = 100;
  await assert.rejects(
    withObservedPrivateReplay(
      {
        binding: partialRollbackBinding,
        capability: capability({
          limits: { ttlMs: 1000, maxUses: 3, maxBytes: 1024, maxRecords: 20 }
        }),
        template: {
          method: 'GET',
          url: 'https://api.example.test/data?fixed=yes',
          headers: { authorization: 'x' }
        },
        requestFactory: fixture.requestFactory,
        now: () => partialClock
      },
      async (client) => {
        partialClock = 500;
        await client.replay();
        partialClock = 400;
        return client.replay();
      }
    ),
    (error) => error.code === 'private-lease-expired'
  );
});

test('cursor extractors return one bounded opaque cursor', () => {
  assert.equal(extractBoundedCursor(capability(), { next: 'abc' }), 'abc');
  assert.equal(extractBoundedCursor(capability(), {}), null);
  assert.throws(
    () => extractBoundedCursor(capability(), { next: 'toolong-cursor' }),
    (error) => error.code === 'private-cursor-length'
  );
});

function eventPage() {
  const listeners = { request: new Set(), response: new Set() };
  return {
    on(name, handler) {
      listeners[name].add(handler);
    },
    off(name, handler) {
      listeners[name].delete(handler);
    },
    emit(name, value) {
      for (const handler of listeners[name]) handler(value);
    },
    counts() {
      return { request: listeners.request.size, response: listeners.response.size };
    }
  };
}

function exchange(
  page,
  {
    suffix = '',
    status = 200,
    delayedHeaders = false,
    responseDelayMs = 0,
    bodyDelayMs = 0,
    emitResponse = true
  } = {}
) {
  const request = {
    method: () => 'GET',
    url: () => `https://api.example.test/data?fixed=yes${suffix}`,
    allHeaders: async () => {
      if (delayedHeaders) await new Promise((resolve) => setTimeout(resolve, 1));
      return { authorization: 'Bearer private' };
    }
  };
  const response = {
    request: () => request,
    status: () => status,
    body: async () => {
      if (bodyDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, bodyDelayMs));
      return Buffer.from(JSON.stringify({ rows: [suffix || 'page1'] }));
    }
  };
  page.emit('request', request);
  if (emitResponse) {
    if (responseDelayMs > 0) setTimeout(() => page.emit('response', response), responseDelayMs);
    else page.emit('response', response);
  }
}

test('capture correlates one request/response despite header races and cleans listeners', async () => {
  const page = eventPage();
  const session = {
    async navigateGuardedForRead() {
      exchange(page, { delayedHeaders: true });
      return { url: 'https://api.example.test/data', status: 200 };
    }
  };
  const result = await captureObservedPrivateResponse({
    page,
    session,
    capability: capability(),
    targetUrl: 'https://api.example.test/data'
  });
  assert.deepEqual(result.page1, { rows: ['page1'] });
  assert.equal(result.template.headers.authorization, 'Bearer private');
  assert.deepEqual(page.counts(), { request: 0, response: 0 });
});
test('capture waits for a delayed correlated response and hard-stops when it never arrives', async () => {
  const delayedPage = eventPage();
  const delayed = await captureObservedPrivateResponse({
    page: delayedPage,
    session: {
      async navigateGuardedForRead() {
        exchange(delayedPage, { responseDelayMs: 10 });
      }
    },
    capability: capability(),
    targetUrl: 'https://api.example.test/data',
    responseTimeoutMs: 100
  });
  assert.deepEqual(delayed.page1, { rows: ['page1'] });

  const lateRequestPage = eventPage();
  const lateRequest = await captureObservedPrivateResponse({
    page: lateRequestPage,
    session: {
      async navigateGuardedForRead() {
        setTimeout(() => exchange(lateRequestPage), 10);
      }
    },
    capability: capability(),
    targetUrl: 'https://api.example.test/data',
    responseTimeoutMs: 100,
    requestSettleMs: 20
  });
  assert.deepEqual(lateRequest.page1, { rows: ['page1'] });

  const lateSecondPage = eventPage();
  await assert.rejects(
    captureObservedPrivateResponse({
      page: lateSecondPage,
      session: {
        async navigateGuardedForRead() {
          exchange(lateSecondPage);
          setTimeout(() => exchange(lateSecondPage), 10);
        }
      },
      capability: capability(),
      targetUrl: 'https://api.example.test/data',
      responseTimeoutMs: 100,
      requestSettleMs: 25
    }),
    (error) => error.code === 'private-capture-ambiguous' && error.dispatched === true
  );

  const missingPage = eventPage();
  await assert.rejects(
    captureObservedPrivateResponse({
      page: missingPage,
      session: {
        async navigateGuardedForRead() {
          exchange(missingPage, { emitResponse: false });
        }
      },
      capability: capability(),
      targetUrl: 'https://api.example.test/data',
      responseTimeoutMs: 10
    }),
    (error) =>
      error.code === 'private-response-timeout' &&
      error.dispatched === true &&
      !canUseDomFallback(error)
  );

  const hangingBodyPage = eventPage();
  const startedAt = Date.now();
  await assert.rejects(
    captureObservedPrivateResponse({
      page: hangingBodyPage,
      session: {
        async navigateGuardedForRead() {
          exchange(hangingBodyPage, { bodyDelayMs: 500 });
        }
      },
      capability: capability(),
      targetUrl: 'https://api.example.test/data',
      responseTimeoutMs: 10
    }),
    (error) => error.code === 'private-response-timeout' && error.dispatched === true
  );
  assert.ok(Date.now() - startedAt < 200, 'capture timeout must bound response body work');
});

test('capture distinguishes true no-match from post-dispatch ambiguity and failures', async () => {
  const noMatchPage = eventPage();
  await assert.rejects(
    captureObservedPrivateResponse({
      page: noMatchPage,
      session: { async navigateGuardedForRead() {} },
      capability: capability(),
      targetUrl: 'https://api.example.test/data',
      responseTimeoutMs: 10
    }),
    (error) => error.code === 'private-no-match' && canUseDomFallback(error)
  );

  const ambiguousPage = eventPage();
  await assert.rejects(
    captureObservedPrivateResponse({
      page: ambiguousPage,
      session: {
        async navigateGuardedForRead() {
          exchange(ambiguousPage);
          exchange(ambiguousPage);
        }
      },
      capability: capability(),
      targetUrl: 'https://api.example.test/data'
    }),
    (error) => error.code === 'private-capture-ambiguous' && error.dispatched === true
  );

  const failedPage = eventPage();
  await assert.rejects(
    captureObservedPrivateResponse({
      page: failedPage,
      session: {
        async navigateGuardedForRead() {
          exchange(failedPage, { status: 429 });
        }
      },
      capability: capability(),
      targetUrl: 'https://api.example.test/data'
    }),
    (error) => error.code === 'private-capture-status' && error.dispatched === true
  );
});
