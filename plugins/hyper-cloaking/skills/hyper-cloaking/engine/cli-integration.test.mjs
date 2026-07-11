import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeBrowserHandle, gotoAndClassify, installNavigationSafety, runCli, runLiveVerification } from './cli.mjs';
import { generateMcpConfig, mcpCommand } from './mcp-config.mjs';
import { buildNoSandboxWarningSafeCloakOptions } from './browser-utils.mjs';


async function runJson(args) {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli([...args, '--json'], {
    stdout: { write: (chunk) => { stdout += String(chunk); } },
    stderr: { write: (chunk) => { stderr += String(chunk); } }
  });
  assert.equal(stderr, '');
  return { exitCode, json: JSON.parse(stdout) };
}

function assertCompletionShape(payload) {
  for (const key of ['targetSafety', 'outcome', 'failure', 'contentBoundary', 'learning']) {
    assert.ok(Object.hasOwn(payload, key), `missing ${key}`);
  }
}

test('validate --json reports helper metadata and mandatory completion shape without launch', async () => {
  const { exitCode, json } = await runJson(['validate']);

  assert.equal(exitCode, 0);
  assert.equal(json.command, 'validate');
  assert.equal(json.network, 'not-used');
  assert.equal(json.sideEffects, 'none');
  assert.ok(json.helperMetadata.some((check) => check.name === 'classifyTargetUrl' && check.ok));
  assertCompletionShape(json);
});

test('smoke --json reports samples and mandatory completion shape without live launch', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-cli-test-'));
  const { exitCode, json } = await runJson(['smoke', '--home', home]);

  assert.equal(exitCode, 0);
  assert.equal(json.command, 'smoke');
  assert.equal(json.network, 'not-used');
  assert.equal(json.liveLaunch, 'not-attempted');
  assert.ok(json.targetSafetySample);
  assert.ok(json.outcomeReportSample);
  assert.ok(json.diagnosticSample);
  assert.ok(json.contentBoundarySample);
  assert.ok(json.evidenceScopePlan);
  assertCompletionShape(json);
});

test('mcp-config --json blocked path reports diagnostics and mandatory completion shape', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-mcp-test-'));
  const { exitCode, json } = await runJson(['mcp-config', '--home', home, '--client', 'json']);

  assert.equal(exitCode, 1);
  assert.equal(json.command, 'mcp-config');
  assert.equal(json.status, 'blocked');
  assert.equal(json.network, 'not-used');
  assert.ok(Array.isArray(json.blockers));
  assert.ok(json.failure);
  assertCompletionShape(json);
});
test('mcp-config commands enable sandbox by default', () => {
  const command = mcpCommand(process.execPath, { headless: false });
  assert.ok(command.args.includes('--sandbox'));
  assert.equal(command.args.includes('--headless'), false);
  assert.equal(command.args.includes('--no-sandbox'), false);
});

test('OpenClaw MCP config uses managed outbound mcp.servers shape and preserves command args', () => {
  const config = generateMcpConfig({ client: 'openclaw', executablePath: process.execPath });
  const server = config.config.mcp.servers['hyper-cloaking'];

  assert.equal(config.type, 'openclaw-managed-outbound');
  assert.equal(server.command, 'npx');
  assert.equal(server.args[0], '@playwright/mcp@latest');
  assert.ok(server.args.includes('--headless'));
  assert.ok(server.args.includes('--sandbox'));
  assert.ok(server.args.includes('--executable-path'));
  assert.equal(server.args[server.args.indexOf('--executable-path') + 1], process.execPath);
});

test('Hermes MCP config renders config.yaml-compatible mcp_servers YAML and preserves command args', () => {
  const config = generateMcpConfig({ client: 'hermes-agent', executablePath: process.execPath });

  assert.equal(config.type, 'hermes-config-yaml');
  assert.equal(config.configPath, '~/.hermes/config.yaml');
  assert.match(config.config, /^mcp_servers:\n  hyper-cloaking:\n/m);
  assert.match(config.config, /    command: "npx"\n/);
  assert.match(config.config, /    args:\n      - "@playwright\/mcp@latest"\n      - "--headless"\n      - "--sandbox"\n      - "--executable-path"\n/);
  assert.match(config.config, new RegExp(`      - ${JSON.stringify(process.execPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`));
  assert.match(config.config, /    idle_timeout_seconds: 300\n/);
});

test('CloakBrowser JS options suppress no-sandbox warning flag', () => {
  const options = buildNoSandboxWarningSafeCloakOptions(
    {
      getDefaultStealthArgs: () => ['--no-sandbox', '--fingerprint=12345', '--fingerprint-platform=macos']
    },
    {
      cloakOptions: {
        args: ['--no-sandbox', '--window-size=1200,900'],
        launchOptions: { ignoreDefaultArgs: ['--enable-automation'] }
      }
    },
    { downloadsPath: '/tmp/downloads' }
  );

  assert.equal(options.stealthArgs, false);
  assert.deepEqual(options.args, ['--fingerprint=12345', '--fingerprint-platform=macos', '--window-size=1200,900']);
  assert.deepEqual(options.launchOptions.ignoreDefaultArgs, ['--enable-automation', '--enable-unsafe-swiftshader', '--no-sandbox']);
  assert.equal(options.launchOptions.downloadsPath, '/tmp/downloads');
});

test('live --json blocks without fake success and still reports completion shape', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hyper-cloaking-live-test-'));
  const { exitCode, json } = await runJson(['live', '--home', home, '--target', 'about:blank']);

  assert.equal(exitCode, 1);
  assert.equal(json.command, 'live');
  assert.equal(json.ok, false);
  assert.equal(json.status, 'blocked');
  assert.equal(json.liveLaunch, 'not-attempted');
  assert.ok(Array.isArray(json.blockers));
  assertCompletionShape(json);
});

function fakeRoute(url, { navigation = true } = {}) {
  const state = { continued: 0, aborted: 0 };
  return {
    state,
    request() {
      return {
        url: () => url,
        isNavigationRequest: () => navigation,
        resourceType: () => navigation ? 'document' : 'script'
      };
    },
    async continue() { state.continued += 1; },
    async abort() { state.aborted += 1; }
  };
}

test('document navigation uses exact origins while subresources bypass the document guard', async () => {
  let handler;
  const page = { async route(_pattern, value) { handler = value; } };
  await installNavigationSafety(page, { allowedOrigins: ['https://example.com'], maxRedirects: 2, allowAboutBlank: true });

  const subresource = fakeRoute('https://cdn.example.net/script.js', { navigation: false });
  await handler(subresource);
  assert.deepEqual(subresource.state, { continued: 1, aborted: 0 });

  const allowed = fakeRoute('https://example.com/path');
  await handler(allowed);
  assert.deepEqual(allowed.state, { continued: 1, aborted: 0 });

  const refused = fakeRoute('https://example.com.evil.test/');
  await handler(refused);
  assert.deepEqual(refused.state, { continued: 0, aborted: 1 });
});

test('redirect bounds are enforced before request dispatch', async () => {
  let handler;
  const page = { async route(_pattern, value) { handler = value; } };
  await installNavigationSafety(page, { allowedOrigins: ['https://example.com'], maxRedirects: 0, allowAboutBlank: true });
  await handler(fakeRoute('about:blank'));
  const firstPublic = fakeRoute('https://example.com/');
  await handler(firstPublic);
  assert.equal(firstPublic.state.continued, 1);
  const redirect = fakeRoute('https://example.com/next');
  await handler(redirect);
  assert.equal(redirect.state.aborted, 1);
});

test('final redirected URL is checked even after an allowed request', async () => {
  let handler;
  let current = 'about:blank';
  const page = {
    async route(_pattern, value) { handler = value; },
    async goto(url) {
      const route = fakeRoute(url);
      await handler(route);
      current = 'https://evil.example.net/';
    },
    url() { return current; }
  };
  await installNavigationSafety(page, { allowedOrigins: ['https://example.com'], maxRedirects: 2, allowAboutBlank: true });
  await assert.rejects(
    () => gotoAndClassify(page, 'about:blank', 'https://example.com/', { allowedOrigins: ['https://example.com'], maxRedirects: 2 }),
    /unauthorized origin/
  );
});

test('browser close rejection and timeout are explicit cleanup blockers', async () => {
  const rejected = await closeBrowserHandle({ async close() { throw new Error('close failed'); } }, 20);
  assert.deepEqual(rejected, { ok: false, closed: false, timedOut: false, blocker: 'close failed' });
  const timedOut = await closeBrowserHandle({ close() { return new Promise(() => {}); } }, 10);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.timedOut, true);
});

function injectableLiveDependencies({ textFailure = null, closeFailure = null } = {}) {
  let handler;
  let currentUrl = 'about:blank';
  const page = {
    async route(_pattern, value) {
      handler = value;
    },
    async goto(url) {
      const route = fakeRoute(url);
      await handler(route);
      if (route.state.aborted > 0) throw new Error(`navigation aborted: ${url}`);
      currentUrl = url;
    },
    url() {
      return currentUrl;
    },
    async title() {
      return 'Example Domain';
    },
    locator() {
      return {
        async innerText() {
          if (textFailure) throw new Error(textFailure);
          return 'Example Domain verification page';
        }
      };
    },
    async screenshot({ path: screenshotPath }) {
      await writeFile(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {
      if (closeFailure) throw new Error(closeFailure);
    }
  };
  return {
    tryImportPackage: async (packageName) => ({ ok: true, package: packageName }),
    executableCandidates: async () => ['/tmp/fake-cloakbrowser'],
    generateMcpConfig: () => ({ command: 'fake-mcp', args: ['--sandbox'] }),
    launchCloakBrowser: async () => ({ browser })
  };
}

function liveOptions(home, extra = {}) {
  return {
    home,
    target: 'https://example.com/',
    'public-target': 'https://example.com/',
    allowedOrigins: ['https://example.com'],
    maxRedirects: 2,
    headless: true,
    ...extra
  };
}

test('injectable parent-staged live verification writes only to its staging root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hyper-live-'));
  const home = path.join(root, 'home');
  const staging = path.join(root, 'agent-stage');
  const result = await runLiveVerification(
    liveOptions(home, {
      publicationMode: 'parent-staged',
      agentStagingRoot: staging
    }),
    injectableLiveDependencies()
  );
  assert.equal(result.publicationMode, 'parent-staged');
  assert.equal(result.ok, false);
  assert.match(result.blockers.join(' '), /humanization telemetry unavailable/);
  assert.equal(result.cleanup.ok, true);
  assert.equal(result.cleanup.closed, true);
  assert.equal(result.evidenceRefs.length, 1);
  assert.ok(result.evidenceRefs[0].path.startsWith(`${staging}${path.sep}`));
  await access(result.evidenceRefs[0].path);
  await assert.rejects(() => access(path.join(home, 'evidence')), { code: 'ENOENT' });
});

test('injectable legacy live verification keeps the existing home evidence destination', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hyper-live-'));
  const home = path.join(root, 'home');
  const result = await runLiveVerification(
    liveOptions(home),
    injectableLiveDependencies()
  );
  assert.equal(result.publicationMode, 'legacy-final');
  assert.equal(result.evidenceRefs.length, 1);
  assert.ok(result.evidenceRefs[0].path.startsWith(`${path.join(home, 'evidence')}${path.sep}`));
  await access(result.evidenceRefs[0].path);
});

test('live verification preserves text-extraction and close failures as blockers', async () => {
  const textRoot = await mkdtemp(path.join(os.tmpdir(), 'hyper-live-'));
  const textFailure = await runLiveVerification(
    liveOptions(path.join(textRoot, 'home')),
    injectableLiveDependencies({ textFailure: 'body unavailable' })
  );
  assert.match(textFailure.blockers.join(' '), /page text signal unavailable: body unavailable/);

  const closeRoot = await mkdtemp(path.join(os.tmpdir(), 'hyper-live-'));
  const closeFailure = await runLiveVerification(
    liveOptions(path.join(closeRoot, 'home')),
    injectableLiveDependencies({ closeFailure: 'close rejected' })
  );
  assert.equal(closeFailure.cleanup.ok, false);
  assert.equal(closeFailure.cleanup.closed, false);
  assert.match(closeFailure.blockers.join(' '), /close rejected/);

  const combinedRoot = await mkdtemp(path.join(os.tmpdir(), 'hyper-live-'));
  const combinedFailure = await runLiveVerification(
    liveOptions(path.join(combinedRoot, 'home')),
    injectableLiveDependencies({
      textFailure: 'body unavailable',
      closeFailure: 'close rejected after navigation failure'
    })
  );
  assert.match(combinedFailure.blockers.join(' '), /body unavailable/);
  assert.match(combinedFailure.blockers.join(' '), /close rejected after navigation failure/);
  assert.equal(combinedFailure.failure.stage, 'browser-cleanup-unverified');
});
