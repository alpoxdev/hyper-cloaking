import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 1;
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HISTORICAL_V1_CANONICAL_ENGINE_ROOT =
  'plugins/hyper-cloaking/skills/hyper-cloaking/engine';
export const CANONICAL_ENGINE_ROOT = HISTORICAL_V1_CANONICAL_ENGINE_ROOT;
export const LEGACY_ENGINE_ROOTS = Object.freeze([
  CANONICAL_ENGINE_ROOT,
  '.agents/skills/hyper-cloaking/engine',
  '.claude/skills/hyper-cloaking/engine',
  'skills/hyper-cloaking/engine'
]);
export const HISTORICAL_V1_FIXTURE_ROOT = 'mcp/test/fixtures';
export const FIXTURE_ROOT = HISTORICAL_V1_FIXTURE_ROOT;
export const MANIFEST_FILENAME = 'engine-relocation-manifest.v1.json';
export const PREIMAGES_FILENAME = 'engine-relocation-preimages.v1.json';
export const ADMISSION_DIRECTORY = 'engine-relocation-preimage-admission';
export const POSITIVE_ADMISSION_FILENAME = 'positive.v1.json';
export const NEGATIVE_ADMISSION_FILENAMES = Object.freeze([
  'reject-cookie-runtime-payload.v1.json',
  'reject-credential-profile-payload.v1.json',
  'reject-undeclared-secret-source.v1.json',
  'reject-altered-cli-preimage.v1.json',
  'reject-altered-cookie-preimage.v1.json'
]);

export const EXCEPTION_PATHS = Object.freeze([
  'agents/lib/sync-mirror.mjs',
  'agents/parent-dispatcher.mjs',
  'browser-utils.mjs',
  'cli.mjs',
  'cookie.mjs',
  'package.json'
]);

const OWNED_CANONICAL_MANIFEST = Object.freeze([
  'SKILL.ko.md',
  'SKILL.md',
  'references/runtime-workspace.ko.md',
  'references/runtime-workspace.md',
  'rules/agents/browser-task-agent.ko.md',
  'rules/agents/browser-task-agent.md',
  'rules/agents/diagnostics-agent.ko.md',
  'rules/agents/diagnostics-agent.md',
  'rules/agents/setup-agent.ko.md',
  'rules/agents/setup-agent.md',
  'rules/hyper-cloaking-workflow.ko.md',
  'rules/hyper-cloaking-workflow.md'
]);

const HASHBANG_PATHS = new Set(['agents/parent-dispatcher.mjs', 'cli.mjs']);
const RETIRED_ENGINE_PACKAGE = 'hyper-cloaking-engine';
const HISTORICAL_V1_DESTINATION_ROOT = 'mcp/engine';

export const OUTER_PACKAGE_POLICY = Object.freeze({
  main: './dist/server.mjs',
  files: Object.freeze(['dist', 'engine', 'register.mjs']),
  bin: Object.freeze({
    'hyper-cloaking-mcp': './dist/server.mjs',
    'hyper-cloaking-engine': './engine/cli.mjs',
    'hyper-cloaking-browser-utils': './engine/browser-utils.mjs',
    'hyper-cloaking-cookie': './engine/cookie.mjs',
    'hyper-cloaking-parent-dispatcher': './engine/agents/parent-dispatcher.mjs'
  }),
  exports: Object.freeze({
    '.': './dist/server.mjs',
    './package.json': './package.json',
    './register': './register.mjs',
    './engine/browser-utils.mjs': './engine/browser-utils.mjs',
    './engine/cli.mjs': './engine/cli.mjs',
    './engine/config.mjs': './engine/config.mjs',
    './engine/cookie.mjs': './engine/cookie.mjs',
    './engine/credentials.mjs': './engine/credentials.mjs',
    './engine/target-safety.mjs': './engine/target-safety.mjs',
    './engine/outcome.mjs': './engine/outcome.mjs',
    './engine/diagnostics.mjs': './engine/diagnostics.mjs',
    './engine/evidence-boundary.mjs': './engine/evidence-boundary.mjs',
    './engine/recon-scope.mjs': './engine/recon-scope.mjs',
    './engine/run-shapes.mjs': './engine/run-shapes.mjs',
    './engine/action-runtime/action-result.mjs': './engine/action-runtime/action-result.mjs',
    './engine/action-runtime/guardrails.mjs': './engine/action-runtime/guardrails.mjs',
    './engine/providers/index.mjs': './engine/providers/index.mjs',
    './engine/providers/instagram/index.mjs': './engine/providers/instagram/index.mjs',
    './engine/providers/naver/index.mjs': './engine/providers/naver/index.mjs',
    './engine/providers/youtube/index.mjs': './engine/providers/youtube/index.mjs',
    './engine/providers/coupang/index.mjs': './engine/providers/coupang/index.mjs',
    './engine/providers/tiktok/index.mjs': './engine/providers/tiktok/index.mjs',
    './engine/providers/x/index.mjs': './engine/providers/x/index.mjs',
    './engine/agents/parent-dispatcher.mjs': './engine/agents/parent-dispatcher.mjs',
    './engine/agents/parent-verify.mjs': './engine/agents/parent-verify.mjs'
  }),
  dependencies: Object.freeze({
    ajv: '^8.20.0',
    cloakbrowser: '^0.4.10',
    'playwright-core': '^1.61.1'
  })
});

const EXCEPTION_DETAILS = Object.freeze({
  'package.json': Object.freeze({
    exceptionKind: 'absorbed-outer-package-manifest',
    permittedTransforms: Object.freeze(['absorb-outer-package-manifest'])
  }),
  'agents/lib/sync-mirror.mjs': Object.freeze({
    exceptionKind: 'sync-mirror-owned-manifest',
    permittedTransforms: Object.freeze(['replace-owned-canonical-manifest'])
  }),
  'cli.mjs': Object.freeze({
    exceptionKind: 'realpath-main-guard',
    permittedTransforms: Object.freeze([
      'add-node-hashbang',
      'replace-main-check-with-realpath-guard'
    ])
  }),
  'browser-utils.mjs': Object.freeze({
    exceptionKind: 'realpath-main-guard',
    permittedTransforms: Object.freeze(['replace-main-check-with-realpath-guard'])
  }),
  'cookie.mjs': Object.freeze({
    exceptionKind: 'realpath-main-guard',
    permittedTransforms: Object.freeze(['replace-main-check-with-realpath-guard'])
  }),
  'agents/parent-dispatcher.mjs': Object.freeze({
    exceptionKind: 'realpath-main-guard',
    permittedTransforms: Object.freeze([
      'add-node-hashbang',
      'replace-main-check-with-realpath-guard'
    ])
  })
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\'))
    throw new Error(`${label} must be a non-empty POSIX relative path`);
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`${label} must be normalized and relative`);
  }
  return normalized;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function assertSortedUnique(records, field, label) {
  let previous = null;
  for (const record of records) {
    const value = record[field];
    if (typeof value !== 'string') throw new Error(`${label} ${field} must be a string`);
    if (previous !== null && previous >= value)
      throw new Error(`${label} must be strictly sorted by ${field}`);
    previous = value;
  }
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
}

function assertMode(value, label) {
  if (typeof value !== 'string' || !/^0[0-7]{3}$/.test(value))
    throw new Error(`${label} must be a four-digit octal mode`);
}

function decodeBase64(value, label) {
  if (
    typeof value !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error(`${label} must be canonical base64`);
  return bytes;
}

function exceptionFor(relativePath) {
  return EXCEPTION_DETAILS[relativePath] || null;
}

function ownedManifestSource() {
  return `export const OWNED_CANONICAL_MANIFEST = Object.freeze([\n${OWNED_CANONICAL_MANIFEST.map((item) => `  '${item}',`).join('\n')}\n].sort());`;
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0)
    throw new Error(`${label} did not match exactly once`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function addRealpathImport(source, relativePath) {
  const anchors = {
    'cli.mjs': "import fs from 'node:fs/promises';",
    'browser-utils.mjs': "import fs from 'node:fs/promises';",
    'cookie.mjs': "import fs from 'node:fs/promises';",
    'agents/parent-dispatcher.mjs': "import path from 'node:path';"
  };
  const anchor = anchors[relativePath];
  if (!anchor) throw new Error(`no import anchor for ${relativePath}`);
  return replaceExactlyOnce(
    source,
    anchor,
    `${anchor}\nimport { realpathSync } from 'node:fs';`,
    `${relativePath} realpath import`
  );
}

function mainGuardSource() {
  return [
    'function isMainModule() {',
    '  if (!process.argv[1]) return false;',
    '  try {',
    '    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));',
    '  } catch {',
    '    return false;',
    '  }',
    '}'
  ].join('\n');
}

function replaceMainCheck(source, relativePath) {
  const guard = mainGuardSource();
  const rawChecks = {
    'cli.mjs': [
      'if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {',
      '  process.exitCode = await runCli();',
      '}'
    ].join('\n'),
    'browser-utils.mjs': [
      'const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);',
      'if (isMain) {'
    ].join('\n'),
    'cookie.mjs': [
      'const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);',
      'if (isMain) {'
    ].join('\n'),
    'agents/parent-dispatcher.mjs':
      'if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runParentDispatcherCli();'
  };
  const raw = rawChecks[relativePath];
  if (!raw) throw new Error(`no main check for ${relativePath}`);
  if (relativePath === 'cli.mjs') {
    return replaceExactlyOnce(
      source,
      raw,
      `${guard}\nif (isMainModule()) {\n  process.exitCode = await runCli();\n}`,
      `${relativePath} main check`
    );
  }
  if (relativePath === 'agents/parent-dispatcher.mjs') {
    return replaceExactlyOnce(
      source,
      raw,
      `${guard}\nif (isMainModule()) {\n  process.exitCode = await runParentDispatcherCli();\n}`,
      `${relativePath} main check`
    );
  }
  return replaceExactlyOnce(
    source,
    raw,
    `${guard}\nif (isMainModule()) {`,
    `${relativePath} main check`
  );
}

/**
 * Replays one declared exception from its admitted baseline bytes.
 * @param {object} entry Valid relocation-manifest entry.
 * @param {Buffer} preimage Exact admitted source bytes.
 * @returns {Buffer|null} Expected relocated bytes, or null for package absorption.
 */
export function replayEntry(entry, preimage) {
  if (!entry || typeof entry !== 'object') throw new Error('entry is required');
  if (!Buffer.isBuffer(preimage))
    throw new Error(`preimage for ${entry.source || 'entry'} must be a Buffer`);
  if (sha256(preimage) !== entry.preSha256)
    throw new Error(`preimage hash does not match ${entry.source}`);

  const relativePath = relativeFromSource(entry.source);
  if (entry.exceptionKind === 'absorbed-outer-package-manifest') return null;
  if (entry.exceptionKind === 'sync-mirror-owned-manifest') {
    const source = preimage.toString('utf8');
    const rawManifest =
      /export const OWNED_CANONICAL_MANIFEST = Object\.freeze\(\[\n[\s\S]*?\n\]\.sort\(\)\);/;
    const match = source.match(rawManifest);
    if (!match || match.length !== 1)
      throw new Error(`${relativePath} owned manifest did not match exactly once`);
    const transformed = replaceExactlyOnce(
      source,
      match[0],
      ownedManifestSource(),
      `${relativePath} owned manifest`
    );
    return Buffer.from(transformed, 'utf8');
  }
  if (entry.exceptionKind === 'realpath-main-guard') {
    let transformed = preimage.toString('utf8');
    transformed = addRealpathImport(transformed, relativePath);
    transformed = replaceMainCheck(transformed, relativePath);
    if (HASHBANG_PATHS.has(relativePath)) {
      if (transformed.startsWith('#!'))
        throw new Error(`${relativePath} unexpectedly already has a hashbang`);
      transformed = `#!/usr/bin/env node\n${transformed}`;
    }
    return Buffer.from(transformed, 'utf8');
  }
  throw new Error(`cannot replay non-exception ${entry.source}`);
}

function relativeFromSource(source) {
  const normalized = normalizedRelative(source, 'entry source');
  const prefix = `${CANONICAL_ENGINE_ROOT}/`;
  if (!normalized.startsWith(prefix))
    throw new Error(`entry source is outside canonical engine: ${source}`);
  return normalized.slice(prefix.length);
}

function relativeFromDestination(destination) {
  const normalized = normalizedRelative(destination, 'entry destination');
  const prefix = `${HISTORICAL_V1_DESTINATION_ROOT}/`;
  if (!normalized.startsWith(prefix))
    throw new Error(`entry destination is outside relocated engine: ${destination}`);
  return normalized.slice(prefix.length);
}

/** Validates the strict sorted relocation ledger schema and policy. */
export function validateManifest(manifest) {
  exactKeys(manifest, ['version', 'entries'], 'manifest');
  if (manifest.version !== SCHEMA_VERSION) throw new Error('manifest version is invalid');
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0)
    throw new Error('manifest entries must be a non-empty array');
  assertSortedUnique(manifest.entries, 'source', 'manifest entries');

  const exceptionPaths = [];
  for (const entry of manifest.entries) {
    const keys =
      entry.preimageRef === undefined
        ? [
            'source',
            'destination',
            'type',
            'mode',
            'preSha256',
            'postSha256',
            'exceptionKind',
            'permittedTransforms'
          ]
        : [
            'source',
            'destination',
            'type',
            'mode',
            'preSha256',
            'postSha256',
            'exceptionKind',
            'permittedTransforms',
            'preimageRef'
          ];
    exactKeys(entry, keys, `manifest entry ${entry.source || '<unknown>'}`);
    const relativePath = relativeFromSource(entry.source);
    if (entry.type !== 'file')
      throw new Error(`manifest entry ${entry.source} must be a regular file`);
    assertMode(entry.mode, `manifest entry ${entry.source} mode`);
    assertHash(entry.preSha256, `manifest entry ${entry.source} preSha256`);
    if (entry.destination !== null) {
      if (relativeFromDestination(entry.destination) !== relativePath)
        throw new Error(`manifest destination does not preserve ${entry.source}`);
      assertHash(entry.postSha256, `manifest entry ${entry.source} postSha256`);
    } else if (entry.postSha256 !== null) {
      throw new Error(`absorbed entry ${entry.source} must not have a postSha256`);
    }
    if (
      !Array.isArray(entry.permittedTransforms) ||
      entry.permittedTransforms.some((item) => typeof item !== 'string')
    ) {
      throw new Error(`manifest entry ${entry.source} permittedTransforms is invalid`);
    }

    const expectedException = exceptionFor(relativePath);
    if (!expectedException) {
      if (
        entry.exceptionKind !== null ||
        entry.preimageRef !== undefined ||
        entry.permittedTransforms.length !== 0
      ) {
        throw new Error(`ordinary entry ${entry.source} has exception metadata`);
      }
      if (entry.destination === null || entry.postSha256 !== entry.preSha256)
        throw new Error(`ordinary entry ${entry.source} must be byte-identical`);
      continue;
    }

    exceptionPaths.push(relativePath);
    if (
      entry.exceptionKind !== expectedException.exceptionKind ||
      !sameValue(entry.permittedTransforms, expectedException.permittedTransforms)
    ) {
      throw new Error(`exception metadata is invalid for ${entry.source}`);
    }
    if (entry.preimageRef !== relativePath)
      throw new Error(`exception preimageRef is invalid for ${entry.source}`);
    if (relativePath === 'package.json') {
      if (entry.destination !== null || entry.postSha256 !== null)
        throw new Error('absorbed package.json must not have a destination');
    } else if (entry.destination === null || !entry.postSha256) {
      throw new Error(`exception ${entry.source} must have a destination posthash`);
    }
  }
  if (!sameValue(exceptionPaths, EXCEPTION_PATHS))
    throw new Error('manifest exception paths do not match the closed policy');
  return manifest;
}

function validatePreimageRecord(record, label) {
  exactKeys(record, ['path', 'type', 'mode', 'sha256', 'bytesBase64'], label);
  normalizedRelative(record.path, `${label} path`);
  if (record.type !== 'file') throw new Error(`${label} must be a regular file`);
  assertMode(record.mode, `${label} mode`);
  assertHash(record.sha256, `${label} sha256`);
  const bytes = decodeBase64(record.bytesBase64, `${label} bytesBase64`);
  if (sha256(bytes) !== record.sha256) throw new Error(`${label} bytes do not match sha256`);
  return bytes;
}

/**
 * Validates path-plus-hash-plus-mode preimage admission. This intentionally does
 * not inspect source text; only the six baseline manifest records are admissible.
 */
export function validatePreimageAdmission(records, manifest) {
  validateManifest(manifest);
  if (!Array.isArray(records)) throw new Error('preimage admission records must be an array');
  assertSortedUnique(records, 'path', 'preimage records');
  const entriesByPath = new Map(
    manifest.entries
      .filter((entry) => entry.preimageRef !== undefined)
      .map((entry) => [entry.preimageRef, entry])
  );

  for (const record of records) {
    const bytes = validatePreimageRecord(record, `preimage ${record.path || '<unknown>'}`);
    const entry = entriesByPath.get(record.path);
    if (!entry) throw new Error(`preimage path is not admitted: ${record.path}`);
    if (
      record.type !== entry.type ||
      record.mode !== entry.mode ||
      record.sha256 !== entry.preSha256
    ) {
      throw new Error(`preimage path/hash/mode is not admitted: ${record.path}`);
    }
    if (sha256(bytes) !== entry.preSha256)
      throw new Error(`preimage bytes are not admitted: ${record.path}`);
  }
  if (records.length !== EXCEPTION_PATHS.length)
    throw new Error('preimage admission requires exactly six records');
  if (
    !sameValue(
      records.map((record) => record.path),
      EXCEPTION_PATHS
    )
  )
    throw new Error('preimage admission set is incomplete');
  return records;
}

/** Validates the strict bounded preimage-bundle schema. */
export function validatePreimageBundle(preimages, manifest) {
  exactKeys(preimages, ['version', 'records'], 'preimage bundle');
  if (preimages.version !== SCHEMA_VERSION || !Array.isArray(preimages.records))
    throw new Error('preimage bundle version or records is invalid');
  return validatePreimageAdmission(preimages.records, manifest);
}

/** Validates references proving that all six baseline preimages are admitted. */
export function validatePositiveAdmission(positive, preimages, manifest) {
  exactKeys(positive, ['version', 'records'], 'positive admission fixture');
  if (
    positive.version !== SCHEMA_VERSION ||
    !Array.isArray(positive.records) ||
    positive.records.length !== EXCEPTION_PATHS.length
  ) {
    throw new Error('positive admission fixture is invalid');
  }
  assertSortedUnique(positive.records, 'path', 'positive admission records');
  const preimagesByPath = new Map(preimages.records.map((record) => [record.path, record]));
  for (const record of positive.records) {
    exactKeys(
      record,
      ['preimageRef', 'path', 'type', 'mode', 'sha256', 'bytesSha256'],
      `positive admission ${record.path || '<unknown>'}`
    );
    if (record.preimageRef !== record.path)
      throw new Error(`positive admission preimageRef is invalid: ${record.path}`);
    normalizedRelative(record.path, `positive admission ${record.path || '<unknown>'} path`);
    if (record.type !== 'file')
      throw new Error(`positive admission ${record.path} must be a regular file`);
    assertMode(record.mode, `positive admission ${record.path} mode`);
    assertHash(record.sha256, `positive admission ${record.path} sha256`);
    assertHash(record.bytesSha256, `positive admission ${record.path} bytesSha256`);
    const preimage = preimagesByPath.get(record.preimageRef);
    if (
      !preimage ||
      record.type !== preimage.type ||
      record.mode !== preimage.mode ||
      record.sha256 !== preimage.sha256
    ) {
      throw new Error(`positive admission does not reference an exact preimage: ${record.path}`);
    }
    if (
      record.bytesSha256 !==
      sha256(decodeBase64(preimage.bytesBase64, `preimage ${record.path} bytesBase64`))
    ) {
      throw new Error(`positive admission bytes hash is invalid: ${record.path}`);
    }
  }
  if (
    !sameValue(
      positive.records.map((record) => record.path),
      EXCEPTION_PATHS
    )
  )
    throw new Error('positive admission set is incomplete');
  return validatePreimageBundle(preimages, manifest);
}

function retiredV1LiveOperation(operation) {
  throw new Error(
    `v1 ${operation} is retired after the v2 migration; use scripts/engine-relocation-v2.mjs for live topology operations`
  );
}

/**
 * Historical compatibility export. v1 source-tree parity is no longer a valid
 * live-topology check because those source trees were removed during migration.
 */
export async function assertFourWayParity() {
  retiredV1LiveOperation('source-tree parity');
}

/**
 * Historical compatibility export. Committed v1 fixtures are immutable replay
 * evidence and must not be regenerated from a live tree.
 */
export async function buildRelocationFixtureBundle() {
  retiredV1LiveOperation('fixture generation');
}

/** Historical compatibility export that fails closed instead of writing fixtures. */
export async function generateRelocationFixtures() {
  retiredV1LiveOperation('fixture generation');
}

async function readJson(filePath, label) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} is unreadable: ${filePath}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${filePath}`, { cause: error });
  }
}

/** Reads and schema-validates the committed fixture bundle without touching legacy source trees. */
export async function readRelocationFixtures({
  fixtureRoot = path.join(REPOSITORY_ROOT, FIXTURE_ROOT)
} = {}) {
  const resolvedFixtureRoot = assertHistoricalFixtureRoot(fixtureRoot);
  const manifest = await readJson(
    path.join(resolvedFixtureRoot, MANIFEST_FILENAME),
    'relocation manifest'
  );
  const preimages = await readJson(
    path.join(resolvedFixtureRoot, PREIMAGES_FILENAME),
    'relocation preimage bundle'
  );
  const positive = await readJson(
    path.join(resolvedFixtureRoot, ADMISSION_DIRECTORY, POSITIVE_ADMISSION_FILENAME),
    'positive admission fixture'
  );
  const negatives = {};
  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    negatives[filename] = await readJson(
      path.join(resolvedFixtureRoot, ADMISSION_DIRECTORY, filename),
      `negative admission fixture ${filename}`
    );
  }
  validateManifest(manifest);
  validatePreimageBundle(preimages, manifest);
  validatePositiveAdmission(positive, preimages, manifest);
  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    try {
      validatePreimageAdmission(negatives[filename].records, manifest);
    } catch {
      continue;
    }
    throw new Error(`negative admission fixture was admitted: ${filename}`);
  }
  return { manifest, preimages, positive, negatives };
}

function assertExactPolicyValue(actual, expected, label) {
  if (!sameValue(actual, expected))
    throw new Error(`${label} does not match the relocation outer-package contract`);
}

function assertNoRetiredDependency(manifest, label) {
  if (manifest?.name === RETIRED_ENGINE_PACKAGE)
    throw new Error(`${label} retains the retired engine package identity`);
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
  ]) {
    if (
      manifest?.[field] &&
      Object.prototype.hasOwnProperty.call(manifest[field], RETIRED_ENGINE_PACKAGE)
    ) {
      throw new Error(`${label} retains ${RETIRED_ENGINE_PACKAGE} in ${field}`);
    }
  }
  const workspaces = manifest?.workspaces;
  const workspaceValues = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  if (Array.isArray(workspaceValues) && workspaceValues.includes(RETIRED_ENGINE_PACKAGE)) {
    throw new Error(`${label} retains the retired engine workspace identity`);
  }
}

/** Validates the absorbed package preimage against the literal outer MCP package policy. */
export function assertOuterPackagePolicy(packageManifest) {
  if (!packageManifest || typeof packageManifest !== 'object' || Array.isArray(packageManifest))
    throw new Error('outer package manifest must be an object');
  assertNoRetiredDependency(packageManifest, 'outer package manifest');
  assertExactPolicyValue(packageManifest.main, OUTER_PACKAGE_POLICY.main, 'outer package main');
  assertExactPolicyValue(packageManifest.files, OUTER_PACKAGE_POLICY.files, 'outer package files');
  assertExactPolicyValue(packageManifest.bin, OUTER_PACKAGE_POLICY.bin, 'outer package bin');
  assertExactPolicyValue(
    packageManifest.exports,
    OUTER_PACKAGE_POLICY.exports,
    'outer package exports'
  );
  assertExactPolicyValue(
    packageManifest.dependencies,
    OUTER_PACKAGE_POLICY.dependencies,
    'outer package dependencies'
  );
  return packageManifest;
}

function replayExceptions(manifest, preimages) {
  const preimagesByPath = new Map(preimages.records.map((record) => [record.path, record]));
  for (const entry of manifest.entries) {
    if (entry.preimageRef === undefined) continue;
    const record = preimagesByPath.get(entry.preimageRef);
    if (!record) throw new Error(`missing preimage for ${entry.source}`);
    const output = replayEntry(
      entry,
      decodeBase64(record.bytesBase64, `preimage ${record.path} bytesBase64`)
    );
    if (output === null) {
      if (entry.destination !== null || entry.postSha256 !== null)
        throw new Error(`absorbed exception has a destination: ${entry.source}`);
    } else if (sha256(output) !== entry.postSha256) {
      throw new Error(`replayed posthash does not match manifest: ${entry.source}`);
    }
  }
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function assertHistoricalFixtureRoot(fixtureRoot) {
  if (typeof fixtureRoot !== 'string' || fixtureRoot.length === 0)
    throw new Error('historical v1 fixtureRoot must be a non-empty path');
  const resolvedFixtureRoot = path.resolve(fixtureRoot);
  const liveAdapterRoot = path.resolve(REPOSITORY_ROOT, HISTORICAL_V1_DESTINATION_ROOT);
  if (
    isWithin(liveAdapterRoot, resolvedFixtureRoot) ||
    (path.basename(resolvedFixtureRoot) === 'engine' &&
      path.basename(path.dirname(resolvedFixtureRoot)) === 'mcp')
  ) {
    throw new Error(
      `historical v1 verification cannot target the live adapter tree: ${HISTORICAL_V1_DESTINATION_ROOT}`
    );
  }
  return resolvedFixtureRoot;
}

/**
 * Replays only committed v1 fixture evidence. It never reads a live engine
 * tree, which keeps v1 auditable without making it a topology authority.
 */
export async function verifyHistoricalRelocation({
  fixtureRoot = path.join(REPOSITORY_ROOT, HISTORICAL_V1_FIXTURE_ROOT)
} = {}) {
  const fixtures = await readRelocationFixtures({
    fixtureRoot: assertHistoricalFixtureRoot(fixtureRoot)
  });
  replayExceptions(fixtures.manifest, fixtures.preimages);
  return {
    exceptions: fixtures.manifest.entries.filter((entry) => entry.preimageRef !== undefined).length
  };
}

/**
 * @deprecated Historical replay compatibility export. It accepts only a v1
 * fixtureRoot and deliberately rejects all live topology options.
 */
export async function verifyRelocation(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('historical v1 verification options must be an object');
  const unsupported = Object.keys(options).filter((key) => key !== 'fixtureRoot');
  if (unsupported.length > 0) {
    throw new Error(
      `historical v1 verification does not accept live topology options: ${unsupported.join(', ')}`
    );
  }
  return verifyHistoricalRelocation(options);
}

function usage() {
  return 'v1 relocation CLI is retired; use node scripts/engine-relocation-v2.mjs for live topology operations';
}

export async function runCli(argv) {
  const [operation] = argv;
  if (operation === 'generate' || operation === 'verify') {
    throw new Error(
      `v1 live ${operation} is retired after the v2 migration; use scripts/engine-relocation-v2.mjs`
    );
  }
  throw new Error(usage());
}

if (import.meta.url === pathToFileUrl(process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

function pathToFileUrl(filePath) {
  return filePath ? new URL(`file://${path.resolve(filePath)}`).href : '';
}
