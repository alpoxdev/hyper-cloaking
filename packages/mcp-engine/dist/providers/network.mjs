/**
 * Bounded provider read strategies and normalized network envelopes.
 * Responses remain untrusted; strategy selection never authorizes writes.
 */
import { TextDecoder } from 'node:util';

import { isOriginApproved, normalizeOrigin } from '../recon-scope.mjs';

const PRIVATE_LEASES = new WeakMap();
const STRATEGIES = new Set(['auto', 'official', 'direct', 'private-replay', 'capture', 'dom']);
const HANDLER_STRATEGIES = Object.freeze(['official', 'direct', 'private-replay', 'capture']);
const HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export const DEFAULT_NETWORK_TIMEOUT_MS = 15_000;
export const DEFAULT_NETWORK_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_NETWORK_MAX_RECORDS = 400;
export const DEFAULT_NETWORK_MAX_DEPTH = 24;
export const MAX_PRIVATE_LEASE_MS = 60_000;
export const MAX_PRIVATE_LEASE_USES = 5;

export class NetworkReadError extends Error {
  constructor(
    code,
    message,
    { phase = 'network-read', dispatched = false, fallbackEligible = false, cause } = {}
  ) {
    super(message, { cause });
    this.name = 'NetworkReadError';
    this.code = code;
    this.phase = phase;
    this.dispatched = dispatched;
    this.fallbackEligible = fallbackEligible;
  }
}

function fail(code, message, options) {
  throw new NetworkReadError(code, message, options);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '')
    throw new TypeError(`${label} must be a non-empty string`);
  if (value.includes('\0')) throw new TypeError(`${label} must not contain NUL`);
  return value;
}

function requirePositiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive integer at most ${maximum}`);
  }
  return value;
}

function notify(observer, event) {
  if (typeof observer !== 'function') return;
  observer(
    Object.freeze({
      phase: String(event.phase || 'network-read'),
      strategy: String(event.strategy || 'unknown'),
      status: String(event.status || 'observed'),
      code: event.code == null ? null : String(event.code)
    })
  );
}

export function standardReadEnvelope({ url, kind, content }) {
  return {
    trusted: false,
    instructionAuthority: 'none',
    source: { url: url ?? null, kind: requireText(kind, 'kind') },
    content
  };
}

export function readPromotionQualified(promotion) {
  return Boolean(
    promotion?.sanitizedFixtures === true &&
    promotion?.offlineParity === true &&
    promotion?.authorizedLiveReplay === true
  );
}

export function chooseReadStrategy({ requested = 'auto', promotion, available = {} } = {}) {
  if (!STRATEGIES.has(requested)) throw new TypeError(`unsupported read strategy: ${requested}`);
  if (requested !== 'auto') {
    if (available[requested] !== true) {
      fail('strategy-unavailable', `Forced read strategy is unavailable: ${requested}`, {
        phase: 'pre-dispatch',
        fallbackEligible: false
      });
    }
    return requested;
  }

  if (!readPromotionQualified(promotion)) {
    if (available.dom !== true) {
      fail('dom-default-unavailable', 'DOM-default read strategy is unavailable before promotion', {
        phase: 'pre-dispatch',
        fallbackEligible: false
      });
    }
    return 'dom';
  }

  for (const strategy of ['official', 'direct', 'private-replay', 'capture', 'dom']) {
    if (available[strategy] === true) return strategy;
  }
  fail('read-strategy-unavailable', 'No qualified read strategy is available', {
    phase: 'pre-dispatch',
    fallbackEligible: false
  });
}

export function canUseDomFallback(error) {
  return (
    error instanceof NetworkReadError &&
    error.dispatched === false &&
    error.fallbackEligible === true
  );
}

export function createReadPromotionDefaults(actions) {
  if (!Array.isArray(actions) || actions.length === 0)
    throw new TypeError('read promotion actions must be a non-empty array');
  const names = actions.map((action) => requireText(action, 'read promotion action'));
  if (new Set(names).size !== names.length)
    throw new TypeError('read promotion actions must be unique');
  return Object.freeze(
    Object.fromEntries(
      names.map((action) => [
        action,
        Object.freeze({
          sanitizedFixtures: false,
          offlineParity: false,
          authorizedLiveReplay: false
        })
      ])
    )
  );
}

export async function executeNormalizedReadStrategy({
  requested = 'auto',
  promotion,
  handlers = {},
  dom,
  normalize,
  observer
} = {}) {
  if (!isObject(handlers)) throw new TypeError('read handlers must be an object');
  if (typeof dom !== 'function') throw new TypeError('DOM read handler is required');
  if (typeof normalize !== 'function') throw new TypeError('read normalizer is required');
  const unknown = Object.keys(handlers).filter((name) => !HANDLER_STRATEGIES.includes(name));
  if (unknown.length > 0) throw new TypeError(`unsupported read handler: ${unknown.join(', ')}`);

  const normalizedHandlers = {
    dom: async () => normalize(await dom(), { strategy: 'dom' })
  };
  for (const strategy of HANDLER_STRATEGIES) {
    if (typeof handlers[strategy] === 'function') {
      normalizedHandlers[strategy] = async () =>
        normalize(await handlers[strategy](), { strategy });
    }
  }
  return executeReadStrategy({
    requested,
    promotion,
    handlers: normalizedHandlers,
    observer
  });
}

export async function executeReadStrategy({
  requested = 'auto',
  promotion,
  handlers = {},
  observer
} = {}) {
  const available = Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, typeof handler === 'function'])
  );
  const selected = chooseReadStrategy({ requested, promotion, available });
  const order =
    requested === 'auto' && readPromotionQualified(promotion)
      ? ['official', 'direct', 'private-replay', 'capture', 'dom'].filter(
          (name) => typeof handlers[name] === 'function'
        )
      : [selected];
  const start = Math.max(0, order.indexOf(selected));

  for (let index = start; index < order.length; index += 1) {
    const strategy = order[index];
    notify(observer, { phase: 'dispatch', strategy, status: 'started' });
    try {
      const value = await handlers[strategy]();
      notify(observer, { phase: 'dispatch', strategy, status: 'passed' });
      return { strategy, value };
    } catch (error) {
      notify(observer, { phase: error?.phase, strategy, status: 'failed', code: error?.code });
      if (requested !== 'auto' || !canUseDomFallback(error)) throw error;
      if (strategy === 'dom') throw error;
    }
  }
  fail('read-strategy-exhausted', 'Qualified read strategies were exhausted', {
    phase: 'pre-dispatch',
    fallbackEligible: false
  });
}

function exactCookieForUrl(cookie, target) {
  if (!isObject(cookie) || typeof cookie.name !== 'string' || cookie.value == null) return null;
  let cookiePath =
    typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/';
  if (cookie.url) {
    let source;
    try {
      source = new URL(String(cookie.url));
    } catch {
      return null;
    }
    if (source.origin !== target.origin) return null;
    if (!cookie.path) {
      const lastSlash = source.pathname.lastIndexOf('/');
      cookiePath = lastSlash <= 0 ? '/' : source.pathname.slice(0, lastSlash + 1);
    }
  } else if (cookie.domain) {
    if (String(cookie.domain).replace(/^\./, '').toLowerCase() !== target.hostname.toLowerCase())
      return null;
  } else {
    return null;
  }
  const pathMatches =
    target.pathname === cookiePath ||
    (target.pathname.startsWith(cookiePath) &&
      (cookiePath.endsWith('/') || target.pathname[cookiePath.length] === '/'));
  if (!pathMatches) return null;
  return {
    name: cookie.name,
    value: String(cookie.value),
    domain: target.hostname,
    path: cookiePath,
    ...(Number.isFinite(cookie.expires) ? { expires: cookie.expires } : {}),
    ...(typeof cookie.httpOnly === 'boolean' ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.secure === 'boolean' ? { secure: cookie.secure } : {}),
    ...(typeof cookie.sameSite === 'string' ? { sameSite: cookie.sameSite } : {})
  };
}

function normalizeHeaders({
  staticHeaders = {},
  copiedHeaders = {},
  allowedCopiedHeaders = []
} = {}) {
  const allowed = new Set(allowedCopiedHeaders.map((name) => String(name).toLowerCase()));
  const result = Object.create(null);
  for (const [name, value] of Object.entries(staticHeaders)) {
    const key = name.toLowerCase();
    if (HOP_HEADERS.has(key)) throw new TypeError(`forbidden static header: ${name}`);
    result[key] = requireText(String(value), `static header ${name}`);
  }
  for (const [name, value] of Object.entries(copiedHeaders)) {
    const key = name.toLowerCase();
    if (!allowed.has(key)) throw new TypeError(`copied header is not allowlisted: ${name}`);
    if (HOP_HEADERS.has(key)) throw new TypeError(`forbidden copied header: ${name}`);
    result[key] = requireText(String(value), `copied header ${name}`);
  }
  return result;
}

function inspectStructure(value, { maxRecords, maxDepth }) {
  let records = 0;
  const seen = new Set();
  const stack = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.depth > maxDepth)
      fail('response-depth-exceeded', 'JSON response exceeded structural depth', {
        dispatched: true
      });
    if (typeof current.value !== 'object' || current.value === null) continue;
    if (seen.has(current.value))
      fail('response-cycle', 'JSON response contains a cycle', { dispatched: true });
    seen.add(current.value);
    records += Array.isArray(current.value) ? current.value.length : 1;
    if (records > maxRecords)
      fail('response-record-cap', 'JSON response exceeded record cap', { dispatched: true });
    for (const child of Array.isArray(current.value)
      ? current.value
      : Object.values(current.value)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function contentLength(headers) {
  if (!headers) return null;
  const value =
    typeof headers.get === 'function'
      ? headers.get('content-length')
      : (headers['content-length'] ?? headers['Content-Length']);
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function disposeWithPrimary(primary, disposers) {
  const errors = [];
  for (const dispose of disposers) {
    if (typeof dispose !== 'function') continue;
    try {
      await dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (primary && errors.length > 0)
    throw new AggregateError([primary, ...errors], 'network request and cleanup failed');
  if (primary) throw primary;
  if (errors.length > 0) throw new AggregateError(errors, 'network request cleanup failed');
}

export async function isolatedJsonGet({
  requestFactory,
  url,
  allowedOrigins,
  cookies = [],
  staticHeaders,
  copiedHeaders,
  allowedCopiedHeaders,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
  maxBytes = DEFAULT_NETWORK_MAX_BYTES,
  maxRecords = DEFAULT_NETWORK_MAX_RECORDS,
  maxDepth = DEFAULT_NETWORK_MAX_DEPTH,
  normalize = (value) => value,
  observer,
  phase = 'isolated-get'
} = {}) {
  if (typeof requestFactory !== 'function') throw new TypeError('requestFactory is required');
  const target = new URL(requireText(url, 'url'));
  if (target.protocol !== 'https:')
    fail('origin-not-https', 'Isolated GET requires HTTPS', { phase: 'pre-dispatch' });
  const normalizedOrigins = (allowedOrigins || []).map(normalizeOrigin);
  if (normalizedOrigins.length === 0 || !isOriginApproved(target.href, normalizedOrigins)) {
    fail('origin-not-allowed', 'Isolated GET origin is not allowlisted', { phase: 'pre-dispatch' });
  }
  requirePositiveInteger(timeoutMs, 'timeoutMs');
  requirePositiveInteger(maxBytes, 'maxBytes');
  requirePositiveInteger(maxRecords, 'maxRecords');
  requirePositiveInteger(maxDepth, 'maxDepth');
  const headers = normalizeHeaders({ staticHeaders, copiedHeaders, allowedCopiedHeaders });
  const exactCookies = cookies.map((cookie) => exactCookieForUrl(cookie, target)).filter(Boolean);

  let context;
  let response;
  let primary = null;
  let output;
  try {
    context = await requestFactory({
      extraHTTPHeaders: headers,
      storageState: { cookies: exactCookies, origins: [] }
    });
    if (!context || typeof context.get !== 'function')
      throw new TypeError('requestFactory must return an APIRequestContext-like object');
    notify(observer, { phase, strategy: 'direct', status: 'dispatched' });
    response = await context.get(target.href, { timeout: timeoutMs, maxRedirects: 0 });
    const finalUrl = typeof response.url === 'function' ? response.url() : target.href;
    if (new URL(finalUrl).origin !== target.origin)
      fail('redirect-disallowed', 'Isolated GET changed origin', { phase, dispatched: true });
    const status = typeof response.status === 'function' ? response.status() : null;
    if (
      !Number.isInteger(status) ||
      status < 200 ||
      status > 299 ||
      status === 204 ||
      status === 205
    ) {
      fail(
        status === 401 || status === 403
          ? 'network-auth'
          : status === 429
            ? 'network-rate-limit'
            : 'network-http-status',
        `Isolated GET failed with status ${status}`,
        { phase, dispatched: true }
      );
    }
    const headersObject = typeof response.headers === 'function' ? await response.headers() : null;
    const advisedLength = contentLength(headersObject);
    if (advisedLength != null && advisedLength > maxBytes)
      fail('response-size-advisory', 'Response Content-Length exceeded cap', {
        phase,
        dispatched: true
      });
    if (typeof response.body !== 'function')
      fail('response-body-unavailable', 'Response body is unavailable', {
        phase,
        dispatched: true
      });
    const body = await response.body();
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (bytes.length > maxBytes)
      fail('response-size-cap', 'Buffered response exceeded cap', { phase, dispatched: true });
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      fail('response-utf8-invalid', 'Response was not strict UTF-8', {
        phase,
        dispatched: true,
        cause: error
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      fail('response-json-invalid', 'Response was not valid JSON', {
        phase,
        dispatched: true,
        cause: error
      });
    }
    inspectStructure(parsed, { maxRecords, maxDepth });
    output = await normalize(parsed);
  } catch (error) {
    primary =
      error instanceof NetworkReadError
        ? error
        : new NetworkReadError(
            'network-request-failed',
            error?.message || 'Network request failed',
            {
              phase,
              dispatched: Boolean(context),
              fallbackEligible: !context,
              cause: error
            }
          );
  }

  await disposeWithPrimary(primary, [
    response && typeof response.dispose === 'function' ? () => response.dispose() : null,
    context && typeof context.dispose === 'function' ? () => context.dispose() : null
  ]);
  return output;
}

function normalizeSchemaMap(value, label, { header = false } = {}) {
  if (value == null) return Object.freeze(Object.create(null));
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
  const output = Object.create(null);
  for (const [rawKey, rule] of Object.entries(value)) {
    requireText(rawKey, `${label} key`);
    const key = header ? rawKey.toLowerCase() : rawKey;
    if (Object.hasOwn(output, key))
      throw new TypeError(`${label} contains duplicate normalized key: ${key}`);
    if (!isObject(rule)) throw new TypeError(`${label}.${key} must be an object`);
    const mode = rule.mode || 'param';
    const allowedModes = header ? ['fixed', 'param'] : ['fixed', 'param', 'cursor'];
    if (!allowedModes.includes(mode)) throw new TypeError(`${label}.${key}.mode is invalid`);
    if (header && HOP_HEADERS.has(key))
      throw new TypeError(`capability header is forbidden: ${key}`);
    const maxLength = requirePositiveInteger(
      rule.maxLength ?? 2048,
      `${label}.${key}.maxLength`,
      8192
    );
    let fixed;
    if (mode === 'fixed') {
      fixed = requireText(rule.fixed, `${label}.${key}.fixed`);
      if (fixed.length > maxLength) throw new TypeError(`${label}.${key}.fixed exceeds maxLength`);
    }
    output[key] = Object.freeze({
      mode,
      required: rule.required === true,
      sensitive: rule.sensitive === true,
      cardinality: rule.cardinality || 'one',
      maxLength,
      ...(mode === 'fixed' ? { fixed } : {})
    });
    if (output[key].cardinality !== 'one')
      throw new TypeError(`${label}.${key}.cardinality must be one`);
  }
  return Object.freeze(output);
}

export function validateObservedPrivateCapability(input) {
  if (!isObject(input)) throw new TypeError('observed private capability must be an object');
  const origin = normalizeOrigin(requireText(input.origin, 'capability.origin'));
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== 'https:') throw new TypeError('capability.origin must use HTTPS');
  const path = requireText(input.path, 'capability.path');
  if (!path.startsWith('/') || path.includes('?') || path.includes('#'))
    throw new TypeError('capability.path must be an exact pathname');
  const limits = {
    ttlMs: requirePositiveInteger(
      input.limits?.ttlMs ?? MAX_PRIVATE_LEASE_MS,
      'capability.limits.ttlMs',
      MAX_PRIVATE_LEASE_MS
    ),
    maxUses: requirePositiveInteger(
      input.limits?.maxUses ?? MAX_PRIVATE_LEASE_USES,
      'capability.limits.maxUses',
      MAX_PRIVATE_LEASE_USES
    ),
    maxBytes: requirePositiveInteger(
      input.limits?.maxBytes ?? DEFAULT_NETWORK_MAX_BYTES,
      'capability.limits.maxBytes'
    ),
    maxRecords: requirePositiveInteger(
      input.limits?.maxRecords ?? DEFAULT_NETWORK_MAX_RECORDS,
      'capability.limits.maxRecords'
    )
  };
  if (input.cursorExtractor != null && typeof input.cursorExtractor !== 'function')
    throw new TypeError('capability.cursorExtractor must be a function');
  const query = normalizeSchemaMap(input.query, 'capability.query');
  const headers = normalizeSchemaMap(input.headers, 'capability.headers', { header: true });
  const cursorKeys = Object.entries(query)
    .filter(([, rule]) => rule.mode === 'cursor')
    .map(([key]) => key);
  if (cursorKeys.length > 1) throw new TypeError('capability.query may declare at most one cursor');
  if (input.cursorExtractor && cursorKeys.length !== 1)
    throw new TypeError('cursorExtractor requires exactly one cursor query rule');
  return Object.freeze({
    provider: requireText(input.provider, 'capability.provider'),
    action: requireText(input.action, 'capability.action'),
    origin,
    path,
    query,
    headers,
    cursorKey: cursorKeys[0] || null,
    limits: Object.freeze(limits),
    cursorExtractor: input.cursorExtractor || null
  });
}

function valuesFor(url, key) {
  return url.searchParams.getAll(key);
}

function qualifyQuery(url, schema, supplied = {}) {
  const declared = new Set(Object.keys(schema));
  for (const key of url.searchParams.keys()) {
    if (!declared.has(key))
      fail('private-query-undeclared', `Observed query key is undeclared: ${key}`, {
        phase: 'qualification'
      });
  }
  const output = new URLSearchParams();
  for (const [key, rule] of Object.entries(schema)) {
    const observed = valuesFor(url, key);
    if (observed.length > 1)
      fail('private-query-cardinality', `Observed query key is repeated: ${key}`, {
        phase: 'qualification'
      });
    const suppliedPresent = Object.hasOwn(supplied, key);
    if (suppliedPresent && rule.mode === 'fixed') {
      fail('private-query-fixed-supplied', `Fixed query key cannot be synthesized: ${key}`, {
        phase: 'pre-dispatch'
      });
    }
    const value = suppliedPresent ? supplied[key] : observed[0];
    if (rule.required && (observed[0] == null || observed[0] === '')) {
      fail('private-query-required', `Required observed query key is missing: ${key}`, {
        phase: 'qualification'
      });
    }
    if (rule.mode === 'fixed' && value != null && String(value) !== rule.fixed) {
      fail('private-query-fixed-mismatch', `Fixed query mismatch: ${key}`, {
        phase: 'qualification'
      });
    }
    if (value == null || value === '') continue;
    const text = String(value);
    if (text.length > rule.maxLength)
      fail('private-query-length', `Query value exceeded cap: ${key}`, { phase: 'qualification' });
    output.set(key, text);
  }
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key))
      fail('private-query-undeclared', `Supplied query key is undeclared: ${key}`, {
        phase: 'pre-dispatch'
      });
  }
  return output;
}

function qualifyHeaders(observed, schema) {
  const source = Object.fromEntries(
    Object.entries(observed || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  const output = Object.create(null);
  for (const [key, rule] of Object.entries(schema)) {
    const value = source[key];
    if (rule.required && (value == null || value === ''))
      fail('private-header-required', `Required observed header is missing: ${key}`, {
        phase: 'qualification'
      });
    if (value == null || value === '') continue;
    const text = String(value);
    if (text.length > rule.maxLength)
      fail('private-header-length', `Observed header exceeded cap: ${key}`, {
        phase: 'qualification'
      });
    if (rule.mode === 'fixed' && text !== rule.fixed) {
      fail('private-header-fixed-mismatch', `Fixed header mismatch: ${key}`, {
        phase: 'qualification'
      });
    }
    output[key] = rule.mode === 'fixed' ? rule.fixed : text;
  }
  return output;
}

export function qualifyObservedPrivateRequest({
  capability,
  method,
  url,
  headers,
  pageOne = false
}) {
  const validated = validateObservedPrivateCapability(capability);
  if (String(method).toUpperCase() !== 'GET')
    fail('private-method-disallowed', 'Observed private capability accepts GET only', {
      phase: 'qualification'
    });
  const parsed = new URL(url);
  if (parsed.origin !== validated.origin || parsed.pathname !== validated.path) {
    fail('private-no-match', 'Observed request does not match exact origin/path', {
      phase: 'pre-dispatch',
      fallbackEligible: true
    });
  }
  if (pageOne && validated.cursorKey && parsed.searchParams.has(validated.cursorKey)) {
    fail('private-page-one-cursor', 'Observed page-one request must not contain a cursor', {
      phase: 'qualification',
      dispatched: true
    });
  }
  const query = qualifyQuery(parsed, validated.query);
  const copiedHeaders = qualifyHeaders(headers, validated.headers);
  return Object.freeze({
    capability: validated,
    url: `${validated.origin}${validated.path}?${query}`.replace(/\?$/, ''),
    copiedHeaders
  });
}

function bindingMatches(expected, actual) {
  return (
    expected.session === actual?.session &&
    expected.page === actual?.page &&
    expected.context === actual?.context &&
    expected.account === actual?.account &&
    expected.origin === actual?.origin &&
    expected.provider === actual?.provider &&
    expected.action === actual?.action
  );
}

function validateBinding(binding, capability) {
  if (!isObject(binding) || !binding.session || !binding.page || !binding.context)
    throw new TypeError('replay binding requires session, page, and context objects');
  const normalized = Object.freeze({
    session: binding.session,
    page: binding.page,
    context: binding.context,
    account: requireText(binding.account, 'binding.account'),
    origin: normalizeOrigin(requireText(binding.origin, 'binding.origin')),
    provider: requireText(binding.provider, 'binding.provider'),
    action: requireText(binding.action, 'binding.action')
  });
  if (
    normalized.origin !== capability.origin ||
    normalized.provider !== capability.provider ||
    normalized.action !== capability.action
  ) {
    throw new TypeError('replay binding does not match capability');
  }
  return normalized;
}

function scrubReplayTemplate(template) {
  if (!isObject(template) || !isObject(template.headers)) {
    throw new TypeError('observed-private template and headers must be mutable objects');
  }
  if (Object.isFrozen(template) || Object.isFrozen(template.headers)) {
    throw new TypeError('observed-private template and headers must be mutable');
  }
  for (const key of Object.keys(template.headers)) template.headers[key] = '';
  template.headers = null;
  template.url = null;
  template.method = null;
}

function revokePrivateLease(lease) {
  lease.active = false;
  const page = lease.binding?.page;
  lease.binding = null;
  lease.url = null;
  if (lease.copiedHeaders) {
    for (const key of Object.keys(lease.copiedHeaders)) lease.copiedHeaders[key] = '';
  }
  lease.copiedHeaders = null;
  if (lease.cookies) {
    for (const cookie of lease.cookies) cookie.value = '';
  }
  lease.cookies = null;
  lease.page1 = null;
  const leases = page ? PRIVATE_LEASES.get(page) : null;
  leases?.delete(lease);
  if (page && leases?.size === 0) PRIVATE_LEASES.delete(page);
}

export async function withObservedPrivateReplay(
  {
    binding,
    capability,
    template,
    requestFactory,
    cookies = [],
    now = () => Date.now(),
    observer
  } = {},
  fn
) {
  if (typeof fn !== 'function')
    throw new TypeError('withObservedPrivateReplay callback is required');
  const validated = validateObservedPrivateCapability(capability);
  const bound = validateBinding(binding, validated);
  let qualified;
  try {
    qualified = qualifyObservedPrivateRequest({
      capability: validated,
      method: template?.method || 'GET',
      url: template?.url,
      headers: template?.headers,
      pageOne: true
    });
  } finally {
    scrubReplayTemplate(template);
  }
  let leases = PRIVATE_LEASES.get(bound.page);
  if (leases && [...leases].some((lease) => lease.active && bindingMatches(lease.binding, bound))) {
    throw new Error('binding already owns an observed-private lease');
  }
  if (!leases) {
    leases = new Set();
    PRIVATE_LEASES.set(bound.page, leases);
  }
  const lease = {
    binding: bound,
    url: qualified.url,
    copiedHeaders: { ...qualified.copiedHeaders },
    cookies: cookies.map((cookie) => ({ ...cookie })),
    page1: template?.page1,
    createdAt: now(),
    lastSeenAt: null,
    uses: 0,
    active: true
  };
  if (!Number.isFinite(lease.createdAt)) throw new TypeError('lease clock must be finite');
  leases.add(lease);

  const client = Object.freeze({
    page1: lease.page1,
    async replay({ binding: requestBinding = binding, query = {} } = {}) {
      if (!lease.active || !PRIVATE_LEASES.get(bound.page)?.has(lease))
        fail('private-lease-inactive', 'Observed-private lease is inactive', {
          phase: 'pre-dispatch'
        });
      if (!bindingMatches(lease.binding, requestBinding))
        fail('private-lease-binding', 'Observed-private lease binding mismatch', {
          phase: 'pre-dispatch'
        });
      const current = now();
      if (
        !Number.isFinite(current) ||
        current < lease.createdAt ||
        (lease.lastSeenAt != null && current < lease.lastSeenAt) ||
        current - lease.createdAt >= validated.limits.ttlMs
      ) {
        revokePrivateLease(lease);
        fail('private-lease-expired', 'Observed-private lease expired', { phase: 'pre-dispatch' });
      }
      lease.lastSeenAt = current;
      if (lease.uses >= validated.limits.maxUses)
        fail('private-lease-exhausted', 'Observed-private lease use cap reached', {
          phase: 'pre-dispatch'
        });
      const parsed = new URL(lease.url);
      const nextQuery = qualifyQuery(parsed, validated.query, query);
      const replayUrl = `${validated.origin}${validated.path}?${nextQuery}`.replace(/\?$/, '');
      lease.uses += 1;
      return isolatedJsonGet({
        requestFactory,
        url: replayUrl,
        allowedOrigins: [validated.origin],
        cookies: lease.cookies,
        copiedHeaders: lease.copiedHeaders,
        allowedCopiedHeaders: Object.keys(validated.headers),
        maxBytes: validated.limits.maxBytes,
        maxRecords: validated.limits.maxRecords,
        observer,
        phase: 'private-replay'
      });
    },
    get usesRemaining() {
      return Math.max(0, validated.limits.maxUses - lease.uses);
    }
  });

  try {
    return await fn(client);
  } finally {
    revokePrivateLease(lease);
  }
}

function requestHeaders(request) {
  if (typeof request.allHeaders === 'function') return request.allHeaders();
  if (typeof request.headers === 'function') return request.headers();
  return {};
}

export async function captureObservedPrivateResponse({
  page,
  session,
  capability,
  targetUrl,
  responseTimeoutMs = 1000,
  requestSettleMs = 25
} = {}) {
  const validated = validateObservedPrivateCapability(capability);
  if (!page || typeof page.on !== 'function' || typeof page.off !== 'function')
    throw new TypeError('page event API is required');
  if (!session || typeof session.navigateGuardedForRead !== 'function')
    throw new TypeError('strict provider session is required');
  requirePositiveInteger(responseTimeoutMs, 'responseTimeoutMs', 10_000);
  requirePositiveInteger(requestSettleMs, 'requestSettleMs', 1000);
  const candidates = new Map();
  const completed = [];
  let matchingRequests = 0;
  let qualifiedRequests = 0;
  let terminalError = null;
  let wake = null;
  const signal = () => {
    if (wake) {
      const resolve = wake;
      wake = null;
      resolve();
    }
  };
  const waitForSignal = (milliseconds) =>
    new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        if (wake === done) wake = null;
        resolve();
      };
      wake = done;
      timer = setTimeout(done, milliseconds);
    });
  const captureFailure = (error) => {
    if (error?.code === 'private-no-match') return null;
    if (error instanceof NetworkReadError) {
      error.dispatched = true;
      error.fallbackEligible = false;
      return error;
    }
    return new NetworkReadError(
      'private-capture-qualification',
      error?.message || 'Private request qualification failed',
      {
        phase: 'capture',
        dispatched: true,
        fallbackEligible: false,
        cause: error
      }
    );
  };

  const onRequest = (request) => {
    const method = typeof request.method === 'function' ? request.method() : '';
    const requestUrl = typeof request.url === 'function' ? request.url() : '';
    try {
      const parsed = new URL(requestUrl);
      if (
        String(method).toUpperCase() === 'GET' &&
        parsed.origin === validated.origin &&
        parsed.pathname === validated.path
      ) {
        matchingRequests += 1;
      }
    } catch {}
    const qualification = (async () => {
      try {
        const result = qualifyObservedPrivateRequest({
          capability: validated,
          method,
          url: requestUrl,
          headers: await requestHeaders(request),
          pageOne: true
        });
        qualifiedRequests += 1;
        return result;
      } catch (error) {
        const failure = captureFailure(error);
        if (failure) terminalError = terminalError || failure;
        return null;
      } finally {
        signal();
      }
    })();
    candidates.set(request, qualification);
  };
  const onResponse = (response) => {
    void (async () => {
      const request = typeof response.request === 'function' ? response.request() : null;
      const qualification = candidates.get(request);
      const qualified = qualification ? await qualification : null;
      if (!qualified) return;
      const status = typeof response.status === 'function' ? response.status() : null;
      if (
        !Number.isInteger(status) ||
        status < 200 ||
        status > 299 ||
        status === 204 ||
        status === 205
      ) {
        fail('private-capture-status', `Captured private response failed with status ${status}`, {
          phase: 'capture',
          dispatched: true
        });
      }
      const body = typeof response.body === 'function' ? await response.body() : null;
      if (!body)
        fail('private-capture-body', 'Captured private response body is unavailable', {
          phase: 'capture',
          dispatched: true
        });
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (bytes.length > validated.limits.maxBytes)
        fail('private-capture-size', 'Captured private response exceeded size cap', {
          phase: 'capture',
          dispatched: true
        });
      let data;
      try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) {
        fail('private-capture-json', 'Captured private response was not strict JSON', {
          phase: 'capture',
          dispatched: true,
          cause: error
        });
      }
      inspectStructure(data, {
        maxRecords: validated.limits.maxRecords,
        maxDepth: DEFAULT_NETWORK_MAX_DEPTH
      });
      completed.push({ qualified, data });
    })()
      .catch((error) => {
        terminalError = terminalError || error;
      })
      .finally(signal);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    await session.navigateGuardedForRead(targetUrl);
    const deadline = Date.now() + responseTimeoutMs;
    let settleDeadline = null;
    while (
      !terminalError &&
      matchingRequests <= 1 &&
      qualifiedRequests <= 1 &&
      completed.length <= 1
    ) {
      const now = Date.now();
      if (completed.length === 1) {
        settleDeadline ??= Math.min(deadline, now + requestSettleMs);
      }
      const boundary = settleDeadline ?? deadline;
      const remaining = boundary - now;
      if (remaining <= 0) break;
      await waitForSignal(remaining);
    }

    if (terminalError) throw terminalError;
    if (matchingRequests > 1 || qualifiedRequests > 1 || completed.length > 1) {
      fail(
        'private-capture-ambiguous',
        'More than one matching private request or response was observed',
        {
          phase: 'capture',
          dispatched: true
        }
      );
    }
    if (qualifiedRequests === 0) {
      if (matchingRequests > 0) {
        fail('private-capture-timeout', 'Matching private request did not finish qualification', {
          phase: 'capture',
          dispatched: true
        });
      }
      fail('private-no-match', 'No qualified private request was observed', {
        phase: 'pre-dispatch',
        fallbackEligible: true
      });
    }
    if (completed.length === 0) {
      fail('private-response-timeout', 'Qualified private request had no correlated response', {
        phase: 'capture',
        dispatched: true
      });
    }
  } finally {
    if (wake) {
      const resolve = wake;
      wake = null;
      resolve();
    }
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
  const [{ qualified, data }] = completed;
  return {
    page1: data,
    template: { method: 'GET', url: qualified.url, headers: qualified.copiedHeaders, page1: data }
  };
}

export function extractBoundedCursor(capability, payload) {
  const validated = validateObservedPrivateCapability(capability);
  if (!validated.cursorExtractor) return null;
  const cursor = validated.cursorExtractor(payload);
  if (cursor == null || cursor === '') return null;
  const text = String(cursor);
  const cursorRule = validated.query[validated.cursorKey];
  if (text.length > cursorRule.maxLength)
    fail('private-cursor-length', 'Extracted cursor exceeded cap', {
      phase: 'normalization',
      dispatched: true
    });
  return text;
}
