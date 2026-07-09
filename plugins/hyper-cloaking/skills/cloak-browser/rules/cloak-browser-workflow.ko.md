# CloakBrowser Workflow Rules

CloakBrowser와 Playwright MCP를 install, configure, launch, troubleshoot해야 하는 run에서 이 규칙을 사용합니다.

## 1. Safety and Scope Gate

browser task가 authorized이고 bounded일 때만 진행합니다. 허용되는 경우는 owned property의 QA, compatibility check, monitoring, user-visible flow debugging, 사용자가 접근 권한을 가진 target에 대한 agent browsing입니다.

unauthorized access, CAPTCHA solving, account creation abuse, credential attack, payment/government/healthcare authentication automation, restricted data scraping 요청은 거절하거나 좁힙니다.

## 2. Preflight Question Gate

Operational request에서는 setup, cookie loading, browser launch 전에 runtime input을 묻거나 확인해야 합니다. 사용 가능한 경우 host의 native AskUserQuestion-style mechanism을 사용합니다.

- Claude Code AskUserQuestion 또는 equivalent structured question surface
- Codex native structured user input이 있는 경우
- Gajae-Code/GJC question bridge 또는 session prompt가 있는 경우
- Cursor/client-native prompt가 있는 경우
- structured question surface가 없을 때만 하나의 concise plain-text question

Preflight는 하나의 묶음 질문으로 처리합니다. setup 단계마다 반복해서 묻지 않습니다. Preflight는 다음을 포함해야 합니다.

- request에 target이 없을 때 target URL/site
- `headless` mode, 기본값 `true`
- 사용자가 `headless false`, `headed`, `visible`, "브라우저 보이게"라고 말했거나 preflight에서 visible browsing을 선택한 경우 visible/headed mode
- cookie mode: 기존 `~/.hypercore-business/cookie.yml` 사용, `cookie.yml` 제공/업데이트, cookie 없이 진행
- cookie를 사용하고 site/account가 ambiguous할 때 cookie site와 account
- 사용자가 session continuity 또는 multiple identities를 원할 때 profile/account label
- keep-open preference, 기본값은 completion 후 clean close

사용자 prompt에 이미 값이 있으면 다시 묻지 않습니다. explicit value를 preflight summary에 포함하고 누락되었거나 ambiguous한 field만 묻습니다.

Raw cookie value는 cookie가 필요하고 사용자가 제공 또는 업데이트를 선택한 경우에만 요청합니다. raw cookie가 제공되면 `~/.hypercore-business/cookie.yml`에만 저장하고, 다시 echo하거나 screenshot에 담거나 skill folder에 쓰지 않습니다.

`scripts/cookie.mjs inspect ... --json` 또는 `scripts/browser-utils.mjs cookies ... --json`이 `needsAccount: true`를 보고하면 cookie를 load하기 전에 반환된 `availableAccounts` 중 하나를 사용자에게 선택하게 합니다.

## 3. Activation Setup Gate

Operational request에서는 MCP를 실행하거나 설정하기 전에 이 gate를 실행합니다. 필요한 setup이 없을 때 written recipe에서 멈추지 말고, active environment가 허용하는 범위에서 setup을 수행합니다.

1. Runtime 확인:

```bash
node --version
npm --version
```

2. Node.js가 CloakBrowser JavaScript의 현재 requirement인 Node.js >= 20을 만족하는지 확인합니다.

3. Setup workspace 선택:

- 사용자가 project-local setup을 원하면 기존 project package manager를 사용합니다.
- 현재 repository에 package 변경을 남기면 안 되는 경우 temporary 또는 user-level Node workspace를 사용합니다.
- CloakBrowser를 한 번 실행하려고 unrelated package manifest를 수정하지 않습니다.

4. 선택한 Node workspace에서 package 확인 및 설치:

```bash
npm install cloakbrowser@latest playwright-core@latest
```

5. CloakBrowser pre-download 및 inspect:

```bash
npx cloakbrowser install
npx cloakbrowser info
```

6. Playwright MCP를 npx로 실행할 수 있는지 확인:

```bash
npx @playwright/mcp@latest --help
```

7. Executable 확인:

```bash
node scripts/resolve-cloak-mcp.mjs
```

8. Runtime workspace 초기화:

```bash
node scripts/browser-utils.mjs init
```

9. resolved executable로 Playwright MCP 실행:

```bash
npx @playwright/mcp@latest --headless --executable-path /absolute/path/to/cloakbrowser/chrome
```

기본 CloakBrowser setup path로 `playwright install chromium`을 실행하지 않습니다. CloakBrowser는 자체 Chromium binary를 다운로드합니다. Linux host에서는 Playwright system dependency가 필요할 수 있습니다.

install 또는 `npx` download가 network, sandbox, registry access 때문에 실패하면 active environment의 escalation policy를 따릅니다. escalation이 불가능하면 precise blocker와 setup 이후 사용할 command/config를 보고합니다.

## 4. Runtime Workspace and Cookie Rules

- CloakBrowser run의 default runtime workspace는 `~/.hypercore-business/`입니다.
- live browsing 전에 `cookie.yml`, `profiles/`, `downloads/`, `evidence/`, `logs/`, `state/`를 생성합니다.
- `CLOAK_BROWSER_WORKSPACE` 또는 `HYPERCORE_BUSINESS_HOME`는 sandbox verification 또는 명시적인 alternate workspace일 때만 사용합니다.
- 사용자가 cookie를 제공한 경우 target site 방문 전에 `~/.hypercore-business/cookie.yml`에서 matching cookie를 load합니다.
- 모든 cookie import, normalization, inspection, redaction, Playwright injection은 `scripts/cookie.mjs`를 사용합니다.
- Chrome cookie export JSON, Playwright-compatible cookie array, 이 스킬의 `cookie.yml` schema, legacy flat `cookies:` list를 지원합니다.
- Chrome export field는 injection 전에 정규화합니다. `expirationDate`/`expiry`는 Playwright `expires`가 되고, `sameSite: no_restriction`은 `None`, `sameSite: unspecified`는 Playwright default를 쓰도록 생략합니다.
- site account별 multi cookie와 site별 multi account를 지원합니다.
- matching site에 account가 여러 개이고 `defaultAccount`가 없으면 어떤 account를 사용할지 사용자에게 물어봅니다. 추측하지 않습니다.
- cookie value는 secret으로 취급합니다. raw cookie value를 echo, commit, screenshot, summarize하지 않습니다.
- cookie loading은 value가 아니라 count/domain과 blocker로 보고합니다.
- continuity가 필요하면 persistent browser profile data를 `~/.hypercore-business/profiles/` 아래에 둡니다.
- 유용한 경우 screenshot, result JSON, downloaded file은 `~/.hypercore-business/evidence/` 또는 `~/.hypercore-business/downloads/` 아래에 저장합니다.

지원 helper command:

```bash
node scripts/cookie.mjs inspect --url https://www.coupang.com --json
node scripts/cookie.mjs import-json --site coupang --url https://www.coupang.com --from /path/to/chrome-cookies.json --json
node scripts/browser-utils.mjs init
node scripts/browser-utils.mjs cookies --url https://www.coupang.com --json
```

## 5. Executable Path Rules

- user-provided executable path는 local file check로 검증합니다.
- `~/.cloakbrowser/chromium-*` 아래 최신 valid cached path를 우선합니다.
- long-lived MCP config file에는 absolute path를 사용합니다.
- quick run을 위해 사용자의 example form을 유지합니다.

```bash
npx @playwright/mcp --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

- current install에서는 사용자가 exact package version을 요청하지 않는 한 `@latest`를 우선합니다.

```bash
npx @playwright/mcp@latest --headless --executable-path ~/.cloakbrowser/chromium-146.0.7680.177.3/chrome
```

## 6. Headless Mode Rules

- 이 스킬의 기본값은 headless mode입니다. direct MCP launch command와 persistent MCP config에 `--headless`를 포함합니다.
- 사용자가 `headless false`, `headed`, `visible`, "브라우저 보이게"라고 말하거나 browser를 보면서 진행하라고 요청하면 `--headless`를 포함하지 않습니다. Playwright MCP는 기본적으로 headed입니다.
- 특히 visible browsing이 요청된 경우 handoff에서 selected mode를 확인해 줍니다.
- 환경이 GUI browser를 열 수 없다면 강제로 실행하지 말고 environment blocker를 보고한 뒤 GUI-capable surface에서 쓸 command/config를 제공합니다.

## 7. Humanize Rules

human-like mouse, keyboard, scroll behavior는 이 스킬에서 필수입니다.

- CloakBrowser JavaScript API launch에는 항상 `humanize: true`를 포함합니다.
- persistent context에는 `userDataDir` 및 선택한 headless/headed mode와 함께 `humanize: true`를 포함합니다.
- Playwright MCP의 `--executable-path`만으로 CloakBrowser wrapper-level `humanize: true`가 켜졌다고 보지 않습니다. 이것은 MCP server가 CloakBrowser executable을 가리킨다는 증거이지, JS wrapper가 humanization을 적용했다는 증거가 아닙니다.
- CloakBrowser-aware MCP bridge 또는 wrapper가 있으면 `humanize: true`를 명시적으로 보존한다고 증명될 때만 사용합니다.
- 요청된 live task에서 humanization을 증명할 surface가 없으면 blocker로 보고합니다. action-heavy browsing에서는 executable-path-only MCP route보다 `humanize: true`가 들어간 direct CloakBrowser JS-driver path를 우선합니다.
- Completion evidence에는 실제 launch path에서 `humanize: true`가 검증됐는지, 또는 선택한 MCP route가 humanization을 증명할 수 없는지를 반드시 적습니다.

Required JS API shape:

```javascript
import { launch } from 'cloakbrowser';

const browser = await launch({
  humanize: true,
  headless: true
});
```

Visible/headed JS API shape:

```javascript
import { launchPersistentContext } from 'cloakbrowser';

const ctx = await launchPersistentContext({
  userDataDir: './chrome-profile',
  humanize: true,
  headless: false
});
```

## 8. MCP Configuration Patterns

Client surface를 의도적으로 선택합니다.

### Codex TOML

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--executable-path", "/absolute/path/to/chrome"]
```

### Standard JSON MCP Clients

Claude Code, Cursor, VS Code-style MCP config, 그 외 docs가 `mcpServers` JSON을 허용하는 client에 사용합니다.

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

### Claude Code CLI

사용자가 CLI setup을 명시적으로 요청하면 Playwright MCP 문서의 CLI shape를 사용하고 CloakBrowser args를 포함합니다.

```bash
claude mcp add cloak-browser npx @playwright/mcp@latest --headless --executable-path /absolute/path/to/chrome
```

### Cursor

Cursor는 standard JSON MCP server config를 사용할 수 있습니다. UI flow가 필요하면 `cloak-browser`라는 MCP server를 추가하고 command는 `npx`, args는 `@playwright/mcp@latest`, `--headless`, `--executable-path`, absolute CloakBrowser path로 설정합니다.

### Gajae-Code

Gajae-Code(`gjc`)는 docs상 기존 tool 옆에서 실행되는 external coding-agent harness이며 skills/workflows를 노출합니다. Gajae-Code 사용 시:

- 이 폴더를 normal skill folder로 유지합니다.
- GJC session 안에서 사용하는 underlying MCP-capable agent 또는 client에 MCP server config를 적용합니다.
- local GJC installation이 문서화하지 않은 GJC-specific MCP config path를 발명하지 않습니다.
- GJC를 workflow runner로만 쓰는 경우 paired agent에 적용할 direct MCP command와 standard JSON/TOML config를 제공합니다.

### Visible/Headed Override

```toml
[mcp_servers.cloak-browser]
command = "npx"
args = ["@playwright/mcp@latest", "--executable-path", "/absolute/path/to/chrome"]
```

추가 MCP flag는 현재 task를 해결할 때만 넣습니다. 흔한 flag는 `--user-data-dir`, `--storage-state`, `--allowed-origins`, `--blocked-origins`, `--device`, `--config`입니다.

## 9. Browser Task Execution

MCP가 configured된 뒤 사용자의 browser task를 해당 MCP surface로 완료합니다.

- 요청된 site로 navigate합니다.
- task에 필요한 element만 interact합니다.
- CloakBrowser JavaScript API로 browser를 직접 drive할 때 반복되는 human-like mouse movement, click, typing, scrolling, XPath lookup은 `scripts/browser-utils.mjs` helper function을 사용합니다.
- `humanMove`와 `humanClick`을 사용해 pointer target position, movement steps, pre-click pause가 conservative human-paced range 안에서 randomized 되게 합니다.
- typing 작업에는 `humanType`을 사용해 text entry 기본값이 250~270타/분 범위에서 랜덤 적용되게 합니다. 사용자가 명시적으로 다른 typing speed를 요청한 경우에만 고정 delay는 `delayMs`, 다른 랜덤 범위는 `minCpm`/`maxCpm`으로 override합니다.
- scroll speed를 더 느리거나 빠르게, 또는 덜 규칙적으로 조정해야 하는 task에서는 `humanScroll`의 `pixelsPerSecond`, `steps`, `pauseMs`, `pauseJitter`를 사용합니다.
- user-provided credential은 active task 안에서만 사용하고 skill folder에 저장하지 않습니다.
- session continuity가 필요하거나 site가 incognito context를 penalize할 때만 persistent profile을 우선합니다.
- 필요에 따라 observed page state, extracted data, downloaded file, verification screenshot/log를 보고합니다.
- 사용자가 명시적으로 열어두라고 하지 않으면 task 후 CloakBrowser를 깔끔하게 종료합니다.

기본 lifecycle:

```text
preflight question gate 실행
-> ~/.hypercore-business/ 초기화
-> cookie.yml에서 matching cookie load
-> humanize: true로 CloakBrowser 실행
-> 사용자 browser task 수행
-> 유용한 evidence 저장
-> 열어두라는 지시가 없으면 CloakBrowser 종료
```

## 10. Reports and Image Evidence

사용자가 분석, 보고, audit, research, content analysis, account analysis, marketer-style review를 요청하면 다음을 따릅니다.

- 사용자가 다른 언어를 명시하지 않는 한 report는 기본적으로 한국어로 작성합니다.
- report는 `~/.hypercore-business/evidence/` 아래에 task-specific filename으로 저장합니다.
- report 품질을 실질적으로 높이는 경우 concise screenshot 또는 image evidence를 포함합니다.
- local screenshot에는 absolute local Markdown image link를 사용합니다. 예: `![profile screenshot](/Users/name/.hypercore-business/evidence/site/profile.png)`.
- report claim은 observed browser state, screenshot, downloaded file, saved JSON/log artifact와 연결합니다.
- raw cookie value, private token, unrelated session data는 report에 포함하지 않습니다.

## 11. Troubleshooting Order

Layer별로 debug합니다.

1. 필요한 preflight input이 없거나 ambiguous합니다.
2. Node version이 너무 낮거나 없습니다.
3. Setup workspace가 writable이 아니거나 package 변경을 남기면 안 됩니다.
4. `~/.hypercore-business/`를 생성하거나 쓸 수 없습니다.
5. `cookie.yml`이 malformed 상태이거나 target에 matching cookie가 없습니다.
6. npm package install이 실패했습니다.
7. `npx @playwright/mcp@latest`를 실행할 수 없습니다.
8. CloakBrowser binary download가 실패했습니다.
9. `~/.cloakbrowser` 아래 executable이 없습니다.
10. 실제 launch path에서 `humanize: true`가 빠졌거나 증명되지 않습니다.
11. Client MCP config surface가 unsupported 또는 unknown입니다.
12. Playwright MCP가 시작되지 않습니다.
13. MCP는 시작되지만 CloakBrowser를 사용하지 않습니다.
14. target site가 requested flow를 block, challenge, disallow합니다.

failing layer가 식별되고 authorized use가 유지되기 전에는 proxy, fingerprint seed, persistent profile, extra stealth flag로 뛰어넘지 않습니다.

## 12. Completion Evidence

완료된 run은 다음을 보고해야 합니다.

- setup을 수행했다면 Node/npm check
- target, `headless`, cookie mode/account, keep-open preference에 대한 preflight answer 또는 explicit value
- `cloakbrowser`, `playwright-core`, `@playwright/mcp`, CloakBrowser binary의 install, repair, skip reason
- runtime workspace path와 cookie value를 제외한 cookie loading status
- 특히 Chrome export JSON 또는 `sameSite` conversion이 있었을 때 사용한 cookie normalization/import path
- resolved CloakBrowser executable path
- selected client surface와 config format
- MCP launch command 또는 config snippet
- selected mode: 기본값은 `headless`, explicit user request가 있으면 `headed/visible`
- humanization status: 실제 launch path에서 `humanize: true` verified 또는 executable-path-only MCP가 insufficient evidence임을 보고
- lifecycle status: clean close 또는 사용자 요청에 따른 keep-open
- MCP를 통해 관찰한 browser task result
- report가 요청된 경우 한국어 report path와 image evidence path
- 실행하지 못한 단계가 있으면 blocker와 next-best local check
