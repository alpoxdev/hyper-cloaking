#!/usr/bin/env node
/**
 * @module bench
 *
 * Browser- and network-free benchmark harness for legacy compatibility seams.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generateAllServerRegistrations } from './register.mjs';

/**
 * Stable browser-free compatibility benchmark scenario identifiers.
 *
 * @type {string[]}
 */
export const SCENARIOS = [
  'registration-render',
  'canonical-engine-validate',
  'legacy-server-handshake'
];

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..');
const legacyServer = path.join(here, 'dist', 'server.mjs');
const packageLock = path.join(repositoryRoot, 'package-lock.json');
const canonicalEngineCli = fileURLToPath(import.meta.resolve('@mcp/engine/cli'));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function readLockDigest() {
  try {
    const lock = await readFile(packageLock);
    return `sha256:${createHash('sha256').update(lock).digest('hex')}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Resolve repository identity without changing repository state. A caller may
 * provide a revision identity when running outside a checkout.
 *
 * @param {object} options Benchmark options.
 * @returns {Promise<object>} Revision, ref, and dirty-state identity.
 */
async function readRepositoryIdentity(options) {
  if (options.repositoryRevision) {
    return {
      revision: String(options.repositoryRevision),
      ref: options.repositoryRef == null ? null : String(options.repositoryRef),
      dirty: options.repositoryDirty == null ? null : Boolean(options.repositoryDirty),
      source: 'caller'
    };
  }
  const runGit = promisify(execFile);
  try {
    const git = (args) => runGit('git', args, { cwd: repositoryRoot, maxBuffer: 1024 * 1024 });
    const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const ref = (await git(['symbolic-ref', '--short', '-q', 'HEAD'])).stdout.trim() || null;
    const status = (await git(['status', '--porcelain'])).stdout;
    return { revision, ref, dirty: status.length > 0, source: 'git' };
  } catch (error) {
    return {
      revision: null,
      ref: null,
      dirty: null,
      source: 'unavailable',
      unavailableReason: error.code || error.message
    };
  }
}

async function registrationRender() {
  const registrations = generateAllServerRegistrations({
    command: process.execPath,
    args: [legacyServer]
  });
  assert(
    Object.keys(registrations).length === 8,
    'registration catalog must contain eight targets'
  );
  const serialized = JSON.stringify(registrations);
  assert(serialized.includes('hyper-cloaking-mcp'), 'serialized registration missing server id');
  return { targetCount: Object.keys(registrations).length, bytes: serialized.length };
}

async function canonicalEngineValidate() {
  const result = await run(process.execPath, [canonicalEngineCli, 'validate', '--json'], {
    cwd: here
  });
  assert(
    result.signal === null && result.code === 0,
    `canonical engine validation failed: ${result.stderr}`
  );
  const payload = JSON.parse(result.stdout);
  assert(payload.ok === true, 'canonical engine validation did not report success');
  return { ok: payload.ok };
}

async function legacyServerHandshake() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [legacyServer],
    cwd: here
  });
  const client = new Client({ name: 'compatibility-benchmark', version: '1.0.0' });
  await client.connect(transport);
  try {
    const serverVersion = client.getServerVersion();
    assert(
      serverVersion?.name === 'hyper-cloaking-mcp',
      'invalid legacy server handshake response'
    );
    assert(
      client.getServerCapabilities()?.tools,
      'legacy server handshake did not advertise tools'
    );
    return { server: serverVersion.name, version: serverVersion.version };
  } finally {
    await client.close();
  }
}

const IMPLEMENTATIONS = {
  'registration-render': registrationRender,
  'canonical-engine-validate': canonicalEngineValidate,
  'legacy-server-handshake': legacyServerHandshake
};

/**
 * Runs compatibility correctness checks, warmups, and timed samples for selected scenarios.
 *
 * @param {{ samples?: number, warmup?: number, scenarios?: string|string[], repositoryRevision?: string, repositoryRef?: string, repositoryDirty?: boolean }} [options] Benchmark options.
 * @returns {Promise<object>} Machine-scoped benchmark report with raw samples and statistics.
 */
export async function runBenchmark(options = {}) {
  const samples = Math.max(1, Number(options.samples ?? 20));
  const warmup = Math.max(0, Number(options.warmup ?? 3));
  const selected = options.scenarios
    ? (Array.isArray(options.scenarios) ? options.scenarios : String(options.scenarios).split(','))
        .map((name) => String(name).trim())
        .filter(Boolean)
    : [...SCENARIOS];
  for (const name of selected) assert(SCENARIOS.includes(name), `unknown scenario: ${name}`);
  const correctness = {};
  for (const name of selected) correctness[name] = await IMPLEMENTATIONS[name]();
  const results = {};
  for (const name of selected) {
    const runScenario = IMPLEMENTATIONS[name];
    for (let i = 0; i < warmup; i++) await runScenario();
    const rawSamples = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await runScenario();
      rawSamples.push(performance.now() - start);
    }
    const sorted = [...rawSamples].sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const statistics = {
      minMs: sorted[0],
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: sorted.at(-1)
    };
    results[name] = {
      samples: rawSamples.length,
      rawSamples,
      statistics,
      ...statistics,
      correctness: correctness[name]
    };
  }
  const lockDigest = await readLockDigest();
  const repository = await readRepositoryIdentity(options);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    environment: {
      os: process.platform,
      osVersion: os.release() || null,
      cpu: os.cpus()[0]?.model || null,
      cpuCount: os.cpus().length || null,
      lockDigest,
      repository
    },
    samples,
    warmup,
    scenarios: selected,
    results
  };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--artifact') options.artifact = argv[++i];
    else if (arg === '--scenario' || arg === '--scenarios') options.scenarios = argv[++i];
    else if (arg === '--samples') options.samples = Number(argv[++i]);
    else if (arg === '--warmup') options.warmup = Number(argv[++i]);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runBenchmark(options)
    .then(async (report) => {
      const output = JSON.stringify(report, null, 2);
      if (options.artifact) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(options.artifact, `${output}\n`);
      }
      process.stdout.write(`${output}\n`);
    })
    .catch((error) => {
      process.stderr.write(`benchmark failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
