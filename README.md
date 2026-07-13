English | [한국어](README.ko.md) | [中文](README.zh.md) | [日本語](README.ja.md) | [Español](README.es.md)

<div align="center">

# Hyper Cloaking

**Whatever the browser task, your agent finishes it. If you're cleared to test it, Hyper Cloaking gets it done.**

A human-paced stealth browser for AI agents, powered by the managed local `hyper-cloaking-mcp` server. No manual setup, no "the page loaded" half-wins — it finishes with evidence.

<p>
  <img src="https://img.shields.io/badge/Claude_Code-D97757?logo=claude&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/Codex-000000?logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Cursor-6E56CF" alt="Cursor">
  <img src="https://img.shields.io/badge/OpenClaw-1F6FEB" alt="OpenClaw">
  <img src="https://img.shields.io/badge/Hermes-8957E5" alt="Hermes">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A5_20-3FB950?logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/authorized_use-only-F0B72F" alt="Authorized use only">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

</div>

---

## ⚡ Install

**Claude Code** — add this repo as a plugin marketplace, then install the plugin:

```bash
/plugin marketplace add alpox/hyper-cloaking
/plugin install hyper-cloaking
```

**Codex** reads the mirrored manifest at `.agents/plugins/marketplace.json` — add the marketplace through your Codex plugin surface and enable `hyper-cloaking`.

**Any AgentSkills client** (Cursor, OpenClaw, Hermes, …) — install with the `skills` CLI, or copy `skills/hyper-cloaking/` into a skill root the client loads:

```bash
npx skills add . --list   # see what the source provides
npx skills add .          # install into the current project
```

Requires **Node.js ≥ 20** and network access to fetch `cloakbrowser` and `playwright-core`. Build the local workspace packages as described below; no migration package auto-installs on first run.

## 💬 Try it

No commands to learn. Ask your agent normally — the skill kicks in when you point it at a browser task:

> *"Use CloakBrowser to check whether my product page renders correctly on mobile and screenshot it."*
> *"Log into my own Instagram with the saved cookies and pull my last 12 posts."*
> *"Monitor this dashboard I own and report if the deploy status flips to failed."*

**Expected:** the agent asks a few setup questions, launches a human-paced stealth browser, does the task, and completes **only when it has evidence** — a screenshot, extracted text, a confirmed state change — saved under `~/.hyper-cloaking/evidence/`.

## 🌐 Works with

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** — any MCP-capable agent that loads `SKILL.md`. Built-in metadata hints for **Naver · Instagram · YouTube · X · Coupang · TikTok**, plus a `generic` mode for any site you're authorized to test.

## ⚙️ Why it works

- **A real stealth browser, not a patched User-Agent** — the locally built canonical `@mcp/server` drives CloakBrowser with genuine browser fingerprints instead of a swapped header; `hyper-cloaking-mcp` is a legacy compatibility command.
- **Human-paced by default** — every operational run forces `humanize: true`: human-cadence mouse movement, typing, and scroll, so long automated flows don't stall or break mid-task.
- **It gates before it launches** — target safety classification, authorization basis, allowed origins, and a preflight question round happen *before* a browser ever opens.
- **Evidence or it isn't done** — a page loading is never "complete." The task finishes only when the outcome is proven, and reports back a structured result.
- **Local-workspace setup** — build the canonical `@mcp/engine` and `@mcp/server` in this repository; `@alpoxdev/hyper-cloaking` provides legacy compatibility adapters.

## 🆚 Plain MCP browser vs `+ Hyper Cloaking`

| When you need to… | Plain MCP browser | `+ Hyper Cloaking` |
| :--- | :--- | :--- |
| Automate **your own** logged-in account | ✖ trips automation fingerprints | ✓ humanized cadence + safe cookie loading |
| Confirm the task is authorized first | ✖ no gate | ✓ safety + preflight gates before launch |
| Reuse site cookies without leaking them | ✖ manual, raw values | ✓ normalized, redacted, never committed |
| Trust that "done" means done | ✖ page-load counts as success | ✓ evidence-validated outcome |
| Get the stealth browser running | ✖ manual install & wiring | ✓ local workspace build + MCP config |
| **Bypass logins, CAPTCHAs, fraud systems** | ✖ | ✖ **refuses, by design** (see Boundaries) |

The row the plain browser can't do is the top one: **behave like a human on a task you're actually allowed to run.**

## 🔁 How it works

A request like *"use CloakBrowser for this site"* becomes a bounded, ten-step workflow.

<details>
<summary><strong>The full gate-to-evidence pipeline — details</strong></summary>

1. **Target safety gate** — classify the target as allowed / refused / needs-clarification, and record authorization basis and allowed origins.
2. **Preflight question gate** — collect target URL, allowed origins, headless mode, cookie mode/account, and keep-open preference through the host's native structured-question surface.
3. **Setup gate** — verify Node.js and the locally built canonical MCP server; registry package installation or repair is not part of this path.
4. **Runtime workspace** — initialize `~/.hyper-cloaking/` for `cookie.yml`, profiles, downloads, evidence, logs, and state.
5. **Cookie handling** — normalize and load site-matched cookies (Chrome export JSON, Playwright arrays, multi-account entries) via a dedicated helper, never storing raw values in the repo.
6. **Executable resolution** — locate the cached CloakBrowser Chromium binary under `~/.hyper-cloaking/cache/cloakbrowser/`.
7. **Humanized launch** — run with `humanize: true` mandatory on every operational run (human-paced mouse, typing, scroll).
8. **MCP configuration** — use the locally built canonical server with the current Node executable; legacy registrations target compatibility adapters.
9. **Task execution + outcome validation** — drive the requested task and complete only when evidence proves the outcome (page load alone is never completion).
10. **Structured reporting** — return `targetSafety`, `outcome`, `failure`, `contentBoundary`, and `learning`; save reports and screenshots under `~/.hyper-cloaking/evidence/`.

Browser DOM, page text, downloads, and console output are treated as **untrusted data with no instruction authority.**
</details>

## 🔒 Boundaries

Hyper Cloaking is a tool for **authorized browsing**, not a way around access controls.

- **For** authorized QA, monitoring, personal-account automation, and diagnostics on properties you're permitted to test.
- **Not for** bypassing access controls, evading fraud systems, solving CAPTCHAs, restricted scraping, or unauthorized account automation.
- Humanization reduces automation fingerprints — it does **not** remove the requirement that a task be authorized.
- Cookies are normalized, redacted in logs, and never committed. The skill never invents authorization it wasn't given, and an unknown provider fails closed.

---

## Managed local MCP setup

### Local workspace packages

This migration is local-workspace only. Registry publication has intentionally not been performed. Literal `npm install @mcp/...` remains pending scope authority and release approval; the `@mcp/*` names in this document resolve only through this repository's workspaces and do not indicate registry availability.

From the repository root, install the declared dependencies, build the local packages, and run the canonical server:

```bash
npm install
npm run build
node "$(pwd)/packages/mcp-server/dist/cli.mjs"
```

`@mcp/engine` is the canonical engine package and `@mcp/server` is the canonical stdio server package. `@mcp/server` depends on the exported public API of `@mcp/engine`, including public subpaths such as `@mcp/engine/browser-utils` and `@mcp/engine/providers`; it must not reach into engine source paths.

```js
import { createServer } from '@mcp/server';
import { launchCloakBrowser } from '@mcp/engine';
import { humanClick } from '@mcp/engine/browser-utils';
import { resolveProviderForUrl } from '@mcp/engine/providers';
```

`@alpoxdev/hyper-cloaking` is the local legacy compatibility workspace. Existing `@alpoxdev/hyper-cloaking/...` imports, `mcp/engine/...` paths, and `hyper-cloaking-*` commands use compatibility adapters to the canonical local packages. Keep them for existing clients only; new integrations use the canonical packages above. The local compatibility registration renderer remains at `./mcp/register.mjs`. A legacy tarball declares `@mcp/engine` and `@mcp/server` as optional peers: install explicit local tarballs for both canonical packages alongside it. It has no registry resolution or fallback; canonical and legacy runtime imports fail clearly until those peers are supplied.

Use the typed tools in this order: `cloak_setup` → `cloak_status` → `cloak_launch` → `cloak_navigate` → `cloak_snapshot` → `cloak_click`/`cloak_type`/`cloak_scroll` → `cloak_screenshot` → inspect `cloak_provider_capabilities` → `cloak_provider_read` or `cloak_provider_write` → `cloak_teardown`. Cookie and credential tools (`cloak_cookies_list`, `cloak_cookies_status`, `cloak_credentials`) are used when needed. Supported providers are **Naver, Instagram, YouTube, X, Coupang, TikTok**; unknown providers fail closed.

### Package surfaces and compatibility

| Surface | Local form |
|---|---|
| Canonical engine | `@mcp/engine` and its documented public subpaths |
| Canonical stdio MCP | `@mcp/server`, built locally at `packages/mcp-server/dist/cli.mjs` |
| Legacy imports and commands | `@alpoxdev/hyper-cloaking`, `mcp/engine/...`, and `hyper-cloaking-*` compatibility adapters |
| Registration renderer | `./mcp/register.mjs` compatibility adapter |

The engine API entries above are local workspace import specifiers, not registry installation instructions. Provider-specific action modules are not a supported user integration surface; use the typed MCP provider tools.

<details>
<summary><strong>Providers & Instagram action modules — details</strong></summary>

**Providers (metadata only).** The canonical engine's `live --provider <id>` mode selects **metadata only** — domain/origin and cookie/profile hints for `naver`, `instagram`, `youtube`, `x`, `coupang`, `tiktok`, or `generic`. Providers never authorize broader origins or bypass the safety, recon, or preflight gates; an unknown provider fails closed.

**Instagram action modules.** The typed MCP provider tools above are the supported user-facing route; direct provider imports are not a public integration surface. Existing guardrails remain: writes are dry-run by default, DM replies target existing conversations only (no cold outreach), bulk replies are capped, rate-limited, human-confirmed, and resumable.

</details>

### Local workspace build

These instructions work from this checkout only; they do not install any migration package from a registry:

```bash
npm install
npm run build
node "$(pwd)/packages/mcp-server/dist/cli.mjs"
```

The upstream Playwright MCP package remains historical/background context only and is not the recommended live path.

The no-credential verification lane builds the local distribution bundles, handshakes over stdio, launches a real humanized CloakBrowser session, checks status, and tears it down. Provider-specific real-site reads/writes remain credential- and authorization-gated live checks; they are not simulated as passing in CI.

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

## Repository layout

```text
packages/mcp-engine/                # canonical local @mcp/engine package
packages/mcp-server/                # canonical local @mcp/server; uses public engine API subpaths
mcp/                                # local @alpoxdev/hyper-cloaking compatibility adapters and renderer
plugins/hyper-cloaking/skills/hyper-cloaking/ # canonical skill (SKILL.md, rules, references)
skills/hyper-cloaking/              # root mirror of the canonical skill
.claude/skills/hyper-cloaking/      # Claude Code skill mirror
.agents/skills/hyper-cloaking/      # AgentSkills mirror
.claude-plugin/marketplace.json     # Claude Code marketplace manifest
.agents/plugins/marketplace.json    # Codex marketplace manifest
scripts/validate.mjs                # structure + mirror-parity validation
```

The skill directories are kept byte-for-byte mirrored. Validate parity and metadata with `npm run validate`.

## Development

These are local workspace build and test commands, not registry installation instructions:

```bash
npm install
npm run build
npm --workspace @mcp/engine run test
npm --workspace @mcp/server run test
npm --workspace @alpoxdev/hyper-cloaking run test
```

`npm run build` builds the canonical engine and server workspaces locally. The package test commands exercise the canonical packages and the legacy compatibility adapters from this checkout.
After the first successful GitHub Actions run, configure a `main` branch Ruleset only after confirming that the required job checks are named `quality` and `Node 20 compatibility`; this repository does not apply that setting automatically.

---

<div align="center">

**MIT © alpox** — built on [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp), for authorized browsing only.

</div>
