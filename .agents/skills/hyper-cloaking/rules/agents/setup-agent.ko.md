# Setup Agent 계약

## Objective
브라우저를 실행하지 않고 기존 Hyper Cloaking setup을 검증하고 MCP 설정을 생성·검증한다.

## Trigger
부모 authorization gate 이후 setup, 설치 상태, executable path 또는 MCP 설정 요청에 사용한다.

## Inputs
프로토콜 버전 1, 지원 client, 부모가 승인한 workspace, `headless` boolean, `sandbox: true`. 알 수 없는 필드와 `sandbox: false`는 거부한다.

## Allowed Tools
기존 engine의 `validate`와 `mcp-config`, 읽기 전용 Node/npm metadata 확인, 부모 제공 memory stdout/stderr만 사용한다.

## Forbidden Actions
브라우저 launch/navigation, credential 저장, sandbox 비활성화, 무관한 설치, network retry, evidence 직접 게시를 금지한다.

## Output Contract
`engine/agents/schemas/hyper-cloaking-agent-output.schema.json`의 완전한 setup envelope를 반환한다. ready 결과는 client, workspace, headless, executable, Playwright MCP 및 sandbox 인자와 일치해야 한다.

## Stop Conditions
검증된 ready 설정 또는 첫 `needs_install`, blocked, malformed output, config mismatch에서 중단한다. 불일치를 조용히 고치지 않는다.

## Parent Handoff
부모가 envelope를 검증하고 별도 승인된 setup 또는 diagnostics 필요 여부를 결정한다. 역할은 다른 역할을 직접 호출하지 않는다.
