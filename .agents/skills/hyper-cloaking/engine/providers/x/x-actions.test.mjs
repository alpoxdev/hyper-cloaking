import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProviderSchema } from '../schema.mjs';
import { NetworkReadError } from '../network.mjs';
import { analyzePosts } from './actions/analyze.mjs';
import {
  normalizePostRef,
  normalizeThreadRef,
  normalizeUserRef
} from './actions/ids.mjs';
import {
  getPost,
  getThread,
  getUser,
  getUserPosts,
  listDMThreads,
  readDMThread,
  searchPosts
} from './actions/reads.mjs';
import {
  blockedXAction,
  createPost,
  quotePost,
  replyToDM,
  replyToPost,
  setLiked
} from './actions/writes.mjs';
import { xProvider } from './metadata.mjs';
import { xReadPromotions } from './network.mjs';

function safeTarget() {
  return { disposition: 'ok', reason: 'public-https', risks: [] };
}

function toggleSession(stateDir, { active = false, clickError = null } = {}) {
  let current = active;
  const locator = (selector) => ({
    async count() { return selector.includes('unlike') || selector.includes('following') ? (current ? 1 : 0) : 1; },
    first() { return this; },
    async evaluate(callback) {
      return callback({ getAttribute: (name) => name === 'aria-pressed' && current ? 'true' : null });
    }
  });
  return {
    stateDir,
    targetSafety: safeTarget(),
    page: {
      locator,
      async waitForTimeout() {}
    },
    async navigateGuardedForWrite() { this.targetSafety = safeTarget(); },
    async humanClick() {
      if (clickError) throw clickError;
      current = !current;
    }
  };
}

test('X metadata includes the bare x.com origin alongside existing hosts and stays registry-safe', () => {
  assert.equal(validateProviderSchema(xProvider).ok, true);
  assert.deepEqual(xProvider.domains.navigationOnlyAliases, ['t.co']);
  assert.deepEqual(xProvider.domains.allowedOrigins, [
    'https://x.com',
    'https://www.x.com',
    'https://twitter.com',
    'https://www.twitter.com',
    'https://mobile.twitter.com'
  ]);
  assert.deepEqual(xProvider.domains.aliases, ['www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
  assert.equal(xProvider.domains.primary, 'x.com');
  assert.equal(Object.hasOwn(xProvider, 'actions'), false);
});

test('X refs canonicalize owned identities and reject cold, off-origin, or incoherent refs', () => {
  assert.deepEqual(normalizeUserRef('@fixture'), {
    handle: 'fixture',
    url: 'https://x.com/fixture'
  });
  assert.deepEqual(normalizePostRef('https://twitter.com/fixture/status/123'), {
    handle: 'fixture',
    postId: '123',
    url: 'https://x.com/fixture/status/123'
  });
  assert.equal(normalizePostRef('https://evil.example/fixture/status/123'), null);
  assert.equal(normalizePostRef({ handle: 'fixture', postId: '1', url: 'https://x.com/fixture/status/2' }), null);
  assert.equal(normalizeThreadRef({ threadId: '1', accountId: 'acct', url: 'https://x.com/messages/2' }, { accountId: 'acct' }), null);
  assert.equal(normalizeThreadRef('fixture'), null);
});

test('X forced reads preserve bounded canonical envelopes, one target per read, and DM order/repeats', async () => {
  const user = await getUser({}, '@fixture', {
    readStrategy: 'direct',
    readHandlers: { direct: async () => ({ displayName: 'Fixture', followerCount: '1.2K', present: true }) }
  });
  assert.equal(user.content.followerCount, 1200);

  const posts = await getUserPosts({}, '@fixture', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ posts: [{ handle: 'fixture', postId: '123', text: 'One' }] })
    }
  });
  assert.equal(posts.content.posts[0].url, 'https://x.com/fixture/status/123');
  assert.equal(posts.content.count, 1);

  const search = await searchPosts({}, 'fixture', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ posts: [{ handle: 'fixture', postId: '456' }] })
    }
  });
  assert.equal(search.content.count, 1);

  const post = await getPost({}, { handle: 'fixture', postId: '789' }, {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({
        present: true,
        text: 'Post',
        replies: [],
        repliesEmptyState: true
      })
    }
  });
  assert.equal(post.content.postId, '789');
  assert.deepEqual(post.content.replies, []);

  const thread = await getThread({}, { handle: 'fixture', postId: '789' }, {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ posts: [{ handle: 'fixture', postId: '790' }, { handle: 'fixture', postId: '791' }] })
    }
  });
  assert.equal(thread.content.count, 2);

  const threads = await listDMThreads({ accountId: 'acct' }, {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ threads: [{ accountId: 'acct', threadId: 'thread-1', url: 'https://x.com/messages/thread-1' }] })
    }
  });
  assert.equal(threads.content.threads[0].threadId, 'thread-1');

  const messages = await readDMThread({ accountId: 'acct' }, threads.content.threads[0], {
    limit: 3,
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ messages: [
        { messageId: '1', direction: 'in', text: 'same' },
        { messageId: '2', direction: 'in', text: 'same' },
        { messageId: '3', direction: 'out', text: 'latest' }
      ] })
    }
  });
  // Order preserved and exact repeats not deduped.
  assert.deepEqual(messages.content.messages.map((message) => message.text), ['same', 'same', 'latest']);

  await assert.rejects(
    searchPosts({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ posts: [] }) }
    }),
    /explicit empty-state/
  );

  await assert.rejects(getUserPosts({}, 'wrong-host', {}), /Invalid X user reference/);
});

test('X promotion defaults stay frozen-false and forced dispatch never falls back', async () => {
  assert.equal(Object.isFrozen(xReadPromotions), true);
  assert.deepEqual(xReadPromotions.getUser, {
    sanitizedFixtures: false,
    offlineParity: false,
    authorizedLiveReplay: false
  });
  await assert.rejects(
    searchPosts({
      async navigateGuardedForRead() { assert.fail('DOM must not run'); }
    }, 'fixture', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => {
          throw new NetworkReadError('x-direct-failed', 'failed', { dispatched: true });
        }
      }
    }),
    (error) => error.code === 'x-direct-failed'
  );
});

test('X analysis is bounded and truthful', () => {
  const analysis = analyzePosts([
    { postId: '1', likeCount: 10, repostCount: 1, replyCount: 2, bookmarkCount: 0, timestamp: 0 },
    { postId: '2', likeCount: 30, repostCount: 3, replyCount: 4, bookmarkCount: 1, timestamp: 86_400_000 }
  ]);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.averageLikes, 20);
  assert.equal(analysis.topPost.postId, '2');
  assert.equal(analysis.cadenceDays, 1);
});

test('X desired writes are dry-run default, require exact enable/state, reserve atomically, and replay ambiguous claims', async () => {
  const noNavigation = { async navigateGuardedForWrite() { assert.fail('must not navigate'); } };
  const dry = await setLiked(noNavigation, { handle: 'fixture', postId: '123' }, true);
  assert.equal(dry.blocked, true);
  assert.match(dry.reason, /dry-run/);

  const disabled = await setLiked(noNavigation, { handle: 'fixture', postId: '123' }, true, { dryRun: false });
  assert.match(disabled.reason, /enableLike/);

  const missingState = await setLiked(noNavigation, { handle: 'fixture', postId: '123' }, true, {
    dryRun: false,
    enableLike: true,
    runId: 'like'
  });
  assert.match(missingState.reason, /stateDir/);

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-like-'));
  try {
    const session = toggleSession(stateDir);
    const result = await setLiked(session, { handle: 'fixture', postId: '123' }, true, {
      dryRun: false,
      enableLike: true,
      runId: 'like-success'
    });
    assert.equal(result.performed, true);

    const noOp = await setLiked(session, { handle: 'fixture', postId: '123' }, true, {
      dryRun: false,
      enableLike: true,
      runId: 'like-success'
    });
    assert.equal(noOp.alreadySatisfied, true);

    const uncertainSession = toggleSession(stateDir, { clickError: new Error('uncertain click') });
    const uncertain = await setLiked(uncertainSession, { handle: 'fixture', postId: '456' }, true, {
      dryRun: false,
      enableLike: true,
      runId: 'like-ambiguous'
    });
    assert.equal(uncertain.failure.stage, 'post-dispatch-uncertainty');
    const replay = await setLiked(uncertainSession, { handle: 'fixture', postId: '456' }, true, {
      dryRun: false,
      enableLike: true,
      runId: 'like-ambiguous'
    });
    assert.match(replay.reason, /claim-ambiguous/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

function dmWriteSession(stateDir, snapshots) {
  const rows = [...snapshots];
  const control = {
    async count() { return 1; },
    first() { return this; }
  };
  return {
    stateDir,
    accountId: 'acct',
    targetSafety: safeTarget(),
    page: {
      async $$eval() {
        const value = rows.shift();
        if (!value) throw new Error('unexpected message extraction');
        return value;
      },
      locator() { return control; },
      async waitForTimeout() {}
    },
    async navigateGuardedForWrite() { this.targetSafety = safeTarget(); },
    async humanType() {},
    async humanClick() {}
  };
}

test('X DM replies require inbound state and a new exact outbound message ID', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-dm-'));
  const thread = {
    accountId: 'acct',
    threadId: 'thread-1',
    url: 'https://x.com/messages/thread-1'
  };
  try {
    const noInbound = await replyToDM(dmWriteSession(stateDir, [[
      { messageId: '1', direction: 'out', text: 'old' }
    ]]), thread, 'reply', {
      dryRun: false,
      enableDMReply: true,
      runId: 'dm-no-inbound'
    });
    assert.equal(noInbound.blocked, true);
    assert.match(noInbound.reason, /no inbound/);

    const sent = await replyToDM(dmWriteSession(stateDir, [
      [{ messageId: '1', direction: 'in', text: 'hello' }],
      [
        { messageId: '1', direction: 'in', text: 'hello' },
        { messageId: '2', direction: 'out', text: 'reply' }
      ]
    ]), thread, 'reply', {
      dryRun: false,
      enableDMReply: true,
      runId: 'dm-success'
    });
    assert.equal(sent.performed, true);

    const cold = await replyToDM({ accountId: 'acct', async navigateGuardedForWrite() { assert.fail('must not navigate'); } }, 'fixture', 'hello', {
      dryRun: false,
      enableDMReply: true,
      runId: 'dm'
    });
    assert.equal(cold.blocked, true);
    assert.match(cold.reason, /thread/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

function composeSession(stateDir, { postId = '999' } = {}) {
  let posted = false;
  const toastControl = {
    async evaluateAll(fn) {
      return posted ? fn([{ getAttribute: () => postId }]) : fn([]);
    }
  };
  const fieldControl = {
    async count() {
      return 1;
    },
    first() {
      return this;
    },
    async setInputFiles() {}
  };
  return {
    stateDir,
    targetSafety: safeTarget(),
    page: {
      locator(selector) {
        if (selector.includes('toast')) return toastControl;
        return fieldControl;
      },
      async waitForTimeout() {}
    },
    async navigateGuardedForWrite() {
      this.targetSafety = safeTarget();
    },
    async humanType() {},
    async humanClick() {
      posted = true;
    }
  };
}

test('X post text is NFKC-bounded to 280 characters and creation proves a new immutable post ID', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-post-'));
  try {
    const overLong = await createPost(composeSession(stateDir), 'x'.repeat(281), {
      dryRun: false,
      enablePost: true,
      runId: 'post-too-long'
    });
    assert.equal(overLong.blocked, true);
    assert.match(overLong.reason, /1-280/);

    const badAudience = await createPost(composeSession(stateDir), 'hello', {
      dryRun: false,
      enablePost: true,
      runId: 'post-bad-audience',
      replyAudience: 'nobody'
    });
    assert.equal(badAudience.blocked, true);
    assert.match(badAudience.reason, /reply audience/);

    const session = composeSession(stateDir, { postId: '999' });
    const created = await createPost(session, 'hello world', {
      dryRun: false,
      enablePost: true,
      runId: 'post-success'
    });
    assert.equal(created.performed, true);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('X media schema enforces closed modes, size limits, and pre-dispatch TOCTOU re-checks', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-media-'));
  try {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 1)]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16, 3)]);
    const mp4 = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);

    const image1 = path.join(stateDir, 'a.jpg');
    const image2 = path.join(stateDir, 'b.png');
    const gifFile = path.join(stateDir, 'c.gif');
    const videoFile = path.join(stateDir, 'd.mp4');
    const badSignature = path.join(stateDir, 'bad.jpg');
    await fs.writeFile(image1, jpeg);
    await fs.writeFile(image2, png);
    await fs.writeFile(gifFile, gif);
    await fs.writeFile(videoFile, mp4);
    await fs.writeFile(badSignature, 'not an image');

    // Mixed modes (image + gif) are rejected.
    const mixed = await createPost(composeSession(stateDir), 'mixed', {
      dryRun: false,
      enablePost: true,
      runId: 'media-mixed',
      media: [image1, gifFile]
    });
    assert.equal(mixed.blocked, true);
    assert.match(mixed.reason, /mixed media/);

    // Extension/signature mismatch is rejected.
    const badMagic = await createPost(composeSession(stateDir), 'bad', {
      dryRun: false,
      enablePost: true,
      runId: 'media-bad-signature',
      media: [badSignature]
    });
    assert.equal(badMagic.blocked, true);
    assert.match(badMagic.reason, /signature/);

    // Remote URLs are rejected structurally.
    const remote = await createPost(composeSession(stateDir), 'remote', {
      dryRun: false,
      enablePost: true,
      runId: 'media-remote',
      media: ['https://example.com/x.jpg']
    });
    assert.equal(remote.blocked, true);
    assert.match(remote.reason, /remote URLs/);

    // Symlinked media is rejected.
    const symlinkPath = path.join(stateDir, 'link.jpg');
    await fs.symlink(image1, symlinkPath);
    const symlinked = await createPost(composeSession(stateDir), 'symlink', {
      dryRun: false,
      enablePost: true,
      runId: 'media-symlink',
      media: [symlinkPath]
    });
    assert.equal(symlinked.blocked, true);
    assert.match(symlinked.reason, /non-symlink/);

    // Valid 1-4 image mode succeeds.
    const imagesOk = await createPost(composeSession(stateDir, { postId: '1000' }), 'images', {
      dryRun: false,
      enablePost: true,
      runId: 'media-images-ok',
      media: [image1, image2]
    });
    assert.equal(imagesOk.performed, true);

    // TOCTOU happy path: an unmodified file still passes the pre-dispatch
    // re-check and dispatches successfully.
    const toctouPath = path.join(stateDir, 'toctou.jpg');
    await fs.writeFile(toctouPath, jpeg);
    const happy = await createPost(composeSession(stateDir, { postId: '1001' }), 'toctou-ok', {
      dryRun: false,
      enablePost: true,
      runId: 'media-toctou-ok',
      media: [toctouPath]
    });
    assert.equal(happy.performed, true);

    // TOCTOU negative path: mutate the file's content between the initial
    // validation open and the pre-dispatch re-check open so the re-check's
    // content hash no longer matches. The write must NOT succeed.
    const toctouBadPath = path.join(stateDir, 'toctou-bad.jpg');
    await fs.writeFile(toctouBadPath, jpeg);
    const originalOpen = fs.open;
    const originalWriteFile = fs.writeFile;
    let opens = 0;
    fs.open = async (...args) => {
      if (String(args[0]) === toctouBadPath) {
        opens += 1;
        if (opens === 2) {
          // Rewrite to a same-length but different-content valid JPEG so the
          // descriptor size check passes and revalidateMedia's content-hash
          // comparison is what rejects the tampered file.
          await originalWriteFile(
            toctouBadPath,
            Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 9)])
          );
        }
      }
      return originalOpen(...args);
    };
    try {
      const tampered = await createPost(composeSession(stateDir, { postId: '1002' }), 'toctou-bad', {
        dryRun: false,
        enablePost: true,
        runId: 'media-toctou-bad',
        media: [toctouBadPath]
      });
      assert.equal(tampered.performed, false);
      assert.match(JSON.stringify(tampered.failure), /changed identity/);
    } finally {
      fs.open = originalOpen;
    }

    // GIF mode succeeds standalone.
    const gifOk = await createPost(composeSession(stateDir, { postId: '1002' }), 'gif', {
      dryRun: false,
      enablePost: true,
      runId: 'media-gif-ok',
      media: [gifFile]
    });
    assert.equal(gifOk.performed, true);

    // Video mode succeeds standalone.
    const videoOk = await createPost(composeSession(stateDir, { postId: '1003' }), 'video', {
      dryRun: false,
      enablePost: true,
      runId: 'media-video-ok',
      media: [videoFile]
    });
    assert.equal(videoOk.performed, true);

    // Too many images.
    const tooMany = await createPost(composeSession(stateDir), 'too many', {
      dryRun: false,
      enablePost: true,
      runId: 'media-too-many',
      media: [image1, image2, image1, image2, image1]
    });
    assert.equal(tooMany.blocked, true);
    assert.match(tooMany.reason, /at most 4/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('X replyToPost and quotePost dispatch once against a single explicit target and prove state', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-reply-'));
  try {
    let replyCount = 0;
    const replySession = {
      stateDir,
      targetSafety: safeTarget(),
      page: {
        locator() {
          return { async count() { return 1; }, first() { return this; } };
        },
        async $$eval() { return replyCount; },
        async waitForTimeout() {}
      },
      async navigateGuardedForWrite() { this.targetSafety = safeTarget(); },
      async humanType() { replyCount = 1; },
      async humanClick() {}
    };
    const reply = await replyToPost(replySession, { handle: 'fixture', postId: '1' }, 'nice post', {
      dryRun: false,
      enableReply: true,
      runId: 'reply-success'
    });
    assert.equal(reply.performed, true);

    const quoteSession = composeSession(stateDir, { postId: '2000' });
    const quote = await quotePost(quoteSession, { handle: 'fixture', postId: '2' }, 'quoting this', {
      dryRun: false,
      enableQuote: true,
      runId: 'quote-success'
    });
    assert.equal(quote.performed, true);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('X structural blockers reject only the closed forbidden set', () => {
  assert.equal(blockedXAction('coldDM').blocked, true);
  assert.equal(blockedXAction('account').blocked, true);
  assert.equal(blockedXAction('security').blocked, true);
  assert.equal(blockedXAction('ads').blocked, true);
  assert.equal(blockedXAction('moderation').blocked, true);
  assert.equal(blockedXAction('delete').blocked, true);
  assert.equal(blockedXAction('followerScraping').blocked, true);
  assert.equal(blockedXAction('protectedBypass').blocked, true);
  assert.equal(blockedXAction('bulk').blocked, true);
  assert.throws(() => blockedXAction('getUser'), /unsupported/);
  assert.throws(() => blockedXAction('setLiked'), /unsupported/);
});
