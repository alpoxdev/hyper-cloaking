import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CredentialStoreError,
  createOfficialCredentialAdapter,
  credentialPaths,
  importCredentialProfile,
  initCredentialStore,
  inspectCredentialProfile,
  listCredentialProfiles,
  markCredentialProfileState,
  parseCredentialJson,
  profileFromEnvironment,
  profileFromSecureSource,
  reconcileCredentialOperation,
  recoverCredentialProfile,
  removeCredentialProfile,
  resolveCredentialProfile,
  recordVerifiedCredentialScopes,
  resolveOfficialCredentialAdapter,
  setDefaultCredentialProfile,
  validateCredentialStore,
  withCredentialProfileOperation
} from '../../../mcp/engine/credentials.mjs';

const evidenceHash = 'e'.repeat(64);

async function tempHome() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hc-credentials-'));
}

function youtubeProfile(overrides = {}) {
  return {
    provider: 'youtube',
    kind: 'oauth2',
    credentials: { accessToken: 'secret-access-token' },
    declaredScopes: ['videos.read', 'videos.write'],
    verifiedScopes: [],
    expiresAt: Date.now() + 60_000,
    ...overrides
  };
}

async function setupProfile(home, overrides) {
  await initCredentialStore({ home });
  await importCredentialProfile({ home, profileId: 'yt-main', profile: youtubeProfile(overrides) });
  await recordVerifiedCredentialScopes({
    home,
    profileId: 'yt-main',
    scopes: ['videos.read'],
    source: 'remote-introspection',
    evidenceHash,
    verifiedAt: 100
  });
  await setDefaultCredentialProfile({ home, provider: 'youtube', profileId: 'yt-main' });
}

function mode(stat) {
  return stat.mode & 0o777;
}
async function createLock(home, host) {
  await setupProfile(home);
  const paths = credentialPaths(home);
  const hash = crypto.createHash('sha256').update('yt-main').digest('hex');
  const lock = path.join(paths.refreshLocks, `${hash}.lock`);
  await fs.mkdir(lock, { mode: 0o700 });
  await fs.writeFile(
    path.join(lock, 'owner.json'),
    JSON.stringify({
      version: 1,
      pid: 999999,
      host,
      nonce: 'owner-nonce',
      phase: 'reserved',
      createdAt: 1,
      updatedAt: 1
    }),
    { mode: 0o600 }
  );
  return lock;
}

function failStoreRelease(paths) {
  return new Proxy(fs, {
    get(target, property) {
      if (property !== 'rename') return target[property];
      return async (from, to) => {
        if (String(from) === paths.lock && String(to).includes('.release-')) {
          const error = new Error('store lock release failed');
          error.code = 'EIO';
          throw error;
        }
        return fs.rename(from, to);
      };
    }
  });
}

test('strict credential JSON rejects duplicate, dangerous, oversized and deeply nested input', () => {
  assert.throws(() => parseCredentialJson('{"a":1,"a":2}'), /duplicate key/);
  for (const key of ['__proto__', 'constructor', 'toString', 'apply']) {
    assert.throws(() => parseCredentialJson(`{"${key}":1}`), /safe identifier/);
  }
  assert.throws(
    () => parseCredentialJson(`{"x":"${'a'.repeat(128 * 1024 + 1)}"}`),
    /string exceeds policy/
  );
  assert.throws(() => parseCredentialJson(`${'['.repeat(34)}0${']'.repeat(34)}`), /maximum depth/);
  assert.deepEqual(
    parseCredentialJson('{"safe":[1,true,null]}'),
    Object.assign(Object.create(null), { safe: [1, true, null] })
  );
});

test('store validation enforces closed kinds, required secrets and default integrity', () => {
  assert.throws(
    () =>
      validateCredentialStore({
        version: 1,
        revision: 0,
        defaults: {},
        profiles: { p: { provider: 'youtube', kind: 'unknown', credentials: {} } }
      }),
    /unsupported provider profile kind/
  );
  assert.throws(
    () =>
      validateCredentialStore({
        version: 1,
        revision: 0,
        defaults: {},
        profiles: { p: youtubeProfile({ credentials: {} }) }
      }),
    /accessToken is required/
  );
  assert.throws(
    () =>
      validateCredentialStore({
        version: 1,
        revision: 0,
        defaults: { youtube: 'missing' },
        profiles: {}
      }),
    /default profile does not exist/
  );
});

test('initialization creates owner-only directories, store, and committed journal', async () => {
  const home = await tempHome();
  const receipt = await initCredentialStore({ home });
  const paths = credentialPaths(home);
  assert.equal(mode(await fs.stat(paths.root)), 0o700);
  assert.equal(mode(await fs.stat(paths.store)), 0o600);
  assert.equal(mode(await fs.stat(paths.journals)), 0o700);
  const journal = parseCredentialJson(
    await fs.readFile(path.join(paths.journals, `${receipt.operationId}.json`), 'utf8')
  );
  assert.equal(journal.state, 'committed');
  assert.equal(journal.beforeRevision, 0);
  assert.equal(journal.afterRevision, 1);
});

test('profile APIs redact secrets and preserve defaults through import/remove', async () => {
  const home = await tempHome();
  await setupProfile(home);
  const inspected = await inspectCredentialProfile({ home, profileId: 'yt-main' });
  assert.equal(inspected.credentials, '[redacted]');
  assert.deepEqual(inspected.credentialFields, ['accessToken']);
  assert.equal(JSON.stringify(inspected).includes('secret-access-token'), false);
  assert.equal((await listCredentialProfiles({ home, provider: 'youtube' })).length, 1);
  await removeCredentialProfile({ home, profileId: 'yt-main' });
  assert.equal(await inspectCredentialProfile({ home, profileId: 'yt-main' }), null);
  assert.deepEqual(await resolveCredentialProfile({ home, provider: 'youtube' }), {
    status: 'absent',
    profile: null
  });
});

test('resolution uses explicit then default, rejects client conflict, expiry and declared-only scopes', async () => {
  const home = await tempHome();
  await setupProfile(home, { expiresAt: 10_000 });
  const selected = await resolveCredentialProfile({
    home,
    provider: 'youtube',
    requiredScopes: ['videos.read'],
    now: 500
  });
  assert.equal(selected.profileId, 'yt-main');
  assert.equal(selected.profile.credentials.accessToken, 'secret-access-token');
  await assert.rejects(
    resolveCredentialProfile({ home, provider: 'youtube', profileId: 'yt-main', client: {} }),
    (error) => error.code === 'profile-client-conflict'
  );
  await assert.rejects(
    resolveCredentialProfile({
      home,
      provider: 'youtube',
      requiredScopes: ['videos.write'],
      now: 500
    }),
    (error) => error.code === 'profile-under-scoped'
  );
  await assert.rejects(
    resolveCredentialProfile({ home, provider: 'youtube', now: 10_001 }),
    (error) => error.code === 'profile-expired'
  );
});

test('environment import uses a prefix and never returns argv-shaped diagnostics', () => {
  const profile = profileFromEnvironment({
    provider: 'coupang',
    kind: 'hmac',
    prefix: 'SHOP',
    env: { SHOP_ACCESS_KEY: 'access', SHOP_SECRET_KEY: 'secret' }
  });
  assert.deepEqual(
    profile.credentials,
    Object.assign(Object.create(null), { accessKey: 'access', secretKey: 'secret' })
  );
  assert.equal(JSON.stringify(profile).includes('SHOP_'), false);
  assert.throws(
    () =>
      profileFromEnvironment({
        provider: 'coupang',
        kind: 'hmac',
        prefix: 'SHOP',
        env: { SHOP_ACCESS_KEY: 'access' }
      }),
    /SHOP_SECRET_KEY/
  );
});
test('secure source and official adapter factories keep credentials in memory only', async () => {
  const home = await tempHome();
  const source = path.join(home, 'profile.json');
  await fs.writeFile(source, JSON.stringify(youtubeProfile()), { mode: 0o600 });
  assert.equal(
    (await profileFromSecureSource({ file: source })).credentials.accessToken,
    'secret-access-token'
  );
  await fs.chmod(source, 0o644);
  await assert.rejects(
    profileFromSecureSource({ file: source }),
    (error) => error.code === 'unsafe-permissions'
  );

  const bearer = createOfficialCredentialAdapter({
    profileId: 'yt-main',
    profile: youtubeProfile()
  });
  assert.equal(
    bearer.authorize({ url: 'https://www.googleapis.com/youtube/v3/search' }).headers.authorization,
    'Bearer secret-access-token'
  );
  const apiKey = createOfficialCredentialAdapter({
    profileId: 'yt-key',
    profile: youtubeProfile({ kind: 'api-key', credentials: { apiKey: 'private-api-key' } })
  });
  assert.equal(
    new URL(
      apiKey.authorize({ url: 'https://www.googleapis.com/youtube/v3/search' }).url
    ).searchParams.get('key'),
    'private-api-key'
  );
  const coupang = createOfficialCredentialAdapter({
    profileId: 'shop',
    profile: {
      provider: 'coupang',
      kind: 'hmac',
      credentials: { accessKey: 'access', secretKey: 'secret' }
    }
  });
  assert.match(
    coupang.authorize({
      method: 'GET',
      url: 'https://api-gateway.coupang.com/v2/test?a=1',
      timestamp: 100
    }).headers.authorization,
    /^CEA algorithm=HmacSHA256/
  );
  const oauth1 = createOfficialCredentialAdapter({
    profileId: 'x-oauth1',
    profile: {
      provider: 'x',
      kind: 'oauth1',
      credentials: {
        consumerKey: 'consumer',
        consumerSecret: 'consumer-secret',
        accessToken: 'token',
        accessTokenSecret: 'token-secret'
      }
    }
  });
  assert.match(
    oauth1.authorize({ url: 'https://api.x.com/2/users/me', timestamp: 100, nonce: 'fixed' })
      .headers.authorization,
    /^OAuth /
  );

  await setupProfile(home);
  assert.equal(
    (await resolveOfficialCredentialAdapter({ home, provider: 'youtube', now: 500 })).adapter
      .provider,
    'youtube'
  );
});

test('store refuses symlink and hardlink credential files', async () => {
  const symlinkHome = await tempHome();
  const symlinkPaths = credentialPaths(symlinkHome);
  await fs.mkdir(symlinkPaths.root, { recursive: true, mode: 0o700 });
  const external = path.join(symlinkHome, 'external.json');
  await fs.writeFile(external, '{"version":1}', { mode: 0o600 });
  await fs.symlink(external, symlinkPaths.store);
  await assert.rejects(
    listCredentialProfiles({ home: symlinkHome }),
    (error) => error.code === 'unsafe-file'
  );

  const hardlinkHome = await tempHome();
  await initCredentialStore({ home: hardlinkHome });
  const hardlinkPaths = credentialPaths(hardlinkHome);
  await fs.link(hardlinkPaths.store, path.join(hardlinkHome, 'second-link.json'));
  await assert.rejects(
    listCredentialProfiles({ home: hardlinkHome }),
    (error) => error.code === 'unsafe-file'
  );
});

test('concurrent imports serialize without losing profiles', async () => {
  const home = await tempHome();
  await initCredentialStore({ home });
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      importCredentialProfile({
        home,
        profileId: `yt-${index}`,
        profile: youtubeProfile({ credentials: { accessToken: `secret-${index}` } })
      })
    )
  );
  const profiles = await listCredentialProfiles({ home });
  assert.equal(profiles.length, 8);
  assert.deepEqual(
    profiles.map((profile) => profile.id).toSorted(),
    Array.from({ length: 8 }, (_, index) => `yt-${index}`)
  );
});

function fsWithStoreRename({ afterRename = false } = {}) {
  let fired = false;
  return new Proxy(fs, {
    get(target, property) {
      if (property !== 'rename') return target[property];
      return async (from, to) => {
        if (!fired && String(to).endsWith('providers.json')) {
          fired = true;
          if (afterRename) await fs.rename(from, to);
          const error = new Error(afterRename ? 'rename acknowledgement lost' : 'rename blocked');
          error.code = 'EIO';
          throw error;
        }
        return fs.rename(from, to);
      };
    }
  });
}

test('operation journals classify pre-rename failure and reconcile by digest', async () => {
  const home = await tempHome();
  await assert.rejects(
    initCredentialStore({ home, fsImpl: fsWithStoreRename() }),
    (error) =>
      error instanceof CredentialStoreError &&
      error.code === 'operation-not-committed' &&
      Boolean(error.operationId)
  );
  const journals = await fs.readdir(credentialPaths(home).journals);
  assert.equal(journals.length, 1);
  const operationId = journals[0].replace(/\.json$/, '');
  const receipt = await reconcileCredentialOperation({ home, operationId });
  assert.equal(receipt.state, 'not-committed');
});

test('lost rename acknowledgement resolves committed without rewriting', async () => {
  const home = await tempHome();
  const result = await initCredentialStore({
    home,
    fsImpl: fsWithStoreRename({ afterRename: true })
  });
  assert.equal(result.revision, 1);
  const journal = parseCredentialJson(
    await fs.readFile(
      path.join(credentialPaths(home).journals, `${result.operationId}.json`),
      'utf8'
    )
  );
  assert.equal(journal.state, 'committed');
});

test('rename acknowledgement plus root fsync failure remains ambiguous and never reports committed', async () => {
  const home = await tempHome();
  const paths = credentialPaths(home);
  let storeRenamed = false;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'rename') {
        return async (from, to) => {
          if (!storeRenamed && String(to) === paths.store) {
            storeRenamed = true;
            await fs.rename(from, to);
            const error = new Error('rename acknowledgement lost');
            error.code = 'EIO';
            throw error;
          }
          return fs.rename(from, to);
        };
      }
      if (property === 'open') {
        return async (...arguments_) => {
          const handle = await fs.open(...arguments_);
          if (storeRenamed && String(arguments_[0]) === paths.root) {
            return new Proxy(handle, {
              get(handleTarget, handleProperty) {
                if (handleProperty === 'sync') {
                  return async () => {
                    const error = new Error('directory fsync failed');
                    error.code = 'EIO';
                    throw error;
                  };
                }
                return handleTarget[handleProperty];
              }
            });
          }
          return handle;
        };
      }
      return target[property];
    }
  });
  await assert.rejects(
    initCredentialStore({ home, fsImpl: failingFs }),
    (error) => error.code === 'operation-ambiguous'
  );
  const journals = await fs.readdir(paths.journals);
  const journal = parseCredentialJson(
    await fs.readFile(path.join(paths.journals, journals[0]), 'utf8')
  );
  assert.equal(journal.state, 'ambiguous');
});

test('lock release failures preserve successful results and primary mutation errors', async () => {
  const successHome = await tempHome();
  const successPaths = credentialPaths(successHome);
  await assert.rejects(
    initCredentialStore({ home: successHome, fsImpl: failStoreRelease(successPaths) }),
    (error) =>
      error.code === 'lock-release-uncertain' &&
      error.result?.afterRevision === 1 &&
      Boolean(error.result?.operationId)
  );
  await fs.rm(successPaths.lock, { recursive: true, force: true });

  const failureHome = await tempHome();
  await initCredentialStore({ home: failureHome });
  const failurePaths = credentialPaths(failureHome);
  await assert.rejects(
    removeCredentialProfile({
      home: failureHome,
      profileId: 'missing',
      fsImpl: failStoreRelease(failurePaths)
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((item) => item?.code === 'profile-not-found') &&
      error.errors.some((item) => item?.code === 'EIO')
  );
  await fs.rm(failurePaths.lock, { recursive: true, force: true });
});

test('mutation failures retain primary evidence when observation or journal bookkeeping also fails', async () => {
  const bookkeepingHome = await tempHome();
  const bookkeepingPaths = credentialPaths(bookkeepingHome);
  let journalRenames = 0;
  const bookkeepingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'rename') return target[property];
      return async (from, to) => {
        if (String(to) === bookkeepingPaths.store) {
          const error = new Error('primary rename failure');
          error.code = 'EPRIMARY';
          throw error;
        }
        if (
          path.dirname(String(to)) === bookkeepingPaths.journals &&
          String(to).endsWith('.json')
        ) {
          journalRenames += 1;
          if (journalRenames > 1) {
            const error = new Error('journal bookkeeping failure');
            error.code = 'EBOOK';
            throw error;
          }
        }
        return fs.rename(from, to);
      };
    }
  });
  await assert.rejects(
    initCredentialStore({ home: bookkeepingHome, fsImpl: bookkeepingFs }),
    (error) =>
      error.code === 'operation-not-committed' &&
      error.cause instanceof AggregateError &&
      error.cause.errors.some((item) => item?.code === 'EPRIMARY') &&
      error.cause.errors.some((item) => item?.code === 'EBOOK')
  );

  const observationHome = await tempHome();
  const observationPaths = credentialPaths(observationHome);
  let renameFailed = false;
  const observationFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'rename') {
        return async (from, to) => {
          if (String(to) === observationPaths.store) {
            renameFailed = true;
            const error = new Error('primary rename failure');
            error.code = 'EPRIMARY';
            throw error;
          }
          return fs.rename(from, to);
        };
      }
      if (property === 'readFile') {
        return async (file, ...arguments_) => {
          if (renameFailed && String(file) === observationPaths.store) {
            const error = new Error('store observation failure');
            error.code = 'EOBS';
            throw error;
          }
          return fs.readFile(file, ...arguments_);
        };
      }
      return target[property];
    }
  });
  await assert.rejects(
    initCredentialStore({ home: observationHome, fsImpl: observationFs }),
    (error) =>
      error.code === 'operation-ambiguous' &&
      error.cause instanceof AggregateError &&
      error.cause.errors.some((item) => item?.code === 'EPRIMARY') &&
      error.cause.errors.some((item) => item?.code === 'EOBS')
  );
});

test('profile markers block dispatch and enforce the recovery matrix', async () => {
  const home = await tempHome();
  await setupProfile(home);
  await markCredentialProfileState({
    home,
    profileId: 'yt-main',
    state: 'refresh-ambiguous',
    evidenceHash
  });
  await assert.rejects(
    resolveCredentialProfile({ home, provider: 'youtube' }),
    (error) => error.code === 'profile-refresh-ambiguous'
  );
  await assert.rejects(
    recoverCredentialProfile({
      home,
      profileId: 'yt-main',
      mode: 'refresh',
      correctedProfile: youtubeProfile()
    }),
    (error) => error.code === 'profile-recovery-mode'
  );
  const recovered = await recoverCredentialProfile({
    home,
    profileId: 'yt-main',
    mode: 'reimport',
    correctedProfile: youtubeProfile({ verifiedScopes: ['videos.read', 'videos.write'] })
  });
  assert.equal(recovered.recoveredFrom, 'refresh-ambiguous');
  await assert.rejects(
    resolveCredentialProfile({
      home,
      provider: 'youtube',
      requiredScopes: ['videos.write'],
      now: 500
    }),
    (error) => error.code === 'profile-under-scoped'
  );
  await recordVerifiedCredentialScopes({
    home,
    profileId: 'yt-main',
    scopes: ['videos.read', 'videos.write'],
    source: 'remote-introspection',
    evidenceHash,
    verifiedAt: 200
  });
  assert.equal(
    (
      await resolveCredentialProfile({
        home,
        provider: 'youtube',
        requiredScopes: ['videos.write'],
        now: 500
      })
    ).status,
    'selected'
  );
});

test('official invalid-token and insufficient-scope denials write authoritative markers before unlock', async () => {
  for (const [code, expected] of [
    ['invalid_token', 'token-invalid'],
    ['insufficient_scope', 'scope-unverified']
  ]) {
    const home = await tempHome();
    await setupProfile(home);
    const error = new Error(code);
    error.code = code;
    await assert.rejects(
      withCredentialProfileOperation(
        { home, provider: 'youtube', evidenceHash },
        async ({ setPhase }) => {
          await setPhase('official-dispatched');
          throw error;
        }
      ),
      (received) => received === error
    );
    await assert.rejects(
      resolveCredentialProfile({ home, provider: 'youtube' }),
      (received) => received.code === `profile-${expected}`
    );
  }
});

test('pre-dispatch provider-style denial codes remain attempt-local', async () => {
  for (const code of ['invalid_token', 'insufficient_scope']) {
    const home = await tempHome();
    await setupProfile(home);
    const error = new Error(code);
    error.code = code;
    await assert.rejects(
      withCredentialProfileOperation({ home, provider: 'youtube', evidenceHash }, async () => {
        throw error;
      }),
      (received) => received === error
    );
    assert.equal(
      (await resolveCredentialProfile({ home, provider: 'youtube', now: 500 })).status,
      'selected'
    );
  }
});

test('credential operations reject caller-seeded dispatched phases', async () => {
  for (const phase of ['official-dispatched', 'refresh-dispatched']) {
    const home = await tempHome();
    await setupProfile(home);
    await assert.rejects(
      withCredentialProfileOperation({ home, provider: 'youtube', phase }, async () => {
        const error = new Error('invalid token');
        error.code = 'invalid_token';
        throw error;
      }),
      /must begin in the reserved phase/
    );
    assert.equal(
      (await resolveCredentialProfile({ home, provider: 'youtube', now: 500 })).status,
      'selected'
    );
  }
});

test('post-refresh uncertainty marks profile while generic policy errors remain attempt-local', async () => {
  const refreshHome = await tempHome();
  await setupProfile(refreshHome);
  await assert.rejects(
    withCredentialProfileOperation(
      { home: refreshHome, provider: 'youtube', evidenceHash },
      async ({ setPhase }) => {
        await setPhase('refresh-dispatched');
        throw new Error('connection lost');
      }
    ),
    /connection lost/
  );
  await assert.rejects(
    resolveCredentialProfile({ home: refreshHome, provider: 'youtube' }),
    (error) => error.code === 'profile-refresh-ambiguous'
  );

  const policyHome = await tempHome();
  await setupProfile(policyHome);
  await assert.rejects(
    withCredentialProfileOperation(
      { home: policyHome, provider: 'youtube', evidenceHash },
      async ({ setPhase }) => {
        await setPhase('official-dispatched');
        const error = new Error('generic policy 403');
        error.status = 403;
        throw error;
      }
    ),
    /generic policy 403/
  );
  assert.equal(
    (await resolveCredentialProfile({ home: policyHome, provider: 'youtube', now: 500 })).status,
    'selected'
  );
});

test('same-host dead locks recover while foreign-host and EPERM locks fail closed', async () => {
  const deadHome = await tempHome();
  await createLock(deadHome, 'test-host');
  const value = await withCredentialProfileOperation(
    {
      home: deadHome,
      provider: 'youtube',
      host: 'test-host',
      processStatus: () => 'dead',
      lockTimeoutMs: 20
    },
    async () => 'recovered'
  );
  assert.equal(value, 'recovered');

  const foreignHome = await tempHome();
  await createLock(foreignHome, 'other-host');
  await assert.rejects(
    withCredentialProfileOperation(
      {
        home: foreignHome,
        provider: 'youtube',
        host: 'test-host',
        processStatus: () => 'dead',
        lockTimeoutMs: 20
      },
      async () => 'never'
    ),
    (error) => error.code === 'lock-foreign-host'
  );

  const deniedHome = await tempHome();
  await createLock(deniedHome, 'test-host');
  await assert.rejects(
    withCredentialProfileOperation(
      {
        home: deniedHome,
        provider: 'youtube',
        host: 'test-host',
        processStatus: () => 'permission-denied',
        lockTimeoutMs: 20
      },
      async () => 'never'
    ),
    (error) => error.code === 'lock-permission-denied'
  );
});

test('imports cannot self-assert scopes and external clients require remote scope evidence', async () => {
  const home = await tempHome();
  await initCredentialStore({ home });
  await importCredentialProfile({
    home,
    profileId: 'yt-main',
    profile: youtubeProfile({
      verifiedScopes: ['videos.write'],
      scopeEvidence: {
        source: 'remote-introspection',
        evidenceHash,
        verifiedAt: 100
      },
      verifiedAt: 100
    })
  });
  const imported = await inspectCredentialProfile({ home, profileId: 'yt-main' });
  assert.deepEqual(imported.verifiedScopes, []);
  await assert.rejects(
    resolveCredentialProfile({
      home,
      provider: 'youtube',
      profileId: 'yt-main',
      requiredScopes: ['videos.write']
    }),
    (error) => error.code === 'profile-under-scoped'
  );
  await assert.rejects(
    resolveCredentialProfile({
      home,
      provider: 'youtube',
      client: { verifiedScopes: ['videos.read'] },
      requiredScopes: ['videos.read']
    }),
    /scopeEvidence is required/
  );
  const client = {
    request() {},
    verifiedScopes: ['videos.read'],
    scopeEvidence: {
      source: 'provider-response',
      evidenceHash,
      verifiedAt: 100
    }
  };
  assert.equal(
    (
      await resolveCredentialProfile({
        home,
        provider: 'youtube',
        client,
        requiredScopes: ['videos.read']
      })
    ).client,
    client
  );
});

test('official adapters reject every cross-origin credential dispatch and userinfo URL', () => {
  const profiles = [
    ['instagram', 'graph-oauth', { accessToken: 'token' }],
    ['youtube', 'oauth2', { accessToken: 'token' }],
    ['coupang', 'hmac', { accessKey: 'access', secretKey: 'secret' }],
    ['tiktok', 'oauth2', { accessToken: 'token' }],
    ['naver', 'client-credentials', { clientId: 'client', clientSecret: 'secret' }],
    ['x', 'bearer', { bearerToken: 'token' }]
  ];
  for (const [provider, kind, credentials] of profiles) {
    const adapter = createOfficialCredentialAdapter({
      profileId: `${provider}-profile`,
      profile: { provider, kind, credentials }
    });
    assert.throws(
      () => adapter.authorize({ url: 'https://attacker.example/collect' }),
      (error) => error.code === 'adapter-origin-rejected',
      provider
    );
  }

  const youtube = createOfficialCredentialAdapter({
    profileId: 'youtube-userinfo',
    profile: { provider: 'youtube', kind: 'oauth2', credentials: { accessToken: 'token' } }
  });
  assert.throws(
    () => youtube.authorize({ url: 'https://user:password@www.googleapis.com/youtube/v3/search' }),
    (error) => error.code === 'adapter-origin-rejected'
  );
  assert.throws(
    () => youtube.authorize({ url: 'https://www.googleapis.com:444/youtube/v3/search' }),
    (error) => error.code === 'adapter-origin-rejected'
  );
});

test('OAuth1 signing normalizes duplicate encoded values and rejects query protocol fields', () => {
  const adapter = createOfficialCredentialAdapter({
    profileId: 'x-oauth1-vector',
    profile: {
      provider: 'x',
      kind: 'oauth1',
      credentials: {
        consumerKey: 'consumer',
        consumerSecret: 'consumer-secret',
        accessToken: 'token',
        accessTokenSecret: 'token-secret'
      }
    }
  });
  const authorization = adapter.authorize({
    method: 'GET',
    url: 'https://api.x.com/1.1/test.json?b=two&a=%21&a=space%20value',
    timestamp: 100,
    nonce: 'fixed'
  }).headers.authorization;
  assert.match(authorization, /oauth_signature="s4BzmFb8GIciYXF9FNdwbEhv%2B%2Bc%3D"/);
  assert.equal((authorization.match(/oauth_nonce=/g) || []).length, 1);
  for (const protocolQuery of ['oauth_nonce=query-value', 'oauth_signature=forged']) {
    assert.throws(
      () =>
        adapter.authorize({
          method: 'GET',
          url: `https://api.x.com/1.1/test.json?${protocolQuery}`,
          timestamp: 100,
          nonce: 'fixed'
        }),
      (error) => error.code === 'oauth-query-conflict'
    );
  }
});

test('secure source reads remain descriptor-bound across a path replacement race', async () => {
  const home = await tempHome();
  const source = path.join(home, 'profile.json');
  const moved = path.join(home, 'profile.original.json');
  const attacker = path.join(home, 'attacker.json');
  await fs.writeFile(
    source,
    JSON.stringify(youtubeProfile({ credentials: { accessToken: 'original' } })),
    { mode: 0o600 }
  );
  await fs.writeFile(
    attacker,
    JSON.stringify(youtubeProfile({ credentials: { accessToken: 'attacker' } })),
    { mode: 0o600 }
  );
  let swapped = false;
  const racingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'open') return target[property];
      return async (...arguments_) => {
        const handle = await fs.open(...arguments_);
        if (!swapped) {
          swapped = true;
          await fs.rename(source, moved);
          await fs.symlink(attacker, source);
        }
        return handle;
      };
    }
  });
  const profile = await profileFromSecureSource({ file: source, fsImpl: racingFs });
  assert.equal(profile.credentials.accessToken, 'original');
});

test('secure source descriptor reads stop at the byte cap during growth', async () => {
  let reads = 0;
  const growingFs = {
    async open() {
      return {
        async stat() {
          return {
            isFile: () => true,
            nlink: 1,
            uid: process.getuid(),
            mode: 0o100600,
            size: 1
          };
        },
        async read(buffer) {
          reads += 1;
          buffer.fill(0x61);
          return { bytesRead: buffer.length };
        },
        async close() {}
      };
    }
  };
  await assert.rejects(
    profileFromSecureSource({ file: '/virtual/growing-profile.json', fsImpl: growingFs }),
    (error) => error.code === 'source-too-large'
  );
  assert.equal(reads, 17);
});

test('profile mutations serialize behind active profile operations and revalidate under lock', async () => {
  const home = await tempHome();
  await setupProfile(home);
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let leave;
  const blocked = new Promise((resolve) => {
    leave = resolve;
  });
  const active = withCredentialProfileOperation({ home, provider: 'youtube' }, async () => {
    enter();
    await blocked;
    return 'done';
  });
  await entered;
  let removed = false;
  const removal = removeCredentialProfile({ home, profileId: 'yt-main' }).then(() => {
    removed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(removed, false);
  leave();
  assert.equal(await active, 'done');
  await removal;
  assert.equal(await inspectCredentialProfile({ home, profileId: 'yt-main' }), null);
});

test('failed denial persistence retains the profile lock and preserves both errors', async () => {
  const home = await tempHome();
  await setupProfile(home);
  const paths = credentialPaths(home);
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'rename') return target[property];
      return async (from, to) => {
        if (path.dirname(String(to)) === paths.profileState && String(to).endsWith('.json')) {
          const error = new Error('marker persistence failed');
          error.code = 'EIO';
          throw error;
        }
        return fs.rename(from, to);
      };
    }
  });
  const denial = new Error('invalid token');
  denial.code = 'invalid_token';
  await assert.rejects(
    withCredentialProfileOperation(
      { home, provider: 'youtube', fsImpl: failingFs },
      async ({ setPhase }) => {
        await setPhase('official-dispatched');
        throw denial;
      }
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.includes(denial) &&
      error.errors.some((item) => item?.code === 'EIO')
  );

  const lock = profileLockPathForTest(paths, 'yt-main');
  assert.equal((await fs.stat(lock)).isDirectory(), true);
  await assert.rejects(
    withCredentialProfileOperation(
      { home, provider: 'youtube', lockTimeoutMs: 20 },
      async () => 'unsafe'
    ),
    (error) => error.code === 'lock-busy'
  );
  await fs.rm(lock, { recursive: true, force: true });
});

test('recovery compares marker state before unlink and leaves changed evidence fail-closed', async () => {
  const home = await tempHome();
  await setupProfile(home);
  const paths = credentialPaths(home);
  await markCredentialProfileState({
    home,
    profileId: 'yt-main',
    state: 'token-invalid',
    evidenceHash
  });
  const changedHash = 'a'.repeat(64);
  let changed = false;
  const racingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'rename') return target[property];
      return async (from, to) => {
        await fs.rename(from, to);
        if (!changed && String(to) === paths.store) {
          changed = true;
          const markerFile = path.join(
            paths.profileState,
            `${crypto.createHash('sha256').update('yt-main').digest('hex')}.json`
          );
          await fs.writeFile(
            markerFile,
            JSON.stringify({
              version: 1,
              profileHash: crypto.createHash('sha256').update('yt-main').digest('hex'),
              state: 'token-invalid',
              evidenceHash: changedHash,
              updatedAt: Date.now()
            }),
            { mode: 0o600 }
          );
        }
      };
    }
  });
  await assert.rejects(
    recoverCredentialProfile({
      home,
      profileId: 'yt-main',
      mode: 'refresh',
      correctedProfile: youtubeProfile({
        verifiedScopes: ['videos.read'],
        scopeEvidence: { source: 'remote-refresh', evidenceHash, verifiedAt: 200 },
        verifiedAt: 200
      }),
      fsImpl: racingFs
    }),
    (error) => error.code === 'profile-marker-changed'
  );
  await assert.rejects(
    resolveCredentialProfile({ home, provider: 'youtube' }),
    (error) => error.code === 'profile-token-invalid'
  );
});

test('recovery detects marker replacement after quarantine comparison and before consumption', async () => {
  const home = await tempHome();
  await setupProfile(home);
  const paths = credentialPaths(home);
  await markCredentialProfileState({
    home,
    profileId: 'yt-main',
    state: 'token-invalid',
    evidenceHash
  });
  const hash = crypto.createHash('sha256').update('yt-main').digest('hex');
  const markerFile = path.join(paths.profileState, `${hash}.json`);
  let replaced = false;
  const racingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'unlink') return target[property];
      return async (file) => {
        if (!replaced && String(file).includes('.recovery-')) {
          replaced = true;
          await fs.writeFile(
            markerFile,
            JSON.stringify({
              version: 1,
              profileHash: hash,
              state: 'token-invalid',
              evidenceHash: 'b'.repeat(64),
              updatedAt: Date.now()
            }),
            { mode: 0o600 }
          );
        }
        return fs.unlink(file);
      };
    }
  });
  await assert.rejects(
    recoverCredentialProfile({
      home,
      profileId: 'yt-main',
      mode: 'refresh',
      correctedProfile: youtubeProfile({
        verifiedScopes: ['videos.read'],
        scopeEvidence: { source: 'remote-refresh', evidenceHash, verifiedAt: 300 },
        verifiedAt: 300
      }),
      fsImpl: racingFs
    }),
    (error) => error.code === 'profile-marker-changed'
  );
  await assert.rejects(
    resolveCredentialProfile({ home, provider: 'youtube' }),
    (error) => error.code === 'profile-token-invalid'
  );
});

test('recovery restores the canonical marker after pre-consumption filesystem faults', async () => {
  for (const scenario of ['rename', 'pre-fsync', 'read', 'unlink']) {
    const home = await tempHome();
    await setupProfile(home);
    const paths = credentialPaths(home);
    await markCredentialProfileState({
      home,
      profileId: 'yt-main',
      state: 'token-invalid',
      evidenceHash
    });
    const markerFile = path.join(
      paths.profileState,
      `${crypto.createHash('sha256').update('yt-main').digest('hex')}.json`
    );
    let profileStateSyncs = 0;
    let unlinkFailed = false;
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (from, to) => {
            if (
              scenario === 'rename' &&
              String(from) === markerFile &&
              String(to).includes('.recovery-')
            ) {
              const error = new Error('marker quarantine rename failed');
              error.code = 'EBOUNDARY';
              throw error;
            }
            return fs.rename(from, to);
          };
        }
        if (property === 'open') {
          return async (...arguments_) => {
            if (scenario === 'read' && String(arguments_[0]).includes('.recovery-')) {
              const error = new Error('quarantine descriptor read failed');
              error.code = 'EBOUNDARY';
              throw error;
            }
            const handle = await fs.open(...arguments_);
            if (String(arguments_[0]) === paths.profileState) {
              profileStateSyncs += 1;
              if (scenario === 'pre-fsync' && profileStateSyncs === 1) {
                return new Proxy(handle, {
                  get(handleTarget, handleProperty) {
                    if (handleProperty === 'sync') {
                      return async () => {
                        const error = new Error('quarantine directory fsync failed');
                        error.code = 'EBOUNDARY';
                        throw error;
                      };
                    }
                    return handleTarget[handleProperty];
                  }
                });
              }
            }
            return handle;
          };
        }
        if (property === 'unlink') {
          return async (file) => {
            if (scenario === 'unlink' && !unlinkFailed && String(file).includes('.recovery-')) {
              unlinkFailed = true;
              const error = new Error('quarantine unlink failed');
              error.code = 'EBOUNDARY';
              throw error;
            }
            return fs.unlink(file);
          };
        }
        return target[property];
      }
    });

    await assert.rejects(
      recoverCredentialProfile({
        home,
        profileId: 'yt-main',
        mode: 'refresh',
        correctedProfile: youtubeProfile({
          verifiedScopes: ['videos.read'],
          scopeEvidence: { source: 'remote-refresh', evidenceHash, verifiedAt: 400 },
          verifiedAt: 400
        }),
        fsImpl: failingFs
      })
    );
    await assert.rejects(
      resolveCredentialProfile({ home, provider: 'youtube' }),
      (error) => error.code === 'profile-token-invalid',
      scenario
    );
    await assert.rejects(
      fs.access(profileLockPathForTest(paths, 'yt-main')),
      (error) => error.code === 'ENOENT'
    );
  }
});

test('post-consumption recovery ambiguity recreates a marker and retains the profile lock', async () => {
  const home = await tempHome();
  await setupProfile(home);
  const paths = credentialPaths(home);
  await markCredentialProfileState({
    home,
    profileId: 'yt-main',
    state: 'token-invalid',
    evidenceHash
  });
  let profileStateSyncs = 0;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'open') return target[property];
      return async (...arguments_) => {
        const handle = await fs.open(...arguments_);
        if (String(arguments_[0]) === paths.profileState) {
          profileStateSyncs += 1;
          if (profileStateSyncs >= 2) {
            return new Proxy(handle, {
              get(handleTarget, handleProperty) {
                if (handleProperty === 'sync') {
                  return async () => {
                    const error = new Error('post-consumption directory fsync failed');
                    error.code = 'EBOUNDARY';
                    throw error;
                  };
                }
                return handleTarget[handleProperty];
              }
            });
          }
        }
        return handle;
      };
    }
  });
  await assert.rejects(
    recoverCredentialProfile({
      home,
      profileId: 'yt-main',
      mode: 'refresh',
      correctedProfile: youtubeProfile({
        verifiedScopes: ['videos.read'],
        scopeEvidence: { source: 'remote-refresh', evidenceHash, verifiedAt: 500 },
        verifiedAt: 500
      }),
      fsImpl: failingFs
    }),
    (error) => error.code === 'profile-recovery-ambiguous'
  );
  await assert.rejects(
    resolveCredentialProfile({ home, provider: 'youtube' }),
    (error) => error.code === 'profile-token-invalid'
  );
  const lock = profileLockPathForTest(paths, 'yt-main');
  assert.equal((await fs.stat(lock)).isDirectory(), true);
  await fs.rm(lock, { recursive: true, force: true });
});

function profileLockPathForTest(paths, profileId) {
  return path.join(
    paths.refreshLocks,
    `${crypto.createHash('sha256').update(profileId).digest('hex')}.lock`
  );
}
