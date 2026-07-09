# CloakBrowser + Playwright MCP Reference

Last verified: 2026-07-08.

current package syntax, setup command, executable path behavior, source-sensitive caveat가 필요할 때 이 reference를 사용합니다. CloakBrowser, `@playwright/mcp`, Node requirement가 바뀌면 refresh합니다.

## Sources

| Source | What it supports |
|---|---|
| <https://github.com/CloakHQ/CloakBrowser> | Main README, install command, free/pro binary note, troubleshooting, latest release note. |
| <https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/js/README.md> | JavaScript package usage, CLI command, Node requirement, cache path, environment variable. |
| <https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/js/package.json> | Package metadata, Node engine, peer dependency version. |
| <https://github.com/microsoft/playwright-mcp> | Playwright MCP standard config, Codex config, CLI flag, `--executable-path`, config file schema. |
| <https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md> | Compact Playwright MCP README text and option table. |
| <https://github.com/Yeachan-Heo/gajae-code> | Gajae-Code가 external coding-agent harness라는 위치, install path, skills/workflow surface, "works beside" boundary. |
| <https://raw.githubusercontent.com/Yeachan-Heo/gajae-code/main/README.md> | GJC setup, skill migration, paired-agent boundary에 대한 compact README text. |

## CloakBrowser Node Setup

현재 JavaScript install path:

```bash
npm install cloakbrowser@latest playwright-core@latest
```

JavaScript README는 다음을 문서화합니다.

- `npm install cloakbrowser playwright-core`로 설치
- first launch가 stealth Chromium binary를 `~/.cloakbrowser/`에 auto-download
- CLI commands:

```bash
npx cloakbrowser install
npx cloakbrowser info
npx cloakbrowser update
npx cloakbrowser clear-cache
```

- `ensureBinary`, `binaryInfo`, `checkForUpdate` 같은 utility import
- Node.js >= 20 requirement
- `playwright-core` >= 1.53 peer dependency

## CloakBrowser JavaScript Usage

기본 Playwright-style 사용:

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

CloakBrowser docs는 human-like mouse, keyboard, scroll behavior를 위해 `humanize: true`를 보여줍니다. 이 스킬에서는 모든 CloakBrowser JavaScript API launch에 `humanize: true`가 필수입니다. `proxy`, `geoip`, `headless: false` 같은 다른 anti-bot 관련 option은 conditional입니다. 사용자가 요청했고, authorized use이며, failing layer가 해당 option을 필요로 할 때만 사용합니다.

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

이 스킬은 실제 CloakBrowser launch path에 `humanize: true`가 있거나 CloakBrowser-aware bridge가 humanization 보존을 명시적으로 증명하지 않는 한 human-like mouse, keyboard, scroll behavior가 active라고 주장하지 않습니다.

Playwright MCP README는 `--executable-path`, `--headless` 같은 flag를 문서화합니다. 여기서 관련된 documented flag set에는 `--humanize` switch가 없습니다. 따라서:

- `npx @playwright/mcp@latest --executable-path /path/to/cloakbrowser/chrome`는 MCP가 CloakBrowser executable을 가리킨다는 것을 증명합니다.
- 이것만으로 CloakBrowser JavaScript wrapper가 `humanize: true`로 실행됐다고 증명하지 않습니다.
- humanization이 필수인 live action-heavy task에서는 `humanize: true`를 evidence로 남길 수 있는 CloakBrowser JS API driver 또는 CloakBrowser-aware MCP bridge를 사용합니다. 그렇지 않으면 limitation을 blocker로 보고합니다.

## Binary and Version Notes

CloakBrowser docs는 wrapper를 open source로, binary를 delayed free-release model로 설명합니다.

- free binary는 Chromium 146 계열
- verification date 기준 Pro/current build는 Chromium 148 계열
- `CLOAKBROWSER_LICENSE_KEY` 또는 `licenseKey`로 Pro download 활성화
- exact binary version은 `CLOAKBROWSER_VERSION` 또는 `browserVersion`으로 pin 가능
- local binary는 `CLOAKBROWSER_BINARY_PATH`로 강제 가능

Pin example:

```bash
export CLOAKBROWSER_VERSION=146.0.7680.177.5
```

Local binary override example:

```bash
export CLOAKBROWSER_BINARY_PATH=~/.cloakbrowser/chromium-146.0.7680.177.4/chrome
```

사용자가 요청한 MCP pattern은 executable path pattern으로 유효합니다.

```bash
npx @playwright/mcp --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

project가 package version을 pin하지 않았다면 fresh MCP install에는 `@latest`를 우선합니다.

```bash
npx @playwright/mcp@latest --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

사용자가 명시적으로 `headless false`, headed, visible browsing을 요청하면 `--headless`를 생략합니다.

```bash
npx @playwright/mcp@latest --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

## Playwright MCP Setup

Playwright MCP README의 standard MCP config:

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

CloakBrowser-backed Codex config는 `--executable-path`를 추가하고 absolute path를 사용해야 합니다.

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--executable-path", "/Users/you/.cloakbrowser/chromium-146.0.7680.177.3/chrome"]
```

## Client Setup Patterns

어디서든 같은 Playwright MCP server command를 사용하고, client wrapper만 바뀝니다.

### Direct Command

```bash
npx @playwright/mcp@latest --headless --executable-path /absolute/path/to/chrome
```

### Codex

Codex는 `~/.codex/config.toml`을 사용할 수 있습니다.

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--executable-path", "/absolute/path/to/chrome"]
```

### Claude Code

Playwright MCP README는 다음을 문서화합니다.

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

CloakBrowser에는 같은 shape에 이 스킬의 name과 args를 사용합니다.

```bash
claude mcp add cloak-browser npx @playwright/mcp@latest --headless --executable-path /absolute/path/to/chrome
```

### Cursor and Other JSON MCP Clients

Cursor와 많은 MCP client는 standard JSON을 사용할 수 있습니다.

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

Gajae-Code README는 `gjc`를 Codex CLI, Claude Code 같은 기존 tool 옆에서 실행되는 external coding-agent harness로 설명합니다. 또한 workflow skills를 노출하고 `gjc skills list`, `gjc skills read`, `gjc setup defaults --check` 같은 command로 bundled defaults를 inspect/install하라고 안내합니다.

이 스킬에서는 local installation이 문서화하지 않은 GJC-specific MCP config file을 가정하지 않습니다. GJC에서 사용할 수 있게 normal skill folder로 유지하고, GJC session과 함께 쓰는 underlying MCP-capable client에 MCP config를 적용합니다.

## Playwright MCP Options Relevant Here

Playwright MCP README에는 다음 relevant flag가 있습니다.

| Flag | Use |
|---|---|
| `--executable-path` | browser executable path. |
| `--headless` | browser를 headless mode로 실행합니다. Playwright MCP의 default는 headed입니다. 이 스킬은 기본적으로 `--headless`를 추가하고, explicit visible/headed request일 때만 생략합니다. |
| `--user-data-dir` | session 간 browser profile data를 persist합니다. |
| `--storage-state` | cookies/local storage를 isolated context에 load합니다. |
| `--config` | JSON file에서 MCP configuration을 load합니다. |
| `--allowed-origins` | browser request를 trusted origins로 allow합니다. security boundary가 아닙니다. |
| `--blocked-origins` | origins request를 block합니다. allowlist보다 먼저 평가되지만 complete security boundary가 아닙니다. |
| `--device` | `iPhone 15` 같은 named device를 emulate합니다. |

Config file schema도 `browser.launchOptions.executablePath`를 허용하지만, 이 스킬의 default path에는 direct `--executable-path` flag가 더 단순합니다.

위 relevant Playwright MCP option에는 documented `--humanize` flag가 없습니다. humanization evidence는 executable path evidence와 분리해서 다룹니다.

## Missing Setup Repair

스킬이 operational browser task로 load되었고 setup이 없으면 다음 순서로 복구합니다.

1. `node --version`을 확인하고 Node.js >= 20을 요구합니다.
2. `npm --version`을 확인합니다.
3. 선택한 setup workspace에 `cloakbrowser@latest`와 `playwright-core@latest`를 설치합니다.
4. `npx cloakbrowser install`을 실행합니다.
5. `npx cloakbrowser info`를 실행합니다.
6. `npx @playwright/mcp@latest --help`가 실행 가능한지 확인합니다.
7. `scripts/resolve-cloak-mcp.mjs`로 executable을 확인합니다.

network access 또는 package installation이 막히면 environment의 approval/escalation policy를 따릅니다. setup 성공을 가장하지 않습니다.

## Safety Caveats

- CloakBrowser는 site access, scraping, automation에 대한 authorization을 제공하지 않습니다.
- `CLOAKBROWSER_LICENSE_KEY`, proxy credential, cookie, session state를 이 skill folder에 저장하지 않습니다.
- unauthorized evasion 또는 account abuse에 이 스킬을 사용하지 않습니다.
- persistent profile 또는 proxy는 explicit user authorization과 narrow target이 있을 때 우선합니다. humanization은 이 스킬에서 항상 켜지만, authorization 또는 safety boundary를 확장하지 않습니다.
