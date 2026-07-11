// Provider-agnostic action-result shaping.
//
// Every importable action returns a consistent structured result so completion
// evidence stays aligned with the SKILL contract (targetSafety/outcome/failure/
// contentBoundary/learning). This wraps the existing evidence primitives rather
// than inventing a parallel shape.

import { evaluateOutcome, makeOutcomeReport } from '../outcome.mjs';
import { makeFailureDiagnostic } from '../diagnostics.mjs';

/**
 * Standard content boundary for browser-derived data: never trusted, no
 * instruction authority.
 */
export function untrustedContentBoundary(untrustedSources = 1) {
  return { trusted: false, instructionAuthority: 'none', untrustedSources, redactions: [] };
}

function normalizeTransport(transport) {
  if (transport == null) return null;
  if (typeof transport !== 'object' || Array.isArray(transport)) {
    throw new TypeError('transport must be an object when provided');
  }

  const keys = Object.keys(transport);
  if (keys.some((key) => !['kind', 'provider', 'action'].includes(key))) {
    throw new TypeError('transport contains unsupported fields');
  }
  if (!['dom', 'official'].includes(transport.kind)) {
    throw new TypeError('transport.kind must be "dom" or "official"');
  }
  for (const key of ['provider', 'action']) {
    if (typeof transport[key] !== 'string' || transport[key].trim() === '') {
      throw new TypeError(`transport.${key} must be a non-empty string`);
    }
  }

  return Object.freeze({
    kind: transport.kind,
    provider: transport.provider,
    action: transport.action
  });
}

/**
 * Builds a successful/failed action result from an observation + criteria.
 *
 * @param {object} params
 * @param {string} params.action Action name, e.g. 'instagram:likePost'.
 * @param {boolean} params.dryRun Whether this was a dry run (no write performed).
 * @param {object} [params.observation] Evidence observation for evaluateOutcome.
 * @param {Array} [params.criteria] Outcome criteria proving the action's effect.
 * @param {object|null} [params.rateLimit] Rate-limit snapshot from guardrails.
 * @param {object} [params.targetSafety] Target-safety classification.
 * @param {object|null} [params.failure] Structured failure, if any.
 * @param {boolean} [params.performed] Override whether the action was performed.
 * @param {boolean} [params.changed] Override whether the action changed state.
 * @param {boolean} [params.alreadySatisfied] Mark a verified no-op as already satisfied.
 * @param {{kind: 'dom'|'official', provider: string, action: string}} [params.transport] Sanitized transport evidence.
 * @returns {object} Structured action result.
 */
export function makeActionResult({
  action,
  dryRun = false,
  observation = {},
  criteria = [],
  rateLimit = null,
  targetSafety,
  failure = null,
  performed: performedOverride,
  changed: changedOverride,
  alreadySatisfied: alreadySatisfiedOverride,
  transport
} = {}) {
  if (typeof action !== 'string' || action.trim() === '') {
    throw new TypeError('action must be a non-empty string');
  }
  if (typeof dryRun !== 'boolean') {
    throw new TypeError('dryRun must be a boolean');
  }
  const outcome = evaluateOutcome(observation, criteria);
  const eligibleForPerformed = !dryRun && outcome.passed && !failure;
  const alreadySatisfied = alreadySatisfiedOverride === true;

  for (const [name, value] of [
    ['performed', performedOverride],
    ['changed', changedOverride],
    ['alreadySatisfied', alreadySatisfiedOverride]
  ]) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new TypeError(`${name} override must be a boolean`);
    }
  }

  if (alreadySatisfied && (dryRun || failure || !outcome.passed || performedOverride === true || changedOverride === true)) {
    throw new TypeError('alreadySatisfied requires a passed, non-dry-run, failure-free no-op');
  }
  if (performedOverride === true && !eligibleForPerformed) {
    throw new TypeError('performed cannot be true for an ineligible action result');
  }

  const performed = alreadySatisfied
    ? false
    : performedOverride === undefined
      ? eligibleForPerformed
      : performedOverride;
  if (changedOverride === true && !performed) {
    throw new TypeError('changed cannot be true when performed is false');
  }
  const changed = alreadySatisfied
    ? false
    : changedOverride === undefined
      ? performed
      : changedOverride;
  const normalizedTransport = normalizeTransport(transport);
  const report = makeOutcomeReport({
    targetSafety,
    outcome,
    failure,
    contentBoundary: untrustedContentBoundary(0),
    learning: { enabled: false }
  });
  return {
    action,
    ok: outcome.passed && !failure,
    dryRun,
    performed,
    changed,
    alreadySatisfied,
    rateLimit,
    ...(normalizedTransport ? { transport: normalizedTransport } : {}),
    ...report
  };
}

/**
 * Builds a blocked/guarded result for a write that never ran (dry run, failed
 * gate, rate limit, missing confirmation). No browser action was attempted.
 *
 * @param {string} action Action name.
 * @param {string} reason Human-readable block reason.
 * @param {object} [opts]
 * @returns {object} Structured blocked result.
 */
export function makeBlockedResult(action, reason, opts = {}) {
  const failure = makeFailureDiagnostic({
    stage: opts.stage || 'guardrail',
    layer: opts.layer || 'action-guardrail',
    attempted: opts.attempted || ['guardrail evaluation'],
    blockers: [reason],
    remainingChecks: opts.remainingChecks || [],
    requiresUserDecision: opts.requiresUserDecision === true
  });
  return {
    action,
    ok: false,
    dryRun: opts.dryRun === true,
    performed: false,
    changed: false,
    alreadySatisfied: false,
    blocked: true,
    reason,
    rateLimit: opts.rateLimit || null,
    ...(opts.transport ? { transport: normalizeTransport(opts.transport) } : {}),
    ...makeOutcomeReport({
      targetSafety: opts.targetSafety,
      outcome: { passed: false, criteria: [] },
      failure,
      contentBoundary: untrustedContentBoundary(0),
      learning: { enabled: false }
    })
  };
}

/**
 * Wraps a browser-derived STRUCTURED read payload (e.g. Post[]) in an untrusted
 * marker envelope while preserving its structure, so downstream code (analyze)
 * still gets typed data but the payload carries no instruction authority (P4).
 * Free-text fields inside should additionally be passed through
 * `markUntrustedBrowserContent` where they are extracted.
 *
 * @param {{ url?: string, content?: unknown, kind?: string }} params
 */
export function wrapReadPayload({ url, content, kind } = {}) {
  return {
    trusted: false,
    instructionAuthority: 'none',
    source: { url: url ?? null, kind: kind || 'instagram-read' },
    content
  };
}
