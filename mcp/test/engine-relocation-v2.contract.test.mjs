import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  EVIDENCE_FILENAME,
  LIVE_RELOCATION_EVIDENCE_SCHEMA,
  buildLiveRelocationEvidence,
  readLiveRelocationEvidence,
  validateLiveRelocationEvidence,
  verifyLiveRelocation,
  writeLiveRelocationEvidence
} from '../../scripts/engine-relocation-v2.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonicalFixtureRoot = path.join(
  repositoryRoot,
  'packages/mcp-engine/test/fixtures/engine-relocation-v2/canonical'
);
const adapterFixtureRoot = path.join(repositoryRoot, 'mcp/test/fixtures/engine-compat-v2/adapter');

const executableAdapters = Object.freeze([
  Object.freeze({
    path: 'agents/parent-dispatcher.mjs',
    canonicalPackage: '@mcp/engine/agents/parent-dispatcher',
    runner: 'runParentDispatcher',
    catchesErrors: false
  }),
  Object.freeze({
    path: 'browser-utils.mjs',
    canonicalPackage: '@mcp/engine/browser-utils',
    runner: 'runBrowserUtilsCli',
    catchesErrors: true
  }),
  Object.freeze({
    path: 'cli.mjs',
    canonicalPackage: '@mcp/engine/cli',
    runner: 'runEngineCli',
    catchesErrors: false
  }),
  Object.freeze({
    path: 'cookie.mjs',
    canonicalPackage: '@mcp/engine/cookie',
    runner: 'runCookieCli',
    catchesErrors: true
  })
]);

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

function explicitForward(canonicalPackage, exports) {
  return `export {\n${exports.map((name) => `  ${name},`).join('\n')}\n} from '${canonicalPackage}';\n`;
}

function guardedExecutableAdapter({ canonicalPackage, runner, catchesErrors }) {
  const invocation = catchesErrors
    ? [
        'if (isMainModule()) {',
        `  process.exitCode = await ${runner}().catch((error) => {`,
        '    console.error(error instanceof Error ? error.message : String(error));',
        '    process.exit(1);',
        '  });',
        '}',
        ''
      ].join('\n')
    : ['if (isMainModule()) {', `  process.exitCode = await ${runner}();`, '}', ''].join('\n');
  return [
    '#!/usr/bin/env node',
    "import { realpathSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    `import { ${runner} } from '${canonicalPackage}';`,
    '',
    explicitForward(canonicalPackage, [runner]).trimEnd(),
    '',
    REALPATH_MAIN_GUARD,
    '',
    invocation
  ].join('\n');
}

async function writeAdapter(adapterRoot, relativePath, source, mode) {
  const filePath = path.join(adapterRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
  await fs.chmod(filePath, mode);
}

async function materializeSyntheticAdapters(adapterRoot) {
  await writeAdapter(adapterRoot, 'core.mjs', explicitForward('@mcp/engine/core', ['core']), 0o644);
  await writeAdapter(
    adapterRoot,
    'nested/math.mjs',
    explicitForward('@mcp/engine/nested/math', ['add']),
    0o644
  );
  for (const adapter of executableAdapters) {
    await writeAdapter(adapterRoot, adapter.path, guardedExecutableAdapter(adapter), 0o755);
  }
}

async function materializeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-relocation-v2-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonicalRoot = path.join(root, 'packages/mcp-engine/src');
  const adapterRoot = path.join(root, 'mcp/engine');
  const fixtureRoot = path.join(root, 'evidence');
  await fs.mkdir(path.dirname(canonicalRoot), { recursive: true });
  await fs.mkdir(path.dirname(adapterRoot), { recursive: true });
  await fs.cp(canonicalFixtureRoot, canonicalRoot, { recursive: true });
  await fs.cp(adapterFixtureRoot, adapterRoot, { recursive: true });
  await materializeSyntheticAdapters(adapterRoot);
  const generated = await writeLiveRelocationEvidence({ repoRoot: root, fixtureRoot });
  return { root, canonicalRoot, adapterRoot, fixtureRoot, evidence: generated.evidence };
}

test('v2 evidence records strict import-only forwards and guarded executable adapters', async (t) => {
  const fixture = await materializeFixture(t);
  const built = await buildLiveRelocationEvidence({ repoRoot: fixture.root });
  assert.deepEqual(built, fixture.evidence);
  assert.equal(LIVE_RELOCATION_EVIDENCE_SCHEMA.properties.version.const, 2);
  assert.deepEqual(LIVE_RELOCATION_EVIDENCE_SCHEMA.$defs.adapterRecord.required, [
    'role',
    'path',
    'sha256',
    'mode',
    'adapterKind',
    'canonicalPackage',
    'runner'
  ]);
  assert.deepEqual(
    built.canonical.map((record) => [record.role, record.path, record.mode]),
    [
      ['canonical', 'core.mjs', '0644'],
      ['canonical', 'nested/math.mjs', '0644']
    ]
  );
  assert.deepEqual(
    built.adapters.map((record) => [
      record.path,
      record.adapterKind,
      record.canonicalPackage,
      record.runner,
      record.mode
    ]),
    [
      [
        'agents/parent-dispatcher.mjs',
        'executable',
        '@mcp/engine/agents/parent-dispatcher',
        'runParentDispatcher',
        '0755'
      ],
      [
        'browser-utils.mjs',
        'executable',
        '@mcp/engine/browser-utils',
        'runBrowserUtilsCli',
        '0755'
      ],
      ['cli.mjs', 'executable', '@mcp/engine/cli', 'runEngineCli', '0755'],
      ['cookie.mjs', 'executable', '@mcp/engine/cookie', 'runCookieCli', '0755'],
      ['core.mjs', 'import-only', '@mcp/engine/core', null, '0644'],
      ['nested/math.mjs', 'import-only', '@mcp/engine/nested/math', null, '0644']
    ]
  );
  assert.equal(
    await fs.stat(path.join(fixture.fixtureRoot, EVIDENCE_FILENAME)).then(() => true),
    true
  );
  assert.deepEqual(
    await readLiveRelocationEvidence({ fixtureRoot: fixture.fixtureRoot }),
    fixture.evidence
  );
  assert.deepEqual(
    await verifyLiveRelocation({ repoRoot: fixture.root, fixtureRoot: fixture.fixtureRoot }),
    { canonical: 2, adapters: 6 }
  );

  const malformed = structuredClone(fixture.evidence);
  malformed.adapters.find((record) => record.path === 'cli.mjs').runner = 'runCookieCli';
  assert.throws(
    () => validateLiveRelocationEvidence(malformed),
    /executable adapter runner is undeclared/
  );
});

test('v2 verifier rejects topology and adapter contract mutations', async (t) => {
  const cases = [
    {
      name: 'canonical symbolic link',
      mutate: async ({ canonicalRoot }) =>
        fs.symlink('core.mjs', path.join(canonicalRoot, 'linked.mjs')),
      error: /symbolic links are not allowed in canonical inventory/
    },
    {
      name: 'canonical extra file',
      mutate: async ({ canonicalRoot }) =>
        fs.writeFile(path.join(canonicalRoot, 'extra.mjs'), 'export {};\n'),
      error: /canonical inventory mismatch \(extra: extra.mjs; missing: none\)/
    },
    {
      name: 'canonical missing file',
      mutate: async ({ canonicalRoot }) => fs.rm(path.join(canonicalRoot, 'core.mjs')),
      error: /canonical inventory mismatch \(extra: none; missing: core.mjs\)/
    },
    {
      name: 'canonical wrong mode',
      mutate: async ({ canonicalRoot }) => fs.chmod(path.join(canonicalRoot, 'core.mjs'), 0o755),
      error: /canonical file mismatch: core.mjs/
    },
    {
      name: 'adapter symbolic link',
      mutate: async ({ adapterRoot }) =>
        fs.symlink('core.mjs', path.join(adapterRoot, 'linked.mjs')),
      error: /symbolic links are not allowed in legacy adapter inventory/
    },
    {
      name: 'adapter extra file',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'extra.mjs',
          explicitForward('@mcp/engine/core', ['core']),
          0o644
        ),
      error: /legacy adapter inventory mismatch \(extra: extra.mjs; missing: none\)/
    },
    {
      name: 'adapter missing file',
      mutate: async ({ adapterRoot }) => fs.rm(path.join(adapterRoot, 'core.mjs')),
      error: /legacy adapter inventory mismatch \(extra: none; missing: core.mjs\)/
    },
    {
      name: 'import-only adapter wrong mode',
      mutate: async ({ adapterRoot }) => fs.chmod(path.join(adapterRoot, 'core.mjs'), 0o755),
      error: /legacy adapter file mismatch: core.mjs/
    },
    {
      name: 'copied canonical module in adapter tree',
      mutate: async ({ canonicalRoot, adapterRoot }) =>
        fs.copyFile(path.join(canonicalRoot, 'core.mjs'), path.join(adapterRoot, 'core.mjs')),
      error: /legacy adapter duplicates canonical hash: core.mjs/
    },
    {
      name: 'undeclared import-only canonical package',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'core.mjs',
          explicitForward('@mcp/engine/nested/math', ['core']),
          0o644
        ),
      error: /adapter canonical package is undeclared for core.mjs/
    },
    {
      name: 'non-canonical import-only package',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(adapterRoot, 'core.mjs', "export { core } from 'outside';\n", 0o644),
      error: /public @mcp\/engine package specifier/
    },
    {
      name: 'wildcard canonical forward',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(adapterRoot, 'core.mjs', "export * from '@mcp/engine/core';\n", 0o644),
      error: /exact explicit canonical forward: core.mjs/
    },
    {
      name: 'unallowlisted executable behavior',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'core.mjs',
          guardedExecutableAdapter({
            canonicalPackage: '@mcp/engine/core',
            runner: 'runEngineCli',
            catchesErrors: false
          }),
          0o644
        ),
      error: /executable legacy adapter is not allowed: core.mjs/
    },
    {
      name: 'executable adapter missing realpath guard',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'cli.mjs',
          [
            '#!/usr/bin/env node',
            "import { realpathSync } from 'node:fs';",
            "import { fileURLToPath } from 'node:url';",
            "import { runEngineCli } from '@mcp/engine/cli';",
            '',
            explicitForward('@mcp/engine/cli', ['runEngineCli']).trimEnd(),
            '',
            'if (isMainModule()) {',
            '  process.exitCode = await runEngineCli();',
            '}',
            ''
          ].join('\n'),
          0o755
        ),
      error: /missing the realpath main guard: cli.mjs/
    },
    {
      name: 'executable adapter undeclared runner',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'cli.mjs',
          guardedExecutableAdapter({
            canonicalPackage: '@mcp/engine/cli',
            runner: 'runCookieCli',
            catchesErrors: false
          }),
          0o755
        ),
      error: /runner is undeclared: cli.mjs/
    },
    {
      name: 'executable adapter calls its runner more than once',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'cli.mjs',
          guardedExecutableAdapter(executableAdapters[2]).replace(
            '  process.exitCode = await runEngineCli();\n}\n',
            '  process.exitCode = await runEngineCli();\n  await runEngineCli();\n}\n'
          ),
          0o755
        ),
      error: /must call exactly one declared runner: cli.mjs/
    },
    {
      name: 'executable adapter wrong mode',
      mutate: async ({ adapterRoot }) => fs.chmod(path.join(adapterRoot, 'cli.mjs'), 0o644),
      error: /legacy adapter file mismatch: cli.mjs/
    },
    {
      name: 'executable adapter unexpected Node builtin',
      mutate: async ({ adapterRoot }) =>
        writeAdapter(
          adapterRoot,
          'cli.mjs',
          guardedExecutableAdapter(executableAdapters[2]).replace(
            "import { fileURLToPath } from 'node:url';\n",
            "import { fileURLToPath } from 'node:url';\nimport { execFile } from 'node:child_process';\n"
          ),
          0o755
        ),
      error: /unexpected Node builtin: cli.mjs/
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const fixture = await materializeFixture(t);
      await scenario.mutate(fixture);
      await assert.rejects(
        verifyLiveRelocation({ repoRoot: fixture.root, fixtureRoot: fixture.fixtureRoot }),
        scenario.error
      );
    });
  }
});
