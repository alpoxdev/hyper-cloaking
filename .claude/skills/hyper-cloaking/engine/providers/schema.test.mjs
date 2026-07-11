import assert from 'node:assert/strict';
import test from 'node:test';

import { genericProvider } from './generic.mjs';
import { redditProvider } from './reddit/metadata.mjs';
import { FORBIDDEN_PROVIDER_FIELDS, validateProviderSchema } from './schema.mjs';
import { validateProviderRegistry as validateProviderRegistryFromRegistry } from './registry.mjs';
import { xProvider } from './x.mjs';
import { buildProviderSession, OffOriginError } from './session.mjs';

test('valid built-in providers pass schema validation', () => {
  for (const provider of [genericProvider, redditProvider, xProvider]) {
    const result = validateProviderSchema(provider);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
});

test('required-field validation rejects a provider missing required keys', () => {
  const missingLabel = { ...genericProvider, label: undefined };
  const result = validateProviderSchema(missingLabel);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'provider-schema-invalid'));

  const missingMetadata = { ...genericProvider };
  delete missingMetadata.metadata;
  assert.equal(validateProviderSchema(missingMetadata).ok, false);

  const missingCookie = { ...genericProvider };
  delete missingCookie.cookie;
  assert.equal(validateProviderSchema(missingCookie).ok, false);
});

test('id must be lowercase kebab-case', () => {
  const badId = { ...genericProvider, id: 'Not_Kebab' };
  const result = validateProviderSchema(badId);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /kebab-case/.test(error.message)));
});

test('duplicate alias within a single provider is rejected', () => {
  const duplicateAlias = {
    ...genericProvider,
    id: 'dup-alias',
    domains: {
      primary: 'dup-alias.test',
      aliases: ['www.dup-alias.test', 'WWW.dup-alias.test'],
      allowedOrigins: [],
      disallowedOrigins: []
    }
  };
  const result = validateProviderSchema(duplicateAlias);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /duplicate hostname/.test(error.message)));
});

test('duplicate provider id across the registry is rejected', () => {
  const providerCopy = { ...genericProvider };
  const result = validateProviderRegistryFromRegistry([genericProvider, providerCopy]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /Duplicate provider id/.test(error.message)));
});

test('domains.primary must be a hostname, not a URL', () => {
  const urlAsHostname = {
    ...genericProvider,
    id: 'url-as-hostname',
    domains: {
      primary: 'https://example.test',
      aliases: [],
      allowedOrigins: [],
      disallowedOrigins: []
    }
  };
  assert.equal(validateProviderSchema(urlAsHostname).ok, false);
});

test('domains.allowedOrigins must be valid URL origins', () => {
  const badOrigin = {
    ...genericProvider,
    id: 'bad-origin',
    domains: {
      primary: 'bad-origin.test',
      aliases: [],
      allowedOrigins: ['not-a-url'],
      disallowedOrigins: []
    }
  };
  assert.equal(validateProviderSchema(badOrigin).ok, false);
});
test('provider sessions honor metadata origins, explicit overrides, and deny-all overrides', () => {
  const provider = {
    id: 'session-origin-test',
    domains: {
      allowedOrigins: ['https://metadata.test']
    }
  };

  const metadataSession = buildProviderSession(
    { url: () => 'https://metadata.test/path' },
    { provider }
  );
  assert.equal(metadataSession.requireOnOrigin(), 'https://metadata.test/path');
  assert.equal(metadataSession.targetSafety, null);

  const suppliedSafety = {
    disposition: 'ok',
    reason: 'requested-target-approved',
    risks: [],
    url: 'https://override.test/path'
  };
  const overrideSession = buildProviderSession(
    { url: () => 'https://override.test/path' },
    { provider, allowedOrigins: ['https://override.test'], targetSafety: suppliedSafety }
  );
  overrideSession.requireOnOrigin();
  assert.equal(overrideSession.targetSafety, null);
  assert.throws(
    () => overrideSession.requireOnOrigin('https://metadata.test/path'),
    (error) => error instanceof OffOriginError
  );

  const denyAllSession = buildProviderSession(
    { url: () => 'https://metadata.test/path' },
    { provider, allowedOrigins: [] }
  );
  assert.throws(
    () => denyAllSession.requireOnOrigin(),
    (error) => error instanceof OffOriginError
  );
  assert.equal(denyAllSession.targetSafety, null);
});
test('guarded navigation blocks denied or unsafe targets before goto and verifies safe targets', async () => {
  let gotoCalls = 0;
  let currentUrl = 'about:blank';
  const page = {
    url: () => currentUrl,
    async goto(url) {
      gotoCalls += 1;
      currentUrl = url;
    },
    async evaluate() {
      return { title: '', labels: [] };
    }
  };

  const suppliedNonOk = {
    disposition: 'approvalRequired',
    reason: 'insecure-http',
    risks: [],
    url: 'https://public.test/path'
  };
  const denied = buildProviderSession(page, {
    allowedOrigins: [],
    targetSafety: suppliedNonOk
  });
  await assert.rejects(
    () => denied.navigateGuarded('https://public.test/path'),
    (error) => error instanceof OffOriginError
  );
  assert.equal(gotoCalls, 0);

  const unsafe = buildProviderSession(page, {
    allowedOrigins: ['https://public.test'],
    targetSafety: suppliedNonOk
  });
  await assert.rejects(
    () => unsafe.navigateGuarded('https://public.test/path'),
    (error) => error.code === 'HYPER_CLOAKING_TARGET_SAFETY'
      && error.classification === suppliedNonOk
  );
  assert.equal(gotoCalls, 0);

  const allowed = buildProviderSession(page, {
    allowedOrigins: ['https://public.test']
  });
  const finalUrl = await allowed.navigateGuarded('https://public.test/path');
  assert.equal(finalUrl, 'https://public.test/path');
  assert.equal(gotoCalls, 1);
  assert.deepEqual(allowed.targetSafety, {
    input: 'https://public.test/path',
    href: 'https://public.test/path',
    origin: 'https://public.test',
    protocol: 'https:',
    host: 'public.test',
    disposition: 'ok',
    reason: 'public-https-fqdn',
    detail: undefined
  });
});
test('guarded navigation requires supplied OK safety to bind to its exact target', async () => {
  let gotoCalls = 0;
  let currentUrl = 'about:blank';
  const page = {
    url: () => currentUrl,
    async goto(url) {
      gotoCalls += 1;
      currentUrl = url;
      return null;
    },
    async evaluate() {
      return { title: '', labels: [] };
    }
  };
  const allowedOrigins = ['https://public.test'];

  const stale = buildProviderSession(page, {
    allowedOrigins,
    targetSafety: { disposition: 'ok', href: 'https://public.test/other' }
  });
  await assert.rejects(
    () => stale.navigateGuarded('https://public.test/path'),
    (error) => error.code === 'HYPER_CLOAKING_TARGET_SAFETY'
  );
  assert.equal(gotoCalls, 0);

  const missingBinding = buildProviderSession(page, {
    allowedOrigins,
    targetSafety: { disposition: 'ok', reason: 'public-https-fqdn' }
  });
  await assert.rejects(
    () => missingBinding.navigateGuarded('https://public.test/path'),
    (error) => error.code === 'HYPER_CLOAKING_TARGET_SAFETY'
  );
  assert.equal(gotoCalls, 0);

  const exact = buildProviderSession(page, {
    allowedOrigins,
    targetSafety: { disposition: 'ok', href: 'https://public.test/path' }
  });
  assert.equal(await exact.navigateGuarded('https://public.test/path'), 'https://public.test/path');
  assert.equal(gotoCalls, 1);
});

test('guarded navigation ignores challenge words outside targeted UI evidence', async () => {
  let currentUrl = 'about:blank';
  const page = {
    url: () => currentUrl,
    async goto(url) {
      currentUrl = url;
      return null;
    },
    async evaluate(capture) {
      const previousDocument = globalThis.document;
      globalThis.document = {
        title: 'Ordinary discussion',
        body: { innerText: 'A comment mentions CAPTCHA, Cloudflare, and rate limits.' },
        querySelectorAll: () => []
      };
      try {
        return capture();
      } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
      }
    }
  };
  const session = buildProviderSession(page, { allowedOrigins: ['https://public.test'] });
  assert.equal(await session.navigateGuarded('https://public.test/comments'), 'https://public.test/comments');
});

test('guarded navigation blocks targeted challenge UI and HTTP 429 responses', async () => {
  for (const scenario of [
    {
      response: null,
      evidence: { title: 'Ordinary page', labels: ['Please complete the CAPTCHA challenge'] }
    },
    {
      response: { status: () => 429, statusText: () => 'Too Many Requests' },
      evidence: { title: 'Ordinary page', labels: [] }
    }
  ]) {
    let currentUrl = 'about:blank';
    let gotoCalls = 0;
    const page = {
      url: () => currentUrl,
      async goto(url) {
        gotoCalls += 1;
        currentUrl = url;
        return scenario.response;
      },
      async evaluate() {
        return scenario.evidence;
      }
    };
    const session = buildProviderSession(page, { allowedOrigins: ['https://public.test'] });
    await assert.rejects(
      () => session.navigateGuarded('https://public.test/path'),
      (error) => error.code === 'challenge-blocked'
    );
    assert.equal(gotoCalls, 1);
  }
});
test('guarded navigation fails closed when challenge evidence evaluation is unavailable', async () => {
  const evaluatorCause = new Error('evaluation denied');
  for (const scenario of [
    { name: 'evaluator rejection', cause: evaluatorCause, evaluate: async () => { throw evaluatorCause; } },
    { name: 'malformed evidence', evaluate: async () => ({ title: 42, labels: 'not-an-array' }) }
  ]) {
    let currentUrl = 'about:blank';
    let gotoCalls = 0;
    const page = {
      url: () => currentUrl,
      async goto(url) {
        gotoCalls += 1;
        currentUrl = url;
        return null;
      },
      evaluate: scenario.evaluate
    };
    const session = buildProviderSession(page, { allowedOrigins: ['https://public.test'] });
    let thrown;
    await assert.rejects(
      () => session.navigateGuarded('https://public.test/path'),
      (error) => {
        thrown = error;
        return error.code === 'challenge-evidence-unavailable'
          && error.stage === 'challenge-evidence'
          && error.labels.includes('challenge-evidence-unavailable')
          && error.cause instanceof Error;
      },
      scenario.name
    );
    assert.equal(gotoCalls, 1, scenario.name);
    if (scenario.cause) assert.equal(thrown.cause, scenario.cause);
    else assert.match(thrown.cause.message, /malformed/i);
  }
});

test('challenge capture ignores login affordances but detects login walls, modals, and alerts', async () => {
  for (const scenario of [
    { name: 'ordinary login affordance', selector: '[data-testid*="login" i]', blocks: false },
    { name: 'login wall', selector: '[id*="login-wall" i]', blocks: true },
    { name: 'login modal', selector: '[role="dialog"][data-testid*="login" i]', blocks: true },
    { name: 'login alert', selector: '[role="alert"][data-testid*="login" i]', blocks: true }
  ]) {
    let currentUrl = 'about:blank';
    const page = {
      url: () => currentUrl,
      async goto(url) {
        currentUrl = url;
        return null;
      },
      async evaluate(capture) {
        const previousDocument = globalThis.document;
        globalThis.document = {
          title: 'Ordinary page',
          querySelectorAll(query) {
            const selectors = query.split(', ');
            assert.equal(selectors.includes('[data-testid*="login" i]'), false);
            if (!selectors.includes(scenario.selector)) return [];
            return [{
              getAttribute: () => null,
              innerText: 'Login required',
              textContent: 'Login required'
            }];
          }
        };
        try {
          return capture();
        } finally {
          if (previousDocument === undefined) delete globalThis.document;
          else globalThis.document = previousDocument;
        }
      }
    };
    const session = buildProviderSession(page, { allowedOrigins: ['https://public.test'] });
    if (scenario.blocks) {
      await assert.rejects(
        () => session.navigateGuarded('https://public.test/path'),
        (error) => error.code === 'challenge-blocked'
      );
    } else {
      assert.equal(await session.navigateGuarded('https://public.test/path'), 'https://public.test/path');
    }
  }
});

test('schema rejects provider action and session payloads', () => {
  for (const field of ['actions', 'session']) {
    const pollutedProvider = {
      ...genericProvider,
      id: `forbidden-${field}`,
      metadata: { ...genericProvider.metadata, [field]: {} }
    };
    const result = validateProviderSchema(pollutedProvider);
    assert.equal(result.ok, false, field);
    assert.ok(
      result.errors.some((error) => error.code === 'provider-forbidden-field'),
      field
    );
  }
});
test('forbidden field names are rejected anywhere in a provider object', () => {
  for (const field of FORBIDDEN_PROVIDER_FIELDS) {
    const withForbiddenTopLevel = { ...genericProvider, id: 'forbidden-top', [field]: 'x' };
    const topResult = validateProviderSchema(withForbiddenTopLevel);
    assert.equal(topResult.ok, false, field);
    assert.ok(topResult.errors.some((error) => error.code === 'provider-forbidden-field'), field);

    const withForbiddenNested = {
      ...genericProvider,
      id: 'forbidden-nested',
      metadata: { ...genericProvider.metadata, [field]: 'x' }
    };
    const nestedResult = validateProviderSchema(withForbiddenNested);
    assert.equal(nestedResult.ok, false, field);
    assert.ok(nestedResult.errors.some((error) => error.code === 'provider-forbidden-field'), field);
  }
});

test('safe diagnostic-only wording passes but bypass instructions are rejected', () => {
  const safe = {
    ...genericProvider,
    id: 'safe-wording',
    safeFlowNotes: ['If a CAPTCHA or WAF block appears, stop and report it as a diagnostic blocker.']
  };
  assert.equal(validateProviderSchema(safe).ok, true, JSON.stringify(validateProviderSchema(safe).errors));

  const unsafe = {
    ...genericProvider,
    id: 'unsafe-wording',
    safeFlowNotes: ['Automatically bypass the CAPTCHA to continue the automation.']
  };
  const unsafeResult = validateProviderSchema(unsafe);
  assert.equal(unsafeResult.ok, false);
  assert.ok(unsafeResult.errors.some((error) => /diagnostic-only/.test(error.message)));

  const unsafeOutcomeHint = {
    ...genericProvider,
    id: 'unsafe-outcome-hint',
    outcomeHints: ['Use this technique to evade the WAF rate limit before capturing evidence.']
  };
  assert.equal(validateProviderSchema(unsafeOutcomeHint).ok, false);
});

test('cross-provider alias/domain ambiguity validation catches overlapping fixtures', () => {
  const providerA = {
    ...genericProvider,
    id: 'ambiguous-a',
    domains: { primary: 'ambiguous-shared.test', aliases: [], allowedOrigins: [], disallowedOrigins: [] }
  };
  const providerB = {
    ...genericProvider,
    id: 'ambiguous-b',
    domains: { primary: 'ambiguous-shared.test', aliases: [], allowedOrigins: [], disallowedOrigins: [] }
  };
  const result = validateProviderRegistryFromRegistry([genericProvider, providerA, providerB]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'provider-ambiguous-host'));
});
