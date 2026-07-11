import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function payload(result) {
  return JSON.parse(result.content[0].text);
}

test(
  'bundled dist server completes a real humanized lifecycle over stdio',
  { timeout: 120_000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(here, '.dist-live-'));
    const serverPath = path.join(dir, 'server.mjs');
    await build({
      entryPoints: [path.join(here, '..', 'src', 'server.mjs')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile: serverPath,
      external: ['cloakbrowser', 'playwright-core'],
      banner: { js: '#!/usr/bin/env node' }
    });

    const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
    const client = new Client({ name: 'dist-live-smoke', version: '0.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 16);

      const launched = payload(
        await client.callTool({ name: 'cloak_launch', arguments: { headless: true } })
      );
      assert.equal(launched.status, 'launched');

      const status = payload(await client.callTool({ name: 'cloak_status', arguments: {} }));
      assert.equal(status.status, 'ok');
      assert.ok(status.session, 'dist server reports the live CloakBrowser session');
      assert.equal(status.queue.active, true);

      const tornDown = payload(await client.callTool({ name: 'cloak_teardown', arguments: {} }));
      assert.equal(tornDown.status, 'torn-down');
    } finally {
      await client.close().catch(() => {});
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
);
