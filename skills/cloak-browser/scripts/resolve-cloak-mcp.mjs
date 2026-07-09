#!/usr/bin/env node
/**
 * Resolves a CloakBrowser Chromium executable and prints Playwright MCP launch
 * commands/config snippets for supported agent clients.
 *
 * The helper intentionally reports that `--executable-path` alone does not
 * prove CloakBrowser JS `humanize: true`, because humanization must be
 * evidenced separately by a JS API launch or a CloakBrowser-aware bridge.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);

/**
 * Builds the CLI usage text.
 *
 * @returns {string} Usage text for humans and agents.
 */
function usage() {
  return `Usage:
  node scripts/resolve-cloak-mcp.mjs [--json] [--executable PATH] [--cache-dir DIR] [--client NAME] [--headed|--visible|--headless false]

Purpose:
  Locate a likely CloakBrowser Chromium executable under ~/.cloakbrowser and print
  the Playwright MCP command that uses it. Humanization is mandatory for this
  skill, but Playwright MCP --executable-path alone does not prove
  CloakBrowser JS API humanize: true.

Options:
  --json             Print machine-readable JSON.
  --executable PATH  Validate and use this executable path instead of scanning.
  --cache-dir DIR    Scan a custom CloakBrowser cache directory.
  --client NAME      Output config for direct, codex, json, claude-code, cursor, or gajae-code.
  --headed           Omit --headless so Playwright MCP opens a visible browser.
  --visible          Alias for --headed.
  --headless false   Omit --headless. Default is headless true.
  --help             Show this help.

Expected output:
  Human-readable command by default, or JSON with executablePath, command, and
  humanization status.

Failure behavior:
  Exits non-zero when no executable can be found or the provided path is invalid.`;
}

/**
 * Reads the value after a CLI flag.
 *
 * @param {string} flag Flag to read, such as `--client`.
 * @returns {string | undefined} Flag value when present.
 * @throws {Error} When the flag is present without a value.
 */
function takeValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Expands a leading `~` in a path.
 *
 * @param {string | undefined} input Path that may contain a home shortcut.
 * @returns {string | undefined} Expanded path.
 */
function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

/**
 * Checks whether a path is an executable file.
 *
 * @param {string} filePath Candidate executable path.
 * @returns {boolean} True when the path is a file and has execute permission.
 */
function isExecutableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds likely CloakBrowser Chromium executable paths under a cache root.
 *
 * @param {string} root CloakBrowser cache directory.
 * @returns {string[]} Valid executable candidates, newest-looking first.
 */
function candidatePaths(root) {
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
    .map((entry) => path.join(root, entry.name));

  const candidates = [];
  for (const dir of dirs) {
    candidates.push(path.join(dir, 'chrome'));
    candidates.push(path.join(dir, 'chrome.exe'));
    candidates.push(path.join(dir, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
  }

  return candidates
    .filter(isExecutableFile)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

/**
 * Determines whether the user requested visible/headed mode.
 *
 * @returns {boolean} True when `--headed`, `--visible`, or `--headless false` is present.
 */
function wantsHeadedMode() {
  if (args.includes('--headed') || args.includes('--visible')) return true;
  const inline = args.find((arg) => arg === '--headless=false' || arg === '--headless=0');
  if (inline) return true;
  const index = args.indexOf('--headless');
  if (index !== -1) {
    const value = args[index + 1];
    return value === 'false' || value === '0';
  }
  return false;
}

/**
 * Builds the Playwright MCP command for a CloakBrowser executable.
 *
 * @param {string} executablePath Resolved browser executable path.
 * @param {boolean} headless Whether to add `--headless`.
 * @returns {string[]} Command argv.
 */
function commandFor(executablePath, headless) {
  const command = ['npx', '@playwright/mcp@latest'];
  if (headless) command.push('--headless');
  command.push('--executable-path', executablePath);
  return command;
}

/**
 * Formats argv for shell display.
 *
 * @param {string[]} command Command argv.
 * @returns {string} Shell-friendly command string.
 */
function shellJoin(command) {
  return command.map((part) => part.includes(' ') ? JSON.stringify(part) : part).join(' ');
}

/**
 * Produces the JS launch shape that proves `humanize: true`.
 *
 * @param {boolean} headless Whether the example should be headless.
 * @returns {string} JavaScript snippet.
 */
function humanizedJsExample(headless) {
  return `import { launch } from 'cloakbrowser';

const browser = await launch({
  humanize: true,
  headless: ${headless ? 'true' : 'false'}
});
const page = await browser.newPage();`;
}

/**
 * Builds client-specific command/config output.
 *
 * @param {string} client Target client name.
 * @param {string[]} command Playwright MCP command argv.
 * @param {string} executablePath Resolved browser executable path.
 * @param {boolean} headless Whether the run is headless.
 * @returns {Record<string, unknown>} Client-specific result object.
 */
function clientOutput(client, command, executablePath, headless) {
  const args = command.slice(1);
  const normalized = client || 'direct';
  const jsonConfig = {
    mcpServers: {
      'cloak-browser': {
        command: 'npx',
        args
      }
    }
  };
  const codexToml = `[mcp_servers.cloak-browser]
command = "npx"
args = ${JSON.stringify(args)}
`;
  const claudeCli = ['claude', 'mcp', 'add', 'cloak-browser', ...command];
  const gajaeNote = 'Gajae-Code runs beside existing agents; apply this MCP config to the MCP-capable client used inside the GJC session unless the local GJC install documents a dedicated MCP config path.';

  if (normalized === 'codex') {
    return { type: 'codex-toml', config: codexToml };
  }
  if (normalized === 'json' || normalized === 'cursor') {
    return { type: normalized === 'cursor' ? 'cursor-json' : 'json-mcpServers', config: jsonConfig };
  }
  if (normalized === 'claude-code' || normalized === 'claude') {
    return { type: 'claude-code-cli', command: claudeCli, shellCommand: shellJoin(claudeCli) };
  }
  if (normalized === 'gajae-code' || normalized === 'gjc') {
    return { type: 'gajae-code-guidance', note: gajaeNote, config: jsonConfig, codexToml };
  }
  return {
    type: 'direct-command',
    executablePath,
    mode: headless ? 'headless' : 'headed',
    command,
    shellCommand: shellJoin(command)
  };
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(usage());
  process.exit(0);
}

const json = args.includes('--json');
const headless = !wantsHeadedMode();
let executable = takeValue('--executable');
const client = takeValue('--client') || 'direct';
const cacheDir = expandHome(takeValue('--cache-dir') || process.env.CLOAKBROWSER_CACHE_DIR || '~/.cloakbrowser');

if (executable) {
  executable = path.resolve(expandHome(executable));
  if (!isExecutableFile(executable)) {
    console.error(`Invalid CloakBrowser executable: ${executable}`);
    process.exit(2);
  }
} else {
  const candidates = candidatePaths(cacheDir);
  executable = candidates[0];
}

if (!executable) {
  const installHint = 'Run `npm install cloakbrowser@latest playwright-core@latest && npx cloakbrowser install`, then retry.';
  if (json) {
    console.log(JSON.stringify({ ok: false, cacheDir, error: 'No CloakBrowser executable found', installHint }, null, 2));
  } else {
    console.error(`No CloakBrowser executable found under ${cacheDir}.`);
    console.error(installHint);
  }
  process.exit(1);
}

const command = commandFor(executable, headless);
const clientResult = clientOutput(client, command, executable, headless);
const humanization = {
  required: true,
  mcpExecutablePathOnlyProvesHumanize: false,
  status: 'not-proven-by-executable-path-only',
  requiredEvidence: 'Use CloakBrowser JS API with humanize: true, or a CloakBrowser-aware MCP bridge that explicitly proves humanization.',
  jsExample: humanizedJsExample(headless)
};

if (json) {
  console.log(JSON.stringify({
    ok: true,
    executablePath: executable,
    mode: headless ? 'headless' : 'headed',
    humanization,
    installCommand: 'npm install cloakbrowser@latest playwright-core@latest && npx cloakbrowser install',
    command,
    shellCommand: shellJoin(command),
    client,
    clientResult
  }, null, 2));
} else {
  console.log(`CloakBrowser executable: ${executable}`);
  console.log(`Mode: ${headless ? 'headless' : 'headed/visible'}`);
  console.log(`Client: ${client}`);
  console.log('Humanize: required. This MCP command uses the CloakBrowser executable, but --executable-path alone does not prove CloakBrowser JS humanize: true.');
  console.log('Humanized CloakBrowser JS launch shape:');
  console.log(humanizedJsExample(headless));
  console.log('Playwright MCP command:');
  console.log(shellJoin(command));
  if (clientResult.type === 'codex-toml') {
    console.log('\nCodex TOML:');
    console.log(clientResult.config.trim());
  } else if (clientResult.type === 'json-mcpServers' || clientResult.type === 'cursor-json') {
    console.log('\nJSON MCP config:');
    console.log(JSON.stringify(clientResult.config, null, 2));
  } else if (clientResult.type === 'claude-code-cli') {
    console.log('\nClaude Code CLI command:');
    console.log(clientResult.shellCommand);
  } else if (clientResult.type === 'gajae-code-guidance') {
    console.log('\nGajae-Code note:');
    console.log(clientResult.note);
    console.log('\nJSON MCP config for the paired client:');
    console.log(JSON.stringify(clientResult.config, null, 2));
  }
}
