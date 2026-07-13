import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  cookiesFromJsonPayload,
  importJsonCookies,
  inferSiteForUrl,
  loadCookieConfig,
  parseCookieYaml,
  selectCookieRecords
} from '../../../mcp/engine/cookie.mjs';

test('cookie JSON payload parser rejects unsupported shapes', () => {
  assert.deepEqual(cookiesFromJsonPayload([]), []);
  assert.deepEqual(cookiesFromJsonPayload({ cookies: [] }), []);
  assert.throws(() => cookiesFromJsonPayload({ origins: [] }), /Unsupported cookie JSON payload/);
  assert.throws(() => cookiesFromJsonPayload(null), /Unsupported cookie JSON payload/);
});

test('cookie site inference prefers exact origins then longest domains and rejects ties', () => {
  const config = {
    sites: {
      default: {},
      broad: { domain: '.example.com' },
      narrow: { domain: '.shop.example.com' },
      exact: { url: 'https://shop.example.com/account' }
    }
  };

  assert.equal(inferSiteForUrl(config, 'https://shop.example.com/cart'), 'exact');
  delete config.sites.exact;
  assert.equal(inferSiteForUrl(config, 'https://shop.example.com/cart'), 'narrow');
  config.sites.duplicate = { domain: '.shop.example.com' };
  assert.throws(
    () => inferSiteForUrl(config, 'https://shop.example.com/cart'),
    /Ambiguous cookie site selection/
  );
});
test('cookie configuration rejects dangerous keys, malformed URLs, and unknown explicit sites', async () => {
  for (const key of [
    '__proto__',
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'apply',
    'call',
    'bind'
  ]) {
    assert.throws(
      () =>
        parseCookieYaml(
          `sites:\n  ${key}:\n    accounts:\n      default:\n        cookies:\n          []\n`
        ),
      /safe identifier/
    );
    assert.throws(
      () =>
        parseCookieYaml(
          `sites:\n  safe:\n    accounts:\n      ${key}:\n        cookies:\n          []\n`
        ),
      /safe identifier/
    );
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-cookie-config-'));
  const cookieFile = path.join(root, 'cookie.yml');
  await fs.writeFile(
    cookieFile,
    'sites:\n  broken:\n    url: "not a url"\n    accounts:\n      default:\n        cookies:\n          []\n'
  );
  await assert.rejects(loadCookieConfig(cookieFile), /must be a valid URL/);
  assert.throws(
    () =>
      inferSiteForUrl(
        { sites: { default: {}, broken: { url: 'not a url' } } },
        'https://example.com'
      ),
    /must be a valid URL/
  );
  assert.throws(
    () =>
      selectCookieRecords({ sites: { default: { accounts: {} } } }, 'https://example.com', {
        site: 'typo'
      }),
    /Unknown cookie site/
  );
  assert.throws(
    () =>
      selectCookieRecords(
        {
          sites: {
            safe: {
              accounts: {
                default: { cookies: [{ name: 'session', value: 'secret', domain: '.example.com' }] }
              }
            }
          }
        },
        'not a url',
        { site: 'safe' }
      ),
    /selection target URL/
  );
  assert.throws(() => inferSiteForUrl({ sites: { default: {} } }, 'not a url'), /Target URL/);
  for (const domain of ['example..com', 'example-.com', 'example.-com']) {
    assert.throws(
      () => inferSiteForUrl({ sites: { default: {}, broken: { domain } } }, 'https://example.com'),
      /valid cookie domain/
    );
  }
  assert.throws(
    () =>
      inferSiteForUrl(
        {
          sites: {
            default: {
              accounts: {
                default: {
                  cookies: [{ name: 'session', value: 'secret', domain: 'example..com' }]
                }
              }
            }
          }
        },
        'https://example.com'
      ),
    /valid cookie domain/
  );
});

test('cookie import validates before mutation and atomically replaces valid state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-cookie-'));
  const cookieFile = path.join(root, 'cookie.yml');
  const original =
    'sites:\n  default:\n    accounts:\n      default:\n        cookies:\n          []\n';
  await fs.writeFile(cookieFile, original, { mode: 0o600 });

  await assert.rejects(
    importJsonCookies({ origins: [] }, { cookieFile, site: 'example' }),
    /Unsupported cookie JSON payload/
  );
  assert.equal(await fs.readFile(cookieFile, 'utf8'), original);
  await assert.rejects(
    importJsonCookies([{ name: '', value: 'secret', domain: '.example.com' }], {
      cookieFile,
      site: 'example'
    }),
    /missing name/
  );
  await assert.rejects(
    importJsonCookies([{ name: 'session', value: 'secret', domain: '.example.com' }], {
      cookieFile,
      site: '__proto__'
    }),
    /safe identifier/
  );
  assert.equal(await fs.readFile(cookieFile, 'utf8'), original);
  for (const dangerous of ['toString', 'valueOf', 'hasOwnProperty']) {
    await assert.rejects(
      importJsonCookies([{ name: 'session', value: 'secret', domain: '.example.com' }], {
        cookieFile,
        site: dangerous
      }),
      /safe identifier/
    );
    await assert.rejects(
      importJsonCookies([{ name: 'session', value: 'secret', domain: '.example.com' }], {
        cookieFile,
        site: 'example',
        account: dangerous
      }),
      /safe identifier/
    );
  }
  await assert.rejects(
    importJsonCookies([], { cookieFile, site: 'example', url: 'file:///tmp/cookies' }),
    /must use http or https/
  );
  assert.equal(await fs.readFile(cookieFile, 'utf8'), original);
  await assert.rejects(
    importJsonCookies([], { cookieFile, site: 'example', targetUrl: 'ftp://example.com/path' }),
    /must use http or https/
  );
  await assert.rejects(
    importJsonCookies([], { cookieFile, site: 'example', domain: 'example..com' }),
    /valid cookie domain/
  );
  assert.equal(await fs.readFile(cookieFile, 'utf8'), original);

  const result = await importJsonCookies(
    [{ name: 'session', value: 'secret', domain: '.example.com' }],
    { cookieFile, site: 'example', account: 'authorized' }
  );
  assert.equal(result.count, 1);
  assert.match(await fs.readFile(cookieFile, 'utf8'), /authorized:/);
  assert.deepEqual(
    (await fs.readdir(root)).filter((entry) => entry.endsWith('.tmp')),
    []
  );
});
