import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 2;
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CANONICAL_ENGINE_ROOT = 'packages/mcp-engine/src';
export const LEGACY_ADAPTER_ROOT = 'mcp/engine';
export const FIXTURE_ROOT = 'mcp/test/fixtures/engine-compat-v2';
export const EVIDENCE_FILENAME = 'engine-relocation-evidence.v2.json';
export const EXECUTABLE_ADAPTERS = Object.freeze({
  'agents/parent-dispatcher.mjs': Object.freeze({
    canonicalPackage: '@mcp/engine/agents/parent-dispatcher',
    runner: 'runParentDispatcher'
  }),
  'browser-utils.mjs': Object.freeze({
    canonicalPackage: '@mcp/engine/browser-utils',
    runner: 'runBrowserUtilsCli'
  }),
  'cli.mjs': Object.freeze({
    canonicalPackage: '@mcp/engine/cli',
    runner: 'runEngineCli'
  }),
  'cookie.mjs': Object.freeze({
    canonicalPackage: '@mcp/engine/cookie',
    runner: 'runCookieCli'
  })
});

export const LIVE_RELOCATION_EVIDENCE_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://alpox.dev/schemas/engine-relocation-evidence.v2.json',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'canonicalRoot', 'adapterRoot', 'canonical', 'adapters'],
  properties: {
    version: { const: SCHEMA_VERSION },
    canonicalRoot: { $ref: '#/$defs/relativePath' },
    adapterRoot: { $ref: '#/$defs/relativePath' },
    canonical: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/canonicalRecord' }
    },
    adapters: {
      type: 'array',
      items: { $ref: '#/$defs/adapterRecord' }
    }
  },
  $defs: {
    relativePath: {
      type: 'string',
      minLength: 1,
      pattern: '^(?!/)(?!.*\\\\)(?!.*//)(?!.*(?:^|/)\\.\\.?(?:/|$)).+$'
    },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    mode: { type: 'string', pattern: '^0[0-7]{3}$' },
    canonicalRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['role', 'path', 'sha256', 'mode'],
      properties: {
        role: { const: 'canonical' },
        path: { $ref: '#/$defs/relativePath' },
        sha256: { $ref: '#/$defs/sha256' },
        mode: { $ref: '#/$defs/mode' }
      }
    },
    adapterRecord: {
      type: 'object',
      additionalProperties: false,
      required: ['role', 'path', 'sha256', 'mode', 'adapterKind', 'canonicalPackage', 'runner'],
      properties: {
        role: { const: 'adapter' },
        path: { $ref: '#/$defs/relativePath' },
        sha256: { $ref: '#/$defs/sha256' },
        mode: { $ref: '#/$defs/mode' },
        adapterKind: { enum: ['import-only', 'executable'] },
        canonicalPackage: {
          type: 'string',
          pattern: '^@mcp/engine(?:/[a-z0-9]+(?:[-.][a-z0-9]+)*)*$'
        },
        runner: {
          type: ['string', 'null'],
          pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$'
        }
      },
      allOf: [
        {
          if: { properties: { adapterKind: { const: 'import-only' } } },
          // oxlint-disable-next-line unicorn/no-thenable
          ['then']: {
            properties: {
              mode: { const: '0644' },
              runner: { const: null }
            }
          }
        },
        {
          if: { properties: { adapterKind: { const: 'executable' } } },
          // oxlint-disable-next-line unicorn/no-thenable
          ['then']: { properties: { mode: { const: '0755' } } }
        }
      ]
    }
  }
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function modeString(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`;
}

function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(compareLexical);
  const expected = [...keys].sort(compareLexical);
  if (!sameValue(actual, expected)) throw new Error(`${label} has unexpected keys`);
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

function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
}

function assertMode(value, label) {
  if (typeof value !== 'string' || !/^0[0-7]{3}$/.test(value))
    throw new Error(`${label} must be a four-digit octal mode`);
}

function assertSortedUnique(records, label) {
  let previous = null;
  for (const record of records) {
    if (typeof record?.path !== 'string') throw new Error(`${label} path must be a string`);
    if (previous !== null && previous >= record.path)
      throw new Error(`${label} must be strictly sorted by path`);
    previous = record.path;
  }
}

function relativeFromRoot(root, target, label) {
  const relative = path.relative(root, target).split(path.sep).join('/');
  return normalizedRelative(relative, label);
}

function assertDistinctRoots(canonicalRoot, adapterRoot) {
  if (
    canonicalRoot === adapterRoot ||
    canonicalRoot.startsWith(`${adapterRoot}/`) ||
    adapterRoot.startsWith(`${canonicalRoot}/`)
  ) {
    throw new Error('canonical root and adapter root must be disjoint');
  }
}

function resolveTopology({
  repoRoot = REPOSITORY_ROOT,
  canonicalRoot,
  adapterRoot,
  canonicalRootPath,
  adapterRootPath
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0)
    throw new Error('repoRoot must be a directory path');
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedCanonicalRoot = path.resolve(
    resolvedRepoRoot,
    canonicalRoot === undefined ? CANONICAL_ENGINE_ROOT : canonicalRoot
  );
  const resolvedAdapterRoot = path.resolve(
    resolvedRepoRoot,
    adapterRoot === undefined ? LEGACY_ADAPTER_ROOT : adapterRoot
  );
  const resolvedCanonicalRootPath = normalizedRelative(
    canonicalRootPath === undefined
      ? relativeFromRoot(resolvedRepoRoot, resolvedCanonicalRoot, 'canonical root')
      : canonicalRootPath,
    'canonical root'
  );
  const resolvedAdapterRootPath = normalizedRelative(
    adapterRootPath === undefined
      ? relativeFromRoot(resolvedRepoRoot, resolvedAdapterRoot, 'adapter root')
      : adapterRootPath,
    'adapter root'
  );
  if (
    path.resolve(resolvedRepoRoot, resolvedCanonicalRootPath) !== resolvedCanonicalRoot ||
    path.resolve(resolvedRepoRoot, resolvedAdapterRootPath) !== resolvedAdapterRoot
  ) {
    throw new Error('logical root paths must identify their supplied filesystem roots');
  }
  assertDistinctRoots(resolvedCanonicalRootPath, resolvedAdapterRootPath);
  return {
    repoRoot: resolvedRepoRoot,
    canonicalRoot: resolvedCanonicalRoot,
    adapterRoot: resolvedAdapterRoot,
    canonicalRootPath: resolvedCanonicalRootPath,
    adapterRootPath: resolvedAdapterRootPath
  };
}

async function collectRegularFiles(root, label) {
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    throw new Error(`${label} root is unavailable: ${root}`, { cause: error });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error(`${label} root must be a real directory: ${root}`);

  const records = [];
  async function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareLexical(left.name, right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      normalizedRelative(relativePath, `${label} inventory path`);
      const fullPath = path.join(root, relativePath);
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink())
        throw new Error(`symbolic links are not allowed in ${label}: ${relativePath}`);
      if (stat.isDirectory()) {
        await visit(relativePath);
      } else if (stat.isFile()) {
        const bytes = await fs.readFile(fullPath);
        records.push({
          path: relativePath,
          sha256: sha256(bytes),
          mode: modeString(stat.mode),
          bytes
        });
      } else {
        throw new Error(`unsupported ${label} entry type: ${relativePath}`);
      }
    }
  }
  await visit('');
  records.sort((left, right) => compareLexical(left.path, right.path));
  return records;
}

const CANONICAL_PACKAGE_PATTERN = /^@mcp\/engine(?:\/[a-z0-9]+(?:[-.][a-z0-9]+)*)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const REALPATH_MAIN_GUARD = [
  'function isMainModule() {',
  '  if (!process.argv[1]) return false;',
  '  try {',
  '    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));',
  '  } catch {',
  '    return false;',
  '  }',
  '}'
].join('\n');

function assertCanonicalPackage(value, label) {
  if (typeof value !== 'string' || !CANONICAL_PACKAGE_PATTERN.test(value))
    throw new Error(`${label} must be a public @mcp/engine package specifier`);
}

function parseExplicitForward(text, source) {
  const match = /^export\s*\{\s*([\s\S]*?)\s*\}\s*from\s*'([^'\n]+)';\n$/.exec(text);
  if (!match)
    throw new Error(`legacy adapter must be an exact explicit canonical forward: ${source}`);
  const exportItems = match[1].split(',').map((name) => name.trim());
  const exports = exportItems.at(-1) === '' ? exportItems.slice(0, -1) : exportItems;
  if (
    exports.length === 0 ||
    exports.some((name) => !IDENTIFIER_PATTERN.test(name)) ||
    new Set(exports).size !== exports.length
  ) {
    throw new Error(`legacy adapter exports are not explicit canonical names: ${source}`);
  }
  assertCanonicalPackage(match[2], `legacy adapter canonical package for ${source}`);
  return { canonicalPackage: match[2], exports };
}

function hasExecutableBehavior(text) {
  return (
    text.startsWith('#!') ||
    /\b(?:await|process|realpathSync|fileURLToPath)\b/.test(text) ||
    /(?:^|\n)\s*import\b/.test(text)
  );
}

function assertAllowedNodeBuiltins(text, source) {
  for (const match of text.matchAll(/['"](node:[^'"]+)['"]/g)) {
    if (match[1] !== 'node:fs' && match[1] !== 'node:url')
      throw new Error(`legacy executable adapter imports unexpected Node builtin: ${source}`);
  }
}

function executableInvocationSources(runner) {
  return new Set([
    ['if (isMainModule()) {', `  process.exitCode = await ${runner}();`, '}', ''].join('\n'),
    [
      'if (isMainModule()) {',
      `  process.exitCode = await ${runner}().catch((error) => {`,
      '    console.error(error instanceof Error ? error.message : String(error));',
      '    process.exit(1);',
      '  });',
      '}',
      ''
    ].join('\n')
  ]);
}

function parseExecutableAdapterSource(text, source, policy) {
  assertAllowedNodeBuiltins(text, source);
  const header =
    /^#!\/usr\/bin\/env node\nimport \{ realpathSync \} from 'node:fs';\nimport \{ fileURLToPath \} from 'node:url';\nimport \{ ([A-Za-z_$][A-Za-z0-9_$]*) \} from '([^'\n]+)';\n\n/.exec(
      text
    );
  if (!header)
    throw new Error(`legacy executable adapter must use the realpath main guard: ${source}`);

  const runner = header[1];
  const canonicalPackage = header[2];
  const body = text.slice(header[0].length);
  const guardSuffix = `\n\n${REALPATH_MAIN_GUARD}\n\n`;
  const guardIndex = body.indexOf(guardSuffix);
  if (guardIndex < 0)
    throw new Error(`legacy executable adapter is missing the realpath main guard: ${source}`);

  const forward = parseExplicitForward(body.slice(0, guardIndex).trimEnd() + '\n', source);
  const invocation = body.slice(guardIndex + guardSuffix.length);
  if (!executableInvocationSources(runner).has(invocation))
    throw new Error(`legacy executable adapter must call exactly one declared runner: ${source}`);
  if (canonicalPackage !== forward.canonicalPackage)
    throw new Error(`legacy executable adapter has undeclared canonical packages: ${source}`);
  if (!forward.exports.includes(runner))
    throw new Error(`legacy executable adapter runner is not explicitly forwarded: ${source}`);
  if (canonicalPackage !== policy.canonicalPackage)
    throw new Error(`legacy executable adapter canonical package is undeclared: ${source}`);
  if (runner !== policy.runner)
    throw new Error(`legacy executable adapter runner is undeclared: ${source}`);

  return { adapterKind: 'executable', canonicalPackage, runner };
}

function parseAdapterSource(bytes, source) {
  const text = bytes.toString('utf8');
  try {
    const forward = parseExplicitForward(text, source);
    return { adapterKind: 'import-only', canonicalPackage: forward.canonicalPackage, runner: null };
  } catch (error) {
    const policy = EXECUTABLE_ADAPTERS[source];
    if (!policy) {
      if (hasExecutableBehavior(text))
        throw new Error(`executable legacy adapter is not allowed: ${source}`);
      throw error;
    }
    return parseExecutableAdapterSource(text, source, policy);
  }
}

function validateCanonicalRecord(record) {
  exactKeys(
    record,
    ['role', 'path', 'sha256', 'mode'],
    `canonical record ${record?.path || '<unknown>'}`
  );
  if (record.role !== 'canonical')
    throw new Error(`canonical record ${record.path} has an invalid role`);
  normalizedRelative(record.path, `canonical record ${record.path || '<unknown>'} path`);
  assertHash(record.sha256, `canonical record ${record.path} sha256`);
  assertMode(record.mode, `canonical record ${record.path} mode`);
}

function validateAdapterRecord(record) {
  exactKeys(
    record,
    ['role', 'path', 'sha256', 'mode', 'adapterKind', 'canonicalPackage', 'runner'],
    `adapter record ${record?.path || '<unknown>'}`
  );
  if (record.role !== 'adapter')
    throw new Error(`adapter record ${record.path} has an invalid role`);
  normalizedRelative(record.path, `adapter record ${record.path || '<unknown>'} path`);
  assertHash(record.sha256, `adapter record ${record.path} sha256`);
  assertMode(record.mode, `adapter record ${record.path} mode`);
  assertCanonicalPackage(record.canonicalPackage, `adapter record ${record.path} canonicalPackage`);
  if (record.adapterKind === 'import-only') {
    if (record.runner !== null)
      throw new Error(`import-only adapter runner must be null: ${record.path}`);
    if (record.mode !== '0644')
      throw new Error(`import-only adapter mode is undeclared: ${record.path}`);
    return;
  }
  if (record.adapterKind !== 'executable')
    throw new Error(`adapter record ${record.path} has an invalid adapterKind`);
  if (typeof record.runner !== 'string' || !IDENTIFIER_PATTERN.test(record.runner))
    throw new Error(`executable adapter runner is invalid: ${record.path}`);
  const policy = EXECUTABLE_ADAPTERS[record.path];
  if (!policy) throw new Error(`executable legacy adapter is not allowed: ${record.path}`);
  if (record.canonicalPackage !== policy.canonicalPackage)
    throw new Error(`executable adapter canonical package is undeclared: ${record.path}`);
  if (record.runner !== policy.runner)
    throw new Error(`executable adapter runner is undeclared: ${record.path}`);
  if (record.mode !== '0755')
    throw new Error(`executable adapter mode is undeclared: ${record.path}`);
}

/** Validates the v2 canonical inventory and legacy adapter allowlist JSON contract. */
export function validateLiveRelocationEvidence(evidence) {
  exactKeys(
    evidence,
    ['version', 'canonicalRoot', 'adapterRoot', 'canonical', 'adapters'],
    'v2 evidence'
  );
  if (evidence.version !== SCHEMA_VERSION) throw new Error('v2 evidence version is invalid');
  const canonicalRoot = normalizedRelative(evidence.canonicalRoot, 'v2 evidence canonicalRoot');
  const adapterRoot = normalizedRelative(evidence.adapterRoot, 'v2 evidence adapterRoot');
  assertDistinctRoots(canonicalRoot, adapterRoot);
  if (!Array.isArray(evidence.canonical) || evidence.canonical.length === 0)
    throw new Error('v2 canonical inventory must be a non-empty array');
  if (!Array.isArray(evidence.adapters)) throw new Error('v2 adapter allowlist must be an array');
  assertSortedUnique(evidence.canonical, 'v2 canonical inventory');
  assertSortedUnique(evidence.adapters, 'v2 adapter allowlist');

  const canonicalHashes = new Set();
  for (const record of evidence.canonical) {
    validateCanonicalRecord(record);
    canonicalHashes.add(record.sha256);
  }

  for (const record of evidence.adapters) {
    validateAdapterRecord(record);
    if (canonicalHashes.has(record.sha256))
      throw new Error(`legacy adapter duplicates canonical hash: ${record.path}`);
  }
  return evidence;
}

/** Builds a v2 inventory from explicit canonical and legacy adapter roots. */
export async function buildLiveRelocationEvidence(options = {}) {
  const topology = resolveTopology(options);
  const canonicalInventory = await collectRegularFiles(
    topology.canonicalRoot,
    'canonical inventory'
  );
  if (canonicalInventory.length === 0) throw new Error('canonical inventory must not be empty');
  const canonical = canonicalInventory.map(({ path: relativePath, sha256: digest, mode }) => ({
    role: 'canonical',
    path: relativePath,
    sha256: digest,
    mode
  }));
  const canonicalHashes = new Set(canonical.map((record) => record.sha256));

  const adapterInventory = await collectRegularFiles(
    topology.adapterRoot,
    'legacy adapter inventory'
  );
  const adapters = adapterInventory.map((record) => {
    if (canonicalHashes.has(record.sha256))
      throw new Error(`legacy adapter duplicates canonical hash: ${record.path}`);
    const mapping = parseAdapterSource(record.bytes, record.path);
    return {
      role: 'adapter',
      path: record.path,
      sha256: record.sha256,
      mode: record.mode,
      adapterKind: mapping.adapterKind,
      canonicalPackage: mapping.canonicalPackage,
      runner: mapping.runner
    };
  });
  const evidence = {
    version: SCHEMA_VERSION,
    canonicalRoot: topology.canonicalRootPath,
    adapterRoot: topology.adapterRootPath,
    canonical,
    adapters
  };
  return validateLiveRelocationEvidence(evidence);
}

function inventoryMismatch(label, actual, expected) {
  const expectedByPath = new Map(expected.map((record) => [record.path, record]));
  const actualPaths = actual.map((record) => record.path);
  const expectedPaths = expected.map((record) => record.path);
  if (!sameValue(actualPaths, expectedPaths)) {
    const extras = actualPaths.filter((item) => !expectedByPath.has(item));
    const actualPathSet = new Set(actualPaths);
    const missing = expectedPaths.filter((item) => !actualPathSet.has(item));
    throw new Error(
      `${label} inventory mismatch (extra: ${extras.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`
    );
  }
  return expectedByPath;
}

function assertInventoryRecords(label, actual, expected) {
  const expectedByPath = inventoryMismatch(label, actual, expected);
  for (const record of actual) {
    const expectedRecord = expectedByPath.get(record.path);
    if (record.sha256 !== expectedRecord.sha256 || record.mode !== expectedRecord.mode)
      throw new Error(`${label} file mismatch: ${record.path}`);
  }
  return actual;
}

/** Verifies canonical source files exactly against the v2 canonical inventory. */
export async function verifyCanonicalInventory({ canonicalRoot, expected } = {}) {
  if (typeof canonicalRoot !== 'string' || canonicalRoot.length === 0)
    throw new Error('canonicalRoot is required');
  if (!Array.isArray(expected)) throw new Error('expected canonical inventory is required');
  const actual = await collectRegularFiles(path.resolve(canonicalRoot), 'canonical inventory');
  return assertInventoryRecords('canonical', actual, expected);
}

/** Verifies that legacy files are exact declared canonical package adapters. */
export async function verifyAdapterContainment({ adapterRoot, expected, canonicalInventory } = {}) {
  if (typeof adapterRoot !== 'string' || adapterRoot.length === 0)
    throw new Error('adapterRoot is required');
  if (!Array.isArray(expected)) throw new Error('expected adapter allowlist is required');
  if (!Array.isArray(canonicalInventory)) throw new Error('canonical inventory is required');

  const canonicalHashes = new Set(canonicalInventory.map((record) => record.sha256));
  const actual = await collectRegularFiles(path.resolve(adapterRoot), 'legacy adapter inventory');
  for (const record of actual) {
    if (canonicalHashes.has(record.sha256))
      throw new Error(`legacy adapter duplicates canonical hash: ${record.path}`);
  }
  const expectedByPath = inventoryMismatch('legacy adapter', actual, expected);
  for (const record of actual) {
    const expectedRecord = expectedByPath.get(record.path);
    const mapping = parseAdapterSource(record.bytes, record.path);
    if (mapping.adapterKind !== expectedRecord.adapterKind)
      throw new Error(`adapter kind is undeclared for ${record.path}`);
    if (mapping.canonicalPackage !== expectedRecord.canonicalPackage)
      throw new Error(`adapter canonical package is undeclared for ${record.path}`);
    if (mapping.runner !== expectedRecord.runner)
      throw new Error(`adapter runner is undeclared for ${record.path}`);
  }
  return assertInventoryRecords('legacy adapter', actual, expected);
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

/** Reads and validates committed v2 evidence without importing the v1 verifier. */
export async function readLiveRelocationEvidence({
  fixtureRoot = path.join(REPOSITORY_ROOT, FIXTURE_ROOT)
} = {}) {
  if (typeof fixtureRoot !== 'string' || fixtureRoot.length === 0)
    throw new Error('fixtureRoot must be a directory path');
  return validateLiveRelocationEvidence(
    await readJson(path.join(fixtureRoot, EVIDENCE_FILENAME), 'v2 live relocation evidence')
  );
}
function resolveFixtureRoot(fixtureRoot, repoRoot) {
  if (fixtureRoot === undefined) return path.join(repoRoot, FIXTURE_ROOT);
  if (typeof fixtureRoot !== 'string' || fixtureRoot.length === 0)
    throw new Error('fixtureRoot must be a directory path');
  return path.resolve(repoRoot, fixtureRoot);
}

/** Creates committed v2 evidence from live roots. */
export async function writeLiveRelocationEvidence({ fixtureRoot, ...topologyOptions } = {}) {
  const topology = resolveTopology(topologyOptions);
  const evidence = await buildLiveRelocationEvidence(topologyOptions);
  const resolvedFixtureRoot = resolveFixtureRoot(fixtureRoot, topology.repoRoot);
  await fs.mkdir(resolvedFixtureRoot, { recursive: true });
  const evidencePath = path.join(resolvedFixtureRoot, EVIDENCE_FILENAME);
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { evidence, evidencePath };
}

/** Verifies the migrated canonical tree and the complete legacy adapter boundary. */
export async function verifyLiveRelocation({ fixtureRoot, ...topologyOptions } = {}) {
  const topology = resolveTopology(topologyOptions);
  const evidence = await readLiveRelocationEvidence({
    fixtureRoot: resolveFixtureRoot(fixtureRoot, topology.repoRoot)
  });
  if (
    evidence.canonicalRoot !== topology.canonicalRootPath ||
    evidence.adapterRoot !== topology.adapterRootPath
  ) {
    throw new Error('v2 evidence roots do not match the supplied live roots');
  }
  const canonicalInventory = await verifyCanonicalInventory({
    canonicalRoot: topology.canonicalRoot,
    expected: evidence.canonical
  });
  const adapterInventory = await verifyAdapterContainment({
    adapterRoot: topology.adapterRoot,
    expected: evidence.adapters,
    canonicalInventory
  });
  return { canonical: canonicalInventory.length, adapters: adapterInventory.length };
}

function usage() {
  return [
    'Usage: node scripts/engine-relocation-v2.mjs generate|verify',
    '[--repo-root <root>] [--canonical-root <root>] [--adapter-root <root>]',
    '[--fixture-root <directory>]'
  ].join(' ');
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(usage());
    const key = {
      '--repo-root': 'repoRoot',
      '--canonical-root': 'canonicalRoot',
      '--adapter-root': 'adapterRoot',
      '--fixture-root': 'fixtureRoot'
    }[flag];
    if (!key || Object.hasOwn(options, key)) throw new Error(usage());
    options[key] = value;
  }
  return options;
}

async function runCli(argv) {
  const [command, ...args] = argv;
  const options = parseCliOptions(args);
  if (command === 'generate') {
    const result = await writeLiveRelocationEvidence(options);
    process.stdout.write(
      `${JSON.stringify({
        evidencePath: result.evidencePath,
        canonical: result.evidence.canonical.length,
        adapters: result.evidence.adapters.length
      })}\n`
    );
    return;
  }
  if (command === 'verify') {
    const result = await verifyLiveRelocation(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(usage());
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
