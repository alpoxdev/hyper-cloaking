# Cloak Browser Runtime Workspace

Use this reference when a run needs persistent cookies, profile data, downloads, evidence, or reusable browser-driver utilities.

## Workspace Layout

The default runtime workspace is:

```text
~/.hypercore-business/
├── cookie.yml
├── profiles/
│   └── default/
├── downloads/
├── evidence/
├── logs/
└── state/
```

`scripts/browser-utils.mjs` creates this structure on demand. For sandboxed tests or alternate users, override the path with `CLOAK_BROWSER_WORKSPACE` or `HYPERCORE_BUSINESS_HOME`.

## Preflight Questions

Before setup, cookie loading, or browser launch, ask one bundled preflight question through the host's native structured question surface when available. Claude Code, Codex, Gajae-Code/GJC, Cursor, and other clients may expose different names for the same AskUserQuestion-style capability; use the native mechanism when it exists, and fall back to one concise plain-text question only when it does not.

Suggested preflight fields:

```yaml
targetSite: https://www.example.com
headless: true
cookieMode: use-existing-cookie-yml
cookieSite: default
cookieAccount: default
profileLabel: default
keepOpen: false
```

Defaults:

- `headless` defaults to `true`; use `false` only when the user requested or selected visible browsing.
- `cookieMode` defaults to `use-existing-cookie-yml` when `~/.hypercore-business/cookie.yml` exists, otherwise `no-cookies` unless the user chooses to provide cookies.
- `cookieSite` defaults to the inferred site from the target URL, falling back to `default`.
- `cookieAccount` uses the selected site's only account or `defaultAccount`; if multiple accounts exist and there is no `defaultAccount`, ask before loading cookies.
- `keepOpen` defaults to `false`; close CloakBrowser cleanly after the task unless the user says to keep it open.

When cookie values are requested, treat them as secrets. Store them only in `~/.hypercore-business/cookie.yml`, never echo them back, and report only counts/domains.

## Cookie File

Default cookie file:

```text
~/.hypercore-business/cookie.yml
```

The skill should load this file before visiting a target site when the user has supplied site cookies. Store only cookies the user is authorized to use. Do not store real cookies in the skill folder or commit them to a repository. Use `scripts/cookie.mjs` for all import, normalization, inspection, redaction, and Playwright injection; do not hand-convert Chrome cookie exports.

Preferred site/account schema:

```yaml
sites:
  default:
    description: Fallback cookies used when a requested site has no dedicated entry.
    defaultAccount: default
    accounts:
      default:
        label: Default fallback account
        cookies: []

  coupang:
    domain: .coupang.com
    defaultAccount: personal
    accounts:
      personal:
        label: Personal account
        cookies:
          - path: /
            name: replace_me
            value: replace_me
            httpOnly: true
            secure: true
            sameSite: Lax
      work:
        label: Work account
        cookies: []
```

Top-level legacy `cookies:` lists are still accepted for backward compatibility, but new cookie files should use `sites`.

Site/account selection rules:

- If `--site` is provided and that site exists, use it.
- If `--site` is provided but missing, use `sites.default`.
- If `--site` is omitted, infer the site from the target URL's `domain` or `url`; otherwise use `sites.default`.
- If a site has one account, use it.
- If a site has `defaultAccount`, use that account.
- If a site has multiple accounts and no `defaultAccount`, ask the user which account to use and pass it as `--account`.
- A single account may contain multiple cookies; all matching cookies are loaded together.

Supported cookie fields:

| Field | Meaning |
|---|---|
| `site` | Runtime-selected site label; usually inferred from the `sites` key. |
| `account` | Runtime-selected account label; usually inferred from the `accounts` key. |
| `domain` | Cookie domain, such as `.coupang.com`. |
| `url` | Optional exact origin alternative to `domain`. |
| `path` | Cookie path; defaults to `/`. |
| `name` | Cookie name. |
| `value` | Cookie value. |
| `expires` | Optional Unix timestamp. |
| `expirationDate` | Chrome export timestamp; normalized to Playwright `expires`. |
| `expiry` | Alternate timestamp field; normalized to Playwright `expires`. |
| `httpOnly` | Optional boolean. |
| `secure` | Optional boolean. |
| `sameSite` | `Strict`, `Lax`, or `None`; casing is normalized. Chrome `no_restriction` becomes `None`; Chrome `unspecified` is omitted. |

Cookies are filtered by target URL before loading. A `.coupang.com` cookie applies to `www.coupang.com` and other matching subdomains.

## Utility Script

Initialize or inspect the workspace:

```bash
node scripts/browser-utils.mjs init
node scripts/browser-utils.mjs init --workspace /tmp/cloak-workspace --json
node scripts/cookie.mjs inspect --url https://www.coupang.com --json
node scripts/cookie.mjs inspect --url https://www.coupang.com --site coupang --account personal --json
node scripts/cookie.mjs import-json --site coupang --url https://www.coupang.com --from /path/to/chrome-cookies.json --json
node scripts/browser-utils.mjs cookies --url https://www.coupang.com --json
node scripts/browser-utils.mjs cookies --url https://www.coupang.com --site coupang --account personal --json
```

`cookie.mjs import-json` accepts Chrome cookie export objects (`{ "cookies": [...] }`), raw cookie arrays, and Playwright-style arrays. CLI output redacts values.

Reusable exports:

```javascript
import {
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
  cookiesFromJsonPayload,
  ensureWorkspace,
  importJsonCookies,
  launchCloakBrowser,
  launchPersistentCloakContext,
  loadCookiesIntoContext,
  normalizeCookie,
  normalizeSameSite,
  findByXPath,
  humanMove,
  humanClick,
  humanTypeDelayMs,
  humanType,
  humanScroll
} from './scripts/browser-utils.mjs';
```

For cookie-only tooling, import directly from `./scripts/cookie.mjs`.

`humanMove` randomizes target position inside the element using `DEFAULT_HUMAN_TARGET_MIN_RATIO` and `DEFAULT_HUMAN_TARGET_MAX_RATIO`, and randomizes movement steps using `DEFAULT_HUMAN_MOVE_MIN_STEPS` and `DEFAULT_HUMAN_MOVE_MAX_STEPS`. Override `ratioX`/`ratioY` for exact targeting or `minSteps`/`maxSteps` for a different movement smoothness.

`humanClick` uses `humanMove`, then waits a randomized pre-click pause from `DEFAULT_HUMAN_CLICK_MIN_PAUSE_MS` to `DEFAULT_HUMAN_CLICK_MAX_PAUSE_MS`. Override `beforeClickMs` for a fixed pause or `minBeforeClickMs`/`maxBeforeClickMs` for another range.

`humanType` randomizes each character delay from `DEFAULT_HUMAN_TYPE_MIN_CPM` to `DEFAULT_HUMAN_TYPE_MAX_CPM`, which defaults to 250-270 characters per minute. Pass `delayMs` for a fixed delay, or `minCpm`/`maxCpm` for a different randomized range, only when the user asks for a different typing speed.

`humanScroll` defaults to `DEFAULT_HUMAN_SCROLL_PIXELS_PER_SECOND` and applies `DEFAULT_HUMAN_SCROLL_PAUSE_JITTER` to avoid perfectly regular intervals. Adjust `pixelsPerSecond` for speed, `steps` for granularity, `pauseMs` for a fixed pause, or `pauseJitter` for more or less timing variance between wheel increments.

## Report and Image Evidence

When the browser task asks for analysis, reporting, auditing, research, account/content analysis, or marketer-style review, create a Korean Markdown report by default. Store it under:

```text
~/.hypercore-business/evidence/
```

Use a task-specific filename and reference the browser evidence that supports the conclusions. If screenshots or downloaded images materially improve the report, save them under the same evidence tree and include them with absolute local Markdown image links:

```markdown
![Observed profile state](/Users/name/.hypercore-business/evidence/instagram/profile.png)
```

Keep reports concise, grounded in observed browser state, and free of raw cookie values, private tokens, or unrelated session data.

Common pattern:

```javascript
const { browser, paths } = await launchCloakBrowser({
  headless: false
});
const page = await browser.newPage();
await loadCookiesIntoContext(page.context(), 'https://www.coupang.com', {
  workspace: paths.root
});
await page.goto('https://www.coupang.com');
await humanType(page, '#headerSearchKeyword', '맥미니', { clear: true, submit: true });
await humanClick(page, '//a[contains(@href, "/vp/products/")]');
await browser.close();
```

Persistent profile pattern:

```javascript
const { context, paths } = await launchPersistentCloakContext({
  headless: false
});
await loadCookiesIntoContext(context, 'https://www.coupang.com', {
  workspace: paths.root
});
const page = context.pages()[0] || await context.newPage();
await page.goto('https://www.coupang.com');
await context.close();
```

## Default Flow

Unless the user gives a different lifecycle instruction, operational runs follow this flow:

1. Run the preflight question gate and confirm target, `headless`, cookie mode/account, profile label, and keep-open preference.
2. Initialize `~/.hypercore-business/`.
3. Load `~/.hypercore-business/cookie.yml` and apply matching cookies before the target site flow.
4. Launch CloakBrowser with `humanize: true` and the selected headless/headed mode.
5. Perform the user's requested browser task.
6. Save evidence under `~/.hypercore-business/evidence/` when useful.
7. Write a Korean report under `~/.hypercore-business/evidence/` for analysis/report requests, with image evidence when useful.
8. Close CloakBrowser cleanly unless the user explicitly says to keep it open.
