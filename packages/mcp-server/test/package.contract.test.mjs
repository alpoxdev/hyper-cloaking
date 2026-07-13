import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const expectedExports = ['SERVER_INFO', 'createServer', 'main'];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function packEnvironment() {
  const environment = {
    ...process.env,
    npm_config_offline: 'true',
    NPM_CONFIG_OFFLINE: 'true'
  };
  for (const key of [
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
  ]) {
    delete environment[key];
  }
  return environment;
}

async function packInventory(packDirectory) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      npmCommand,
      ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', packDirectory],
      {
        cwd: packageRoot,
        env: packEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
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
  assert.equal(
    result.code,
    0,
    `npm pack failed (signal: ${result.signal || 'none'}):\n${result.stderr || result.stdout}`
  );
  const [tarball] = JSON.parse(result.stdout);
  assert.equal(typeof tarball?.filename, 'string', 'npm pack reports an emitted tarball');
  assert.ok(Array.isArray(tarball.files), 'npm pack reports the tarball file inventory');
  return tarball.files.map(({ path: filePath }) => filePath).sort();
}

function isEngineSpecifier(specifier) {
  return specifier === '@mcp/engine' || specifier.startsWith('@mcp/engine/');
}

function assertSafeEngineSpecifier(specifier, mechanism, file) {
  assert.doesNotMatch(
    specifier,
    /^(?:@alpoxdev\/hyper-cloaking|hyper-cloaking-engine)(?:\/|$)/,
    `${file} ${mechanism} cannot target a legacy package`
  );
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    assert.doesNotMatch(
      specifier,
      /(?:^|\/)engine(?:\/|$)/,
      `${file} ${mechanism} cannot target an engine directory by relative path`
    );
  }
  assert.doesNotMatch(
    specifier,
    /(?:^|\/)(?:mcp|mcp-engine|hyper-cloaking)\/(?:src|dist|engine)(?:\/|$)/,
    `${file} ${mechanism} cannot target raw engine source`
  );
  if (isEngineSpecifier(specifier)) {
    assert.ok(
      expectedEngineImports.has(specifier),
      `${file} ${mechanism} must use an exported engine specifier, not ${specifier}`
    );
  }
}

const moduleSpecifierPatterns = [
  ['static import', /\bfrom\s*['"]([^'"]+)['"]/g],
  ['side-effect import', /\bimport\s*['"]([^'"]+)['"]/g],
  ['dynamic import()', /\bimport\s*\(\s*['"]([^'"]+)['"]/g],
  ['import.meta.resolve()', /\bimport\.meta\.resolve\s*\(\s*['"]([^'"]+)['"]/g],
  ['direct createRequire()', /\bcreateRequire\s*\([^)]*\)\s*\(\s*['"]([^'"]+)['"]/g]
];

function sourceModuleSpecifiers(source) {
  const specifiers = moduleSpecifierPatterns.flatMap(([mechanism, pattern]) =>
    [...source.matchAll(pattern)].map((match) => ({ mechanism, specifier: match[1] }))
  );
  for (const binding of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createRequire\s*\(/g
  )) {
    const requirePattern = new RegExp(`\\b${binding[1]}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    specifiers.push(
      ...[...source.matchAll(requirePattern)].map((match) => ({
        mechanism: 'createRequire() binding',
        specifier: match[1]
      }))
    );
  }
  return specifiers;
}
const expectedToolNames = [
  'cloak_setup',
  'cloak_status',
  'cloak_cookies_list',
  'cloak_cookies_status',
  'cloak_provider_capabilities',
  'cloak_launch',
  'cloak_teardown',
  'cloak_navigate',
  'cloak_snapshot',
  'cloak_click',
  'cloak_type',
  'cloak_scroll',
  'cloak_screenshot',
  'cloak_provider_read',
  'cloak_provider_write',
  'cloak_credentials'
];
const expectedEngineImports = new Set([
  '@mcp/engine',
  '@mcp/engine/browser-utils',
  '@mcp/engine/providers',
  '@mcp/engine/providers/instagram',
  '@mcp/engine/providers/naver',
  '@mcp/engine/providers/youtube',
  '@mcp/engine/providers/coupang',
  '@mcp/engine/providers/tiktok',
  '@mcp/engine/providers/x'
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      return entry.name.endsWith('.mjs') ? [entryPath] : [];
    })
  );
  return files.flat();
}
test(
  'packed server inventory contains only its built payload and no engine copy',
  { timeout: 30_000 },
  async (t) => {
    const packDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-server-pack-'));
    t.after(() => rm(packDirectory, { recursive: true, force: true }));

    const files = await packInventory(packDirectory);
    assert.ok(files.includes('package.json'), 'server tarball includes its manifest');
    assert.ok(files.includes('dist/index.mjs'), 'server tarball includes its root export');
    for (const file of files) {
      assert.match(
        file,
        /^(?:package\.json|dist\/)/,
        `server tarball contains only its manifest and built distribution: ${file}`
      );
    }
    assert.equal(
      files.some((file) =>
        /^(?:src|test|scripts)\/|^dist\/(?:src|test|scripts|engine|mcp-engine)\//.test(file)
      ),
      false,
      'server tarball does not contain raw source, tests, or a copied canonical engine payload'
    );
  }
);

test('CLI import is inert and re-exports the application API', async () => {
  const app = await import(new URL('../src/app.mjs', import.meta.url));
  const cli = await import(new URL('../src/cli.mjs', import.meta.url));

  assert.deepEqual(Object.keys(cli).sort(), expectedExports);
  for (const name of expectedExports) assert.strictEqual(cli[name], app[name]);
});

test('package root export leaves legacy command ownership external', async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const app = await import(new URL('../src/app.mjs', import.meta.url));

  assert.deepEqual(Object.keys(app).sort(), expectedExports);
  assert.deepEqual(packageJson.exports, { '.': './dist/index.mjs' });
  assert.equal(packageJson.bin, undefined);
  assert.equal(packageJson.version, '1.0.0');
  assert.equal(packageJson.dependencies['@mcp/engine'], '^1.0.0');
});

test('server source uses public engine exports across static and dynamic resolution paths', async () => {
  const specifiers = new Set();
  const files = await sourceFiles(sourceRoot);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const { mechanism, specifier } of sourceModuleSpecifiers(source)) {
      assertSafeEngineSpecifier(specifier, mechanism, file);
      if (isEngineSpecifier(specifier)) specifiers.add(specifier);
    }
  }

  assert.deepEqual(specifiers, expectedEngineImports);
});

test('catalog owns one session manager and the stable 16-tool order', async () => {
  const { allTools, sessionManager } = await import(new URL('../src/catalog.mjs', import.meta.url));

  assert.ok(sessionManager);
  assert.equal(allTools.length, expectedToolNames.length);
  assert.deepEqual(
    allTools.map((tool) => tool.name),
    expectedToolNames
  );
});
