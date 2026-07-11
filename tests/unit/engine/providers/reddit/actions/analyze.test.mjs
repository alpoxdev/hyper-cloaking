import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeActivity } from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/reddit/actions/analyze.mjs';

test('analyzeActivity handles empty activity', () => {
  assert.deepEqual(analyzeActivity([]), {
    count: 0,
    cadence: { postsPerWeek: 0, avgGapHours: null },
    score: {
      avgScore: 0,
      medianScore: 0,
      topPostUrl: null,
      scoreDistribution: { p25: 0, p50: 0, p75: 0 }
    },
    topSubreddits: []
  });
});

test('analyzeActivity calculates averages, nearest-rank median, top post, and subreddits', () => {
  const result = analyzeActivity([
    { score: 10, url: 'a', subreddit: 'r/node' },
    { score: 30, url: 'b', subreddit: 'node' },
    { score: 20, url: 'c', subreddit: 'javascript' }
  ]);
  assert.equal(result.score.avgScore, 20);
  assert.equal(result.score.medianScore, 20);
  assert.equal(result.score.topPostUrl, 'b');
  assert.deepEqual(result.topSubreddits, [
    { subreddit: 'node', count: 2 },
    { subreddit: 'javascript', count: 1 }
  ]);
});

test('analyzeActivity calculates cadence from valid timestamps', () => {
  const day = 24 * 60 * 60 * 1000;
  const result = analyzeActivity([
    { timestamp: 1_700_000_000_000 },
    { timestamp: 1_700_000_000_000 + 7 * day }
  ]);
  assert.deepEqual(result.cadence, { postsPerWeek: 2, avgGapHours: 168 });
});

test('analyzeActivity tolerates garbage fields', () => {
  const result = analyzeActivity([{}, null, { score: 'many', timestamp: 'never', subreddit: 42 }]);
  assert.equal(result.count, 2);
  assert.equal(result.score.avgScore, 0);
  assert.equal(result.score.topPostUrl, null);
  assert.deepEqual(result.topSubreddits, []);
});

test('analyzeActivity uses the exact nearest-rank score distribution', () => {
  const result = analyzeActivity([1, 2, 3, 4, 5].map((score) => ({ score })));
  assert.deepEqual(result.score.scoreDistribution, { p25: 2, p50: 3, p75: 4 });
});
