#!/usr/bin/env node
/**
 * @module bench
 *
 * Browser- and network-free benchmark harness for MCP public seams.
 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateAllServerRegistrations } from './register.mjs';
import { mapErrorToSignal, defineTool } from './src/error-signal.mjs';
import { createSessionManager } from './src/session-manager.mjs';
import { takeAriaSnapshot, resolveTarget } from './src/snapshot-resolver.mjs';
import { buildProviderCapabilities, makeProviderReadTool } from './src/tools/providers.mjs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Stable browser-free benchmark scenario identifiers.
 *
 * @type {string[]}
 */
export const SCENARIOS = [
  'registry-list',
  'schema-error',
  'fifo-queue',
  'snapshot-target',
  'provider-capability-read',
  'stdio-handshake'
];

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceServer = path.join(here, 'src', 'server.mjs');
const bundleServer = path.join(here, 'dist', 'server.mjs');
const packageLock = path.join(here, '..', 'package-lock.json');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
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
    const git = (args) =>
      runGit('git', args, { cwd: path.join(here, '..'), maxBuffer: 1024 * 1024 });
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

async function registryList() {
  const registrations = generateAllServerRegistrations({
    command: process.execPath,
    args: [sourceServer]
  });
  assert(Object.keys(registrations).length === 8, 'registry must contain eight targets');
  const serialized = JSON.stringify(registrations);
  assert(serialized.includes('hyper-cloaking-mcp'), 'serialized registry missing server id');
  return { targetCount: Object.keys(registrations).length, bytes: serialized.length };
}

async function schemaError() {
  const tool = defineTool({
    name: 'bench',
    description: 'bench',
    inputSchema: {
      type: 'object',
      required: ['value'],
      properties: { value: { type: 'string' } },
      additionalProperties: false
    },
    handler: () => ({ status: 'ok' })
  });
  const invalid = await tool.handler({ value: 4 });
  const signal = mapErrorToSignal(new Error('authorization: bearer-secret token=hidden'));
  assert(
    invalid.isError === false && JSON.parse(invalid.content[0].text).status === 'invalid-args',
    'schema mapping failed'
  );
  assert(
    signal.status === 'error' && signal.message.includes('[redacted]'),
    'error redaction failed'
  );
  return { invalidStatus: JSON.parse(invalid.content[0].text).status, signalCode: signal.code };
}

async function fifoQueue() {
  const manager = createSessionManager({ idleTimeoutMs: 0, maxQueueDepth: 8 });
  await manager.launch(async () => ({ page: {}, account: 'bench' }));
  const startOrder = [];
  const finishOrder = [];
  let active = 0;
  let maxActive = 0;
  const tasks = [1, 2, 3];
  const runTask = async (value) =>
    manager.withSession(async () => {
      startOrder.push(value);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      finishOrder.push(value);
      active -= 1;
      return { status: 'ok' };
    });
  await Promise.all(tasks.map(runTask));
  assert(startOrder.join(',') === '1,2,3', 'FIFO start ordering failed');
  assert(finishOrder.join(',') === '1,2,3', 'FIFO finish ordering failed');
  assert(maxActive === 1, 'FIFO concurrency bound failed');
  await manager.teardown({ force: true });
  return { order: startOrder, startOrder, finishOrder, active, maxActive, concurrency: 1 };
}

async function snapshotTarget() {
  const fullSnapshot = 'button [ref=e1]\nlink [ref=e2]';
  const locator = { ariaSnapshot: async () => fullSnapshot };
  const page = { locator: (selector) => (selector === 'body' ? locator : { selector }) };
  const snapshot = await takeAriaSnapshot(page, { maxChars: 12 });
  assert(snapshot.truncated, 'snapshot should be marked truncated');
  assert(snapshot.totalChars === fullSnapshot.length, 'snapshot totalChars metadata is incorrect');
  assert(
    snapshot.snapshot.startsWith(fullSnapshot.slice(0, 12)),
    'snapshot does not preserve the semantic prefix'
  );
  assert(snapshot.snapshot.includes('[truncated'), 'snapshot is missing truncation metadata');
  assert(resolveTarget(page, { ref: 'e1' }).selector === 'aria-ref=e1', 'ref resolution failed');
  assert(resolveTarget(page, { selector: 'main' }) === 'main', 'selector resolution failed');
  return {
    truncated: snapshot.truncated,
    totalChars: snapshot.totalChars,
    maxChars: 12,
    prefix: fullSnapshot.slice(0, 12)
  };
}

async function providerCapabilityRead() {
  const catalog = buildProviderCapabilities();
  assert(catalog.status === 'ok' && catalog.providers.length === 6, 'provider catalog failed');
  const manager = createSessionManager({ idleTimeoutMs: 0 });
  const tool = makeProviderReadTool(manager);
  const result = await tool.handler({ provider: 'youtube', action: 'likeVideo' });
  const payload = JSON.parse(result.content[0].text);
  assert(
    payload.status === 'refused' && payload.code === 'unsupported-read-action',
    'write was not refused'
  );
  return { providers: catalog.providers.length, refusedCode: payload.code };
}

async function handshake(serverPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: here
  });
  const client = new Client({ name: 'benchmark', version: '1.0.0' });
  await client.connect(transport);
  try {
    const serverVersion = client.getServerVersion();
    assert(serverVersion?.name === 'hyper-cloaking-mcp', 'invalid handshake response');
    assert(client.getServerCapabilities()?.tools, 'handshake did not advertise tools');
    return { server: serverVersion.name, version: serverVersion.version };
  } finally {
    await client.close();
  }
}
async function stdioHandshake() {
  const paths = [sourceServer];
  try {
    const { access } = await import('node:fs/promises');
    await access(bundleServer);
    paths.push(bundleServer);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const responses = [];
  for (const serverPath of paths) responses.push(await handshake(serverPath));
  return { servers: responses };
}

const IMPLEMENTATIONS = {
  'registry-list': registryList,
  'schema-error': schemaError,
  'fifo-queue': fifoQueue,
  'snapshot-target': snapshotTarget,
  'provider-capability-read': providerCapabilityRead,
  'stdio-handshake': stdioHandshake
};

/**
 * Runs correctness checks, warmups, and timed samples for selected scenarios.
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
    const run = IMPLEMENTATIONS[name];
    for (let i = 0; i < warmup; i++) await run();
    const rawSamples = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await run();
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
