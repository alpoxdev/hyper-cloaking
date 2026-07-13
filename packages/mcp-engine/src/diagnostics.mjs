/**
 * Diagnostic classifiers and failure reports for safe, non-bypass runs.
 * Challenge labels are conservative blockers: any match stops automation.
 * @module engine/diagnostics
 */

const CHALLENGE_LABELS = [
  ['site-disallowed', [/site\s+disallowed/i, /disallowed\s+target/i, /robots\s+disallow/i]],
  ['captcha-present', [/captcha/i, /hcaptcha/i, /recaptcha/i, /verify\s+you\s+are\s+human/i]],
  [
    'login-required',
    [/login\s+required/i, /sign\s*in\s+to\s+continue/i, /authentication\s+required/i]
  ],
  [
    'waf-challenge',
    [
      /cloudflare/i,
      /checking\s+your\s+browser/i,
      /ddos\s+protection/i,
      /web\s+application\s+firewall/i
    ]
  ],
  ['rate-limited', [/rate\s*limit/i, /too\s+many\s+requests/i, /\b429\b/]],
  [
    'geo-blocked',
    [
      /not\s+available\s+in\s+your\s+region/i,
      /geo(?:graphically)?\s+blocked/i,
      /country\s+not\s+supported/i
    ]
  ],
  ['mcp-humanization-unproven', [/humanization\s+unproven/i, /mcp\s+humanization/i]]
];

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function observationText(observation = {}) {
  return [
    observation.label,
    observation.reason,
    observation.error,
    observation.statusText,
    observation.title,
    observation.text,
    observation.content,
    observation.bodyText,
    asArray(observation.messages).join(' ')
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * @param {Record<string, unknown>} observation Browser/tool observation; text fields are inspected.
 * @returns {{labels: string[], blocker: boolean, safeNext: string, bypassRecipe: null}}
 * A non-empty `labels` list is a validation/blocker result; no side effects.
 */
export function classifyChallengeObservation(observation = {}) {
  const explicitLabels = asArray(observation.challengeLabels ?? observation.labels).filter(
    (label) => CHALLENGE_LABELS.some(([known]) => known === label)
  );
  const haystack = observationText(observation);
  const detectedLabels = CHALLENGE_LABELS.filter(
    ([label, patterns]) =>
      explicitLabels.includes(label) || patterns.some((pattern) => pattern.test(haystack))
  ).map(([label]) => label);
  const labels = [...new Set(detectedLabels)];

  return {
    labels,
    blocker: labels.length > 0,
    safeNext:
      labels.length > 0
        ? 'Stop automated interaction and route for user decision, credentials, allowlist review, or manual verification.'
        : 'Continue with ordinary non-bypass diagnostics.',
    bypassRecipe: null
  };
}

/**
 * Builds a terminal or resumable diagnostic without throwing on missing optional inputs.
 * @param {object} [input] Diagnostic inputs.
 * @param {unknown|unknown[]} [input.attempted] Checks already run.
 * @param {unknown|unknown[]} [input.blockers] Blocker causes.
 * @param {unknown|unknown[]} [input.remainingChecks] Safe checks not yet run.
 * @param {unknown[]} [input.evidenceRefs] Supporting references.
 * @param {boolean} [input.requiresUserDecision] Whether escalation is required.
 * @returns {{stage: string, layer: string, attempted: unknown[], exhausted: boolean,
 * notExhausted: boolean, blocker: unknown[]|unknown, safeNext: string,
 * evidenceRefs: unknown[], requiresUserDecision: boolean}}
 * Pure result construction; does not retry, bypass, or mutate evidence.
 */
export function makeFailureDiagnostic({
  stage,
  layer,
  attempted,
  blockers,
  remainingChecks,
  evidenceRefs,
  requiresUserDecision
} = {}) {
  const attemptedChecks = asArray(attempted).filter(Boolean);
  const remaining = asArray(remainingChecks).filter(Boolean);
  const blockerList = asArray(blockers).filter(Boolean);
  const exhausted = remaining.length === 0;

  return {
    stage: stage ?? 'unknown',
    layer: layer ?? 'unknown',
    attempted: attemptedChecks,
    exhausted,
    notExhausted: !exhausted,
    blocker: blockerList.length === 1 ? blockerList[0] : blockerList,
    safeNext:
      requiresUserDecision || blockerList.length > 0
        ? 'Stop and route the blocker; do not attempt bypass or evasion.'
        : 'Run the remaining safe checks before escalating.',
    evidenceRefs: asArray(evidenceRefs).filter(Boolean),
    requiresUserDecision: Boolean(requiresUserDecision)
  };
}
