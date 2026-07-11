import { classifyTargetUrl, normalizeOrigin } from '../../target-safety.mjs';

export function normalizeAllowedOrigins(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error('allowedOrigins must be a non-empty array');
  const normalized = allowedOrigins.map((value) => normalizeOrigin(value));
  if (normalized.some((value) => value === null)) throw new Error('allowedOrigins contains an invalid or opaque origin');
  if (new Set(normalized).size !== normalized.length) throw new Error('allowedOrigins contains duplicates');
  return Object.freeze(normalized);
}

export function guardAllowedOrigin({ url, allowedOrigins, classify = classifyTargetUrl, allowAboutBlank = false }) {
  if (allowAboutBlank && url === 'about:blank') return { ok: true, url, origin: 'about:blank', classification: classify(url, { allowAboutBlank: true }) };
  const origin = normalizeOrigin(url);
  if (!origin) return { ok: false, reason: 'invalid-origin', url };
  const normalizedAllowed = normalizeAllowedOrigins(allowedOrigins);
  if (!normalizedAllowed.includes(origin)) return { ok: false, reason: 'origin-not-in-allowlist', url, origin };
  const classification = classify(url);
  if (classification.disposition !== 'ok') return { ok: false, reason: 'target-safety-rejected', url, origin, classification };
  return { ok: true, url, origin, classification };
}
