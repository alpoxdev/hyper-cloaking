import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzePosts } from './analyze.mjs';

test('analyzePosts handles the empty case', () => {
  const r = analyzePosts([]);
  assert.equal(r.count, 0);
  assert.deepEqual(r.mediaMix, { post: 0, reel: 0 });
  assert.equal(r.engagement.topPostUrl, null);
  assert.deepEqual(r.topHashtags, []);
});

test('analyzePosts computes media mix and engagement', () => {
  const posts = [
    { url: 'a', type: 'post', likeCount: 10, commentCount: 2, hashtags: ['#Fun', 'sun'] },
    { url: 'b', type: 'reel', likeCount: 30, commentCount: 4, hashtags: ['fun'] },
    { url: 'c', type: 'reel', likeCount: 20, commentCount: 0, hashtags: [] }
  ];
  const r = analyzePosts(posts);
  assert.equal(r.count, 3);
  assert.deepEqual(r.mediaMix, { post: 1, reel: 2 });
  assert.equal(r.engagement.avgLikes, 20);
  assert.equal(r.engagement.medianLikes, 20);
  assert.equal(r.engagement.topPostUrl, 'b'); // highest likeCount
  // hashtag normalization: '#Fun' and 'fun' collapse to 'fun' with count 2
  assert.deepEqual(r.topHashtags[0], { tag: 'fun', count: 2 });
});

test('analyzePosts computes cadence from timestamps', () => {
  const day = 24 * 60 * 60 * 1000;
  const base = 1_700_000_000_000;
  const posts = [
    { url: 'a', type: 'post', timestamp: base },
    { url: 'b', type: 'post', timestamp: base + 7 * day }
  ];
  const r = analyzePosts(posts);
  // 2 posts over exactly 1 week => 2 posts/week; gap 168h.
  assert.equal(r.cadence.postsPerWeek, 2);
  assert.equal(r.cadence.avgGapHours, 168);
});

test('analyzePosts tolerates missing/garbage fields', () => {
  const r = analyzePosts([{}, null, { likeCount: 'x', type: 'reel' }]);
  assert.equal(r.count, 2); // null filtered out
  assert.equal(r.engagement.avgLikes, 0);
});
