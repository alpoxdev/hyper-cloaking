import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeChannel } from './analyze.mjs';

test('analyzeChannel handles the empty case', () => {
  const result = analyzeChannel([]);
  assert.equal(result.count, 0);
  assert.deepEqual(result.cadence, { uploadsPerWeek: 0, avgGapHours: null });
  assert.deepEqual(result.engagement, {
    avgViews: 0,
    avgLikes: 0,
    medianViews: 0,
    topVideoUrl: null
  });
  assert.deepEqual(result.topTags, []);
});

test('analyzeChannel calculates engagement, median views, top video, and tags', () => {
  const result = analyzeChannel([
    { url: 'first', viewCount: 10, likeCount: 2, tags: ['#Music', 'live'] },
    { url: 'top', viewCount: 30, likeCount: 6, tags: ['music'] },
    { url: 'third', viewCount: 20, likeCount: 4, tags: [] }
  ]);

  assert.equal(result.engagement.avgViews, 20);
  assert.equal(result.engagement.avgLikes, 4);
  assert.equal(result.engagement.medianViews, 20);
  assert.equal(result.engagement.topVideoUrl, 'top');
  assert.deepEqual(result.topTags[0], { tag: 'music', count: 2 });
});

test('analyzeChannel calculates cadence from uploads one week apart', () => {
  const base = 1_700_000_000_000;
  const result = analyzeChannel([
    { url: 'first', publishedAt: base },
    { url: 'second', publishedAt: base + (7 * 24 * 60 * 60 * 1000) }
  ]);

  assert.equal(result.cadence.uploadsPerWeek, 2);
  assert.equal(result.cadence.avgGapHours, 168);
});

test('analyzeChannel tolerates missing and garbage values', () => {
  const result = analyzeChannel([null, {}, {
    viewCount: 'many',
    likeCount: Number.NaN,
    publishedAt: 'not-a-date',
    tags: [null, '  ', '#Useful']
  }]);

  assert.equal(result.count, 2);
  assert.equal(result.engagement.avgViews, 0);
  assert.equal(result.engagement.avgLikes, 0);
  assert.equal(result.engagement.medianViews, 0);
  assert.deepEqual(result.topTags, [{ tag: 'useful', count: 1 }]);
});
