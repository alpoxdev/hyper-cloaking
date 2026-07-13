#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBrowserUtilsCli } from '@mcp/engine/browser-utils';

export {
  COOKIE_TEMPLATE,
  DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS,
  DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS,
  DEFAULT_HUMAN_MOVE_MAX_STEPS,
  DEFAULT_HUMAN_MOVE_MIN_STEPS,
  DEFAULT_HUMAN_SCROLL_PAUSE_JITTER,
  DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND,
  DEFAULT_HUMAN_TARGET_MAX_RATIO,
  DEFAULT_HUMAN_TARGET_MIN_RATIO,
  DEFAULT_HUMAN_TYPE_MAX_CPM,
  DEFAULT_HUMAN_TYPE_MIN_CPM,
  DEFAULT_WORKSPACE,
  REQUIRED_PLAYWRIGHT_IGNORE_DEFAULT_ARGS,
  UNSUPPORTED_CHROME_NO_SANDBOX_FLAG,
  appendRunShape,
  assertNavigationAllowed,
  buildNoSandboxWarningSafeCloakOptions,
  classifyChallengeObservation,
  classifyEvidenceScope,
  classifyRedirect,
  classifyTargetUrl,
  clearRunShapes,
  cookiesForUrl,
  cookiesFromJsonPayload,
  domainMatches,
  ensureWorkspace,
  evaluateOutcome,
  expandHome,
  findByXPath,
  humanClick,
  humanMove,
  humanScroll,
  humanType,
  humanTypeDelayMs,
  importJsonCookies,
  inferSiteForUrl,
  isOriginApproved,
  isSameOrigin,
  launchCloakBrowser,
  launchPersistentCloakContext,
  loadCookieConfig,
  loadCookiesIntoContext,
  makeEvidencePlan,
  makeFailureDiagnostic,
  makeOutcomeReport,
  markUntrustedBrowserContent,
  mergeRequiredIgnoreDefaultArgs,
  normalizeCookie,
  normalizeEvidenceOrigin,
  normalizeSameSite,
  normalizeTargetOrigin,
  parseCookieYaml,
  redactCookies,
  redactEvidenceText,
  resolveHumanRange,
  resolveTarget,
  resolveWorkspace,
  runBrowserUtilsCli,
  sanitizeRunShape,
  selectCookieRecords,
  serializeCookieConfig,
  summarizeEvidenceRef,
  withDefaultSite,
  withoutUnsupportedNoSandbox,
  workspacePaths
} from '@mcp/engine/browser-utils';

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runBrowserUtilsCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
