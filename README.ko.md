[English](README.md) | 한국어 | [中文](README.zh.md) | [日本語](README.ja.md) | [Español](README.es.md)

<div align="center">

# Hyper Cloaking

**어떤 브라우저 작업이든, 에이전트가 끝까지 해냅니다. 테스트 권한만 있다면 Hyper Cloaking이 끝냅니다.**

AI 에이전트를 위한 사람 속도의 스텔스 브라우저로, 관리형 로컬 `hyper-cloaking-mcp` 서버를 사용해 CloakBrowser를 구동합니다. 수동 설정도, "페이지는 떴어요" 식의 절반짜리 성공도 없이 — 증거로 완료합니다.

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

**Node.js ≥ 20**과 `cloakbrowser`·`playwright-core`를 받을 네트워크 접근이 필요합니다. 아래 설명대로 로컬 워크스페이스 패키지를 빌드하며, 마이그레이션 패키지가 첫 실행에 자동 설치되지는 않습니다.

## 💬 이렇게 써보세요

배울 명령어는 없습니다. 에이전트에게 평소처럼 요청하면, 브라우저 작업을 가리키는 순간 스킬이 작동합니다.

> *"CloakBrowser로 내 제품 페이지가 모바일에서 제대로 렌더링되는지 확인하고 스크린샷 찍어줘."*
> *"저장된 쿠키로 내 인스타그램에 로그인해서 최근 게시물 12개 가져와줘."*
> *"내가 운영하는 이 대시보드를 지켜보다가 배포 상태가 실패로 바뀌면 알려줘."*

**예상 결과:** 에이전트가 설정 질문 몇 가지를 던지고, 사람 속도의 스텔스 브라우저를 실행해 작업을 수행한 뒤, **증거가 있을 때만** 완료합니다 — 스크린샷, 추출된 텍스트, 확인된 상태 변화가 `~/.hyper-cloaking/evidence/`에 저장됩니다.

## 🌐 어디서 동작하나

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** — `SKILL.md`를 로드하는 MCP 지원 에이전트라면 무엇이든. **Naver · Instagram · YouTube · X · Coupang · TikTok**에 대한 내장 메타데이터 힌트를 제공하며, 테스트 권한이 있는 임의의 사이트에는 `generic` 모드를 지원합니다.

## ⚙️ 왜 통하는가

- **패치된 User-Agent가 아니라 진짜 스텔스 브라우저** — 로컬에서 빌드한 정식 `@mcp/server`가 헤더만 바꾸는 대신 실제 브라우저 지문을 가진 CloakBrowser를 구동합니다. `hyper-cloaking-mcp`는 레거시 호환 명령입니다.
- **기본이 사람 속도** — 모든 실작업 실행에서 `humanize: true`를 강제합니다: 사람 속도의 마우스·타이핑·스크롤으로, 긴 자동화 흐름이 도중에 멈추거나 깨지지 않습니다.
- **실행 전에 게이트를 통과** — 타깃 안전 분류, 승인 근거, 허용 출처, 프리플라이트 질문이 브라우저가 열리기 *전에* 이루어집니다.
- **증거가 없으면 완료 아님** — 페이지가 뜬 것은 결코 "완료"가 아닙니다. 결과가 증명될 때만 작업이 끝나고 구조화된 결과를 보고합니다.
- **로컬 워크스페이스 설정** — 이 저장소에서 정식 `@mcp/engine`과 `@mcp/server`를 빌드합니다. `@alpoxdev/hyper-cloaking`은 레거시 호환 어댑터를 제공합니다.

## 🆚 일반 MCP 브라우저 vs `+ Hyper Cloaking`

| 이런 게 필요할 때… | 일반 MCP 브라우저 | `+ Hyper Cloaking` |
| :--- | :--- | :--- |
| **본인의** 로그인된 계정 자동화 | ✖ 자동화 지문에 걸림 | ✓ 휴머나이즈 + 안전한 쿠키 로드 |
| 작업이 허가된 것인지 먼저 확인 | ✖ 게이트 없음 | ✓ 실행 전 안전·프리플라이트 게이트 |
| 쿠키를 유출 없이 재사용 | ✖ 수동, 원본 값 | ✓ 정규화·마스킹, 커밋 금지 |
| "완료"를 완료로 신뢰 | ✖ 페이지 로드=성공 | ✓ 증거로 검증된 결과 |
| 스텔스 브라우저 구동 | ✖ 수동 설치·연결 | ✓ 로컬 워크스페이스 빌드 + MCP 설정 |
| **로그인·CAPTCHA·사기 시스템 우회** | ✖ | ✖ **설계상 거부** (경계 참조) |

일반 브라우저가 할 수 없는 것은 맨 윗줄입니다: **실제로 허가받은 작업에서 사람처럼 행동하기.**

## 🔁 어떻게 동작하나

*"이 사이트에 CloakBrowser를 써줘"* 같은 요청은 경계가 명확한 10단계 워크플로가 됩니다.

<details>
<summary><strong>게이트에서 증거까지 전체 파이프라인 — 자세히</strong></summary>

1. **타깃 안전 게이트** — 타깃을 허용 / 거부 / 확인 필요로 분류하고, 승인 근거와 허용 출처를 기록합니다.
2. **프리플라이트 질문 게이트** — 타깃 URL, 허용 출처, 헤드리스 모드, 쿠키 모드/계정, 브라우저 유지 여부를 호스트의 네이티브 구조화 질문 인터페이스로 수집합니다.
3. **설정 게이트** — Node.js와 로컬에서 빌드한 정식 MCP 서버를 확인합니다. 이 경로에는 레지스트리 패키지 설치나 복구가 포함되지 않습니다.
4. **런타임 워크스페이스** — `~/.hyper-cloaking/`을 초기화하여 `cookie.yml`, 프로필, 다운로드, 증거, 로그, 상태를 관리합니다.
5. **쿠키 처리** — 사이트에 매칭되는 쿠키(Chrome 익스포트 JSON, Playwright 배열, 다중 계정 항목)를 전용 헬퍼로 정규화·로드하며, 원본 값을 저장소에 저장하지 않습니다.
6. **실행 파일 해석** — `~/.hyper-cloaking/cache/cloakbrowser/` 아래 캐시된 CloakBrowser Chromium 바이너리를 찾습니다.
7. **휴머나이즈 실행** — 모든 실작업 실행에서 `humanize: true`를 필수로 적용합니다(사람 속도의 마우스·타이핑·스크롤).
8. **MCP 설정** — 현재 Node 실행 파일과 함께 로컬에서 빌드한 정식 서버를 사용합니다. 레거시 등록은 호환 어댑터를 대상으로 합니다.
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

## 관리형 로컬 MCP 설정

### 로컬 워크스페이스 패키지

이번 마이그레이션은 로컬 워크스페이스 전용입니다. 레지스트리 게시는 의도적으로 수행하지 않았습니다. 리터럴 `npm install @mcp/...`는 스코프 권한과 릴리스 승인을 기다리고 있습니다. 이 문서의 `@mcp/*` 이름은 이 저장소의 워크스페이스에서만 해석되며 레지스트리 가용성을 뜻하지 않습니다.

저장소 루트에서 선언된 의존성을 설치하고, 로컬 패키지를 빌드한 뒤 정식 서버를 실행합니다.

```bash
npm install
npm run build
node "$(pwd)/packages/mcp-server/dist/cli.mjs"
```

`@mcp/engine`은 정식 엔진 패키지이고 `@mcp/server`는 정식 stdio 서버 패키지입니다. `@mcp/server`는 `@mcp/engine`의 export된 공개 API에 의존하며 `@mcp/engine/browser-utils`, `@mcp/engine/providers` 같은 공개 서브패스를 사용합니다. 엔진 소스 경로에 직접 접근해서는 안 됩니다.

```js
import { createServer } from '@mcp/server';
import { launchCloakBrowser } from '@mcp/engine';
import { humanClick } from '@mcp/engine/browser-utils';
import { resolveProviderForUrl } from '@mcp/engine/providers';
```

`@alpoxdev/hyper-cloaking`은 로컬 레거시 호환 워크스페이스입니다. 기존 `@alpoxdev/hyper-cloaking/...` import, `mcp/engine/...` 경로, `hyper-cloaking-*` 명령은 정식 로컬 패키지로 연결하는 호환 어댑터를 사용합니다. 기존 클라이언트에만 유지하고, 새 통합에는 위의 정식 패키지를 사용하세요. 로컬 호환 등록 렌더러는 `./mcp/register.mjs`에 남아 있습니다. 레거시 tarball은 `@mcp/engine`과 `@mcp/server`를 선택적 peer로 선언합니다. 두 정식 패키지의 로컬 tarball을 함께 명시적으로 설치해야 합니다. 레지스트리 해석이나 대체 경로는 없으며, 이 peer들이 제공되기 전에는 정식 및 레거시 런타임 import가 명확히 실패합니다.

타입이 지정된 도구는 다음 순서로 사용합니다: `cloak_setup` → `cloak_status` → `cloak_launch` → `cloak_navigate` → `cloak_snapshot` → `cloak_click`/`cloak_type`/`cloak_scroll` → `cloak_screenshot` → `cloak_provider_capabilities` 확인 → `cloak_provider_read` 또는 `cloak_provider_write` → `cloak_teardown`. 필요할 때 쿠키·자격 증명 도구(`cloak_cookies_list`, `cloak_cookies_status`, `cloak_credentials`)를 사용합니다. 지원 provider는 **Naver, Instagram, YouTube, X, Coupang, TikTok**이며, 알 수 없는 provider는 fail closed로 처리합니다.

### 패키지 인터페이스와 호환성

| 인터페이스 | 로컬 형식 |
|---|---|
| 정식 엔진 | `@mcp/engine` 및 문서화된 공개 서브패스 |
| 정식 stdio MCP | 로컬에서 `packages/mcp-server/dist/cli.mjs`로 빌드한 `@mcp/server` |
| 레거시 import와 명령 | `@alpoxdev/hyper-cloaking`, `mcp/engine/...`, `hyper-cloaking-*` 호환 어댑터 |
| 등록 렌더러 | `./mcp/register.mjs` 호환 어댑터 |

위 엔진 API 항목은 로컬 워크스페이스 import specifier이며 레지스트리 설치 지침이 아닙니다. Provider별 액션 모듈은 지원되는 사용자 통합 인터페이스가 아니므로 타입이 지정된 MCP provider 도구를 사용하세요.

<details>
<summary><strong>프로바이더 · Instagram 액션 모듈 — 자세히</strong></summary>

**프로바이더 (메타데이터 전용).** 정식 엔진의 `live --provider <id>` 모드는 **메타데이터만** 선택합니다 — `naver`, `instagram`, `youtube`, `x`, `coupang`, `tiktok`, `generic`에 대한 도메인/출처 및 쿠키/프로필 힌트입니다. 프로바이더는 더 넓은 출처를 승인하거나 안전·정찰·프리플라이트 게이트를 우회하지 않으며, 알 수 없는 프로바이더는 즉시 실패(fail closed)합니다.

**Instagram 액션 모듈.** 위의 타입이 지정된 MCP provider 도구가 지원되는 사용자 인터페이스이며, 직접 provider import는 공개 통합 인터페이스가 아닙니다. 기존 가드레일은 유지됩니다: 쓰기는 기본적으로 드라이런, DM 답장은 기존 대화만 대상(콜드 아웃리치 금지), 대량 답장은 상한·레이트리밋·사람 확인·재개 가능합니다.

</details>

### 로컬 워크스페이스 빌드

이 지침은 이 저장소 체크아웃에서만 작동하며, 마이그레이션 패키지를 레지스트리에서 설치하지 않습니다.

```bash
npm install
npm run build
node "$(pwd)/packages/mcp-server/dist/cli.mjs"
```

upstream Playwright MCP 패키지는 역사적/배경 비교용일 뿐이며 권장 실사용 경로가 아닙니다.

무자격 증명 검증 lane은 로컬 distribution bundle을 build하고 stdio handshake, 실제 humanized CloakBrowser session launch, status 확인, teardown을 수행합니다. Provider별 실제 사이트 read/write는 credential과 authorization이 필요한 live check이며 CI에서 성공한 것처럼 모의하지 않습니다.

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

```text
packages/mcp-engine/                # 정식 로컬 @mcp/engine 패키지
packages/mcp-server/                # 공개 엔진 API 서브패스를 사용하는 정식 로컬 @mcp/server
mcp/                                # 로컬 @alpoxdev/hyper-cloaking 호환 어댑터와 렌더러
plugins/hyper-cloaking/skills/hyper-cloaking/ # 정본 스킬 (SKILL.md, rules, references)
skills/hyper-cloaking/              # 정본 스킬의 루트 미러
.claude/skills/hyper-cloaking/      # Claude Code 스킬 미러
.agents/skills/hyper-cloaking/      # AgentSkills 미러
.claude-plugin/marketplace.json     # Claude Code 마켓플레이스 매니페스트
.agents/plugins/marketplace.json    # Codex 마켓플레이스 매니페스트
scripts/validate.mjs                # 구조 + 미러 일치 검증
```

스킬 디렉터리들은 바이트 단위로 동일하게 미러링됩니다. 일치 여부와 메타데이터 검증은 `npm run validate`로 수행합니다.

## 개발

다음은 레지스트리 설치 지침이 아닌 로컬 워크스페이스 빌드 및 테스트 명령입니다.

```bash
npm install
npm run build
npm --workspace @mcp/engine run test
npm --workspace @mcp/server run test
npm --workspace @alpoxdev/hyper-cloaking run test
```

`npm run build`는 정식 엔진과 서버 워크스페이스를 로컬에서 빌드합니다. 패키지 테스트 명령은 이 체크아웃의 정식 패키지와 레거시 호환 어댑터를 검증합니다.
첫 GitHub Actions 실행이 성공한 뒤 필수 작업 검사 이름이 `quality`와 `Node 20 compatibility`인지 확인한 후에만 `main` 브랜치 Ruleset을 설정합니다. 이 저장소는 해당 설정을 자동으로 적용하지 않습니다.

---

<div align="center">

**MIT © alpox** — [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp) 기반, 허가된 브라우징 전용.

</div>
