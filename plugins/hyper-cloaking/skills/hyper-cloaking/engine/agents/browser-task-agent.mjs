/**
 * Browser verification role. Navigation is delegated to the live verifier under
 * parent-staged publication rules; this adapter normalizes safety, telemetry,
 * cleanup, and evidence references into one immutable protocol envelope.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveVerification as defaultRunLiveVerification } from '../cli.mjs';
import { normalizeAllowedOrigins } from './lib/allowed-origin-guard.mjs';
import { readSingleJson, verifyAgentEnvelope } from './parent-verify.mjs';

/**
 * Run a verification-only browser task.
 * No evidence is publishable until cleanup is positively verified and every
 * reference remains inside the parent-authorized staging root.
 * @param {object} input schemaVersion-1 browser task request.
 * @param {object} [dependencies] injectable live-verification runner.
 * @returns {Promise<object>} succeeded or blocked browser-task envelope.
 */
export async function runBrowserTask(input, { runLiveVerification = defaultRunLiveVerification } = {}) {
  const error = validateInput(input);
  if (error) return blockedEnvelope(input, 'browser-input-invalid', 'browser-input', error, emptyCleanup());
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);
  let live;
  try {
    live = await runLiveVerification({
      target: input.targetUrl,
      'public-target': input.targetUrl,
      allowedOrigins,
      headless: input.headless,
      home: input.workspace,
      provider: input.provider || undefined,
      'cookie-site': input.cookieSite || undefined,
      account: input.account || undefined,
      maxRedirects: input.maxRedirects,
      publicationMode: 'parent-staged',
      agentStagingRoot: input.agentStagingRoot
    });
  } catch (caught) {
    return blockedEnvelope(input, 'live-verification-failed', 'browser-live', message(caught), emptyCleanup());
  }

  const cleanup = normalizeCleanup(live.cleanup);
  const cleanupVerified = cleanup.ok && cleanup.closed && !cleanup.timedOut;
  const humanization = normalizeHumanization(live.humanization);
  const liveSucceeded = live.ok === true && cleanupVerified && humanization.telemetryAvailable;
  const code = !cleanupVerified ? 'browser-cleanup-unverified' : !humanization.telemetryAvailable ? 'humanization-proof-unavailable' : 'live-verification-blocked';
  const observedSignal = live.blockers?.join('; ') || live.error || code;
  const result = {
    agentType: 'browser-task',
    taskMode: 'verification-only',
    targetSafety: mapTargetSafety(live.navigationTargetSafety || live.targetSafety),
    outcome: liveSucceeded ? 'verified' : live.publicNavigation?.finalUrl ? 'not_observed' : 'blocked',
    finalUrl: live.finalUrl || live.publicNavigation?.finalUrl || null,
    contentBoundary: {
      allowedOrigins: [...allowedOrigins],
      observedOrigin: safeOrigin(live.finalUrl || live.publicNavigation?.finalUrl),
      redirects: (live.publicNavigation?.documentUrls || []).filter((url) => url !== 'about:blank'),
      violations: [...(live.publicNavigation?.violations || [])]
    },
    humanizationProof: humanization,
    cleanup,
    evidenceRefs: normalizeEvidenceRefs(live.evidenceRefs, input.agentStagingRoot),
    learning: {
      summary: liveSucceeded ? 'Live verification completed with observed evidence.' : 'Live verification stopped at a verified safety or evidence boundary.',
      limitations: [...(live.blockers || []), ...(humanization.blocker ? [humanization.blocker] : []), ...(!cleanupVerified && cleanup.blocker ? [cleanup.blocker] : [])]
    }
  };
  return {
    schemaVersion: 1,
    agent: 'browser-task',
    status: liveSucceeded ? 'succeeded' : 'blocked',
    executionMode: 'parent',
    failure: liveSucceeded ? null : { code, phase: 'browser-live', retryable: false, observedSignal },
    result
  };
}

/** Reject unknown fields, unsafe URLs/paths, invalid origins, and redirect limits. */
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  const allowed = new Set(['schemaVersion', 'taskMode', 'targetUrl', 'allowedOrigins', 'headless', 'workspace', 'provider', 'cookieSite', 'account', 'agentStagingRoot', 'maxRedirects']);
  if (Object.keys(input).some((key) => !allowed.has(key))) return 'input contains unknown fields';
  if (input.schemaVersion !== 1 || input.taskMode !== 'verification-only') return 'invalid protocol or task mode';
  try { const url = new URL(input.targetUrl); if (!['http:', 'https:'].includes(url.protocol)) return 'targetUrl must use http or https'; } catch { return 'targetUrl must be an absolute URL'; }
  try { normalizeAllowedOrigins(input.allowedOrigins); } catch (error) { return message(error); }
  if (typeof input.headless !== 'boolean') return 'headless must be boolean';
  if (!path.isAbsolute(input.workspace || '') || !path.isAbsolute(input.agentStagingRoot || '')) return 'workspace and agentStagingRoot must be absolute parent-authorized paths';
  if (!Number.isInteger(input.maxRedirects) || input.maxRedirects < 0 || input.maxRedirects > 5) return 'maxRedirects must be 0..5';
  for (const key of ['provider', 'cookieSite', 'account']) if (input[key] !== null && input[key] !== undefined && typeof input[key] !== 'string') return `${key} must be a string or null`;
  return null;
}

/** Normalize lifecycle state; callers treat any missing positive flag as unsafe. */
function normalizeCleanup(value) {
  return { ok: value?.ok === true, closed: value?.closed === true, timedOut: value?.timedOut === true, blocker: value?.blocker || null };
}
function emptyCleanup() { return { ok: false, closed: false, timedOut: false, blocker: 'browser lifecycle did not start' }; }
function normalizeHumanization(value) {
  const telemetryAvailable = value?.ok === true && value?.evidence;
  return { enabled: value?.configured === true, telemetryAvailable: Boolean(telemetryAvailable), source: value?.evidence || null, blocker: value?.blocker || (telemetryAvailable ? null : 'runtime humanization telemetry unavailable') };
}
function mapTargetSafety(value) {
  if (value?.disposition === 'ok') return 'allowed';
  if (value?.disposition === 'approvalRequired' || value?.disposition === 'needs_clarification') return 'needs_clarification';
  return 'refused';
}
function safeOrigin(value) { try { return value ? new URL(value).origin : null; } catch { return null; } }
/** Convert verifier references to root-relative, typed evidence references. */
function normalizeEvidenceRefs(refs, root) {
  if (!Array.isArray(refs)) return [];
  return refs.map((ref) => {
    const absolute = ref.path || ref.relPath;
    const relPath = path.isAbsolute(absolute || '') ? path.relative(root, absolute) : absolute;
    if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) throw new Error('live evidence escaped agent staging root');
    const extension = path.extname(relPath).toLowerCase();
    return { type: extension === '.png' || extension === '.jpg' || extension === '.jpeg' ? 'screenshot' : 'log', relPath, description: ref.kind || ref.description || 'live verification evidence' };
  });
}
/** Return a safe blocked result with no final URL or evidence references. */
function blockedEnvelope(input, code, phase, observedSignal, cleanup) {
  return {
    schemaVersion: 1, agent: 'browser-task', status: 'blocked', executionMode: 'parent',
    failure: { code, phase, retryable: false, observedSignal: String(observedSignal) },
    result: {
      agentType: 'browser-task', taskMode: 'verification-only', targetSafety: 'refused', outcome: 'blocked', finalUrl: null,
      contentBoundary: { allowedOrigins: Array.isArray(input?.allowedOrigins) ? input.allowedOrigins : [], observedOrigin: null, redirects: [], violations: [String(observedSignal)] },
      humanizationProof: { enabled: false, telemetryAvailable: false, source: null, blocker: 'verification did not complete' },
      cleanup, evidenceRefs: [], learning: { summary: 'Verification was blocked before completion.', limitations: [String(observedSignal)] }
    }
  };
}
function message(error) { return error instanceof Error ? error.message : String(error); }

export async function runBrowserTaskCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  if (argv.length !== 2 || argv[0] !== '--input-stdin' || argv[1] !== '--json') { stderr.write('Usage: browser-task-agent --input-stdin --json\n'); return 2; }
  try {
    const envelope = await runBrowserTask(await readSingleJson(io.stdin || process.stdin));
    const verified = verifyAgentEnvelope(envelope);
    stdout.write(`${JSON.stringify(verified.ok ? envelope : verified)}\n`);
    return verified.ok && envelope.status === 'succeeded' ? 0 : 1;
  } catch (error) { stderr.write(`${message(error)}\n`); return 2; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runBrowserTaskCli();
