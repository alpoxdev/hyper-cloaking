/**
 * Setup role: validate parent-authorized paths and client options, run the CLI
 * validation/configuration commands, then return a schema-compatible envelope.
 * It does not install software or broaden sandbox permissions; command stdout
 * must be one JSON line and generated config is independently checked.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli as defaultRunCli } from '../cli.mjs';
import { readSingleJson, verifyAgentEnvelope } from './parent-verify.mjs';

const CLIENTS = new Set(['direct', 'codex', 'json', 'claude-code', 'gajae-code', 'openclaw', 'hermes', 'hermes-agent']);

/** Provide isolated in-memory stdout/stderr capture for injected CLI calls. */
export function makeMemoryIo() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: { write(value) { stdout += String(value); } },
    stderr: { write(value) { stderr += String(value); } },
    read() { return { stdout, stderr }; }
  };
}

/**
 * Produce a setup envelope. Input, CLI, and generated-config failures remain
 * structured and non-retryable at this role boundary.
 * @param {object} input schemaVersion-1 setup request.
 * @param {object} [dependencies] injectable CLI and IO factories.
 * @returns {Promise<object>} setup agent envelope.
 */
export async function runSetup(input, { runCli = defaultRunCli, makeIo = makeMemoryIo } = {}) {
  const inputError = validateInput(input);
  if (inputError) return failedEnvelope('setup-input-invalid', 'setup-input', inputError, 'blocked');

  const validation = await invokeJson(runCli, ['validate', '--json'], makeIo);
  if (!validation.ok || validation.value?.ok !== true) {
    return setupEnvelope({
      status: 'blocked',
      setupStatus: 'blocked',
      failure: failure('setup-validation-failed', 'setup-validate', validation.error || firstBlocker(validation.value) || 'validation failed'),
      blockers: [{ code: 'permission', message: validation.error || firstBlocker(validation.value) || 'validation failed', recoverable: true }]
    });
  }

  const argv = ['mcp-config', '--client', input.client, '--home', input.workspace, input.headless ? '--headless' : '--headed', '--json'];
  const generated = await invokeJson(runCli, argv, makeIo);
  if (!generated.value) return failedEnvelope('setup-config-invalid-json', 'setup-config', generated.error, 'failed');
  if (generated.value?.ok !== true) {
    const message = firstBlocker(generated.value) || 'MCP configuration is unavailable';
    return setupEnvelope({
      status: 'blocked',
      setupStatus: generated.value?.executablePath ? 'blocked' : 'needs_install',
      failure: failure('missing-binary', 'setup-config', message),
      executablePath: generated.value?.executablePath || null,
      blockers: [{ code: 'missing-binary', message, recoverable: true }]
    });
  }

  const mismatch = verifyGeneratedConfig(generated.value, input);
  if (mismatch) return failedEnvelope('setup-config-mismatch', 'setup-config-verify', mismatch, 'failed');
  return setupEnvelope({
    status: 'succeeded',
    setupStatus: 'ready',
    failure: null,
    mcpConfig: { type: input.client, config: generated.value.config },
    executablePath: generated.value.executablePath,
    blockers: []
  });
}

/** Enforce the closed setup input contract before invoking the CLI. */
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  const expected = ['client', 'headless', 'sandbox', 'schemaVersion', 'workspace'];
  if (Object.keys(input).some((key) => !expected.includes(key))) return 'input contains unknown fields';
  if (input.schemaVersion !== 1) return 'schemaVersion must be 1';
  if (!CLIENTS.has(input.client)) return 'unsupported client';
  if (typeof input.headless !== 'boolean') return 'headless must be boolean';
  if (input.sandbox !== true) return 'sandbox must be true';
  if (typeof input.workspace !== 'string' || !path.isAbsolute(input.workspace)) return 'workspace must be an authorized absolute path';
  return null;
}

/** Invoke a CLI and accept only a single JSON line on stdout. */
async function invokeJson(runCli, argv, makeIo) {
  const io = makeIo();
  let exitCode;
  try { exitCode = await runCli(argv, io); } catch (error) { return { ok: false, error: message(error) }; }
  const captured = io.read();
  const trimmed = captured.stdout.trim();
  if (!trimmed) return { ok: false, error: captured.stderr.trim() || 'CLI returned no JSON' };
  if (trimmed.split(/\r?\n/).length !== 1) return { ok: false, error: 'CLI returned extra stdout' };
  try { return { ok: exitCode === 0, exitCode, value: JSON.parse(trimmed), error: exitCode === 0 ? null : captured.stderr.trim() || null }; }
  catch { return { ok: false, error: 'CLI returned malformed JSON' }; }
}

/** Confirm generated config preserves client, workspace, sandbox, and headless intent. */
function verifyGeneratedConfig(value, input) {
  if (value.client !== input.client) return 'generated client does not match input';
  if (path.resolve(value.home || '') !== path.resolve(input.workspace)) return 'generated workspace does not match input';
  if (!value.executablePath || !path.isAbsolute(value.executablePath)) return 'generated executable path is invalid';
  const strings = collectStrings(value.config);
  const sandboxCount = countOption(value.config, '--sandbox');
  if (sandboxCount !== 1) return 'generated config must contain exactly one --sandbox';
  if (countOption(value.config, '--no-sandbox') > 0) return 'generated config contains --no-sandbox';
  const headlessCount = countOption(value.config, '--headless');
  if (headlessCount !== (input.headless ? 1 : 0)) return 'generated headless mode contradicts input';
  if (!strings.some((item) => item.includes('@playwright/mcp'))) return 'generated config is missing Playwright MCP package';
  if (!strings.includes(value.executablePath) && !strings.some((item) => item.includes(value.executablePath))) return 'generated config is missing executable path';
  return null;
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    const quoted = value.match(/"(?:[^"\\]|\\.)*"|[^\s,[\]]+/g) || [];
    for (const token of quoted) out.push(token.replace(/^"|"$/g, ''));
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function countOption(value, option) {
  if (typeof value === 'string') {
    if (value === option) return 1;
    if (!/[\s,[\]"]/.test(value)) return 0;
    const tokens = value.match(/"(?:[^"\\]|\\.)*"|[^\s,[\]]+/g) || [];
    return tokens.filter((token) => token.replace(/^"|"$/g, '') === option).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countOption(item, option), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((count, item) => count + countOption(item, option), 0);
  }
  return 0;
}

function firstBlocker(value) {
  return Array.isArray(value?.blockers) ? value.blockers[0] : value?.error;
}

function failure(code, phase, observedSignal) {
  return { code, phase, retryable: false, observedSignal: String(observedSignal) };
}

/** Construct the canonical setup result shape consumed by parent dispatch. */
function setupEnvelope({ status, setupStatus, failure: failureValue, mcpConfig = null, executablePath = null, blockers = [] }) {
  return {
    schemaVersion: 1,
    agent: 'setup',
    status,
    executionMode: 'parent',
    failure: failureValue,
    result: { agentType: 'setup', setupStatus, mcpConfig, executablePath, blockers }
  };
}

function failedEnvelope(code, phase, observedSignal, status = 'failed') {
  return setupEnvelope({
    status,
    setupStatus: 'blocked',
    failure: failure(code, phase, observedSignal),
    blockers: [{ code: 'permission', message: String(observedSignal), recoverable: false }]
  });
}

function message(error) { return error instanceof Error ? error.message : String(error); }

export async function runSetupCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  if (argv.length !== 2 || argv[0] !== '--input-stdin' || argv[1] !== '--json') {
    stderr.write('Usage: setup-agent --input-stdin --json\n');
    return 2;
  }
  try {
    const result = await runSetup(await readSingleJson(io.stdin || process.stdin));
    const verified = verifyAgentEnvelope(result);
    stdout.write(`${JSON.stringify(verified.ok ? result : verified)}\n`);
    return verified.ok && result.status === 'succeeded' ? 0 : 1;
  } catch (error) {
    stderr.write(`${message(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runSetupCli();
