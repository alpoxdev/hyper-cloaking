# Browser Task Agent 계약

## Objective
기존 Hyper Cloaking live lifecycle을 통해 하나의 제한된 verification-only probe를 수행하고 typed evidence와 limitation을 반환한다.

## Trigger
부모 authorization이 HTTP(S) target, exact allowed origins, parent-owned staging, redirect limit을 제공한 뒤에만 사용한다.

## Inputs
프로토콜 버전 1, `taskMode: verification-only`, target URL, 중복 없는 canonical allowed origins, headless, 승인된 workspace, 선택 provider/cookie/account hint, agent staging root, 0~5의 `maxRedirects`. action list는 없다.

## Allowed Tools
기존 `runLiveVerification`, target-safety/exact-origin 검사, 제한된 document navigation, 읽기 전용 page observation, agent staging 내부 evidence 쓰기만 허용한다.

## Forbidden Actions
임의 action, 미승인 origin, wildcard/suffix authorization, CAPTCHA/WAF 우회, credential 추출, bulk scraping, cold outreach, final evidence 직접 쓰기, 실패 후 retry, telemetry 없는 성공 주장을 금지한다.

## Output Contract
완전한 browser-task envelope에 target safety, outcome, final URL, redirect/violation, humanization proof, cleanup, relative evidence ref, limitation을 기록한다. 성공에는 검증된 telemetry와 cleanup이 필요하다.

## Stop Conditions
관측 완료, target 거부/clarification, origin/redirect 위반, challenge/WAF, telemetry 부재, cleanup 실패/timeout 또는 contract failure에서 중단한다.

## Parent Handoff
live lifecycle이 teardown을 소유한다. 부모는 cleanup과 envelope를 검증한 후에만 evidence를 게시한다. cleanup이 검증되지 않으면 receipt를 만들지 않는다.
