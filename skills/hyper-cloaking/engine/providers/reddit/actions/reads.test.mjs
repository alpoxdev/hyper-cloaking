import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeActivity } from './analyze.mjs';
import { getSubreddit } from './listing.mjs';
import { getPost } from './post.mjs';
import { getUserProfile } from './user.mjs';
import { assertExistingCommentRef } from './ids.mjs';
import { redditSelectors, resolveRedditSelector } from '../selectors.mjs';

function textNode(text, attributes = {}) {
  return {
    textContent: text,
    getAttribute: (name) => attributes[name] ?? null
  };
}

function activityNode({ href, title = 'A title', score = '42', comments = '12 comments', timestamp = '2026-07-01T12:00:00.000Z' }) {
  const link = textNode(comments, { href });
  const time = textNode(timestamp, { datetime: timestamp });
  const node = {
    textContent: title,
    getAttribute: (name) => name === 'href' ? href : null,
    parentElement: null,
    querySelector: (selector) => {
      if (selector.includes('time')) return time;
      if (selector.includes('/comments/')) return link;
      if (selector.includes('heading') || selector.includes('h1')) return textNode(title);
      if (selector.includes('upvote') || selector.includes('score')) return textNode(score);
      return null;
    }
  };
  node.closest = () => node;
  return node;
}

function mockPage(nodes = [], {
  evaluateError = null,
  selectorCounts = {},
  defaultSelectorCount = 1,
  serializeEvaluation = false,
  evaluationArgs = null,
  nodesBySelector = {}
} = {}) {
  let evaluations = 0;
  const document = {
    body: { innerText: 'ordinary Reddit content' },
    querySelector: () => null,
    querySelectorAll: (selector) => nodesBySelector[selector] ?? nodes
  };
  return {
    goto: async () => {},
    locator: (selector) => ({ count: async () => selectorCounts[selector] ?? defaultSelectorCount }),
    evaluate: async (callback, arg) => {
      evaluations += 1;
      evaluationArgs?.push(arg);
      if (evaluateError?.(evaluations)) throw evaluateError(evaluations);
      const previous = globalThis.document;
      globalThis.document = document;
      try {
        const evaluate = serializeEvaluation ? Function(`return (${callback.toString()})`)() : callback;
        return evaluate(arg);
      } finally {
        globalThis.document = previous;
      }
    }
  };
}

function mockSession(page, { challengeError = null } = {}) {
  return {
    page,
    requireOnOrigin: () => {},
    throwOnChallenge: () => {
      if (challengeError) throw challengeError;
    },
    async navigateGuarded(url, opts) {
      await page.goto(url, opts);
      const text = await page.evaluate(() => document.body?.innerText || '');
      this.throwOnChallenge({ text });
    }
  };
}
function commentNode(hrefs) {
  const links = hrefs.map((href) => textNode('permalink', { href }));
  return {
    textContent: 'A visible comment',
    querySelectorAll: (selector) => selector.includes('/comments/') ? links : [],
    querySelector: (selector) => {
      if (selector.includes('/user/')) return textNode('commenter');
      if (selector.includes('comment')) return textNode('A visible comment');
      if (selector.includes('time')) return textNode('2026-07-01T12:00:00.000Z', { datetime: '2026-07-01T12:00:00.000Z' });
      return null;
    }
  };
}

test('getPost rejects invalid references before navigation with InvalidPostRefError', async () => {
  const page = { goto: async () => assert.fail('invalid references must not navigate') };
  await assert.rejects(getPost(mockSession(page), 'not-a-post'), (error) => error.code === 'invalid-post-ref');
});

test('listing rejects off-origin post links rather than emitting canonical handles', async () => {
  const page = mockPage([activityNode({ href: 'https://reddit.example/r/node/comments/abc123/title/' })]);
  const read = await getSubreddit(mockSession(page), 'node');
  assert.deepEqual(read.content.posts, []);
});

test('listing reads compose directly with analyzeActivity', async () => {
  const post = activityNode({ href: '/r/node/comments/abc123/title/', score: '1.5k', comments: '24 comments' });
  const listing = await getSubreddit(mockSession(mockPage([post])), 'node');
  assert.equal(listing.content.posts[0].score, 1500);
  assert.equal(listing.content.posts[0].commentCount, 24);
  assert.equal(listing.content.posts[0].timestamp, '2026-07-01T12:00:00.000Z');
  assert.equal(analyzeActivity(listing.content.posts).count, 1);
});

test('getUserProfile serializes evaluate selector arguments and preserves analyzer-compatible activity', async () => {
  const activity = activityNode({ href: '/r/node/comments/def456/title/ghi789/', score: '7', comments: '3 comments' });
  const profile = await getUserProfile(
    mockSession(mockPage([activity], { serializeEvaluation: true })),
    'valid-user'
  );
  assert.equal(profile.content.activity[0].score, 7);
  assert.equal(profile.content.activity[0].commentCount, 3);
  assert.equal(profile.content.activity[0].subreddit, 'node');
  assert.equal(profile.content.activity[0].postId, 'def456');
  assert.equal(analyzeActivity(profile.content.activity).count, 1);
});

test('challenge and extraction errors reject instead of returning empty reads', async () => {
  const challenge = new Error('challenge detected');
  await assert.rejects(
    getSubreddit(mockSession(mockPage(), { challengeError: challenge }), 'node'),
    (error) => error === challenge
  );

  const extraction = new Error('evaluation failed');
  await assert.rejects(
    getUserProfile(mockSession(mockPage([], { evaluateError: (count) => count === 2 ? extraction : null })), 'valid-user'),
    (error) => error === extraction
  );
});
test('sequential Reddit selector resolution proves primary, fallback, or exhaustion', async () => {
  const entry = { primary: '.primary', fallback: '.fallback' };
  assert.equal(await resolveRedditSelector(mockPage([], { selectorCounts: { '.primary': 1, '.fallback': 1 } }), entry), '.primary');
  assert.equal(await resolveRedditSelector(mockPage([], { selectorCounts: { '.primary': 0, '.fallback': 1 } }), entry), '.fallback');
  await assert.rejects(
    resolveRedditSelector(mockPage([], { selectorCounts: { '.primary': 0, '.fallback': 0 }, defaultSelectorCount: 0 }), entry, { surface: 'test surface' }),
    (error) => error.code === 'reddit-selector-exhausted' && error.diagnostics.surface === 'test surface'
  );
});

test('getPost chooses an existing comment permalink over a distracting post permalink', async () => {
  const read = await getPost(
    mockSession(mockPage([
      commentNode([
        '/r/node/comments/abc123/post-title/',
        '/r/node/comments/abc123/post-title/def456/'
      ])
    ])),
    '/r/node/comments/abc123/post-title/'
  );

  const [comment] = read.content.comments;
  assert.equal(comment.commentId, 'def456');
  assert.deepEqual(assertExistingCommentRef(comment), {
    subreddit: 'node',
    postId: 'abc123',
    commentId: 'def456',
    permalink: '/r/node/comments/abc123/_/def456/',
    url: 'https://www.reddit.com/r/node/comments/abc123/_/def456/'
  });
});
test('getPost freezes the proven comment body extraction tier for page evaluation', async () => {
  const evaluationArgs = [];
  const primary = redditSelectors.post.extraction.commentBody.primary;
  const fallback = redditSelectors.post.extraction.commentBody.fallback;
  await getPost(
    mockSession(mockPage([
      commentNode(['/r/node/comments/abc123/post-title/def456/'])
    ], {
      evaluationArgs,
      selectorCounts: { [primary]: 1, [fallback]: 1 }
    })),
    '/r/node/comments/abc123/post-title/'
  );

  assert.equal(
    evaluationArgs.find((arg) => arg?.extraction?.commentBody)?.extraction.commentBody,
    primary
  );
});

test('getPost does not combine accessible and Shreddit comment wrappers', async () => {
  const evaluationArgs = [];
  const primary = redditSelectors.post.comment.primary;
  const fallback = redditSelectors.post.comment.fallback;
  const accessibleComment = commentNode(['/r/node/comments/abc123/post-title/def456/']);
  const componentWrapper = commentNode(['/r/node/comments/abc123/post-title/def456/']);
  const read = await getPost(
    mockSession(mockPage([], {
      evaluationArgs,
      selectorCounts: { [primary]: 1, [fallback]: 1 },
      nodesBySelector: { [primary]: [accessibleComment], [fallback]: [componentWrapper] }
    })),
    '/r/node/comments/abc123/post-title/'
  );

  assert.equal(read.content.comments.length, 1);
  assert.equal(evaluationArgs.find((arg) => arg?.comment)?.comment, primary);
});
