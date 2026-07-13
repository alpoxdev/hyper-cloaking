/**
 * @module guardrail-bridge
 *
 * Guardrail bridge for provider writes.
 *
 * The ENGINE write actions already own the atomic guardrail sequence
 * (resolveWriteGate -> reserveGuardedAction -> dispatch -> finalizeGuardedAction,
 * plus resolveConfirmationGate / enforceBulkCap / checkAndRecordAction). Re-reserving
 * here would double-count rate + idempotency claims and BREAK atomicity, so this
 * bridge does NOT reserve. It is the single dispatch path that (1) maps tool params
 * to engine opts with dryRun defaulting TRUE and MCP-non-interactive semantics, and
 * (2) classifies the engine result envelope into a typed MCP signal.
 */
import crypto from 'node:crypto';
import { DEFAULT_BULK_CAP } from '../engine/action-runtime/guardrails.mjs';

/**
 * Stable sha256 hex of a string (matches the engine hashing shape for guarded keys).
 *
 * @param {string} value Value to hash.
 * @returns {string} 64-char hex digest.
 */
export function hashHex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Maps tool params to engine write opts. dryRun defaults TRUE; the server is
 * non-interactive so a bulk `confirmed` alone cannot satisfy the confirmation gate.
 *
 * @param {{ dryRun?: boolean, runId?: string, confirmed?: boolean, cap?: number, opts?: object }} input Tool input.
 * @returns {object} Engine action opts.
 */
export function buildWriteOpts(input = {}) {
  return {
    ...(input.opts ?? {}),
    dryRun: input.dryRun !== false,
    cap: Number.isInteger(input.cap) ? Math.min(input.cap, DEFAULT_BULK_CAP) : DEFAULT_BULK_CAP,
    ...(input.runId != null ? { runId: input.runId } : {}),
    ...(input.confirmed != null ? { confirmed: input.confirmed } : {})
  };
}

/**
 * Classifies an engine action-result envelope into a typed MCP write signal.
 *
 * @param {object} result Engine makeActionResult/makeBlockedResult envelope.
 * @returns {{ status: string, code?: string }} Typed classification.
 */
export function classifyWriteResult(result) {
  if (result?.blocked) {
    const stage = result.failure?.stage;
    switch (stage) {
      case 'dry-run':
        return { status: 'dry-run' };
      case 'confirmation-gate':
        return { status: 'needs-confirmation', code: 'confirmation-gate' };
      case 'rate-limit':
        return { status: 'rate-limited', code: 'rate-limit' };
      case 'bulk-cap':
        return { status: 'refused', code: 'bulk-cap' };
      default:
        return { status: 'blocked', code: stage || 'guardrail' };
    }
  }
  if (result?.ok) {
    if (result.alreadySatisfied) return { status: 'already-verified' };
    return { status: 'ok' };
  }
  // Not ok and not a clean block: the engine could not prove the postcondition.
  return { status: 'ambiguous', code: 'unverified' };
}
