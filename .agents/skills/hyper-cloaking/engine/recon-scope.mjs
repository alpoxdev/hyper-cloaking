import { classifyTargetUrl, normalizeOrigin } from './target-safety.mjs';

export { normalizeOrigin } from './target-safety.mjs';

export function isSameOrigin(a, b) {
  const left = normalizeOrigin(a);
  const right = normalizeOrigin(b);
  return left !== null && right !== null && left === right;
}

export function isOriginApproved(origin, approvedOrigins = []) {
  const normalized = normalizeOrigin(origin) ?? normalizeApprovedOrigin(origin);
  if (!normalized) return false;
  return approvedOrigins.some((approved) => {
    const approvedOrigin = normalizeOrigin(approved) ?? normalizeApprovedOrigin(approved);
    return approvedOrigin === normalized;
  });
}

export function classifyEvidenceScope({ targetUrl, candidateUrl, approvedOrigins = [] } = {}) {
  const targetOrigin = normalizeOrigin(targetUrl);
  const candidateOrigin = normalizeOrigin(candidateUrl);
  const candidateSafety = classifyTargetUrl(candidateUrl, { allowAboutBlank: true });

  if (candidateSafety.disposition === 'blocker') {
    return makeScope('blocker', 'unsafe-candidate', targetOrigin, candidateOrigin, candidateSafety);
  }

  if (targetOrigin && candidateOrigin && targetOrigin === candidateOrigin) {
    return makeScope('ok', 'same-origin', targetOrigin, candidateOrigin, candidateSafety, false);
  }

  if (candidateOrigin && isOriginApproved(candidateOrigin, approvedOrigins)) {
    return makeScope('ok', 'approved-origin', targetOrigin, candidateOrigin, candidateSafety, true);
  }

  return makeScope('approvalRequired', 'cross-origin', targetOrigin, candidateOrigin, candidateSafety);
}

export function makeEvidencePlan({ targetUrl, approvedOrigins = [], requestedEvidenceKinds = [] } = {}) {
  const targetOrigin = normalizeOrigin(targetUrl);
  const normalizedApprovedOrigins = [...new Set(
    approvedOrigins
      .map((origin) => normalizeOrigin(origin) ?? normalizeApprovedOrigin(origin))
      .filter(Boolean)
  )];
  const evidenceKinds = [...new Set(requestedEvidenceKinds.map((kind) => String(kind)))];

  return {
    targetOrigin,
    approvedOrigins: normalizedApprovedOrigins,
    requestedEvidenceKinds: evidenceKinds,
    boundaries: {
      sameOriginAllowed: targetOrigin !== null,
      approvedOriginsAllowed: normalizedApprovedOrigins,
      networkExpansion: false,
      crawlOrScan: false
    }
  };
}

function makeScope(disposition, reason, targetOrigin, candidateOrigin, candidateSafety, approvedOrigin = false) {
  return {
    disposition,
    reason,
    targetOrigin,
    candidateOrigin,
    candidateSafety,
    sameOrigin: targetOrigin !== null && targetOrigin === candidateOrigin,
    approvedOrigin,
    fetch: false,
    crawl: false,
    scan: false
  };
}

function normalizeApprovedOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const trimmed = origin.trim().toLowerCase().replace(/\/$/, '');
  if (/^https?:\/\//u.test(trimmed)) {
    try {
      return new URL(trimmed).origin.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}
