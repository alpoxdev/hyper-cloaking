const CRITERION_TYPES = new Set([
  'urlLoaded',
  'urlIncludes',
  'urlMatches',
  'textIncludes',
  'selectorVisible',
  'fileExists',
  'artifactExists',
  'recordCountAtLeast',
  'evidenceCaptured',
  'negativeAssertion'
]);

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeCriteria(criteria) {
  if (Array.isArray(criteria)) return criteria;
  if (criteria && typeof criteria === 'object') {
    if (Array.isArray(criteria.criteria)) return criteria.criteria;
    return Object.entries(criteria)
      .filter(([type]) => CRITERION_TYPES.has(type))
      .map(([type, expected]) => ({ type, expected }));
  }
  return [];
}

function criterionLabel(criterion, index) {
  return criterion.id || criterion.name || criterion.type || `criterion-${index + 1}`;
}

function textFromObservation(observation) {
  return String(observation.text ?? observation.content ?? observation.bodyText ?? '');
}

function hasNamedEntry(collection, expected) {
  if (!expected) return false;
  const names = asArray(expected).map(String);
  if (Array.isArray(collection)) {
    return names.every((name) => collection.some((entry) => {
      if (typeof entry === 'string') return entry === name;
      return entry?.path === name || entry?.name === name || entry?.id === name;
    }));
  }
  if (collection && typeof collection === 'object') {
    return names.every((name) => Boolean(collection[name] || Object.values(collection).some((entry) => {
      if (typeof entry === 'string') return entry === name;
      return entry?.path === name || entry?.name === name || entry?.id === name;
    })));
  }
  return false;
}

function selectorIsVisible(selectors, selector) {
  if (!selector) return false;
  const record = selectors?.[selector];
  if (typeof record === 'boolean') return record;
  if (record && typeof record === 'object') return Boolean(record.visible ?? record.exists ?? record.found);
  if (Array.isArray(selectors)) {
    return selectors.some((entry) => entry === selector || (entry?.selector === selector && (entry.visible ?? entry.exists ?? entry.found)));
  }
  return false;
}

function recordCount(observation, criterion) {
  const key = criterion.collection || criterion.name || criterion.key;
  if (key && observation.recordCounts && Number.isFinite(Number(observation.recordCounts[key]))) {
    return Number(observation.recordCounts[key]);
  }
  if (key && observation.records && Array.isArray(observation.records[key])) return observation.records[key].length;
  if (Number.isFinite(Number(observation.recordCount))) return Number(observation.recordCount);
  if (Array.isArray(observation.records)) return observation.records.length;
  return 0;
}

function evaluateSingle(observation, criterion) {
  const type = criterion.type;
  const expected = criterion.expected ?? criterion.value ?? criterion.url ?? criterion.text ?? criterion.selector ?? criterion.path ?? criterion.artifact;

  switch (type) {
    case 'urlLoaded':
      return Boolean(observation.urlLoaded ?? observation.loaded ?? observation.pageLoaded ?? observation.url);
    case 'urlIncludes':
      return String(observation.url ?? '').includes(String(expected ?? ''));
    case 'urlMatches': {
      if (expected instanceof RegExp) return expected.test(String(observation.url ?? ''));
      return new RegExp(String(expected ?? '')).test(String(observation.url ?? ''));
    }
    case 'textIncludes':
      return textFromObservation(observation).includes(String(expected ?? ''));
    case 'selectorVisible':
      return selectorIsVisible(observation.selectors ?? observation.selectorVisibility, String(expected ?? ''));
    case 'fileExists':
      return hasNamedEntry(observation.files, expected);
    case 'artifactExists':
      return hasNamedEntry(observation.artifacts, expected);
    case 'recordCountAtLeast':
      return recordCount(observation, criterion) >= Number(criterion.count ?? criterion.atLeast ?? expected ?? 0);
    case 'evidenceCaptured':
      return Boolean(observation.evidenceCaptured) || asArray(observation.evidenceRefs).length > 0 || hasNamedEntry(observation.artifacts, expected);
    case 'negativeAssertion': {
      const inner = criterion.assertion || criterion.criterion || Object.fromEntries(
        Object.entries(criterion).filter(([key]) => !['type', 'id', 'name', 'expected', 'value'].includes(key))
      );
      const normalized = inner.type ? inner : Object.entries(inner).find(([key]) => CRITERION_TYPES.has(key))
        ? (() => {
            const [innerType, innerExpected] = Object.entries(inner).find(([key]) => CRITERION_TYPES.has(key));
            return { type: innerType, expected: innerExpected };
          })()
        : { type: 'textIncludes', expected };
      return !evaluateSingle(observation, normalized);
    }
    default:
      return false;
  }
}

function explicitPageLoadCriterion(criterion) {
  return criterion.requiresPageOpen === true
    || criterion.requiresPageLoad === true
    || criterion.justification === 'page-open-only';
}

export function evaluateOutcome(observation = {}, criteria = []) {
  const normalizedCriteria = normalizeCriteria(criteria);
  const criteriaResults = normalizedCriteria.map((criterion, index) => {
    const normalized = typeof criterion === 'string' ? { type: criterion } : criterion;
    const passed = evaluateSingle(observation, normalized);
    return {
      id: criterionLabel(normalized, index),
      type: normalized.type,
      passed,
      expected: normalized.expected ?? normalized.value ?? normalized.url ?? normalized.text ?? normalized.selector ?? normalized.path ?? normalized.artifact,
      requiresPageOpen: explicitPageLoadCriterion(normalized)
    };
  });
  const rawPassed = criteriaResults.length > 0 && criteriaResults.every((result) => result.passed);
  const failedCriteria = criteriaResults.filter((result) => !result.passed);
  const pageLoadOnlySuccess = rawPassed
    && criteriaResults.length > 0
    && criteriaResults.every((result) => result.type === 'urlLoaded');
  const pageLoadOnlyJustified = !pageLoadOnlySuccess || criteriaResults.some((result) => result.requiresPageOpen);
  const passed = rawPassed && pageLoadOnlyJustified;

  return {
    passed,
    success: passed,
    criteria: criteriaResults,
    failedCriteria: pageLoadOnlySuccess && !pageLoadOnlyJustified
      ? [...failedCriteria, { id: 'page-load-only', type: 'pageLoadOnlyJustification', passed: false, expected: 'explicit page-open-only justification' }]
      : failedCriteria,
    evidenceRefs: asArray(observation.evidenceRefs),
    pageLoadOnlySuccess,
    pageLoadOnlyJustified
  };
}

export function makeOutcomeReport({ targetSafety, outcome, failure, contentBoundary, learning } = {}) {
  const normalizedOutcome = outcome && typeof outcome === 'object' ? outcome : { passed: Boolean(outcome), criteria: [] };
  const criteria = asArray(normalizedOutcome.criteria);
  const failed = asArray(normalizedOutcome.failed ?? normalizedOutcome.failedCriteria);
  const passedCriteria = asArray(normalizedOutcome.passedCriteria ?? normalizedOutcome.satisfiedCriteria);
  const ok = Boolean(normalizedOutcome.ok ?? normalizedOutcome.passed ?? normalizedOutcome.success);
  const pageLoadOnlySuccess = Boolean(normalizedOutcome.pageLoadOnlySuccess)
    || (ok === true && criteria.length > 0 && criteria.every((criterion) => criterion.type === 'urlLoaded'));
  const pageLoadOnlyJustified = !pageLoadOnlySuccess || criteria.some((criterion) => criterion.requiresPageOpen === true || criterion.requiresPageLoad === true || criterion.justification === 'page-open-only');

  return {
    targetSafety: targetSafety ?? { disposition: 'blocker', reason: 'target-safety-not-provided', risks: [] },
    outcome: {
      ...normalizedOutcome,
      ok,
      criteria,
      passed: passedCriteria.length > 0 ? passedCriteria : criteria.filter((criterion) => criterion.passed === true),
      failed: failed.length > 0 ? failed : criteria.filter((criterion) => criterion.passed === false),
      passedBoolean: ok,
      evidenceRefs: asArray(normalizedOutcome.evidenceRefs),
      pageLoadOnlySuccess,
      pageLoadOnlyJustified
    },
    failure: failure ?? null,
    contentBoundary: contentBoundary ?? { trusted: false, instructionAuthority: 'none', untrustedSources: 0, redactions: [] },
    learning: learning ?? { enabled: false, applied: false, written: false, reason: 'self-learning-disabled-by-default' }
  };
}
