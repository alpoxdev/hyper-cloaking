// Deterministic provider registry: exact/dot-boundary host matching,
// same-provider longest-match collapse, cross-provider ambiguity detection,
// and fail-closed explicit/URL provider resolution.

import { validateProviderSchema } from './schema.mjs';

export const GENERIC_PROVIDER_ID = 'generic';

export function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Exact-or-dot-boundary host match only. Rejects lookalike hosts such as
 * `evilreddit.com` for `reddit.com` or `notx.com` for `x.com`.
 */
export function hostMatchesDomain(host, domain) {
  const normalizedHost = normalizeHost(host);
  const normalizedDomain = normalizeHost(domain);
  if (!normalizedHost || !normalizedDomain) return false;
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function matchableProviders(providers) {
  return providers.filter((provider) => provider?.id !== GENERIC_PROVIDER_ID);
}

// navigationOnlyAliases (e.g. link-shortener/redirect hosts like redd.it,
// youtu.be, t.co) participate in provider resolution/matching but are
// tagged so callers never use them to seed a cookie.siteKey.
function providerDomainCandidates(provider) {
  const primary = provider?.domains?.primary;
  const aliases = Array.isArray(provider?.domains?.aliases) ? provider.domains.aliases : [];
  const navigationOnlyAliases = Array.isArray(provider?.domains?.navigationOnlyAliases) ? provider.domains.navigationOnlyAliases : [];
  const candidates = [];
  if (primary) candidates.push({ domain: primary, navigationOnly: false });
  for (const alias of aliases) candidates.push({ domain: alias, navigationOnly: false });
  for (const alias of navigationOnlyAliases) candidates.push({ domain: alias, navigationOnly: true });
  return candidates;
}

export function findMatchingDomains(host, providers) {
  const matches = [];
  for (const provider of matchableProviders(providers)) {
    for (const candidate of providerDomainCandidates(provider)) {
      if (hostMatchesDomain(host, candidate.domain)) {
        matches.push({ provider, domain: candidate.domain, navigationOnly: candidate.navigationOnly });
      }
    }
  }
  return matches;
}

function longestMatch(matches) {
  return matches.reduce((best, current) => (
    !best || current.domain.length > best.domain.length ? current : best
  ), null);
}

export function buildProviderRegistry(providers) {
  const byId = new Map(providers.map((provider) => [provider?.id, provider]));
  return { providers, byId };
}

/**
 * Explicit provider id lookup. Unknown ids fail closed with a structured
 * `unknown-provider` error; there is no generic fallback for explicit ids.
 */
export function getProvider(registry, id) {
  const requestedId = typeof id === 'string' ? id : String(id ?? '');
  const normalizedId = requestedId.trim().toLowerCase();
  const provider = normalizedId ? registry.byId.get(normalizedId) : undefined;
  if (!provider) {
    return {
      ok: false,
      error: {
        code: 'unknown-provider',
        message: `Unknown provider id "${requestedId}"`,
        id: requestedId
      }
    };
  }
  return { ok: true, provider };
}

/**
 * URL-based provider resolution. Known host -> provider with source:'url'.
 * Unknown valid URL -> generic fallback. Invalid URL -> invalid-provider-url.
 * Host matching different providers -> provider-ambiguous-host (fail-closed).
 */
export function resolveProviderForUrl(registry, url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid-provider-url',
        message: `"${url}" is not a valid URL`,
        url: String(url)
      }
    };
  }

  const host = normalizeHost(parsed.hostname);
  const matches = findMatchingDomains(host, registry.providers);

  if (matches.length === 0) {
    const generic = registry.byId.get(GENERIC_PROVIDER_ID);
    return {
      ok: true,
      provider: generic,
      source: 'url',
      fallbackUsed: true,
      matchedDomain: null,
      matchedViaNavigationOnlyAlias: false,
      reason: 'no-known-provider-matches-host'
    };
  }

  const providerIds = new Set(matches.map((match) => match.provider.id));
  if (providerIds.size > 1) {
    return {
      ok: false,
      error: {
        code: 'provider-ambiguous-host',
        message: `Host "${host}" matches multiple providers: ${[...providerIds].sort().join(', ')}`,
        host,
        providerIds: [...providerIds].sort()
      }
    };
  }

  const best = longestMatch(matches);
  return {
    ok: true,
    provider: best.provider,
    source: 'url',
    fallbackUsed: false,
    matchedDomain: best.domain,
    matchedViaNavigationOnlyAlias: best.navigationOnly
  };
}

function detectCrossProviderAmbiguity(providers) {
  const errors = [];
  const candidates = matchableProviders(providers).map((provider) => ({
    provider,
    domains: providerDomainCandidates(provider).map((candidate) => candidate.domain)
  }));

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      for (const domainA of a.domains) {
        for (const domainB of b.domains) {
          if (hostMatchesDomain(domainA, domainB) || hostMatchesDomain(domainB, domainA)) {
            errors.push({
              code: 'provider-ambiguous-host',
              message: `Providers "${a.provider.id}" and "${b.provider.id}" have ambiguous overlapping domains "${domainA}" / "${domainB}"`,
              providerIds: [a.provider.id, b.provider.id].sort()
            });
          }
        }
      }
    }
  }
  return errors;
}

/**
 * Runs schema, uniqueness, alias normalization, same-provider longest-match
 * sanity, cross-provider ambiguity, origin, and forbidden-field validation.
 * Returns a deterministic { ok, providerCount, errors } shape for both
 * `engine validate` and root scripts/validate.mjs.
 */
export function validateProviderRegistry(providers) {
  const errors = [];
  const idSeen = new Set();

  for (const provider of providers) {
    const result = validateProviderSchema(provider);
    if (!result.ok) {
      for (const error of result.errors) {
        errors.push({ ...error, providerId: provider?.id ?? null });
      }
    }
    const id = provider?.id;
    if (typeof id === 'string' && id) {
      if (idSeen.has(id)) {
        errors.push({ code: 'provider-schema-invalid', message: `Duplicate provider id "${id}"`, providerId: id });
      }
      idSeen.add(id);
    }
  }

  errors.push(...detectCrossProviderAmbiguity(providers));

  return {
    ok: errors.length === 0,
    providerCount: providers.length,
    errors
  };
}
