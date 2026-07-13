#!/usr/bin/env node
/**
 * Parent orchestration boundary: validates a request, dispatches exactly one
 * role, verifies its schema envelope, and optionally publishes parent-owned
 * evidence. Role failures are returned as data; unexpected runner throws are
 * converted to non-retryable contract failures.
 */
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSetup } from './setup-agent.mjs';
import { runBrowserTask } from './browser-task-agent.mjs';
import { runDiagnostics } from './diagnostics-agent.mjs';
import { persistEvidence } from './evidence-writer.mjs';
import { readSingleJson, verifyAgentEnvelope } from './parent-verify.mjs';

/**
 * Dispatch a parent request through the selected role or verified native adapter.
 * The returned object is a CLI-safe response envelope with `exitCode`, while
 * `envelope` is present only after schema and agent/trigger checks pass.
 *
 * @param {object} request schemaVersion-1 request; evidence publication is
 *   enabled only when the parent supplies an absolute home and publication config.
 * @param {object} [dependencies] injectable runners, verifier, publisher, or
 *   subagent adapter; injections do not relax validation or cleanup checks.
 * @returns {Promise<object>} response whose failure explains the rejected boundary.
 */
export async function dispatchParent(request, dependencies = {}) {
  const invalid = validateRequest(request);
  if (invalid) return failureResponse('contract_failure', 'contract-input-invalid', invalid);
  const runners = {
    setup: dependencies.runSetup || runSetup,
    'browser-task': dependencies.runBrowserTask || runBrowserTask,
    diagnostics: dependencies.runDiagnostics || runDiagnostics
  };
  const verify = dependencies.verifyAgentEnvelope || verifyAgentEnvelope;
  const publish = dependencies.persistEvidence || persistEvidence;

  let envelope;
  const route = 'parent_default';
  if (request.executionMode === 'subagent') {
    if (!dependencies.nativeAdapter?.spawn) return failureResponse('native_unavailable', 'native_unavailable', 'No verified native adapter is available.');
    try {
      envelope = await dependencies.nativeAdapter.spawn(request.trigger, request.input);
    } catch (error) {
      return failureResponse('spawn_failed', 'spawn_failed', message(error));
    }
  } else {
    try {
      envelope = await runners[request.trigger](request.input, dependencies.roleDependencies?.[request.trigger] || {});
    } catch (error) {
      return failureResponse('contract_failure', 'role-threw', message(error));
    }
  }

  const verification = verify(envelope);
  if (!verification.ok) return failureResponse('contract_failure', verification.verifierCode || 'contract_failure', verification.failure?.observedSignal || 'role output failed verification');
  if (envelope.agent !== request.trigger) {
    return response('contract_failure', 'failed', 1, envelope, null, {
      code: 'agent-trigger-mismatch',
      observedSignal: `requested ${request.trigger} but received ${envelope.agent}`
    });
  }
  if (isRoleInputFailure(envelope.failure)) {
    return response('contract_failure', envelope.status, 1, envelope, null, envelope.failure);
  }

  let evidenceReceipt = null;
  if (request.evidence.enabled) {
    if (envelope.agent === 'browser-task' && !cleanupVerified(envelope.result.cleanup)) {
      return response(route, envelope.status, 1, envelope, null, envelope.failure);
    }
    try {
      evidenceReceipt = await publish({
        ...request.evidence.publication,
        homeDir: request.evidence.homeDir,
        cleanup: envelope.agent === 'browser-task' ? envelope.result.cleanup : null,
        evidenceRefs: envelope.agent === 'browser-task' ? envelope.result.evidenceRefs : [],
        diagnosticReport: envelope.agent === 'diagnostics' ? envelope.result.report.json : null,
        failure: envelope.failure
      });
    } catch (error) {
      return failureResponse('contract_failure', 'evidence-publication-failed', message(error));
    }
  }
  return response(route, envelope.status, envelope.status === 'succeeded' ? 0 : 1, envelope, evidenceReceipt, envelope.failure);
}

/** Validate the closed request shape before any runner or side effect executes. */
function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'request must be an object';
  const allowed = new Set(['schemaVersion', 'trigger', 'executionMode', 'input', 'evidence']);
  if (Object.keys(request).some((key) => !allowed.has(key))) return 'request contains unknown fields';
  if (request.schemaVersion !== 1) return 'schemaVersion must be 1';
  if (!['setup', 'browser-task', 'diagnostics'].includes(request.trigger)) return 'unknown trigger';
  if (!['parent', 'subagent'].includes(request.executionMode)) return 'invalid executionMode';
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) return 'input must be an object';
  if (!request.evidence || typeof request.evidence.enabled !== 'boolean') return 'evidence config is required';
  const evidenceKeys = new Set(['enabled', 'homeDir', 'publication']);
  if (Object.keys(request.evidence).some((key) => !evidenceKeys.has(key))) return 'evidence config contains unknown fields';
  if (request.evidence.enabled && (!path.isAbsolute(request.evidence.homeDir || '') || !request.evidence.publication || typeof request.evidence.publication !== 'object')) return 'enabled evidence requires parent-authorized homeDir and publication roots';
  return null;
}

/** Browser cleanup must be positively closed, successful, and non-timeout before publication. */
function cleanupVerified(value) { return value?.ok === true && value?.closed === true && value?.timedOut === false; }
function isRoleInputFailure(failure) {
  return ['setup-input-invalid', 'browser-input-invalid', 'diagnostics-input-invalid'].includes(failure?.code);
}
/** Build the stable parent response; `failure` is null only for a clean result. */
function response(route, status, exitCode, envelope, evidenceReceipt, failure = null) {
  return { schemaVersion: 1, route, status, exitCode, envelope, evidenceReceipt, failure };
}
/** Represent failures that occurred before a role envelope could be verified. */
function failureResponse(route, code, observedSignal) {
  return response(route, 'failed', 1, null, null, { code, observedSignal: String(observedSignal) });
}
function message(error) { return error instanceof Error ? error.message : String(error); }

export async function runParentDispatcherCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  if (argv.length !== 2 || argv[0] !== '--input-stdin' || argv[1] !== '--json') { stderr.write('Usage: parent-dispatcher --input-stdin --json\n'); return 2; }
  try {
    const result = await dispatchParent(await readSingleJson(io.stdin || process.stdin));
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.exitCode;
  } catch (error) { stderr.write(`${message(error)}\n`); return 2; }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMainModule()) {
  process.exitCode = await runParentDispatcherCli();
}
