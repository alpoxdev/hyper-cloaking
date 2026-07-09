import fs from 'node:fs';
import path from 'node:path';

import {
  MCP_SERVER_ID,
  PLAYWRIGHT_MCP_PACKAGE_SPEC
} from './config.mjs';

const SUPPORTED_CLIENTS = new Set(['direct', 'codex', 'json', 'claude', 'claude-code', 'gajae-code', 'gjc']);

export function normalizeClient(client = 'direct') {
  const normalized = String(client || 'direct').toLowerCase();
  if (!SUPPORTED_CLIENTS.has(normalized)) {
    throw new Error(`Unsupported MCP client: ${client}`);
  }
  if (normalized === 'claude') return 'claude-code';
  if (normalized === 'gjc') return 'gajae-code';
  return normalized;
}

export function validateExecutablePath(executablePath) {
  if (!executablePath || typeof executablePath !== 'string') {
    return { ok: false, reason: 'executable path is required' };
  }

  const resolved = path.resolve(executablePath);
  if (!path.isAbsolute(resolved)) {
    return { ok: false, executablePath: resolved, reason: 'executable path must resolve to an absolute path' };
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
      reason: error && error.code === 'EACCES' ? 'executable path is not executable' : 'executable path is not an accessible file'
    };
  }
}

export function mcpCommand(executablePath, options = {}) {
  const { headless = true } = options;
  const validation = validateExecutablePath(executablePath);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const args = [PLAYWRIGHT_MCP_PACKAGE_SPEC];
  if (headless) args.push('--headless');
  args.push('--executable-path', validation.executablePath);
  return { command: 'npx', args };
}

export function shellJoin(parts) {
  return parts.map((part) => /^[A-Za-z0-9_@%+=:,./-]+$/.test(part) ? part : JSON.stringify(part)).join(' ');
}

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

export function codexTomlConfig(commandSpec) {
  return `[mcp_servers.${MCP_SERVER_ID}]\ncommand = ${JSON.stringify(commandSpec.command)}\nargs = ${JSON.stringify(commandSpec.args)}\n`;
}

export function claudeCommand(commandSpec) {
  return ['claude', 'mcp', 'add', MCP_SERVER_ID, commandSpec.command, ...commandSpec.args];
}

export function directCommand(commandSpec) {
  return [commandSpec.command, ...commandSpec.args];
}

export function gajaeCodeConfig(commandSpec) {
  return {
    note: 'Gajae-Code runs beside MCP-capable clients; apply this server config to the paired client used for the GJC session.',
    config: jsonMcpConfig(commandSpec),
    codexToml: codexTomlConfig(commandSpec)
  };
}

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

  return {
    serverId: MCP_SERVER_ID,
    type: 'gajae-code-guidance',
    ...gajaeCodeConfig(commandSpec)
  };
}

export function generateAllMcpConfigs(options = {}) {
  return {
    direct: generateMcpConfig({ ...options, client: 'direct' }),
    codex: generateMcpConfig({ ...options, client: 'codex' }),
    json: generateMcpConfig({ ...options, client: 'json' }),
    claudeCode: generateMcpConfig({ ...options, client: 'claude-code' }),
    gajaeCode: generateMcpConfig({ ...options, client: 'gajae-code' })
  };
}
