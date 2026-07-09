import os from 'node:os';
import path from 'node:path';

export const SKILL_ID = 'hyper-cloaking';
export const VERSION = '0.0.1';
export const SCHEMA_VERSION = '0.0.1';
export const DEFAULT_HOME = '~/.hyper-cloaking';

export const CLOAKBROWSER_PACKAGE = 'cloakbrowser';
export const PLAYWRIGHT_CORE_PACKAGE = 'playwright-core';
export const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp';
export const PLAYWRIGHT_MCP_PACKAGE_SPEC = '@playwright/mcp@latest';
export const MCP_SERVER_ID = SKILL_ID;

export function expandHome(input, homeDirectory = os.homedir()) {
  if (!input) return input;
  if (input === '~') return homeDirectory;
  if (input.startsWith('~/')) return path.join(homeDirectory, input.slice(2));
  return input;
}

export function defaultHome(homeDirectory = os.homedir()) {
  return expandHome(DEFAULT_HOME, homeDirectory);
}

export function resolveHome(home) {
  return path.resolve(expandHome(home || DEFAULT_HOME));
}

export function homePath(home, ...segments) {
  return path.join(resolveHome(home), ...segments);
}

export function cachePath(home, ...segments) {
  return homePath(home, 'cache', ...segments);
}

export function profilePath(home, ...segments) {
  return homePath(home, 'profiles', ...segments);
}

export function statePath(home, ...segments) {
  return homePath(home, 'state', ...segments);
}

export function tmpPath(home, ...segments) {
  return homePath(home, 'tmp', ...segments);
}

export function jsonStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function baseMetadata() {
  return {
    skillId: SKILL_ID,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    defaultHome: DEFAULT_HOME
  };
}
