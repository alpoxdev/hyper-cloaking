import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageName = '@alpoxdev/hyper-cloaking';
const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../..');
const mcpRoot = path.join(repositoryRoot, 'mcp');
const canonicalPackages = Object.freeze({
  engine: {
    name: '@mcp/engine',
    root: path.join(repositoryRoot, 'packages', 'mcp-engine')
  },
  server: {
    name: '@mcp/server',
    root: path.join(repositoryRoot, 'packages', 'mcp-server')
  }
});
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workspaceEnvironmentKeys = [
  'INIT_CWD',
  'NODE_PATH',
  'PWD',
  'npm_config_global',
  'npm_config_include_workspace_root',
  'npm_config_local_prefix',
  'npm_config_prefix',
  'npm_config_workspace',
  'npm_config_workspaces',
  'npm_config_workspaces_update',
  'NPM_CONFIG_GLOBAL',
  'NPM_CONFIG_INCLUDE_WORKSPACE_ROOT',
  'NPM_CONFIG_LOCAL_PREFIX',
  'NPM_CONFIG_PREFIX',
  'NPM_CONFIG_WORKSPACE',
  'NPM_CONFIG_WORKSPACES_UPDATE'
];
const expectedToolNames = [
  'cloak_click',
  'cloak_cookies_list',
  'cloak_cookies_status',
  'cloak_credentials',
  'cloak_launch',
  'cloak_navigate',
  'cloak_provider_capabilities',
  'cloak_provider_read',
  'cloak_provider_write',
  'cloak_screenshot',
  'cloak_scroll',
  'cloak_setup',
  'cloak_snapshot',
  'cloak_status',
  'cloak_teardown',
  'cloak_type'
];

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function consumerEnvironment(overrides = {}) {
  const environment = {
    ...process.env,
    ...overrides,
    npm_config_offline: 'true',
    NPM_CONFIG_OFFLINE: 'true'
  };
  for (const key of workspaceEnvironmentKeys) delete environment[key];
  return environment;
}

async function run(command, args, { cwd, env, input = null }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
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
    child.stdin.end(input ?? undefined);
  });
}

async function runChecked(command, args, options) {
  const result = await run(command, args, options);
  assert.equal(
    result.code,
    0,
    `${command} ${args.join(' ')} failed (signal: ${result.signal || 'none'}):\n${result.stderr || result.stdout}`
  );
  return result;
}

async function packLocalPackage(root, packDirectory, environment) {
  const packed = await runChecked(
    npmCommand,
    ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', packDirectory],
    { cwd: root, env: environment }
  );
  const [tarball] = JSON.parse(packed.stdout);
  assert.equal(typeof tarball?.filename, 'string', 'npm pack reports an emitted tarball filename');
  assert.ok(Array.isArray(tarball.files), 'npm pack reports the tarball file inventory');
  const tarballPath = path.join(packDirectory, tarball.filename);
  await fs.access(tarballPath);
  return {
    files: tarball.files.map(({ path: filePath }) => filePath).sort(),
    path: tarballPath
  };
}

async function realpathInside(parent, child, label) {
  const realParent = await fs.realpath(parent);
  const realChild = await fs.realpath(child);
  assert.equal(
    isWithin(realParent, realChild),
    true,
    `${label} must resolve inside consumer node_modules`
  );
  return realChild;
}

function localTarballSpecifier(consumerRoot, tarballPath) {
  return `file:${path.relative(consumerRoot, tarballPath)}`;
}
const installedPackageNames = Object.freeze({
  engine: canonicalPackages.engine.name,
  server: canonicalPackages.server.name,
  legacy: packageName
});

function installedPackageRoot(consumerModules, packageKey) {
  return path.join(consumerModules, ...installedPackageNames[packageKey].split('/'));
}

async function writeConsumerManifest(consumerRoot, name, dependencies) {
  await fs.writeFile(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify({ name, private: true, type: 'module', dependencies }, null, 2)}\n`
  );
}

async function installLocalTopology({ root, name, dependencies, installed, environment }) {
  const consumerRoot = path.join(root, name);
  await fs.mkdir(consumerRoot, { recursive: true });
  await writeConsumerManifest(consumerRoot, name, dependencies);
  await runChecked(
    npmCommand,
    ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: consumerRoot, env: environment }
  );

  const consumerModules = path.join(consumerRoot, 'node_modules');
  for (const packageKey of installed) {
    const packageRoot = await realpathInside(
      consumerModules,
      installedPackageRoot(consumerModules, packageKey),
      `${name} installed ${packageKey} package`
    );
    const installedManifest = JSON.parse(
      await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')
    );
    assert.equal(
      installedManifest.name,
      installedPackageNames[packageKey],
      `${name} installed the expected ${packageKey} tarball`
    );
  }
  for (const packageKey of Object.keys(installedPackageNames)) {
    if (installed.includes(packageKey)) continue;
    await assert.rejects(
      fs.access(installedPackageRoot(consumerModules, packageKey)),
      { code: 'ENOENT' },
      `${name} does not install ${packageKey}`
    );
  }
  return consumerRoot;
}

async function assertLegacyTarballInventory(tarball) {
  const legacyManifest = JSON.parse(await fs.readFile(path.join(mcpRoot, 'package.json'), 'utf8'));
  const expectedFiles = new Set(['package.json']);
  for (const entry of [
    legacyManifest.main,
    ...Object.values(legacyManifest.bin),
    ...Object.values(legacyManifest.exports)
  ]) {
    assert.match(entry, /^\.\//, `legacy package entry is package-relative: ${entry}`);
    expectedFiles.add(entry.slice(2));
  }

  assert.deepEqual(
    tarball.files,
    [...expectedFiles].sort(),
    'legacy tarball contains only its manifest, server adapter, registration helper, and declared engine adapters'
  );
  assert.equal(
    tarball.files.some((file) =>
      /^(?:src|test|scripts)\/|^dist\/(?:engine|src|test|scripts)\//.test(file)
    ),
    false,
    'legacy tarball contains no raw source or duplicate canonical engine payload'
  );
}

function packageProbeSource(allowedExports, canonicalSpecifiers) {
  return `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  compileAgentEnvelopeValidator,
  verifyAgentEnvelope
} from '${packageName}/engine/agents/parent-verify.mjs';
import {
  generateServerRegistration,
  serverCommand
} from '${packageName}/register';

const allowedExports = ${JSON.stringify(allowedExports)};
const canonicalSpecifiers = ${JSON.stringify(canonicalSpecifiers)};
const unavailableExports = [
  '${packageName}/engine/providers/network.mjs',
  '${packageName}/engine/agents/setup-agent.mjs',
  'hyper-cloaking-engine'
];
const resolvedExports = {};
for (const specifier of allowedExports) {
  resolvedExports[specifier] = fileURLToPath(import.meta.resolve(specifier));
  await import(specifier);
}
const canonicalResolved = {};
for (const specifier of canonicalSpecifiers) {
  canonicalResolved[specifier] = fileURLToPath(import.meta.resolve(specifier));
  await import(specifier);
}

const legacyServer = await import('${packageName}');
const canonicalServer = await import('@mcp/server');
for (const exportName of ['SERVER_INFO', 'createServer', 'main']) {
  if (legacyServer[exportName] !== canonicalServer[exportName]) {
    throw new Error(\`legacy server did not delegate \${exportName} to @mcp/server\`);
  }
}

const registeredServerCommand = serverCommand();
const installedServerPath = fileURLToPath(import.meta.resolve('${packageName}'));
if (
  registeredServerCommand.command !== process.execPath ||
  registeredServerCommand.args.length !== 1 ||
  registeredServerCommand.args[0] !== installedServerPath ||
  !existsSync(installedServerPath)
) {
  throw new Error('installed registration default did not resolve the installed dist/server.mjs');
}
const directRegistration = generateServerRegistration('direct');
if (
  JSON.stringify(directRegistration.command) !==
  JSON.stringify([registeredServerCommand.command, ...registeredServerCommand.args])
) {
  throw new Error('installed registration renderer did not use its default server command');
}

const browserDependencies = {};
for (const specifier of ['cloakbrowser', 'playwright-core']) {
  browserDependencies[specifier] = fileURLToPath(import.meta.resolve(specifier));
}

const validate = compileAgentEnvelopeValidator();
if (validate({}) !== false || !Array.isArray(validate.errors) || validate.errors.length === 0) {
  throw new Error('installed parent verifier did not compile and execute AJV validation');
}
const invalidEnvelope = verifyAgentEnvelope({}, { validate });
if (invalidEnvelope.ok || invalidEnvelope.verifierCode !== 'missing-required') {
  throw new Error('installed parent verifier did not report the AJV schema failure');
}

const rejected = [];
for (const specifier of unavailableExports) {
  try {
    await import(specifier);
  } catch (error) {
    rejected.push({ specifier, code: error?.code || null });
    continue;
  }
  throw new Error(\`unavailable package specifier loaded: \${specifier}\`);
}

process.stdout.write(
  JSON.stringify({
    resolvedExports,
    canonicalResolved,
    browserDependencies,
    registeredServerCommand,
    rejected
  })
);
`;
}
function missingCanonicalPeerProbeSource() {
  return `
const specifiers = ['@mcp/engine', '@mcp/server', '${packageName}'];
const failures = [];
for (const specifier of specifiers) {
  try {
    await import(specifier);
  } catch (error) {
    failures.push({
      code: error?.code ?? null,
      message: error?.message ?? '',
      specifier
    });
    continue;
  }
  throw new Error(\`lone legacy consumer unexpectedly resolved \${specifier}\`);
}
process.stdout.write(JSON.stringify(failures));
`;
}

test(
  'isolated offline local-tarball topology matrix assembles canonical and legacy packages',
  { timeout: 120_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-topology-matrix-'));
    const packDirectory = path.join(root, 'pack');
    const environment = consumerEnvironment();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    assert.equal(
      isWithin(repositoryRoot, root),
      false,
      'topology consumers stay outside the worktree'
    );
    await fs.mkdir(packDirectory, { recursive: true });
    const engineTarball = await packLocalPackage(
      canonicalPackages.engine.root,
      packDirectory,
      environment
    );
    const serverTarball = await packLocalPackage(
      canonicalPackages.server.root,
      packDirectory,
      environment
    );
    const legacyTarball = await packLocalPackage(mcpRoot, packDirectory, environment);
    await assertLegacyTarballInventory(legacyTarball);

    const loneLegacyEnvironment = consumerEnvironment({
      npm_config_cache: path.join(root, 'empty-npm-cache'),
      NPM_CONFIG_CACHE: path.join(root, 'empty-npm-cache')
    });
    const loneLegacyRoot = await installLocalTopology({
      root,
      name: 'legacy-alone',
      dependencies: {
        [packageName]: localTarballSpecifier(path.join(root, 'legacy-alone'), legacyTarball.path)
      },
      installed: ['legacy'],
      environment: loneLegacyEnvironment
    });
    const loneLegacyProbePath = path.join(loneLegacyRoot, 'missing-canonical-peers.mjs');
    await fs.writeFile(loneLegacyProbePath, missingCanonicalPeerProbeSource());
    const loneLegacyProbe = await runChecked(process.execPath, [loneLegacyProbePath], {
      cwd: loneLegacyRoot,
      env: loneLegacyEnvironment
    });
    const loneLegacyFailures = JSON.parse(loneLegacyProbe.stdout);
    assert.deepEqual(
      loneLegacyFailures.map(({ code, specifier }) => ({ code, specifier })),
      [
        { code: 'ERR_MODULE_NOT_FOUND', specifier: '@mcp/engine' },
        { code: 'ERR_MODULE_NOT_FOUND', specifier: '@mcp/server' },
        { code: 'ERR_MODULE_NOT_FOUND', specifier: packageName }
      ],
      'lone legacy installation leaves canonical peers absent and legacy imports unavailable'
    );
    assert.match(
      loneLegacyFailures[0].message,
      /Cannot find package '@mcp\/engine'/,
      'the missing canonical engine import fails clearly'
    );
    assert.match(
      loneLegacyFailures[1].message,
      /Cannot find package '@mcp\/server'/,
      'the missing canonical server import fails clearly'
    );
    assert.match(
      loneLegacyFailures[2].message,
      /Cannot find package '@mcp\/server'/,
      'the legacy adapter identifies its missing canonical server peer'
    );

    const topologies = [
      {
        name: 'engine-only',
        installed: ['engine'],
        dependencies(consumerRoot) {
          return {
            [canonicalPackages.engine.name]: localTarballSpecifier(consumerRoot, engineTarball.path)
          };
        }
      },
      {
        name: 'server-and-engine',
        installed: ['engine', 'server'],
        dependencies(consumerRoot) {
          return {
            [canonicalPackages.engine.name]: localTarballSpecifier(
              consumerRoot,
              engineTarball.path
            ),
            [canonicalPackages.server.name]: localTarballSpecifier(consumerRoot, serverTarball.path)
          };
        }
      },
      {
        name: 'legacy-with-explicit-local-peers',
        installed: ['engine', 'server', 'legacy'],
        dependencies(consumerRoot) {
          return {
            [canonicalPackages.engine.name]: localTarballSpecifier(
              consumerRoot,
              engineTarball.path
            ),
            [canonicalPackages.server.name]: localTarballSpecifier(
              consumerRoot,
              serverTarball.path
            ),
            [packageName]: localTarballSpecifier(consumerRoot, legacyTarball.path)
          };
        }
      }
    ];

    for (const topology of topologies) {
      await t.test(topology.name, async () => {
        const consumerRoot = path.join(root, topology.name);
        await installLocalTopology({
          root,
          name: topology.name,
          dependencies: topology.dependencies(consumerRoot),
          installed: topology.installed,
          environment
        });
      });
    }
  }
);

test(
  'all-three local tarballs execute the legacy MCP contract without workspace links or registry access',
  { timeout: 120_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-package-consumer-'));
    const packDirectory = path.join(root, 'pack');
    const consumerRoot = path.join(root, 'consumer');
    const environment = consumerEnvironment();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    assert.equal(
      isWithin(repositoryRoot, root),
      false,
      'consumer workspace must be outside the worktree'
    );
    await Promise.all([
      fs.mkdir(packDirectory, { recursive: true }),
      fs.mkdir(consumerRoot, { recursive: true })
    ]);

    const engineTarball = await packLocalPackage(
      canonicalPackages.engine.root,
      packDirectory,
      environment
    );
    const serverTarball = await packLocalPackage(
      canonicalPackages.server.root,
      packDirectory,
      environment
    );
    const legacyTarball = await packLocalPackage(mcpRoot, packDirectory, environment);
    await assertLegacyTarballInventory(legacyTarball);

    await fs.writeFile(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'isolated-hyper-cloaking-consumer',
          private: true,
          type: 'module',
          dependencies: {
            [canonicalPackages.engine.name]: localTarballSpecifier(
              consumerRoot,
              engineTarball.path
            ),
            [canonicalPackages.server.name]: localTarballSpecifier(
              consumerRoot,
              serverTarball.path
            ),
            [packageName]: localTarballSpecifier(consumerRoot, legacyTarball.path)
          }
        },
        null,
        2
      )}\n`
    );

    await runChecked(
      npmCommand,
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false'
      ],
      { cwd: consumerRoot, env: environment }
    );

    const consumerModules = path.join(consumerRoot, 'node_modules');
    const installedRoots = {
      legacy: path.join(consumerModules, '@alpoxdev', 'hyper-cloaking'),
      engine: path.join(consumerModules, '@mcp', 'engine'),
      server: path.join(consumerModules, '@mcp', 'server')
    };
    const [realLegacyRoot, realEngineRoot, realServerRoot] = await Promise.all([
      realpathInside(consumerModules, installedRoots.legacy, 'installed legacy package'),
      realpathInside(consumerModules, installedRoots.engine, 'installed canonical engine'),
      realpathInside(consumerModules, installedRoots.server, 'installed canonical server')
    ]);
    const [sourceLegacyRoot, sourceEngineRoot, sourceServerRoot] = await Promise.all([
      fs.realpath(mcpRoot),
      fs.realpath(canonicalPackages.engine.root),
      fs.realpath(canonicalPackages.server.root)
    ]);
    assert.notEqual(
      realLegacyRoot,
      sourceLegacyRoot,
      'legacy package must not resolve to the worktree'
    );
    assert.notEqual(
      realEngineRoot,
      sourceEngineRoot,
      'engine package must not resolve to the worktree'
    );
    assert.notEqual(
      realServerRoot,
      sourceServerRoot,
      'server package must not resolve to the worktree'
    );
    await Promise.all([
      realpathInside(
        consumerModules,
        path.join(installedRoots.legacy, 'dist', 'server.mjs'),
        'legacy server entry'
      ),
      realpathInside(
        consumerModules,
        path.join(installedRoots.legacy, 'engine', 'cli.mjs'),
        'legacy engine adapter'
      ),
      realpathInside(
        consumerModules,
        path.join(installedRoots.engine, 'dist', 'index.mjs'),
        'canonical engine entry'
      ),
      realpathInside(
        consumerModules,
        path.join(installedRoots.server, 'dist', 'index.mjs'),
        'canonical server entry'
      )
    ]);

    const [installedLegacyManifest, installedEngineManifest, installedServerManifest] =
      await Promise.all(
        Object.values(installedRoots).map(async (installedRoot) =>
          JSON.parse(await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'))
        )
      );
    assert.equal(installedLegacyManifest.name, packageName);
    assert.equal(
      Object.hasOwn(installedLegacyManifest, 'dependencies'),
      false,
      'legacy tarball has no runtime dependencies that could trigger registry resolution'
    );
    assert.deepEqual(installedLegacyManifest.peerDependencies, {
      '@mcp/engine': '^1.0.0',
      '@mcp/server': '^1.0.0'
    });
    assert.deepEqual(installedLegacyManifest.peerDependenciesMeta, {
      '@mcp/engine': { optional: true },
      '@mcp/server': { optional: true }
    });
    assert.equal(installedEngineManifest.name, canonicalPackages.engine.name);
    assert.equal(installedServerManifest.name, canonicalPackages.server.name);
    assert.equal(
      Object.hasOwn(installedLegacyManifest.peerDependencies, 'hyper-cloaking-engine'),
      false,
      'legacy package does not retain the retired engine package peer'
    );

    const allowedExports = Object.keys(installedLegacyManifest.exports)
      .filter((entry) => entry !== './package.json')
      .map((entry) => (entry === '.' ? packageName : `${packageName}${entry.slice(1)}`));
    const canonicalSpecifiers = [
      canonicalPackages.engine.name,
      '@mcp/engine/cli',
      canonicalPackages.server.name
    ];
    const probePath = path.join(consumerRoot, 'package-probe.mjs');
    await fs.writeFile(probePath, packageProbeSource(allowedExports, canonicalSpecifiers));
    const probe = await runChecked(process.execPath, [probePath], {
      cwd: consumerRoot,
      env: environment
    });
    const probeResult = JSON.parse(probe.stdout);
    assert.deepEqual(Object.keys(probeResult.resolvedExports).sort(), [...allowedExports].sort());
    for (const [specifier, resolved] of Object.entries(probeResult.resolvedExports)) {
      await realpathInside(consumerModules, resolved, `${specifier} legacy export`);
    }
    assert.deepEqual(
      Object.keys(probeResult.canonicalResolved).sort(),
      [...canonicalSpecifiers].sort()
    );
    for (const [specifier, resolved] of Object.entries(probeResult.canonicalResolved)) {
      await realpathInside(consumerModules, resolved, `${specifier} canonical export`);
    }
    for (const [specifier, resolved] of Object.entries(probeResult.browserDependencies)) {
      await realpathInside(consumerModules, resolved, `${specifier} external dependency`);
    }
    assert.equal(probeResult.registeredServerCommand.command, process.execPath);
    assert.equal(
      await fs.realpath(probeResult.registeredServerCommand.args[0]),
      await fs.realpath(path.join(installedRoots.legacy, 'dist', 'server.mjs'))
    );
    await realpathInside(
      consumerModules,
      probeResult.registeredServerCommand.args[0],
      'installed registration default server'
    );
    assert.deepEqual(probeResult.rejected, [
      {
        specifier: `${packageName}/engine/providers/network.mjs`,
        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      },
      {
        specifier: `${packageName}/engine/agents/setup-agent.mjs`,
        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      },
      { specifier: 'hyper-cloaking-engine', code: 'ERR_MODULE_NOT_FOUND' }
    ]);

    const engineBins = Object.entries(installedLegacyManifest.bin).filter(([, entry]) =>
      entry.startsWith('./engine/')
    );
    assert.equal(engineBins.length, 4, 'legacy package retains its four engine compatibility bins');
    for (const [binName, entry] of engineBins) {
      const binPath = path.join(consumerModules, '.bin', binName);
      const entryPath = path.join(installedRoots.legacy, entry.slice(2));
      assert.equal(
        await fs.realpath(binPath),
        await fs.realpath(entryPath),
        `${binName} bin targets the installed engine adapter`
      );
      const argumentsForEntry = binName === 'hyper-cloaking-parent-dispatcher' ? [] : ['--help'];
      const expectedExitCode = binName === 'hyper-cloaking-parent-dispatcher' ? 2 : 0;
      const invokedBin = await run(binPath, argumentsForEntry, {
        cwd: consumerRoot,
        env: environment
      });
      assert.equal(
        invokedBin.code,
        expectedExitCode,
        `${binName} executes through its installed .bin command`
      );
      assert.match(
        `${invokedBin.stdout}${invokedBin.stderr}`,
        /Usage:/,
        `${binName} .bin command reports its command contract`
      );

      const invokedEntry = await run(process.execPath, [entryPath, ...argumentsForEntry], {
        cwd: consumerRoot,
        env: environment
      });
      assert.equal(
        invokedEntry.code,
        expectedExitCode,
        `${binName} direct Node entry preserves its main guard`
      );
      assert.match(
        `${invokedEntry.stdout}${invokedEntry.stderr}`,
        /Usage:/,
        `${binName} direct Node entry reports its command contract`
      );
    }
    const engineBinPath = path.join(consumerModules, '.bin', 'hyper-cloaking-engine');
    const validated = await runChecked(engineBinPath, ['validate', '--json'], {
      cwd: consumerRoot,
      env: environment
    });
    assert.equal(JSON.parse(validated.stdout).ok, true, 'installed engine validates successfully');

    const credentialHome = path.join(root, 'credentials');
    for (const operation of ['init', 'list']) {
      const credentials = await runChecked(
        engineBinPath,
        ['credentials', operation, '--home', credentialHome, '--json'],
        { cwd: consumerRoot, env: environment }
      );
      assert.equal(
        JSON.parse(credentials.stdout).ok,
        true,
        `installed credentials ${operation} succeeds`
      );
    }

    const helperWorkspace = path.join(root, 'engine-workspace');
    const browserInit = await runChecked(
      path.join(consumerModules, '.bin', 'hyper-cloaking-browser-utils'),
      ['init', '--workspace', helperWorkspace, '--json'],
      { cwd: consumerRoot, env: environment }
    );
    assert.equal(
      JSON.parse(browserInit.stdout).ok,
      true,
      'installed browser helper initializes a workspace'
    );
    await fs.writeFile(
      path.join(helperWorkspace, 'cookie.yml'),
      `sites:
  default:
    description: Isolated consumer fixture
    defaultAccount: default
    accounts:
      default:
        label: Default account
        cookies:
          - domain: .example.com
            path: /
            name: placeholder
            value: placeholder
            httpOnly: false
            secure: true
            sameSite: Lax
`
    );
    const cookieInspect = await runChecked(
      path.join(consumerModules, '.bin', 'hyper-cloaking-cookie'),
      ['inspect', '--url', 'https://example.com/', '--workspace', helperWorkspace, '--json'],
      { cwd: consumerRoot, env: environment }
    );
    assert.equal(
      JSON.parse(cookieInspect.stdout).count,
      1,
      'installed cookie helper inspects the controlled workspace fixture'
    );

    const parentRequest = {
      schemaVersion: 1,
      trigger: 'setup',
      executionMode: 'parent',
      input: {
        schemaVersion: 1,
        client: 'direct',
        workspace: path.join(root, 'parent-workspace'),
        headless: true,
        sandbox: true
      },
      evidence: { enabled: false }
    };
    const dispatcher = await run(
      path.join(consumerModules, '.bin', 'hyper-cloaking-parent-dispatcher'),
      ['--input-stdin', '--json'],
      {
        cwd: consumerRoot,
        env: environment,
        input: `${JSON.stringify(parentRequest)}\n`
      }
    );
    assert.ok([0, 1].includes(dispatcher.code), 'installed dispatcher returns a contract result');
    const dispatcherResult = JSON.parse(dispatcher.stdout);
    assert.equal(dispatcherResult.schemaVersion, 1);
    assert.equal(dispatcherResult.route, 'parent_default');
    assert.ok(['succeeded', 'blocked'].includes(dispatcherResult.status));

    const mcpBinPath = path.join(consumerModules, '.bin', 'hyper-cloaking-mcp');
    assert.equal(
      await fs.realpath(mcpBinPath),
      await fs.realpath(path.join(installedRoots.legacy, 'dist', 'server.mjs')),
      'installed MCP bin targets the installed server adapter'
    );
    const transport = new StdioClientTransport({
      command: mcpBinPath,
      args: [],
      cwd: consumerRoot,
      env: environment,
      stderr: 'pipe'
    });
    const client = new Client({ name: 'installed-package-test', version: '0.0.0' });
    await client.connect(transport);
    try {
      const capabilities = client.getServerCapabilities();
      assert.ok(capabilities?.tools, 'installed MCP advertises tools');
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        expectedToolNames,
        'installed MCP preserves the 16-tool contract'
      );
      for (const tool of tools)
        assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has an object input schema`);
      assert.equal(client.getServerVersion()?.name, 'hyper-cloaking-mcp');
    } finally {
      await client.close().catch(() => {});
    }
  }
);
