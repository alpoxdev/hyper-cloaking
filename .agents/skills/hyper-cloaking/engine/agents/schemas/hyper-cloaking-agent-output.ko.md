# Hyper Cloaking 역할 출력 스키마 v1

이 문서는 `hyper-cloaking-agent-output.schema.json`의 한국어 설명이다. 정식 검증 기준은 JSON Schema 2020-12 파일이다.

## 공통 envelope

모든 결과는 `schemaVersion`, `agent`, `status`, `executionMode`, `failure`, `result`를 포함한다. `schemaVersion`은 역할 프로토콜 정수 `1`이며 제품/설정 버전 `0.0.1`과 별개다.

- `agent`: `setup`, `browser-task`, `diagnostics`
- `status`: `succeeded`, `blocked`, `failed`
- `executionMode`: `parent`, `subagent`
- 성공 시 `failure`는 `null`이다.
- 차단/실패 시 `failure`는 `code`, `phase`, `retryable`, `observedSignal`을 모두 포함한다.
- 모든 상태에서 agent별 완전한 `result`가 필요하며 부분 결과와 알 수 없는 필드는 거부한다.

## setup 결과

설정 준비 상태, MCP config, 검증된 executable path, 구조화된 blocker 배열을 반환한다. sandbox 비활성화는 허용하지 않으며 headless/headed 결과는 요청과 일치해야 한다.

## browser-task 결과

`taskMode`는 항상 `verification-only`다. target safety, 관측 결과, 최종 URL, 허용 origin/redirect/violation, humanization 증거, browser cleanup 결과, evidence ref, limitation을 반환한다. humanization telemetry 또는 cleanup이 검증되지 않으면 성공으로 표시하지 않는다.

## diagnostics 결과

읽기 전용 진단 layer, 관측 신호, 마지막 안전 행동, 다음 승인 단계, 메모리 내 JSON/Markdown 보고서를 반환한다. 진단 역할은 재시도나 파일 쓰기를 수행하지 않는다.
