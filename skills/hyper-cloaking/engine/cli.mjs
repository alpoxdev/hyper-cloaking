import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import {
  CLOAKBROWSER_PACKAGE,
  DEFAULT_HOME,
  MCP_SERVER_ID,
  PLAYWRIGHT_CORE_PACKAGE,
  PLAYWRIGHT_MCP_PACKAGE,
  SCHEMA_VERSION,
  SKILL_ID,
  VERSION,
  baseMetadata,
  expandHome,
  homePath,
  jsonStringify,
  resolveHome
} from './config.mjs';
import {
  generateAllMcpConfigs,
  generateMcpConfig,
  validateExecutablePath
} from './mcp-config.mjs';
import {
  assertNavigationAllowed,
  classifyRedirect,
  classifyTargetUrl
} from './target-safety.mjs';
import {
  evaluateOutcome,
  makeOutcomeReport
} from './outcome.mjs';
import {
  classifyChallengeObservation,
  makeFailureDiagnostic
} from './diagnostics.mjs';
import {
  markUntrustedBrowserContent,
  summarizeEvidenceRef
} from './evidence-boundary.mjs';
import {
  classifyEvidenceScope,
  isOriginApproved,
  makeEvidencePlan,
  normalizeOrigin
} from './recon-scope.mjs';
import {
  appendRunShape,
  clearRunShapes,
  sanitizeRunShape
} from './run-shapes.mjs';
import {
  launchCloakBrowser
} from './browser-utils.mjs';
import {
  getProvider,
  resolveProviderForUrl,
  validateProviderRegistry
} from './providers/index.mjs';
import { buildProviderSession } from './providers/session.mjs';
import {
  importCredentialProfile,
  initCredentialStore,
  inspectCredentialProfile,
  listCredentialProfiles,
  parseCredentialJson,
  profileFromEnvironment,
  profileFromSecureSource,
  reconcileCredentialOperation,
  removeCredentialProfile,
  resolveCredentialProfile,
  setDefaultCredentialProfile
} from './credentials.mjs';

const OPTION_OCCURRENCES = Symbol('optionOccurrences');

function parseArgs(argv) {
  const options = { _: [], [OPTION_OCCURRENCES]: new Map() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    const inline = arg.indexOf('=');
    if (inline !== -1) {
      assignOption(options, arg.slice(2, inline), arg.slice(inline + 1));
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      assignOption(options, key, true);
      continue;
    }

    assignOption(options, key, next);
    index += 1;
  }
  return options;
}

function assignOption(options, key, value) {
  options[OPTION_OCCURRENCES].set(key, (options[OPTION_OCCURRENCES].get(key) || 0) + 1);
  if (key !== 'allowed-origin') {
    options[key] = value;
    return;
  }
  const values = options[key] || [];
  options[key] = Array.isArray(values) ? [...values, value] : [values, value];
}

function wantsJson(options) {
  return options.json === true || options.json === 'true';
}

function wantsHeadless(options) {
  if (options.headed === true || options.visible === true) return false;
  if (options.headless === false || options.headless === 'false' || options.headless === '0') return false;
  return true;
}

function usage() {
  return `Usage: hyper-cloaking <validate|smoke|mcp-config|live|credentials> [--json] [--home DIR]\n\nCommands:\n  validate    Check local engine metadata without network or package probes.\n  smoke       Create/check a sandbox home and render fake-executable MCP configs.\n  mcp-config  Render MCP config for direct, codex, json, claude-code, gajae-code, openclaw, hermes, or hermes-agent.\n  live        Run local live verification after containment, package, and target-safety preflight.
              Options: --provider ID (explicit provider metadata, fails closed on unknown id),
              --cookie-site SITE / --site SITE (cookie selection), --account ACCOUNT.
  credentials Manage owner-only provider profiles: init, list, inspect, import, remove,
              set-default, validate, reconcile, resolve-profile. Import secrets only
              through piped stdin, --source, or --env-prefix; secret argv is rejected.`;
}

function jsonResult(result) {
  return jsonStringify(result);
}

function textResult(result) {
  if (result.ok) return `${result.command || 'hyper-cloaking'}: ok\n`;
  return `${result.command || 'hyper-cloaking'}: ${result.status || 'failed'}: ${result.error || result.blocker || 'unknown error'}\n`;
}

function output(result, options) {
  return wantsJson(options) ? jsonResult(result) : textResult(result);
}

function makeResult(command, fields = {}) {
  return {
    ok: true,
    status: 'ok',
    command,
    ...baseMetadata(),
    ...fields
  };
}

function helperCheck(name, value) {
  return { name, ok: typeof value === 'function', expected: 'function', actual: typeof value };
}

function targetSafetyFor(url) {
  try {
    return classifyTargetUrl(url, { allowAboutBlank: true });
  } catch (error) {
    return {
      disposition: 'blocker',
      reason: error instanceof Error ? error.message : String(error),
      url: String(url),
      origin: null
    };
  }
}

function normalizeFailure(failure) {
  return failure || null;
}

function completionFields({
  targetSafety = targetSafetyFor('about:blank'),
  outcome = null,
  failure = null,
  contentBoundary = null,
  learning = false
} = {}) {
  const normalizedLearning = learning === true
    ? { enabled: true }
    : { enabled: false, persisted: false, reason: 'self-learning disabled unless explicitly enabled' };
  const report = makeOutcomeReport({
    targetSafety,
    outcome,
    failure: normalizeFailure(failure),
    contentBoundary,
    learning: normalizedLearning
  });
  return {
    targetSafety: report.targetSafety ?? targetSafety,
    outcome: report.outcome ?? outcome,
    failure: Object.hasOwn(report, 'failure') ? report.failure : normalizeFailure(failure),
    contentBoundary: report.contentBoundary ?? contentBoundary,
    learning: report.learning ?? normalizedLearning
  };
}

function safeOutcome(observation, criteria) {
  return evaluateOutcome(observation, criteria);
}

function sampleContentBoundary(url = 'about:blank') {
  return markUntrustedBrowserContent({
    url,
    content: '',
    kind: 'metadata',
    retrievedAt: null,
    redactions: []
  });
}

function blockedFailure(stage, blockers, attempted = []) {
  return makeFailureDiagnostic({
    stage,
    layer: stage,
    attempted,
    blockers,
    remainingChecks: [],
    evidenceRefs: [],
    requiresUserDecision: false
  });
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.stat(dir);
  if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
}

async function writeFakeExecutable(filePath) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.chmod(filePath, 0o700);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function validateCommand() {
  const helperChecks = [
    helperCheck('classifyTargetUrl', classifyTargetUrl),
    helperCheck('assertNavigationAllowed', assertNavigationAllowed),
    helperCheck('evaluateOutcome', evaluateOutcome),
    helperCheck('makeOutcomeReport', makeOutcomeReport),
    helperCheck('makeFailureDiagnostic', makeFailureDiagnostic),
    helperCheck('classifyChallengeObservation', classifyChallengeObservation),
    helperCheck('markUntrustedBrowserContent', markUntrustedBrowserContent),
    helperCheck('summarizeEvidenceRef', summarizeEvidenceRef),
    helperCheck('classifyEvidenceScope', classifyEvidenceScope),
    helperCheck('makeEvidencePlan', makeEvidencePlan),
    helperCheck('sanitizeRunShape', sanitizeRunShape),
    helperCheck('appendRunShape', appendRunShape),
    helperCheck('clearRunShapes', clearRunShapes)
  ];
  const targetSafety = targetSafetyFor('about:blank');
  const outcome = safeOutcome(
    { text: 'helper-contract no-network no-launch' },
    [{ type: 'textIncludes', expected: 'helper-contract' }, { type: 'textIncludes', expected: 'no-network' }, { type: 'textIncludes', expected: 'no-launch' }]
  );
  const contentBoundary = sampleContentBoundary('about:blank');
  const providerRegistry = validateProviderRegistry();
  const checks = [
    { name: 'skill-id', ok: SKILL_ID === 'hyper-cloaking', expected: 'hyper-cloaking', actual: SKILL_ID },
    { name: 'version', ok: VERSION === '0.0.1', expected: '0.0.1', actual: VERSION },
    { name: 'schema-version', ok: SCHEMA_VERSION === '0.0.1', expected: '0.0.1', actual: SCHEMA_VERSION },
    { name: 'default-home', ok: DEFAULT_HOME === '~/.hyper-cloaking', expected: '~/.hyper-cloaking', actual: DEFAULT_HOME },
    { name: 'mcp-server-id', ok: MCP_SERVER_ID === 'hyper-cloaking', expected: 'hyper-cloaking', actual: MCP_SERVER_ID },
    { name: 'cloakbrowser-package', ok: CLOAKBROWSER_PACKAGE === 'cloakbrowser', expected: 'cloakbrowser', actual: CLOAKBROWSER_PACKAGE },
    { name: 'playwright-core-package', ok: PLAYWRIGHT_CORE_PACKAGE === 'playwright-core', expected: 'playwright-core', actual: PLAYWRIGHT_CORE_PACKAGE },
    { name: 'playwright-mcp-package', ok: PLAYWRIGHT_MCP_PACKAGE === '@playwright/mcp', expected: '@playwright/mcp', actual: PLAYWRIGHT_MCP_PACKAGE },
    { name: 'provider-registry', ok: providerRegistry.ok, expected: true, actual: providerRegistry.ok },
    ...helperChecks
  ];
  const ok = checks.every((check) => check.ok);
  return makeResult('validate', {
    ok,
    status: ok ? 'ok' : 'failed',
    checks,
    helperMetadata: helperChecks,
    providerRegistry,
    ...completionFields({
      targetSafety,
      outcome,
      contentBoundary,
      learning: false
    }),
    network: 'not-used',
    sideEffects: 'none'
  });
}

async function smokeCommand(options) {
  const home = resolveHome(options.home);
  const directories = [
    home,
    homePath(home, 'cache'),
    homePath(home, 'profiles'),
    homePath(home, 'state'),
    homePath(home, 'tmp'),
    homePath(home, 'bin')
  ];

  for (const directory of directories) {
    await ensureDirectory(directory);
  }

  const fakeExecutable = homePath(home, 'bin', 'fake-cloakbrowser-chrome');
  await writeFakeExecutable(fakeExecutable);
  const executable = validateExecutablePath(fakeExecutable);
  const configs = generateAllMcpConfigs({ executablePath: fakeExecutable, headless: wantsHeadless(options) });
  const targetSafety = targetSafetyFor('about:blank');
  const outcome = safeOutcome(
    { evidenceCaptured: true, text: 'sandbox-home fake-executable-configs no-network no-launch' },
    [{ type: 'evidenceCaptured' }, { type: 'textIncludes', expected: 'no-network' }, { type: 'textIncludes', expected: 'no-launch' }]
  );
  const diagnostic = blockedFailure('smoke-live-launch', ['smoke command does not launch browser dependencies'], ['sandbox directory check', 'fake executable validation', 'MCP config rendering']);
  const contentBoundary = sampleContentBoundary('about:blank');
  const evidenceScopePlan = makeEvidencePlan({
    targetUrl: 'about:blank',
    approvedOrigins: [],
    requestedEvidenceKinds: ['local-config', 'fake-executable']
  });
  const runShape = await appendRunShape(homePath(home, 'state'), {
    command: 'smoke',
    learning: false,
    headless: wantsHeadless(options),
    network: 'not-used',
    liveLaunch: 'not-attempted'
  }, { learning: false });

  return makeResult('smoke', {
    home,
    createdOrChecked: directories,
    fakeExecutable,
    executable,
    configs,
    targetSafetySample: targetSafety,
    outcomeReportSample: makeOutcomeReport({ targetSafety, outcome, contentBoundary, learning: { enabled: false, written: false } }),
    diagnosticSample: diagnostic,
    contentBoundarySample: contentBoundary,
    evidenceScopePlan,
    runShape,
    ...completionFields({
      targetSafety,
      outcome,
      failure: null,
      contentBoundary,
      learning: false
    }),
    network: 'not-used',
    liveLaunch: 'not-attempted'
  });
}
async function executableCandidates(cacheRoot) {
  const candidates = [];
  async function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
      } else if (['chrome', 'chrome.exe', 'Chromium'].includes(entry.name)) {
        const validation = validateExecutablePath(entryPath);
        if (validation.ok) candidates.push(validation.executablePath);
      }
    }
  }
  await walk(cacheRoot);
  return candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

async function mcpConfigCommand(options) {
  const home = resolveHome(options.home);
  const client = options.client || 'direct';
  const explicitExecutable = options.executable ? path.resolve(expandHome(String(options.executable))) : null;
  const executablePath = explicitExecutable || (await executableCandidates(homePath(home, 'cache', 'cloakbrowser')))[0];
  const targetSafety = targetSafetyFor('about:blank');
  const contentBoundary = sampleContentBoundary('about:blank');

  if (!executablePath) {
    return makeResult('mcp-config', {
      ok: false,
      status: 'blocked',
      home,
      client,
      blockers: [`No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`],
      failure: blockedFailure('mcp-config-executable-discovery', [`No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`], ['contained cache executable discovery']),
      ...completionFields({
        targetSafety,
        outcome: safeOutcome({ text: 'blocked missing executable-path' }, [{ type: 'textIncludes', expected: 'valid executable' }]),
        failure: blockedFailure('mcp-config-executable-discovery', [`No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`], ['contained cache executable discovery']),
        contentBoundary,
        learning: false
      }),
      installHint: 'Run local live/setup under a contained HYPER_CLOAKING_HOME so CloakBrowser cache artifacts stay under ~/.hyper-cloaking.',
      network: 'not-used',
      liveLaunch: 'not-attempted'
    });
  }

  const executable = validateExecutablePath(executablePath);
  if (!executable.ok) {
    return makeResult('mcp-config', {
      ok: false,
      status: 'blocked',
      home,
      client,
      executablePath: executable.executablePath || path.resolve(executablePath),
      executableChecked: true,
      blockers: [executable.reason],
      failure: blockedFailure('mcp-config-executable-validation', [executable.reason], ['executable path validation']),
      ...completionFields({
        targetSafety,
        outcome: safeOutcome({ text: 'blocked invalid executable-path' }, [{ type: 'textIncludes', expected: 'valid executable' }]),
        failure: blockedFailure('mcp-config-executable-validation', [executable.reason], ['executable path validation']),
        contentBoundary,
        learning: false
      }),
      installHint: 'Run local live/setup under a contained HYPER_CLOAKING_HOME so CloakBrowser cache artifacts stay under ~/.hyper-cloaking.',
      network: 'not-used',
      liveLaunch: 'not-attempted'
    });
  }

  const config = generateMcpConfig({
    client,
    executablePath: executable.executablePath,
    headless: wantsHeadless(options)
  });

  return makeResult('mcp-config', {
    home,
    executablePath: executable.executablePath,
    executableChecked: true,
    client,
    config,
    ...completionFields({
      targetSafety,
      outcome: safeOutcome({ text: 'valid-executable-path mcp-config' }, [{ type: 'textIncludes', expected: 'valid-executable-path' }, { type: 'textIncludes', expected: 'mcp-config' }]),
      contentBoundary,
      learning: false
    }),
    network: 'not-used',
    liveLaunch: 'not-attempted'
  });
}

function containedEnv(home, env = process.env) {
  const resolvedHome = resolveHome(home);
  const cacheRoot = homePath(resolvedHome, 'cache');
  const configRoot = homePath(resolvedHome, 'config');
  const dataRoot = homePath(resolvedHome, 'data');
  const tmpRoot = homePath(resolvedHome, 'tmp');
  return {
    ...env,
    HOME: resolvedHome,
    HYPER_CLOAKING_HOME: resolvedHome,
    XDG_CACHE_HOME: cacheRoot,
    XDG_CONFIG_HOME: configRoot,
    XDG_DATA_HOME: dataRoot,
    TMPDIR: tmpRoot,
    npm_config_cache: homePath(cacheRoot, 'npm'),
    npm_config_prefix: homePath(resolvedHome, 'npm-prefix'),
    npm_config_userconfig: homePath(configRoot, 'npmrc'),
    PLAYWRIGHT_BROWSERS_PATH: homePath(cacheRoot, 'playwright'),
    CLOAKBROWSER_CACHE_DIR: homePath(cacheRoot, 'cloakbrowser')
  };
}

async function tryImportPackage(packageName) {
  try {
    await import(packageName);
    return { ok: true, package: packageName };
  } catch (error) {
    return {
      ok: false,
      package: packageName,
      blocker: {
        code: 'package-unavailable',
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function newPageFromBrowser(browser) {
  if (browser && typeof browser.newPage === 'function') return browser.newPage();
  if (browser && typeof browser.newContext === 'function') {
    const context = await browser.newContext();
    if (context && typeof context.newPage === 'function') return context.newPage();
  }
  if (browser && typeof browser.contexts === 'function') {
    const [context] = browser.contexts();
    if (context && typeof context.newPage === 'function') return context.newPage();
  }
  throw new Error('CloakBrowser launch returned no Playwright-compatible page factory');
}

export async function closeBrowserHandle(browser, timeoutMs = 5_000) {
  if (!browser || typeof browser.close !== 'function') {
    return { ok: true, closed: false, timedOut: false, blocker: 'no browser handle' };
  }
  let timer;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`browser close timed out after ${timeoutMs}ms`);
          error.code = 'HYPER_CLOAKING_CLOSE_TIMEOUT';
          reject(error);
        }, timeoutMs);
      })
    ]);
    return { ok: true, closed: true, timedOut: false, blocker: null };
  } catch (error) {
    return {
      ok: false,
      closed: false,
      timedOut: error?.code === 'HYPER_CLOAKING_CLOSE_TIMEOUT',
      blocker: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function installNavigationSafety(page, options = {}) {
  if (!page || typeof page.route !== 'function') {
    return { ok: false, blocker: 'Playwright route interception is unavailable; unsafe redirects cannot be blocked before request dispatch' };
  }
  const allowedOrigins = normalizedAllowedOrigins(options.allowedOrigins || []);
  const maxRedirects = normalizeMaxRedirects(options.maxRedirects);
  const state = { documentUrls: [], violations: [], maxRedirects };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const isNavigation = typeof request.isNavigationRequest === 'function'
      ? request.isNavigationRequest()
      : request.resourceType?.() === 'document';
    if (!isNavigation) {
      await route.continue();
      return;
    }
    const url = request.url();
    state.documentUrls.push(url);
    const aboutBlankAllowed = options.allowAboutBlank === true && url === 'about:blank';
    const publicDocumentCount = state.documentUrls.filter((item) => item !== 'about:blank').length;
    const redirectCount = Math.max(0, publicDocumentCount - 1);
    const originAllowed = aboutBlankAllowed || isOriginApproved(url, allowedOrigins);
    const safety = classifyTargetUrl(url, options);
    if (!originAllowed || redirectCount > maxRedirects || safety.disposition !== 'ok') {
      const reason = !originAllowed ? 'origin-not-allowed' : redirectCount > maxRedirects ? 'max-redirects-exceeded' : safety.reason;
      state.violations.push(`${reason}:${url}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  Object.defineProperty(page, '__hyperCloakingNavigationSafety', {
    value: state,
    configurable: true
  });
  return { ok: true, state };
}

function normalizedAllowedOrigins(values) {
  const list = Array.isArray(values) ? values : [values];
  const normalized = list.filter((value) => value !== undefined && value !== null && value !== true).map((value) => normalizeOrigin(value));
  if (normalized.some((value) => value === null)) throw new Error('allowed origin is invalid or opaque');
  if (new Set(normalized).size !== normalized.length) throw new Error('allowed origins contain duplicates');
  return normalized;
}

function normalizeMaxRedirects(value) {
  const parsed = value === undefined ? 5 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) throw new Error('maxRedirects must be an integer from 0 to 5');
  return parsed;
}

async function readPageTextSignal(page) {
  if (!page) return '';
  const failures = [];
  if (typeof page.locator === 'function') {
    try {
      const body = page.locator('body');
      if (body && typeof body.innerText === 'function') return await body.innerText({ timeout: 1_000 });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (typeof page.textContent === 'function') {
    try {
      return await page.textContent('body', { timeout: 1_000 }) || '';
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) {
    throw new Error(`page text signal unavailable: ${failures.join('; ')}`);
  }
  return '';
}

async function withTemporaryEnv(envPatch, fn) {
  const previous = new Map();
  for (const [name, value] of Object.entries(envPatch || {})) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

export async function gotoAndClassify(page, fromUrl, toUrl, options = {}) {
  const navigationState = page?.__hyperCloakingNavigationSafety;
  if (!navigationState || typeof navigationState !== 'object') {
    const error = new Error('Navigation safety route interception must be installed before page.goto');
    error.code = 'HYPER_CLOAKING_NAVIGATION_SAFETY_NOT_INSTALLED';
    throw error;
  }
  const aboutBlankAllowed = options.allowAboutBlank === true && toUrl === 'about:blank';
  const allowedOrigins = normalizedAllowedOrigins(options.allowedOrigins || []);
  if (!aboutBlankAllowed && !isOriginApproved(toUrl, allowedOrigins)) {
    const error = new Error(`Navigation origin is not authorized: ${toUrl}`);
    error.code = 'HYPER_CLOAKING_ORIGIN_NOT_ALLOWED';
    throw error;
  }
  assertNavigationAllowed(toUrl, options);
  await page.goto(toUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const finalUrl = typeof page.url === 'function' ? page.url() : toUrl;
  const finalAboutBlankAllowed = options.allowAboutBlank === true && finalUrl === 'about:blank';
  if (!finalAboutBlankAllowed && !isOriginApproved(finalUrl, allowedOrigins)) {
    const error = new Error(`Navigation redirected to unauthorized origin: ${finalUrl}`);
    error.code = 'HYPER_CLOAKING_ORIGIN_NOT_ALLOWED';
    throw error;
  }
  const redirectSafety = classifyRedirect(fromUrl, finalUrl, options);
  if (redirectSafety.disposition !== 'ok') {
    const error = new Error(`Navigation redirected to unsafe target: ${redirectSafety.reason}`);
    error.code = 'HYPER_CLOAKING_REDIRECT_SAFETY';
    error.classification = redirectSafety;
    throw error;
  }
  return { finalUrl, redirectSafety, documentUrls: [...navigationState.documentUrls], violations: [...navigationState.violations] };
}

async function captureLiveEvidence(page, evidenceDir) {
  const evidenceRefs = [];
  await ensureDirectory(evidenceDir);
  if (page && typeof page.screenshot === 'function') {
    const screenshotPath = path.join(evidenceDir, `live-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    evidenceRefs.push(summarizeEvidenceRef({
      path: screenshotPath,
      kind: 'live-browser-screenshot',
      trusted: true
    }));
  }
  return evidenceRefs;
}


function emptyProviderField(source) {
  return {
    ok: false,
    id: null,
    label: null,
    source,
    fallbackUsed: false,
    matchedDomain: null,
    cookieSiteKeyHint: null,
    profileLabelHint: null,
    preflightDefaults: null,
    outcomeHints: null,
    safeFlowNotes: null
  };
}

function providerField(provider, { source, fallbackUsed = false, matchedDomain = null }) {
  return {
    ok: true,
    id: provider.id,
    label: provider.label,
    source,
    fallbackUsed,
    matchedDomain,
    cookieSiteKeyHint: provider.cookie.siteKey,
    profileLabelHint: provider.profile.label,
    preflightDefaults: provider.preflight,
    outcomeHints: provider.outcomeHints,
    safeFlowNotes: provider.safeFlowNotes
  };
}

// Resolves provider metadata only. `--provider` is explicit selection and
// fails closed on an unknown id (no generic fallback). Without `--provider`,
// the provider is inferred from navigationTarget; unknown hosts fall back to
// generic and invalid/ambiguous hosts fail closed. Provider hints never
// override target-safety/recon/preflight gates.
function resolveProviderInfo(options, navigationTarget) {
  const hasExplicitProvider = typeof options.provider === 'string' || options.provider === true;
  if (hasExplicitProvider) {
    const requestedId = typeof options.provider === 'string' ? options.provider : '';
    const resolution = getProvider(requestedId);
    if (!resolution.ok) {
      return {
        provider: emptyProviderField('explicit'),
        resolvedProvider: null,
        providerError: { ...resolution.error, source: 'explicit' },
        matchedViaNavigationOnlyAlias: false
      };
    }
    return {
      provider: providerField(resolution.provider, { source: 'explicit' }),
      resolvedProvider: resolution.provider,
      providerError: null,
      matchedViaNavigationOnlyAlias: false
    };
  }

  const resolution = resolveProviderForUrl(navigationTarget);
  if (!resolution.ok) {
    return {
      provider: emptyProviderField('url'),
      resolvedProvider: null,
      providerError: { ...resolution.error, source: 'url' },
      matchedViaNavigationOnlyAlias: false
    };
  }
  return {
    provider: providerField(resolution.provider, {
      source: resolution.source,
      fallbackUsed: resolution.fallbackUsed,
      matchedDomain: resolution.matchedDomain
    }),
    resolvedProvider: resolution.provider,
    providerError: null,
    matchedViaNavigationOnlyAlias: Boolean(resolution.matchedViaNavigationOnlyAlias)
  };
}

// Cookie selection precedence: --cookie-site wins, --site remains a
// cookie-site alias (not a provider id), --account wins. Provider
// cookie.siteKey is only a hint/seed, and navigation-only alias matches
// (link-shortener/redirect hosts) never seed it. liveCommand does not load
// cookies today, so this reflects option-derived selection with loadedCount 0.
function buildCookieSelection(options, providerInfo, matchedViaNavigationOnlyAlias) {
  const explicitSite = typeof options['cookie-site'] === 'string' ? options['cookie-site'] : null;
  const legacySite = typeof options.site === 'string' ? options.site : null;
  const explicitAccount = typeof options.account === 'string' ? options.account : null;
  const providerSiteKeyHint = (providerInfo?.ok && !matchedViaNavigationOnlyAlias) ? providerInfo.cookieSiteKeyHint : null;

  let siteSource = 'none';
  if (explicitSite) siteSource = 'cookie-site';
  else if (legacySite) siteSource = 'site-alias';
  else if (providerSiteKeyHint) siteSource = 'provider-hint';

  return {
    siteSource,
    site: explicitSite || legacySite || providerSiteKeyHint || null,
    account: explicitAccount,
    explicitSite,
    explicitAccount,
    providerSiteKeyHint,
    loadedCount: 0,
    needsAccount: false,
    fallbackUsed: !explicitSite && !legacySite && Boolean(providerSiteKeyHint)
  };
}

export async function runLiveVerification(options, deps = {}) {
  const runtimeEnv = deps.env ?? process.env;
  const importPackage = deps.tryImportPackage ?? tryImportPackage;
  const findExecutables = deps.executableCandidates ?? executableCandidates;
  const buildMcpConfig = deps.generateMcpConfig ?? generateMcpConfig;
  const launchBrowser = deps.launchCloakBrowser ?? launchCloakBrowser;
  const createPage = deps.newPageFromBrowser ?? newPageFromBrowser;
  const installSafety = deps.installNavigationSafety ?? installNavigationSafety;
  const navigate = deps.gotoAndClassify ?? gotoAndClassify;
  const buildSession = deps.buildProviderSession ?? buildProviderSession;
  const readTextSignal = deps.readPageTextSignal ?? readPageTextSignal;
  const captureEvidence = deps.captureLiveEvidence ?? captureLiveEvidence;
  const closeBrowser = deps.closeBrowserHandle ?? closeBrowserHandle;
  const runWithTemporaryEnv = deps.withTemporaryEnv ?? withTemporaryEnv;
  const home = resolveHome(options.home);
  const target = String(options.target || 'about:blank');
  const publicTarget = String(options['public-target'] || 'https://example.com');
  const navigationTarget = target === 'about:blank' ? publicTarget : target;
  const requestedOrigins = options.allowedOrigins || options['allowed-origin'];
  const allowedOrigins = normalizedAllowedOrigins(
    requestedOrigins === undefined ? [normalizeOrigin(navigationTarget)] : requestedOrigins
  );
  if (!isOriginApproved(navigationTarget, allowedOrigins)) {
    throw new Error(`Navigation target origin is not in allowedOrigins: ${navigationTarget}`);
  }
  const maxRedirects = normalizeMaxRedirects(options.maxRedirects ?? options['max-redirects']);
  const targetSafety = targetSafetyFor(target);
  const navigationTargetSafety = targetSafetyFor(navigationTarget);
  const contentBoundary = sampleContentBoundary(target);
  // Provider resolution happens alongside target computation, before any
  // cookie/browser/package work. An explicit unknown --provider (or an
  // invalid/ambiguous inferred host) fails closed here.
  const providerResolution = resolveProviderInfo(options, navigationTarget);
  const cookieSelection = buildCookieSelection(options, providerResolution.provider, providerResolution.matchedViaNavigationOnlyAlias);

  if (providerResolution.providerError) {
    const providerBlockers = [`Provider resolution failed: ${providerResolution.providerError.code}: ${providerResolution.providerError.message}`];
    const providerFailure = blockedFailure('live-provider-resolution', providerBlockers, ['target classification', 'provider resolution']);
    return makeResult('live', {
      ok: false,
      status: 'blocked',
      home,
      target,
      publicTarget,
      navigationTarget,
      provider: providerResolution.provider,
      providerError: providerResolution.providerError,
      cookieSelection,
      targetSafety,
      navigationTargetSafety,
      blockers: providerBlockers,
      ...completionFields({
        targetSafety,
        outcome: safeOutcome(
          { text: 'blocked before package-checks and browser-launch due to provider-resolution-failure' },
          [{ type: 'textIncludes', expected: 'provider resolved' }]
        ),
        failure: providerFailure,
        contentBoundary,
        learning: false
      }),
      network: 'not-used',
      liveLaunch: 'not-attempted'
    });
  }

  const learningEnabled = options.learning === true || options.learning === 'true';
  const runShape = sanitizeRunShape({
    command: 'live',
    target,
    navigationTarget,
    headless: wantsHeadless(options),
    learning: learningEnabled,
    network: 'pending-preflight',
    liveLaunch: 'pending-preflight'
  });
  if (learningEnabled) await appendRunShape(homePath(home, 'state'), runShape, { learning: true });
  const childEnv = containedEnv(home, runtimeEnv);
  const containmentEntries = [
    ['HOME', childEnv.HOME],
    ['HYPER_CLOAKING_HOME', childEnv.HYPER_CLOAKING_HOME],
    ['XDG_CACHE_HOME', childEnv.XDG_CACHE_HOME],
    ['XDG_CONFIG_HOME', childEnv.XDG_CONFIG_HOME],
    ['XDG_DATA_HOME', childEnv.XDG_DATA_HOME],
    ['TMPDIR', childEnv.TMPDIR],
    ['npm_config_cache', childEnv.npm_config_cache],
    ['npm_config_prefix', childEnv.npm_config_prefix],
    ['npm_config_userconfig', childEnv.npm_config_userconfig],
    ['PLAYWRIGHT_BROWSERS_PATH', childEnv.PLAYWRIGHT_BROWSERS_PATH],
    ['CLOAKBROWSER_CACHE_DIR', childEnv.CLOAKBROWSER_CACHE_DIR]
  ].map(([name, value]) => ({ name, path: value, contained: isInside(home, value) }));
  const blockers = containmentEntries
    .filter((entry) => !entry.contained)
    .map((entry) => `${entry.name} is outside ${home}`);
  const containmentOk = blockers.length === 0;
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const minimumNodeMajor = 20;
  const runtimeOk = nodeMajor >= minimumNodeMajor;
  if (!runtimeOk) blockers.push(`Node ${process.version} is below CloakBrowser JavaScript requirement >=20`);
  if (targetSafety.disposition && targetSafety.disposition !== 'ok') blockers.push(`Target safety ${targetSafety.disposition}: ${targetSafety.reason || 'navigation is not allowed'}`);
  if (navigationTargetSafety.disposition && navigationTargetSafety.disposition !== 'ok') blockers.push(`Navigation target safety ${navigationTargetSafety.disposition}: ${navigationTargetSafety.reason || 'navigation is not allowed'}`);

  const packageChecks = [];
  for (const packageName of [CLOAKBROWSER_PACKAGE, PLAYWRIGHT_CORE_PACKAGE]) {
    const check = await runWithTemporaryEnv(childEnv, () => importPackage(packageName));
    packageChecks.push(check);
    if (!check.ok) blockers.push(`${packageName} unavailable: ${check.blocker.reason}`);
  }

  const mcpExecutablePath = (await findExecutables(homePath(home, 'cache', 'cloakbrowser')))[0];
  if (!mcpExecutablePath) blockers.push(`No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`);
  const mcpConfig = mcpExecutablePath
    ? buildMcpConfig({
      client: 'json',
      executablePath: mcpExecutablePath,
      headless: wantsHeadless(options)
    })
    : null;

  const baseLiveFields = {
    home,
    containment: {
      ok: containmentOk,
      env: containmentEntries,
      pathAudit: containmentEntries
    },
    runtime: {
      ok: runtimeOk,
      nodeVersion: process.version,
      minimumNode: '>=20',
      source: 'skill compatibility: CloakBrowser JavaScript currently requires Node.js >= 20'
    },
    packageChecks,
    targetSafety,
    navigationTargetSafety,
    provider: providerResolution.provider,
    providerError: null,
    cookieSelection,
    mcpConfig: mcpConfig
      ? {
        ok: true,
        serverId: MCP_SERVER_ID,
        containsOldId: false,
        executablePath: mcpExecutablePath,
        config: mcpConfig
      }
      : {
        ok: false,
        serverId: MCP_SERVER_ID,
        containsOldId: false,
        blocker: `No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`
      },
    learning: learningEnabled
      ? { enabled: true, persisted: true, runShape }
      : { enabled: false, persisted: false, reason: 'self-learning disabled unless explicitly enabled' }
  };

  function blockedResult(stage, blockedBy, attempted = ['target classification', 'containment audit', 'Node runtime check', 'package import checks', 'MCP executable discovery']) {
    const failure = blockedFailure(stage, blockedBy, attempted);
    return makeResult('live', {
      ok: false,
      status: 'blocked',
      ...baseLiveFields,
      aboutBlank: { requested: target === 'about:blank', ok: false, blocker: 'browser launch not attempted before live preflight passes' },
      publicNavigation: {
        requested: true,
        target: navigationTarget,
        ok: false,
        blocker: {
          code: 'public-navigation-unavailable',
          reason: 'browser launch not attempted before live preflight passes'
        }
      },
      humanization: {
        ok: false,
        method: 'cloakbrowser-js-api',
        evidence: null,
        blocker: 'humanize:true cannot be proven until CloakBrowser JS launch succeeds'
      },
      mcpFeasibility: {
        ok: false,
        blocker: 'Playwright MCP launch is not attempted before live package availability and containment pass'
      },
      cleanup: {
        ok: true,
        closed: true,
        reason: 'no browser was launched'
      },
      blockers: blockedBy,
      ...completionFields({
        targetSafety,
        outcome: safeOutcome(
          { text: 'blocked before actual-browser-launch', target, targetSafety, blockers: blockedBy, packageChecks, liveLaunch: 'not-attempted' },
          [{ type: 'textIncludes', expected: 'actual-browser-launch succeeded' }]
        ),
        failure,
        contentBoundary,
        learning: baseLiveFields.learning
      }),
      network: 'not-used',
      liveLaunch: 'not-attempted'
    });
  }

  if (blockers.length > 0) {
    return blockedResult('live-preflight', blockers);
  }

  let browser;
  let page;
  const attempted = ['target classification', 'containment audit', 'Node runtime check', 'package import checks', 'CloakBrowser JS launch'];
  const parentStaged = options.publicationMode === 'parent-staged';
  const evidenceDir = parentStaged
    ? path.resolve(String(options.agentStagingRoot || ''))
    : homePath(home, 'evidence');
  if (parentStaged && (!options.agentStagingRoot || !path.isAbsolute(evidenceDir))) {
    throw new Error('parent-staged live verification requires an absolute agentStagingRoot');
  }
  try {
    const launched = await runWithTemporaryEnv(childEnv, () => launchBrowser({ workspace: home, headless: wantsHeadless(options) }));
    browser = launched.browser;
    page = await createPage(browser);
    const routeSafety = await installSafety(page, {
      allowAboutBlank: true,
      context: 'setup',
      allowedOrigins,
      maxRedirects
    });
    if (!routeSafety.ok) {
      const error = new Error(routeSafety.blocker);
      error.code = 'HYPER_CLOAKING_REDIRECT_INTERCEPTION_UNAVAILABLE';
      throw error;
    }
    attempted.push('about:blank navigation');
    await navigate(page, 'about:blank', 'about:blank', {
      allowAboutBlank: true,
      context: 'setup',
      allowedOrigins,
      maxRedirects
    });
    attempted.push('safe public navigation');
    let navigation;
    if (providerResolution.resolvedProvider?.id && providerResolution.resolvedProvider.id !== 'generic') {
      const strictSession = buildSession(page, {
        provider: providerResolution.resolvedProvider,
        ...(requestedOrigins === undefined ? {} : { allowedOrigins }),
        targetSafety: navigationTargetSafety,
        stateDir: homePath(home, 'state'),
        interactive: false
      });
      const strictNavigation = await strictSession.navigateGuardedForRead(
        navigationTarget,
        { waitUntil: 'domcontentloaded', timeout: 30_000 }
      );
      const routeState = page?.__hyperCloakingNavigationSafety;
      navigation = {
        finalUrl: strictNavigation.url,
        status: strictNavigation.status,
        redirectSafety: classifyRedirect(navigationTarget, strictNavigation.url, {
          allowedOrigins: strictSession.strictAllowedOrigins,
          maxRedirects
        }),
        documentUrls: Array.isArray(routeState?.documentUrls) ? [...routeState.documentUrls] : [strictNavigation.url],
        violations: Array.isArray(routeState?.violations) ? [...routeState.violations] : []
      };
    } else {
      navigation = await navigate(page, target, navigationTarget, {
        allowAboutBlank: true,
        allowedOrigins,
        maxRedirects
      });
    }
    const title = typeof page.title === 'function' ? await page.title() : '';
    const bodyText = await readTextSignal(page);
    const challenge = classifyChallengeObservation({
      url: navigation.finalUrl,
      title,
      text: bodyText
    });
    if (challenge.blocker) {
      const error = new Error(`Challenge or access blocker observed: ${challenge.labels.join(', ')}`);
      error.code = 'HYPER_CLOAKING_CHALLENGE_OBSERVED';
      error.challenge = challenge;
      throw error;
    }
    const evidenceRefs = await captureEvidence(page, evidenceDir);
    const cleanup = await closeBrowser(browser);
    if (cleanup.closed) browser = null;
    const outcome = safeOutcome(
      {
        url: navigation.finalUrl,
        urlLoaded: true,
        title,
        text: `${title}\n${bodyText}`.trim(),
        evidenceCaptured: evidenceRefs.length > 0,
        evidenceRefs: evidenceRefs.map((ref) => ref.path).filter(Boolean),
        artifacts: evidenceRefs
      },
      [
        { type: 'urlLoaded', id: 'live-url-loaded' },
        { type: 'urlIncludes', id: 'live-target-origin', expected: new URL(navigationTarget).hostname },
        ...(evidenceRefs.length > 0 ? [{ type: 'evidenceCaptured', id: 'live-evidence-captured' }] : [])
      ]
    );
    const humanization = {
      ok: false,
      configured: true,
      method: 'cloakbrowser-js-api',
      evidence: 'launchCloakBrowser configuration requests humanize:true; runtime telemetry is unavailable',
      blocker: 'runtime humanization telemetry unavailable'
    };
    const cleanupVerified = cleanup.ok === true && cleanup.closed === true && cleanup.timedOut === false;
    const livePassed = outcome.passed && humanization.ok && cleanupVerified;
    const liveBlockers = [
      ...outcome.failedCriteria.map((criterion) => `${criterion.id} failed`),
      ...(humanization.ok ? [] : [humanization.blocker]),
      ...(cleanupVerified ? [] : [cleanup.blocker || 'browser cleanup could not be verified'])
    ];

    return makeResult('live', {
      ok: livePassed,
      status: livePassed ? 'ok' : 'blocked',
      ...baseLiveFields,
      finalUrl: navigation.finalUrl,
      title,
      aboutBlank: { requested: true, ok: true },
      publicNavigation: {
        requested: true,
        target: navigationTarget,
        ok: livePassed,
        finalUrl: navigation.finalUrl,
        redirectSafety: navigation.redirectSafety,
        documentUrls: navigation.documentUrls,
        violations: navigation.violations,
        allowedOrigins,
        maxRedirects
      },
      publicationMode: parentStaged ? 'parent-staged' : 'legacy-final',
      evidenceRefs,
      humanization,
      mcpFeasibility: {
        ok: Boolean(mcpConfig),
        blocker: mcpConfig ? null : `No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`
      },
      cleanup,
      blockers: livePassed ? [] : liveBlockers,
      ...completionFields({
        targetSafety: navigation.redirectSafety,
        outcome,
        failure: livePassed ? null : blockedFailure(cleanupVerified ? 'live-outcome' : 'browser-cleanup-unverified', liveBlockers, attempted),
        contentBoundary,
        learning: baseLiveFields.learning
      }),
      network: 'used-for-live-navigation',
      liveLaunch: 'attempted'
    });
  } catch (error) {
    const cleanup = await closeBrowser(browser);
    const reason = error instanceof Error ? error.message : String(error);
    const cleanupVerified = cleanup.ok === true && cleanup.closed === true && cleanup.timedOut === false;
    const catchBlockers = [
      reason,
      ...(cleanupVerified ? [] : [cleanup.blocker || 'browser cleanup could not be verified'])
    ].filter((value, index, values) => values.indexOf(value) === index);
    const failure = blockedFailure(
      cleanupVerified ? 'live-browser-launch-or-navigation' : 'browser-cleanup-unverified',
      catchBlockers,
      attempted
    );
    return makeResult('live', {
      ok: false,
      status: 'blocked',
      ...baseLiveFields,
      aboutBlank: { requested: target === 'about:blank', ok: false, blocker: reason },
      publicNavigation: {
        requested: true,
        target: navigationTarget,
        ok: false,
        blocker: {
          code: error?.code || 'live-navigation-unavailable',
          reason
        }
      },
      humanization: {
        ok: false,
        method: 'cloakbrowser-js-api',
        evidence: null,
        blocker: 'humanize:true could not be proven because live launch/navigation failed'
      },
      mcpFeasibility: {
        ok: Boolean(mcpConfig),
        blocker: mcpConfig ? null : `No executable found under ${homePath(home, 'cache', 'cloakbrowser')}`
      },
      cleanup,
      blockers: catchBlockers,
      ...completionFields({
        targetSafety: error?.classification ?? navigationTargetSafety,
        outcome: safeOutcome(
          { text: reason, target, navigationTarget, liveLaunch: 'attempted' },
          [{ type: 'textIncludes', expected: 'live navigation succeeded' }]
        ),
        failure,
        contentBoundary,
        learning: baseLiveFields.learning
      }),
      network: 'maybe-used-before-blocker',
      liveLaunch: 'attempted'
    });
  }
}

const MAX_CREDENTIAL_STDIN_BYTES = 1024 * 1024;

async function readCredentialStdin() {
  if (process.stdin.isTTY) throw new Error('credential import requires piped stdin, --source, or --env-prefix');
  let input = '';
  let bytes = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_CREDENTIAL_STDIN_BYTES) throw new Error('credential import stdin exceeds the size limit');
    input += chunk;
  }
  if (!input.trim()) throw new Error('credential import stdin was empty');
  return parseCredentialJson(input);
}

function credentialCommandResult(operation, fields = {}) {
  const targetSafety = targetSafetyFor('about:blank');
  const outcome = safeOutcome(
    { text: `credential-${operation}-complete no-network`, operation },
    [{ type: 'textIncludes', expected: `credential-${operation}-complete` }]
  );
  return makeResult('credentials', {
    ok: true,
    status: 'ok',
    operation,
    ...fields,
    ...completionFields({
      targetSafety,
      outcome,
      contentBoundary: sampleContentBoundary('about:blank'),
      learning: false
    }),
    network: 'not-used'
  });
}

const CREDENTIAL_OPTIONS = Object.freeze({
  init: Object.freeze([]),
  list: Object.freeze(['provider']),
  inspect: Object.freeze(['profile-id']),
  import: Object.freeze(['profile-id', 'source', 'env-prefix', 'provider', 'kind']),
  remove: Object.freeze(['profile-id']),
  'set-default': Object.freeze(['provider', 'profile-id']),
  validate: Object.freeze([]),
  reconcile: Object.freeze(['operation-id']),
  'resolve-profile': Object.freeze(['provider', 'profile-id', 'scopes'])
});

async function credentialsCommand(options) {
  const operation = options._[1] || 'list';
  const home = resolveHome(options.home);
  const forbidden = Object.keys(options).filter((key) => (
    key !== '_'
    && /(?:secret|token|password|api-key|access-key|credential)/i.test(key)
  ));
  if (forbidden.length > 0) {
    throw new Error(`credential values must not be supplied as command arguments: ${forbidden.join(', ')}`);
  }
  const repeated = [...options[OPTION_OCCURRENCES]]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  if (repeated.length > 0) {
    throw new Error(`Credential options must not be repeated: ${repeated.join(', ')}`);
  }
  const allowed = CREDENTIAL_OPTIONS[operation];
  if (!allowed) throw new Error(`Unknown credentials operation: ${operation}`);
  if (options._.length > 2) throw new Error('credentials command does not accept extra positional arguments');
  const unknown = Object.keys(options).filter((key) => (
    key !== '_'
    && key !== 'home'
    && key !== 'json'
    && !allowed.includes(key)
  ));
  if (unknown.length > 0) throw new Error(`Unknown credentials option: ${unknown.join(', ')}`);

  if (operation === 'init') {
    return credentialCommandResult(operation, await initCredentialStore({ home }));
  }
  if (operation === 'list') {
    const profiles = await listCredentialProfiles({ home, provider: typeof options.provider === 'string' ? options.provider : undefined });
    return credentialCommandResult(operation, { profiles });
  }
  if (operation === 'inspect') {
    const profile = await inspectCredentialProfile({ home, profileId: options['profile-id'] });
    if (!profile) throw new Error('credential profile was not found');
    return credentialCommandResult(operation, { profile });
  }
  if (operation === 'import') {
    const hasSource = Object.hasOwn(options, 'source');
    const hasEnvironment = Object.hasOwn(options, 'env-prefix');
    if (hasSource && hasEnvironment) {
      throw new Error('credential import requires exactly one source: stdin, --source, or --env-prefix');
    }
    let profile;
    if (hasSource) {
      if (typeof options.source !== 'string') throw new Error('credential import --source requires a file path');
      profile = await profileFromSecureSource({ file: options.source });
    } else if (hasEnvironment) {
      if (typeof options['env-prefix'] !== 'string') throw new Error('credential import --env-prefix requires a value');
      profile = profileFromEnvironment({
        provider: options.provider,
        kind: options.kind,
        prefix: options['env-prefix']
      });
    } else {
      profile = await readCredentialStdin();
    }
    const receipt = await importCredentialProfile({
      home,
      profileId: options['profile-id'],
      profile
    });
    return credentialCommandResult(operation, receipt);
  }
  if (operation === 'remove') {
    return credentialCommandResult(operation, await removeCredentialProfile({
      home,
      profileId: options['profile-id']
    }));
  }
  if (operation === 'set-default') {
    return credentialCommandResult(operation, await setDefaultCredentialProfile({
      home,
      provider: options.provider,
      profileId: options['profile-id']
    }));
  }
  if (operation === 'validate') {
    const profiles = await listCredentialProfiles({ home });
    return credentialCommandResult(operation, { valid: true, profileCount: profiles.length });
  }
  if (operation === 'reconcile') {
    return credentialCommandResult(operation, await reconcileCredentialOperation({
      home,
      operationId: options['operation-id']
    }));
  }
  if (operation === 'resolve-profile') {
    const requiredScopes = typeof options.scopes === 'string'
      ? options.scopes.split(',').map((scope) => scope.trim()).filter(Boolean)
      : [];
    const resolved = await resolveCredentialProfile({
      home,
      provider: options.provider,
      profileId: typeof options['profile-id'] === 'string' ? options['profile-id'] : undefined,
      requiredScopes
    });
    if (resolved.status !== 'selected') return credentialCommandResult(operation, resolved);
    const profile = await inspectCredentialProfile({ home, profileId: resolved.profileId });
    return credentialCommandResult(operation, {
      resolutionStatus: resolved.status,
      profile
    });
  }
  throw new Error(`Unknown credentials operation: ${operation}`);
}
export async function runCli(argv = process.argv.slice(2), io = {}) {
  const options = parseArgs(argv);
  const command = options._[0];
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  try {
    if (!command || command === '--help' || command === 'help') {
      const text = wantsJson(options)
        ? jsonResult({ ok: true, status: 'ok', command: 'help', usage: usage(), ...baseMetadata() })
        : `${usage()}\n`;
      stdout.write(text);
      return 0;
    }

    let result;
    if (command === 'validate') {
      result = await validateCommand(options);
    } else if (command === 'credentials') {
      result = await credentialsCommand(options);
    } else if (command === 'smoke') {
      result = await smokeCommand(options);
    } else if (command === 'mcp-config') {
      result = await mcpConfigCommand(options);
    } else if (command === 'live') {
      result = await runLiveVerification(options);
    } else {
      result = { ok: false, status: 'failed', command, error: `Unknown command: ${command}`, ...baseMetadata() };
    }

    stdout.write(output(result, options));
    return result.ok ? 0 : 1;
  } catch (error) {
    const result = {
      ok: false,
      status: 'failed',
      command: command || 'hyper-cloaking',
      ...baseMetadata(),
      error: error instanceof Error ? error.message : String(error)
    };
    const text = output(result, options);
    if (wantsJson(options)) stdout.write(text);
    else stderr.write(text);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await runCli();
}
