/**
 * Canonical target trust-boundary classification for navigation and redirects.
 * Classification is local and must be enforced before browser dispatch.
 */
import net from 'node:net';

const OK = 'ok';
const APPROVAL_REQUIRED = 'approvalRequired';
const BLOCKER = 'blocker';

const UNSAFE_PROTOCOLS = new Set([
  'file:',
  'data:',
  'javascript:',
  'chrome:',
  'devtools:'
]);

/** @param {string} protocol @returns {boolean} Whether the protocol is unsafe. */
export function isUnsafeScheme(protocol) {
  const normalized = String(protocol || '').toLowerCase();
  if (!normalized) return true;
  if (UNSAFE_PROTOCOLS.has(normalized)) return true;
  return !['http:', 'https:', 'about:'].includes(normalized);
}

/** @param {string|URL} url @returns {boolean} Whether URL userinfo is present. */
export function hasEmbeddedCredentials(url) {
  const parsed = parseUrl(url);
  if (!parsed.url) return false;
  return parsed.url.username !== '' || parsed.url.password !== '';
}

export function normalizeOrigin(url) {
  const parsed = parseUrl(url);
  if (!parsed.url) return null;
  if (parsed.url.protocol === 'about:' && parsed.url.href === 'about:blank') return 'about:blank';
  if (parsed.url.origin === 'null') return null;
  return parsed.url.origin.toLowerCase();
}

/** @param {string} host @returns {boolean} Whether the IP is private/loopback. */
export function isPrivateIpLiteral(host) {
  const classification = classifyIpLiteral(host);
  return classification?.scope === 'private' || classification?.scope === 'loopback';
}

/**
 * @param {string} host
 * @returns {boolean} Whether the hostname is internal.
 */
export function isInternalHostname(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  if (classifyIpLiteral(normalized)) return false;
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || !normalized.includes('.');
}
/**
 * Classifies a target without I/O; callers must enforce the disposition.
 * @param {string|URL} input @param {object} [options] @returns {object} Classification.
 */

export function classifyTargetUrl(input, options = {}) {
  const parsed = parseUrl(input);
  if (!parsed.url) {
    return makeResult({
      input,
      disposition: BLOCKER,
      reason: 'invalid-url',
      detail: parsed.error?.message
    });
  }

  const url = parsed.url;
  const protocol = url.protocol.toLowerCase();

  if (protocol === 'about:') {
    if (url.href === 'about:blank' && allowsAboutBlank(options)) {
      return makeResult({ input, url, disposition: OK, reason: 'about-blank-setup' });
    }
    return makeResult({ input, url, disposition: BLOCKER, reason: 'unsafe-scheme' });
  }

  if (isUnsafeScheme(protocol)) {
    return makeResult({ input, url, disposition: BLOCKER, reason: 'unsafe-scheme' });
  }

  if (hasEmbeddedCredentials(url)) {
    return makeResult({ input, url, disposition: BLOCKER, reason: 'embedded-credentials' });
  }

  const host = normalizeHost(url.hostname);
  if (!host) {
    return makeResult({ input, url, disposition: BLOCKER, reason: 'missing-host' });
  }

  const ip = classifyIpLiteral(host);
  if (ip) {
    if (ip.scope === 'blocked') {
      return makeResult({ input, url, disposition: BLOCKER, reason: ip.reason });
    }
    if (ip.scope === 'private' || ip.scope === 'loopback') {
      return makeResult({ input, url, disposition: APPROVAL_REQUIRED, reason: ip.reason });
    }
    return makeResult({
      input,
      url,
      disposition: protocol === 'https:' ? APPROVAL_REQUIRED : APPROVAL_REQUIRED,
      reason: protocol === 'https:' ? 'public-ip-literal' : 'insecure-http'
    });
  }

  if (isInternalHostname(host)) {
    return makeResult({ input, url, disposition: APPROVAL_REQUIRED, reason: 'internal-hostname' });
  }

  if (protocol === 'http:') {
    return makeResult({ input, url, disposition: APPROVAL_REQUIRED, reason: 'insecure-http' });
  }

  return makeResult({ input, url, disposition: OK, reason: 'public-https-fqdn' });
}

export function classifyRedirect(fromUrl, toUrl, options = {}) {
  const sourceOrigin = normalizeOrigin(fromUrl);
  const final = classifyTargetUrl(toUrl, options);
  return {
    ...final,
    type: 'redirect',
    sourceOrigin,
    finalOrigin: final.origin
  };
}

export function assertNavigationAllowed(targetUrl, options = {}) {
  const result = classifyTargetUrl(targetUrl, options);
  if (result.disposition !== OK) {
    const error = new Error(`Navigation blocked by target safety: ${result.reason}`);
    error.code = 'HYPER_CLOAKING_TARGET_SAFETY';
    error.classification = result;
    throw error;
  }
  return result;
}

function makeResult({ input, url, disposition, reason, detail }) {
  return {
    input: String(input),
    href: url?.href ?? null,
    origin: url ? normalizeOrigin(url) : null,
    protocol: url?.protocol ?? null,
    host: url?.hostname ? normalizeHost(url.hostname) : null,
    disposition,
    reason,
    detail
  };
}

function parseUrl(input) {
  if (input instanceof URL) return { url: input };
  try {
    return { url: new URL(String(input)) };
  } catch (error) {
    return { url: null, error };
  }
}

function allowsAboutBlank(options) {
  return options.allowAboutBlank === true
    || options.aboutBlank === true
    || options.context === 'setup'
    || options.context === 'blank'
    || options.context === 'setup/blank';
}

function normalizeHost(host) {
  return String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
}

function classifyIpLiteral(host) {
  const normalized = normalizeHost(host);
  const version = net.isIP(normalized);
  if (version === 4) return classifyIpv4(normalized);
  if (version === 6) return classifyIpv6(normalized);
  return null;
}

function classifyIpv4(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  const [a, b, c, d] = parts;

  if (a === 169 && b === 254 && c === 169 && d === 254) return { scope: 'blocked', reason: 'cloud-metadata-address' };
  if (a === 10) return { scope: 'private', reason: 'rfc1918-address' };
  if (a === 172 && b >= 16 && b <= 31) return { scope: 'private', reason: 'rfc1918-address' };
  if (a === 192 && b === 168) return { scope: 'private', reason: 'rfc1918-address' };
  if (a === 127) return { scope: 'loopback', reason: 'loopback-address' };
  if (a === 169 && b === 254) return { scope: 'blocked', reason: 'link-local-address' };
  if (a === 0 || host === '255.255.255.255') return { scope: 'blocked', reason: 'unspecified-address' };
  if (a >= 224) return { scope: 'blocked', reason: 'multicast-or-reserved-address' };
  if (a === 100 && b >= 64 && b <= 127) return { scope: 'blocked', reason: 'reserved-address' };
  if (a === 192 && b === 0 && c === 0) return { scope: 'blocked', reason: 'reserved-address' };
  if (a === 192 && b === 0 && c === 2) return { scope: 'blocked', reason: 'reserved-address' };
  if (a === 198 && (b === 18 || b === 19)) return { scope: 'blocked', reason: 'reserved-address' };
  if (a === 198 && b === 51 && c === 100) return { scope: 'blocked', reason: 'reserved-address' };
  if (a === 203 && b === 0 && c === 113) return { scope: 'blocked', reason: 'reserved-address' };
  return { scope: 'public', reason: 'public-ip-literal' };
}

function classifyIpv6(host) {
  const normalized = host.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) return classifyIpv4(mappedIpv4);
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return { scope: 'blocked', reason: 'unspecified-address' };
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return { scope: 'loopback', reason: 'loopback-address' };
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if ((first & 0xffc0) === 0xfe80) return { scope: 'blocked', reason: 'link-local-address' };
  if ((first & 0xfe00) === 0xfc00) return { scope: 'private', reason: 'unique-local-address' };
  if ((first & 0xff00) === 0xff00) return { scope: 'blocked', reason: 'multicast-or-reserved-address' };
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8::') return { scope: 'blocked', reason: 'reserved-address' };
  return { scope: 'public', reason: 'public-ip-literal' };
}

function ipv4FromMappedIpv6(normalized) {
  const dotted = normalized.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (dotted) return dotted[1];
  const hex = normalized.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join('.');
}
