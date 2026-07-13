import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(mcpRoot, 'package.json'), 'utf8'));
const repositoryRoot = path.resolve(mcpRoot, '..');
const rootManifest = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
);
const workspaceManifests = await Promise.all(
  [
    ['@mcp/engine', path.join(repositoryRoot, 'packages', 'mcp-engine', 'package.json')],
    ['@mcp/server', path.join(repositoryRoot, 'packages', 'mcp-server', 'package.json')],
    ['@alpoxdev/hyper-cloaking', path.join(mcpRoot, 'package.json')]
  ].map(async ([name, manifestPath]) => ({
    name,
    manifest: JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  }))
);

const engineAdapters = Object.freeze({
  './engine/browser-utils.mjs': '@mcp/engine/browser-utils',
  './engine/cli.mjs': '@mcp/engine/cli',
  './engine/config.mjs': '@mcp/engine/config',
  './engine/cookie.mjs': '@mcp/engine/cookie',
  './engine/credentials.mjs': '@mcp/engine/credentials',
  './engine/target-safety.mjs': '@mcp/engine/target-safety',
  './engine/outcome.mjs': '@mcp/engine/outcome',
  './engine/diagnostics.mjs': '@mcp/engine/diagnostics',
  './engine/evidence-boundary.mjs': '@mcp/engine/evidence-boundary',
  './engine/recon-scope.mjs': '@mcp/engine/recon-scope',
  './engine/run-shapes.mjs': '@mcp/engine/run-shapes',
  './engine/action-runtime/action-result.mjs': '@mcp/engine/action-runtime/action-result',
  './engine/action-runtime/guardrails.mjs': '@mcp/engine/action-runtime/guardrails',
  './engine/providers/index.mjs': '@mcp/engine/providers',
  './engine/providers/instagram/index.mjs': '@mcp/engine/providers/instagram',
  './engine/providers/naver/index.mjs': '@mcp/engine/providers/naver',
  './engine/providers/youtube/index.mjs': '@mcp/engine/providers/youtube',
  './engine/providers/coupang/index.mjs': '@mcp/engine/providers/coupang',
  './engine/providers/tiktok/index.mjs': '@mcp/engine/providers/tiktok',
  './engine/providers/x/index.mjs': '@mcp/engine/providers/x',
  './engine/agents/parent-dispatcher.mjs': '@mcp/engine/agents/parent-dispatcher',
  './engine/agents/parent-verify.mjs': '@mcp/engine/agents/parent-verify'
});

const bins = Object.freeze({
  'hyper-cloaking-mcp': './dist/server.mjs',
  'hyper-cloaking-engine': './engine/cli.mjs',
  'hyper-cloaking-browser-utils': './engine/browser-utils.mjs',
  'hyper-cloaking-cookie': './engine/cookie.mjs',
  'hyper-cloaking-parent-dispatcher': './engine/agents/parent-dispatcher.mjs'
});

const executableAdapters = Object.freeze({
  './engine/cli.mjs': 'runEngineCli',
  './engine/browser-utils.mjs': 'runBrowserUtilsCli',
  './engine/cookie.mjs': 'runCookieCli',
  './engine/agents/parent-dispatcher.mjs': 'runParentDispatcher'
});
const validBuildCommand = 'node scripts/build.mjs';
const validTestCommand = [
  'node --test',
  'test/legacy-compat.contract.test.mjs',
  'test/engine-relocation-v1-historical.contract.test.mjs',
  'test/engine-relocation-v2.contract.test.mjs',
  'test/register.contract.test.mjs',
  'test/package-consumer.contract.test.mjs'
].join(' ');

function localModulePath(packageTarget) {
  return new URL(`../${packageTarget.slice(2)}`, import.meta.url);
}

function runExecutable(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
}

function runModuleImport(file) {
  const source = `await import(${JSON.stringify(pathToFileURL(file).href)});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
}

test('legacy manifest is finite and retains its explicit public surface', async () => {
  assert.equal(manifest.name, '@alpoxdev/hyper-cloaking');
  assert.equal(manifest.version, '1.0.0');
  assert.deepEqual(manifest.files, ['dist', 'engine', 'register.mjs']);
  assert.deepEqual(manifest.bin, bins);
  assert.equal(
    Object.hasOwn(manifest, 'dependencies'),
    false,
    'legacy manifest has no runtime dependencies that could trigger registry resolution'
  );
  assert.deepEqual(manifest.peerDependencies, {
    '@mcp/engine': '^1.0.0',
    '@mcp/server': '^1.0.0'
  });
  assert.deepEqual(manifest.peerDependenciesMeta, {
    '@mcp/engine': { optional: true },
    '@mcp/server': { optional: true }
  });
  assert.deepEqual(manifest.scripts, { build: validBuildCommand, test: validTestCommand });
  assert.equal(Object.hasOwn(manifest, 'devDependencies'), false);
  assert.equal(manifest.private, true);
  assert.equal(
    Object.keys(manifest.exports).some((specifier) => specifier.includes('*')),
    false,
    'legacy exports never widen to a wildcard'
  );

  const expectedExports = ['.', './package.json', './register', ...Object.keys(engineAdapters)];
  assert.deepEqual(Object.keys(manifest.exports), expectedExports);
  for (const [specifier, target] of Object.entries(manifest.exports)) {
    if (specifier === './package.json') continue;
    const targetPath = path.join(mcpRoot, target.slice(2));
    await fs.access(targetPath);
  }

  for (const [binName, target] of Object.entries(bins)) {
    const mode = (await fs.stat(path.join(mcpRoot, target.slice(2)))).mode;
    assert.equal(mode & 0o111, 0o111, `${binName} entry is executable`);
  }
});
test('workspace manifests fail closed against registry publication', () => {
  assert.deepEqual(rootManifest.workspaces, ['packages/mcp-engine', 'packages/mcp-server', 'mcp']);
  assert.equal(rootManifest.private, true);
  assert.equal(
    rootManifest.scripts.build,
    'npm --workspace packages/mcp-engine run build && npm --workspace packages/mcp-server run build && npm --workspace mcp run build'
  );
  assert.equal(
    Object.keys(rootManifest.scripts).some((scriptName) =>
      scriptName.toLowerCase().includes('publish')
    ),
    false,
    'repository root has no publish lifecycle script'
  );

  for (const { name, manifest: workspaceManifest } of workspaceManifests) {
    assert.equal(workspaceManifest.name, name);
    assert.equal(workspaceManifest.private, true, `${name} blocks registry publication`);
    assert.equal(
      Object.hasOwn(workspaceManifest, 'publishConfig'),
      false,
      `${name} has no publish config`
    );
    assert.equal(
      Object.keys(workspaceManifest.scripts ?? {}).some((scriptName) =>
        scriptName.toLowerCase().includes('publish')
      ),
      false,
      `${name} has no publish lifecycle script`
    );
  }
});

test('clean legacy build recreates the generated server entrypoint', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-legacy-build-'));
  const fixtureMcpRoot = path.join(fixtureRoot, 'mcp');
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  await fs.mkdir(fixtureMcpRoot, { recursive: true });
  await Promise.all([
    fs.cp(path.join(mcpRoot, 'compat'), path.join(fixtureMcpRoot, 'compat'), { recursive: true }),
    fs.cp(path.join(mcpRoot, 'scripts'), path.join(fixtureMcpRoot, 'scripts'), { recursive: true })
  ]);

  const sourceEntrypoint = path.join(fixtureMcpRoot, 'compat', 'server.mjs');
  const distributionEntrypoint = path.join(fixtureMcpRoot, 'dist', 'server.mjs');
  const source = await fs.readFile(sourceEntrypoint, 'utf8');
  const result = await runExecutable(path.join(fixtureMcpRoot, 'scripts', 'build.mjs'), []);

  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.output, '');
  assert.equal(await fs.readFile(distributionEntrypoint, 'utf8'), source);
  assert.equal((await fs.stat(distributionEntrypoint)).mode & 0o111, 0o111);
});

test('legacy adapters delegate only to declared public canonical packages', async () => {
  for (const [legacySpecifier, canonicalSpecifier] of Object.entries(engineAdapters)) {
    const source = await fs.readFile(localModulePath(legacySpecifier), 'utf8');
    assert.match(
      source,
      new RegExp(`['\"]${canonicalSpecifier}['\"]`),
      `${legacySpecifier} delegates to its declared canonical target`
    );
    assert.doesNotMatch(source, /packages\/|\/src\/|export \*/);
  }

  const serverSource = await fs.readFile(path.join(mcpRoot, 'compat', 'server.mjs'), 'utf8');
  assert.match(serverSource, /from '@mcp\/server'/);
  assert.doesNotMatch(serverSource, /packages\/|\/src\/|export \*/);
});

test('legacy executable adapters retain realpath-safe, inert-import CLI guards', async () => {
  for (const [legacySpecifier, runner] of Object.entries(executableAdapters)) {
    const source = await fs.readFile(localModulePath(legacySpecifier), 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env node\n/);
    assert.match(
      source,
      /realpathSync\(process\.argv\[1\]\) === realpathSync\(fileURLToPath\(import\.meta\.url\)\)/
    );
    assert.match(source, new RegExp(`await ${runner}`));
  }

  const serverSource = await fs.readFile(path.join(mcpRoot, 'compat', 'server.mjs'), 'utf8');
  assert.match(serverSource, /^#!\/usr\/bin\/env node\n/);
  assert.match(serverSource, /hyper-cloaking-mcp failed to start:/);
});

test('legacy bin-like symlinks execute the canonical CLI contracts', async (t) => {
  const binRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-legacy-bin-'));
  t.after(() => fs.rm(binRoot, { recursive: true, force: true }));

  for (const [legacySpecifier, runner] of Object.entries(executableAdapters)) {
    const entry = fileURLToPath(localModulePath(legacySpecifier));
    const bin = path.join(binRoot, path.basename(entry));
    await fs.symlink(entry, bin);
    const result = await runExecutable(bin, runner === 'runParentDispatcher' ? [] : ['--help']);
    assert.equal(result.signal, null, `${legacySpecifier} does not terminate by signal`);
    assert.equal(result.code, runner === 'runParentDispatcher' ? 2 : 0);
    assert.match(result.output, /Usage:/);
  }
});

test('legacy wrapper imports do not invoke canonical CLIs', async () => {
  for (const legacySpecifier of Object.keys(executableAdapters)) {
    const result = await runModuleImport(fileURLToPath(localModulePath(legacySpecifier)));
    assert.equal(result.signal, null, `${legacySpecifier} import does not terminate by signal`);
    assert.equal(result.code, 0, `${legacySpecifier} import succeeds`);
    assert.equal(result.output, '', `${legacySpecifier} import has no CLI output`);
  }
});

test('legacy imports preserve canonical public identities', async () => {
  for (const [legacySpecifier, canonicalSpecifier] of Object.entries(engineAdapters)) {
    const legacyModule = await import(localModulePath(legacySpecifier));
    const canonicalModule = await import(canonicalSpecifier);
    assert.deepEqual(
      Object.keys(legacyModule).sort(),
      Object.keys(canonicalModule).sort(),
      `${legacySpecifier} preserves the canonical export set`
    );
    for (const exportName of Object.keys(canonicalModule)) {
      assert.strictEqual(
        legacyModule[exportName],
        canonicalModule[exportName],
        `${legacySpecifier} delegates ${exportName}`
      );
    }
  }
});

test('legacy server and registration delegate to the consumer-local server entry', async () => {
  const legacyServer = await import(new URL('../dist/server.mjs', import.meta.url));
  const canonicalServer = await import('@mcp/server');
  assert.deepEqual(Object.keys(legacyServer).sort(), ['SERVER_INFO', 'createServer', 'main']);
  for (const exportName of Object.keys(legacyServer)) {
    assert.strictEqual(legacyServer[exportName], canonicalServer[exportName]);
  }

  const { serverCommand } = await import(new URL('../register.mjs', import.meta.url));
  const command = serverCommand();
  assert.equal(command.command, process.execPath);
  assert.equal(command.args.length, 1);
  assert.equal(command.args[0], fileURLToPath(new URL('../dist/server.mjs', import.meta.url)));
  assert.equal(path.relative(mcpRoot, command.args[0]), path.join('dist', 'server.mjs'));
});
