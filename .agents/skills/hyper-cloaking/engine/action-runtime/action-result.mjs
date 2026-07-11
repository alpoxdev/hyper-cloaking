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
  alreadySatisfied: alreadySatisfiedOverride
} = {}) {
  const outcome = evaluateOutcome(observation, criteria);
  const eligibleForPerformed = !dryRun && outcome.passed && !failure;
  const performed = performedOverride === undefined
    ? eligibleForPerformed
    : performedOverride === true && eligibleForPerformed;
  const changed = changedOverride === undefined
    ? performed
    : changedOverride === true && performed;
  const alreadySatisfied = alreadySatisfiedOverride === true;
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
