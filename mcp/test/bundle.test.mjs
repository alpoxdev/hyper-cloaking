import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The distribution bundle must externalize cloakbrowser + playwright-core
// (never inline them) and preserve browser-utils.mjs's runtime dynamic import so
// the registered local dist server can resolve a workspace-installed
// cloakbrowser at runtime. This bundles the MCP server entry that imports the
// engine and asserts on the emitted code without shipping it.
const here = path.dirname(fileURLToPath(import.meta.url));

test('server bundles with cloakbrowser/playwright-core external and dynamic import preserved', async () => {
  const result = await build({
    entryPoints: [path.join(here, '..', 'src', 'server.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['cloakbrowser', 'playwright-core'],
    write: false
  });

  const code = result.outputFiles[0].text;

  // Dynamic import of cloakbrowser stays dynamic and external (not inlined).
  assert.match(code, /import\("cloakbrowser"\)/, 'dynamic import("cloakbrowser") is preserved');
  // The runtime workspace-fallback path logic survives bundling.
  assert.match(
    code,
    /Tried fallback CloakBrowser module path/,
    'browser-utils runtime workspace fallback survives the bundle'
  );
  // cloakbrowser source must NOT be inlined (its internal humanize banner would leak in).
  assert.doesNotMatch(
    code,
    /Patch Frame methods so Locator-based calls go through humanization/,
    'cloakbrowser source is externalized, not inlined'
  );
});
