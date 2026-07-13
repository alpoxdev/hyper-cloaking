/**
 * @module register
 *
 * Client registration renderer for the hyper-cloaking-mcp server.
 *
 * Renders configuration for the consumer-installed legacy server bin. Rendering
 * only; it never launches the server.
 */

import { fileURLToPath } from 'node:url';

const LEGACY_SERVER_PATH = fileURLToPath(new URL('./dist/server.mjs', import.meta.url));

/**
 * Public server identifier used in every client registration.
 *
 * @type {string}
 */
export const SERVER_ID = 'hyper-cloaking-mcp';
/**
 * Supported client aliases resolved by {@link normalizeClient}.
 *
 * @type {Record<string, string>}
 * @private
 */
const CLIENT_ALIASES = { claude: 'claude-code', gjc: 'gajae-code' };
// Canonical client identifiers accepted by the renderer.

const SUPPORTED = new Set([
  'direct',
  'codex',
  'json',
  'claude-code',
  'gajae-code',
  'openclaw',
  'hermes',
  'hermes-agent'
]);

/**
 * Normalizes a client id, resolving aliases and rejecting unsupported clients.
 *
 * @param {string} client Client id.
 * @returns {string} Canonical client id.
 */
export function normalizeClient(client = 'direct') {
  const normalized = String(client || 'direct').toLowerCase();
  const resolved = CLIENT_ALIASES[normalized] ?? normalized;
  if (!SUPPORTED.has(resolved)) throw new Error(`Unsupported MCP client: ${client}`);
  return resolved;
}

/**
 * Default launch command for the consumer-local legacy server bin.
 *
 * @param {{ command?: string, args?: string[] }} [options] Command override.
 * @returns {{ command: string, args: string[] }} Command spec.
 */
export function serverCommand(options = {}) {
  return {
    command: options.command ?? process.execPath,
    args: options.args ?? [LEGACY_SERVER_PATH]
  };
}

/**
 * Quotes command parts for safe shell display without executing them.
 *
 * @param {Array<unknown>} parts Command and argument values.
 * @returns {string} Shell-escaped display command.
 */

function shellJoin(parts) {
  return parts
    .map((part) => {
      const value = String(part);
      return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
        ? value
        : `'${value.replaceAll("'", "'\"'\"'")}'`;
    })
    .join(' ');
}

/**
 * Builds the JSON MCP server configuration shape.
 *
 * @param {{ command: string, args: string[] }} spec Launch command specification.
 * @returns {{ mcpServers: Record<string, { command: string, args: string[] }> }} JSON configuration.
 */

function jsonMcpServers(spec) {
  return { mcpServers: { [SERVER_ID]: { command: spec.command, args: spec.args } } };
}

/**
 * Builds the OpenClaw-managed MCP configuration shape.
 *
 * @param {{ command: string, args: string[] }} spec Launch command specification.
 * @returns {{ mcp: { servers: Record<string, { command: string, args: string[] }> }} OpenClaw configuration.
 */

function openClawConfig(spec) {
  return { mcp: { servers: { [SERVER_ID]: { command: spec.command, args: spec.args } } } };
}

/**
 * Builds the Codex TOML MCP configuration text.
 *
 * @param {{ command: string, args: string[] }} spec Launch command specification.
 * @returns {string} TOML configuration.
 */

function codexTomlConfig(spec) {
  return `[mcp_servers.${SERVER_ID}]\ncommand = ${JSON.stringify(spec.command)}\nargs = ${JSON.stringify(spec.args)}\n`;
}

/**
 * Builds the Hermes YAML MCP configuration text.
 *
 * @param {{ command: string, args: string[] }} spec Launch command specification.
 * @returns {string} YAML configuration.
 */
function hermesYamlConfig(spec) {
  const args = spec.args.map((a) => `      - ${JSON.stringify(a)}`).join('\n');
  return `mcp_servers:\n  ${SERVER_ID}:\n    command: ${JSON.stringify(spec.command)}\n    args:\n${args}\n    idle_timeout_seconds: 300\n`;
}

/**
 * Renders the registration for one client.
 *
 * @param {string} client Client id.
 * @param {{ command?: string, args?: string[] }} [options] Command override.
 * @returns {object} Registration descriptor.
 */
export function generateServerRegistration(client, options = {}) {
  const normalized = normalizeClient(client);
  const spec = serverCommand(options);
  switch (normalized) {
    case 'direct': {
      const command = [spec.command, ...spec.args];
      return {
        serverId: SERVER_ID,
        type: 'direct-command',
        command,
        shellCommand: shellJoin(command)
      };
    }
    case 'codex':
      return { serverId: SERVER_ID, type: 'codex-toml', config: codexTomlConfig(spec) };
    case 'json':
      return { serverId: SERVER_ID, type: 'json-mcpServers', config: jsonMcpServers(spec) };
    case 'claude-code': {
      const command = ['claude', 'mcp', 'add', SERVER_ID, spec.command, ...spec.args];
      return {
        serverId: SERVER_ID,
        type: 'claude-code-cli',
        command,
        shellCommand: shellJoin(command)
      };
    }
    case 'openclaw':
      return {
        serverId: SERVER_ID,
        type: 'openclaw-managed-outbound',
        config: openClawConfig(spec)
      };
    case 'hermes':
    case 'hermes-agent':
      return {
        serverId: SERVER_ID,
        type: 'hermes-config-yaml',
        configPath: '~/.hermes/config.yaml',
        config: hermesYamlConfig(spec)
      };
    default:
      return {
        serverId: SERVER_ID,
        type: 'gajae-code-guidance',
        note: 'Gajae-Code runs beside MCP-capable clients; apply this server config to the paired client used for the GJC session.',
        config: jsonMcpServers(spec),
        codexToml: codexTomlConfig(spec)
      };
  }
}

/**
 * Renders registrations for every supported client target.
 *
 * @param {{ command?: string, args?: string[] }} [options] Command override.
 * @returns {Record<string, object>} Map of client -> registration.
 */
export function generateAllServerRegistrations(options = {}) {
  return {
    direct: generateServerRegistration('direct', options),
    codex: generateServerRegistration('codex', options),
    json: generateServerRegistration('json', options),
    claudeCode: generateServerRegistration('claude-code', options),
    gajaeCode: generateServerRegistration('gajae-code', options),
    openclaw: generateServerRegistration('openclaw', options),
    hermes: generateServerRegistration('hermes', options),
    hermesAgent: generateServerRegistration('hermes-agent', options)
  };
}
