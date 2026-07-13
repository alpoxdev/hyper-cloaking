import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    'NPM_CONFIG_INCLUDE_WORKSPACE_ROOT',
    'NPM_CONFIG_LOCAL_PREFIX',
    'NPM_CONFIG_PREFIX',
    'NPM_CONFIG_WORKSPACE',
    'NPM_CONFIG_GLOBAL',
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

test(
  'packed engine inventory contains only the canonical built payload',
  { timeout: 30_000 },
  async (t) => {
    const packDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-engine-pack-'));
    t.after(() => rm(packDirectory, { recursive: true, force: true }));

    const files = await packInventory(packDirectory);
    assert.ok(files.includes('package.json'), 'engine tarball includes its manifest');
    assert.ok(files.includes('dist/index.mjs'), 'engine tarball includes its root export');
    for (const file of files) {
      assert.match(
        file,
        /^(?:package\.json|dist\/)/,
        `engine tarball contains only its manifest and built distribution: ${file}`
      );
    }
    assert.equal(
      files.some((file) => /^(?:src|test|scripts)\/|^dist\/(?:src|test|scripts)\//.test(file)),
      false,
      'engine tarball does not contain raw source or test/build inputs'
    );
  }
);
const rootExports = [
  'DEFAULT_BULK_CAP',
  'classifyRedirect',
  'classifyTargetUrl',
  'ensureWorkspace',
  'getProvider',
  'inspectCredentialProfile',
  'launchCloakBrowser',
  'launchPersistentCloakContext',
  'listCredentialProfiles',
  'markUntrustedBrowserContent',
  'resolveProviderForUrl',
  'summarizeEvidenceRef',
  'workspacePaths'
].sort();

const subpathExports = new Map([
  [
    '@mcp/engine/browser-utils',
    ['ensureWorkspace', 'launchCloakBrowser', 'launchPersistentCloakContext']
  ],
  ['@mcp/engine/cli', ['runEngineCli']],
  ['@mcp/engine/cookie', ['runCookieCli']],
  ['@mcp/engine/config', ['baseMetadata']],
  ['@mcp/engine/credentials', ['inspectCredentialProfile', 'listCredentialProfiles']],
  ['@mcp/engine/target-safety', ['classifyRedirect', 'classifyTargetUrl']],
  ['@mcp/engine/outcome', ['evaluateOutcome']],
  ['@mcp/engine/diagnostics', ['classifyChallengeObservation']],
  ['@mcp/engine/evidence-boundary', ['markUntrustedBrowserContent', 'summarizeEvidenceRef']],
  ['@mcp/engine/recon-scope', ['classifyEvidenceScope']],
  ['@mcp/engine/run-shapes', ['appendRunShape']],
  ['@mcp/engine/action-runtime/action-result', ['makeActionResult']],
  ['@mcp/engine/action-runtime/guardrails', ['DEFAULT_BULK_CAP']],
  ['@mcp/engine/providers', ['getProvider', 'resolveProviderForUrl']],
  ['@mcp/engine/providers/instagram', ['instagramActions', 'buildInstagramSession']],
  ['@mcp/engine/providers/naver', ['naverActions', 'buildNaverSession']],
  ['@mcp/engine/providers/youtube', ['youtubeActions', 'buildYouTubeSession']],
  ['@mcp/engine/providers/coupang', ['coupangActions', 'buildCoupangSession']],
  ['@mcp/engine/providers/tiktok', ['tiktokActions', 'buildTikTokSession']],
  ['@mcp/engine/providers/x', ['xActions', 'buildXSession']],
  ['@mcp/engine/agents/parent-dispatcher', ['dispatchParent', 'runParentDispatcher']],
  ['@mcp/engine/agents/parent-verify', ['loadAgentEnvelopeSchema', 'verifyAgentEnvelope']]
]);

const runners = [
  ['@mcp/engine/cli', 'runEngineCli'],
  ['@mcp/engine/cookie', 'runCookieCli'],
  ['@mcp/engine/browser-utils', 'runBrowserUtilsCli'],
  ['@mcp/engine/agents/parent-dispatcher', 'runParentDispatcher']
];

test('root export surface is the approved API', async () => {
  const api = await import('@mcp/engine');
  assert.deepEqual(Object.keys(api).sort(), rootExports);
  assert.equal(typeof api.DEFAULT_BULK_CAP, 'number');
  for (const name of rootExports.filter((name) => name !== 'DEFAULT_BULK_CAP')) {
    assert.equal(typeof api[name], 'function', `${name} is callable`);
  }
});

test('every public subpath resolves its required exports', async () => {
  for (const [specifier, exportNames] of subpathExports) {
    const api = await import(specifier);
    for (const name of exportNames)
      assert.ok(Object.hasOwn(api, name), `${specifier} exports ${name}`);
  }
});

test('legacy adapters have concrete callable runners', async () => {
  for (const [specifier, exportName] of runners) {
    const api = await import(specifier);
    assert.equal(typeof api[exportName], 'function', `${specifier} exports ${exportName}`);
  }
});
test('built CLI entrypoints retain executable mode', async () => {
  for (const entrypoint of [
    'browser-utils.mjs',
    'cli.mjs',
    'cookie.mjs',
    'agents/parent-dispatcher.mjs'
  ]) {
    const metadata = await stat(new URL(`../dist/${entrypoint}`, import.meta.url));
    assert.equal(metadata.mode & 0o111, 0o111, `${entrypoint} is executable`);
  }
});
test('parent verifier resolves its installed-relative schema asset', async () => {
  const parentVerifyUrl = await import.meta.resolve('@mcp/engine/agents/parent-verify');
  const schemaUrl = new URL('./schemas/hyper-cloaking-agent-output.schema.json', parentVerifyUrl);
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
  assert.equal(schema.$id, 'https://hyper-cloaking.local/schemas/agent-output/v1');
});
