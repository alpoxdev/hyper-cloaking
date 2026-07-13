import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  OUTER_PACKAGE_POLICY,
  assertOuterPackagePolicy,
  verifyRelocation
} from '../../scripts/engine-relocation-manifest.mjs';

const packageName = '@alpoxdev/hyper-cloaking';
const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../..');
const mcpRoot = path.join(repositoryRoot, 'mcp');
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
  'NPM_CONFIG_WORKSPACES',
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

function consumerEnvironment({ home, cache, userConfig }) {
  const environment = {
    ...process.env,
    HOME: home,
    npm_config_cache: cache,
    npm_config_userconfig: userConfig,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_USERCONFIG: userConfig
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

function packageProbeSource(allowedExports) {
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
    browserDependencies,
    registeredServerCommand,
    rejected
  })
);
`;
}

test(
  'packed MCP installs as an isolated consumer with only curated exports and entry points',
  { timeout: 120_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-package-consumer-'));
    const packDirectory = path.join(root, 'pack');
    const consumerRoot = path.join(root, 'consumer');
    const home = path.join(root, 'home');
    const cache = path.join(root, 'npm-cache');
    const userConfig = path.join(root, 'npmrc');
    const environment = consumerEnvironment({ home, cache, userConfig });
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    assert.equal(
      isWithin(repositoryRoot, root),
      false,
      'consumer workspace must be outside the worktree'
    );
    await Promise.all([
      fs.mkdir(packDirectory, { recursive: true }),
      fs.mkdir(consumerRoot, { recursive: true }),
      fs.mkdir(home, { recursive: true }),
      fs.mkdir(cache, { recursive: true })
    ]);
    await Promise.all([
      fs.writeFile(userConfig, ''),
      fs.writeFile(path.join(consumerRoot, 'package.json'), '{"private":true,"type":"module"}\n')
    ]);

    const packed = await runChecked(
      npmCommand,
      ['pack', '--json', '--pack-destination', packDirectory],
      { cwd: mcpRoot, env: environment }
    );
    const [tarball] = JSON.parse(packed.stdout);
    assert.equal(
      typeof tarball?.filename,
      'string',
      'npm pack reports the emitted tarball filename'
    );
    const tarballPath = path.join(packDirectory, tarball.filename);
    await fs.access(tarballPath);

    await runChecked(
      npmCommand,
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarballPath
      ],
      { cwd: consumerRoot, env: environment }
    );

    const consumerModules = path.join(consumerRoot, 'node_modules');
    const installedRoot = path.join(consumerModules, '@alpoxdev', 'hyper-cloaking');
    const realInstalledRoot = await realpathInside(
      consumerModules,
      installedRoot,
      'installed package'
    );
    assert.notEqual(
      realInstalledRoot,
      await fs.realpath(mcpRoot),
      'consumer must not resolve to the worktree package'
    );
    await realpathInside(
      consumerModules,
      path.join(installedRoot, 'dist', 'server.mjs'),
      'installed server entry'
    );
    await realpathInside(
      consumerModules,
      path.join(installedRoot, 'engine', 'cli.mjs'),
      'installed engine entry'
    );

    const installedManifest = JSON.parse(
      await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8')
    );
    assert.equal(installedManifest.name, packageName);
    assertOuterPackagePolicy(installedManifest);
    assert.deepEqual(
      installedManifest.exports,
      OUTER_PACKAGE_POLICY.exports,
      'installed package keeps its curated exports'
    );
    assert.deepEqual(
      installedManifest.bin,
      OUTER_PACKAGE_POLICY.bin,
      'installed package keeps all five bin entries'
    );
    assert.equal(
      Object.hasOwn(installedManifest.dependencies || {}, 'hyper-cloaking-engine'),
      false
    );

    const ledger = await verifyRelocation({ repoRoot: repositoryRoot, tarballRoot: installedRoot });
    assert.equal(
      ledger.tarballVerified,
      true,
      'relocation ledger verifies the installed tarball engine'
    );
    assert.ok(ledger.entries > 0, 'relocation ledger includes engine entries');

    const allowedExports = Object.keys(OUTER_PACKAGE_POLICY.exports)
      .filter((entry) => entry !== './package.json')
      .map((entry) => (entry === '.' ? packageName : `${packageName}${entry.slice(1)}`));
    const probePath = path.join(consumerRoot, 'package-probe.mjs');
    await fs.writeFile(probePath, packageProbeSource(allowedExports));
    const probe = await runChecked(process.execPath, [probePath], {
      cwd: consumerRoot,
      env: environment
    });
    const probeResult = JSON.parse(probe.stdout);
    assert.deepEqual(Object.keys(probeResult.resolvedExports).sort(), [...allowedExports].sort());
    for (const [specifier, resolved] of Object.entries(probeResult.resolvedExports)) {
      await realpathInside(consumerModules, resolved, `${specifier} export`);
    }
    for (const [specifier, resolved] of Object.entries(probeResult.browserDependencies)) {
      await realpathInside(consumerModules, resolved, `${specifier} external dependency`);
    }
    assert.equal(probeResult.registeredServerCommand.command, process.execPath);
    assert.equal(
      await fs.realpath(probeResult.registeredServerCommand.args[0]),
      await fs.realpath(path.join(installedRoot, 'dist', 'server.mjs'))
    );
    await fs.access(probeResult.registeredServerCommand.args[0]);
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

    for (const [binName, entry] of Object.entries(OUTER_PACKAGE_POLICY.bin)) {
      if (!entry.startsWith('./engine/')) continue;
      const binPath = path.join(consumerModules, '.bin', binName);
      const entryPath = path.join(installedRoot, entry.slice(2));
      assert.equal(
        await fs.realpath(binPath),
        await fs.realpath(entryPath),
        `${binName} bin targets the installed engine entry`
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
      await fs.realpath(path.join(installedRoot, 'dist', 'server.mjs')),
      'installed MCP bin targets the installed server entry'
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
