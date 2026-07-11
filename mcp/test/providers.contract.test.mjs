import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../src/session-manager.mjs';
import { makeProviderReadTool, providerCapabilitiesTool } from '../src/tools/providers.mjs';

function payload(result) {
  return JSON.parse(result.content[0].text);
}

const tool = makeProviderReadTool(createSessionManager());
test('provider capability catalog is session-less, complete, and excludes helpers or blocked providers', async () => {
  const result = payload(await providerCapabilitiesTool.handler({}));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.providers, [
    {
      id: 'instagram',
      reads: ['getUser', 'getUserPosts', 'analyzePosts', 'listDMThreads', 'readDMThread'],
      writes: [
        'likePost',
        'commentPost',
        'savePost',
        'sharePost',
        'repost',
        'replyToDM',
        'replyToMany'
      ]
    },
    {
      id: 'naver',
      reads: [
        'searchWeb',
        'searchBlog',
        'searchCafe',
        'getBlogPost',
        'getBlogList',
        'getCafePost',
        'getCafeList',
        'analyzePosts'
      ],
      writes: [
        'setBlogPostLiked',
        'setCafePostLiked',
        'commentBlogPost',
        'replyToBlogComment',
        'commentCafePost',
        'replyToCafeComment',
        'createBlogDraft',
        'publishBlogDraft',
        'createCafePost'
      ]
    },
    {
      id: 'youtube',
      reads: ['searchVideos', 'getVideo', 'getChannel', 'analyzeChannel'],
      writes: ['likeVideo', 'commentVideo', 'subscribeChannel', 'shareVideo', 'saveToPlaylist']
    },
    {
      id: 'coupang',
      reads: ['searchProducts', 'getProduct', 'analyzeProducts'],
      writes: [
        'addToCart',
        'setCartQuantity',
        'removeCartItem',
        'setSavedState',
        'submitOwnOrderReview'
      ]
    },
    {
      id: 'tiktok',
      reads: [
        'getUser',
        'getUserVideos',
        'getVideo',
        'searchVideos',
        'listDMThreads',
        'readDMThread',
        'analyzeVideos'
      ],
      writes: [
        'setLiked',
        'setSaved',
        'setFollowing',
        'setReposted',
        'commentVideo',
        'replyToComment',
        'replyToDM',
        'createUploadDraft',
        'publishDraft'
      ]
    },
    {
      id: 'x',
      reads: [
        'getUser',
        'getUserPosts',
        'getPost',
        'searchPosts',
        'getThread',
        'listDMThreads',
        'readDMThread',
        'analyzePosts'
      ],
      writes: [
        'setLiked',
        'setBookmarked',
        'setFollowing',
        'setReposted',
        'createPost',
        'replyToPost',
        'quotePost',
        'replyToDM'
      ]
    }
  ]);
  assert.equal(
    result.providers.some(({ id }) => id === 'reddit'),
    false
  );
  assert.equal(
    result.providers.some(({ reads, writes }) =>
      [...reads, ...writes].includes('normalizeUserRef')
    ),
    false
  );
});

test('provider capability catalog returns fresh data and does not require a session', async () => {
  const first = payload(await providerCapabilitiesTool.handler({}));
  first.providers[0].reads.push('blockedAction');
  first.providers.pop();
  const second = payload(await providerCapabilitiesTool.handler({}));
  assert.equal(second.providers.length, 6);
  assert.equal(second.providers[0].reads.includes('blockedAction'), false);
});

test('unknown explicit provider id is refused fail-closed', async () => {
  const result = payload(await tool.handler({ provider: 'not-a-provider', action: 'getUser' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unknown-provider');
});

test('removed explicit provider id is refused fail-closed', async () => {
  const result = payload(await tool.handler({ provider: 'reddit', action: 'getSubreddit' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unknown-provider');
});

test('unknown host resolves to generic and is refused (no read actions)', async () => {
  const result = payload(
    await tool.handler({ url: 'https://totally-unknown-host.example/', action: 'getUser' })
  );
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'no-read-actions');
  assert.equal(result.provider, 'generic');
});

test('invalid url is refused fail-closed', async () => {
  const result = payload(await tool.handler({ url: 'not a url', action: 'getUser' }));
  assert.equal(result.status, 'refused');
});

test('a write action is refused at the read boundary', async () => {
  const result = payload(
    await tool.handler({ provider: 'instagram', action: 'likePost', args: [] })
  );
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unsupported-read-action');
});

test('a helper/normalize function is not dispatchable as a read', async () => {
  const result = payload(
    await tool.handler({ provider: 'x', action: 'normalizeUserRef', args: [] })
  );
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'unsupported-read-action');
});

test('a valid read action passes the allowlist and reaches the session gate', async () => {
  // No live session -> needs-preflight proves resolution + allowlist passed and
  // the tool would dispatch against a session (without needing a browser here).
  const result = payload(
    await tool.handler({ provider: 'instagram', action: 'getUser', args: ['someuser'] })
  );
  assert.equal(result.status, 'needs-preflight');
  assert.equal(result.code, 'no-session');
});

test('a removed provider URL falls back to generic and is refused', async () => {
  const result = payload(
    await tool.handler({
      url: 'https://www.reddit.com/r/node',
      action: 'getSubreddit',
      args: ['node']
    })
  );
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'no-read-actions');
  assert.equal(result.provider, 'generic');
});
