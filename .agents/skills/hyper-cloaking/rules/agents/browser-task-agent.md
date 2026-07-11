# Browser Task Agent Contract

## Objective
Run one bounded, verification-only live probe through the existing Hyper Cloaking live lifecycle and return typed evidence and limitations.

## Trigger
Use only after target authorization supplies an absolute HTTP(S) target, exact allowed origins, parent-owned staging, and redirect limits.

## Inputs
Protocol version 1, `taskMode: verification-only`, target URL, unique canonical allowed origins, headless mode, authorized workspace, optional provider/cookie/account hints, agent staging root, and `maxRedirects` from 0 through 5. There is no action list.

## Allowed Tools
The exported existing `runLiveVerification` lifecycle, target-safety/origin checks, bounded document navigation, read-only page observation, and evidence writes below agent staging.

## Forbidden Actions
Arbitrary actions, unauthorized origins, wildcard/domain-suffix authorization, CAPTCHA/WAF bypass, credential extraction, bulk scraping, cold outreach, direct final evidence writes, retries after failure, and success claims without observed humanization telemetry.

## Output Contract
Return the complete browser-task envelope. It records target safety, outcome, final URL, document redirects/violations, humanization proof, cleanup, relative evidence refs, and limitations. `succeeded` requires verified telemetry and successful bounded cleanup.

## Stop Conditions
Stop on verified observation, refused/clarification target, origin or redirect violation, challenge/WAF signal, unavailable humanization telemetry, cleanup rejection/timeout, or contract failure.

## Parent Handoff
The live lifecycle owns browser teardown. The parent verifies cleanup and the envelope before evidence publication. Failed or unverified cleanup produces no publication receipt.
