[English](README.md) | 한국어 | [中文](README.zh.md) | [日本語](README.ja.md) | [Español](README.es.md)

<div align="center">

# Hyper Cloaking

**어떤 브라우저 작업이든, 에이전트가 끝까지 해냅니다. 테스트 권한만 있다면 Hyper Cloaking이 끝냅니다.**

[CloakBrowser](https://github.com/CloakHQ/CloakBrowser)를 [Playwright MCP](https://github.com/microsoft/playwright-mcp) 뒤에서 구동하는, AI 에이전트를 위한 사람 속도의 스텔스 브라우저. 수동 설정도, "페이지는 떴어요" 식의 절반짜리 성공도 없이 — 증거로 완료합니다.

<p>
  <img src="https://img.shields.io/badge/Claude_Code-D97757?logo=claude&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/Codex-000000?logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Cursor-6E56CF" alt="Cursor">
  <img src="https://img.shields.io/badge/OpenClaw-1F6FEB" alt="OpenClaw">
  <img src="https://img.shields.io/badge/Hermes-8957E5" alt="Hermes">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A5_20-3FB950?logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/authorized_use-only-F0B72F" alt="허가된 용도 전용">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

</div>

---

## ⚡ 설치

**Claude Code** — 이 저장소를 플러그인 마켓플레이스로 추가한 뒤 플러그인을 설치합니다.

```bash
/plugin marketplace add alpox/hyper-cloaking
/plugin install hyper-cloaking
```

**Codex**는 미러링된 매니페스트 `.agents/plugins/marketplace.json`을 읽습니다 — Codex 플러그인 인터페이스에서 마켓플레이스를 추가하고 `hyper-cloaking`을 활성화하세요.

**AgentSkills 호환 클라이언트**(Cursor, OpenClaw, Hermes 등) — `skills` CLI로 설치하거나 `skills/hyper-cloaking/`를 클라이언트가 로드하는 스킬 루트에 복사합니다.

```bash
npx skills add . --list   # 소스가 제공하는 항목 확인
npx skills add .          # 현재 프로젝트에 설치
```

**Node.js ≥ 20**과 `cloakbrowser`·`playwright-core`를 받을 네트워크 접근이 필요합니다. 나머지는 스킬이 첫 실행에서 설치·복구합니다.

## 💬 이렇게 써보세요

배울 명령어는 없습니다. 에이전트에게 평소처럼 요청하면, 브라우저 작업을 가리키는 순간 스킬이 작동합니다.

> *"CloakBrowser로 내 제품 페이지가 모바일에서 제대로 렌더링되는지 확인하고 스크린샷 찍어줘."*
> *"저장된 쿠키로 내 인스타그램에 로그인해서 최근 게시물 12개 가져와줘."*
> *"내가 운영하는 이 대시보드를 지켜보다가 배포 상태가 실패로 바뀌면 알려줘."*

**예상 결과:** 에이전트가 설정 질문 몇 가지를 던지고, 사람 속도의 스텔스 브라우저를 실행해 작업을 수행한 뒤, **증거가 있을 때만** 완료합니다 — 스크린샷, 추출된 텍스트, 확인된 상태 변화가 `~/.hyper-cloaking/evidence/`에 저장됩니다.

## 🌐 어디서 동작하나

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** — `SKILL.md`를 로드하는 MCP 지원 에이전트라면 무엇이든. **Naver · Reddit · Instagram · YouTube · X**에 대한 내장 메타데이터 힌트를 제공하며, 테스트 권한이 있는 임의의 사이트에는 `generic` 모드를 지원합니다.

## ⚙️ 왜 통하는가

- **패치된 User-Agent가 아니라 진짜 스텔스 브라우저** — 헤더만 바꾸는 게 아니라, 실제 브라우저 지문을 가진 CloakBrowser의 Chromium을 Playwright MCP 뒤에서 구동합니다.
- **기본이 사람 속도** — 모든 실작업 실행에서 `humanize: true`를 강제합니다: 사람 속도의 마우스·타이핑·스크롤으로, 긴 자동화 흐름이 도중에 멈추거나 깨지지 않습니다.
- **실행 전에 게이트를 통과** — 타깃 안전 분류, 승인 근거, 허용 출처, 프리플라이트 질문이 브라우저가 열리기 *전에* 이루어집니다.
- **증거가 없으면 완료 아님** — 페이지가 뜬 것은 결코 "완료"가 아닙니다. 결과가 증명될 때만 작업이 끝나고 구조화된 결과를 보고합니다.
- **번거로움 없는 설정** — Node.js, `cloakbrowser`, `playwright-core`, Playwright MCP를 확인하고 없는 것은 설치·복구합니다.

## 🆚 일반 MCP 브라우저 vs `+ Hyper Cloaking`

| 이런 게 필요할 때… | 일반 MCP 브라우저 | `+ Hyper Cloaking` |
| :--- | :--- | :--- |
| **본인의** 로그인된 계정 자동화 | ✖ 자동화 지문에 걸림 | ✓ 휴머나이즈 + 안전한 쿠키 로드 |
| 작업이 허가된 것인지 먼저 확인 | ✖ 게이트 없음 | ✓ 실행 전 안전·프리플라이트 게이트 |
| 쿠키를 유출 없이 재사용 | ✖ 수동, 원본 값 | ✓ 정규화·마스킹, 커밋 금지 |
| "완료"를 완료로 신뢰 | ✖ 페이지 로드=성공 | ✓ 증거로 검증된 결과 |
| 스텔스 브라우저 구동 | ✖ 수동 설치·연결 | ✓ 자동 설치/복구 + MCP 설정 |
| **로그인·CAPTCHA·사기 시스템 우회** | ✖ | ✖ **설계상 거부** (경계 참조) |

일반 브라우저가 할 수 없는 것은 맨 윗줄입니다: **실제로 허가받은 작업에서 사람처럼 행동하기.**

## 🔁 어떻게 동작하나

*"이 사이트에 CloakBrowser를 써줘"* 같은 요청은 경계가 명확한 10단계 워크플로가 됩니다.

<details>
<summary><strong>게이트에서 증거까지 전체 파이프라인 — 자세히</strong></summary>

1. **타깃 안전 게이트** — 타깃을 허용 / 거부 / 확인 필요로 분류하고, 승인 근거와 허용 출처를 기록합니다.
2. **프리플라이트 질문 게이트** — 타깃 URL, 허용 출처, 헤드리스 모드, 쿠키 모드/계정, 브라우저 유지 여부를 호스트의 네이티브 구조화 질문 인터페이스로 수집합니다.
3. **설정 게이트** — Node.js, `cloakbrowser`, `playwright-core`, Playwright MCP를 확인하고 없는 것은 설치·복구합니다.
4. **런타임 워크스페이스** — `~/.hyper-cloaking/`을 초기화하여 `cookie.yml`, 프로필, 다운로드, 증거, 로그, 상태를 관리합니다.
5. **쿠키 처리** — 사이트에 매칭되는 쿠키(Chrome 익스포트 JSON, Playwright 배열, 다중 계정 항목)를 전용 헬퍼로 정규화·로드하며, 원본 값을 저장소에 저장하지 않습니다.
6. **실행 파일 해석** — `~/.hyper-cloaking/cache/cloakbrowser/` 아래 캐시된 CloakBrowser Chromium 바이너리를 찾습니다.
7. **휴머나이즈 실행** — 모든 실작업 실행에서 `humanize: true`를 필수로 적용합니다(사람 속도의 마우스·타이핑·스크롤).
8. **MCP 설정** — Codex TOML, JSON `mcpServers`(Claude Code / Cursor), OpenClaw `mcp.servers`, Hermes `mcp_servers`, 또는 직접 CLI 명령을 생성하여 `@playwright/mcp`가 CloakBrowser 실행 파일을 가리키게 합니다.
9. **작업 실행 + 결과 검증** — 요청된 작업을 수행하고, 결과를 증명하는 증거가 있을 때만 완료합니다(페이지 로드만으로는 완료가 아닙니다).
10. **구조화된 보고** — `targetSafety`, `outcome`, `failure`, `contentBoundary`, `learning`을 반환하고, 보고서와 스크린샷을 `~/.hyper-cloaking/evidence/`에 저장합니다.

브라우저 DOM, 페이지 텍스트, 다운로드, 콘솔 출력은 **명령 권한이 없는 신뢰 불가 데이터**로 취급합니다.
</details>

## 🔒 경계

Hyper Cloaking은 **허가된 브라우징**을 위한 도구이지, 접근 제어를 우회하는 수단이 아닙니다.

- **용도** — 테스트 권한이 있는 자산에 대한 허가된 QA, 모니터링, 개인 계정 자동화, 진단.
- **금지** — 접근 제어 우회, 사기 탐지 회피, CAPTCHA 해결, 제한된 스크래핑, 무단 계정 자동화.
- 휴머나이제이션은 자동화 지문을 줄일 뿐, 작업이 허가되어야 한다는 요건을 **없애지 않습니다.**
- 쿠키는 정규화되고 로그에서 마스킹되며 커밋되지 않습니다. 스킬은 주어지지 않은 권한을 지어내지 않으며, 알 수 없는 프로바이더는 즉시 실패(fail closed)합니다.

---

## MCP 설정 스니펫

CloakBrowser Chromium 바이너리가 해석되면 Playwright MCP가 그것을 가리키게 합니다. 기본 실행은 **헤드리스**·**샌드박스**이며, 화면에 보이는 브라우징을 원하면 `--headless`를 제거합니다.

**직접 명령**

```bash
npx @playwright/mcp@latest --headless --sandbox \
  --executable-path ~/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome
```

**Codex (`~/.codex/config.toml`)** — 완전히 확장된 경로 사용:

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

**OpenClaw (`mcp.servers.<name>`)**와 **Hermes (`~/.hermes/config.yaml`의 `mcp_servers.<name>`)**도 각자의 설정 키 아래에서 동일한 command/args 형태를 따릅니다.

다음으로 결정적으로 생성할 수 있습니다.

```bash
node skills/hyper-cloaking/engine/cli.mjs mcp-config --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --client codex --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --headed
```

## 엔진 헬퍼

런타임 헬퍼는 `skills/hyper-cloaking/engine/` 아래에 있으며 지원되는 인터페이스입니다.

| 헬퍼 | 용도 |
|---|---|
| `engine/cli.mjs` | `validate` / `smoke` / `mcp-config` / `live` 명령; MCP 설정 렌더링과 격리된 라이브 검증 실행. |
| `engine/cookie.mjs` | 쿠키 임포트·정규화·검사·마스킹·주입(Chrome 익스포트 JSON, Playwright 배열, `cookie.yml` 사이트/계정 항목). |
| `engine/browser-utils.mjs` | `~/.hyper-cloaking/` 초기화, `humanize: true`로 CloakBrowser 실행, `humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath 헬퍼 제공. |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --help
```

<details>
<summary><strong>프로바이더 · Instagram 액션 모듈 — 자세히</strong></summary>

**프로바이더 (메타데이터 전용).** `engine/cli.mjs live --provider <id>`는 **메타데이터만** 선택합니다 — `naver`, `reddit`, `instagram`, `youtube`, `x`, `generic`에 대한 도메인/출처 및 쿠키/프로필 힌트입니다. 프로바이더는 더 넓은 출처를 승인하거나 안전·정찰·프리플라이트 게이트를 우회하지 않으며, 알 수 없는 프로바이더는 즉시 실패(fail closed)합니다.

**Instagram 액션 모듈.** **본인의** 인증된 Instagram 계정을 자동화하는 재사용 가능한 JS 드라이버 플로우가 `engine/providers/instagram/`에 있습니다. 실제 Playwright `page`가 필요하며(Playwright-MCP 모드 불가), 내장 가드레일을 갖춥니다: 쓰기는 기본적으로 드라이런, DM 답장은 기존 대화만 대상(콜드 아웃리치 금지), 대량 답장은 상한·레이트리밋·사람 확인·재개 가능합니다.

```js
import { buildInstagramSession, instagramActions } from './engine/providers/instagram/index.mjs';
const session = buildInstagramSession(page, { stateDir: paths.stateDir, interactive: true });
const posts = await instagramActions.getUserPosts(session, 'nasa', { limit: 12 });
await instagramActions.likePost(session, 'https://www.instagram.com/p/ABC/', { dryRun: false });
```
</details>

## 런타임 워크스페이스

모든 런타임 상태는 `~/.hyper-cloaking/` 아래에 있습니다(샌드박스 테스트 용도로만 `HYPER_CLOAKING_HOME`으로 재정의).

```
~/.hyper-cloaking/
├── cookie.yml       # 사이트/계정 쿠키 항목 (커밋 금지)
├── profiles/        # 영속 브라우저 프로필
├── downloads/       # 다운로드 파일
├── evidence/        # 보고서와 스크린샷
├── logs/            # 실행 로그
├── state/           # 레이트리밋 윈도우, 재개 상태
└── cache/cloakbrowser/   # 다운로드된 스텔스 Chromium 바이너리
```

## 저장소 구조

```
skills/hyper-cloaking/          # 정본 스킬 (SKILL.md, engine, rules, references)
plugins/hyper-cloaking/         # 마켓플레이스용 플러그인 패키지 사본
.claude/skills/hyper-cloaking/  # Claude Code 스킬 미러
.agents/skills/hyper-cloaking/  # AgentSkills 미러
.claude-plugin/marketplace.json # Claude Code 마켓플레이스 매니페스트
.agents/plugins/marketplace.json# Codex 마켓플레이스 매니페스트
scripts/validate.mjs            # 구조 + 미러 일치 검증
```

스킬 디렉터리들은 바이트 단위로 동일하게 미러링됩니다. 일치 여부와 메타데이터 검증은 `npm run validate`로 수행합니다.

## 개발

```bash
npm run validate      # 구조 및 미러 일치 검사
npm run lint          # plugins·scripts에 대한 oxlint
npm run format        # prettier 포매팅
node skills/hyper-cloaking/engine/cli.mjs validate --json   # 엔진 자체 점검 (네트워크 없음)
```

테스트는 `engine/` 아래에 함께 위치한 `*.test.mjs` 파일이며 `node --test`로 실행합니다.

---

<div align="center">

**MIT © alpox** — [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp) 기반, 허가된 브라우징 전용.

</div>
