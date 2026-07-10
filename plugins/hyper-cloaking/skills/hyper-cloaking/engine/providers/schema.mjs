// Deterministic provider schema and validation.
//
// Providers are plain data describing site metadata, domain/origin hints,
// cookie/profile/preflight defaults, and safe diagnostic-only wording. They
// never carry evasion, automation, or bypass recipes.

export const FORBIDDEN_PROVIDER_FIELDS = Object.freeze([
  'proxy',
  'proxies',
  'fingerprint',
  'fingerprints',
  'captchaSolver',
  'wafBypass',
  'bypass',
  'evasion',
  'stealthRecipe',
  'rateLimitBypass',
  'selectors',
  'automationRecipe'
]);

// Words describing an actual attempt to defeat a challenge/CAPTCHA/WAF/rate
// limit. Allowed only when NOT co-occurring with a challenge term below;
// safe notes must describe stopping/reporting, not solving/evading.
const BYPASS_TERMS = ['bypass', 'evade', 'defeat', 'solve', 'circumvent', 'crack', 'work around', 'workaround', 'get around'];
const CHALLENGE_TERMS = ['captcha', 'waf', 'challenge', 'rate limit', 'rate-limit', 'ratelimit', 'bot detection'];

const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalStringArray(value) {
  return value === undefined || isStringArray(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

export function isValidHostname(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false;
  if (value.includes('://') || value.includes('/') || value.includes(' ')) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => HOSTNAME_LABEL.test(label));
}

export function isValidOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function collectForbiddenFields(value, pathPrefix, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFields(item, `${pathPrefix}[${index}]`, found));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, val] of Object.entries(value)) {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (FORBIDDEN_PROVIDER_FIELDS.includes(key)) found.push(nextPath);
    collectForbiddenFields(val, nextPath, found);
  }
}

function containsBypassInstruction(text) {
  const lower = String(text).toLowerCase();
  const hasChallengeTerm = CHALLENGE_TERMS.some((term) => lower.includes(term));
  if (!hasChallengeTerm) return false;
  return BYPASS_TERMS.some((term) => lower.includes(term));
}

function collectWordingTexts(provider) {
  const texts = [];
  if (isStringArray(provider.outcomeHints)) texts.push(...provider.outcomeHints);
  if (isStringArray(provider.safeFlowNotes)) texts.push(...provider.safeFlowNotes);
  if (typeof provider.metadata?.notes === 'string') texts.push(provider.metadata.notes);
  return texts;
}

/**
 * Validates a single provider object against the deterministic schema.
 * Returns { ok, errors } where errors is an array of { code, message }.
 */
export function validateProviderSchema(provider) {
  const errors = [];
  function fail(code, message) {
    errors.push({ code, message });
  }

  if (!isPlainObject(provider)) {
    return { ok: false, errors: [{ code: 'provider-schema-invalid', message: 'provider must be a plain object' }] };
  }

  if (!isNonEmptyString(provider.id)) {
    fail('provider-schema-invalid', 'id must be a non-empty string');
  } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(provider.id)) {
    fail('provider-schema-invalid', `id "${provider.id}" must be lowercase kebab-case`);
  }

  if (!isNonEmptyString(provider.label)) fail('provider-schema-invalid', 'label must be a non-empty string');

  if (!isPlainObject(provider.metadata)) {
    fail('provider-schema-invalid', 'metadata must be an object');
  } else {
    if (!isNonEmptyString(provider.metadata.category)) fail('provider-schema-invalid', 'metadata.category must be a non-empty string');
    if (!isNonEmptyString(provider.metadata.notes)) fail('provider-schema-invalid', 'metadata.notes must be a non-empty string');
  }

  if (!isPlainObject(provider.domains)) {
    fail('provider-schema-invalid', 'domains must be an object');
  } else {
    const { primary, aliases, navigationOnlyAliases, allowedOrigins, disallowedOrigins } = provider.domains;

    if (!isValidHostname(primary)) fail('provider-schema-invalid', `domains.primary "${primary}" must be a hostname, not a URL`);

    if (!isStringArray(aliases)) {
      fail('provider-schema-invalid', 'domains.aliases must be an array of strings');
    } else {
      for (const alias of aliases) {
        if (!isValidHostname(alias)) fail('provider-schema-invalid', `domains.aliases contains invalid hostname "${alias}"`);
      }
    }

    if (!isOptionalStringArray(navigationOnlyAliases)) {
      fail('provider-schema-invalid', 'domains.navigationOnlyAliases must be an array of strings when present');
    } else if (navigationOnlyAliases) {
      for (const alias of navigationOnlyAliases) {
        if (!isValidHostname(alias)) fail('provider-schema-invalid', `domains.navigationOnlyAliases contains invalid hostname "${alias}"`);
      }
    }

    if (!isStringArray(allowedOrigins)) {
      fail('provider-schema-invalid', 'domains.allowedOrigins must be an array of strings');
    } else {
      for (const origin of allowedOrigins) {
        if (!isValidOrigin(origin)) fail('provider-schema-invalid', `domains.allowedOrigins contains invalid origin "${origin}"`);
      }
    }

    if (!isStringArray(disallowedOrigins)) {
      fail('provider-schema-invalid', 'domains.disallowedOrigins must be an array of strings');
    } else {
      for (const origin of disallowedOrigins) {
        if (!isValidOrigin(origin)) fail('provider-schema-invalid', `domains.disallowedOrigins contains invalid origin "${origin}"`);
      }
    }

    const allDomainStrings = [primary, ...(isStringArray(aliases) ? aliases : []), ...(isStringArray(navigationOnlyAliases) ? navigationOnlyAliases : [])]
      .filter((value) => typeof value === 'string');
    const normalizedAll = allDomainStrings.map((value) => value.toLowerCase());
    const seenAll = new Set();
    for (const value of normalizedAll) {
      if (seenAll.has(value)) fail('provider-schema-invalid', `domains contains duplicate hostname "${value}" across primary/aliases/navigationOnlyAliases`);
      seenAll.add(value);
    }
  }

  if (!isPlainObject(provider.cookie)) {
    fail('provider-schema-invalid', 'cookie must be an object');
  } else {
    if (!isNonEmptyString(provider.cookie.siteKey)) fail('provider-schema-invalid', 'cookie.siteKey must be a non-empty string');
    if (provider.cookie.accountHint !== null && !isNonEmptyString(provider.cookie.accountHint)) {
      fail('provider-schema-invalid', 'cookie.accountHint must be a non-empty string or null');
    }
    if (!isBoolean(provider.cookie.required)) fail('provider-schema-invalid', 'cookie.required must be a boolean');
  }

  if (!isPlainObject(provider.profile)) {
    fail('provider-schema-invalid', 'profile must be an object');
  } else {
    if (!isNonEmptyString(provider.profile.label)) fail('provider-schema-invalid', 'profile.label must be a non-empty string');
    if (!isBoolean(provider.profile.persistentRecommended)) fail('provider-schema-invalid', 'profile.persistentRecommended must be a boolean');
  }

  if (!isPlainObject(provider.preflight)) {
    fail('provider-schema-invalid', 'preflight must be an object');
  } else {
    if (!isBoolean(provider.preflight.headlessDefault)) fail('provider-schema-invalid', 'preflight.headlessDefault must be a boolean');
    if (!isNonEmptyString(provider.preflight.cookieModeDefault)) fail('provider-schema-invalid', 'preflight.cookieModeDefault must be a non-empty string');
    if (!isNonEmptyString(provider.preflight.credentialSensitivity)) fail('provider-schema-invalid', 'preflight.credentialSensitivity must be a non-empty string');
    if (!isBoolean(provider.preflight.allowedOriginsPrompt)) fail('provider-schema-invalid', 'preflight.allowedOriginsPrompt must be a boolean');
  }

  if (!isStringArray(provider.outcomeHints)) fail('provider-schema-invalid', 'outcomeHints must be an array of strings');
  if (!isStringArray(provider.safeFlowNotes)) fail('provider-schema-invalid', 'safeFlowNotes must be an array of strings');

  for (const text of collectWordingTexts(provider)) {
    if (containsBypassInstruction(text)) {
      fail('provider-schema-invalid', `wording must be diagnostic-only (stop/report), not a bypass instruction: "${text}"`);
    }
  }

  const forbiddenPaths = [];
  collectForbiddenFields(provider, '', forbiddenPaths);
  for (const forbiddenPath of forbiddenPaths) {
    fail('provider-forbidden-field', `forbidden field found at "${forbiddenPath}"`);
  }

  return { ok: errors.length === 0, errors };
}
