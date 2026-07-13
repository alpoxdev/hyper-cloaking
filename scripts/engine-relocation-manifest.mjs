import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 1;
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CANONICAL_ENGINE_ROOT = 'plugins/hyper-cloaking/skills/hyper-cloaking/engine';
export const LEGACY_ENGINE_ROOTS = Object.freeze([
  CANONICAL_ENGINE_ROOT,
  '.agents/skills/hyper-cloaking/engine',
  '.claude/skills/hyper-cloaking/engine',
  'skills/hyper-cloaking/engine'
]);
export const FIXTURE_ROOT = 'mcp/test/fixtures';
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
const OUTPUT_ENGINE_ROOT = 'mcp/engine';

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

function modeString(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`;
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
function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function fixturePath(repoRoot, filename) {
  return path.join(repoRoot, FIXTURE_ROOT, filename);
}

function admissionPath(repoRoot, filename) {
  return path.join(repoRoot, FIXTURE_ROOT, ADMISSION_DIRECTORY, filename);
}

function exceptionFor(relativePath) {
  return EXCEPTION_DETAILS[relativePath] || null;
}

function sourceFor(relativePath) {
  return `${CANONICAL_ENGINE_ROOT}/${relativePath}`;
}

function destinationFor(relativePath) {
  return relativePath === 'package.json' ? null : `${OUTPUT_ENGINE_ROOT}/${relativePath}`;
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
  const prefix = `${OUTPUT_ENGINE_ROOT}/`;
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

function syntheticRecord(relativePath, text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    path: relativePath,
    type: 'file',
    mode: '0644',
    sha256: sha256(bytes),
    bytesBase64: bytes.toString('base64')
  };
}

function negativeAdmissionFixtures(preimages) {
  const byPath = new Map(preimages.records.map((record) => [record.path, record]));
  const altered = (relativePath, suffix) => {
    const baseline = byPath.get(relativePath);
    const bytes = Buffer.concat([
      decodeBase64(baseline.bytesBase64, `preimage ${relativePath} bytesBase64`),
      Buffer.from(suffix, 'utf8')
    ]);
    return {
      path: relativePath,
      type: 'file',
      mode: baseline.mode,
      sha256: sha256(bytes),
      bytesBase64: bytes.toString('base64')
    };
  };
  return {
    'reject-cookie-runtime-payload.v1.json': {
      version: SCHEMA_VERSION,
      records: [syntheticRecord('cookie.yml', 'sites:\n  synthetic:\n    cookies: []\n')]
    },
    'reject-credential-profile-payload.v1.json': {
      version: SCHEMA_VERSION,
      records: [
        syntheticRecord(
          'profiles/synthetic-profile.json',
          '{"profile":"synthetic-sentinel","authorized":false}\n'
        )
      ]
    },
    'reject-undeclared-secret-source.v1.json': {
      version: SCHEMA_VERSION,
      records: [
        syntheticRecord(
          'agents/undeclared-secret-source.mjs',
          'export const syntheticSecretSentinel = "not-a-secret";\n'
        )
      ]
    },
    'reject-altered-cli-preimage.v1.json': {
      version: SCHEMA_VERSION,
      records: [altered('cli.mjs', '\n// synthetic alteration\n')]
    },
    'reject-altered-cookie-preimage.v1.json': {
      version: SCHEMA_VERSION,
      records: [altered('cookie.mjs', '\n// synthetic alteration\n')]
    }
  };
}

async function collectRegularFiles(root) {
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    throw new Error(`engine root is unavailable: ${root}`, { cause: error });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error(`engine root must be a real directory: ${root}`);

  const records = [];
  async function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareLexical(left.name, right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      normalizedRelative(relativePath, 'inventory path');
      const fullPath = path.join(root, relativePath);
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink())
        throw new Error(`symbolic links are not allowed in engine inventory: ${relativePath}`);
      if (stat.isDirectory()) {
        await visit(relativePath);
      } else if (stat.isFile()) {
        const bytes = await fs.readFile(fullPath);
        records.push({
          path: relativePath,
          type: 'file',
          mode: modeString(stat.mode),
          sha256: sha256(bytes),
          bytes
        });
      } else {
        throw new Error(`unsupported engine entry type: ${relativePath}`);
      }
    }
  }
  await visit('');
  records.sort((left, right) => compareLexical(left.path, right.path));
  return records;
}

function comparableInventory(records) {
  return records.map(({ path: relativePath, type, mode, sha256: digest }) => ({
    path: relativePath,
    type,
    mode,
    sha256: digest
  }));
}

/** Verifies that the four legacy engine trees have identical regular-file inventories. */
export async function assertFourWayParity() {
  const inventories = [];
  for (const relativeRoot of LEGACY_ENGINE_ROOTS)
    inventories.push(await collectRegularFiles(path.join(REPOSITORY_ROOT, relativeRoot)));
  const canonical = comparableInventory(inventories[0]);
  for (let index = 1; index < inventories.length; index += 1) {
    if (!sameValue(comparableInventory(inventories[index]), canonical)) {
      throw new Error(`four-way engine parity mismatch: ${LEGACY_ENGINE_ROOTS[index]}`);
    }
  }
  return inventories[0];
}

/** Builds the deterministic fixture data from the fixed canonical engine root. */
export async function buildRelocationFixtureBundle() {
  const inventory = await assertFourWayParity();
  const recordsByPath = new Map(inventory.map((record) => [record.path, record]));
  const entries = inventory.map((record) => {
    const exception = exceptionFor(record.path);
    const entry = {
      source: sourceFor(record.path),
      destination: destinationFor(record.path),
      type: record.type,
      mode: record.mode,
      preSha256: record.sha256,
      postSha256: null,
      exceptionKind: exception?.exceptionKind || null,
      permittedTransforms: exception ? [...exception.permittedTransforms] : []
    };
    if (exception) entry.preimageRef = record.path;
    if (entry.destination !== null) {
      const postimage = exception ? replayEntry(entry, record.bytes) : record.bytes;
      entry.postSha256 = sha256(postimage);
    }
    return entry;
  });
  const manifest = { version: SCHEMA_VERSION, entries };
  validateManifest(manifest);

  const preimages = {
    version: SCHEMA_VERSION,
    records: EXCEPTION_PATHS.map((relativePath) => {
      const record = recordsByPath.get(relativePath);
      if (!record)
        throw new Error(`declared exception is absent from canonical engine: ${relativePath}`);
      return {
        path: relativePath,
        type: record.type,
        mode: record.mode,
        sha256: record.sha256,
        bytesBase64: record.bytes.toString('base64')
      };
    })
  };
  validatePreimageBundle(preimages, manifest);

  const positive = {
    version: SCHEMA_VERSION,
    records: preimages.records.map((record) => ({
      preimageRef: record.path,
      path: record.path,
      type: record.type,
      mode: record.mode,
      sha256: record.sha256,
      bytesSha256: sha256(decodeBase64(record.bytesBase64, `preimage ${record.path} bytesBase64`))
    }))
  };
  validatePositiveAdmission(positive, preimages, manifest);

  const negatives = negativeAdmissionFixtures(preimages);
  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    const negative = negatives[filename];
    try {
      validatePreimageAdmission(negative.records, manifest);
    } catch {
      continue;
    }
    throw new Error(`synthetic negative admission fixture was admitted: ${filename}`);
  }
  return { manifest, preimages, positive, negatives };
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Generates the committed fixture bundle using only the fixed canonical source tree. */
export async function generateRelocationFixtures() {
  const bundle = await buildRelocationFixtureBundle();
  const fixtureDirectory = path.join(REPOSITORY_ROOT, FIXTURE_ROOT);
  await fs.mkdir(path.join(fixtureDirectory, ADMISSION_DIRECTORY), { recursive: true });
  await fs.writeFile(path.join(fixtureDirectory, MANIFEST_FILENAME), prettyJson(bundle.manifest));
  await fs.writeFile(path.join(fixtureDirectory, PREIMAGES_FILENAME), prettyJson(bundle.preimages));
  await fs.writeFile(
    path.join(fixtureDirectory, ADMISSION_DIRECTORY, POSITIVE_ADMISSION_FILENAME),
    prettyJson(bundle.positive)
  );
  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    await fs.writeFile(
      path.join(fixtureDirectory, ADMISSION_DIRECTORY, filename),
      prettyJson(bundle.negatives[filename])
    );
  }
  return {
    manifestPath: fixturePath(REPOSITORY_ROOT, MANIFEST_FILENAME),
    preimagesPath: fixturePath(REPOSITORY_ROOT, PREIMAGES_FILENAME),
    positiveAdmissionPath: admissionPath(REPOSITORY_ROOT, POSITIVE_ADMISSION_FILENAME),
    negativeAdmissionPaths: NEGATIVE_ADMISSION_FILENAMES.map((filename) =>
      admissionPath(REPOSITORY_ROOT, filename)
    )
  };
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
  const manifest = await readJson(path.join(fixtureRoot, MANIFEST_FILENAME), 'relocation manifest');
  const preimages = await readJson(
    path.join(fixtureRoot, PREIMAGES_FILENAME),
    'relocation preimage bundle'
  );
  const positive = await readJson(
    path.join(fixtureRoot, ADMISSION_DIRECTORY, POSITIVE_ADMISSION_FILENAME),
    'positive admission fixture'
  );
  const negatives = {};
  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    negatives[filename] = await readJson(
      path.join(fixtureRoot, ADMISSION_DIRECTORY, filename),
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

async function assertLegacyEnginesRemoved(repoRoot) {
  for (const relativeRoot of LEGACY_ENGINE_ROOTS) {
    try {
      await fs.lstat(path.join(repoRoot, relativeRoot));
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(`legacy engine path remains after relocation: ${relativeRoot}`);
  }
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

function tarballEngineBinTargetPaths(bin) {
  const prefix = './engine/';
  return new Set(
    Object.values(bin)
      .filter((target) => target.startsWith(prefix))
      .map((target) =>
        normalizedRelative(target.slice(2), 'outer package bin target').slice('engine/'.length)
      )
  );
}

function tarballEngineMode(entry, binTargetPaths) {
  return binTargetPaths.has(relativeFromDestination(entry.destination)) ? '0755' : entry.mode;
}

async function verifyEngineTree(
  root,
  entries,
  label,
  expectedModeForEntry = (entry) => entry.mode
) {
  const actual = await collectRegularFiles(root);
  const expected = new Map(
    entries.map((entry) => [relativeFromDestination(entry.destination), entry])
  );
  const actualPaths = actual.map((record) => record.path);
  const expectedPaths = [...expected.keys()].sort(compareLexical);
  if (!sameValue(actualPaths, expectedPaths)) {
    const extras = actualPaths.filter((item) => !expected.has(item));
    const missing = expectedPaths.filter((item) => !actualPaths.includes(item));
    throw new Error(
      `${label} engine inventory mismatch (extra: ${extras.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`
    );
  }
  for (const record of actual) {
    const entry = expected.get(record.path);
    if (
      record.type !== entry.type ||
      record.mode !== expectedModeForEntry(entry) ||
      record.sha256 !== entry.postSha256
    ) {
      throw new Error(`${label} engine file mismatch: ${record.path}`);
    }
  }
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

/**
 * Verifies a relocated worktree and, when supplied, an unpacked tarball root.
 * It consumes only committed fixtures and relocated outputs; legacy sources are
 * required to be absent and are never read.
 */
export async function verifyRelocation({
  repoRoot = REPOSITORY_ROOT,
  fixtureRoot = path.join(repoRoot, FIXTURE_ROOT),
  tarballRoot = null
} = {}) {
  const fixtures = await readRelocationFixtures({ fixtureRoot });
  replayExceptions(fixtures.manifest, fixtures.preimages);
  await assertLegacyEnginesRemoved(repoRoot);

  const outerManifest = await readJson(
    path.join(repoRoot, 'mcp/package.json'),
    'outer package manifest'
  );
  assertOuterPackagePolicy(outerManifest);
  try {
    const rootManifest = await readJson(
      path.join(repoRoot, 'package.json'),
      'root package manifest'
    );
    assertNoRetiredDependency(rootManifest, 'root package manifest');
  } catch (error) {
    if (error?.cause?.code !== 'ENOENT') throw error;
  }

  const outputEntries = fixtures.manifest.entries.filter((entry) => entry.destination !== null);
  await verifyEngineTree(path.join(repoRoot, OUTPUT_ENGINE_ROOT), outputEntries, 'worktree');
  if (tarballRoot !== null) {
    if (typeof tarballRoot !== 'string' || tarballRoot.length === 0)
      throw new Error('tarballRoot must be an unpacked package directory');
    const binTargetPaths = tarballEngineBinTargetPaths(outerManifest.bin);
    await verifyEngineTree(path.join(tarballRoot, 'engine'), outputEntries, 'tarball', (entry) =>
      tarballEngineMode(entry, binTargetPaths)
    );
  }
  return { entries: outputEntries.length, tarballVerified: tarballRoot !== null };
}

function usage() {
  return 'Usage: node scripts/engine-relocation-manifest.mjs generate | verify [--tarball-root <unpacked-package-dir>]';
}

async function runCli(argv) {
  const [mode, ...args] = argv;
  if (mode === 'generate' && args.length === 0) {
    const result = await generateRelocationFixtures();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === 'verify') {
    let tarballRoot = null;
    if (args.length === 2 && args[0] === '--tarball-root') tarballRoot = path.resolve(args[1]);
    else if (args.length !== 0) throw new Error(usage());
    const result = await verifyRelocation({ tarballRoot });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
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
