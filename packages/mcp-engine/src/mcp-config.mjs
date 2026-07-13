/**
 * Build and validate Playwright MCP server launch/configuration payloads for
 * supported clients without starting the server.
 */
import fs from 'node:fs';
import path from 'node:path';

import { MCP_SERVER_ID, PLAYWRIGHT_MCP_PACKAGE_SPEC } from './config.mjs';

const SUPPORTED_CLIENTS = new Set([
  'direct',
  'codex',
  'json',
  'claude',
  'claude-code',
  'gajae-code',
  'gjc',
  'openclaw',
  'hermes',
  'hermes-agent'
]);

/** Normalize client aliases and reject unsupported MCP client identifiers. */
export function normalizeClient(client = 'direct') {
  const normalized = String(client || 'direct').toLowerCase();
  if (!SUPPORTED_CLIENTS.has(normalized)) {
    throw new Error(`Unsupported MCP client: ${client}`);
  }
  if (normalized === 'claude') return 'claude-code';
  if (normalized === 'gjc') return 'gajae-code';
  return normalized;
}

/** Validate that an executable path resolves to an accessible executable file. */
export function validateExecutablePath(executablePath) {
  if (!executablePath || typeof executablePath !== 'string') {
    return { ok: false, reason: 'executable path is required' };
  }

  const resolved = path.resolve(executablePath);
  if (!path.isAbsolute(resolved)) {
    return {
      ok: false,
      executablePath: resolved,
      reason: 'executable path must resolve to an absolute path'
    };
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return { ok: false, executablePath: resolved, reason: 'executable path is not a file' };
    }
    fs.accessSync(resolved, fs.constants.X_OK);
    return { ok: true, executablePath: resolved, checked: true };
  } catch (error) {
    return {
      ok: false,
      executablePath: resolved,
      reason:
        error && error.code === 'EACCES'
          ? 'executable path is not executable'
          : 'executable path is not an accessible file'
    };
  }
}

/** Create the canonical `npx` command specification for the MCP server. */
export function mcpCommand(executablePath, options = {}) {
  const { headless = true, sandbox = true } = options;
  const validation = validateExecutablePath(executablePath);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const args = [PLAYWRIGHT_MCP_PACKAGE_SPEC];
  if (headless) args.push('--headless');
  if (sandbox) args.push('--sandbox');
  args.push('--executable-path', validation.executablePath);
  return { command: 'npx', args };
}

/** Quote command arguments for safe display as a shell command string. */
export function shellJoin(parts) {
  return parts
    .map((part) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ');
}

/** Serialize a command specification as an MCP `mcpServers` JSON object. */
export function jsonMcpConfig(commandSpec) {
  return {
    mcpServers: {
      [MCP_SERVER_ID]: {
        command: commandSpec.command,
        args: commandSpec.args
      }
    }
  };
}

/** Serialize a command specification in OpenClaw's managed-server shape. */
export function openClawConfig(commandSpec) {
  return {
    mcp: {
      servers: {
        [MCP_SERVER_ID]: {
          command: commandSpec.command,
          args: commandSpec.args
        }
      }
    }
  };
}

/** Serialize a command specification as Codex TOML. */
export function codexTomlConfig(commandSpec) {
  return `[mcp_servers.${MCP_SERVER_ID}]\ncommand = ${JSON.stringify(commandSpec.command)}\nargs = ${JSON.stringify(commandSpec.args)}\n`;
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

function yamlList(values, indent = '      ') {
  return values.map((value) => `${indent}- ${yamlScalar(value)}`).join('\n');
}

/** Serialize a command specification as Hermes YAML. */
export function hermesYamlConfig(commandSpec) {
  return `mcp_servers:\n  ${MCP_SERVER_ID}:\n    command: ${yamlScalar(commandSpec.command)}\n    args:\n${yamlList(commandSpec.args)}\n    idle_timeout_seconds: 300\n`;
}

/** Build the Claude Code CLI arguments for registering the MCP server. */
export function claudeCommand(commandSpec) {
  return ['claude', 'mcp', 'add', MCP_SERVER_ID, commandSpec.command, ...commandSpec.args];
}

/** Build a direct executable-and-arguments command array. */
export function directCommand(commandSpec) {
  return [commandSpec.command, ...commandSpec.args];
}

/** Build Gajae-Code guidance containing paired-client configurations. */
export function gajaeCodeConfig(commandSpec) {
  return {
    note: 'Gajae-Code runs beside MCP-capable clients; apply this server config to the paired client used for the GJC session.',
    config: jsonMcpConfig(commandSpec),
    codexToml: codexTomlConfig(commandSpec)
  };
}

/** Generate one client-specific MCP configuration from executable options. */
export function generateMcpConfig(options = {}) {
  const client = normalizeClient(options.client);
  const commandSpec = mcpCommand(options.executablePath, options);
  const direct = directCommand(commandSpec);

  if (client === 'direct') {
    return {
      serverId: MCP_SERVER_ID,
      type: 'direct-command',
      command: direct,
      shellCommand: shellJoin(direct)
    };
  }

  if (client === 'codex') {
    return {
      serverId: MCP_SERVER_ID,
      type: 'codex-toml',
      config: codexTomlConfig(commandSpec)
    };
  }

  if (client === 'json') {
    return {
      serverId: MCP_SERVER_ID,
      type: 'json-mcpServers',
      config: jsonMcpConfig(commandSpec)
    };
  }

  if (client === 'claude-code') {
    const command = claudeCommand(commandSpec);
    return {
      serverId: MCP_SERVER_ID,
      type: 'claude-code-cli',
      command,
      shellCommand: shellJoin(command)
    };
  }

  if (client === 'openclaw') {
    return {
      serverId: MCP_SERVER_ID,
      type: 'openclaw-managed-outbound',
      config: openClawConfig(commandSpec)
    };
  }

  if (client === 'hermes' || client === 'hermes-agent') {
    return {
      serverId: MCP_SERVER_ID,
      type: 'hermes-config-yaml',
      configPath: '~/.hermes/config.yaml',
      config: hermesYamlConfig(commandSpec)
    };
  }

  return {
    serverId: MCP_SERVER_ID,
    type: 'gajae-code-guidance',
    ...gajaeCodeConfig(commandSpec)
  };
}

/** Generate the supported client configurations in one consolidated object. */
export function generateAllMcpConfigs(options = {}) {
  return {
    direct: generateMcpConfig({ ...options, client: 'direct' }),
    codex: generateMcpConfig({ ...options, client: 'codex' }),
    json: generateMcpConfig({ ...options, client: 'json' }),
    claudeCode: generateMcpConfig({ ...options, client: 'claude-code' }),
    gajaeCode: generateMcpConfig({ ...options, client: 'gajae-code' }),
    openclaw: generateMcpConfig({ ...options, client: 'openclaw' }),
    hermes: generateMcpConfig({ ...options, client: 'hermes' })
  };
}
