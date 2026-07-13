import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInstagramSession,
  OffOriginError
} from '../../../../../packages/mcp-engine/src/providers/instagram/session.mjs';
import {
  listDMThreads,
  normalizeThreadRef,
  isValidThreadRef,
  assertExistingThreadRef,
  readDMThread,
  replyToDM,
  replyToMany
} from '../../../../../packages/mcp-engine/src/providers/instagram/actions/dm.mjs';
import {
  commentPost,
  likePost,
  normalizePostRef,
  savePost,
  sharePost
} from '../../../../../packages/mcp-engine/src/providers/instagram/actions/reactions.mjs';
import {
  getUser,
  normalizeUsername,
  profileUrl,
  InvalidUsernameError
} from '../../../../../packages/mcp-engine/src/providers/instagram/actions/user.mjs';
import { getUserPosts } from '../../../../../packages/mcp-engine/src/providers/instagram/actions/posts.mjs';
import { NetworkReadError } from '../../../../../packages/mcp-engine/src/providers/network.mjs';
import { providers } from '../../../../../packages/mcp-engine/src/providers/index.mjs';
import { validateProviderSchema } from '../../../../../packages/mcp-engine/src/providers/schema.mjs';

function mockPage(url) {
  return { url: () => url };
}

// --- threadRef invariant: existing-thread handles only, no cold outreach ---

test('normalizeThreadRef accepts /direct/t/<id> url and handle object', () => {
  assert.deepEqual(normalizeThreadRef('https://www.instagram.com/direct/t/123/'), {
    threadId: '123',
    url: 'https://www.instagram.com/direct/t/123/'
  });
  assert.equal(normalizeThreadRef({ threadId: '999' }).threadId, '999');
  assert.equal(isValidThreadRef('https://www.instagram.com/direct/t/42'), true);
});

test('threadRef rejects usernames and /direct/new/ (no cold outreach)', () => {
  assert.equal(normalizeThreadRef('someuser'), null);
  assert.equal(normalizeThreadRef('@someuser'), null);
  assert.equal(normalizeThreadRef('https://www.instagram.com/direct/new/'), null);
  assert.equal(normalizeThreadRef('https://www.instagram.com/someuser/'), null);
  assert.throws(
    () => assertExistingThreadRef('someuser'),
    (e) => e.code === 'invalid-thread-ref'
  );
});

test('threadRef rejects mismatched, off-origin, and decorated opaque handles', () => {
  assert.equal(
    normalizeThreadRef({ threadId: '1', url: 'https://www.instagram.com/direct/t/2/' }),
    null
  );
  assert.equal(
    normalizeThreadRef({ threadId: '1', url: 'https://evil.example/direct/t/1/' }),
    null
  );
  assert.equal(normalizeThreadRef('https://www.instagram.com/direct/t/1/?next=2'), null);
  assert.deepEqual(normalizeThreadRef('https://instagram.com/direct/t/1'), {
    threadId: '1',
    url: 'https://www.instagram.com/direct/t/1/'
  });
});

test('threadRef enforces a bounded numeric identity', () => {
  assert.equal(normalizeThreadRef({ threadId: '1'.repeat(64) })?.threadId.length, 64);
  assert.equal(normalizeThreadRef({ threadId: '1'.repeat(65) }), null);
});

// --- session origin guard ---

test('session.requireInstagramOrigin rejects off-origin urls', () => {
  const onSession = buildInstagramSession(mockPage('https://www.instagram.com/foo/'));
  assert.equal(onSession.requireInstagramOrigin(), 'https://www.instagram.com/foo/');

  const offSession = buildInstagramSession(mockPage('https://evil.example.com/instagram.com'));
  assert.throws(() => offSession.requireInstagramOrigin(), OffOriginError);
});

// --- write gating: no navigation happens when a gate blocks ---

test('replyToDM is dry-run by default and blocks before navigation', async () => {
  // page has no goto; if the code navigated this would throw. It must not.
  const session = buildInstagramSession(mockPage('https://www.instagram.com/direct/t/5/'), {
    interactive: true
  });
  const r = await replyToDM(session, { threadId: '5' }, 'hi');
  assert.equal(r.blocked, true);
  assert.equal(r.performed, false);
  assert.match(r.reason, /dry-run/);
});

test('replyToDM rejects an invalid (cold-outreach) thread ref', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), {
    interactive: true
  });
  const r = await replyToDM(session, 'someuser', 'hi', { dryRun: false });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /existing threads/);
});

test('replyToMany bulk confirmation cannot be satisfied non-interactively', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), {
    interactive: false
  });
  const items = [
    { threadRef: { threadId: '1' }, message: 'a' },
    { threadRef: { threadId: '2' }, message: 'b' }
  ];
  const r = await replyToMany(session, items, { dryRun: false });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /non-interactively/);
});

test('replyToMany rejects a batch containing a cold-outreach ref', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), {
    interactive: true
  });
  const items = [
    { threadRef: { threadId: '1' }, message: 'a' },
    { threadRef: 'someuser', message: 'b' }
  ];
  const r = await replyToMany(session, items, { dryRun: false, confirmed: true });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /invalid thread ref/);
});

test('replyToMany rejects duplicate targets and live runs without durable state', async () => {
  const session = { interactive: true };
  const duplicate = await replyToMany(
    session,
    [
      { threadRef: { threadId: '1' }, message: 'first' },
      { threadRef: { threadId: '1' }, message: 'second' }
    ],
    { dryRun: false, confirmed: true, runId: 'duplicate-test' }
  );
  assert.equal(duplicate.blocked, true);
  assert.match(duplicate.reason, /duplicate thread ref/);

  const noState = await replyToMany(session, [{ threadRef: { threadId: '1' }, message: 'first' }], {
    dryRun: false,
    confirmed: true,
    runId: 'state-test'
  });
  assert.equal(noState.blocked, true);
  assert.match(noState.reason, /stateDir/);
});

test('replyToMany enforces the bulk cap', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), {
    interactive: true
  });
  const items = Array.from({ length: 5 }, (_, i) => ({
    threadRef: { threadId: String(i) },
    message: 'x'
  }));
  const r = await replyToMany(session, items, { dryRun: false, confirmed: true, cap: 3 });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /exceeds cap/);
});

// --- input normalizers ---

test('normalizeUsername and profileUrl validate handles', () => {
  assert.equal(normalizeUsername('@Some.User_1'), 'Some.User_1');
  assert.equal(normalizeUsername('bad user!'), null);
  assert.equal(profileUrl('nasa'), 'https://www.instagram.com/nasa/');
  assert.throws(() => profileUrl('bad user!'), InvalidUsernameError);
});

test('normalizePostRef accepts /p/ and /reel/ only', () => {
  assert.ok(normalizePostRef('https://www.instagram.com/p/ABC123/'));
  assert.ok(normalizePostRef('https://www.instagram.com/reel/XYZ/'));
  assert.equal(normalizePostRef('https://www.instagram.com/nasa/'), null);
});

test('normalizePostRef rejects trailing paths and canonicalizes query or fragment', () => {
  assert.equal(normalizePostRef('https://www.instagram.com/p/ABC123/comments/'), null);
  assert.equal(normalizePostRef('https://evil.example/p/ABC123/'), null);
  assert.equal(
    normalizePostRef('https://instagram.com/p/ABC123/?utm_source=test#fragment'),
    'https://www.instagram.com/p/ABC123/'
  );
});

// --- boundary regression: action modules never leak into the registry ---

test('every registry provider passes metadata schema (no selectors/automation leaked in)', () => {
  for (const provider of providers) {
    const result = validateProviderSchema(provider);
    assert.equal(result.ok, true, `${provider?.id}: ${JSON.stringify(result.errors)}`);
  }
});

test('instagram registry entry exposes no action/selector fields', () => {
  const ig = providers.find((p) => p.id === 'instagram');
  assert.ok(ig);
  for (const forbidden of ['actions', 'selectors', 'session', 'automationRecipe']) {
    assert.equal(
      Object.hasOwn(ig, forbidden),
      false,
      `provider metadata must not carry "${forbidden}"`
    );
  }
});

test('Instagram reads stay DOM-default until promotion evidence is complete', async () => {
  let navigations = 0;
  let directCalls = 0;
  const session = {
    async navigateGuardedForRead() {
      navigations += 1;
    },
    page: {
      async evaluate() {
        return {
          displayName: 'Example',
          stats: ['1 post'],
          verified: true,
          private: false,
          present: true
        };
      }
    }
  };
  const result = await getUser(session, 'example', {
    readHandlers: {
      direct: async () => {
        directCalls += 1;
        return { displayName: 'Wrong', rawStats: [], verified: false, private: false };
      }
    }
  });
  assert.equal(navigations, 1);
  assert.equal(directCalls, 0);
  assert.equal(result.content.displayName, 'Example');
});

test('forced Instagram network reads preserve the complete envelope and never fallback after failure', async () => {
  const session = {
    async navigateGuardedForRead() {
      throw new Error('DOM must not run');
    }
  };
  const profile = await getUser(session, 'example', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({
        displayName: 'Example',
        rawStats: ['1 post'],
        verified: true,
        private: false
      })
    }
  });
  assert.deepEqual(profile, {
    trusted: false,
    instructionAuthority: 'none',
    source: { url: 'https://www.instagram.com/example/', kind: 'instagram-profile' },
    content: {
      username: 'example',
      url: 'https://www.instagram.com/example/',
      displayName: 'Example',
      verified: true,
      private: false,
      rawStats: ['1 post']
    }
  });

  await assert.rejects(
    getUser(session, 'example', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => {
          throw new NetworkReadError('instagram-direct-failed', 'failed', { dispatched: true });
        }
      }
    }),
    (error) => error.code === 'instagram-direct-failed'
  );
});

test('forced Instagram post and DM reads preserve envelopes and reject malformed empties', async () => {
  const posts = await getUserPosts({}, 'example', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({
        posts: [{ url: 'https://www.instagram.com/p/ABC_123/', hashtags: ['one'] }]
      })
    }
  });
  assert.deepEqual(posts.content, {
    username: 'example',
    count: 1,
    posts: [
      {
        url: 'https://www.instagram.com/p/ABC_123/',
        type: 'post',
        shortcode: 'ABC_123',
        likeCount: null,
        commentCount: null,
        timestamp: null,
        hashtags: ['one']
      }
    ]
  });

  const threads = await listDMThreads(
    {},
    {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          threads: [{ threadId: '7', url: 'https://www.instagram.com/direct/t/7/' }]
        })
      }
    }
  );
  assert.deepEqual(threads.content, [
    {
      threadId: '7',
      url: 'https://www.instagram.com/direct/t/7/'
    }
  ]);

  await assert.rejects(
    getUserPosts({}, 'example', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ posts: [] }) }
    }),
    /explicit empty-state/
  );
  await assert.rejects(
    listDMThreads(
      {},
      {
        readStrategy: 'direct',
        readHandlers: { direct: async () => ({ threads: [] }) }
      }
    ),
    /explicit empty-state/
  );
  await assert.rejects(
    readDMThread(
      {},
      { threadId: '7' },
      {
        readStrategy: 'direct',
        readHandlers: { direct: async () => ({ messages: [] }) }
      }
    ),
    /explicit empty-state/
  );
});

test('Instagram read normalizers reject over-limit scalar content', async () => {
  await assert.rejects(
    getUser({}, 'example', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          displayName: 'x'.repeat(301),
          rawStats: [],
          verified: false,
          private: false
        })
      }
    }),
    /displayName exceeds 300/
  );
  await assert.rejects(
    getUserPosts({}, 'example', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          posts: [
            {
              url: `https://www.instagram.com/p/${'a'.repeat(65)}/`,
              hashtags: []
            }
          ]
        })
      }
    }),
    /canonical owned-origin/
  );
  await assert.rejects(
    getUserPosts({}, 'example', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          posts: [
            {
              url: 'https://www.instagram.com/p/ABC123/',
              hashtags: ['x'.repeat(101)]
            }
          ]
        })
      }
    }),
    /hashtag exceeds 100/
  );
});

test('Instagram strict navigation and explicit post empty states fail closed', async () => {
  await assert.rejects(
    getUser(
      {
        async navigateGuardedForRead() {
          throw new Error('strict navigation failed');
        }
      },
      'example'
    ),
    /strict navigation failed/
  );

  const empty = await getUserPosts(
    {
      async navigateGuardedForRead() {},
      page: {
        async $$eval() {
          return [];
        },
        locator() {
          return { count: async () => 1 };
        }
      },
      async humanScroll() {
        throw new Error('must not scroll after explicit empty state');
      }
    },
    'example'
  );
  assert.equal(empty.content.count, 0);

  await assert.rejects(
    getUserPosts(
      {
        async navigateGuardedForRead() {},
        page: {
          async $$eval() {
            return [];
          },
          locator() {
            return { count: async () => 0 };
          }
        },
        async humanScroll() {}
      },
      'example'
    ),
    /could not be proven/
  );
});

test('Instagram DM normalization preserves latest order and repeated equal-text messages', async () => {
  const read = await readDMThread(
    {},
    { threadId: '42' },
    {
      limit: 3,
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          threadId: '42',
          messages: [
            { direction: 'in', text: 'older' },
            { direction: 'in', text: 'same' },
            { direction: 'in', text: 'same' },
            { direction: 'out', text: 'latest' }
          ]
        })
      }
    }
  );
  assert.deepEqual(read.content.messages, [
    { direction: 'in', text: 'same' },
    { direction: 'in', text: 'same' },
    { direction: 'out', text: 'latest' }
  ]);

  const threads = await listDMThreads(
    {},
    {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          threads: [{ threadId: '2' }, { threadId: '1' }, { threadId: '2' }]
        })
      }
    }
  );
  assert.deepEqual(
    threads.content.map((thread) => thread.threadId),
    ['2', '1']
  );
});

function dmWriteSession(messageSnapshots) {
  const snapshots = [...messageSnapshots];
  let writeNavigations = 0;
  let clicks = 0;
  return {
    get writeNavigations() {
      return writeNavigations;
    },
    get clicks() {
      return clicks;
    },
    async navigateGuardedForWrite() {
      writeNavigations += 1;
    },
    async humanType() {},
    async humanClick() {
      clicks += 1;
    },
    page: {
      async $$eval() {
        const snapshot = snapshots.shift();
        if (!snapshot) throw new Error('unexpected DM extraction');
        return snapshot;
      },
      locator() {
        return { count: async () => 0 };
      }
    }
  };
}

test('DM writes use one write navigation and require a newly appended exact outbound row', async () => {
  const stale = dmWriteSession([
    [{ outgoing: false, text: 'hello', messageId: '1' }],
    [
      { outgoing: false, text: 'hello', messageId: '1' },
      { outgoing: true, text: 'same', messageId: '2' }
    ],
    [
      { outgoing: false, text: 'hello', messageId: '1' },
      { outgoing: true, text: 'same', messageId: '2' }
    ]
  ]);
  const staleResult = await replyToDM(stale, { threadId: '5' }, 'same', { dryRun: false });
  assert.equal(staleResult.performed, false);
  assert.equal(stale.writeNavigations, 1);
  assert.equal(stale.clicks, 1);

  const appended = dmWriteSession([
    [{ outgoing: false, text: 'hello', messageId: '1' }],
    [
      { outgoing: false, text: 'hello', messageId: '1' },
      { outgoing: true, text: 'same', messageId: '2' }
    ],
    [
      { outgoing: false, text: 'hello', messageId: '1' },
      { outgoing: true, text: 'same', messageId: '2' },
      { outgoing: true, text: 'same', messageId: '3' }
    ]
  ]);
  const appendedResult = await replyToDM(appended, { threadId: '5' }, 'same', { dryRun: false });
  assert.equal(appendedResult.performed, true);
  assert.equal(appended.writeNavigations, 1);
});

test('DM verification rejects history growth with an unchanged equal-text tail', async () => {
  const hydrated = dmWriteSession([
    [{ outgoing: false, text: 'inbound', messageId: null }],
    [{ outgoing: true, text: 'same', messageId: null }],
    [
      { outgoing: false, text: 'hydrated history', messageId: null },
      { outgoing: true, text: 'same', messageId: null }
    ]
  ]);
  const result = await replyToDM(hydrated, { threadId: '5' }, 'same', { dryRun: false });
  assert.equal(result.performed, false);
});

test('Instagram reaction writes preserve exact state-transition and verifier failures', async () => {
  let clicks = 0;
  const alreadyLiked = await likePost(
    {
      async navigateGuardedForWrite() {},
      async humanClick() {
        clicks += 1;
      },
      page: {
        async $() {
          return {};
        }
      }
    },
    'https://www.instagram.com/p/ABC123/',
    { dryRun: false }
  );
  assert.equal(alreadyLiked.alreadySatisfied, true);
  assert.equal(alreadyLiked.performed, false);
  assert.equal(clicks, 0);

  await assert.rejects(
    sharePost(
      {
        async navigateGuardedForWrite() {},
        async humanClick() {},
        page: {
          locator() {
            return { count: async () => 0 };
          },
          async waitForFunction() {
            throw new Error('verification extraction failed');
          }
        }
      },
      'https://www.instagram.com/p/ABC123/',
      { dryRun: false }
    ),
    /verification extraction failed/
  );

  const matchCount = 1;
  await assert.rejects(
    commentPost(
      {
        async navigateGuardedForWrite() {},
        async humanType() {},
        async humanClick() {},
        page: {
          async $$eval() {
            return matchCount;
          },
          async waitForFunction() {
            throw new Error('comment verification timeout');
          }
        }
      },
      'https://www.instagram.com/p/ABC123/',
      'same',
      { dryRun: false }
    ),
    /comment verification timeout/
  );

  let savedState = false;
  const saved = await savePost(
    {
      async navigateGuardedForWrite() {},
      async humanClick() {
        savedState = true;
      },
      page: {
        async $() {
          return savedState ? {} : null;
        },
        async waitForSelector() {}
      }
    },
    'https://www.instagram.com/p/ABC123/',
    { dryRun: false }
  );
  assert.equal(saved.performed, true);
});
