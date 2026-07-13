/**
 * Diagnostics role: inspect only parent-selected relative artifacts beneath a
 * non-symlink state directory, redact log text, hash screenshots, and summarize
 * the last verified role failure. It never follows escaped paths or publishes
 * artifacts itself.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFailureDiagnostic } from '../diagnostics.mjs';
import { redactEvidenceText } from '../evidence-boundary.mjs';
import { readSingleJson, verifyAgentEnvelope } from './parent-verify.mjs';

const MAX_DIAGNOSTIC_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Build a diagnostics envelope from a verified setup/browser output and bounded
 * artifact observations.
 * @param {object} input schemaVersion-1 diagnostics request.
 * @param {object} [dependencies] injectable file reader for tests/callers.
 * @returns {Promise<object>} diagnostics envelope with JSON and markdown reports.
 */
export async function runDiagnostics(input, { readFile = fsp.readFile } = {}) {
  const invalid = validateInput(input);
  if (invalid)
    return diagnosticsEnvelope('failed', 'unknown', invalid, null, 'stop', { error: invalid });

  let stateRoot;
  try {
    stateRoot = await secureRealDirectory(input.stateDir);
  } catch (error) {
    const signal = `invalid stateDir: ${message(error)}`;
    return diagnosticsEnvelope('failed', 'unknown', signal, null, 'stop', { error: signal });
  }

  const observations = [];
  const requested = [
    ...input.logPaths.map((relativePath) => ({ relativePath, kind: 'log' })),
    ...input.screenshotPaths.map((relativePath) => ({ relativePath, kind: 'screenshot' }))
  ];
  for (const { relativePath, kind } of requested) {
    const file = path.resolve(stateRoot, relativePath);
    if (!isInside(stateRoot, file))
      return diagnosticsEnvelope(
        'failed',
        'unknown',
        'diagnostic path escaped stateDir',
        null,
        'stop',
        { path: relativePath }
      );
    try {
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
      if (stat.size > MAX_DIAGNOSTIC_FILE_BYTES)
        throw new Error(`file exceeds ${MAX_DIAGNOSTIC_FILE_BYTES} byte diagnostic limit`);
      const realFile = await fsp.realpath(file);
      if (!isInside(stateRoot, realFile)) throw new Error('realpath escaped stateDir');
      if (kind === 'screenshot') {
        const bytes = await readFile(realFile);
        observations.push({
          path: relativePath,
          kind,
          size: stat.size,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex')
        });
      } else {
        const content = await readFile(realFile, 'utf8');
        observations.push({ path: relativePath, kind, content: redactEvidenceText(content).text });
      }
    } catch (error) {
      observations.push({ path: relativePath, kind, error: message(error) });
    }
  }
  const failure = input.lastAgentOutput.failure;
  const layer = classifyLayer(failure?.code, failure?.phase);
  const observedSignal = failure?.observedSignal || 'No explicit failure signal was supplied.';
  const nextAuthorizedStep = chooseNextStep(layer, failure?.retryable);
  const reportJson = {
    layer,
    observedSignal,
    lastSafeAction: lastSafeAction(input.lastAgentOutput),
    nextAuthorizedStep,
    observations,
    diagnostic: makeFailureDiagnostic({
      stage: failure?.phase || 'diagnostics',
      layer,
      attempted: [],
      blockers: failure ? [observedSignal] : [],
      remainingChecks: [],
      evidenceRefs: observations.map((item) => item.path),
      requiresUserDecision: nextAuthorizedStep !== 'retry_setup'
    })
  };
  const markdown = renderMarkdown(reportJson);
  return diagnosticsEnvelope(
    'succeeded',
    layer,
    observedSignal,
    reportJson.lastSafeAction,
    nextAuthorizedStep,
    reportJson,
    markdown
  );
}

/** Enforce verified prior output, relative artifact paths, and an absolute state root. */
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  const allowed = new Set([
    'schemaVersion',
    'lastAgentOutput',
    'logPaths',
    'screenshotPaths',
    'stateDir'
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return 'input contains unknown fields';
  if (input.schemaVersion !== 1) return 'schemaVersion must be 1';
  if (
    !input.lastAgentOutput ||
    !['setup', 'browser-task'].includes(input.lastAgentOutput.agent) ||
    !verifyAgentEnvelope(input.lastAgentOutput).ok
  )
    return 'lastAgentOutput must be a complete verified setup or browser-task envelope';
  if (!Array.isArray(input.logPaths) || !Array.isArray(input.screenshotPaths))
    return 'logPaths and screenshotPaths must be arrays';
  for (const relativePath of [...input.logPaths, ...input.screenshotPaths])
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`)
    )
      return 'diagnostic paths must be relative';
  if (!path.isAbsolute(input.stateDir || ''))
    return 'stateDir must be an absolute parent-authorized path';
  return null;
}

/** Map failure signals to the diagnostic layer used for the next-step policy. */
function classifyLayer(code = '', phase = '') {
  const value = `${code} ${phase}`.toLowerCase();
  if (/setup|binary|node|npm|config/.test(value)) return 'setup';
  if (/network|timeout|dns|connection/.test(value)) return 'network';
  if (/origin|target|safety|redirect/.test(value)) return 'target_safety';
  if (/waf|challenge|captcha/.test(value)) return 'waf_challenge';
  if (/outcome|humanization|cleanup|evidence/.test(value)) return 'outcome';
  return 'unknown';
}
/** Choose an authorized next action; unknown failures stop rather than retry. */
function chooseNextStep(layer, retryable) {
  if (layer === 'setup' && retryable === true) return 'retry_setup';
  if (layer === 'target_safety') return 'clarify_scope';
  if (layer === 'network' || layer === 'waf_challenge' || layer === 'outcome')
    return 'manual_review';
  return 'stop';
}
/** Derive the last action known safe from the prior role's verified result. */
function lastSafeAction(envelope) {
  if (envelope.agent === 'browser-task')
    return envelope.result?.finalUrl
      ? `Observed ${envelope.result.finalUrl}`
      : 'Stopped before verified navigation';
  if (envelope.agent === 'setup')
    return envelope.result?.setupStatus === 'ready'
      ? 'Validated setup configuration'
      : 'Stopped before setup became ready';
  return null;
}
/** Construct the report-bearing diagnostics result and structured failure, if any. */
function diagnosticsEnvelope(
  status,
  layer,
  observedSignal,
  lastSafeActionValue,
  nextAuthorizedStep,
  reportJson,
  markdown = null
) {
  const result = {
    agentType: 'diagnostics',
    layer,
    observedSignal: String(observedSignal),
    lastSafeAction: lastSafeActionValue,
    nextAuthorizedStep,
    report: {
      json: reportJson,
      markdown: markdown || `# Diagnostics\n\n${String(observedSignal)}\n`
    }
  };
  return {
    schemaVersion: 1,
    agent: 'diagnostics',
    status,
    executionMode: 'parent',
    failure:
      status === 'succeeded'
        ? null
        : {
            code: 'diagnostics-input-invalid',
            phase: 'diagnostics-input',
            retryable: false,
            observedSignal: String(observedSignal)
          },
    result
  };
}
function renderMarkdown(report) {
  return `# Hyper Cloaking Diagnostics\n\n- Layer: ${report.layer}\n- Signal: ${report.observedSignal}\n- Last safe action: ${report.lastSafeAction || 'none'}\n- Next authorized step: ${report.nextAuthorizedStep}\n`;
}
function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
async function secureRealDirectory(directory) {
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('stateDir must be a non-symlink directory');
  return fsp.realpath(directory);
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runDiagnosticsCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  if (argv.length !== 2 || argv[0] !== '--input-stdin' || argv[1] !== '--json') {
    stderr.write('Usage: diagnostics-agent --input-stdin --json\n');
    return 2;
  }
  try {
    const envelope = await runDiagnostics(await readSingleJson(io.stdin || process.stdin));
    const verified = verifyAgentEnvelope(envelope);
    stdout.write(`${JSON.stringify(verified.ok ? envelope : verified)}\n`);
    return verified.ok && envelope.status === 'succeeded' ? 0 : 1;
  } catch (error) {
    stderr.write(`${message(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runDiagnosticsCli();
