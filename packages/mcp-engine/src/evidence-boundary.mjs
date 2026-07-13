/**
 * Sanitizes external evidence and emits trust-boundary metadata.
 * Redaction is deterministic; external content never receives instruction authority.
 * @module engine/evidence-boundary
 */

function isoTime(value) {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function summarizeRedactions(redactions) {
  if (!redactions || typeof redactions !== 'object') return {};
  return Object.fromEntries(Object.entries(redactions).filter(([, count]) => Number(count) > 0));
}

function replaceAndCount(text, pattern, replacement, counts, key) {
  return text.replace(pattern, (...args) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
}

/**
 * @param {unknown} text Evidence text coerced to a string.
 * @param {{mask?: string}} [options] Replacement mask.
 * @returns {{text: string, redactions: Record<string, number>}} Redacted text and counts.
 */
export function redactEvidenceText(text, options = {}) {
  const counts = {};
  let redacted = String(text ?? '');
  const mask = options.mask ?? '[REDACTED]';

  redacted = replaceAndCount(
    redacted,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    mask,
    counts,
    'email'
  );
  redacted = replaceAndCount(
    redacted,
    /\b(Authorization\s*:\s*)(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    (_, prefix, scheme) => `${prefix}${scheme} ${mask}`,
    counts,
    'authorization'
  );
  redacted = replaceAndCount(
    redacted,
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    (_, scheme) => `${scheme} ${mask}`,
    counts,
    'authorization'
  );
  redacted = replaceAndCount(
    redacted,
    /\b(cookie\s*:\s*)[^\n\r;]+(?:;\s*[^\n\r;=]+=[^\n\r;]+)*/gi,
    (_, prefix) => `${prefix}${mask}`,
    counts,
    'cookie'
  );
  redacted = replaceAndCount(
    redacted,
    /\b(sessionid|session_id|sid|token|access_token|refresh_token|api[_-]?key|secret|password)\s*[:=]\s*['"]?[^'"\s,;]{6,}['"]?/gi,
    (match, key) => `${key}=${mask}`,
    counts,
    'secret'
  );
  redacted = replaceAndCount(
    redacted,
    /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    mask,
    counts,
    'token'
  );

  return {
    text: redacted,
    redactions: summarizeRedactions(counts)
  };
}

export function markUntrustedBrowserContent({ url, content, kind, retrievedAt, redactions } = {}) {
  const redacted = redactEvidenceText(content, redactions);
  return {
    trusted: false,
    instructionAuthority: 'none',
    source: {
      url: url ?? null,
      kind: kind ?? 'browser-content',
      retrievedAt: isoTime(retrievedAt)
    },
    content: redacted.text,
    redactions: redacted.redactions
  };
}

export function summarizeEvidenceRef({ path, url, kind, trusted } = {}) {
  return {
    path: path ?? null,
    url: url ?? null,
    kind: kind ?? 'evidence',
    trusted: Boolean(trusted),
    instructionAuthority: trusted ? 'repository-or-user-contract' : 'none'
  };
}
