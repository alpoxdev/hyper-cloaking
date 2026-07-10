import assert from 'node:assert/strict';
import test from 'node:test';

import { genericProvider } from './generic.mjs';
import { redditProvider } from './reddit.mjs';
import { FORBIDDEN_PROVIDER_FIELDS, validateProviderSchema } from './schema.mjs';
import { validateProviderRegistry as validateProviderRegistryFromRegistry } from './registry.mjs';
import { xProvider } from './x.mjs';

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
