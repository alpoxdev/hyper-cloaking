---
name: cloak-browser
description: "Use this skill when the user asks Claude Code, Codex, Gajae-Code, Cursor, or another MCP-capable agent to install, configure, or drive web browsing through CloakBrowser with Playwright MCP, including automatic missing-setup repair, Node-based setup, cached Chromium executable discovery, MCP server launch/config snippets, and end-to-end browser task execution. Do not use for ordinary stock-browser automation, generic Playwright tests, or unauthorized bot-detection evasion."
compatibility: Claude Code, Codex, Gajae-Code skill workflows, Cursor, and other MCP-capable clients; requires Node.js, npm/npx, the `cloakbrowser` package, `playwright-core`, and Playwright MCP. CloakBrowser JavaScript currently requires Node.js >= 20.
---

@rules/cloak-browser-workflow.md
@references/cloakbrowser-playwright-mcp.md
@references/runtime-workspace.md

# Cloak Browser

<output_language>

Respond to the user in Korean by default. Preserve package names, CLI commands, config keys, file paths, source URLs, and code identifiers in their original language.

</output_language>

<purpose>

Install and operate CloakBrowser as the browser executable behind Playwright MCP so Claude Code, Codex, Gajae-Code workflows, Cursor, or another MCP-capable agent can complete user-directed browser tasks through CloakBrowser from setup to verification. Every operational run must keep CloakBrowser humanization enabled (`humanize: true`) or report that the chosen MCP surface cannot prove humanization. Runtime state, cookies, downloads, profiles, logs, and evidence live under `~/.hypercore-business/` by default. Before setup or browsing starts, run a preflight question gate using the host's native AskUserQuestion-style surface when available so cookie mode, headless mode, target, account, and keep-open preferences are explicit. This skill turns a user request such as "CloakBrowser로 이 사이트 처리해줘" into a bounded workflow: verify the preflight answers, verify Node, initialize the runtime workspace, install missing packages when needed, load site cookies when supplied, download CloakBrowser when needed, resolve the cached Chromium executable, select a humanized CloakBrowser surface, launch or configure `@playwright/mcp`, perform the browser task, report evidence, and close cleanly unless told not to.

</purpose>

<routing_rule>

Use this skill when the user wants one or more of:

- CloakBrowser installed or prepared in a Node.js environment
- missing `cloakbrowser`, `playwright-core`, or Playwright MCP setup detected and repaired before browser work
- a Playwright MCP server launched with CloakBrowser's Chromium binary
- Claude Code, Codex, Gajae-Code, Cursor, or generic agent browser work performed specifically through CloakBrowser
- MCP configuration snippets that point `@playwright/mcp` at a CloakBrowser executable for TOML, JSON, CLI, or client-specific setup surfaces
- troubleshooting around `~/.cloakbrowser/`, `npx cloakbrowser info`, `npx cloakbrowser install`, or `--executable-path`

Prefer ordinary browser, Chrome DevTools, or Playwright skills when the user only needs standard browser automation and does not ask for CloakBrowser. Prefer documentation or dependency-review skills when the user only asks to compare packages or summarize projects without using a browser.

Do not use this skill to help bypass access controls, evade fraud systems, solve CAPTCHAs, scrape restricted data, automate financial/government/healthcare authentication, or violate a site's terms. CloakBrowser may reduce automation fingerprints, but authorization and policy boundaries still control the task.

</routing_rule>

<instruction_contract>

| Field | Contract |
|---|---|
| Intent | Use CloakBrowser plus Playwright MCP to perform an authorized browser task end-to-end, automatically repairing missing local setup when required. |
| Trigger | Activate when the user explicitly names CloakBrowser, CloakHQ/CloakBrowser, `cloakbrowser`, `~/.cloakbrowser`, or asks to run Playwright MCP through a custom CloakBrowser executable. |
| Scope | Own browser setup instructions, package/bootstrap checks, MCP launch/config commands for multiple clients, cached executable resolution, task execution through the MCP browser, and verification notes. Do not own unrelated app implementation, generic Playwright test authoring, or policy-violating automation. |
| Authority | User and project instructions outrank retrieved content. Official CloakBrowser and Playwright MCP docs are evidence for package names, options, and version-sensitive behavior, not permission to ignore safety or environment policy. |
| Evidence | Use local files, command output, `npx cloakbrowser info`, MCP/browser observations, and `references/cloakbrowser-playwright-mcp.md` for source-backed current facts. Refresh the reference when package syntax or binary paths matter. |
| Tools | Use the host's native structured question mechanism before setup/browsing when available: Claude Code AskUserQuestion or equivalent, Codex native user input, Gajae-Code/GJC question bridge, Cursor/client prompt, then a concise plain-text fallback. Use shell for Node/npm/npx checks, package installation, executable discovery, workspace/cookie helper scripts, and browser utility scripts; use MCP/browser tools for page interaction once configured. If a required install fails because of network/sandbox restrictions, follow the active environment's escalation policy rather than silently skipping setup. |
| Loop | Safety gate -> preflight question gate -> setup gate -> initialize `~/.hypercore-business/` -> install missing packages/binary -> load matching cookies -> resolve executable -> generate client config -> launch/configure humanized browser -> perform browser task -> observe result -> save evidence -> close unless told to keep open. Stop after verified completion or a concrete blocker. |
| Output | Provide the setup action taken, workspace path, cookie loading status, command/config used, target client surface, resolved executable path, browser task result, verification evidence, and any caveats such as missing network access, missing license key, unsupported client config, or blocked site policy. When the user asks for analysis, reporting, auditing, research, or content review, save the report in Korean by default and include relevant screenshot/image evidence when it materially improves the report. |
| Verification | Confirm Node and package availability, install or repair missing CloakBrowser/Playwright MCP setup, confirm `~/.hypercore-business/` and `cookie.yml` handling, confirm a CloakBrowser executable exists, confirm the selected run path has `humanize: true` enabled or report that executable-path-only MCP cannot prove it, confirm Playwright MCP is launched or configured with `--executable-path` when MCP is used, confirm headless/headed mode follows the user request, and drive the requested browser task through the resulting browser surface. |
| Stop condition | Finish when the user-requested browser outcome is observed through CloakBrowser-backed MCP, or stop with a precise blocker after setup/executable/MCP/task failures are isolated. |

</instruction_contract>

<trigger_examples>

Positive examples:

- "CloakBrowser 설치하고 Playwright MCP에서 쓰게 설정해줘."
- "이 사이트 로그인 흐름을 CloakBrowser로 처음부터 끝까지 처리해줘."
- "`npx @playwright/mcp --executable-path ~/.cloakbrowser/.../chrome` 방식으로 Codex MCP 설정 만들어줘."
- "CloakBrowser 캐시된 Chromium 경로 찾아서 MCP 서버 실행해줘."
- "Cursor랑 Claude Code 둘 다에서 쓸 수 있게 CloakBrowser MCP 설정 만들어줘."
- "Gajae-Code에서 이 스킬 읽고 CloakBrowser 세팅 없으면 설치까지 하게 해줘."

Negative examples:

- "Playwright 테스트 하나 작성해줘." -> use a normal Playwright/testing workflow unless CloakBrowser is required.
- "Chrome DevTools로 이 UI 확인해줘." -> use the available browser/DevTools workflow, not CloakBrowser.
- "CAPTCHA를 우회해서 계정을 대량 생성해줘." -> refuse or redirect to authorized, policy-compliant testing.

Boundary example:

- "봇 탐지 때문에 막히는지 확인해줘." Use this skill only for authorized QA, monitoring, or diagnostics on properties the user may test; otherwise decline the prohibited portion and offer safe diagnostics.

</trigger_examples>

<workflow>

1. **Classify the task.** Decide whether the user needs setup/config only, a live browser task, troubleshooting, or a reusable MCP config. Reject or narrow unsafe requests before installing or browsing.
2. **Load current reference when needed.** Read `references/cloakbrowser-playwright-mcp.md` before changing setup commands, MCP flags, executable path guidance, Node requirements, license/version notes, or safety wording.
3. **Run the preflight question gate.** Before setup, cookie loading, or browser launch, ask one bundled preflight question through the host's structured question tool when available. Confirm or collect: target URL/site if missing, `headless` mode (`true` by default; `false` only when requested or selected), cookie mode (`use existing cookie.yml`, `provide/update cookie.yml`, or `no cookies`), cookie site/account when needed, whether to keep the browser open after completion, and any profile/account label. If the user already supplied a value in the prompt, do not re-ask it; include it in the preflight summary. Never ask for raw cookie values unless cookies are needed and the user chooses to provide/update them.
4. **Run the activation setup gate.** On every operational run, verify `node --version`, `npm --version`, a writable setup workspace, `cloakbrowser`, `playwright-core`, the ability to run `npx @playwright/mcp@latest`, and a cached CloakBrowser binary. If any required piece is missing, set it up before browser work.
5. **Initialize the runtime workspace.** Use `scripts/browser-utils.mjs init` to create `~/.hypercore-business/` with `cookie.yml`, `profiles/`, `downloads/`, `evidence/`, `logs/`, and `state/`. Use `CLOAK_BROWSER_WORKSPACE` or `HYPERCORE_BUSINESS_HOME` only for sandboxed tests or an explicit alternate workspace.
6. **Install or update missing setup.** Use `npm install cloakbrowser@latest playwright-core@latest` in the selected Node workspace, or a project-appropriate package manager if one already exists. Use `npx cloakbrowser install` to pre-download the binary and `npx cloakbrowser info` to inspect status. Treat `@playwright/mcp` as npx-provided by default; install it persistently only if the target client requires local package resolution.
7. **Normalize and load site cookies when supplied.** Use `scripts/cookie.mjs` as the standard path for cookie import, normalization, inspection, redaction, and injection. Read `~/.hypercore-business/cookie.yml` and apply cookies matching the target URL before the site-specific flow. Support site-specific multi-cookie and multi-account entries, Chrome cookie export JSON, Playwright-compatible cookie arrays, `expirationDate`/`expires`/`expiry`, `sameSite: no_restriction`, and `sameSite: unspecified`. If a matching site has multiple accounts and no default account, ask which account to use before loading cookies. Never store real cookies in the skill folder. Use `references/runtime-workspace.md` for the supported cookie schema.
8. **Resolve the executable path.** Prefer `npx cloakbrowser info` or `scripts/resolve-cloak-mcp.mjs --json`. If a user provides an explicit path, validate it exists before use. Typical Linux-style paths look like `~/.cloakbrowser/chromium-146.0.7680.177.3/chrome`; macOS paths may point inside `Chromium.app`.
9. **Select the humanized browser surface.** `humanize: true` is mandatory for this skill. When using the CloakBrowser JavaScript API directly or through a bridge, pass `humanize: true` to `launch()` or `launchPersistentContext()`. Treat plain `npx @playwright/mcp@latest --executable-path ...` as a CloakBrowser-binary MCP route, not proof that CloakBrowser wrapper-level humanization is active. If no CloakBrowser-aware MCP bridge or JS-driver path can prove `humanize: true`, report that blocker instead of claiming full compliance.
10. **Select the client surface.** Use Codex TOML for Codex, standard JSON `mcpServers` for Claude Code/Cursor-style MCP clients, the documented client CLI when requested, and the same generic MCP command/config for Gajae-Code sessions because Gajae-Code runs beside existing agents rather than becoming their extension.
11. **Launch or configure Playwright MCP.** Default to headless mode by adding `--headless`. If the user explicitly says `headless false`, `headed`, `visible`, or asks to watch the browser, omit `--headless` so Playwright MCP opens a visible browser window. Start with the direct command:

```bash
npx @playwright/mcp@latest --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

For Codex config, use a fully expanded executable path rather than relying on `~` expansion:

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--executable-path", "/Users/you/.cloakbrowser/chromium-146.0.7680.177.3/chrome"]
```

12. **Perform the browser task through the selected surface.** Navigate, click, fill, extract, or verify exactly what the user requested. Keep the browser context bounded to the requested site and task. Prefer a humanized CloakBrowser JS-driver path for action-heavy work when Playwright MCP cannot prove `humanize: true`. Reuse `scripts/browser-utils.mjs` helpers for human-like move/click/type/scroll and XPath lookup. Use `humanMove`/`humanClick` so pointer target position, move steps, and pre-click pause use human-paced randomized defaults. Use `humanType` for text entry so typing defaults to a randomized 250-270 characters per minute unless the user requests another pace. Use `humanScroll` with `pixelsPerSecond`, `steps`, `pauseMs`, or `pauseJitter` when scroll speed needs tuning.
13. **Clean lifecycle flow.** Default flow is: launch CloakBrowser -> perform the user's request -> save useful evidence -> close CloakBrowser cleanly. If the user says not to close, keep the browser open and report the active profile/workspace.
14. **Write Korean reports when requested.** If the user asks for analysis, a report, audit, research, account/content analysis, or marketer-style review, save a Korean Markdown report under `~/.hypercore-business/evidence/`. Include concise screenshot or image evidence when useful, using absolute local Markdown image links, and reference any supporting JSON/log artifacts without exposing cookies or secrets.
15. **Verify the outcome.** Record the preflight answers or explicit values, setup gate result, workspace path, cookie loading status, executable path, humanization evidence, MCP launch/config, selected client, final page state or extracted result, report path when created, and any console/network/task observations relevant to completion.
16. **Troubleshoot by layer.** If setup fails, isolate preflight ambiguity, Node/package/workspace/cookie/download/path/humanize/MCP/client-config/site-policy separately. Do not add unrelated stealth flags or proxies unless the user requested them and the use is authorized.
17. **Report concisely.** Include setup performed or skipped, commands used, files/config changed, humanization status, cookie status, observed result, report/evidence path when created, and unresolved risks.

</workflow>

<support_file_read_order>

1. Read `rules/cloak-browser-workflow.md` when executing setup, MCP launch, live browsing, or troubleshooting.
2. Read `references/runtime-workspace.md` when using `~/.hypercore-business/`, `cookie.yml`, profiles, evidence paths, `scripts/cookie.mjs`, or `scripts/browser-utils.mjs`.
3. Read `references/cloakbrowser-playwright-mcp.md` when current package syntax, executable path behavior, source provenance, Node requirements, client config surfaces, or safety/license caveats matter.
4. Run `node scripts/resolve-cloak-mcp.mjs --help`, `node scripts/cookie.mjs --help`, and `node scripts/browser-utils.mjs --help` before using the helpers for the first time.

</support_file_read_order>

<helper_script>

`scripts/resolve-cloak-mcp.mjs` is an optional deterministic helper for local setup checks. It does not install packages or launch a browser. It locates likely CloakBrowser Chromium executables under `~/.cloakbrowser`, prints the recommended Playwright MCP command, and can emit JSON for automation:

```bash
node scripts/resolve-cloak-mcp.mjs --json
node scripts/resolve-cloak-mcp.mjs --executable ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
node scripts/resolve-cloak-mcp.mjs --headed
node scripts/resolve-cloak-mcp.mjs --client codex --json
node scripts/resolve-cloak-mcp.mjs --client json --json
```

`scripts/cookie.mjs` is the standard cookie helper. It imports, normalizes, inspects, redacts, and loads cookies for Playwright. Use it for Chrome cookie export JSON, Playwright-compatible cookie arrays, and `cookie.yml` site/account entries instead of ad hoc conversion:

```bash
node scripts/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node scripts/cookie.mjs import-json --site instagram --url https://www.instagram.com/example/ --from /path/to/chrome-cookies.json --json
```

`scripts/browser-utils.mjs` is the runtime helper library. It initializes `~/.hypercore-business/`, creates `cookie.yml` when missing, delegates matching cookie normalization/loading to `scripts/cookie.mjs`, launches CloakBrowser with `humanize: true`, and exports utility functions for randomized mouse movement, click pause, typing, configurable-speed scroll, and XPath lookup. `humanType` defaults to a randomized 250-270 characters per minute:

```bash
node scripts/browser-utils.mjs init
node scripts/browser-utils.mjs cookies --url https://www.coupang.com --json
```

</helper_script>

<required>

- Verify authorization and task boundary before using stealth or anti-detection tooling.
- Before setup or browsing for an operational request, run the preflight question gate. Prefer Claude Code AskUserQuestion/equivalent, Codex native structured user input, Gajae-Code/GJC question bridge, Cursor/client prompts, or another host-native structured question surface. Use one concise plain-text question only when no structured surface exists.
- Preflight must cover `headless` (`true` default, `false` for visible browsing), cookie mode, cookie site/account if needed, target URL/site if missing, profile/account label when relevant, and whether to keep CloakBrowser open after completion. Do not re-ask values already explicit in the user's request.
- On activation for an operational request, do not stop at instructions when setup is missing. Check prerequisites and install/download missing `cloakbrowser`, `playwright-core`, and CloakBrowser binary before launching MCP, subject to the active environment's network/install approval policy.
- Use `~/.hypercore-business/` as the default runtime workspace. Initialize it before live browsing and use it for `cookie.yml`, profiles, downloads, evidence, logs, and state.
- Load user-supplied site cookies from `~/.hypercore-business/cookie.yml` before target-site work when matching cookies exist.
- Use `scripts/cookie.mjs` for cookie import, normalization, inspection, redaction, and Playwright injection. Do not hand-convert Chrome cookie exports or echo raw cookie values.
- Prefer Node-based setup: `npm install cloakbrowser@latest playwright-core@latest`, `npx cloakbrowser install`, and `npx cloakbrowser info`.
- Keep CloakBrowser humanization on for every operational run: use `humanize: true` in CloakBrowser JS API launches, or use a CloakBrowser-aware MCP bridge that explicitly proves humanization. Do not treat `--executable-path` alone as proof of `humanize: true`.
- Use `humanMove` and `humanClick` for pointer work so target position, movement steps, and pre-click pause use human-paced randomized defaults. Override `minSteps`/`maxSteps`, `minRatio`/`maxRatio`, or `minBeforeClickMs`/`maxBeforeClickMs` only when a task needs tighter control.
- Use the browser utility `humanType` for typing work so the default typing pace is randomized between 250 and 270 characters per minute. Override with `delayMs` for a fixed delay or `minCpm`/`maxCpm` for another randomized range only when the user explicitly asks for a different speed.
- Use `humanScroll` with `pixelsPerSecond`, `steps`, `pauseMs`, or `pauseJitter` when a task needs slower, faster, or less regular scrolling.
- Use `npx @playwright/mcp@latest` for Playwright MCP by default; add persistent package installation only when a client cannot invoke npx.
- Use Playwright MCP with `--executable-path` pointing at the resolved CloakBrowser Chromium executable.
- Support at least these client surfaces: Codex TOML, standard JSON `mcpServers` for Claude Code/Cursor-style clients, documented client CLI add commands when requested, and Gajae-Code skill/session usage with generic MCP config applied to the underlying MCP-capable agent.
- Default Playwright MCP launches to headless mode with `--headless`; remove `--headless` when the user explicitly requests `headless false`, headed, or visible browsing.
- Use fully expanded paths in persistent MCP config files.
- Keep setup facts source-backed and refresh `references/cloakbrowser-playwright-mcp.md` when package behavior changes.
- Drive the final user task through the CloakBrowser-backed browser surface when the request is operational, not just configuration.
- For analysis, report, audit, research, account/content analysis, or marketer-style review requests, write the report artifact in Korean by default under `~/.hypercore-business/evidence/` and include useful screenshot/image evidence with absolute local Markdown links when it improves the report.
- Close CloakBrowser cleanly after the task unless the user explicitly says to keep the browser open.

</required>

<forbidden>

- Do not claim CloakBrowser is active unless the executable path or MCP config/launch proves it.
- Do not claim human-like mouse, keyboard, or scroll behavior is active unless `humanize: true` is present in the CloakBrowser launch path or a CloakBrowser-aware bridge proves it.
- Do not use CloakBrowser for unauthorized evasion, credential abuse, restricted scraping, or account automation.
- Do not store license keys, proxy credentials, cookies, or session files in the skill folder.
- Do not commit or echo real cookie values from `~/.hypercore-business/cookie.yml`; report cookie counts/domains instead of secrets.
- Do not treat `--allowed-origins` or `--blocked-origins` as security boundaries; they are MCP request filters with documented limitations.
- Do not run broad package installs in unrelated repositories when a temporary Node workspace is enough.
- Do not hide setup failures by falling back to stock Chromium without telling the user.

</forbidden>

<validation>

Before completion, check:

- [ ] Request fits setup/config/live authorized browser use through CloakBrowser.
- [ ] Positive/negative/boundary trigger behavior remains clear.
- [ ] Preflight question gate ran before setup/browser launch, or was explicitly satisfied by values already present in the user's request.
- [ ] Preflight captured or confirmed target, `headless`, cookie mode, cookie site/account when needed, and keep-open preference without exposing raw cookie values.
- [ ] Node version is checked when executing setup; Node.js >= 20 is required for CloakBrowser JS.
- [ ] Missing `cloakbrowser`, `playwright-core`, CloakBrowser binary, or Playwright MCP runtime is installed/repaired or a precise network/permission blocker is reported.
- [ ] `~/.hypercore-business/` is initialized, or a precise filesystem permission blocker is reported.
- [ ] `cookie.yml` was checked and matching cookies were loaded when present, without exposing cookie values.
- [ ] Cookie import/normalization ran through `scripts/cookie.mjs`, including Chrome export fields such as `expirationDate`, `sameSite: no_restriction`, and `sameSite: unspecified` when present.
- [ ] `cloakbrowser`, `playwright-core`, and `@playwright/mcp` commands/config use current source-backed syntax.
- [ ] Target client surface is selected: Codex TOML, standard JSON, Claude Code/Cursor CLI, Gajae-Code session guidance, or direct command.
- [ ] CloakBrowser executable path exists or the blocker is reported precisely.
- [ ] `humanize: true` is enabled and evidenced for the actual CloakBrowser launch path, or executable-path-only MCP is explicitly reported as insufficient to prove humanization.
- [ ] MCP launch/config includes `--executable-path`.
- [ ] MCP launch/config includes `--headless` by default, or omits it when the user explicitly requested visible/headed browsing.
- [ ] Operational tasks are manually driven through the CloakBrowser-backed MCP browser and the observed result is reported.
- [ ] Analysis/report requests produced a Korean report artifact and relevant screenshot/image evidence when images materially improved the report.
- [ ] CloakBrowser is closed cleanly unless the user explicitly requested it remain open.
- [ ] Source-sensitive claims are mapped to `references/cloakbrowser-playwright-mcp.md`.

</validation>
