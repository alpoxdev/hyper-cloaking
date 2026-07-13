import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProviderSchema } from '../../../../../packages/mcp-engine/src/providers/schema.mjs';
import { NetworkReadError } from '../../../../../packages/mcp-engine/src/providers/network.mjs';
import { analyzeVideos } from '../../../../../packages/mcp-engine/src/providers/tiktok/actions/analyze.mjs';
import {
  normalizeCommentRef,
  normalizeThreadRef,
  normalizeUserRef,
  normalizeVideoRef
} from '../../../../../packages/mcp-engine/src/providers/tiktok/actions/ids.mjs';
import {
  getUser,
  getUserVideos,
  getVideo,
  listDMThreads,
  readDMThread,
  searchVideos
} from '../../../../../packages/mcp-engine/src/providers/tiktok/actions/reads.mjs';
import {
  blockedTikTokAction,
  createUploadDraft,
  publishDraft,
  replyToDM,
  setLiked
} from '../../../../../packages/mcp-engine/src/providers/tiktok/actions/writes.mjs';
import { tiktokProvider } from '../../../../../packages/mcp-engine/src/providers/tiktok/metadata.mjs';
import { tiktokReadPromotions } from '../../../../../packages/mcp-engine/src/providers/tiktok/network.mjs';

function safeTarget() {
  return { disposition: 'ok', reason: 'public-https', risks: [] };
}

function toggleSession(stateDir, { active = false, clickError = null } = {}) {
  let current = active;
  const locator = (selector) => ({
    async count() {
      return selector.includes('aria-pressed="true"') ? (current ? 1 : 0) : 1;
    },
    first() {
      return this;
    },
    async evaluate(callback) {
      return callback({
        getAttribute: (name) => (name === 'aria-pressed' && current ? 'true' : null)
      });
    }
  });
  return {
    stateDir,
    targetSafety: safeTarget(),
    page: {
      locator,
      async waitForTimeout() {}
    },
    async navigateGuardedForWrite() {
      this.targetSafety = safeTarget();
    },
    async humanClick() {
      if (clickError) throw clickError;
      current = !current;
    }
  };
}

test('TikTok metadata keeps short links navigation-only and registry-safe', () => {
  assert.equal(validateProviderSchema(tiktokProvider).ok, true);
  assert.deepEqual(tiktokProvider.domains.navigationOnlyAliases, [
    'vm.tiktok.com',
    'vt.tiktok.com'
  ]);
  assert.deepEqual(tiktokProvider.domains.allowedOrigins, [
    'https://www.tiktok.com',
    'https://m.tiktok.com'
  ]);
  assert.equal(Object.hasOwn(tiktokProvider, 'actions'), false);
});

test('TikTok refs canonicalize owned identities and reject cold, off-origin, or incoherent refs', () => {
  assert.deepEqual(normalizeUserRef('@fixture'), {
    handle: 'fixture',
    url: 'https://www.tiktok.com/@fixture'
  });
  assert.deepEqual(normalizeVideoRef('https://m.tiktok.com/@fixture/video/123'), {
    handle: 'fixture',
    videoId: '123',
    url: 'https://www.tiktok.com/@fixture/video/123'
  });
  assert.equal(normalizeVideoRef('https://evil.example/@fixture/video/123'), null);
  assert.equal(
    normalizeVideoRef({
      handle: 'fixture',
      videoId: '1',
      url: 'https://www.tiktok.com/@fixture/video/2'
    }),
    null
  );
  assert.deepEqual(
    normalizeCommentRef({ handle: 'fixture', videoId: '123', commentId: 'comment-1' }),
    {
      handle: 'fixture',
      videoId: '123',
      url: 'https://www.tiktok.com/@fixture/video/123',
      commentId: 'comment-1'
    }
  );
  assert.equal(
    normalizeThreadRef(
      { threadId: '1', accountId: 'acct', url: 'https://www.tiktok.com/messages/2' },
      { accountId: 'acct' }
    ),
    null
  );
  assert.equal(normalizeThreadRef('fixture'), null);
});

test('TikTok forced reads preserve bounded canonical envelopes and DM repeats', async () => {
  const user = await getUser({}, '@fixture', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ displayName: 'Fixture', followerCount: '1.2K', present: true })
    }
  });
  assert.equal(user.content.followerCount, 1200);

  const videos = await getUserVideos({}, '@fixture', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ videos: [{ handle: 'fixture', videoId: '123', description: 'One' }] })
    }
  });
  assert.equal(videos.content.videos[0].url, 'https://www.tiktok.com/@fixture/video/123');

  const search = await searchVideos({}, 'fixture', {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ videos: [{ handle: 'fixture', videoId: '456' }] })
    }
  });
  assert.equal(search.content.count, 1);

  const video = await getVideo(
    {},
    { handle: 'fixture', videoId: '789' },
    {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          present: true,
          description: 'Video',
          comments: [],
          commentsEmptyState: true
        })
      }
    }
  );
  assert.equal(video.content.videoId, '789');
  assert.deepEqual(video.content.comments, []);

  const threads = await listDMThreads(
    { accountId: 'acct' },
    {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          threads: [
            {
              accountId: 'acct',
              threadId: 'thread-1',
              url: 'https://www.tiktok.com/messages/thread-1'
            }
          ]
        })
      }
    }
  );
  assert.equal(threads.content.threads[0].threadId, 'thread-1');

  const messages = await readDMThread({ accountId: 'acct' }, threads.content.threads[0], {
    limit: 3,
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({
        messages: [
          { messageId: '1', direction: 'in', text: 'same' },
          { messageId: '2', direction: 'in', text: 'same' },
          { messageId: '3', direction: 'out', text: 'latest' }
        ]
      })
    }
  });
  assert.deepEqual(
    messages.content.messages.map((message) => message.text),
    ['same', 'same', 'latest']
  );

  await assert.rejects(
    searchVideos({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ videos: [] }) }
    }),
    /explicit empty-state/
  );
});

test('TikTok promotion defaults stay frozen-false and forced dispatch never falls back', async () => {
  assert.equal(Object.isFrozen(tiktokReadPromotions), true);
  assert.deepEqual(tiktokReadPromotions.getUser, {
    sanitizedFixtures: false,
    offlineParity: false,
    authorizedLiveReplay: false
  });
  await assert.rejects(
    searchVideos(
      {
        async navigateGuardedForRead() {
          assert.fail('DOM must not run');
        }
      },
      'fixture',
      {
        readStrategy: 'direct',
        readHandlers: {
          direct: async () => {
            throw new NetworkReadError('tiktok-direct-failed', 'failed', { dispatched: true });
          }
        }
      }
    ),
    (error) => error.code === 'tiktok-direct-failed'
  );
});

test('TikTok analysis is bounded and truthful', () => {
  const analysis = analyzeVideos([
    {
      videoId: '1',
      viewCount: 100,
      likeCount: 10,
      commentCount: 2,
      hashtags: ['Build'],
      timestamp: 0
    },
    {
      videoId: '2',
      viewCount: 300,
      likeCount: 30,
      commentCount: 4,
      hashtags: ['Build', 'Test'],
      timestamp: 86_400_000
    }
  ]);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.averageViews, 200);
  assert.equal(analysis.topVideo.videoId, '2');
  assert.equal(analysis.cadenceDays, 1);
  assert.deepEqual(analysis.hashtags[0], { tag: 'build', count: 2 });
});

test('TikTok desired writes are dry-run default, require exact enable/state, and reserve atomically', async () => {
  const noNavigation = {
    async navigateGuardedForWrite() {
      assert.fail('must not navigate');
    }
  };
  const dry = await setLiked(noNavigation, { handle: 'fixture', videoId: '123' }, true);
  assert.equal(dry.blocked, true);
  assert.match(dry.reason, /dry-run/);

  const disabled = await setLiked(noNavigation, { handle: 'fixture', videoId: '123' }, true, {
    dryRun: false
  });
  assert.match(disabled.reason, /enableLike/);

  const missingState = await setLiked(noNavigation, { handle: 'fixture', videoId: '123' }, true, {
    dryRun: false,
    enableLike: true,
    runId: 'like'
  });
  assert.match(missingState.reason, /stateDir/);

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tiktok-like-'));
  try {
    const session = toggleSession(stateDir);
    const result = await setLiked(session, { handle: 'fixture', videoId: '123' }, true, {
      dryRun: false,
      enableLike: true,
      runId: 'like-success'
    });
    assert.equal(result.performed, true);

    const noOp = await setLiked(session, { handle: 'fixture', videoId: '123' }, true, {
      dryRun: false,
      enableLike: true,
      runId: 'like-success'
    });
    assert.equal(noOp.alreadySatisfied, true);

    const uncertainSession = toggleSession(stateDir, { clickError: new Error('uncertain click') });
    const uncertain = await setLiked(
      uncertainSession,
      { handle: 'fixture', videoId: '456' },
      true,
      {
        dryRun: false,
        enableLike: true,
        runId: 'like-ambiguous'
      }
    );
    assert.equal(uncertain.failure.stage, 'post-dispatch-uncertainty');
    const replay = await setLiked(uncertainSession, { handle: 'fixture', videoId: '456' }, true, {
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
    async count() {
      return 1;
    },
    first() {
      return this;
    }
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
      locator() {
        return control;
      },
      async waitForTimeout() {}
    },
    async navigateGuardedForWrite() {
      this.targetSafety = safeTarget();
    },
    async humanType() {},
    async humanClick() {}
  };
}

test('TikTok DM replies require inbound state and a new exact outbound message ID', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tiktok-dm-'));
  const thread = {
    accountId: 'acct',
    threadId: 'thread-1',
    url: 'https://www.tiktok.com/messages/thread-1'
  };
  try {
    const noInbound = await replyToDM(
      dmWriteSession(stateDir, [[{ messageId: '1', direction: 'out', text: 'old' }]]),
      thread,
      'reply',
      {
        dryRun: false,
        enableDMReply: true,
        runId: 'dm-no-inbound'
      }
    );
    assert.equal(noInbound.blocked, true);
    assert.match(noInbound.reason, /no inbound/);

    const sent = await replyToDM(
      dmWriteSession(stateDir, [
        [{ messageId: '1', direction: 'in', text: 'hello' }],
        [
          { messageId: '1', direction: 'in', text: 'hello' },
          { messageId: '2', direction: 'out', text: 'reply' }
        ]
      ]),
      thread,
      'reply',
      {
        dryRun: false,
        enableDMReply: true,
        runId: 'dm-success'
      }
    );
    assert.equal(sent.performed, true);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('TikTok DM, upload, publish, and forbidden actions fail closed before unsafe dispatch', async () => {
  const noNavigation = {
    accountId: 'acct',
    async navigateGuardedForWrite() {
      assert.fail('must not navigate');
    }
  };
  const cold = await replyToDM(noNavigation, 'fixture', 'hello', {
    dryRun: false,
    enableDMReply: true,
    runId: 'dm'
  });
  assert.equal(cold.blocked, true);
  assert.match(cold.reason, /thread/);

  const dryUpload = await createUploadDraft(noNavigation, '/does/not/exist.mp4');
  assert.equal(dryUpload.blocked, true);
  assert.match(dryUpload.reason, /dry-run/);

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tiktok-upload-'));
  try {
    const badFile = path.join(stateDir, 'bad.mp4');
    await fs.writeFile(badFile, 'not a video');
    let navigated = false;
    const upload = await createUploadDraft(
      {
        stateDir,
        async navigateGuardedForWrite() {
          navigated = true;
        }
      },
      badFile,
      {
        dryRun: false,
        enableUploadDraft: true,
        runId: 'upload'
      }
    );
    assert.equal(upload.blocked, true);
    assert.match(upload.reason, /signature/);
    assert.equal(navigated, false);

    const validBytes = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
    const targetFile = path.join(stateDir, 'target.mp4');
    const symlinkFile = path.join(stateDir, 'link.mp4');
    await fs.writeFile(targetFile, validBytes);
    await fs.symlink(targetFile, symlinkFile);
    const symlinkUpload = await createUploadDraft(
      {
        stateDir,
        async navigateGuardedForWrite() {
          navigated = true;
        }
      },
      symlinkFile,
      {
        dryRun: false,
        enableUploadDraft: true,
        runId: 'upload-symlink'
      }
    );
    assert.equal(symlinkUpload.blocked, true);
    assert.match(symlinkUpload.reason, /non-symlink/);
    assert.equal(navigated, false);

    const publish = await publishDraft(
      {
        stateDir,
        interactive: false,
        async navigateGuardedForWrite() {
          navigated = true;
        }
      },
      { draftId: 'draft-1' },
      {
        dryRun: false,
        enablePublish: true,
        runId: 'publish'
      }
    );
    assert.equal(publish.blocked, true);
    assert.match(publish.reason, /non-interactively/);
    assert.equal(navigated, false);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }

  assert.equal(blockedTikTokAction('coldDM').blocked, true);
  assert.throws(() => blockedTikTokAction('getUser'), /unsupported/);
});
