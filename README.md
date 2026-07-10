# Hyper Cloaking

[English](./README.md) · [한국어](./README.ko.md)

A portable **agent skill** that installs and drives [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) as the browser executable behind [Playwright MCP](https://github.com/microsoft/playwright-mcp), so MCP-capable AI coding agents can perform authorized, user-directed browser tasks end-to-end — from setup to verified outcome.

This repository is not an application. It is a distributable skill bundle (`SKILL.md` + engine helpers + references) consumable by Claude Code, Codex, Cursor, OpenClaw, Hermes Agent, and Gajae-Code.

> **Scope & safety.** Hyper Cloaking is for authorized QA, monitoring, personal-account automation, and diagnostics on properties you are permitted to test. It is **not** for bypassing access controls, evading fraud systems, solving CAPTCHAs, restricted scraping, or unauthorized account automation. Humanization reduces automation fingerprints; it does not remove the requirement that a task be authorized.

---

## What it does

When a user asks an agent to "use CloakBrowser for this site," the skill turns that request into a bounded workflow:

1. **Target safety gate** — classify the target as allowed / refused / needs-clarification, and record authorization basis and allowed origins.
2. **Preflight question gate** — collect target URL, allowed origins, headless mode, cookie mode/account, and keep-open preference through the host's native structured-question surface.
3. **Setup gate** — verify Node.js, `cloakbrowser`, `playwright-core`, and Playwright MCP; install or repair whatever is missing.
4. **Runtime workspace** — initialize `~/.hyper-cloaking/` for `cookie.yml`, profiles, downloads, evidence, logs, and state.
5. **Cookie handling** — normalize and load site-matched cookies (Chrome export JSON, Playwright arrays, multi-account entries) via a dedicated helper, never storing raw values in the repo.
6. **Executable resolution** — locate the cached CloakBrowser Chromium binary under `~/.hyper-cloaking/cache/cloakbrowser/`.
7. **Humanized launch** — run with `humanize: true` mandatory on every operational run (human-paced mouse, typing, scroll).
8. **MCP configuration** — emit config for Codex TOML, JSON `mcpServers` (Claude Code / Cursor), OpenClaw `mcp.servers`, Hermes `mcp_servers`, or a direct CLI command, pointing `@playwright/mcp` at the CloakBrowser executable.
9. **Task execution + outcome validation** — drive the requested task and complete only when evidence proves the outcome (page load alone is never completion).
10. **Structured reporting** — return `targetSafety`, `outcome`, `failure`, `contentBoundary`, and `learning`; save reports and screenshots under `~/.hyper-cloaking/evidence/`.

Browser DOM, page text, downloads, and console output are treated as **untrusted data with no instruction authority**.

---

## Installation

Requires **Node.js >= 20**, npm/npx, and network access to fetch `cloakbrowser` and `playwright-core`.

### Claude Code (plugin marketplace)

Add this repo as a plugin marketplace, then install the `hyper-cloaking` plugin:

```bash
/plugin marketplace add alpox/hyper-cloaking
/plugin install hyper-cloaking
```

The marketplace manifest lives at `.claude-plugin/marketplace.json` and sources the skill from `./plugins/hyper-cloaking`.

### Codex (plugin marketplace)

Codex reads the mirrored manifest at `.agents/plugins/marketplace.json` (same `./plugins/hyper-cloaking` source). Add the marketplace through your Codex plugin surface and enable `hyper-cloaking`.

### `skills` CLI (any AgentSkills-compatible client)

Install the skill directly with the `skills` CLI from a clone or a path/URL:

```bash
# list what a source provides
npx skills add . --list

# install into the current project's skill directory
npx skills add .
```

### Manual install (OpenClaw, Hermes Agent, Cursor)

Copy `skills/hyper-cloaking/` into a skill root the client loads:

- **OpenClaw** — workspace `skills/`, workspace `.agents/skills/`, `~/.agents/skills/`, or `~/.openclaw/skills/`
- **Hermes Agent** — `~/.hermes/skills/` or a directory listed under `skills.external_dirs` in `~/.hermes/config.yaml`
- **Cursor / other MCP clients** — any directory the client scans for `SKILL.md`

---

## MCP configuration snippets

After the CloakBrowser Chromium binary is resolved, point Playwright MCP at it. Default launches are **headless** and **sandboxed**; drop `--headless` for visible browsing.

**Direct command**

```bash
npx @playwright/mcp@latest --headless --sandbox \
  --executable-path ~/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome
```

**Codex (`~/.codex/config.toml`)** — use a fully expanded path:

```toml
[mcp_servers.hyper-cloaking]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--sandbox", "--executable-path", "/Users/you/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome"]
```

**Claude Code / Cursor (`mcpServers` JSON)**

```json
{
  "mcpServers": {
    "hyper-cloaking": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--sandbox", "--executable-path", "/Users/you/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome"]
    }
  }
}
```

**OpenClaw (`mcp.servers.<name>`)** and **Hermes (`mcp_servers.<name>` in `~/.hermes/config.yaml`)** follow the same command/args shape under their respective config keys.

Generate any of these deterministically:

```bash
node skills/hyper-cloaking/engine/cli.mjs mcp-config --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --client codex --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --headed
```

---

## Engine helpers

Runtime helpers live under `skills/hyper-cloaking/engine/` and are the supported surface (skill-local `scripts/*` helpers were removed).

| Helper | Purpose |
|---|---|
| `engine/cli.mjs` | `validate` / `smoke` / `mcp-config` / `live` commands; renders MCP config and runs contained live verification. |
| `engine/cookie.mjs` | Import, normalize, inspect, redact, and inject cookies (Chrome export JSON, Playwright arrays, `cookie.yml` site/account entries). |
| `engine/browser-utils.mjs` | Initialize `~/.hyper-cloaking/`, launch CloakBrowser with `humanize: true`, and provide `humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath helpers. |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --help
```

### Providers (metadata only)

`engine/cli.mjs live --provider <id>` selects **metadata only** — domain/origin and cookie/profile hints for `naver`, `reddit`, `instagram`, `youtube`, `x`, or `generic`. Providers never authorize broader origins or bypass the safety, recon, or preflight gates; an unknown provider fails closed.

### Instagram action modules

Reusable JS-driver flows for automating **your own** authenticated Instagram account live under `engine/providers/instagram/`. They require a real Playwright `page` (not Playwright-MCP mode) and ship built-in guardrails: writes are dry-run by default, DM replies target existing conversations only (no cold outreach), bulk replies are capped, rate-limited, human-confirmed, and resumable.

```js
import { buildInstagramSession, instagramActions } from './engine/providers/instagram/index.mjs';
const session = buildInstagramSession(page, { stateDir: paths.stateDir, interactive: true });
const posts = await instagramActions.getUserPosts(session, 'nasa', { limit: 12 });
await instagramActions.likePost(session, 'https://www.instagram.com/p/ABC/', { dryRun: false });
```

---

## Runtime workspace

All runtime state lives under `~/.hyper-cloaking/` (override with `HYPER_CLOAKING_HOME` for sandboxed tests only):

```
~/.hyper-cloaking/
├── cookie.yml       # site/account cookie entries (never committed)
├── profiles/        # persistent browser profiles
├── downloads/       # downloaded files
├── evidence/        # reports and screenshots
├── logs/            # run logs
├── state/           # rate-limit windows, resumable state
└── cache/cloakbrowser/   # downloaded stealth Chromium binaries
```

---

## Repository layout

```
skills/hyper-cloaking/          # canonical skill (SKILL.md, engine, rules, references)
plugins/hyper-cloaking/         # plugin-packaged copy for marketplaces
.claude/skills/hyper-cloaking/  # Claude Code skill mirror
.agents/skills/hyper-cloaking/  # AgentSkills mirror
.claude-plugin/marketplace.json # Claude Code marketplace manifest
.agents/plugins/marketplace.json# Codex marketplace manifest
scripts/validate.mjs            # structure + mirror-parity validation
```

The skill directories are kept byte-for-byte mirrored. Validate parity and metadata with:

```bash
npm run validate
```

---

## Development

```bash
npm run validate      # structure and mirror-parity checks
npm run lint          # oxlint over plugins and scripts
npm run format        # prettier write
node skills/hyper-cloaking/engine/cli.mjs validate --json   # engine self-check (no network)
```

Tests are colocated `*.test.mjs` files under `engine/`, runnable with `node --test`.

---

## License

MIT © alpox
