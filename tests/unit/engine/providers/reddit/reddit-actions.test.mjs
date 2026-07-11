import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { randomUUID } from 'node:crypto';
import {
  buildRedditSession,
  OffOriginError,
  normalizeSubreddit,
  normalizeRedditUser,
  normalizePostRef,
  normalizeCommentRef,
  assertPostRef,
  assertExistingCommentRef,
  upvotePost,
  commentPost,
  replyToComment,
  savePost
} from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/reddit/index.mjs';
import { providers } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/index.mjs';
import { validateProviderSchema } from '../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/schema.mjs';
const TEST_STATE_ROOT = await mkdtemp(join(tmpdir(), 'reddit-actions-test-'));
test.after(async () => rm(TEST_STATE_ROOT, { recursive: true, force: true }));

function mockPage(url) {
  return { url: () => url };
}

const POST = 'https://www.reddit.com/r/node/comments/abc123/a_post/';
const COMMENT = 'https://www.reddit.com/r/node/comments/abc123/a_post/def456/';

// --- ref validation and no-cold-outreach invariant ---

test('Reddit validators canonicalize names, permalinks, and read handles', () => {
  assert.equal(normalizeSubreddit('r/AskReddit'), 'AskReddit');
  assert.equal(normalizeSubreddit('a'.repeat(22)), null);
  assert.equal(normalizeRedditUser('@some-user'), 'some-user');

  const post = normalizePostRef(POST);
  assert.equal(post.postId, 'abc123');
  assert.equal(post.url, 'https://www.reddit.com/r/node/comments/abc123/');
  assert.equal(normalizePostRef({ subreddit: 'node', postId: 'abc123' }).postId, 'abc123');

  const comment = normalizeCommentRef(COMMENT);
  assert.equal(comment.commentId, 'def456');
  assert.equal(
    normalizeCommentRef({ subreddit: 'node', postId: 'abc123', commentId: 'def456' }).commentId,
    'def456'
  );
});

test('Reddit validators reject profiles, malformed refs, and arbitrary usernames with exact errors', () => {
  assert.equal(normalizePostRef('https://www.reddit.com/u/someuser/'), null);
  assert.equal(normalizeCommentRef('someuser'), null);
  assert.equal(normalizeCommentRef(POST), null);
  assert.throws(
    () => assertPostRef('someuser'),
    (error) => error.code === 'invalid-post-ref'
  );
  assert.throws(
    () => assertExistingCommentRef('someuser'),
    (error) => error.code === 'invalid-comment-ref' && /existing/.test(error.message)
  );
});

// --- shared session origin boundary ---

test('session.requireOnOrigin rejects off-origin urls', () => {
  const onSession = buildRedditSession(mockPage(POST));
  assert.equal(onSession.requireOnOrigin(), POST);

  const offSession = buildRedditSession(
    mockPage('https://evil.example.com/reddit.com/r/node/comments/abc123/')
  );
  assert.throws(() => offSession.requireOnOrigin(), OffOriginError);
});

// --- writes block before navigation ---

test('commentPost is dry-run by default and blocks before navigation for a valid ref', async () => {
  const session = buildRedditSession(mockPage(POST), { interactive: true });
  const result = await commentPost(session, POST, 'hello');
  assert.equal(result.blocked, true);
  assert.equal(result.performed, false);
  assert.match(result.reason, /dry-run/);
});

test('replyToComment rejects cold-outreach usernames before navigation', async () => {
  const session = buildRedditSession(mockPage('https://www.reddit.com/'), { interactive: true });
  const result = await replyToComment(session, 'someuser', 'hello', { dryRun: false });
  assert.equal(result.blocked, true);
  assert.equal(result.performed, false);
  assert.match(result.reason, /existing/i);
});

test('upvote is a high-abuse action disabled without its distinct opt-in', async () => {
  const session = buildRedditSession(mockPage(POST), { interactive: true });
  const result = await upvotePost(session, POST, { dryRun: false });
  assert.equal(result.blocked, true);
  assert.equal(result.failure.stage, 'policy-disabled');
  assert.match(result.reason, /disabled by default/);
});
test('real save blocks for missing persistent rate state before navigation', async () => {
  let gotos = 0;
  const session = buildRedditSession(
    {
      url: () => POST,
      goto: async () => {
        gotos += 1;
      }
    },
    { interactive: true }
  );

  const result = await savePost(session, POST, { dryRun: false });

  assert.equal(result.blocked, true);
  assert.equal(result.changed, false);
  assert.equal(result.performed, false);
  assert.equal(result.failure.stage, 'rate-state-required');
  assert.equal(gotos, 0);
});

test('enabled upvote blocks for missing persistent rate state before navigation', async () => {
  let gotos = 0;
  const session = buildRedditSession(
    {
      url: () => POST,
      goto: async () => {
        gotos += 1;
      }
    },
    { interactive: true }
  );

  const result = await upvotePost(session, POST, { enableUpvote: true, dryRun: false });

  assert.equal(result.blocked, true);
  assert.equal(result.changed, false);
  assert.equal(result.performed, false);
  assert.equal(result.failure.stage, 'rate-state-required');
  assert.equal(gotos, 0);
});

// --- registry boundary: metadata is data only ---

test('every registry provider passes metadata schema', () => {
  for (const provider of providers) {
    const result = validateProviderSchema(provider);
    assert.equal(result.ok, true, `${provider?.id}: ${JSON.stringify(result.errors)}`);
  }
});

test('reddit registry metadata has mandatory per-key automation boundary assertions', () => {
  const reddit = providers.find((provider) => provider.id === 'reddit');
  assert.ok(reddit);
  for (const key of ['actions', 'selectors', 'session', 'automationRecipe']) {
    assert.equal(Object.hasOwn(reddit, key), false, `provider metadata must not carry "${key}"`);
  }
});
function writePage({
  upvoted = false,
  saved = false,
  comments = [],
  primaryComments = comments,
  fallbackComments = comments,
  rootCount = 1,
  postRootCount = 1,
  primaryPostRootCount = postRootCount,
  fallbackPostRootCount = postRootCount,
  childReplies = [],
  primaryChildReplies = childReplies,
  fallbackChildReplies = childReplies,
  nestedChildReplies = [],
  primaryRootCount = rootCount,
  fallbackRootCount = rootCount,
  childUpvoted = false
} = {}) {
  let currentUrl = POST;
  const locator = (query, scope = 'page') => {
    const isPrimaryPostCommentBodies =
      query.includes('[data-testid="post-comment-tree"]') &&
      query.includes('[data-testid="comment-body"]');
    const isFallbackPostCommentBodies =
      query.includes('shreddit-comment-tree') && query.includes('[slot="comment"]');
    const isPrimaryChildReplies = query.includes('[data-testid="comment-child-replies"]');
    const isFallbackChildReplies = query.includes('shreddit-comment-replies');
    const isDirectChildReplyBody =
      query.includes('> [data-testid="comment"] > [data-testid="comment-body"]') ||
      query.includes('> shreddit-comment > [slot="comment"]');
    const childReplyBodies = isPrimaryChildReplies ? primaryChildReplies : fallbackChildReplies;
    const texts = isPrimaryPostCommentBodies
      ? primaryComments
      : isFallbackPostCommentBodies
        ? fallbackComments
        : isPrimaryChildReplies || isFallbackChildReplies
          ? isDirectChildReplyBody
            ? childReplyBodies
            : [...childReplyBodies, ...nestedChildReplies]
          : comments;
    const target = {
      query,
      scope,
      count: async () => {
        if (query.includes('aria-pressed="true"') && query.includes('upvote')) {
          return query.includes('t3_abc123') ? (upvoted ? 1 : 0) : childUpvoted ? 1 : 0;
        }
        if (query.includes('aria-label^="Unsave"')) return saved ? 1 : 0;
        if (query.includes('t1_def456'))
          return query.includes('shreddit-comment') ? fallbackRootCount : primaryRootCount;
        if (query.includes('t3_abc123'))
          return query.includes('shreddit-post') ? fallbackPostRootCount : primaryPostRootCount;
        return 1;
      },
      allTextContents: async () => texts,
      locator: (childQuery) => locator(`${query} ${childQuery}`, 'nested'),
      first: () => target
    };
    return target;
  };
  return {
    nestedComment: { upvoted: childUpvoted },
    addPostComment: (tier, text) => {
      if (tier === 'primary') primaryComments.push(text);
      else fallbackComments.push(text);
    },
    setPostRootCounts: (primary, fallback) => {
      primaryPostRootCount = primary;
      fallbackPostRootCount = fallback;
    },
    addChildReply: (tier, text, { nested = false } = {}) => {
      if (nested) nestedChildReplies.push(text);
      else if (tier === 'primary') primaryChildReplies.push(text);
      else fallbackChildReplies.push(text);
    },
    url: () => currentUrl,
    goto: async (url) => {
      currentUrl = url;
    },
    evaluate: async () => ({ title: '', labels: [] }),
    waitForTimeout: async () => {},
    applyClick: (target) => {
      if (target.query.includes('upvote')) upvoted = true;
      if (target.query.includes('save')) saved = true;
    },
    locator
  };
}

function writeSession(page, stateDir = join(TEST_STATE_ROOT, randomUUID())) {
  const session = buildRedditSession(page, { interactive: true, stateDir });
  session.humanClick = async () => {};
  session.humanType = async () => {};
  return session;
}

test('already-upvoted and already-saved posts return verified no-ops without clicks or rate events', async () => {
  const page = writePage({ upvoted: true, saved: true });
  const session = writeSession(page);
  let clicks = 0;
  session.humanClick = async () => {
    clicks += 1;
  };

  const upvote = await upvotePost(session, POST, { dryRun: false, enableUpvote: true });
  const save = await savePost(session, POST, { dryRun: false });

  assert.equal(clicks, 0);
  for (const result of [upvote, save]) {
    assert.equal(result.ok, true);
    assert.equal(result.performed, false);
    assert.equal(result.changed, false);
    assert.equal(result.alreadySatisfied, true);
    assert.equal(result.rateLimit, null);
  }
});

test('save verification requires the distinct Unsave state, not a pressed Save control', async () => {
  const page = writePage({ saved: false });
  const session = writeSession(page);

  const result = await savePost(session, POST, { dryRun: false });

  assert.equal(result.performed, false);
  assert.ok(result.failure);
  assert.equal(result.targetSafety.disposition, 'ok');
});

test('replyToComment refuses to use a page-global Reply when the requested id is not uniquely located', async () => {
  const page = writePage({ rootCount: 0 });
  const session = writeSession(page);
  let clicks = 0;
  session.humanClick = async () => {
    clicks += 1;
  };

  const result = await replyToComment(session, COMMENT, 'targeted reply', { dryRun: false });

  assert.equal(clicks, 0);
  assert.equal(result.performed, false);
  assert.match(result.failure.blocker, /comment ownership/i);
});

test('pre-existing identical comment text does not pass post verification', async () => {
  const page = writePage({ comments: ['same comment'] });
  const result = await commentPost(writeSession(page), POST, ' same   comment ', { dryRun: false });

  assert.equal(result.performed, false);
  assert.ok(result.failure);
  assert.equal(result.targetSafety.disposition, 'ok');
});
test('post writes refuse page-global controls when the requested post root is not unique', async () => {
  const page = writePage({ postRootCount: 2 });
  const session = writeSession(page);
  let clicks = 0;
  session.humanClick = async () => {
    clicks += 1;
  };

  const results = await Promise.all([
    upvotePost(session, POST, { dryRun: false, enableUpvote: true }),
    savePost(session, POST, { dryRun: false }),
    commentPost(session, POST, 'targeted comment', { dryRun: false })
  ]);

  assert.equal(clicks, 0);
  for (const result of results) {
    assert.equal(result.performed, false);
    assert.match(result.failure.blocker, /post ownership/i);
  }
});

test('post and comment writes pass scoped locator objects to humanized helpers', async () => {
  const page = writePage();
  const session = writeSession(page);
  const clicks = [];
  const types = [];
  session.humanClick = async (target) => {
    clicks.push(target);
  };
  session.humanType = async (target) => {
    types.push(target);
  };

  await upvotePost(session, POST, { dryRun: false, enableUpvote: true });
  await savePost(session, POST, { dryRun: false });
  await commentPost(session, POST, 'targeted comment', { dryRun: false });
  await replyToComment(session, COMMENT, 'targeted reply', { dryRun: false });

  assert.ok(clicks.length >= 5);
  assert.equal(types.length, 2);
  for (const target of [...clicks, ...types]) {
    assert.equal(typeof target, 'object');
    assert.equal(target.scope, 'page');
    assert.match(target.query, /\[id="t[13]_(abc123|def456)"\] >/);
  }
});

test('a false-to-true upvote transition is performed, changed, and rate-recorded', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'reddit-actions-'));
  try {
    const page = writePage();
    const session = writeSession(page);
    session.stateDir = stateDir;
    session.humanClick = async (target) => page.applyClick(target);

    const result = await upvotePost(session, POST, { dryRun: false, enableUpvote: true });

    assert.equal(result.ok, true);
    assert.equal(result.performed, true);
    assert.equal(result.changed, true);
    assert.equal(result.alreadySatisfied, false);
    assert.ok(result.rateLimit);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
test('a failed interaction verification still consumes and returns the rate attempt snapshot', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'reddit-actions-'));
  try {
    const result = await upvotePost(Object.assign(writeSession(writePage()), { stateDir }), POST, {
      dryRun: false,
      enableUpvote: true
    });

    assert.equal(result.performed, false);
    assert.equal(result.rateLimit.count, 1);
    const rates = JSON.parse(await readFile(join(stateDir, 'action-rate.json'), 'utf8'));
    assert.equal(rates['reddit-upvote'].length, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
test('post-click exceptions return consumed rate evidence instead of rejecting', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'reddit-actions-'));
  try {
    const session = Object.assign(writeSession(writePage()), { stateDir });
    const cause = Object.assign(new Error('click socket reset'), { code: 'ECONNRESET' });
    const error = Object.assign(new Error('click transport failed', { cause }), {
      code: 'REDDIT_CLICK_FAILED'
    });
    session.humanClick = async () => {
      throw error;
    };

    const result = await upvotePost(session, POST, { dryRun: false, enableUpvote: true });

    assert.equal(result.performed, false);
    assert.equal(result.changed, false);
    assert.equal(result.rateLimit.count, 1);
    assert.equal(result.failure.stage, 'interaction');
    assert.match(result.failure.blocker, /click transport failed/);
    assert.deepEqual(result.failure.error, {
      name: 'Error',
      message: 'click transport failed',
      code: 'REDDIT_CLICK_FAILED',
      cause: { name: 'Error', message: 'click socket reset', code: 'ECONNRESET', cause: null }
    });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
test('post-submit exceptions return consumed rate evidence instead of rejecting', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'reddit-actions-'));
  try {
    const session = Object.assign(writeSession(writePage()), { stateDir });
    const cause = Object.assign(new Error('submit request timed out'), { code: 'ETIMEDOUT' });
    const error = Object.assign(new Error('submit transport failed', { cause }), {
      code: 'REDDIT_SUBMIT_FAILED'
    });
    session.humanClick = async (target) => {
      if (target.query.includes('button[aria-label="Comment"]')) throw error;
    };

    const result = await commentPost(session, POST, 'exact comment', { dryRun: false });

    assert.equal(result.performed, false);
    assert.equal(result.changed, false);
    assert.equal(result.rateLimit.count, 1);
    assert.equal(result.failure.stage, 'interaction');
    assert.match(result.failure.blocker, /submit transport failed/);
    assert.deepEqual(result.failure.error, {
      name: 'Error',
      message: 'submit transport failed',
      code: 'REDDIT_SUBMIT_FAILED',
      cause: { name: 'Error', message: 'submit request timed out', code: 'ETIMEDOUT', cause: null }
    });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
test('comment verification remains in its baseline primary selector tier', async () => {
  const page = writePage({
    primaryComments: [],
    fallbackComments: [],
    primaryPostRootCount: 1,
    fallbackPostRootCount: 0
  });
  const session = writeSession(page);
  session.humanClick = async (target) => {
    if (target.query.includes('button[aria-label="Comment"]')) {
      page.setPostRootCounts(0, 1);
      page.addPostComment('fallback', 'exact comment');
    }
  };

  const result = await commentPost(session, POST, 'exact comment', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.ok(result.rateLimit);
});
test('comment verification remains in its baseline fallback selector tier', async () => {
  const page = writePage({
    primaryComments: [],
    fallbackComments: [],
    primaryPostRootCount: 0,
    fallbackPostRootCount: 1
  });
  const session = writeSession(page);
  session.humanClick = async (target) => {
    if (target.query.includes('button[type="submit"]')) {
      page.setPostRootCounts(1, 0);
      page.addPostComment('primary', 'exact comment');
    }
  };

  const result = await commentPost(session, POST, 'exact comment', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.ok(result.rateLimit);
});
test('comment verification accepts a zero-comment baseline in its frozen owned tier', async () => {
  const page = writePage({ primaryComments: [], fallbackComments: [] });
  const session = writeSession(page);
  session.humanClick = async (target) => {
    if (target.query.includes('button[aria-label="Comment"]'))
      page.addPostComment('primary', 'exact comment');
  };

  const result = await commentPost(session, POST, 'exact comment', { dryRun: false });

  assert.equal(result.performed, true);
  assert.equal(result.changed, true);
  assert.ok(result.rateLimit);
});

test('nested comment distractors cannot satisfy post state or receive parent reply actions', async () => {
  const nestedUpvotePage = writePage({ childUpvoted: true });
  assert.equal(
    await nestedUpvotePage.locator('button[aria-pressed="true"][aria-label^="upvote"]').count(),
    1,
    'fixture must expose a real nested pressed-upvote distractor'
  );
  const upvoteResult = await upvotePost(writeSession(nestedUpvotePage), POST, {
    dryRun: false,
    enableUpvote: true
  });
  assert.equal(upvoteResult.alreadySatisfied, false);
  assert.equal(nestedUpvotePage.nestedComment.upvoted, true);

  const postPage = writePage({ comments: [], childReplies: ['nested exact text'] });
  const postResult = await commentPost(writeSession(postPage), POST, 'nested exact text', {
    dryRun: false
  });
  assert.equal(postResult.performed, false);

  const replyPage = writePage({ childReplies: ['nested exact text'] });
  const session = writeSession(replyPage);
  const clicks = [];
  const types = [];
  session.humanClick = async (target) => {
    clicks.push(target);
  };
  session.humanType = async (target) => {
    types.push(target);
  };
  const replyResult = await replyToComment(session, COMMENT, 'parent reply', { dryRun: false });

  assert.equal(replyResult.performed, false);
  for (const target of [...clicks, ...types]) {
    assert.match(target.query, /^\[id="t1_def456"\] >/);
    assert.doesNotMatch(target.query, /t3_abc123/);
  }
});
test('nested descendant bodies cannot verify a direct-child reply', async () => {
  const page = writePage({ primaryChildReplies: [], fallbackChildReplies: [] });
  const session = writeSession(page);
  session.humanClick = async (target) => {
    if (target.query.includes('button[aria-label="Comment"]')) {
      page.addChildReply('primary', 'exact reply', { nested: true });
    }
  };

  const result = await replyToComment(session, COMMENT, 'exact reply', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.ok(result.rateLimit);
});

test('reply verification remains in its baseline primary selector tier', async () => {
  const page = writePage({ primaryChildReplies: [], fallbackChildReplies: [] });
  const session = writeSession(page);
  session.humanClick = async (target) => {
    if (target.query.includes('button[aria-label="Comment"]')) {
      page.addChildReply('fallback', 'exact reply');
    }
  };

  const result = await replyToComment(session, COMMENT, 'exact reply', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.ok(result.rateLimit);
});
test('reply verification remains in its baseline fallback selector tier', async () => {
  const page = writePage({
    primaryRootCount: 0,
    fallbackRootCount: 1,
    primaryChildReplies: [],
    fallbackChildReplies: []
  });
  const session = writeSession(page);
  session.humanClick = async (target) => {
    if (target.query.includes('button[type="submit"]')) {
      page.addChildReply('primary', 'exact reply');
    }
  };

  const result = await replyToComment(session, COMMENT, 'exact reply', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.ok(result.rateLimit);
});

test('denied or non-ok safety writes never invoke guarded navigation or page goto', async () => {
  const page = writePage();
  let gotoCalls = 0;
  page.goto = async () => {
    gotoCalls += 1;
  };
  const denied = writeSession(page);
  let guardedCalls = 0;
  denied.navigateGuarded = async () => {
    guardedCalls += 1;
  };

  const deniedResult = await upvotePost(denied, POST, { dryRun: true, enableUpvote: true });

  assert.equal(deniedResult.blocked, true);
  assert.equal(guardedCalls, 0);
  assert.equal(gotoCalls, 0);

  const unsafe = buildRedditSession(page, {
    interactive: true,
    stateDir: join(TEST_STATE_ROOT, randomUUID()),
    targetSafety: { disposition: 'blocker', reason: 'test safety blocker' }
  });
  unsafe.humanClick = async () => {};
  await assert.rejects(
    upvotePost(unsafe, POST, { dryRun: false, enableUpvote: true }),
    (error) => error.code === 'HYPER_CLOAKING_TARGET_SAFETY'
  );
  assert.equal(gotoCalls, 0);
});
