import assert from 'node:assert/strict';
import test from 'node:test';

import { genericProvider } from './generic.mjs';
import {
  getProvider,
  providers,
  resolveProviderForUrl,
  validateProviderRegistry
} from './index.mjs';
import { redditProvider } from './reddit.mjs';
import {
  buildProviderRegistry,
  hostMatchesDomain,
  resolveProviderForUrl as resolveProviderForUrlFromRegistry,
  validateProviderRegistry as validateProviderRegistryFromRegistry
} from './registry.mjs';
import { xProvider } from './x.mjs';

test('validateProviderRegistry passes for the built-in provider set', () => {
  const result = validateProviderRegistry();
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.providerCount, providers.length);
  assert.deepEqual(result.errors, []);
});

test('known aliases resolve to the correct provider', () => {
  const cases = [
    ['https://www.naver.com', 'naver'],
    ['https://blog.naver.com', 'naver'],
    ['https://old.reddit.com', 'reddit'],
    ['https://oauth.reddit.com', 'reddit'],
    ['https://m.instagram.com', 'instagram'],
    ['https://music.youtube.com', 'youtube'],
    ['https://twitter.com', 'x'],
    ['https://www.x.com', 'x']
  ];
  for (const [url, expectedId] of cases) {
    const resolution = resolveProviderForUrl(url);
    assert.equal(resolution.ok, true, url);
    assert.equal(resolution.provider.id, expectedId, url);
    assert.equal(resolution.source, 'url', url);
    assert.equal(resolution.fallbackUsed, false, url);
  }
});

test('unknown URL returns generic fallback', () => {
  const resolution = resolveProviderForUrl('https://totally-unknown-example-host.test');
  assert.equal(resolution.ok, true);
  assert.equal(resolution.provider.id, 'generic');
  assert.equal(resolution.source, 'url');
  assert.equal(resolution.fallbackUsed, true);
  assert.equal(resolution.matchedDomain, null);
});

test('invalid URL returns structured invalid-provider-url error', () => {
  const resolution = resolveProviderForUrl('not a url');
  assert.equal(resolution.ok, false);
  assert.equal(resolution.error.code, 'invalid-provider-url');
});

test('unknown explicit provider id returns unknown-provider with no generic fallback', () => {
  const resolution = getProvider('bogus');
  assert.equal(resolution.ok, false);
  assert.equal(resolution.error.code, 'unknown-provider');
  assert.equal(resolution.error.id, 'bogus');
});

test('known explicit provider id resolves', () => {
  const resolution = getProvider('reddit');
  assert.equal(resolution.ok, true);
  assert.equal(resolution.provider.id, 'reddit');
});

test('lookalike hosts do not match unrelated providers', () => {
  assert.equal(hostMatchesDomain('evilreddit.com', 'reddit.com'), false);
  assert.equal(hostMatchesDomain('notx.com', 'x.com'), false);

  const evilReddit = resolveProviderForUrl('https://evilreddit.com');
  assert.equal(evilReddit.ok, true);
  assert.equal(evilReddit.provider.id, 'generic');
  assert.equal(evilReddit.fallbackUsed, true);

  const notX = resolveProviderForUrl('https://notx.com');
  assert.equal(notX.ok, true);
  assert.equal(notX.provider.id, 'generic');
  assert.equal(notX.fallbackUsed, true);
});

test('same-provider parent/subdomain overlap collapses to the longest match', () => {
  const reddit = resolveProviderForUrl('https://www.reddit.com');
  assert.equal(reddit.ok, true);
  assert.equal(reddit.provider.id, 'reddit');
  assert.equal(reddit.matchedDomain, 'www.reddit.com');

  const twitter = resolveProviderForUrl('https://mobile.twitter.com');
  assert.equal(twitter.ok, true);
  assert.equal(twitter.provider.id, 'x');
  assert.equal(twitter.matchedDomain, 'mobile.twitter.com');
});

test('navigation-only alias hosts resolve but are flagged so cookie hints are never seeded from them', () => {
  const reddit = resolveProviderForUrl('https://redd.it/abc123');
  assert.equal(reddit.ok, true);
  assert.equal(reddit.provider.id, 'reddit');
  assert.equal(reddit.matchedDomain, 'redd.it');
  assert.equal(reddit.matchedViaNavigationOnlyAlias, true);

  const youtube = resolveProviderForUrl('https://youtu.be/xyz');
  assert.equal(youtube.ok, true);
  assert.equal(youtube.provider.id, 'youtube');
  assert.equal(youtube.matchedViaNavigationOnlyAlias, true);

  const x = resolveProviderForUrl('https://t.co/xyz');
  assert.equal(x.ok, true);
  assert.equal(x.provider.id, 'x');
  assert.equal(x.matchedViaNavigationOnlyAlias, true);

  const naver = resolveProviderForUrl('https://www.naver.com');
  assert.equal(naver.matchedViaNavigationOnlyAlias, false);

  for (const provider of [redditProvider, xProvider]) {
    assert.ok(!provider.domains.aliases.includes('redd.it') && !provider.domains.aliases.includes('t.co'));
  }
});

test('cross-provider overlap fixture fails registry validation with a deterministic ambiguity error', () => {
  const providerA = {
    ...genericProvider,
    id: 'fixture-a',
    domains: {
      primary: 'shared-example.test',
      aliases: [],
      allowedOrigins: [],
      disallowedOrigins: []
    }
  };
  const providerB = {
    ...genericProvider,
    id: 'fixture-b',
    domains: {
      primary: 'sub.shared-example.test',
      aliases: [],
      allowedOrigins: [],
      disallowedOrigins: []
    }
  };

  const result = validateProviderRegistryFromRegistry([genericProvider, providerA, providerB]);
  assert.equal(result.ok, false);
  const ambiguityErrors = result.errors.filter((error) => error.code === 'provider-ambiguous-host');
  assert.ok(ambiguityErrors.length > 0);
  assert.deepEqual(ambiguityErrors[0].providerIds, ['fixture-a', 'fixture-b']);
});

test('runtime resolution fails closed with provider-ambiguous-host if two providers overlap a host', () => {
  const providerA = {
    ...genericProvider,
    id: 'fixture-a',
    domains: {
      primary: 'shared-example.test',
      aliases: [],
      allowedOrigins: [],
      disallowedOrigins: []
    }
  };
  const providerB = {
    ...genericProvider,
    id: 'fixture-b',
    domains: {
      primary: 'sub.shared-example.test',
      aliases: [],
      allowedOrigins: [],
      disallowedOrigins: []
    }
  };
  const fixtureRegistry = buildProviderRegistry([genericProvider, providerA, providerB]);
  const resolution = resolveProviderForUrlFromRegistry(fixtureRegistry, 'https://sub.shared-example.test');
  assert.equal(resolution.ok, false);
  assert.equal(resolution.error.code, 'provider-ambiguous-host');
});

test('punycode/IDNA host normalization is deterministic', () => {
  // WHATWG URL parsing already applies ToASCII/punycode + lowercasing to
  // the hostname; matching must be stable across case and trailing dots.
  const upperCaseTrailingDot = resolveProviderForUrl('https://YouTube.COM./watch?v=1');
  assert.equal(upperCaseTrailingDot.ok, true);
  assert.equal(upperCaseTrailingDot.provider.id, 'youtube');

  // A non-ASCII host that does not match any known provider must still
  // resolve deterministically to the generic fallback without throwing.
  const idnaFallback = resolveProviderForUrl('https://xn--fsqu00a.example/');
  assert.equal(idnaFallback.ok, true);
  assert.equal(idnaFallback.provider.id, 'generic');
  assert.equal(idnaFallback.fallbackUsed, true);
});

test('providers expose only metadata/hint fields, never safety-authorizing fields', () => {
  const allowedTopLevelKeys = new Set([
    'id',
    'label',
    'metadata',
    'domains',
    'cookie',
    'profile',
    'preflight',
    'outcomeHints',
    'safeFlowNotes'
  ]);
  const allowedDomainKeys = new Set(['primary', 'aliases', 'navigationOnlyAliases', 'allowedOrigins', 'disallowedOrigins']);

  for (const provider of providers) {
    for (const key of Object.keys(provider)) {
      assert.ok(allowedTopLevelKeys.has(key), `unexpected top-level key "${key}" on provider "${provider.id}"`);
    }
    for (const key of Object.keys(provider.domains)) {
      assert.ok(allowedDomainKeys.has(key), `unexpected domains key "${key}" on provider "${provider.id}"`);
    }
  }
});
