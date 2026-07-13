/**
 * @module app
 *
 * hyper-cloaking-mcp — stateful stdio MCP server exposing the CloakBrowser
 * engine as typed tools.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { allTools } from './catalog.mjs';

/**
 * MCP implementation identity advertised during initialization.
 *
 * @type {{ name: string, version: string }}
 */
export const SERVER_INFO = { name: 'hyper-cloaking-mcp', version: '1.0.0' };

/**
 * Builds the MCP server with a tool registry seam.
 *
 * @param {Array<{ name: string, description?: string, inputSchema: object, handler: (args: object) => Promise<object> }>} [tools]
 *   Typed tool descriptors. Empty in Phase 0.
 * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server} Configured server.
 */
export function createServer(tools = []) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  const registry = new Map(tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...registry.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = registry.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }]
      };
    }
    return tool.handler(request.params.arguments ?? {});
  });

  return server;
}

/**
 * Connects the server over stdio.
 *
 * @returns {Promise<void>}
 */
export async function main() {
  const server = createServer(allTools);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
