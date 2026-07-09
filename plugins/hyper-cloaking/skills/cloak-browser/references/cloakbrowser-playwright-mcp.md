# CloakBrowser + Playwright MCP Reference

Last verified: 2026-07-08.

Use this reference for current package syntax, setup commands, executable path behavior, and source-sensitive caveats. Refresh it when CloakBrowser, `@playwright/mcp`, or Node requirements change.

## Sources

| Source | What it supports |
|---|---|
| <https://github.com/CloakHQ/CloakBrowser> | Main README, install commands, free/pro binary notes, troubleshooting, latest release notes. |
| <https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/js/README.md> | JavaScript package usage, CLI commands, Node requirement, cache path, environment variables. |
| <https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/js/package.json> | Package metadata, Node engine, peer dependency versions. |
| <https://github.com/microsoft/playwright-mcp> | Playwright MCP standard config, Codex config, CLI flags, `--executable-path`, config file schema. |
| <https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md> | Compact Playwright MCP README text and option table. |
| <https://github.com/Yeachan-Heo/gajae-code> | Gajae-Code positioning as an external coding-agent harness, install path, skills/workflow surface, and "works beside" boundaries. |
| <https://raw.githubusercontent.com/Yeachan-Heo/gajae-code/main/README.md> | Compact Gajae-Code README text for GJC setup, skill migration, and paired-agent boundary. |

## CloakBrowser Node Setup

Current JavaScript install path:

```bash
npm install cloakbrowser@latest playwright-core@latest
```

The JavaScript README documents:

- install with `npm install cloakbrowser playwright-core`
- first launch auto-downloads the stealth Chromium binary into `~/.cloakbrowser/`
- CLI commands:

```bash
npx cloakbrowser install
npx cloakbrowser info
npx cloakbrowser update
npx cloakbrowser clear-cache
```

- utility imports such as `ensureBinary`, `binaryInfo`, and `checkForUpdate`
- Node.js >= 20 requirement
- `playwright-core` >= 1.53 peer dependency

## CloakBrowser JavaScript Usage

Basic Playwright-style use:

```javascript
import { launch } from 'cloakbrowser';

const browser = await launch({
  humanize: true,
  headless: true
});
const page = await browser.newPage();
await page.goto('https://example.com');
console.log(await page.title());
await browser.close();
```

CloakBrowser docs show `humanize: true` for human-like mouse, keyboard, and scroll behavior. For this skill, `humanize: true` is mandatory on every CloakBrowser JavaScript API launch. Other anti-bot-related options such as `proxy`, `geoip`, or `headless: false` remain conditional: use them only when the user requested them, the use is authorized, and the failing layer warrants them.

Persistent context pattern:

```javascript
import { launchPersistentContext } from 'cloakbrowser';

const ctx = await launchPersistentContext({
  userDataDir: './chrome-profile',
  humanize: true,
  headless: false
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://example.com');
await ctx.close();
```

## Humanize Requirement and MCP Caveat

This skill must not claim human-like mouse, keyboard, or scroll behavior unless the actual CloakBrowser launch path includes `humanize: true` or a CloakBrowser-aware bridge explicitly proves that it preserved humanization.

The Playwright MCP README documents flags such as `--executable-path` and `--headless`; the relevant documented flag set here does not provide a `--humanize` switch. Therefore:

- `npx @playwright/mcp@latest --executable-path /path/to/cloakbrowser/chrome` proves that MCP is pointed at the CloakBrowser executable.
- It does not, by itself, prove that the CloakBrowser JavaScript wrapper ran with `humanize: true`.
- For live action-heavy tasks where humanization is required, use a CloakBrowser JS API driver or a CloakBrowser-aware MCP bridge that can evidence `humanize: true`; otherwise report the limitation as a blocker.

## Binary and Version Notes

CloakBrowser's docs describe the wrapper as open source and the binary as a delayed free-release model:

- free binary around Chromium 146
- Pro/current builds around Chromium 148 at the verification date
- `CLOAKBROWSER_LICENSE_KEY` or `licenseKey` enables Pro downloads
- exact binary versions can be pinned with `CLOAKBROWSER_VERSION` or `browserVersion`
- a local binary can be forced with `CLOAKBROWSER_BINARY_PATH`

Example pin:

```bash
export CLOAKBROWSER_VERSION=146.0.7680.177.5
```

Example local binary override:

```bash
export CLOAKBROWSER_BINARY_PATH=~/.cloakbrowser/chromium-146.0.7680.177.4/chrome
```

The user-requested MCP pattern remains valid as an executable path pattern:

```bash
npx @playwright/mcp --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

Prefer `@latest` for fresh MCP installs unless a project pins package versions:

```bash
npx @playwright/mcp@latest --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

If the user explicitly asks for `headless false`, headed, or visible browsing, omit `--headless`:

```bash
npx @playwright/mcp@latest --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

## Playwright MCP Setup

Standard MCP config from the Playwright MCP README:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Codex TOML config pattern:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]
```

CloakBrowser-backed Codex config should add `--executable-path` and use an absolute path:

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--executable-path", "/Users/you/.cloakbrowser/chromium-146.0.7680.177.3/chrome"]
```

## Client Setup Patterns

Use the same Playwright MCP server command everywhere; only the client wrapper changes.

### Direct Command

```bash
npx @playwright/mcp@latest --headless --executable-path /absolute/path/to/chrome
```

### Codex

Codex can use `~/.codex/config.toml`:

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--executable-path", "/absolute/path/to/chrome"]
```

### Claude Code

The Playwright MCP README documents:

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

For CloakBrowser, use the same shape with this skill's name and args:

```bash
claude mcp add cloak-browser npx @playwright/mcp@latest --headless --executable-path /absolute/path/to/chrome
```

### Cursor and Other JSON MCP Clients

Cursor and many MCP clients can use standard JSON:

```json
{
  "mcpServers": {
    "cloak-browser": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--executable-path", "/absolute/path/to/chrome"]
    }
  }
}
```

### Gajae-Code

Gajae-Code's README describes `gjc` as an external coding-agent harness that runs beside existing tools such as Codex CLI and Claude Code. It exposes workflow skills and advises inspecting/installing bundled defaults with commands such as `gjc skills list`, `gjc skills read`, and `gjc setup defaults --check`.

For this skill, do not assume a GJC-specific MCP config file unless the local installation documents one. Make the skill usable in GJC by keeping it as a normal skill folder, then apply the MCP config to the underlying MCP-capable client used with the GJC session.

## Playwright MCP Options Relevant Here

The Playwright MCP README lists these relevant flags:

| Flag | Use |
|---|---|
| `--executable-path` | Path to the browser executable. |
| `--headless` | Run browser in headless mode; headed is Playwright MCP's default. This skill adds it by default and omits it only for explicit visible/headed requests. |
| `--user-data-dir` | Persist browser profile data between sessions. |
| `--storage-state` | Load cookies/local storage into an isolated context. |
| `--config` | Load MCP configuration from a JSON file. |
| `--allowed-origins` | Allow browser requests to trusted origins; not a security boundary. |
| `--blocked-origins` | Block browser requests to origins; evaluated before allowlist and not a complete security boundary. |
| `--device` | Emulate a named device such as `iPhone 15`. |

The config file schema also allows `browser.launchOptions.executablePath`, but the direct `--executable-path` flag is simpler for this skill's default path.

The relevant Playwright MCP options above do not include a documented `--humanize` flag. Keep humanization evidence separate from executable path evidence.

## Missing Setup Repair

When the skill is loaded for an operational browser task and setup is missing, repair it in this order:

1. Check `node --version` and require Node.js >= 20.
2. Check `npm --version`.
3. Install `cloakbrowser@latest` and `playwright-core@latest` in the selected setup workspace.
4. Run `npx cloakbrowser install`.
5. Run `npx cloakbrowser info`.
6. Confirm `npx @playwright/mcp@latest --help` can run.
7. Resolve the executable with `scripts/resolve-cloak-mcp.mjs`.

If network access or package installation is blocked, follow the environment's approval/escalation policy. Do not pretend setup succeeded.

## Safety Caveats

- CloakBrowser does not grant authorization to access, scrape, or automate a site.
- Do not store `CLOAKBROWSER_LICENSE_KEY`, proxy credentials, cookies, or session state in this skill folder.
- Do not use this skill for unauthorized evasion or account abuse.
- Prefer explicit user authorization and a narrow target before enabling persistent profiles or proxies. Humanization stays enabled for this skill, but it does not expand authorization or safety boundaries.
