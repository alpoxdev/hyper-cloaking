#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCookieCli } from '@mcp/engine/cookie';

export {
  COOKIE_TEMPLATE,
  DEFAULT_WORKSPACE,
  cookiesForUrl,
  cookiesFromJsonPayload,
  domainMatches,
  expandHome,
  importJsonCookies,
  inferSiteForUrl,
  loadCookieConfig,
  loadCookiesIntoContext,
  normalizeCookie,
  normalizeSameSite,
  parseCookieYaml,
  redactCookies,
  resolveWorkspace,
  runCookieCli,
  selectCookieRecords,
  serializeCookieConfig,
  withDefaultSite,
  workspacePaths
} from '@mcp/engine/cookie';

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runCookieCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
