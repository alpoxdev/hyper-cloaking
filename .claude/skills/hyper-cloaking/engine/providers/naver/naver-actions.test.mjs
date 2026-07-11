import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateProviderSchema } from '../schema.mjs';
import { NetworkReadError } from '../network.mjs';
import { naverSelectors } from './selectors.mjs';
import { analyzePosts } from './actions/analyze.mjs';
import {
  normalizeBlogCommentRef,
  normalizeBlogPostRef,
  normalizeBlogRef,
  normalizeCafeCommentRef,
  normalizeCafePostRef,
  normalizeCafeRef,
  normalizeDraftRef
} from './actions/ids.mjs';
import {
  getBlogList,
  getBlogPost,
  getCafeList,
  getCafePost,
  searchBlog,
  searchCafe,
  searchWeb
} from './actions/reads.mjs';
import {
  blockedNaverAction,
  commentBlogPost,
  createBlogDraft,
  createCafePost,
  setBlogPostLiked,
  setCafePostLiked
} from './actions/writes.mjs';
import { naverProvider } from './metadata.mjs';
import { naverReadPromotions } from './network.mjs';

function safeTarget() {
  return { disposition: 'ok', reason: 'public-https', risks: [] };
}

function toggleSession(stateDir, { active = false, clickError = null, onSelector = naverSelectors.blog.unlike } = {}) {
  let current = active;
  const locator = (selector) => ({
    async count() { return selector === onSelector ? (current ? 1 : 0) : 1; },
    first() { return this; }
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

function memberCafeSession(stateDir, opts = {}) {
  const base = toggleSession(stateDir, { ...opts, onSelector: naverSelectors.cafe.unlike });
  const membership = opts.member !== false;
  const writePermission = opts.writePermission !== false;
  const innerLocator = base.page.locator;
  base.page.locator = (selector) => {
    if (selector === naverSelectors.cafe.membershipBadge) return { async count() { return membership ? 1 : 0; } };
    if (selector === naverSelectors.cafe.writePermission) return { async count() { return writePermission ? 1 : 0; } };
    return innerLocator(selector);
  };
  return base;
}

test('Naver metadata keeps nid.naver.com auth-only and narrows action origins to search/blog/cafe', () => {
  assert.equal(validateProviderSchema(naverProvider).ok, true);
  assert.deepEqual(naverProvider.domains.allowedOrigins, [
    'https://www.naver.com',
    'https://search.naver.com',
    'https://blog.naver.com',
    'https://cafe.naver.com'
  ]);
  assert.equal(naverProvider.domains.allowedOrigins.includes('https://nid.naver.com'), false);
  assert.deepEqual(naverProvider.domains.disallowedOrigins, ['https://nid.naver.com']);
  assert.ok(naverProvider.domains.aliases.includes('nid.naver.com'));
  assert.equal(Object.hasOwn(naverProvider, 'actions'), false);
});

test('Naver refs canonicalize owned identities and reject off-origin, nid, or incoherent refs', () => {
  assert.deepEqual(normalizeBlogPostRef('https://blog.naver.com/fixture/123'), {
    blogId: 'fixture',
    logNo: '123',
    url: 'https://blog.naver.com/fixture/123'
  });
  assert.equal(normalizeBlogPostRef('https://nid.naver.com/fixture/123'), null);
  assert.equal(normalizeBlogPostRef('https://evil.example/fixture/123'), null);
  assert.equal(normalizeBlogPostRef({ blogId: 'fixture', logNo: '1', url: 'https://blog.naver.com/fixture/2' }), null);
  assert.deepEqual(normalizeCafePostRef('https://cafe.naver.com/fixture/456'), {
    cafeId: 'fixture',
    articleId: '456',
    url: 'https://cafe.naver.com/fixture/456'
  });
  assert.equal(normalizeCafePostRef('https://cafe.naver.com/fixture/not-a-number'), null);
  assert.deepEqual(normalizeBlogRef('fixture'), { blogId: 'fixture', url: 'https://blog.naver.com/fixture' });
  assert.deepEqual(normalizeCafeRef('fixture'), { cafeId: 'fixture', url: 'https://cafe.naver.com/fixture' });
  assert.deepEqual(normalizeBlogCommentRef({ blogId: 'fixture', logNo: '123', commentId: 'c-1' }), {
    blogId: 'fixture',
    logNo: '123',
    url: 'https://blog.naver.com/fixture/123',
    commentId: 'c-1'
  });
  assert.equal(normalizeCafeCommentRef({ cafeId: 'fixture', articleId: '1' }), null);
  assert.deepEqual(normalizeDraftRef('draft-1'), { draftId: 'draft-1' });
  assert.equal(normalizeDraftRef('bad id'), null);
});

test('Naver forced reads preserve bounded canonical envelopes and require explicit empty-state evidence', async () => {
  const web = await searchWeb({}, 'fixture', {
    readStrategy: 'direct',
    readHandlers: { direct: async () => ({ results: [{ url: 'https://example.com/a', title: 'A' }] }) }
  });
  assert.equal(web.content.count, 1);
  assert.equal(web.content.results[0].url, 'https://example.com/a');

  const blogSearch = await searchBlog({}, 'fixture', {
    readStrategy: 'direct',
    readHandlers: { direct: async () => ({ results: [{ url: 'https://blog.naver.com/fixture/1', title: 'Post' }] }) }
  });
  assert.equal(blogSearch.content.results[0].blogId, 'fixture');

  await assert.rejects(
    searchCafe({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ results: [{ url: 'https://evil.example/fixture/1' }] }) }
    }),
    /invalid owned-origin reference/
  );

  await assert.rejects(
    searchWeb({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ results: [] }) }
    }),
    /explicit empty-state/
  );

  const blogPost = await getBlogPost({}, { blogId: 'fixture', logNo: '1' }, {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({ present: true, title: 'Title', body: 'Body', comments: [], commentsEmptyState: true })
    }
  });
  assert.equal(blogPost.content.logNo, '1');
  assert.deepEqual(blogPost.content.comments, []);

  await assert.rejects(
    getCafePost({}, { cafeId: 'fixture', articleId: '1' }, {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ present: true, title: 'T', body: 'B', comments: [] }) }
    }),
    /explicit empty-state/
  );

  const blogList = await getBlogList({}, 'fixture', {
    readStrategy: 'direct',
    readHandlers: { direct: async () => ({ posts: [{ blogId: 'fixture', logNo: '2', title: 'X' }] }) }
  });
  assert.equal(blogList.content.posts[0].logNo, '2');

  await assert.rejects(
    getCafeList({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ posts: [{ cafeId: 'other', articleId: '3' }] }) }
    }),
    /does not belong to the requested owner/
  );
});

test('Naver promotion defaults stay frozen-false and forced dispatch never falls back', async () => {
  assert.equal(Object.isFrozen(naverReadPromotions), true);
  assert.deepEqual(naverReadPromotions.searchWeb, {
    sanitizedFixtures: false,
    offlineParity: false,
    authorizedLiveReplay: false
  });
  await assert.rejects(
    searchWeb({
      async navigateGuardedForRead() { assert.fail('DOM must not run'); }
    }, 'fixture', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => {
          throw new NetworkReadError('naver-direct-failed', 'failed', { dispatched: true });
        }
      }
    }),
    (error) => error.code === 'naver-direct-failed'
  );
});

test('Naver analysis is bounded and truthful', () => {
  const analysis = analyzePosts([
    { logNo: '1', commentCount: 2, timestamp: 0 },
    { logNo: '2', commentCount: 10, timestamp: 86_400_000 }
  ]);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.averageCommentCount, 6);
  assert.equal(analysis.topPost.logNo, '2');
  assert.equal(analysis.cadenceDays, 1);
});

test('Naver writes block before navigation unless dry-run, enable, and state gates pass', async () => {
  const noNavigation = { async navigateGuardedForWrite() { assert.fail('must not navigate'); } };
  const dry = await setBlogPostLiked(noNavigation, { blogId: 'fixture', logNo: '1' }, true);
  assert.equal(dry.blocked, true);
  assert.match(dry.reason, /dry-run/);

  const disabled = await setBlogPostLiked(noNavigation, { blogId: 'fixture', logNo: '1' }, true, { dryRun: false });
  assert.match(disabled.reason, /enableBlogLike/);

  const missingState = await setBlogPostLiked(noNavigation, { blogId: 'fixture', logNo: '1' }, true, {
    dryRun: false,
    enableBlogLike: true,
    runId: 'like'
  });
  assert.match(missingState.reason, /stateDir/);

  const missingRunId = await setBlogPostLiked({ stateDir: '/tmp/does-not-matter', ...noNavigation }, { blogId: 'fixture', logNo: '1' }, true, {
    dryRun: false,
    enableBlogLike: true
  });
  assert.match(missingRunId.reason, /runId/);
});

test('Naver desired writes reserve atomically, no-op on already-satisfied state, and block ambiguous replay', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-like-'));
  try {
    const session = toggleSession(stateDir);
    const result = await setBlogPostLiked(session, { blogId: 'fixture', logNo: '1' }, true, {
      dryRun: false,
      enableBlogLike: true,
      runId: 'like-success'
    });
    assert.equal(result.performed, true);

    const noOp = await setBlogPostLiked(session, { blogId: 'fixture', logNo: '1' }, true, {
      dryRun: false,
      enableBlogLike: true,
      runId: 'like-success'
    });
    assert.equal(noOp.alreadySatisfied, true);
    assert.equal(noOp.performed, false);

    const uncertainSession = toggleSession(stateDir, { clickError: new Error('uncertain click') });
    const uncertain = await setBlogPostLiked(uncertainSession, { blogId: 'fixture', logNo: '2' }, true, {
      dryRun: false,
      enableBlogLike: true,
      runId: 'like-ambiguous'
    });
    assert.equal(uncertain.failure.stage, 'post-dispatch-uncertainty');

    const replay = await setBlogPostLiked(uncertainSession, { blogId: 'fixture', logNo: '2' }, true, {
      dryRun: false,
      enableBlogLike: true,
      runId: 'like-ambiguous'
    });
    assert.match(replay.reason, /claim-ambiguous/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('Naver cafe writes require current membership and write permission before dispatch', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-cafe-membership-'));
  try {
    const notMember = memberCafeSession(stateDir, { member: false });
    const blockedNoMembership = await setCafePostLiked(notMember, { cafeId: 'fixture', articleId: '1' }, true, {
      dryRun: false,
      enableCafeLike: true,
      runId: 'cafe-like-1'
    });
    assert.equal(blockedNoMembership.blocked, true);
    assert.match(blockedNoMembership.reason, /membership/);

    const noWritePermission = memberCafeSession(stateDir, { member: true, writePermission: false });
    const blockedNoPermission = await setCafePostLiked(noWritePermission, { cafeId: 'fixture', articleId: '1' }, true, {
      dryRun: false,
      enableCafeLike: true,
      runId: 'cafe-like-2'
    });
    assert.equal(blockedNoPermission.blocked, true);
    assert.match(blockedNoPermission.reason, /write permission/);

    const member = memberCafeSession(stateDir, { member: true, writePermission: true });
    const performed = await setCafePostLiked(member, { cafeId: 'fixture', articleId: '1' }, true, {
      dryRun: false,
      enableCafeLike: true,
      runId: 'cafe-like-3'
    });
    assert.equal(performed.performed, true);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('Naver post/comment content schemas are closed and reject unsupported fields', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-schema-'));
  try {
    const noNavigation = { stateDir, async navigateGuardedForWrite() { assert.fail('must not navigate'); } };
    const badPost = await createBlogDraft(noNavigation, { title: 'T', body: 'B', extra: 'nope' }, {
      dryRun: false,
      enableBlogDraft: true,
      runId: 'draft-1'
    });
    assert.equal(badPost.blocked, true);
    assert.match(badPost.reason, /unsupported field/);

    const badVisibility = await createBlogDraft(noNavigation, { title: 'T', body: 'B', visibility: 'everyone' }, {
      dryRun: false,
      enableBlogDraft: true,
      runId: 'draft-2'
    });
    assert.match(badVisibility.reason, /visibility/);

    const badComment = await commentBlogPost(noNavigation, { blogId: 'fixture', logNo: '1' }, { text: 'hi', extra: 'nope' }, {
      dryRun: false,
      enableBlogComment: true,
      runId: 'comment-1'
    });
    assert.equal(badComment.blocked, true);
    assert.match(badComment.reason, /only a text field/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('Naver media schema validates count, size, extension/magic match, and symlink safety', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-media-'));
  try {
    const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-media-files-'));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 1)]);
    const fakePng = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16, 2)]);
    const jpegPath = path.join(mediaDir, 'a.jpg');
    const mismatchedPath = path.join(mediaDir, 'b.png');
    const oversizedPath = path.join(mediaDir, 'c.jpg');
    await fs.writeFile(jpegPath, jpeg);
    await fs.writeFile(mismatchedPath, fakePng);
    await fs.writeFile(oversizedPath, Buffer.alloc(21 * 1024 * 1024, 1));

    const noNavigation = { stateDir, async navigateGuardedForWrite() { assert.fail('must not navigate'); } };

    const tooMany = await createBlogDraft(noNavigation, {
      title: 'T', body: 'B', media: Array.from({ length: 11 }, () => jpegPath)
    }, { dryRun: false, enableBlogDraft: true, runId: 'media-count' });
    assert.match(tooMany.reason, /at most 10 images/);

    const mismatch = await createBlogDraft(noNavigation, {
      title: 'T', body: 'B', media: [mismatchedPath]
    }, { dryRun: false, enableBlogDraft: true, runId: 'media-mismatch' });
    assert.match(mismatch.reason, /signature do not match/);

    const oversized = await createBlogDraft(noNavigation, {
      title: 'T', body: 'B', media: [oversizedPath]
    }, { dryRun: false, enableBlogDraft: true, runId: 'media-oversized' });
    assert.match(oversized.reason, /1-20971520 bytes/);

    const symlinkPath = path.join(mediaDir, 'd.jpg');
    await fs.symlink(jpegPath, symlinkPath);
    const symlinked = await createBlogDraft(noNavigation, {
      title: 'T', body: 'B', media: [symlinkPath]
    }, { dryRun: false, enableBlogDraft: true, runId: 'media-symlink' });
    assert.match(symlinked.reason, /non-symlink/);

    const missing = await createBlogDraft(noNavigation, {
      title: 'T', body: 'B', media: [path.join(mediaDir, 'missing.jpg')]
    }, { dryRun: false, enableBlogDraft: true, runId: 'media-missing' });
    assert.equal(missing.blocked, true);

    await fs.rm(mediaDir, { recursive: true });
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('Naver structural blockers reject only the closed forbidden set', () => {
  for (const name of [
    'cafeJoin', 'cafeAdmin', 'moderation', 'mail', 'message', 'account', 'login',
    'shopping', 'payment', 'order', 'ads', 'bulkDelete', 'bulkEdit', 'restrictedBypass'
  ]) {
    const result = blockedNaverAction(name);
    assert.equal(result.blocked, true);
    assert.match(result.reason, /structurally blocked/);
  }
  assert.throws(() => blockedNaverAction('searchWeb'), /unsupported/);
});

test('Naver createCafePost requires bulk confirmation and current membership before dispatch', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-cafe-post-'));
  try {
    const notConfirmed = { stateDir, interactive: false, async navigateGuardedForWrite() { assert.fail('must not navigate'); } };
    const blockedConfirm = await createCafePost(notConfirmed, 'fixture', { title: 'T', body: 'B' }, {
      dryRun: false,
      enableCafePost: true,
      runId: 'cafe-post-1'
    });
    assert.equal(blockedConfirm.blocked, true);
    assert.match(blockedConfirm.reason, /non-interactively/);
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});
function composeWriteSession(stateDir, { itemSelector, itemId, member = true } = {}) {
  const state = { posted: false, visibility: null };
  const visibilityControl = {
    async count() {
      return 1;
    },
    first() {
      return this;
    },
    async selectOption(value) {
      state.visibility = value;
    },
    async inputValue() {
      return state.visibility;
    }
  };
  const itemControl = {
    async evaluateAll(fn) {
      return state.posted ? fn([{ getAttribute: () => itemId }]) : fn([]);
    }
  };
  const genericControl = {
    async count() {
      return 1;
    },
    first() {
      return this;
    },
    async setInputFiles() {}
  };
  return {
    state,
    stateDir,
    interactive: true,
    confirmed: true,
    targetSafety: safeTarget(),
    page: {
      locator(selector) {
        if (
          selector === naverSelectors.blog.write.visibilitySelect
          || selector === naverSelectors.cafe.write.visibilitySelect
        ) {
          return visibilityControl;
        }
        if (selector === itemSelector) return itemControl;
        if (selector === naverSelectors.cafe.membershipBadge) {
          return {
            async count() {
              return member ? 1 : 0;
            }
          };
        }
        if (selector === naverSelectors.cafe.writePermission) {
          return {
            async count() {
              return member ? 1 : 0;
            }
          };
        }
        return genericControl;
      },
      async waitForTimeout() {}
    },
    async navigateGuardedForWrite() {
      this.targetSafety = safeTarget();
    },
    async humanType() {},
    async humanClick() {
      state.posted = true;
    }
  };
}

test('Naver createBlogDraft applies the requested visibility and proves a new draft ID', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-blog-draft-'));
  try {
    const session = composeWriteSession(stateDir, {
      itemSelector: naverSelectors.blog.write.draftItem,
      itemId: 'draft-777'
    });
    const result = await createBlogDraft(session, { title: 'T', body: 'B', visibility: 'private' }, {
      dryRun: false,
      enableBlogDraft: true,
      runId: 'blog-draft-success'
    });
    assert.equal(result.performed, true);
    assert.equal(session.state.visibility, '6');
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});

test('Naver createCafePost applies the requested visibility and proves a new article ID', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naver-cafe-create-'));
  try {
    const session = composeWriteSession(stateDir, {
      itemSelector: naverSelectors.cafe.write.articleItem,
      itemId: '9001'
    });
    const result = await createCafePost(session, 'fixture', { title: 'T', body: 'B', visibility: 'private' }, {
      dryRun: false,
      enableCafePost: true,
      confirmed: true,
      runId: 'cafe-post-success'
    });
    assert.equal(result.performed, true);
    assert.equal(session.state.visibility, 'private');
  } finally {
    await fs.rm(stateDir, { recursive: true });
  }
});
