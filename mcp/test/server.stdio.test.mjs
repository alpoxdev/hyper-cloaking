import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, '..', 'src', 'server.mjs');

test('server completes the MCP handshake and lists the implemented tool catalog', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath]
  });
  const client = new Client({ name: 'stdio-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const capabilities = client.getServerCapabilities();
    assert.ok(capabilities?.tools, 'server advertises the tools capability');

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      [
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
      ],
      'tools/list returns the full implemented catalog'
    );
    for (const tool of tools) {
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} exposes an object input schema`);
    }

    const version = client.getServerVersion();
    assert.equal(version?.name, 'hyper-cloaking-mcp');
  } finally {
    await client.close();
  }
});

test('calling an unknown tool returns a structured error, never a raw throw', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath]
  });
  const client = new Client({ name: 'stdio-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'cloak_nonexistent', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown tool/);
  } finally {
    await client.close();
  }
});
