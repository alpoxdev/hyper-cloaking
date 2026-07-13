import { classifyTargetUrl, normalizeOrigin } from '../../target-safety.mjs';

/** Normalize and validate a non-empty unique allowlist of origins. @param {string[]} allowedOrigins @returns {ReadonlyArray<string>} Canonical origins. @throws {Error} For non-array, empty, invalid, opaque, or duplicate origins. */
export function normalizeAllowedOrigins(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error('allowedOrigins must be a non-empty array');
  const normalized = allowedOrigins.map((value) => normalizeOrigin(value));
  if (normalized.some((value) => value === null)) throw new Error('allowedOrigins contains an invalid or opaque origin');
  if (new Set(normalized).size !== normalized.length) throw new Error('allowedOrigins contains duplicates');
  return Object.freeze(normalized);
}

/** Check a URL against the normalized origin allowlist and target-safety classifier. @param {{url:string,allowedOrigins:string[],classify?:Function,allowAboutBlank?:boolean}} options @returns {{ok:true,url:string,origin:string,classification:object}|{ok:false,reason:string,url:string,origin?:string,classification?:object}} Structured allow/deny result. @throws {Error} For invalid allowlist input or classifier errors. @sideeffects None. */
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
